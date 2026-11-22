import { useState } from 'react'
import { signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, getApplicantAuth } from '../firebase'
import { apiFetch, getApiUrl } from '../api'
import { setTotpSession } from '../audit'

import logo from '../assets/atecles-grill-logo.jpg'
import background from '../assets/bg.jpg'

function LoginScreen({ onLogin }) {

    const [identifier, setIdentifier] = useState('')
    const [password, setPassword]     = useState('')
    const [loading, setLoading]       = useState(false)
    const [signInProgress, setSignInProgress] = useState('')
    const [step, setStep] = useState('')
    const [code, setCode] = useState('')
    const [enrollment, setEnrollment] = useState(null)
    const [approval, setApproval] = useState('')
    const [verificationMessage, setVerificationMessage] = useState('')
    const [canResend, setCanResend] = useState(false)
    const [registering, setRegistering] = useState(false)
    const [applicationStatus, setApplicationStatus] = useState('')

    // Detect role from what the user typed: admin email or cashier name.
    const isAdminInput = identifier.includes('@')

    async function createAdminAccount() {
        const registrationAuth = getApplicantAuth()
        try {
            const email = identifier.trim()
            let response = await apiFetch(getApiUrl('pos/administrator-registration'), {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            })
            let result = await response.json()
            if (result.code === 'firebase_account_exists') {
                const { user } = await signInWithEmailAndPassword(registrationAuth, email, password)
                await user.reload()
                const token = await user.getIdToken(true)
                response = await apiFetch(getApiUrl('pos/administrator-request'), {
                    method: 'POST',
                    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
                })
                result = await response.json()
            }
            setVerificationMessage(result.message || 'Could not create your account. Try again.')
            if (response.ok) {
                setRegistering(false)
                setCanResend(result.data.status === 'pending' && !result.data.email_verified)
                if (result.data.status !== 'approved') setApplicationStatus(result.data.status)
            }
        } catch {
            setVerificationMessage('Could not submit your request. Check your email and password and try again.')
        } finally {
            if (registrationAuth.currentUser) await signOut(registrationAuth)
        }
    }

    async function handleSubmit(e) {
        e.preventDefault()
        const resendVerification = e.nativeEvent.submitter?.value === 'resend-verification'

        if (registering && !/^[^\s@]+@gmail\.com$/i.test(identifier.trim())) {
            setVerificationMessage('Enter a Gmail address.')
            return
        }
        if (!identifier.trim() || !password) {
            alert(
                isAdminInput
                    ? 'Please enter your email and password.'
                    : 'Please enter your cashier username and password.'
            )
            return
        }

        setLoading(true)

        let signedInUser
        try {
            if (registering) {
                await createAdminAccount()
                return
            }
            setSignInProgress('Checking your sign-in…')
            const response = await apiFetch(getApiUrl('pos/login'), {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    identifier: identifier.trim(),
                    password,
                    ...(resendVerification ? { resendVerification: true } : {}),
                    ...(step === 'totp_required' ? { code } : {}),
                    ...(step === 'totp_enrollment_required' ? { enroll: 'start', approval } : {}),
                    ...(step === 'totp_enrolling' ? { enroll: 'finish', code, session: enrollment.session } : {}),
                }),
            })
            const result = await response.json()
            if (result.application_status === 'pending' || result.code === 'admin_request_pending' || result.code === 'admin_request_rejected') {
                setApplicationStatus(result.code === 'admin_request_rejected' ? 'rejected' : 'pending')
                setVerificationMessage(result.message)
                setCanResend(result.code === 'email_verification_required')
                return
            }
            if (resendVerification || result.code === 'email_verification_required') {
                setStep('')
                setCode('')
                setApproval('')
                setEnrollment(null)
                const alreadyVerified = result.code === 'email_already_verified'
                setVerificationMessage(alreadyVerified && applicationStatus
                    ? 'Your email is verified. Select Check Status to continue.'
                    : result.message || 'Verify your administrator email, then sign in again.')
                setCanResend(!alreadyVerified)
                return
            }
            if (response.ok && result.step) {
                let setup = null
                if (result.step === 'totp_enrolling') {
                    const issuer = 'Atecles Grill POS'
                    const label = encodeURIComponent(`${issuer}:Administrator`)
                    const parameters = new URLSearchParams({
                        secret: result.secret, issuer, algorithm: 'SHA1', digits: '6', period: String(result.period),
                    })
                    let qr = ''
                    try {
                        const { default: QRCode } = await import('qrcode')
                        qr = await QRCode.toDataURL(`otpauth://totp/${label}?${parameters}`)
                    } catch {
                        // The manual setup key is still available.
                    }
                    setup = { secret: result.secret, session: result.session, qr }
                }
                setStep(result.step === 'totp_enrolled' ? '' : result.step)
                setCode('')
                setApproval('')
                setEnrollment(setup)
                if (result.step === 'totp_enrolled') {
                    setPassword('')
                    alert('Authenticator enrolled. Sign in again with your password and a current code.')
                }
                return
            }
            if (!response.ok || !result.success) {
                setCode('')
                setApproval('')
                alert(result.message || 'Sign-in is temporarily unavailable.')
                return
            }

            const { token, uid, role, totp } = result.data
            if (role !== 'admin' && role !== 'cashier') {
                throw new Error('Unexpected POS role.')
            }
            if (totp === true && role === 'admin') {
                if (auth.currentUser) await signOut(auth)
                setTotpSession(token)
                onLogin('admin')
                return
            }
            setSignInProgress('Opening your Firebase session…')
            const { user } = await signInWithCustomToken(auth, token)
            signedInUser = user
            if (user.uid !== uid) {
                throw new Error('Unexpected Firebase identity.')
            }

            if (role === 'admin') {
                setSignInProgress('Verifying administrator access…')
                const idToken = await user.getIdToken()
                const access = await apiFetch(getApiUrl('pos/email-verification'), {
                    headers: { Accept: 'application/json', Authorization: `Bearer ${idToken}` },
                })
                if (access.status !== 204) {
                    const rejection = await access.json()
                    if (rejection.code !== 'email_verification_required') {
                        throw new Error('Administrator access could not be confirmed.')
                    }
                    await signOut(auth)
                    setVerificationMessage(rejection.message)
                    setCanResend(true)
                    return
                }
                onLogin('admin')
                return
            }

            let cashierProfile = result.data.cashierProfile
            if (!cashierProfile) {
                // Older API deployments return the profile through a separate endpoint.
                const idToken = await user.getIdToken()
                const profileResponse = await apiFetch(getApiUrl('cashier-profile'), {
                    headers: { Accept: 'application/json', Authorization: `Bearer ${idToken}` },
                })
                const profile = await profileResponse.json()
                if (!profileResponse.ok || !profile.success) {
                    throw new Error('Cashier profile unavailable.')
                }
                cashierProfile = profile.data
                // The legacy profile endpoint can update Firebase claims after sign-in.
                await user.getIdToken(true)
            }

            onLogin(
                'cashier',
                cashierProfile.cashierId || user.uid,
                cashierProfile.cashierUsername || identifier.trim(),
                cashierProfile.shift,
            )
        } catch {
            if (signedInUser && auth.currentUser === signedInUser) {
                await signOut(auth)
            }
            alert('Could not complete sign-in. Please try again.')
        } finally {
            setLoading(false)
            setSignInProgress('')
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
                        POINT OF SALE
                    </div>

                </div>
            </div>


            {/* ============================================
                RIGHT SIDE
            ============================================ */}

            <div className="login-right">
                {applicationStatus ? (
                    <form onSubmit={handleSubmit}>
                        <h2>{applicationStatus === 'rejected' ? 'Account Not Approved' : canResend ? 'Verify Your Email' : 'Waiting for Admin Approval'}</h2>
                        <p className="login-hint">{identifier}</p>
                        <p role="status">{verificationMessage}</p>
                        {applicationStatus === 'pending' && (
                            <>
                                <button type="submit" className="login-btn" disabled={loading}>{loading ? 'Checking…' : 'Check Status'}</button>
                                {canResend && <button type="submit" value="resend-verification" className="login-btn" disabled={loading}>Resend verification email</button>}
                            </>
                        )}
                        <button type="button" className="login-btn" disabled={loading} onClick={() => {
                            setApplicationStatus('')
                            setVerificationMessage('')
                            setCanResend(false)
                            setPassword('')
                        }}>Back to Sign In</button>
                    </form>
                ) : (
                <>

                <h2>
                    {registering ? 'Create Admin Account' : isAdminInput ? 'Admin Login' : 'Staff Login'}
                </h2>

                {!registering && <p className="login-hint">
                    {isAdminInput
                        ? 'Signing in as Administrator'
                        : 'Enter your email or cashier username to sign in'}
                </p>}

                <form onSubmit={handleSubmit}>

                    <label>
                        {registering ? 'GMAIL ADDRESS' : isAdminInput ? 'ADMIN EMAIL' : 'EMAIL / CASHIER USERNAME'}
                    </label>

                    <input
                        type={registering ? 'email' : 'text'}
                        placeholder={registering ? 'you@gmail.com' : 'Email or cashier username'}
                        value={identifier}
                        onChange={(e) => {
                            setIdentifier(e.target.value)
                            setVerificationMessage('')
                            setCanResend(false)
                        }}
                        disabled={loading || Boolean(step)}
                        autoComplete="username"
                        autoFocus
                    />

                    <label>PASSWORD</label>

                    <input
                        type="password"
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading || Boolean(step)}
                        autoComplete={registering ? 'new-password' : 'current-password'}
                        minLength={registering ? 8 : undefined}
                    />

                    {step === 'totp_enrollment_required' && (
                        <label>
                            ENROLLMENT APPROVAL FROM YOUR POS OPERATOR
                            <input type="password" autoComplete="off" pattern="[0-9a-f]{64}" maxLength={64}
                                required value={approval} disabled={loading}
                                onChange={(event) => setApproval(event.target.value)} />
                        </label>
                    )}
                    {step === 'totp_enrolling' && (
                        <div>
                            {enrollment.qr && <img src={enrollment.qr} alt="Scan with Google Authenticator" />}
                            <p>Manual setup key: <strong>{enrollment.secret}</strong></p>
                        </div>
                    )}
                    {(step === 'totp_required' || step === 'totp_enrolling') && (
                        <label>
                            AUTHENTICATOR CODE
                            <input type="text" inputMode="numeric" autoComplete="one-time-code"
                                pattern="[0-9]{6}" maxLength={6} required value={code}
                                disabled={loading} onChange={(event) => setCode(event.target.value)} />
                        </label>
                    )}
                    <button
                        type="submit"
                        className="login-btn"
                        disabled={loading}
                    >
                        {registering ? (loading ? 'Registering…' : 'Register') : (loading ? (signInProgress || 'Signing in…') : 'Sign In →')}
                    </button>

                    {(isAdminInput || registering) && verificationMessage && (
                        <>
                            <p role="status">{verificationMessage}</p>
                            {!step && !registering && canResend && (
                                <button type="submit" value="resend-verification" className="login-btn" disabled={loading}>
                                    Resend verification email
                                </button>
                            )}
                        </>
                    )}

                    {(isAdminInput || registering || !identifier.trim()) && !step && (
                        <button type="button" className={registering ? 'login-btn' : 'login-register-link'} disabled={loading} onClick={() => {
                            setRegistering(!registering)
                            setVerificationMessage('')
                            setCanResend(false)
                            setPassword('')
                        }}>{registering ? 'Back to Sign In' : 'Create Admin Account'}</button>
                    )}

                    {step && (
                        <button type="button" className="login-btn" disabled={loading} onClick={() => {
                            setStep('')
                            setCode('')
                            setApproval('')
                            setPassword('')
                            setEnrollment(null)
                        }}>Cancel</button>
                    )}
                </form>

                {!registering && <p className="login-footer">
                    {isAdminInput
                        ? 'Admin access is restricted to authorized personnel.'
                        : 'Having trouble? Contact your manager.'}
                </p>}
                </>
                )}

            </div>
        </div>
    )
}

export default LoginScreen
