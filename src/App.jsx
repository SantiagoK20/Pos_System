import { useState, useEffect } from 'react'
import './App.css'
import { INITIAL_MENU_ITEMS } from './data/menuData'
import LoginScreen from './components/LoginScreen'
import TopBar from './components/TopBar'
import POSScreen from './components/POSScreen'
import Dashboard from './components/Dashboard'
import ManageMenu from './components/ManageMenu'
import ManageCashiers from './components/ManageCashiers'

const API_URL = '/api/menu'
const SALES_API_URL = '/api/sales'

function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [role, setRole] = useState('cashier')
  const [view, setView] = useState('pos')

  const [menuItems, setMenuItems] = useState(INITIAL_MENU_ITEMS)
  const [menuLoading, setMenuLoading] = useState(true)

  // ---- Sales log ----
  const [salesLog, setSalesLog] = useState([])
  const [salesLoading, setSalesLoading] = useState(true)

  // ---- Load sales from Firebase through PHP ----
  useEffect(() => {
    async function loadSales() {
      try {
        const response = await fetch(SALES_API_URL)

        if (!response.ok) {
          throw new Error('Failed to load sales')
        }

        const result = await response.json()

        if (result.success) {
          const firebaseSales = result.data

          if (
            firebaseSales &&
            typeof firebaseSales === 'object'
          ) {
            const sales = Object.entries(firebaseSales).map(
              ([id, sale]) => ({
                id,
                ...sale
              })
            )

            setSalesLog(sales)
          } else {
            setSalesLog([])
          }
        }
      } catch (error) {
        console.error('Error loading sales:', error)
        setSalesLog([])
      } finally {
        setSalesLoading(false)
      }
    }

    loadSales()
  }, [])

  // Save sales locally for now
  useEffect(() => {
    localStorage.setItem('pos_sales_log', JSON.stringify(salesLog))
  }, [salesLog])

  // ---- Load menu from Firebase through PHP ----
  useEffect(() => {
    async function loadMenu() {
      try {
        const response = await fetch(API_URL)

        if (!response.ok) {
          throw new Error('Failed to load menu')
        }

        const result = await response.json()

        if (result.success) {
          const firebaseMenu = result.data

          if (Array.isArray(firebaseMenu)) {
            setMenuItems(firebaseMenu)
          } else if (
            firebaseMenu &&
            typeof firebaseMenu === 'object'
          ) {
            const items = Object.entries(firebaseMenu).map(
              ([id, item]) => ({
                id,
                ...item
              })
            )

            setMenuItems(items)
          }
        }
      } catch (error) {
        console.error('Error loading menu:', error)

        // Keep the existing local menu if Firebase cannot be reached
        setMenuItems(INITIAL_MENU_ITEMS)
      } finally {
        setMenuLoading(false)
      }
    }

    loadMenu()
  }, [])

  // ---- Record sale ----
  async function recordSale(sale) {
    try {
      console.log('Sending sale to Firebase:', sale)

      const response = await fetch(SALES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sale),
      })

      const text = await response.text()

      console.log('Sales API response status:', response.status)
      console.log('Sales API raw response:', text)

      let result

      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(
          `Sales API did not return valid JSON. Response: ${text}`
        )
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
          `Sales API error (HTTP ${response.status})`
        )
      }

      console.log(
        'Sale successfully saved to Firebase:',
        result.data
      )

      // Add the Firebase version of the sale
      // to the dashboard immediately.
      setSalesLog((prev) => [
        ...prev,
        result.data
      ])

      return true

    } catch (error) {

      console.error(
        'FULL RECORD SALE ERROR:',
        error
      )

      alert(
        'Sale could not be saved.\n\n' +
        error.message
      )

      return false
    }
  }
  // ---- Reset sales ----
  async function resetSalesData() {
    if (
      !confirm(
        'This will permanently clear all recorded sales. Continue?'
      )
    ) {
      return
    }

    try {
      const response = await fetch('/api/sales', {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      })

      const data = await response.json()

      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Failed to reset sales.')
      }

      // Clear React state only after Laravel successfully clears Firebase
      setSalesLog([])

      alert('All sales data has been cleared successfully.')
    } catch (error) {
      console.error('Reset sales error:', error)
      alert(`Failed to reset sales data: ${error.message}`)
    }
  }

  // ---- Login ----
  function handleLogin(userRole) {
    setRole(userRole)
    setLoggedIn(true)

    if (userRole === 'admin') {
      setView('dashboard')
    } else {
      setView('pos')
    }
  }

  // ---- Logout ----
  function handleLogout() {
    setLoggedIn(false)
    setView('pos')
  }

  // =========================================================
  // ADD MENU ITEM
  // =========================================================

  async function addMenuItem(item) {
    try {
      console.log('Sending menu item:', item)

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(item),
      })

      // Read raw response
      const text = await response.text()

      console.log('PHP response status:', response.status)
      console.log('PHP raw response:', text)

      let result

      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(
          `PHP did not return valid JSON. Response: ${text}`
        )
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
          `PHP error (HTTP ${response.status})`
        )
      }

      console.log(
        'Menu item successfully added:',
        result.data
      )

      setMenuItems((prev) => [
        ...prev,
        result.data
      ])

      alert('Menu item added successfully!')

    } catch (error) {
      console.error(
        'FULL ADD MENU ERROR:',
        error
      )

      alert(
        'Failed to add menu item.\n\n' +
        error.message
      )
    }
  }

  // =========================================================
  // EDIT MENU ITEM
  // =========================================================

  async function editMenuItem(id, updated) {
    try {
      console.log('Updating menu item:', id, updated)

      const response = await fetch(API_URL, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id,
          ...updated,
        }),
      })

      // Read raw response
      const text = await response.text()

      console.log(
        'PHP edit response status:',
        response.status
      )

      console.log(
        'PHP edit raw response:',
        text
      )

      let result

      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(
          `PHP did not return valid JSON. Response: ${text}`
        )
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
          `PHP error (HTTP ${response.status})`
        )
      }

      console.log(
        'Menu item successfully updated:',
        result.data
      )

      setMenuItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? result.data
            : item
        )
      )

      alert('Menu item updated successfully!')

    } catch (error) {
      console.error(
        'FULL EDIT MENU ERROR:',
        error
      )

      alert(
        'Failed to edit menu item.\n\n' +
        error.message
      )
    }
  }

  // =========================================================
  // DELETE MENU ITEM
  // =========================================================

  async function deleteMenuItem(id) {
    try {
      console.log(
        'Deleting menu item:',
        id
      )

      const response = await fetch(API_URL, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id,
        }),
      })

      // Read raw response
      const text = await response.text()

      console.log(
        'PHP delete response status:',
        response.status
      )

      console.log(
        'PHP delete raw response:',
        text
      )

      let result

      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(
          `PHP did not return valid JSON. Response: ${text}`
        )
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
          `PHP error (HTTP ${response.status})`
        )
      }

      setMenuItems((prev) =>
        prev.filter(
          (item) => item.id !== id
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
        onLogin={handleLogin}
      />
    )
  }

  // =========================================================
  // MAIN APPLICATION
  // =========================================================

  return (
    <div className="pos-wrapper">

      <TopBar
        role={role}
        view={view}
        onNavigate={setView}
        onLogout={handleLogout}
      />

      {/* DASHBOARD */}
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
        <ManageCashiers />
      )}

      {/* POS */}
      {view === 'pos' && (
        <POSScreen
          menuItems={menuItems}
          onCompleteSale={recordSale}
        />
      )}

    </div>
  )
}

export default App