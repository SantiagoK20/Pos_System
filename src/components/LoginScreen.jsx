import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'

import logo from '../assets/logo.png'
import background from '../assets/bg.jpg'

function LoginScreen({ onLogin }) {

    const [identifier, setIdentifier] = useState('')
    const [password, setPassword]     = useState('')
    const [loading, setLoading]       = useState(false)

    // Detect role from what the user typed:
    //   contains "@"  →  admin email
    //   no "@"        →  cashier ID  (e.g. C001)
    const isAdminInput = identifier.includes('@')

    async function handleSubmit(e) {
        e.preventDefault()

        if (!identifier.trim() || !password) {
            alert(
                isAdminInput
                    ? 'Please enter your email and password.'
                    : 'Please enter your Cashier ID and password.'
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
                // Cashier — convert ID to internal Firebase email
                // C001  →  c001@atecles-pos.local
                email =
                    identifier.trim().toLowerCase() +
                    '@atecles-pos.local'
            }

            const userCredential =
                await signInWithEmailAndPassword(auth, email, password)

            const user = userCredential.user

            // Route based on email format
            if (isAdminInput) {
                console.log('Admin logged in:', user.email)
                onLogin('admin')
            } else {
                console.log('Cashier logged in:', user.uid)
                onLogin('cashier')
            }

        } catch (error) {

            console.error('Login error:', error)

            if (
                error.code === 'auth/invalid-credential' ||
                error.code === 'auth/wrong-password'     ||
                error.code === 'auth/user-not-found'
            ) {
                alert(
                    isAdminInput
                        ? 'Invalid email or password.'
                        : 'Invalid Cashier ID or password.'
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
                        : 'Enter your email or Cashier ID to sign in'}
                </p>

                <form onSubmit={handleSubmit}>

                    <label>
                        {isAdminInput ? 'ADMIN EMAIL' : 'EMAIL / CASHIER ID'}
                    </label>

                    <input
                        type="text"
                        placeholder="Email or Cashier ID (e.g. C001)"
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
