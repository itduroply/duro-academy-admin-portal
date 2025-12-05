import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

function ProtectedRoute({ children }) {
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      // Check if user is logged in
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        setIsAuthenticated(false)
        setLoading(false)
        return
      }

      // Check if user has admin role
      const { data: userData, error } = await supabase
        .from('users')
        .select('role')
        .eq('email', session.user.email)
        .single()

      if (error || !userData) {
        console.error('Error fetching user role:', error)
        setIsAuthenticated(false)
        setLoading(false)
        return
      }

      if (userData.role === 'admin') {
        setIsAuthenticated(true)
        setIsAdmin(true)
      } else {
        setIsAuthenticated(false)
        // Sign out non-admin users
        await supabase.auth.signOut()
      }
    } catch (error) {
      console.error('Auth check error:', error)
      setIsAuthenticated(false)
    } finally {
      setLoading(false)
    }
  }

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

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/login" replace />
  }

  return children
}

export default ProtectedRoute
