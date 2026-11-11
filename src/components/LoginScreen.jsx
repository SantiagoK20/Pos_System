import { useState } from 'react'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../firebase'

import logo from '../assets/atecles-grill-logo.jpg'
import background from '../assets/bg.jpg'

async function getCashierEmail(name) {
    const normalizedName = name.trim().toLowerCase()
    const bytes = new TextEncoder().encode(normalizedName)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
    ).join('').slice(0, 56)

    return `cashier-${hash}@cashier.atecles-pos.com`
}

function LoginScreen({ onLogin }) {

    const [identifier, setIdentifier] = useState('')
    const [password, setPassword]     = useState('')
    const [loading, setLoading]       = useState(false)

    // Detect role from what the user typed: admin email or cashier name.
    const isAdminInput = identifier.includes('@')

    async function handleSubmit(e) {
        e.preventDefault()

        if (!identifier.trim() || !password) {
            alert(
                isAdminInput
                    ? 'Please enter your email and password.'
                    : 'Please enter your cashier username and password.'
            )
            return
        }

        setLoading(true)

        try {

            let email

            if (isAdminInput) {
                // Admin — use the email directly
                email = identifier.trim()
            } else {
                email = await getCashierEmail(identifier)
            }

            let userCredential
            try {
                userCredential = await signInWithEmailAndPassword(auth, email, password)
            } catch (error) {
                if (
                    isAdminInput ||
                    !['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(error.code)
                ) {
                    throw error
                }

                // Older cashier accounts used their ID as the internal email prefix.
                const legacyEmail = `${identifier.trim().toLowerCase()}@atecles-pos.local`
                userCredential = await signInWithEmailAndPassword(auth, legacyEmail, password)
            }

            const user = userCredential.user

            // Route based on email format
            if (isAdminInput) {
                console.log('Admin logged in:', user.email)
                onLogin('admin')
            } else {
                const idToken = await user.getIdToken()
                const apiBaseUrl = window.location.protocol === 'file:'
                    ? 'http://127.0.0.1:8001'
                    : ''
                const response = await fetch(`${apiBaseUrl}/api/cashier-profile`, {
                    headers: {
                        Accept: 'application/json',
                        Authorization: `Bearer ${idToken}`,
                    },
                })
                const result = await response.json()

                if (!response.ok || !result.success) {
                    throw new Error(result.message || 'Could not load cashier profile.')
                }

                const cashierUsername = result.data.cashierUsername || identifier.trim()
                console.log('Cashier logged in:', cashierUsername)
                onLogin('cashier', cashierUsername, result.data.shift)
            }

        } catch (error) {

            console.error('Login error:', error)

            if (error.code === undefined) {
                await signOut(auth)
                alert(error.message)
            } else if (
                error.code === 'auth/invalid-credential' ||
                error.code === 'auth/wrong-password'     ||
                error.code === 'auth/user-not-found'
            ) {
                alert(
                    isAdminInput
                        ? 'Invalid email or password.'
                        : 'Invalid cashier username or password.'
                )
            } else if (error.code === 'auth/too-many-requests') {
                alert('Too many login attempts. Please try again later.')
            } else if (error.code === 'auth/invalid-email') {
                alert('Invalid email address.')
            } else {
                alert('Login failed.\n\n' + error.message)
            }

        } finally {
            setLoading(false)
        }
    }


    return (
        <div className="login-page">

            {/* ============================================
                LEFT SIDE
            ============================================ */}

            <div className="login-left">

                <img
                    src={background}
                    alt="Atecles Grill"
                    className="login-background"
                />

                <div className="login-left-overlay">

                    <img
                        src={logo}
                        alt="Atecles Grill Logo"
                        className="login-logo"
                    />

                    <h1 className="login-title">
                        Atecles Grill
                    </h1>

                    <p className="login-subtitle">
                        Serving the best food in town
                    </p>

                    <div className="login-badge">
                        POINT OF SALE SYSTEM
                    </div>

                </div>
            </div>


            {/* ============================================
                RIGHT SIDE
            ============================================ */}

            <div className="login-right">

                <h2>
                    {isAdminInput ? 'Admin Login' : 'Staff Login'}
                </h2>

                <p className="login-hint">
                    {isAdminInput
                        ? 'Signing in as Administrator'
                        : 'Enter your email or cashier username to sign in'}
                </p>

                <form onSubmit={handleSubmit}>

                    <label>
                        {isAdminInput ? 'ADMIN EMAIL' : 'EMAIL / CASHIER USERNAME'}
                    </label>

                    <input
                        type="text"
                        placeholder="Email or cashier username"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        disabled={loading}
                        autoComplete="username"
                        autoFocus
                    />

                    <label>PASSWORD</label>

                    <input
                        type="password"
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading}
                        autoComplete="current-password"
                    />

                    <button
                        type="submit"
                        className="login-btn"
                        disabled={loading}
                    >
                        {loading ? 'Signing In...' : 'Sign In →'}
                    </button>

                </form>

                <p className="login-footer">
                    {isAdminInput
                        ? 'Admin access is restricted to authorized personnel.'
                        : 'Having trouble? Contact your manager.'}
                </p>

            </div>
        </div>
    )
}

export default LoginScreen
