import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ROLE_PERMISSIONS, ALLOWED_ROLES } from '../config/permissions'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [allowedScreens, setAllowedScreens] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    // Check initial session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        fetchUserRole(session.user.email)
      } else {
        setLoading(false)
      }
    })

    // Listen for auth state changes (sign in / sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        fetchUserRole(session.user.email)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setRole(null)
        setAllowedScreens(null)
        setIsAuthenticated(false)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchUserRole = async (email) => {
    try {
      setLoading(true)
      const { data: userData, error } = await supabase
        .from('users')
        .select('id, role, email, full_name')
        .eq('email', email)
        .single()

      if (error || !userData) {
        setIsAuthenticated(false)
        return
      }

      // Only allow admin and super_admin roles
      if (ALLOWED_ROLES.includes(userData.role)) {
        setUser(userData)
        setRole(userData.role)
        setIsAuthenticated(true)

        // For admin role, fetch DB-based permissions
        if (userData.role === 'admin') {
          await fetchAdminPermissions(userData.id)
        }
      } else {
        setIsAuthenticated(false)
        await supabase.auth.signOut()
      }
    } catch (error) {
      console.error('Error fetching user role:', error)
      setIsAuthenticated(false)
    } finally {
      setLoading(false)
    }
  }

  const fetchAdminPermissions = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('admin_permissions')
        .select('allowed_screens')
        .eq('user_id', userId)
        .single()

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching admin permissions:', error)
      }

      if (data && data.allowed_screens) {
        setAllowedScreens(data.allowed_screens)
      } else {
        // No DB permissions found — fall back to static config
        setAllowedScreens(null)
      }
    } catch (error) {
      console.error('Error fetching admin permissions:', error)
      setAllowedScreens(null)
    }
  }

  // Check if the current user has access to a specific screen
  const hasAccess = (screenKey) => {
    if (!role) return false
    if (role === 'super_admin') return true

    // If DB permissions exist for this admin, use them
    if (allowedScreens !== null) {
      return allowedScreens.includes(screenKey)
    }

    // Fallback to static config
    const permissions = ROLE_PERMISSIONS[role]
    if (!permissions) return false
    if (permissions === 'all') return true
    return permissions.includes(screenKey)
  }

  // Allow refreshing permissions (used after saving in AdminPermissions screen)
  const refreshPermissions = async () => {
    if (user && role === 'admin') {
      await fetchAdminPermissions(user.id)
    }
  }

  const value = {
    user,
    role,
    loading,
    isAuthenticated,
    hasAccess,
    refreshPermissions,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext
