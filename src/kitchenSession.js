import { signInWithCustomToken } from 'firebase/auth'
import { apiFetch, getApiUrl } from './api'
import { auth, getKitchenAuth } from './firebase'

const HANDOFF_PREFIX = '#kitchen-session='
const HANDOFF_TIMEOUT = 15000

function handoffChannel(id) {
  return new BroadcastChannel(`atecles-kitchen:${id}`)
}

export function openKitchenSession() {
  const url = new URL(window.location.href)
  url.searchParams.set('kitchen', '1')
  url.hash = ''
  const administrator = auth.currentUser

  if (!administrator || !globalThis.crypto?.randomUUID || typeof BroadcastChannel !== 'function') {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  // The fragment only identifies a temporary same-origin channel.
  const id = crypto.randomUUID()
  const channel = handoffChannel(id)
  const controller = new AbortController()
  let requested = false
  const close = () => {
    clearTimeout(timeout)
    controller.abort()
    channel.close()
  }
  const timeout = setTimeout(close, HANDOFF_TIMEOUT)

  channel.onmessage = async ({ data }) => {
    if (data?.type !== 'ready' || requested) return
    requested = true
    try {
      const bearer = await administrator.getIdToken()
      if (auth.currentUser !== administrator) throw new Error('POS session changed')
      const response = await apiFetch(getApiUrl('kitchen/session'), {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}` },
        cache: 'no-store',
        signal: controller.signal,
      })
      const result = await response.json()
      if (!response.ok || auth.currentUser !== administrator || typeof result.data?.token !== 'string') {
        throw new Error('Kitchen session rejected')
      }
      if (!controller.signal.aborted) {
        channel.postMessage({ type: 'credential', token: result.data.token, uid: administrator.uid })
      }
    } catch {
      if (!controller.signal.aborted) channel.postMessage({ type: 'failed' })
    } finally {
      close()
    }
  }

  url.hash = HANDOFF_PREFIX.slice(1) + id
  window.open(url, '_blank', 'noopener,noreferrer')
}

let pendingBootstrap

export function bootstrapKitchenSession() {
  if (pendingBootstrap) return pendingBootstrap
  if (!window.location.hash.startsWith(HANDOFF_PREFIX)) return null

  const id = window.location.hash.slice(HANDOFF_PREFIX.length)
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState(window.history.state, '', url)

  pendingBootstrap = (async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id) || typeof BroadcastChannel !== 'function') {
      throw new Error('Automatic sign-in is unavailable.')
    }

    const channel = handoffChannel(id)
    const credential = await new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timeout)
        channel.close()
        callback(value)
      }
      const timeout = setTimeout(() => finish(reject, new Error('Kitchen sign-in timed out.')), HANDOFF_TIMEOUT)
      channel.onmessage = ({ data }) => {
        if (data?.type === 'credential' && typeof data.token === 'string' && typeof data.uid === 'string') {
          finish(resolve, data)
        } else if (data?.type === 'failed') {
          finish(reject, new Error('The POS administrator session could not be verified.'))
        }
      }
      channel.postMessage({ type: 'ready' })
    })

    const kitchenAuth = getKitchenAuth()
    const { user } = await signInWithCustomToken(kitchenAuth, credential.token)
    if (user.uid !== credential.uid) {
      await kitchenAuth.signOut()
      throw new Error('The kitchen session identity could not be verified.')
    }
  })()

  return pendingBootstrap
}
