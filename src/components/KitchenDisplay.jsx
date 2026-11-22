import { useCallback, useEffect, useRef, useState } from 'react'
import { onIdTokenChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { createClient } from '@supabase/supabase-js'
import { apiFetch, getApiUrl } from '../api'
import { getOrderTypeLabel } from '../orderType'
import { getFirebaseAuthorizationHeader } from '../audit'
import { getKitchenAuth } from '../firebase'
import { bootstrapKitchenSession } from '../kitchenSession'
import logo from '../assets/atecles-grill-logo.jpg'
import '../kitchen.css'

const ACTIVE_STATUSES = ['new', 'preparing', 'ready']

async function kitchenApiRequest(getAuthorization, orderId) {
  const response = await apiFetch(getApiUrl(orderId ? `kitchen/pilot-orders/${encodeURIComponent(orderId)}` : 'kitchen/pilot-orders'), {
    method: orderId ? 'PATCH' : 'GET',
    headers: { Accept: 'application/json', Authorization: await getAuthorization() },
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error('Sign in again to use the kitchen board.')
  }
  if (!response.ok) throw new Error('Kitchen service unavailable. Try again.')
  return orderId ? null : (await response.json()).data.map(toDisplayOrder)
}

export function PilotKitchenBoard({ getAuthorization = getFirebaseAuthorizationHeader, onSignOut }) {
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')
  const [completing, setCompleting] = useState(null)

  useEffect(() => {
    let active = true
    let timer
    async function poll() {
      try {
        const next = await kitchenApiRequest(getAuthorization)
        if (active) {
          setOrders(next)
          setError('')
        }
      } catch (failure) {
        if (active) {
          setOrders([])
          setError(failure.message)
        }
      } finally {
        if (active) timer = window.setTimeout(poll, 5000)
      }
    }
    void poll()
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [getAuthorization])

  async function complete(orderId) {
    setCompleting(orderId)
    try {
      await kitchenApiRequest(getAuthorization, orderId)
      setOrders((current) => current.filter(({ id }) => id !== orderId))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setCompleting(null)
    }
  }

  return (
    <main className="kitchen-shell">
      <h2>Kitchen Live View</h2>
      {onSignOut && <button type="button" className="kitchen-sign-out" onClick={onSignOut}>Sign out</button>}
      {error && <p className="kitchen-alert" role="status">{error}</p>}
      <section className="kitchen-order-list" aria-label="Active kitchen orders">
        {!error && orders.length === 0 && <p className="kitchen-empty">No active orders</p>}
        {orders.map((order) => (
          <article className="kitchen-order-card" key={order.id}>
            <header className="kitchen-order-heading">
              <strong>#{order.order_number}</strong>
              <time dateTime={order.created_at}>{formatTime(order.created_at)}</time>
            </header>
            {order.orderType && <p className="kitchen-order-type">{order.orderType}</p>}
            <ul className="kitchen-items">
              {order.items.map((item, index) => (
                <li key={index}>
                  <span className="kitchen-item-quantity">{item.quantity}×</span>
                  <span className="kitchen-item-name">{item.name}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="kitchen-complete-order" disabled={completing !== null}
              onClick={() => complete(order.id)}>
              {completing === order.id ? 'Saving…' : 'Done'}
            </button>
          </article>
        ))}
      </section>
    </main>
  )
}

function getItemName(item) {
  return typeof item === 'string' ? item : item?.name || 'Menu item'
}

function getItemQuantity(item) {
  if (typeof item === 'string') {
    return 1
  }

  return Number(item?.quantity ?? item?.qty ?? 1)
}

function toDisplayOrder({ id, order_number, order_type, items, status, created_at, updated_at }) {
  return {
    id,
    order_number,
    orderType: getOrderTypeLabel(order_type),
    items: Array.isArray(items) ? items.map((item) => ({
      name: getItemName(item),
      quantity: getItemQuantity(item),
    })) : [],
    status,
    created_at,
    updated_at,
  }
}

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}

function mergeOrder(current, incoming) {
  const next = current.filter((order) => order.id !== incoming.id)

  if (ACTIVE_STATUSES.includes(incoming.status)) {
    next.push(incoming)
  }

  return next.sort((left, right) => (
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime() ||
    right.id.localeCompare(left.id)
  ))
}

function logKitchenSupabaseError(context, error) {
  const safeValue = (value) => (
    typeof value === 'string'
      ? value
        .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted JWT]')
        .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/gi, '[redacted Supabase key]')
      : typeof value === 'number'
        ? value
        : null
  )
  const details = {
    message: safeValue(error?.message) || 'Unknown Supabase error',
    code: safeValue(error?.code),
    details: safeValue(error?.details),
    hint: safeValue(error?.hint),
  }

  console.error(`[Kitchen] ${context}`, details)

  return details
}

function KitchenPage({ canUpdateStatus, children }) {
  return (
    <>
      <header className="topbar kitchen-app-topbar">
        <div className="topbar-left">
          <img src={logo} alt="Atecles Grill" className="topbar-logo" />
          <span className="topbar-title">Atecles Grill</span>
          {canUpdateStatus && <span className="topbar-badge">ADMIN</span>}
        </div>
        <div className="topbar-right">
          <span className="kitchen-page-title">Kitchen Live View</span>
        </div>
      </header>
      {children}
    </>
  )
}

function KitchenSignIn({ auth, bootstrapFailed }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, fields.get('email').trim(), fields.get('password'))
    } catch {
      setError('Could not sign in with those credentials.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Kitchen sign-in</h1>
      {bootstrapFailed && <p role="status">Automatic sign-in failed. Sign in here to open the kitchen board.</p>}
      <label>Email <input name="email" type="email" autoComplete="username" required /></label>
      <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={pending}>Sign in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

export default function KitchenDisplay() {
  const [bootstrapping, setBootstrapping] = useState(true)
  const [bootstrapFailed, setBootstrapFailed] = useState(false)

  useEffect(() => {
    let active = true
    async function bootstrap() {
      try {
        await bootstrapKitchenSession()
      } catch {
        if (active) setBootstrapFailed(true)
      } finally {
        if (active) setBootstrapping(false)
      }
    }
    void bootstrap()
    return () => { active = false }
  }, [])

  if (bootstrapping) {
    return (
      <KitchenPage>
        <main className="kitchen-shell">
          <p className="kitchen-loading" role="status">Opening Kitchen Live View…</p>
        </main>
      </KitchenPage>
    )
  }

  return <KitchenBoard bootstrapFailed={bootstrapFailed} />
}

function KitchenBoard({ bootstrapFailed }) {
  const [auth] = useState(getKitchenAuth)
  const [supabase, setSupabase] = useState(null)
  const currentClient = useRef(null)
  const snapshot = useRef(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [apiUser, setApiUser] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const [realtimeError, setRealtimeError] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true
    let authRequest = 0
    let firebaseAuthUnsubscribe
    let lastUser
    let attemptedRefresh = false

    async function configureSupabase(user) {
      const currentRequest = ++authRequest
      const isCurrent = () => active && currentRequest === authRequest && auth.currentUser === user
      if (lastUser !== user) {
        lastUser = user
        attemptedRefresh = false
      }
      currentClient.current = null
      setAuthorized(false)
      setApiUser(null)
      setSupabase(null)
      setOrders([])
      setErrorMessage('')
      setRealtimeError('')

      if (!user) {
        setConnection('offline')
        setLoading(false)
        return
      }

      setConnection('connecting')
      setLoading(true)

      try {
        const idToken = await user.getIdToken()
        if (!isCurrent()) return
        const response = await apiFetch(getApiUrl('kitchen/config'), {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
        })
        const result = await response.json()
        if (!isCurrent()) return

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Kitchen service configuration is unavailable.')
        }

        if (result.data?.useLaravel === true) {
          setApiUser(user)
          return
        }

        const { url, anonKey, canUpdateStatus } = result.data
        if (canUpdateStatus !== false) {
          throw new Error('Kitchen permissions are unavailable.')
        }

        const hasRequiredClaims = ({ claims }) => (
          claims.iss === 'https://securetoken.google.com/atecles-grill-pos' &&
          claims.aud === 'atecles-grill-pos' &&
          claims.sub === user.uid &&
          claims.role === 'authenticated' &&
          typeof claims.exp === 'number' &&
          claims.exp > Date.now() / 1000 &&
          claims.kitchen_viewer === true
        )

        let tokenResult = await user.getIdTokenResult()
        if (!isCurrent()) return
        if (!hasRequiredClaims(tokenResult) && !attemptedRefresh) {
          attemptedRefresh = true
          tokenResult = await user.getIdTokenResult(true)
        }
        if (!isCurrent()) return
        if (!hasRequiredClaims(tokenResult)) {
          throw new Error('Kitchen permissions are missing from the Firebase session. Sign in again.')
        }

        const client = createClient(url, anonKey, {
          accessToken: async () => {
            if (!isCurrent()) throw new Error('The Firebase kitchen session has changed.')
            const latest = await user.getIdTokenResult()
            if (!isCurrent() || !hasRequiredClaims(latest)) {
              throw new Error('The Firebase kitchen session is no longer authorized.')
            }
            return latest.token
          },
        })
        await client.realtime.setAuth(tokenResult.token)
        if (!isCurrent()) return

        currentClient.current = client
        setSupabase(client)
        setAuthorized(true)
        setErrorMessage('')
      } catch (error) {
        if (active && currentRequest === authRequest) {
          setSupabase(null)
          setOrders([])
          setErrorMessage(error.message || 'Could not connect to the kitchen service.')
          setConnection('offline')
        }
      } finally {
        if (active && currentRequest === authRequest) {
          setLoading(false)
        }
      }
    }

    firebaseAuthUnsubscribe = onIdTokenChanged(auth, (user) => {
      configureSupabase(user)
    })

    return () => {
      active = false
      currentClient.current = null
      authRequest += 1
      firebaseAuthUnsubscribe?.()
    }
  }, [auth])

  const getKitchenAuthorization = useCallback(async () => {
    if (!apiUser || auth.currentUser !== apiUser) throw new Error('Sign in again to use the kitchen board.')
    const token = await apiUser.getIdToken()
    if (auth.currentUser !== apiUser) throw new Error('Sign in again to use the kitchen board.')
    return `Bearer ${token}`
  }, [apiUser, auth])

  const loadOrders = useCallback(async () => {
    if (!supabase || currentClient.current !== supabase) {
      return
    }

    const request = { client: supabase, changes: [] }
    snapshot.current = request
    const isCurrent = () => currentClient.current === supabase && snapshot.current === request
    try {
      const { data, error } = await supabase
        .from('kitchen_orders')
        .select('id, order_number, items, status, created_at, updated_at')
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })

      if (!isCurrent()) return
      if (error) {
        const details = logKitchenSupabaseError('Initial order query failed', error)
        setErrorMessage(`Could not load active orders: ${details.message}`)
        return
      }

      setOrders(request.changes.reduce(mergeOrder, (data || []).map(toDisplayOrder)))
      setErrorMessage('')
    } catch (error) {
      if (!isCurrent()) return
      const details = logKitchenSupabaseError('Initial order query failed', error)
      setErrorMessage(`Could not load active orders: ${details.message}`)
    } finally {
      if (snapshot.current === request) snapshot.current = null
    }
  }, [supabase])

  useEffect(() => {
    if (!supabase || !auth.currentUser) {
      return undefined
    }

    let active = true
    const isCurrent = () => active && currentClient.current === supabase
    const applyChange = ({ new: row }) => {
      if (!isCurrent() || !row?.id) return
      const order = toDisplayOrder(row)
      if (snapshot.current?.client === supabase) snapshot.current.changes.push(order)
      setOrders((current) => mergeOrder(current, order))
    }
    const channel = supabase
      .channel('kitchen-orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kitchen_orders' }, applyChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'kitchen_orders' }, applyChange)
      .subscribe((status, error) => {
        if (!isCurrent()) {
          return
        }

        if (status === 'SUBSCRIBED') {
          setConnection('live')
          setRealtimeError('')
          loadOrders()
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setConnection('retrying')
          const details = logKitchenSupabaseError(`Realtime subscription failed (${status})`, error)
          setRealtimeError(
            details.message === 'Unknown Supabase error'
              ? 'Realtime connection lost. Reconnecting…'
              : `Realtime connection lost: ${details.message}`,
          )
        }
      })
    const initialLoad = window.setTimeout(() => {
      void loadOrders()
    }, 0)
    const handleOnline = () => {
      setConnection('retrying')
      loadOrders()
    }

    window.addEventListener('online', handleOnline)

    return () => {
      active = false
      window.clearTimeout(initialLoad)
      window.removeEventListener('online', handleOnline)
      supabase.removeChannel(channel)
    }
  }, [auth, loadOrders, supabase])

  if (apiUser && auth.currentUser === apiUser) {
    return (
      <KitchenPage canUpdateStatus>
        <PilotKitchenBoard getAuthorization={getKitchenAuthorization} onSignOut={() => signOut(auth)} />
      </KitchenPage>
    )
  }

  if (loading) {
    return (
      <KitchenPage>
        <main className="kitchen-shell">
          <p className="kitchen-loading">Connecting to kitchen service…</p>
        </main>
      </KitchenPage>
    )
  }

  if (!auth.currentUser) {
    return (
      <KitchenPage>
        <main className="kitchen-shell">
          <KitchenSignIn auth={auth} bootstrapFailed={bootstrapFailed} />
        </main>
      </KitchenPage>
    )
  }

  if (!authorized) {
    return (
      <KitchenPage>
        <main className="kitchen-shell">
          <div className="kitchen-alert" role="alert">
            {errorMessage || 'Kitchen access is required.'}
          </div>
          <button onClick={() => signOut(auth)}>Sign out</button>
        </main>
      </KitchenPage>
    )
  }

  return (
    <KitchenPage>
      <main className="kitchen-shell">
        <header className="kitchen-topbar">
          <div>
            <h1>Kitchen Live View</h1>
            <p className="kitchen-order-count">
              {orders.length} active {orders.length === 1 ? 'order' : 'orders'}
            </p>
          </div>
          <div className="kitchen-topbar-actions">
            <button className="kitchen-sign-out" onClick={() => signOut(auth)}>Sign out</button>
            <span className={`kitchen-connection ${connection}`}>
              {connection === 'live'
                ? 'Realtime connected'
                : connection === 'retrying'
                  ? 'Reconnecting…'
                  : connection === 'connecting'
                    ? 'Connecting…'
                    : 'Offline'}
            </span>
          </div>
        </header>

        {errorMessage && <div className="kitchen-alert" role="status">{errorMessage}</div>}
        {realtimeError && <div className="kitchen-alert" role="status">{realtimeError}</div>}

        <section className="kitchen-order-list" aria-label="Active kitchen orders">
          {orders.length === 0 && <p className="kitchen-empty">No active orders</p>}

          {orders.map((order) => (
            <article className="kitchen-order-card" key={order.id}>
              <header className="kitchen-order-heading">
                <strong>#{order.order_number}</strong>
                <time dateTime={order.created_at}>{formatTime(order.created_at)}</time>
              </header>

              <ul className="kitchen-items">
                {order.items.map((item, index) => (
                  <li key={`${order.id}-${index}`}>
                    <span className="kitchen-item-quantity">{item.quantity}×</span>
                    <span className="kitchen-item-name">{item.name}</span>
                  </li>
                ))}
              </ul>

            </article>
          ))}
        </section>
      </main>
    </KitchenPage>
  )
}
