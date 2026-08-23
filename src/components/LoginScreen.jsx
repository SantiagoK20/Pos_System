import { useState } from 'react'
import logo from '../assets/logo.png'
import background from '../assets/bg.jpg'

function LoginScreen({ onLogin }) {
    const [employeeId, setEmployeeId] = useState('')
    const [password, setPassword] = useState('')

    function handleSubmit(e) {
        e.preventDefault()

        if (!employeeId || !password) {
            alert('Please enter employee ID and password')
            return
        }

        // Typing "admin" as Employee ID logs in as Administrator.
        // Anything else logs in as a regular Cashier.
        const role =
            employeeId.trim().toLowerCase() === 'admin'
                ? 'admin'
                : 'cashier'

        onLogin(role)
    }

    return (
        <div className="login-page">

            {/* LEFT SIDE */}
            <div className="login-left">

                {/* Background Image */}
                <img
                    src={background}
                    alt="Atecles Grill"
                    className="login-background"
                />

                {/* Dark overlay + content */}
                <div className="login-left-overlay">

                    {/* Logo */}
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

            {/* RIGHT SIDE */}
            <div className="login-right">

                <h2>Welcome back</h2>

                <p className="login-hint">
                    Sign in to access the POS system
                </p>

                <form onSubmit={handleSubmit}>

                    <label>EMPLOYEE ID</label>

                    <input
                        type="text"
                        placeholder="Enter employee ID"
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value)}
                    />

                    <label>PASSWORD</label>

                    <input
                        type="password"
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />

                    <button
                        type="submit"
                        className="login-btn"
                    >
                        Sign In →
                    </button>

                </form>

                <p
                    className="login-hint"
                    style={{
                        marginTop: 16,
                        fontSize: '0.75em'
                    }}
                >
                    Tip: type <b>admin</b> as the Employee ID
                    to sign in as Administrator.
                </p>

                <p className="login-footer">
                    Having trouble? Contact your manager
                </p>

            </div>
        </div>
    )
}

export default LoginScreen