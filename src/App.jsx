
import { useState, useEffect, useCallback, useRef } from 'react'
import { signOut } from 'firebase/auth'
import './App.css'
import { auth } from './firebase'
import { getFirebaseAuthorizationHeader, getPosSession, hasPosSession, hasTotpSession, recordAuditEvent, setTotpSession } from './audit'
import { apiFetch, getApiUrl } from './api'
import { applyPendingMenuChanges, canSyncAction, submitQueuedAction } from './pendingSync'

import {
  enqueueSyncAction,
  getOfflineSnapshot,
  getPendingSyncQueue,
  removePendingSyncAction,
  setOfflineSnapshot,
} from './offlineStorage'

import LoginScreen from './components/LoginScreen'
import TopBar from './components/TopBar'
import POSScreen from './components/POSScreen'
import Dashboard from './components/Dashboard'
import ManageMenu from './components/ManageMenu'
import ManageCashiers from './components/ManageCashiers'
import KitchenDisplay, { PilotKitchenBoard } from './components/KitchenDisplay'
import { openKitchenSession } from './kitchenSession'
import AuditLogs from './components/AuditLogs'
import AdministratorRequests from './components/AdministratorRequests'
import ApiConnectionNotice from './components/ApiConnectionNotice'

// =========================================================
// API
// =========================================================

function App() {
  const kitchen = new URLSearchParams(window.location.search).get('kitchen') === '1'
  return (
    <>
      <ApiConnectionNotice />
      {kitchen ? <KitchenDisplay /> : <POSApplication />}
    </>
  )
}

function POSApplication() {
  // =========================================================
  // LOGIN / NAVIGATION
  // =========================================================

  const [loggedIn, setLoggedIn] = useState(false)
  const [role, setRole] = useState('cashier')

  const [cashierSession, setCashierSession] = useState({
    id: '',
    username: '',
    shift: '',
  })

  const [view, setView] = useState('pos')

  function openKitchenLiveView() {
    if (hasTotpSession()) {
      setView('pilotKitchen')
      return
    }
    openKitchenSession()
  }

  // =========================================================
  // MENU
  // =========================================================

  const [menuItems, setMenuItems] = useState(() => {
    const snapshot = getOfflineSnapshot('pos_menu_items', [])
    return Array.isArray(snapshot) ? snapshot : []
  })
  const [menuLoading, setMenuLoading] = useState(true)

  // =========================================================
  // SALES
  // =========================================================

  const [salesLog, setSalesLog] = useState(() => {
    const snapshot = getOfflineSnapshot('pos_sales_log', [])
    return Array.isArray(snapshot) ? snapshot : []
  })
  const [salesLoading, setSalesLoading] = useState(true)

  const [dataRefreshVersion, setDataRefreshVersion] = useState(0)
  const [menuSyncConflict, setMenuSyncConflict] = useState(false)
  const syncingQueue = useRef(false)

  // =========================================================
  // AUDIT EVENTS
  // =========================================================

  const reportAuditEvent = useCallback(async (event, details = {}) => {
    try {
      await recordAuditEvent(event, details)
    } catch (error) {
      console.error(
        'Audit event could not be submitted:',
        event,
        error.message
      )
    }
  }, [])

  // =========================================================
  // OFFLINE QUEUE SYNCHRONIZATION
  // =========================================================

  const flushPendingSyncQueue = useCallback(async () => {
    if (!navigator.onLine || syncingQueue.current) {
      return
    }

    const session = getPosSession()
    if (!session) {
      return
    }

    const pendingActions = getPendingSyncQueue()

    if (!pendingActions.length) {
      return
    }

    syncingQueue.current = true
    try {
      const conflictingMenuIds = new Set()
      for (const action of pendingActions) {
        if (action.type !== 'sale' && conflictingMenuIds.has(action.payload?.id ?? action.payload?.clientMenuId)) continue
        try {
          if (!canSyncAction(action, session.uid)) continue

          const authorization = await getFirebaseAuthorizationHeader(session)
          const result = await submitQueuedAction(action, authorization)

          removePendingSyncAction(action.id)

          // -----------------------------------------------------
          // SYNC SALE
          // -----------------------------------------------------

          if (action.type === 'sale' && result.data) {
            setSalesLog((prev) => {
              const nextSales = prev.some(
                (item) => String(item.clientSaleId ?? item.id) === String(result.data.id)
              )
                ? prev.map((item) =>
                    String(item.clientSaleId ?? item.id) === String(result.data.id)
                      ? result.data
                      : item
                  )
                : [...prev, result.data]

              setOfflineSnapshot('pos_sales_log', nextSales)

              return nextSales
            })
          }

          // -----------------------------------------------------
          // SYNC NEW MENU ITEM
          // -----------------------------------------------------

          if (action.type === 'menu-add' && result.data) {
            setMenuItems((prev) => {
              const nextItems = prev.some(
                (item) => String(item.id) === String(result.data.id)
              )
                ? prev.map((item) =>
                    String(item.id) === String(result.data.id)
                      ? result.data
                      : item
                  )
                : [...prev, result.data]

              setOfflineSnapshot('pos_menu_items', nextItems)

              return nextItems
            })
          }

          // -----------------------------------------------------
          // SYNC EDITED MENU ITEM
          // -----------------------------------------------------

          if (action.type === 'menu-edit' && result.data) {
            setMenuItems((prev) => {
              const nextItems = prev.map((item) =>
                String(item.id) === String(action.payload.id)
                  ? result.data
                  : item
              )

              setOfflineSnapshot('pos_menu_items', nextItems)

              return nextItems
            })
          }

          // -----------------------------------------------------
          // SYNC DELETED MENU ITEM
          // -----------------------------------------------------

          if (action.type === 'menu-delete' && action.payload?.id) {
            setMenuItems((prev) => {
              const nextItems = prev.filter(
                (item) => String(item.id) !== String(action.payload.id)
              )

              setOfflineSnapshot('pos_menu_items', nextItems)

              return nextItems
            })
          }
        } catch (error) {
          console.error('Queued sync failed:', error)
          if (error.status === 409 && action.type !== 'sale') {
            conflictingMenuIds.add(action.payload?.id ?? action.payload?.clientMenuId)
            continue
          }
          break
        }
      }
      setMenuSyncConflict(conflictingMenuIds.size > 0)
    } finally {
      syncingQueue.current = false
    }
  }, [])

  // =========================================================
  // RESTORE OFFLINE DATA AND LISTEN FOR INTERNET
  // =========================================================

  useEffect(() => {
    if (!loggedIn) return
    window.addEventListener('online', flushPendingSyncQueue)
    const retry = window.setInterval(flushPendingSyncQueue, 15000)

    flushPendingSyncQueue()

    return () => {
      window.removeEventListener('online', flushPendingSyncQueue)
      window.clearInterval(retry)
    }
  }, [flushPendingSyncQueue, loggedIn])

  // =========================================================
  // KITCHEN ORDER SYNCHRONIZATION
  // =========================================================

  useEffect(() => {
    if (!loggedIn) {
      return undefined
    }

    let active = true
    let syncing = false

    const syncPendingKitchenOrders = async () => {
      if (!active || !navigator.onLine || syncing || !hasPosSession()) {
        return
      }

      syncing = true

      try {
        const response = await apiFetch(getApiUrl('kitchen/sync-pending'), {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: await getFirebaseAuthorizationHeader(),
          },
        })

        if (!response.ok) {
          console.warn(
            'Pending kitchen sync request failed:',
            response.status
          )
        }
      } catch (error) {
        console.warn(
          'Pending kitchen sync request failed:',
          error.message
        )
      } finally {
        syncing = false
      }
    }

    const intervalId = window.setInterval(
      syncPendingKitchenOrders,
      60000
    )

    window.addEventListener('online', syncPendingKitchenOrders)

    syncPendingKitchenOrders()

    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('online', syncPendingKitchenOrders)
    }
  }, [loggedIn])

  // =========================================================
  // REFRESH DATA WHEN WINDOW BECOMES ACTIVE
  // =========================================================

  useEffect(() => {
    let refreshTimeout
    let lastRefreshAt = Date.now()

    const refreshData = () => {
      if (
        document.visibilityState === 'hidden' ||
        Date.now() - lastRefreshAt < 1000
      ) {
        return
      }

      lastRefreshAt = Date.now()

      window.clearTimeout(refreshTimeout)

      refreshTimeout = window.setTimeout(() => {
        setDataRefreshVersion((version) => version + 1)
      }, 250)
    }

    window.addEventListener('focus', refreshData)
    window.addEventListener('online', refreshData)
    document.addEventListener('visibilitychange', refreshData)

    return () => {
      window.clearTimeout(refreshTimeout)

      window.removeEventListener('focus', refreshData)
      window.removeEventListener('online', refreshData)
      document.removeEventListener('visibilitychange', refreshData)
    }
  }, [])

  // =========================================================
  // LOAD SALES FROM LARAVEL / FIREBASE
  // =========================================================

  const autoRefreshSales = role === 'admin' && view === 'dashboard'

  useEffect(() => {
    if (!loggedIn) return

    const controller = new AbortController()
    let refreshTimeout

    async function loadSales() {
      try {
        const headers = {
          Accept: 'application/json',
        }

        if (hasPosSession()) {
          headers.Authorization = await getFirebaseAuthorizationHeader()
        }

        const response = await apiFetch(getApiUrl('sales'), {
          headers,
          signal: controller.signal,
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error('Failed to load sales')
        }

        const result = await response.json()
        if (controller.signal.aborted) return

        if (result.success) {
          const firebaseSales = result.data

          if (
            firebaseSales &&
            typeof firebaseSales === 'object'
          ) {
            const sales = Object.entries(firebaseSales).map(
              ([id, sale]) => ({
                id,
                ...sale,
              })
            )

            const ids = new Set(sales.map((sale) => String(sale.id)))
            setSalesLog([
              ...sales,
              ...getPendingSyncQueue()
                .filter(({ type, payload }) => type === 'sale' && payload &&
                  !ids.has(String(payload.clientSaleId ?? payload.id)))
                .map(({ payload, createdAt }) => ({ ...payload, queuedAt: createdAt, syncStatus: 'pending' })),
            ])
          } else {
            setSalesLog([])
          }
        } else {
          setSalesLog([])
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.error('Error loading sales:', error)

        const savedSales = getOfflineSnapshot('pos_sales_log', [])

        setSalesLog(
          Array.isArray(savedSales)
            ? savedSales
            : []
        )
      } finally {
        if (!controller.signal.aborted) {
          setSalesLoading(false)
          if (autoRefreshSales) {
            refreshTimeout = window.setTimeout(loadSales, 5000)
          }
        }
      }
    }

    loadSales()
    return () => {
      controller.abort()
      window.clearTimeout(refreshTimeout)
    }
  }, [dataRefreshVersion, loggedIn, autoRefreshSales])

  // =========================================================
  // LOCAL STORAGE SALES COPY
  // =========================================================

  useEffect(() => {
    setOfflineSnapshot('pos_sales_log', salesLog)
  }, [salesLog])

  // =========================================================
  // LOAD MENU FROM LARAVEL / FIREBASE
  // =========================================================

  useEffect(() => {
    if (!loggedIn) return

    const controller = new AbortController()
    let loading = false
    async function loadMenu() {
      if (loading) return
      loading = true
      try {
        const response = await apiFetch(getApiUrl('menu'), {
          headers: { Accept: 'application/json', Authorization: await getFirebaseAuthorizationHeader() },
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('Failed to load menu')
        }

        const result = await response.json()

        if (controller.signal.aborted) return
        if (!result.success) throw new Error('Failed to load menu')
        const items = Object.entries(result.data ?? {}).map(([id, item]) => ({
          ...item,
          id: item.id ?? id,
        }))
        setMenuItems(applyPendingMenuChanges(items, getPendingSyncQueue()))
      } catch (error) {
        if (controller.signal.aborted) return
        console.error('Error loading menu:', error)

        const savedMenu = getOfflineSnapshot('pos_menu_items', [])

        setMenuItems(
          Array.isArray(savedMenu)
            ? savedMenu
            : []
        )
      } finally {
        loading = false
        if (!controller.signal.aborted) setMenuLoading(false)
      }
    }

    loadMenu()
    const refresh = window.setInterval(loadMenu, 15000)
    return () => {
      controller.abort()
      window.clearInterval(refresh)
    }
  }, [dataRefreshVersion, loggedIn])

  useEffect(() => {
    setOfflineSnapshot('pos_menu_items', menuItems)
  }, [menuItems])

  // =========================================================
  // RECORD SALE
  // =========================================================

  async function recordSale(sale) {
    let response
    const session = getPosSession()
    if (!session) return { status: 'failed', message: 'You must sign in before recording sales.' }

    // Send sale to Laravel.
    try {
      if (!navigator.onLine) throw new Error('The terminal is offline.')
      const authorization = await getFirebaseAuthorizationHeader(session)
      response = await apiFetch(getApiUrl('sales'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authorization,
        },
        body: JSON.stringify(sale),
      })
      if (response.status >= 500) throw new Error(`The sales API returned HTTP ${response.status}.`)
    } catch (error) {
      if (session !== getPosSession()) {
        return { status: 'failed', message: 'The POS session changed. Please try again.' }
      }
      console.error('Sales API connection failed:', error)

      // Save sale to the existing offline queue.
      const queuedAction = enqueueSyncAction({
        type: 'sale',
        ownerUid: session.uid,
        method: 'POST',
        payload: sale,
      })

      if (!queuedAction) {
        return {
          status: 'failed',
          message:
            'Connection failed and the sale could not be saved locally. Your cart has been preserved.',
        }
      }

      const queuedSale = {
        ...sale,
        queuedAt: new Date().toISOString(),
        syncStatus: 'pending',
      }

      setSalesLog((prev) => {
        const existingIndex = prev.findIndex(
          (item) => item.clientSaleId === sale.clientSaleId
        )

        const nextSales = [...prev]

        if (existingIndex >= 0) {
          nextSales[existingIndex] = queuedSale
        } else {
          nextSales.push(queuedSale)
        }

        setOfflineSnapshot('pos_sales_log', nextSales)

        return nextSales
      })

      return {
        status: 'queued',
        data: queuedSale,
      }
    }

    // Process Laravel response.
    try {
      const text = await response.text()

      console.log('Sales API response status:', response.status)

      let result

      try {
        result = JSON.parse(text)
      } catch {
        throw new Error('Sales API did not return valid JSON.')
      }

      if (!response.ok || !result.success) {
        return {
          status: 'failed',
          message:
            result.message || `Sales API error (HTTP ${response.status})`,
        }
      }

      const savedSale = result.data

      setSalesLog((prev) => {
        const existingIndex = prev.findIndex(
          (item) =>
            (
              sale.clientSaleId &&
              item.clientSaleId === sale.clientSaleId
            ) ||
            String(item.id) === String(savedSale.id)
        )

        const nextSales = [...prev]

        if (existingIndex >= 0) {
          nextSales[existingIndex] = savedSale
        } else {
          nextSales.push(savedSale)
        }

        setOfflineSnapshot('pos_sales_log', nextSales)

        return nextSales
      })

      return {
        status: 'saved',
        data: savedSale,
      }
    } catch (error) {
      console.error(
        'Sales API response could not be processed:',
        error
      )

      return {
        status: 'failed',
        message:
          'The server response could not be processed. Your cart has been preserved. Please retry.',
      }
    }
  }

  // =========================================================
  // RESET SALES
  // =========================================================

  async function resetSalesData() {
    const confirmed = window.confirm(
      'This will permanently clear all recorded sales. Continue?'
    )

    if (!confirmed) {
      return
    }

    try {
      const response = await apiFetch(getApiUrl('sales'), {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: await getFirebaseAuthorizationHeader(),
        },
      })

      const data = await response.json()

      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Failed to reset sales.')
      }

      setSalesLog([])

      alert('All sales data has been cleared successfully.')
    } catch (error) {
      console.error('Reset sales error:', error)

      alert(`Failed to reset sales data: ${error.message}`)
    }
  }

  // =========================================================
  // LOGIN
  // =========================================================

  function handleLogin(
    userRole,
    cashierId = '',
    cashierUsername = '',
    cashierShift = ''
  ) {
    setRole(userRole)

    setCashierSession({
      id: cashierId,
      username: cashierUsername,
      shift: cashierShift,
    })

    setLoggedIn(true)

    setDataRefreshVersion((version) => version + 1)

    if (userRole === 'admin') {
      setView('dashboard')
    } else {
      setView('pos')
    }
  }

  // =========================================================
  // LOGOUT
  // =========================================================

  async function handleLogout() {
    if (hasTotpSession()) {
      try {
        await recordAuditEvent('logout')
      } catch {
        alert('Could not confirm sign-out. Check your connection and try again.')
        return
      }
    } else {
      await reportAuditEvent('logout')
    }
    setTotpSession(null)

    try {
      await signOut(auth)
    } catch (error) {
      console.error('Firebase sign-out failed:', error.message)
    }

    setLoggedIn(false)

    setCashierSession({
      id: '',
      username: '',
      shift: '',
    })

    setView('pos')
  }

  // =========================================================
  // ADD MENU ITEM
  // =========================================================

  async function addMenuItem(item) {
    const payload = { ...item, clientMenuId: crypto.randomUUID() }
    try {
      console.log('Sending menu item:', item)

      const response = await apiFetch(getApiUrl('menu'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await getFirebaseAuthorizationHeader(),
        },
        body: JSON.stringify(payload),
      })

      const text = await response.text()

      console.log('Menu API response status:', response.status)
      console.log('Menu API raw response:', text)

      let result

      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(
          'Menu API did not return valid JSON. Response: ' + text
        )
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || `Menu API error (HTTP ${response.status})`
        )
      }

      console.log('Menu item successfully added:', result.data)

      setMenuItems((prev) => [
        ...prev,
        result.data,
      ])

      alert('Menu item added successfully!')
    } catch (error) {
      console.error('FULL ADD MENU ERROR:', error)

      const isOffline =
        !navigator.onLine ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network')

      if (isOffline) {
        const queuedItem = {
          ...item,
          id: payload.clientMenuId,
          queuedAt: new Date().toISOString(),
          syncStatus: 'pending',
        }

        if (!enqueueSyncAction({
          type: 'menu-add',
          ownerUid: getPosSession()?.uid,
          method: 'POST',
          payload,
        })) return alert('Could not save the menu change on this terminal.')

        setMenuItems((prev) => {
          const nextItems = [...prev, queuedItem]

          setOfflineSnapshot('pos_menu_items', nextItems)

          return nextItems
        })

        alert(
          'You are offline. The menu item was saved locally and will sync later.'
        )

        return
      }

      alert('Failed to add menu item.\n\n' + error.message)
    }
  }

  // =========================================================
  // EDIT MENU ITEM
  // =========================================================

  async function editMenuItem(current, updated) {
    const { id } = current
    const expected = { name: current.name, category: current.category, price: current.price }
    const payload = { id, ...updated, expected }
    try {
      console.log('Updating menu item:', id, updated)

      const response = await apiFetch(getApiUrl('menu'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await getFirebaseAuthorizationHeader(),
        },
        body: JSON.stringify(payload),
      })

      const text = await response.text()

      console.log('Menu edit response status:', response.status)
      console.log('Menu edit raw response:', text)

      let result

      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(
          'Menu API did not return valid JSON. Response: ' + text
        )
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || `Menu API error (HTTP ${response.status})`
        )
      }

      console.log('Menu item successfully updated:', result.data)

      setMenuItems((prev) =>
        prev.map((item) =>
          String(item.id) === String(id)
            ? result.data
            : item
        )
      )

      alert('Menu item updated successfully!')
    } catch (error) {
      console.error('FULL EDIT MENU ERROR:', error)

      const isOffline =
        !navigator.onLine ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network')

      if (isOffline) {
        const updatedItem = {
          ...updated,
          id,
          queuedAt: new Date().toISOString(),
          syncStatus: 'pending',
        }

        if (!enqueueSyncAction({
          type: 'menu-edit',
          ownerUid: getPosSession()?.uid,
          method: 'PUT',
          payload,
        })) return alert('Could not save the menu change on this terminal.')

        setMenuItems((prev) => {
          const nextItems = prev.map((item) =>
            String(item.id) === String(id)
              ? updatedItem
              : item
          )

          setOfflineSnapshot('pos_menu_items', nextItems)

          return nextItems
        })

        alert(
          'You are offline. The menu update was saved locally and will sync later.'
        )

        return
      }

      alert('Failed to edit menu item.\n\n' + error.message)
    }
  }

  // =========================================================
  // DELETE MENU ITEM
  // =========================================================

  async function deleteMenuItem(current) {
    const { id } = current
    const expected = { name: current.name, category: current.category, price: current.price }
    const payload = { id, expected }
    try {
      console.log('Deleting menu item:', id)

      const response = await apiFetch(getApiUrl('menu'), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await getFirebaseAuthorizationHeader(),
        },
        body: JSON.stringify(payload),
      })

      const text = await response.text()

      console.log('Menu delete response status:', response.status)
      console.log('Menu delete raw response:', text)

      let result

      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(
          'Menu API did not return valid JSON. Response: ' + text
        )
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || `Menu API error (HTTP ${response.status})`
        )
      }

      setMenuItems((prev) =>
        prev.filter(
          (item) => String(item.id) !== String(id)
        )
      )

      alert('Menu item deleted successfully!')
    } catch (error) {
      console.error('FULL DELETE MENU ERROR:', error)

      const isOffline =
        !navigator.onLine ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network')

      if (isOffline) {
        if (!enqueueSyncAction({
          type: 'menu-delete',
          ownerUid: getPosSession()?.uid,
          method: 'DELETE',
          payload,
        })) return alert('Could not save the menu change on this terminal.')

        setMenuItems((prev) => {
          const nextItems = prev.filter(
            (item) => String(item.id) !== String(id)
          )

          setOfflineSnapshot('pos_menu_items', nextItems)

          return nextItems
        })

        alert(
          'You are offline. The menu deletion was saved locally and will sync later.'
        )

        return
      }

      alert('Failed to delete menu item.\n\n' + error.message)
    }
  }

  // =========================================================
  // LOGIN SCREEN
  // =========================================================

  if (!loggedIn) {
    return (
      <LoginScreen onLogin={handleLogin} />
    )
  }

  // =========================================================
  // MAIN APPLICATION
  // =========================================================

  return (
    <div className={`pos-wrapper${view !== 'pos' ? ' content-wrapper' : ''}`}>
      {menuSyncConflict && (
        <div className="pos-connection-notice" role="status">
          A queued menu change conflicts with another terminal. The change is still saved locally.
        </div>
      )}

      {/* TOP BAR */}

      <TopBar
        role={role}
        totpSession={hasTotpSession()}
        view={view}
        onNavigate={setView}
        onOpenKitchen={openKitchenLiveView}
        onLogout={handleLogout}
      />

      {view === 'pilotKitchen' && role === 'admin' && hasTotpSession() && <PilotKitchenBoard />}

      {/* DASHBOARD / ANALYTICS */}

      {view === 'dashboard' && (
        <Dashboard
          menuItems={menuItems}
          salesLog={salesLog}
          onResetSales={resetSalesData}
        />
      )}

      {/* MANAGE MENU */}

      {view === 'manageMenu' && (
        <ManageMenu
          menuItems={menuItems}
          onAdd={addMenuItem}
          onEdit={editMenuItem}
          onDelete={deleteMenuItem}
        />
      )}

      {/* MANAGE CASHIERS */}

      {view === 'manageCashiers' && (
        <ManageCashiers
          salesLog={salesLog}
          onAuditEvent={reportAuditEvent}
        />
      )}

      {/* AUDIT LOGS */}

      {view === 'auditLogs' && role === 'admin' && (
        <AuditLogs />
      )}
      {view === 'administratorRequests' && role === 'admin' && (
        <AdministratorRequests />
      )}

      {/* POS */}

      {view === 'pos' && (
        <POSScreen
          menuItems={menuItems}
          cashierId={cashierSession.id}
          cashierUsername={cashierSession.username}
          cashierShift={cashierSession.shift}
          onCompleteSale={recordSale}
          onAuditEvent={reportAuditEvent}
        />
      )}

    </div>
  )
}

export default App
