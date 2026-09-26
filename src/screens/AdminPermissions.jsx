import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { NAV_ITEMS, SCREENS } from '../config/permissions'
import { useNotification } from '../contexts/NotificationContext'
import './AdminPermissions.css'

// All manageable screens (exclude admin-permissions itself — super_admin only)
const MANAGEABLE_SCREENS = NAV_ITEMS.filter(
  item => item.screen !== SCREENS.ADMIN_PERMISSIONS
)

const PERMISSION_ACTIONS = ['view', 'edit', 'delete']

const getDefaultActionPermissions = (allowedScreens = []) => {
  const allowed = Array.isArray(allowedScreens) ? allowedScreens : []
  return MANAGEABLE_SCREENS.reduce((accumulator, item) => {
    const granted = allowed.includes(item.screen)
    accumulator[item.screen] = {
      view: granted,
      edit: granted,
      delete: granted,
    }
    return accumulator
  }, {})
}

const normalizeActionPermissions = (rawPermissions, allowedScreens = []) => {
  const fallback = getDefaultActionPermissions(allowedScreens)
  if (!rawPermissions || typeof rawPermissions !== 'object' || Array.isArray(rawPermissions)) {
    return fallback
  }

  const normalized = { ...fallback }

  MANAGEABLE_SCREENS.forEach(({ screen }) => {
    const screenPermissions = rawPermissions[screen]
    if (!screenPermissions || typeof screenPermissions !== 'object' || Array.isArray(screenPermissions)) {
      return
    }

    normalized[screen] = {
      view: typeof screenPermissions.view === 'boolean' ? screenPermissions.view : fallback[screen].view,
      edit: typeof screenPermissions.edit === 'boolean' ? screenPermissions.edit : fallback[screen].edit,
      delete: typeof screenPermissions.delete === 'boolean' ? screenPermissions.delete : fallback[screen].delete,
    }
  })

  return normalized
}

const isMissingActionPermissionsColumnError = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return error?.code === '42703' || error?.code === 'PGRST204' || message.includes('action_permissions')
}

function AdminPermissions() {
  const mountedRef = useRef(true)
  const { showNotification } = useNotification()
  const { user: currentUser } = useAuth()
  const [admins, setAdmins] = useState([])
  const [selectedAdmin, setSelectedAdmin] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [actionPermissions, setActionPermissions] = useState(() => getDefaultActionPermissions([]))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    fetchAdmins()
    return () => { mountedRef.current = false }
  }, [])

  const fetchAdmins = async () => {
    try {
      setLoading(true)
      // Fetch all users with admin role (not super_admin, not regular users)
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, role')
        .eq('role', 'admin')
        .order('full_name', { ascending: true })

      if (error) throw error
      if (mountedRef.current) {
        setAdmins(data || [])
      }
    } catch (error) {
      console.error('Error fetching admins:', error)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const selectAdmin = async (admin) => {
    setSelectedAdmin(admin)
    setSaveSuccess(false)
    try {
      // Fetch existing permissions for this admin.
      // Fallback keeps compatibility when action_permissions column is not yet migrated.
      let { data, error } = await supabase
        .from('admin_permissions')
        .select('allowed_screens, action_permissions')
        .eq('user_id', admin.id)
        .maybeSingle()

      if (error && isMissingActionPermissionsColumnError(error)) {
        const fallbackResult = await supabase
          .from('admin_permissions')
          .select('allowed_screens')
          .eq('user_id', admin.id)
          .maybeSingle()

        data = fallbackResult.data
        error = fallbackResult.error
      }

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found (new admin, no permissions yet)
        throw error
      }

      if (data && data.allowed_screens) {
        const allowedScreens = Array.isArray(data.allowed_screens) ? data.allowed_screens : []
        setPermissions(allowedScreens)
        setActionPermissions(normalizeActionPermissions(data.action_permissions, allowedScreens))
      } else {
        // Default: no permissions for new admin
        setPermissions([])
        setActionPermissions(getDefaultActionPermissions([]))
      }
    } catch (error) {
      console.error('Error fetching permissions:', error)
      setPermissions([])
      setActionPermissions(getDefaultActionPermissions([]))
    }
  }

  const togglePermission = (screenKey) => {
    const hasPermission = permissions.includes(screenKey)
    const nextPermissions = hasPermission
      ? permissions.filter(screen => screen !== screenKey)
      : [...permissions, screenKey]

    setPermissions(nextPermissions)
    setActionPermissions(prev => {
      const current = prev[screenKey] || { view: false, edit: false, delete: false }
      return {
        ...prev,
        [screenKey]: hasPermission
          ? { view: false, edit: false, delete: false }
          : { view: true, edit: current.edit, delete: current.delete }
      }
    })
    setSaveSuccess(false)
  }

  const toggleActionPermission = (screenKey, action) => {
    setActionPermissions(prev => {
      const current = prev[screenKey] || { view: false, edit: false, delete: false }
      const nextValue = !current[action]
      let nextForScreen = { ...current, [action]: nextValue }

      if (action === 'view') {
        if (!nextValue) {
          nextForScreen = { view: false, edit: false, delete: false }
          setPermissions(prevScreens => prevScreens.filter(screen => screen !== screenKey))
        } else {
          setPermissions(prevScreens => (prevScreens.includes(screenKey)
            ? prevScreens
            : [...prevScreens, screenKey]))
        }
      }

      if ((action === 'edit' || action === 'delete') && nextValue) {
        nextForScreen.view = true
        setPermissions(prevScreens => (prevScreens.includes(screenKey)
          ? prevScreens
          : [...prevScreens, screenKey]))
      }

      return {
        ...prev,
        [screenKey]: nextForScreen
      }
    })
    setSaveSuccess(false)
  }

  const selectAll = () => {
    const allScreens = MANAGEABLE_SCREENS.map(item => item.screen)
    setPermissions(allScreens)
    setActionPermissions(getDefaultActionPermissions(allScreens))
    setSaveSuccess(false)
  }

  const deselectAll = () => {
    setPermissions([])
    setActionPermissions(getDefaultActionPermissions([]))
    setSaveSuccess(false)
  }

  const savePermissions = async () => {
    if (!selectedAdmin) return
    try {
      setSaving(true)

      // Upsert: insert if not exists, update if exists
      let { error } = await supabase
        .from('admin_permissions')
        .upsert(
          {
            user_id: selectedAdmin.id,
            allowed_screens: permissions,
            action_permissions: actionPermissions,
            updated_by: currentUser?.id || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )

      if (error && isMissingActionPermissionsColumnError(error)) {
        const retryResult = await supabase
          .from('admin_permissions')
          .upsert(
            {
              user_id: selectedAdmin.id,
              allowed_screens: permissions,
              updated_by: currentUser?.id || null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          )

        error = retryResult.error
      }

      if (error) throw error

      if (mountedRef.current) {
        setSaveSuccess(true)
        setTimeout(() => {
          if (mountedRef.current) setSaveSuccess(false)
        }, 3000)
      }
    } catch (error) {
      console.error('Error saving permissions:', error)
      showNotification('Failed to save permissions: ' + error.message, 'error')
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const filteredAdmins = admins.filter(admin => {
    const query = searchQuery.toLowerCase()
    return (
      (admin.full_name || '').toLowerCase().includes(query) ||
      (admin.email || '').toLowerCase().includes(query)
    )
  })

  const breadcrumbItems = [
    { label: 'Home', link: true },
    { label: 'Admin Permissions', link: false }
  ]

  return (
        <div className="ap-content">
          {/* Left Panel: Admin List */}
          <div className="ap-admin-list-panel">
            <div className="ap-panel-header">
              <h2>Admin Users</h2>
              <span className="ap-count-badge">{admins.length}</span>
            </div>
            <div className="ap-search-box">
              <i className="fa-solid fa-search"></i>
              <input
                type="text"
                placeholder="Search admins..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="ap-admin-list">
              {loading ? (
                <div className="ap-loading">
                  <i className="fa-solid fa-spinner fa-spin"></i>
                  <span>Loading admins...</span>
                </div>
              ) : filteredAdmins.length === 0 ? (
                <div className="ap-empty">
                  <i className="fa-solid fa-user-slash"></i>
                  <span>No admin users found</span>
                </div>
              ) : (
                filteredAdmins.map(admin => (
                  <div
                    key={admin.id}
                    className={`ap-admin-card ${selectedAdmin?.id === admin.id ? 'selected' : ''}`}
                    onClick={() => selectAdmin(admin)}
                  >
                    <div className="ap-admin-avatar">
                      {(admin.full_name || admin.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="ap-admin-info">
                      <span className="ap-admin-name">{admin.full_name || 'Unnamed'}</span>
                      <span className="ap-admin-email">{admin.email}</span>
                    </div>
                    <i className="fa-solid fa-chevron-right ap-chevron"></i>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Panel: Permission Manager */}
          <div className="ap-permission-panel">
            {!selectedAdmin ? (
              <div className="ap-no-selection">
                <i className="fa-solid fa-shield-halved"></i>
                <h3>Select an Admin</h3>
                <p>Choose an admin from the list to manage their screen permissions</p>
              </div>
            ) : (
              <>
                <div className="ap-permission-header">
                  <div className="ap-selected-admin">
                    <div className="ap-admin-avatar large">
                      {(selectedAdmin.full_name || selectedAdmin.email || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <h3>{selectedAdmin.full_name || 'Unnamed'}</h3>
                      <span>{selectedAdmin.email}</span>
                    </div>
                  </div>
                  <div className="ap-header-actions">
                    <button className="ap-btn-secondary" onClick={selectAll}>
                      <i className="fa-solid fa-check-double"></i>
                      Select All
                    </button>
                    <button className="ap-btn-secondary" onClick={deselectAll}>
                      <i className="fa-solid fa-xmark"></i>
                      Deselect All
                    </button>
                  </div>
                </div>

                <div className="ap-permission-grid">
                  {MANAGEABLE_SCREENS.map(item => {
                    const isGranted = permissions.includes(item.screen)
                    const screenActions = actionPermissions[item.screen] || { view: false, edit: false, delete: false }
                    return (
                      <div
                        key={item.screen}
                        className={`ap-permission-card ${isGranted ? 'granted' : 'denied'}`}
                        onClick={() => togglePermission(item.screen)}
                      >
                        <div className="ap-perm-icon">
                          <i className={item.icon}></i>
                        </div>
                        <span className="ap-perm-label">{item.label}</span>
                        <div className="ap-perm-actions" onClick={(e) => e.stopPropagation()}>
                          {PERMISSION_ACTIONS.map(action => {
                            const isEnabled = Boolean(screenActions[action])
                            return (
                              <button
                                type="button"
                                key={`${item.screen}-${action}`}
                                className={`ap-action-chip ${isEnabled ? 'enabled' : 'disabled'}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleActionPermission(item.screen, action)
                                }}
                                title={`${action.charAt(0).toUpperCase()}${action.slice(1)} permission`}
                              >
                                {action.charAt(0).toUpperCase()}
                              </button>
                            )
                          })}
                        </div>
                        <div className={`ap-toggle ${isGranted ? 'on' : 'off'}`}>
                          <div className="ap-toggle-knob"></div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="ap-permission-footer">
                  <div className="ap-perm-summary">
                    <span>
                      <strong>{permissions.length}</strong> of {MANAGEABLE_SCREENS.length} screens enabled
                    </span>
                  </div>
                  <div className="ap-footer-actions">
                    {saveSuccess && (
                      <span className="ap-save-success">
                        <i className="fa-solid fa-check-circle"></i>
                        Permissions saved successfully!
                      </span>
                    )}
                    <button
                      className="ap-btn-primary"
                      onClick={savePermissions}
                      disabled={saving}
                    >
                      {saving ? (
                        <>
                          <i className="fa-solid fa-spinner fa-spin"></i>
                          Saving...
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-floppy-disk"></i>
                          Save Permissions
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
  )
}

export default AdminPermissions
