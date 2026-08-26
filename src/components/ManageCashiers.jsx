import { getAuth } from 'firebase/auth'
import { useState } from 'react'

function ManageCashiers() {

    const [cashierId, setCashierId] = useState('')
    const [cashierPassword, setCashierPassword] = useState('')
    const [cashierConfirmPassword, setCashierConfirmPassword] = useState('')
    const [creatingCashier, setCreatingCashier] = useState(false)

    async function handleCreateCashier(e) {
        e.preventDefault()

        const cleanCashierId = cashierId.trim().toUpperCase()

        if (!cleanCashierId) {
            alert('Please enter a Cashier ID.')
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

            const response = await fetch('/api/cashiers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    cashierId: cleanCashierId,
                    password: cashierPassword,
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
                throw new Error(result.message || 'Failed to create cashier account.')
            }

            alert(`Cashier account "${cleanCashierId}" created successfully!`)

            setCashierId('')
            setCashierPassword('')
            setCashierConfirmPassword('')

        } catch (error) {
            console.error('Create cashier error:', error)
            alert('Failed to create cashier account.\n\n' + error.message)
        } finally {
            setCreatingCashier(false)
        }
    }

    return (
        <div className="cashiers-page fade-in">

            {/* Header */}
            <div className="cashiers-header">
                <h1 className="cashiers-title">Manage Cashiers</h1>
                <p className="cashiers-subtitle">
                    Create cashier accounts for your staff. Only administrators can perform this action.
                </p>
            </div>

            {/* Card */}
            <div className="cashiers-card">

                <div className="cashiers-card-icon">👤</div>
                <h2 className="cashiers-card-title">New Cashier Account</h2>
                <p className="cashiers-card-desc">
                    Fill in the details below to create a new cashier login.
                </p>

                <form onSubmit={handleCreateCashier} className="cashiers-form">

                    <div className="cashiers-field">
                        <label className="cashiers-label" htmlFor="cashier-id">
                            Cashier ID
                        </label>
                        <input
                            id="cashier-id"
                            type="text"
                            className="cashiers-input"
                            placeholder="e.g. C001"
                            value={cashierId}
                            onChange={(e) => setCashierId(e.target.value)}
                            disabled={creatingCashier}
                        />
                    </div>

                    <div className="cashiers-field">
                        <label className="cashiers-label" htmlFor="cashier-password">
                            Password
                        </label>
                        <input
                            id="cashier-password"
                            type="password"
                            className="cashiers-input"
                            placeholder="Minimum 6 characters"
                            value={cashierPassword}
                            onChange={(e) => setCashierPassword(e.target.value)}
                            disabled={creatingCashier}
                        />
                    </div>

                    <div className="cashiers-field">
                        <label className="cashiers-label" htmlFor="cashier-confirm">
                            Confirm Password
                        </label>
                        <input
                            id="cashier-confirm"
                            type="password"
                            className="cashiers-input"
                            placeholder="Re-enter password"
                            value={cashierConfirmPassword}
                            onChange={(e) => setCashierConfirmPassword(e.target.value)}
                            disabled={creatingCashier}
                        />
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
            </div>

        </div>
    )
}

export default ManageCashiers
