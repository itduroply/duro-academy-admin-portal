import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function ProtectedRoute({ children, requiredScreen }) {
  const { loading, isAuthenticated, hasAccess } = useAuth()

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '3rem', color: '#4F46E5' }}></i>
        <p style={{ color: '#6B7280' }}>Verifying authentication...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Check screen-level permission
  if (requiredScreen && !hasAccess(requiredScreen)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export default ProtectedRoute
