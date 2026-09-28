import { useState, useEffect, useCallback } from 'react'
import './App.css'

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


// =========================================================
// API
// =========================================================

const API_URL = '/api/menu'
const SALES_API_URL = '/api/sales'


function App() {

  // =========================================================
  // LOGIN / NAVIGATION
  // =========================================================

  const [loggedIn, setLoggedIn] =
    useState(false)

  const [role, setRole] =
    useState('cashier')

  const [view, setView] =
    useState('pos')


  // =========================================================
  // MENU
  //
  // IMPORTANT:
  // Start EMPTY.
  //
  // Do NOT use INITIAL_MENU_ITEMS.
  //
  // Firebase is the source of truth.
  // =========================================================

  const [menuItems, setMenuItems] =
    useState([])

  const [menuLoading, setMenuLoading] =
    useState(true)


  // =========================================================
  // SALES
  // =========================================================

  const [salesLog, setSalesLog] =
    useState([])

  const [salesLoading, setSalesLoading] =
    useState(true)


  const flushPendingSyncQueue = useCallback(async () => {
    if (!navigator.onLine) {
      return
    }

    const pendingActions = getPendingSyncQueue()

    if (!pendingActions.length) {
      return
    }

    for (const action of [...pendingActions]) {
      try {
        const requestOptions = {
          method: action.method || 'POST',
          headers: {
            Accept: 'application/json',
          },
        }

        if (action.payload !== undefined) {
          requestOptions.headers['Content-Type'] = 'application/json'
          requestOptions.body = JSON.stringify(action.payload)
        }

        const response = await fetch(action.endpoint, requestOptions)
        const text = await response.text()

        let result = {}

        if (text) {
          try {
            result = JSON.parse(text)
          } catch {
            result = { message: text }
          }
        }

        if (!response.ok || (result.success !== undefined && result.success === false)) {
          throw new Error(result.message || `Sync failed (${response.status})`)
        }

        removePendingSyncAction(action.id)

        if (action.type === 'sale' && result.data) {
          setSalesLog((prev) => {
            const nextSales = prev.some((item) => String(item.id) === String(result.data.id))
              ? prev.map((item) => (String(item.id) === String(result.data.id) ? result.data : item))
              : [...prev, result.data]

            setOfflineSnapshot('pos_sales_log', nextSales)
            return nextSales
          })
        }

        if (action.type === 'menu-add' && result.data) {
          setMenuItems((prev) => {
            const nextItems = prev.some((item) => String(item.id) === String(result.data.id))
              ? prev.map((item) => (String(item.id) === String(result.data.id) ? result.data : item))
              : [...prev, result.data]

            setOfflineSnapshot('pos_menu_items', nextItems)
            return nextItems
          })
        }

        if (action.type === 'menu-edit' && result.data) {
          setMenuItems((prev) => {
            const nextItems = prev.map((item) =>
              String(item.id) === String(action.payload.id) ? result.data : item
            )

            setOfflineSnapshot('pos_menu_items', nextItems)
            return nextItems
          })
        }

        if (action.type === 'menu-delete' && action.payload?.id) {
          setMenuItems((prev) => {
            const nextItems = prev.filter((item) => String(item.id) !== String(action.payload.id))
            setOfflineSnapshot('pos_menu_items', nextItems)
            return nextItems
          })
        }

      } catch (error) {
        console.error('Queued sync failed:', error)
        break
      }
    }
  }, [])


  useEffect(() => {
    const savedSales = getOfflineSnapshot('pos_sales_log', [])
    if (Array.isArray(savedSales) && savedSales.length > 0) {
      setSalesLog(savedSales)
    }

    const savedMenu = getOfflineSnapshot('pos_menu_items', [])
    if (Array.isArray(savedMenu) && savedMenu.length > 0) {
      setMenuItems(savedMenu)
    }

    const handleOnline = () => {
      flushPendingSyncQueue()
    }

    window.addEventListener('online', handleOnline)
    flushPendingSyncQueue()

    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [flushPendingSyncQueue])


  // =========================================================
  // LOAD SALES FROM LARAVEL / FIREBASE
  // =========================================================

  useEffect(() => {

    async function loadSales() {

      try {

        const response =
          await fetch(
            SALES_API_URL
          )


        if (!response.ok) {

          throw new Error(
            'Failed to load sales'
          )
        }


        const result =
          await response.json()


        if (
          result.success
        ) {

          const firebaseSales =
            result.data


          // -------------------------------------------------
          // FIREBASE OBJECT
          // -------------------------------------------------

          if (
            firebaseSales &&
            typeof firebaseSales ===
            'object'
          ) {

            const sales =
              Object.entries(
                firebaseSales
              ).map(
                (
                  [
                    id,
                    sale,
                  ]
                ) => ({

                  id,

                  ...sale,

                })
              )


            setSalesLog(
              sales
            )

          } else {

            setSalesLog(
              []
            )
          }

        } else {

          setSalesLog(
            []
          )
        }

      } catch (error) {

        console.error(
          'Error loading sales:',
          error
        )

        const savedSales = getOfflineSnapshot('pos_sales_log', [])
        setSalesLog(
          Array.isArray(savedSales)
            ? savedSales
            : []
        )

      } finally {

        setSalesLoading(
          false
        )
      }
    }


    loadSales()

  }, [])


  // =========================================================
  // LOCAL STORAGE SALES COPY
  //
  // This is NOT used as the source for loading sales.
  // Firebase remains the source of truth.
  // =========================================================

  useEffect(() => {
    setOfflineSnapshot(
      'pos_sales_log',
      salesLog
    )
  }, [salesLog])


  // =========================================================
  // LOAD MENU FROM LARAVEL / FIREBASE
  //
  // IMPORTANT:
  //
  // There is NO fallback to INITIAL_MENU_ITEMS.
  //
  // If Firebase has no items:
  // menuItems = []
  //
  // If Firebase request fails:
  // menuItems = []
  //
  // This prevents deleted/local items from appearing.
  // =========================================================

  useEffect(() => {

    async function loadMenu() {

      try {

        const response =
          await fetch(
            API_URL
          )


        if (!response.ok) {

          throw new Error(
            'Failed to load menu'
          )
        }


        const result =
          await response.json()


        console.log(
          'Menu API result:',
          result
        )


        if (
          result.success
        ) {

          const firebaseMenu =
            result.data


          // -------------------------------------------------
          // FIREBASE ARRAY
          // -------------------------------------------------

          if (
            Array.isArray(
              firebaseMenu
            )
          ) {

            setMenuItems(
              firebaseMenu
            )

          }

          // -------------------------------------------------
          // FIREBASE OBJECT
          // -------------------------------------------------

          else if (
            firebaseMenu &&
            typeof firebaseMenu ===
            'object'
          ) {

            const items =
              Object.entries(
                firebaseMenu
              ).map(
                (
                  [
                    id,
                    item,
                  ]
                ) => ({

                  id,

                  ...item,

                })
              )


            setMenuItems(
              items
            )

          }

          // -------------------------------------------------
          // EMPTY / NULL FIREBASE
          // -------------------------------------------------

          else {

            setMenuItems(
              []
            )
          }

        } else {

          // Firebase/API says no menu
          setMenuItems(
            []
          )
        }

      } catch (error) {

        console.error(
          'Error loading menu:',
          error
        )


        // -----------------------------------------------------
        // Fall back to the last synced offline snapshot.
        // -----------------------------------------------------

        const savedMenu = getOfflineSnapshot('pos_menu_items', [])
        setMenuItems(
          Array.isArray(savedMenu)
            ? savedMenu
            : []
        )

      } finally {

        setMenuLoading(
          false
        )
      }
    }


    loadMenu()

  }, [])

  useEffect(() => {
    setOfflineSnapshot(
      'pos_menu_items',
      menuItems
    )
  }, [menuItems])


  // =========================================================
  // RECORD SALE
  // =========================================================

  async function recordSale(
    sale
  ) {

    try {

      console.log(
        'Sending sale to Firebase:',
        sale
      )


      const response =
        await fetch(
          SALES_API_URL,
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(
                sale
              ),
          }
        )


      const text =
        await response.text()


      console.log(
        'Sales API response status:',
        response.status
      )


      console.log(
        'Sales API raw response:',
        text
      )


      let result


      try {

        result =
          JSON.parse(
            text
          )

      } catch {

        throw new Error(
          'Sales API did not return valid JSON. Response: ' +
          text
        )
      }


      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(
          result.message ||
          `Sales API error (HTTP ${response.status})`
        )
      }


      console.log(
        'Sale successfully saved to Firebase:',
        result.data
      )


      // ---------------------------------------------------------
      // ADD SALE TO DASHBOARD IMMEDIATELY
      // ---------------------------------------------------------

      setSalesLog(
        (prev) => [
          ...prev,
          result.data,
        ]
      )


      return true

    } catch (error) {

      console.error(
        'FULL RECORD SALE ERROR:',
        error
      )


      const isOffline =
        !navigator.onLine ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network')

      if (isOffline) {
        const queuedSale = {
          ...sale,
          queuedAt: new Date().toISOString(),
          syncStatus: 'pending',
        }

        enqueueSyncAction({
          type: 'sale',
          endpoint: SALES_API_URL,
          method: 'POST',
          payload: sale,
        })

        setSalesLog((prev) => {
          const nextSales = [...prev, queuedSale]
          setOfflineSnapshot('pos_sales_log', nextSales)
          return nextSales
        })

        alert(
          'You are offline. This sale was saved locally and will sync automatically when the connection is restored.'
        )

        return false
      }

      alert(
        'Sale could not be saved.\n\n' +
        error.message
      )

      return false
    }
  }


  // =========================================================
  // RESET SALES
  // =========================================================

  async function resetSalesData() {

    const confirmed =
      window.confirm(
        'This will permanently clear all recorded sales. Continue?'
      )


    if (!confirmed) {
      return
    }


    try {

      const response =
        await fetch(
          SALES_API_URL,
          {
            method:
              'DELETE',

            headers: {
              Accept:
                'application/json',
            },
          }
        )


      const data =
        await response.json()


      if (
        !response.ok ||
        data.success === false
      ) {

        throw new Error(
          data.message ||
          'Failed to reset sales.'
        )
      }


      // ---------------------------------------------------------
      // CLEAR REACT STATE AFTER FIREBASE SUCCESS
      // ---------------------------------------------------------

      setSalesLog(
        []
      )


      alert(
        'All sales data has been cleared successfully.'
      )

    } catch (error) {

      console.error(
        'Reset sales error:',
        error
      )


      alert(
        `Failed to reset sales data: ${error.message}`
      )
    }
  }


  // =========================================================
  // LOGIN
  // =========================================================

  function handleLogin(
    userRole
  ) {

    setRole(
      userRole
    )

    setLoggedIn(
      true
    )


    if (
      userRole ===
      'admin'
    ) {

      setView(
        'dashboard'
      )

    } else {

      setView(
        'pos'
      )
    }
  }


  // =========================================================
  // LOGOUT
  // =========================================================

  function handleLogout() {

    setLoggedIn(
      false
    )

    setView(
      'pos'
    )
  }


  // =========================================================
  // ADD MENU ITEM
  // =========================================================

  async function addMenuItem(
    item
  ) {

    try {

      console.log(
        'Sending menu item:',
        item
      )


      const response =
        await fetch(
          API_URL,
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(
                item
              ),
          }
        )


      const text =
        await response.text()


      console.log(
        'Menu API response status:',
        response.status
      )


      console.log(
        'Menu API raw response:',
        text
      )


      let result


      try {

        result =
          JSON.parse(
            text
          )

      } catch {

        throw new Error(
          'Menu API did not return valid JSON. Response: ' +
          text
        )
      }


      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(
          result.message ||
          `Menu API error (HTTP ${response.status})`
        )
      }


      console.log(
        'Menu item successfully added:',
        result.data
      )


      // ---------------------------------------------------------
      // ADD ONLY THE ITEM RETURNED BY FIREBASE/LARAVEL
      // ---------------------------------------------------------

      setMenuItems(
        (prev) => [
          ...prev,
          result.data,
        ]
      )


      alert(
        'Menu item added successfully!'
      )

    } catch (error) {

      console.error(
        'FULL ADD MENU ERROR:',
        error
      )

      const isOffline =
        !navigator.onLine ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network')

      if (isOffline) {
        const queuedItem = {
          ...item,
          queuedAt: new Date().toISOString(),
          syncStatus: 'pending',
        }

        enqueueSyncAction({
          type: 'menu-add',
          endpoint: API_URL,
          method: 'POST',
          payload: item,
        })

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

      alert(
        'Failed to add menu item.\n\n' +
        error.message
      )
    }
  }


  // =========================================================
  // EDIT MENU ITEM
  // =========================================================

  async function editMenuItem(
    id,
    updated
  ) {

    try {

      console.log(
        'Updating menu item:',
        id,
        updated
      )


      const response =
        await fetch(
          API_URL,
          {
            method:
              'PUT',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                id,
                ...updated,
              }),
          }
        )


      const text =
        await response.text()


      console.log(
        'Menu edit response status:',
        response.status
      )


      console.log(
        'Menu edit raw response:',
        text
      )


      let result


      try {

        result =
          JSON.parse(
            text
          )

      } catch {

        throw new Error(
          'Menu API did not return valid JSON. Response: ' +
          text
        )
      }


      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(
          result.message ||
          `Menu API error (HTTP ${response.status})`
        )
      }


      console.log(
        'Menu item successfully updated:',
        result.data
      )


      setMenuItems(
        (prev) =>
          prev.map(
            (item) =>
              String(
                item.id
              ) ===
                String(
                  id
                )
                ? result.data
                : item
          )
      )


      alert(
        'Menu item updated successfully!'
      )

    } catch (error) {

      console.error(
        'FULL EDIT MENU ERROR:',
        error
      )

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

        enqueueSyncAction({
          type: 'menu-edit',
          endpoint: API_URL,
          method: 'PUT',
          payload: { id, ...updated },
        })

        setMenuItems((prev) => {
          const nextItems = prev.map((item) => (String(item.id) === String(id) ? updatedItem : item))
          setOfflineSnapshot('pos_menu_items', nextItems)
          return nextItems
        })

        alert(
          'You are offline. The menu update was saved locally and will sync later.'
        )

        return
      }

      alert(
        'Failed to edit menu item.\n\n' +
        error.message
      )
    }
  }


  // =========================================================
  // DELETE MENU ITEM
  // =========================================================

  async function deleteMenuItem(
    id
  ) {

    try {

      console.log(
        'Deleting menu item:',
        id
      )


      const response =
        await fetch(
          API_URL,
          {
            method:
              'DELETE',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                id,
              }),
          }
        )


      const text =
        await response.text()


      console.log(
        'Menu delete response status:',
        response.status
      )


      console.log(
        'Menu delete raw response:',
        text
      )


      let result


      try {

        result =
          JSON.parse(
            text
          )

      } catch {

        throw new Error(
          'Menu API did not return valid JSON. Response: ' +
          text
        )
      }


      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(
          result.message ||
          `Menu API error (HTTP ${response.status})`
        )
      }


      // ---------------------------------------------------------
      // REMOVE ONLY FROM CURRENT REACT MENU
      // ---------------------------------------------------------

      setMenuItems(
        (prev) =>
          prev.filter(
            (item) =>
              String(
                item.id
              ) !==
              String(
                id
              )
          )
      )


      alert(
        'Menu item deleted successfully!'
      )

    } catch (error) {

      console.error(
        'FULL DELETE MENU ERROR:',
        error
      )

      const isOffline =
        !navigator.onLine ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network')

      if (isOffline) {
        enqueueSyncAction({
          type: 'menu-delete',
          endpoint: API_URL,
          method: 'DELETE',
          payload: { id },
        })

        setMenuItems((prev) => {
          const nextItems = prev.filter((item) => String(item.id) !== String(id))
          setOfflineSnapshot('pos_menu_items', nextItems)
          return nextItems
        })

        alert(
          'You are offline. The menu deletion was saved locally and will sync later.'
        )

        return
      }

      alert(
        'Failed to delete menu item.\n\n' +
        error.message
      )
    }
  }


  // =========================================================
  // LOGIN SCREEN
  // =========================================================

  if (!loggedIn) {

    return (
      <LoginScreen
        onLogin={
          handleLogin
        }
      />
    )
  }


  // =========================================================
  // MAIN APPLICATION
  // =========================================================

  return (

    <div className="pos-wrapper">


      {/* =================================================
                TOP BAR
            ================================================= */}

      <TopBar
        role={role}
        view={view}
        onNavigate={
          setView
        }
        onLogout={
          handleLogout
        }
      />


      {/* =================================================
                DASHBOARD / ANALYTICS
            ================================================= */}

      {view ===
        'dashboard' && (

          <Dashboard
            menuItems={
              menuItems
            }

            salesLog={
              salesLog
            }

            onResetSales={
              resetSalesData
            }
          />

        )}


      {/* =================================================
                MANAGE MENU
            ================================================= */}

      {view ===
        'manageMenu' && (

          <ManageMenu
            menuItems={
              menuItems
            }

            onAdd={
              addMenuItem
            }

            onEdit={
              editMenuItem
            }

            onDelete={
              deleteMenuItem
            }
          />

        )}


      {/* =================================================
                MANAGE CASHIERS
            ================================================= */}

      {view ===
        'manageCashiers' && (

          <ManageCashiers />

        )}


      {/* =================================================
                POS
            ================================================= */}

      {view ===
        'pos' && (

          <POSScreen
            menuItems={
              menuItems
            }

            onCompleteSale={
              recordSale
            }
          />

        )}

    </div>
  )
}


export default App