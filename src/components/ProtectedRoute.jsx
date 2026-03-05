import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function ProtectedRoute({ children, requiredScreen }) {
  const { isAuthenticated, hasAccess } = useAuth()

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
