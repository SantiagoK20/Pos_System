import { getAuth } from 'firebase/auth'
import { useCallback, useEffect, useState } from 'react'
import CashierShiftReceipt from './CashierShiftReceipt'

async function adminRequest(path, options = {}) {
    const currentUser = getAuth().currentUser
    if (!currentUser) {
        throw new Error('You are not logged in as an administrator.')
    }

    const idToken = await currentUser.getIdToken()
    const apiBaseUrl = window.location.protocol === 'file:'
        ? 'http://127.0.0.1:8001'
        : ''
    const response = await fetch(`${apiBaseUrl}/api/${path}`, {
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: 'Bearer ' + idToken,
            ...options.headers,
        },
    })
    const text = await response.text()
    let result

    try {
        result = JSON.parse(text)
    } catch {
        throw new Error(`Server did not return valid JSON.\n\n${text}`)
    }

    if (!response.ok || !result.success) {
        throw new Error(result.message || `Request failed (${response.status}).`)
    }

    return result.data
}

function ManageCashiers({ salesLog = [] }) {

    const [cashierUsername, setCashierUsername] = useState('')
    const [cashierPassword, setCashierPassword] = useState('')
    const [cashierConfirmPassword, setCashierConfirmPassword] = useState('')
    const [showCashierPassword, setShowCashierPassword] = useState(false)
    const [showCashierConfirmPassword, setShowCashierConfirmPassword] = useState(false)
    const [cashierShift, setCashierShift] = useState('AM')
    const [creatingCashier, setCreatingCashier] = useState(false)
    const [cashiers, setCashiers] = useState([])
    const [cashiersLoading, setCashiersLoading] = useState(true)
    const [cashierLoadError, setCashierLoadError] = useState('')
    const [updatingCashierId, setUpdatingCashierId] = useState('')
    const [passwordCashierId, setPasswordCashierId] = useState('')
    const [newCashierPassword, setNewCashierPassword] = useState('')
    const [confirmNewCashierPassword, setConfirmNewCashierPassword] = useState('')
    const [savingCashierPassword, setSavingCashierPassword] = useState(false)
    const [deletingCashierId, setDeletingCashierId] = useState('')
    const [selectedDate, setSelectedDate] = useState(() => {
        const today = new Date()
        const year = today.getFullYear()
        const month = String(today.getMonth() + 1).padStart(2, '0')
        const day = String(today.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    })
    const [selectedShiftReceipt, setSelectedShiftReceipt] = useState(null)

    const loadCashiers = useCallback(async () => {
        try {
            const data = await adminRequest('cashiers')
            setCashiers(Array.isArray(data) ? data : [])
            setCashierLoadError('')
        } catch (error) {
            console.error('Load cashiers error:', error)
            setCashierLoadError(error.message)
        } finally {
            setCashiersLoading(false)
        }
    }, [])

    useEffect(() => {
        let isCurrent = true

        adminRequest('cashiers')
            .then((data) => {
                if (!isCurrent) return
                setCashiers(Array.isArray(data) ? data : [])
                setCashierLoadError('')
            })
            .catch((error) => {
                if (!isCurrent) return
                console.error('Load cashiers error:', error)
                setCashierLoadError(error.message)
            })
            .finally(() => {
                if (isCurrent) {
                    setCashiersLoading(false)
                }
            })

        return () => {
            isCurrent = false
        }
    }, [])

    function getSaleDate(sale) {
        const rawDate = sale.date || sale.createdAt || sale.created_at || sale.timestamp
        if (!rawDate) return ''

        if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            return rawDate
        }

        const timestamp = typeof rawDate === 'number' && rawDate < 10000000000
            ? rawDate * 1000
            : rawDate
        const date = new Date(timestamp)
        if (Number.isNaN(date.getTime())) return ''

        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const dailySales = salesLog
        .filter((sale) => getSaleDate(sale) === selectedDate)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    function getCashierShiftSales(cashier) {
        return dailySales.filter((sale) => (
            String(sale.cashierUsername || sale.cashierId || sale.cashier_id || '').toLowerCase() ===
                String(cashier.cashierUsername).toLowerCase() &&
            String(sale.shift || '').toUpperCase() ===
                String(cashier.shift || '').toUpperCase()
        ))
    }

    async function handleCreateCashier(e) {
        e.preventDefault()

        const cleanCashierUsername = cashierUsername.trim()

        if (!cleanCashierUsername) {
            alert('Please enter a cashier username.')
            return
        }

        if (!cashierPassword) {
            alert('Please enter a password.')
            return
        }

        if (cashierPassword.length < 6) {
            alert('Cashier password must be at least 6 characters.')
            return
        }

        if (cashierPassword !== cashierConfirmPassword) {
            alert('Passwords do not match.')
            return
        }

        setCreatingCashier(true)

        try {
            const auth = getAuth()
            const currentUser = auth.currentUser

            if (!currentUser) {
                throw new Error('You are not logged in as an administrator.')
            }

            const idToken = await currentUser.getIdToken()

            const apiBaseUrl = import.meta.env.DEV
                ? ''
                : 'http://127.0.0.1:8001'

		const response = await fetch(`${apiBaseUrl}/api/cashiers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    cashierUsername: cleanCashierUsername,
                    password: cashierPassword,
                    shift: cashierShift,
                }),
            })

            const text = await response.text()
            let result

            try {
                result = JSON.parse(text)
            } catch {
                throw new Error(`Server did not return valid JSON.\n\n${text}`)
            }

            if (!response.ok || !result.success) {
                throw new Error(result.message || `Request failed (${response.status}).`)
            }

            alert(`Cashier account "${cleanCashierUsername}" created successfully!`)

            setCashierUsername('')
            setCashierPassword('')
            setCashierConfirmPassword('')
            setCashierShift('AM')
            await loadCashiers()

        } catch (error) {
            console.error('Create cashier error:', error)
            alert(error.message)
        } finally {
            setCreatingCashier(false)
        }
    }

    async function handleShiftChange(cashier, shift) {
        const cashierKey = cashier.databaseKey
        setUpdatingCashierId(cashierKey)

        try {
            await adminRequest(`cashiers/${encodeURIComponent(cashierKey)}/shift`, {
                method: 'PUT',
                body: JSON.stringify({ shift }),
            })
            setCashiers((previous) => previous.map((entry) => (
                entry.databaseKey === cashierKey
                    ? { ...entry, shift }
                    : entry
            )))
        } catch (error) {
            console.error('Update cashier shift error:', error)
            alert(`Failed to update shift.\n\n${error.message}`)
        } finally {
            setUpdatingCashierId('')
        }
    }

    async function handlePasswordChange(e, cashier) {
        e.preventDefault()

        if (newCashierPassword.length < 6) {
            alert('Cashier password must be at least 6 characters.')
            return
        }
        if (newCashierPassword !== confirmNewCashierPassword) {
            alert('Passwords do not match.')
            return
        }

        setSavingCashierPassword(true)
        try {
            await adminRequest(`cashiers/${encodeURIComponent(cashier.databaseKey)}/password`, {
                method: 'PUT',
                body: JSON.stringify({ password: newCashierPassword }),
            })
            alert(`Password updated for "${cashier.cashierUsername}".`)
            setPasswordCashierId('')
            setNewCashierPassword('')
            setConfirmNewCashierPassword('')
        } catch (error) {
            console.error('Update cashier password error:', error)
            alert(`Failed to update password.\n\n${error.message}`)
        } finally {
            setSavingCashierPassword(false)
        }
    }

    async function handleDeleteCashier(cashier) {
        const confirmed = window.confirm(
            `Delete cashier "${cashier.cashierUsername}"? This removes the cashier's login account and profile.`
        )
        if (!confirmed) return

        setDeletingCashierId(cashier.databaseKey)
        try {
            await adminRequest(`cashiers/${encodeURIComponent(cashier.databaseKey)}`, {
                method: 'DELETE',
            })
            setCashiers((previous) => previous.filter(
                (entry) => entry.databaseKey !== cashier.databaseKey
            ))
            if (passwordCashierId === cashier.databaseKey) {
                setPasswordCashierId('')
                setNewCashierPassword('')
                setConfirmNewCashierPassword('')
            }
            alert(`Cashier "${cashier.cashierUsername}" was deleted.`)
        } catch (error) {
            console.error('Delete cashier error:', error)
            alert(`Failed to delete cashier.\n\n${error.message}`)
        } finally {
            setDeletingCashierId('')
        }
    }

    return (
        <div className="cashiers-page fade-in">
            <div className="cashiers-header">
                <h1 className="cashiers-title">Manage Cashiers</h1>
                <p className="cashiers-subtitle">
                    Create cashier accounts and review daily sales by cashier and shift.
                </p>
            </div>

            <div className="cashiers-layout">
                <section className="cashier-users-panel">
                    <div className="cashier-users-header">
                        <div>
                            <h2>Cashier Users</h2>
                            <p>Firebase cashier accounts and shift sales.</p>
                        </div>
                        <button type="button" onClick={loadCashiers} disabled={cashiersLoading}>
                            Refresh
                        </button>
                    </div>

                    <label className="cashier-date-field">
                        <span>Sales date</span>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                        />
                    </label>

                    {cashiersLoading ? (
                        <p className="cashier-sales-empty">Loading cashier accounts…</p>
                    ) : cashierLoadError ? (
                        <p className="cashier-users-error">
                            Could not load cashier accounts: {cashierLoadError}
                        </p>
                    ) : cashiers.length ? (
                        <div className="cashier-users-list">
                            {cashiers.map((cashier) => {
                                const shiftSales = getCashierShiftSales(cashier)
                                const shiftTotal = shiftSales.reduce(
                                    (sum, sale) => sum + Number(sale.total || 0),
                                    0
                                )

                                return (
                                    <div className="cashier-user-row" key={cashier.databaseKey}>
                                        <div className="cashier-user-details">
                                            <strong>{cashier.cashierUsername}</strong>
                                            <span>{cashier.shift || 'Shift unassigned'} Shift</span>
                                            <span>{shiftSales.length} {shiftSales.length === 1 ? 'sale' : 'sales'} · ₱{shiftTotal.toFixed(2)}</span>
                                        </div>
                                        <div className="cashier-user-actions">
                                            <select
                                                aria-label={`Shift for cashier ${cashier.cashierUsername}`}
                                                value={cashier.shift || ''}
                                                onChange={(e) => handleShiftChange(cashier, e.target.value)}
                                                disabled={updatingCashierId === cashier.databaseKey}
                                            >
                                                <option value="" disabled>Assign shift</option>
                                                <option value="AM">AM Shift</option>
                                                <option value="PM">PM Shift</option>
                                            </select>
                                            <button
                                                type="button"
                                                className="cashier-shift-print-btn"
                                                onClick={() => setSelectedShiftReceipt({
                                                    cashier,
                                                    shift: cashier.shift,
                                                    sales: shiftSales,
                                                })}
                                            >
                                                Print sales receipt
                                            </button>
                                        </div>
                                        <details className="cashier-account-options">
                                            <summary>Account options</summary>
                                            <div className="cashier-account-options-content">
                                                <p className="cashier-password-note">
                                                    Passwords cannot be viewed. Set a new password if it needs to be changed.
                                                </p>
                                                {passwordCashierId === cashier.databaseKey ? (
                                                    <form
                                                        className="cashier-password-form"
                                                        onSubmit={(e) => handlePasswordChange(e, cashier)}
                                                    >
                                                        <input
                                                            type="password"
                                                            aria-label={`New password for ${cashier.cashierUsername}`}
                                                            placeholder="New password (minimum 6 characters)"
                                                            value={newCashierPassword}
                                                            onChange={(e) => setNewCashierPassword(e.target.value)}
                                                            minLength={6}
                                                            autoComplete="new-password"
                                                            disabled={savingCashierPassword}
                                                        />
                                                        <input
                                                            type="password"
                                                            aria-label={`Confirm new password for ${cashier.cashierUsername}`}
                                                            placeholder="Confirm new password"
                                                            value={confirmNewCashierPassword}
                                                            onChange={(e) => setConfirmNewCashierPassword(e.target.value)}
                                                            minLength={6}
                                                            autoComplete="new-password"
                                                            disabled={savingCashierPassword}
                                                        />
                                                        <button type="submit" disabled={savingCashierPassword}>
                                                            {savingCashierPassword ? 'Saving…' : 'Save new password'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPasswordCashierId('')
                                                                setNewCashierPassword('')
                                                                setConfirmNewCashierPassword('')
                                                            }}
                                                            disabled={savingCashierPassword}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </form>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPasswordCashierId(cashier.databaseKey)
                                                            setNewCashierPassword('')
                                                            setConfirmNewCashierPassword('')
                                                        }}
                                                    >
                                                        Set new password
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className="cashier-delete-btn"
                                                    onClick={() => handleDeleteCashier(cashier)}
                                                    disabled={deletingCashierId === cashier.databaseKey}
                                                >
                                                    {deletingCashierId === cashier.databaseKey ? 'Deleting…' : 'Delete cashier account'}
                                                </button>
                                            </div>
                                        </details>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <p className="cashier-sales-empty">No cashier accounts found in Firebase.</p>
                    )}
                </section>

                <section className="cashiers-card">
                    <div className="cashiers-card-icon">👤</div>
                    <h2 className="cashiers-card-title">Cashier Details</h2>
                    <p className="cashiers-card-desc">
                        Create cashier logins and assign each user an AM or PM shift.
                    </p>

                    <form onSubmit={handleCreateCashier} className="cashiers-form">
                        <div className="cashiers-field">
                            <label className="cashiers-label" htmlFor="cashier-username">Cashier Username</label>
                            <input
                                id="cashier-username"
                                type="text"
                                className="cashiers-input"
                                placeholder="Enter cashier's name"
                                value={cashierUsername}
                                onChange={(e) => setCashierUsername(e.target.value)}
                                maxLength={50}
                                disabled={creatingCashier}
                            />
                            <span className="cashiers-card-desc">Use the cashier's name; spaces are allowed.</span>
                        </div>

                        <div className="cashiers-field">
                            <label className="cashiers-label" htmlFor="cashier-password">Password</label>
                            <div className="cashier-password-control">
                                <input
                                    id="cashier-password"
                                    type={showCashierPassword ? 'text' : 'password'}
                                    className="cashiers-input"
                                    placeholder="Minimum 6 characters"
                                    value={cashierPassword}
                                    onChange={(e) => setCashierPassword(e.target.value)}
                                    disabled={creatingCashier}
                                />
                                <button
                                    type="button"
                                    className="cashier-password-toggle"
                                    aria-label={showCashierPassword ? 'Hide password' : 'Show password'}
                                    aria-pressed={showCashierPassword}
                                    onClick={() => setShowCashierPassword((visible) => !visible)}
                                    disabled={creatingCashier}
                                >
                                    {showCashierPassword ? (
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" />
                                            <path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.3 2.3-2.5 3.5M6.2 6.2C3.9 7.7 2.7 10 2.5 12c1 2.5 4.5 7 9.5 7 1.3 0 2.5-.3 3.5-.8" />
                                        </svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                                            <circle cx="12" cy="12" r="3" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>

                        <div className="cashiers-field">
                            <label className="cashiers-label" htmlFor="cashier-confirm">Confirm Password</label>
                            <div className="cashier-password-control">
                                <input
                                    id="cashier-confirm"
                                    type={showCashierConfirmPassword ? 'text' : 'password'}
                                    className="cashiers-input"
                                    placeholder="Re-enter password"
                                    value={cashierConfirmPassword}
                                    onChange={(e) => setCashierConfirmPassword(e.target.value)}
                                    disabled={creatingCashier}
                                />
                                <button
                                    type="button"
                                    className="cashier-password-toggle"
                                    aria-label={showCashierConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                                    aria-pressed={showCashierConfirmPassword}
                                    onClick={() => setShowCashierConfirmPassword((visible) => !visible)}
                                    disabled={creatingCashier}
                                >
                                    {showCashierConfirmPassword ? (
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" />
                                            <path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.3 2.3-2.5 3.5M6.2 6.2C3.9 7.7 2.7 10 2.5 12c1 2.5 4.5 7 9.5 7 1.3 0 2.5-.3 3.5-.8" />
                                        </svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                                            <circle cx="12" cy="12" r="3" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>

                        <div className="cashiers-field">
                            <label className="cashiers-label" htmlFor="cashier-shift">Cashier Shift</label>
                            <select
                                id="cashier-shift"
                                className="cashiers-input"
                                value={cashierShift}
                                onChange={(e) => setCashierShift(e.target.value)}
                                disabled={creatingCashier}
                            >
                                <option value="AM">AM Shift</option>
                                <option value="PM">PM Shift</option>
                            </select>
                        </div>

                        <button
                            type="submit"
                            className="cashiers-submit-btn"
                            disabled={creatingCashier}
                        >
                            {creatingCashier ? (
                                <span className="cashiers-spinner">⏳ Creating Account…</span>
                            ) : (
                                '+ Create Cashier Account'
                            )}
                        </button>
                    </form>

                </section>
            </div>

            <CashierShiftReceipt
                cashier={selectedShiftReceipt?.cashier}
                shift={selectedShiftReceipt?.shift}
                date={selectedDate}
                sales={selectedShiftReceipt?.sales || []}
                onClose={() => setSelectedShiftReceipt(null)}
            />
        </div>
    )
}

export default ManageCashiers
