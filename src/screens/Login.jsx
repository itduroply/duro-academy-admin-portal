import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { getDefaultRouteForScreens, ROLE_PERMISSIONS } from '../config/permissions'
import { useAuth } from '../contexts/AuthContext'
import { requestOTP, verifyOTP, resendOTP } from '../services/otpService'
import './Login.css'

function Login() {
  // Step 1: Email only
  const [email, setEmail] = useState('')

  // Step 2: OTP Verification
  const [otp, setOtp] = useState('')
  const [otpTimer, setOtpTimer] = useState(0)
  const [otpResendCount, setOtpResendCount] = useState(0)
  const [userId, setUserId] = useState(null) // Store user ID for OTP functions

  // Form state
  const [step, setStep] = useState(1) // 1: Email & Password, 2: OTP
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const navigate = useNavigate()
  const { refreshPermissions } = useAuth()

  // OTP Timer effect
  useEffect(() => {
    if (otpTimer > 0) {
      const timer = setTimeout(() => setOtpTimer(otpTimer - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [otpTimer])

  // Step 1: Request OTP after password verification
  const handleStep1Submit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    setLoading(true)

    try {
      const normalizedEmail = email.trim().toLowerCase()

      const { data: userRecord, error: userRecordError } = await supabase
        .from('users')
        .select('id')
        .eq('email', normalizedEmail)
        .maybeSingle()

      if (userRecordError) throw userRecordError
      if (!userRecord?.id) {
        throw new Error('No admin account found for this email.')
      }

      await requestOTP(normalizedEmail, userRecord.id)

      setUserId(userRecord.id)
      setSuccessMessage(`OTP sent to ${normalizedEmail}`)
      setStep(2)
      setOtp('')
      setOtpTimer(600)
      setOtpResendCount(0)
    } catch (error) {
      console.error('Login step 1 error:', error)
      setError(error.message || 'Unable to send OTP. Please try again.')
      await supabase.auth.signOut().catch(() => {})
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Verify OTP and complete login
  const handleStep2Submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const normalizedEmail = email.trim().toLowerCase()

      const result = await verifyOTP(normalizedEmail, otp)
      if (!result?.success || !result?.session) {
        throw new Error('OTP verification failed. Please try again.')
      }

      const { data: userRecord, error: userRecordError } = await supabase
        .from('users')
        .select('id, role, email')
        .eq('email', normalizedEmail)
        .single()

      if (userRecordError) throw userRecordError

      let defaultRoute = '/dashboard'
      if (userRecord?.role === 'admin') {
        const { data: permissionsData, error: permissionsError } = await supabase
          .from('admin_permissions')
          .select('allowed_screens')
          .eq('user_id', userRecord.id)
          .maybeSingle()

        if (permissionsError && permissionsError.code !== 'PGRST116') throw permissionsError

        const allowedScreens = Array.isArray(permissionsData?.allowed_screens)
          ? permissionsData.allowed_screens
          : ROLE_PERMISSIONS.admin

        defaultRoute = getDefaultRouteForScreens(allowedScreens, userRecord.role)
        await refreshPermissions()
      } else if (userRecord?.role === 'super_admin') {
        defaultRoute = '/dashboard'
      }

      navigate(defaultRoute)
    } catch (error) {
      console.error('OTP verification error:', error)
      setError(error.message || 'Invalid OTP')
    } finally {
      setLoading(false)
    }
  }

  // Handle resend OTP
  const handleResendOTP = async () => {
    setError('')
    setSuccessMessage('')
    setLoading(true)

    try {
      if (otpResendCount >= 3) {
        throw new Error('Maximum resend attempts reached. Please try again later.')
      }

      await resendOTP(email, userId)
      setSuccessMessage('OTP resent successfully')
      setOtp('')
      setOtpTimer(600) // 10 minutes
      setOtpResendCount(otpResendCount + 1)
    } catch (error) {
      console.error('Resend OTP error:', error)
      setError(error.message || 'Failed to resend OTP')
    } finally {
      setLoading(false)
    }
  }

  // Handle go back to step 1
  const handleBackToStep1 = async () => {
    setStep(1)
    setOtp('')
    setOtpTimer(0)
    setError('')
    setSuccessMessage('')
    setUserId(null) // Clear user ID
    // Sign out from the partial session
    await supabase.auth.signOut().catch(() => {})
  }

  const formatOtpTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="login-page">
      {/* ================================================= left: sign-in */}
      <section className="auth-pane">
        <div className="pane-blobs" aria-hidden="true">
          <span className="blob blob-a"></span>
          <span className="blob blob-b"></span>
          <span className="blob blob-c"></span>
        </div>

        <div className="auth-inner">
          <img
            src="/duro-academy-logo.png"
            alt="Duro Academy"
            className="auth-logo"
          />

          <h1 className="auth-title">
            Welcome back <span className="wave" aria-hidden="true">&#128075;</span>
          </h1>
          <p className="auth-sub">
            Sign in to continue your learning journey
            <br />and make a bigger impact.
          </p>

          {error && (
            <div className="form-alert error-alert" role="alert">
              <i className="fa-solid fa-circle-exclamation"></i>
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="form-alert success-alert" role="status">
              <i className="fa-solid fa-circle-check"></i>
              <span>{successMessage}</span>
            </div>
          )}

          {step === 1 && (
            <form className="login-form" onSubmit={handleStep1Submit}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <i className="fa-regular fa-envelope"></i>
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={loading}
                  />
                </div>
              </div>

              <button type="submit" className="login-button" disabled={loading}>
                {loading ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Sending OTP...
                  </>
                ) : (
                  <>Continue <i className="fa-solid fa-arrow-right"></i></>
                )}
              </button>
            </form>
          )}

          {step === 2 && (
            <form className="login-form otp-form" onSubmit={handleStep2Submit}>
              <div className="otp-header">
                <h2>Verify your identity</h2>
                <p>Enter the 6-digit code sent to <strong>{email}</strong></p>
              </div>

              <div className="form-group">
                <label htmlFor="otp">Enter OTP</label>
                <div className="input-wrapper otp-input-wrapper">
                  <span className="input-icon">
                    <i className="fa-solid fa-key"></i>
                  </span>
                  <input
                    id="otp"
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength="6"
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    disabled={loading}
                  />
                </div>
                <div className="otp-expiry">Expires in <strong>{formatOtpTimer(otpTimer)}</strong></div>
              </div>

              <button type="submit" className="login-button" disabled={loading || otp.length !== 6}>
                {loading ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Verifying...
                  </>
                ) : (
                  <>Verify &amp; Sign In <i className="fa-solid fa-arrow-right"></i></>
                )}
              </button>

              <div className="otp-actions">
                <button type="button" className="text-link" onClick={handleResendOTP} disabled={loading || otpTimer > 540}>
                  Resend OTP {otpResendCount > 0 && `(${otpResendCount}/3)`}
                </button>
                <span className="otp-separator">&middot;</span>
                <button type="button" className="text-link" onClick={handleBackToStep1} disabled={loading}>
                  Change email
                </button>
              </div>
            </form>
          )}

          <p className="auth-secure">
            <i className="fa-solid fa-shield-halved"></i>
            Secure login. Your data is protected.
          </p>

          <div className="auth-foot-tag">
            <span>Learn</span>
            <span className="dot">&middot;</span>
            <span>Grow</span>
            <span className="dot">&middot;</span>
            <span>Perform</span>
            <span className="dot">&middot;</span>
            <span>Together</span>
          </div>
        </div>
      </section>

      {/* ============================================== right: showcase */}
      <section className="auth-showcase" aria-hidden="true">
        <div className="showcase-card">
          <div className="showcase-scene"></div>
          <div className="showcase-veil"></div>

          <div className="showcase-copy">
            <div className="showcase-eyebrow">
              <span>Learn</span>
              <i>|</i>
              <span>Grow</span>
              <i>|</i>
              <span>Perform</span>
            </div>

            <h2 className="showcase-title">
              Unlock Your
              <br />Team&rsquo;s <em>Potential</em>
            </h2>

            <p className="showcase-sub">
              Engaging learning experiences for a
              <br />stronger, smarter, future-ready team.
            </p>

            <ul className="showcase-chips">
              <li>
                <i className="fa-solid fa-graduation-cap chip-icon chip-icon-red"></i>
                <span>Learn<br />Anytime</span>
              </li>
              <li>
                <i className="fa-solid fa-chart-simple chip-icon chip-icon-amber"></i>
                <span>Track<br />Progress</span>
              </li>
              <li>
                <i className="fa-solid fa-user-group chip-icon chip-icon-blue"></i>
                <span>Build<br />a Stronger Team</span>
              </li>
            </ul>
          </div>

        </div>
      </section>
    </div>
  )
}

export default Login
