import { useState } from 'react'
import { apiFetch, getApiUrl } from '../api'
import { auth } from '../firebase'
import logo from '../assets/atecles-grill-logo.jpg'

function TopBar({ role, view, totpSession, onNavigate, onOpenKitchen, onLogout }) {
    const [checkingVerification, setCheckingVerification] = useState(false)
    const [verificationMessage, setVerificationMessage] = useState('')
    const [emailVerified, setEmailVerified] = useState(false)
    const verificationLabel = emailVerified ? 'Email verified' : 'Email Verification'

    async function handleCheckVerification() {
        const user = auth.currentUser
        if (!user) {
            setVerificationMessage('Sign in again to confirm your email verification.')
            return
        }

        setCheckingVerification(true)
        setVerificationMessage('')
        setEmailVerified(false)
        try {
            await user.reload()
            const response = await apiFetch(getApiUrl('pos/email-verification'), {
                headers: { Accept: 'application/json', Authorization: `Bearer ${await user.getIdToken(true)}` },
            })
            if (auth.currentUser !== user) return
            if (response.status === 204) {
                setEmailVerified(true)
                return
            }
            const result = await response.json()
            setVerificationMessage(result.message || 'Could not confirm email verification. Try again.')
        } catch {
            if (auth.currentUser !== user) return
            setVerificationMessage('Could not confirm email verification. Try again.')
        } finally {
            setCheckingVerification(false)
        }
    }

    return (
        <div className="topbar">
            <div className="topbar-left">

                {/* Atecles Grill Logo */}
                <img
                    src={logo}
                    alt="Atecles Grill"
                    className="topbar-logo"
                />

                <span className="topbar-title">Atecles Grill</span>

                {role === 'admin' && (
                    <span className="topbar-badge">ADMIN</span>
                )}
            </div>

            <div className="topbar-right">
                {role === 'admin' && (
                    <>
                        <button
                            className={`topbar-btn ${view === 'dashboard' ? 'active' : ''
                                }`}
                            onClick={() => onNavigate('dashboard')}
                        >
                            Dashboard
                        </button>

                        <button
                            className={`topbar-btn ${view === 'manageMenu' ? 'active' : ''
                                }`}
                            onClick={() => onNavigate('manageMenu')}
                        >
                            Manage Menu
                        </button>

                        <button
                            className={`topbar-btn ${view === 'manageCashiers' ? 'active' : ''
                                }`}
                            onClick={() => onNavigate('manageCashiers')}
                        >
                            Manage Cashiers
                        </button>

                        <button
                            className="topbar-btn"
                            onClick={onOpenKitchen}
                        >
                            Kitchen Live View
                        </button>

                        <button
                            className={`topbar-btn ${view === 'auditLogs' ? 'active' : ''
                                }`}
                            onClick={() => onNavigate('auditLogs')}
                        >
                            Audit Logs
                        </button>

                        <button
                            type="button"
                            className={`topbar-btn ${view === 'administratorRequests' ? 'active' : ''}`}
                            onClick={() => onNavigate('administratorRequests')}
                        >
                            Administrator Requests
                        </button>

                        {!totpSession && (
                            <>
                                <button
                                    type="button"
                                    className="topbar-btn topbar-email-btn"
                                    disabled={checkingVerification}
                                    aria-label={verificationLabel}
                                    aria-busy={checkingVerification}
                                    title={checkingVerification ? 'Checking email verification…' : verificationLabel}
                                    onClick={handleCheckVerification}
                                >
                                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                                        stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"
                                        aria-hidden="true" focusable="false">
                                        <rect x="3" y="5" width="18" height="14" rx="2" />
                                        <path d="m4 7 8 6 8-6" />
                                        {emailVerified && (
                                            <>
                                                <circle cx="18.5" cy="17.5" r="4.5" fill="#15532d" />
                                                <path d="m16.5 17.5 1.4 1.4 2.7-2.7" strokeLinecap="round" />
                                            </>
                                        )}
                                    </svg>
                                </button>
                                <span role="status">{verificationMessage}</span>
                            </>
                        )}
                    </>
                )}

                <button
                    className="topbar-btn logout"
                    onClick={onLogout}
                >
                    Log Out
                </button>
            </div>
        </div>
    )
}

export default TopBar
