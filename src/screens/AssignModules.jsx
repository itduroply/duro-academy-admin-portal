import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { cachedFetch, cacheDelete, TTL } from '../utils/cacheDB'
import './AssignModules.css'

function AssignModules() {
  const mountedRef = useRef(true)
  const [loading, setLoading] = useState(true)
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [users, setUsers] = useState([])
  const [modules, setModules] = useState([])
  const [assignments, setAssignments] = useState([])
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedModules, setSelectedModules] = useState([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [userFilter, setUserFilter] = useState('All Users')
  const [error, setError] = useState(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [selectedUserDetail, setSelectedUserDetail] = useState(null)

  const breadcrumbItems = [
    { label: 'Home', link: true },
    { label: 'Assign Modules', link: false }
  ]

  useEffect(() => {
    mountedRef.current = true
    fetchAllData()
    return () => { mountedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchAllData = async () => {
    try {
      setLoading(true)
      setError(null)
      await Promise.all([fetchUsers(), fetchModules(), fetchAssignments()])
    } catch (err) {
      console.error('Error fetching data:', err)
      if (mountedRef.current) setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const { data } = await cachedFetch('users_assign_modules', async () => {
        const { data, error } = await supabase
          .from('users')
          .select('id, full_name, email, employee_id, role')
          .order('full_name', { ascending: true })
        if (error) throw error
        return data || []
      }, TTL.SHORT)

      if (mountedRef.current) {
        setUsers(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
      throw error
    }
  }

  const fetchModules = async () => {
    try {
      const { data } = await cachedFetch('modules_assign', async () => {
        const { data, error } = await supabase
          .from('modules')
          .select('id, title, description')
          .order('title', { ascending: true })
        if (error) throw error
        return data || []
      }, TTL.SHORT)

      if (mountedRef.current) {
        setModules(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching modules:', error)
      throw error
    }
  }

  const fetchAssignments = async () => {
    try {
      const { data, error } = await supabase
        .from('user_module_assignments')
        .select(`
          *,
          users:user_id (id, full_name, email, employee_id),
          modules:module_id (id, title)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error

      if (mountedRef.current) {
        setAssignments(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching assignments:', error)
      // Don't throw - assignments table might not exist yet
    }
  }

  const handleModuleToggle = (moduleId) => {
    setSelectedModules(prev => {
      if (prev.includes(moduleId)) {
        return prev.filter(id => id !== moduleId)
      } else {
        return [...prev, moduleId]
      }
    })
  }

  const handleSelectAllModules = () => {
    if (selectedModules.length === modules.length) {
      setSelectedModules([])
    } else {
      setSelectedModules(modules.map(m => m.id))
    }
  }

  const handleAssign = async (e) => {
    e.preventDefault()
    
    if (!selectedUser) {
      alert('Please select a user')
      return
    }

    if (selectedModules.length === 0) {
      alert('Please select at least one module')
      return
    }

    if (!startDate || !endDate) {
      alert('Please select both start and end dates')
      return
    }

    if (new Date(endDate) < new Date(startDate)) {
      alert('End date must be after start date')
      return
    }

    try {
      setLoading(true)

      // Create assignments for each selected module
      const assignmentsToInsert = selectedModules.map(moduleId => ({
        user_id: selectedUser,
        module_id: moduleId,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
        created_at: new Date().toISOString()
      }))

      const { error } = await supabase
        .from('user_module_assignments')
        .insert(assignmentsToInsert)

      if (error) throw error

      alert('Modules assigned successfully!')
      
      // Reset form
      setSelectedUser('')
      setSelectedModules([])
      setStartDate('')
      setEndDate('')
      setUserSearchTerm('')
      setAssignModalOpen(false)

      // Invalidate cache and refresh
      await cacheDelete('user_module_assignments')
      await fetchAssignments()

    } catch (error) {
      console.error('Error assigning modules:', error)
      alert('Error assigning modules: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAssignment = async (assignmentId) => {
    if (!confirm('Are you sure you want to remove this assignment?')) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('user_module_assignments')
        .delete()
        .eq('id', assignmentId)

      if (error) throw error

      alert('Assignment removed successfully!')
      await cacheDelete('user_module_assignments')
      await fetchAssignments()
    } catch (error) {
      console.error('Error deleting assignment:', error)
      alert('Error removing assignment: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAllUserAssignments = async (userId) => {
    if (!confirm('Are you sure you want to remove ALL module assignments for this user?')) return

    try {
      setLoading(true)
      const { error } = await supabase
        .from('user_module_assignments')
        .delete()
        .eq('user_id', userId)

      if (error) throw error

      alert('All assignments removed successfully!')
      await cacheDelete('user_module_assignments')
      await fetchAssignments()
      setDetailDrawerOpen(false)
    } catch (error) {
      console.error('Error deleting assignments:', error)
      alert('Error removing assignments: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const openDetailDrawer = (groupedUser) => {
    setSelectedUserDetail(groupedUser)
    setDetailDrawerOpen(true)
  }

  const getOverallStatus = (statuses) => {
    if (statuses.every(s => s === 'active')) return 'active'
    if (statuses.every(s => s === 'completed')) return 'completed'
    if (statuses.every(s => s === 'inactive')) return 'inactive'
    return 'mixed'
  }

  const filteredAssignments = assignments.filter(assignment => {
    const userName = assignment.users?.full_name?.toLowerCase() || ''
    const userEmail = assignment.users?.email?.toLowerCase() || ''
    const moduleName = assignment.modules?.title?.toLowerCase() || ''
    const search = searchTerm.toLowerCase()

    const matchesSearch = userName.includes(search) || userEmail.includes(search) || moduleName.includes(search)
    
    return matchesSearch
  })

  // Group assignments by user
  const groupedAssignments = useMemo(() => {
    const grouped = {}
    
    filteredAssignments.forEach(assignment => {
      const userId = assignment.user_id
      if (!grouped[userId]) {
        grouped[userId] = {
          user: assignment.users,
          assignments: [],
          moduleCount: 0,
          earliestStart: assignment.start_date,
          latestEnd: assignment.end_date,
          statuses: []
        }
      }
      
      grouped[userId].assignments.push(assignment)
      grouped[userId].moduleCount++
      grouped[userId].statuses.push(assignment.status)
      
      // Track earliest start and latest end
      if (new Date(assignment.start_date) < new Date(grouped[userId].earliestStart)) {
        grouped[userId].earliestStart = assignment.start_date
      }
      if (new Date(assignment.end_date) > new Date(grouped[userId].latestEnd)) {
        grouped[userId].latestEnd = assignment.end_date
      }
    })
    
    return Object.values(grouped)
  }, [filteredAssignments])

  // Filter users in modal based on search
  const filteredUsers = users.filter(user => {
    const search = userSearchTerm.toLowerCase()
    const name = user.full_name?.toLowerCase() || ''
    const email = user.email?.toLowerCase() || ''
    const empId = user.employee_id?.toLowerCase() || ''
    
    return name.includes(search) || email.includes(search) || empId.includes(search)
  })

  
  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  if (loading && assignments.length === 0) {
    return (
      <main className="assign-modules-main">
        <div className="loading-state">
          <i className="fa-solid fa-spinner fa-spin"></i>
          <span>Loading...</span>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="assign-modules-main">
        <section className="assign-modules-header">
          <div>
            <h2>Assign Modules</h2>
            <p>Assign modules to users with date ranges</p>
          </div>
          <div className="action-buttons">
            <button 
              className="btn btn-secondary" 
              onClick={() => fetchAllData()} 
              disabled={loading}
            >
              <i className={`fa-solid fa-refresh ${loading ? 'fa-spin' : ''}`}></i>
              Refresh
            </button>
            <button 
              className="btn btn-primary" 
              onClick={() => {
                setAssignModalOpen(true)
                setUserSearchTerm('')
              }}
            >
              <i className="fa-solid fa-plus"></i>
              Assign Module
            </button>
          </div>
        </section>

        {error && (
          <div className="error-message">
            <i className="fa-solid fa-circle-exclamation"></i>
            <span>{error}</span>
          </div>
        )}

        {/* Filters */}
        <div className="filters-section">
          <div className="search-wrapper">
            <i className="fa-solid fa-search"></i>
            <input
              type="text"
              placeholder="Search by user or module..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Assignments Table */}
        <div className="assignments-table-container">
          <div className="table-header-row">
            <h3>Module Assignments</h3>
            <span className="assignments-count">{groupedAssignments.length} user{groupedAssignments.length !== 1 ? 's' : ''}</span>
          </div>

          {groupedAssignments.length === 0 ? (
            <div className="empty-state">
              <i className="fa-solid fa-clipboard-list"></i>
              <p>No module assignments found</p>
              <button className="btn btn-primary" onClick={() => setAssignModalOpen(true)}>
                <i className="fa-solid fa-plus"></i>
                Create First Assignment
              </button>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="assignments-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>User</th>
                    <th>Modules</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedAssignments.map((group, index) => {
                    const overallStatus = getOverallStatus(group.statuses)
                    return (
                      <tr 
                        key={group.user?.id || index} 
                        className="assignments-table-row"
                        onClick={() => openDetailDrawer(group)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>{index + 1}</td>
                        <td>
                          <div className="user-info">
                            <div className="user-name">{group.user?.full_name || 'Unknown User'}</div>
                            <div className="user-email">{group.user?.email || '-'}</div>
                          </div>
                        </td>
                        <td>
                          <span className="module-count-badge">
                            {group.moduleCount} module{group.moduleCount !== 1 ? 's' : ''}
                          </span>
                        </td>
                        <td>{formatDate(group.earliestStart)}</td>
                        <td>{formatDate(group.latestEnd)}</td>
                        <td>
                          <span className={`status-badge status-${overallStatus}`}>
                            {overallStatus}
                          </span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              className="btn-icon btn-view"
                              onClick={() => openDetailDrawer(group)}
                              title="View details"
                            >
                              <i className="fa-solid fa-eye"></i>
                            </button>
                            <button
                              className="btn-icon btn-delete"
                              onClick={() => handleDeleteAllUserAssignments(group.user?.id)}
                              title="Delete all assignments"
                            >
                              <i className="fa-solid fa-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Assign Modal */}
      {assignModalOpen && (
        <div className="modal-backdrop" onClick={() => {
          setAssignModalOpen(false)
          setUserSearchTerm('')
        }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Assign Modules to User</h3>
              <button onClick={() => {
                setAssignModalOpen(false)
                setUserSearchTerm('')
              }}>
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            <form onSubmit={handleAssign}>
              <div className="modal-body">
                {/* User Selection with Search */}
                <div className="form-group">
                  <label htmlFor="user_search">Select User *</label>
                  <div className="searchable-select">
                    <input
                      type="text"
                      id="user_search"
                      placeholder="Search by name, email or ID..."
                      value={userSearchTerm}
                      onChange={(e) => setUserSearchTerm(e.target.value)}
                      className="search-input"
                    />
                    <select
                      id="user_select"
                      value={selectedUser}
                      onChange={(e) => setSelectedUser(e.target.value)}
                      required
                      size="5"
                      className="user-select-list"
                    >
                      <option value="">-- Select User --</option>
                      {filteredUsers.length === 0 ? (
                        <option disabled>No users found</option>
                      ) : (
                        filteredUsers.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.full_name} ({user.email})
                          </option>
                        ))
                      )}
                    </select>
                    {selectedUser && (
                      <div className="selected-user-display">
                        <i className="fa-solid fa-check-circle"></i>
                        Selected: {users.find(u => u.id === selectedUser)?.full_name}
                      </div>
                    )}
                  </div>
                </div>

                {/* Modules Multi-select */}
                <div className="form-group">
                  <label>
                    Select Modules *
                    <button
                      type="button"
                      className="select-all-btn"
                      onClick={handleSelectAllModules}
                    >
                      {selectedModules.length === modules.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </label>
                  <div className="modules-list">
                    {modules.length === 0 ? (
                      <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>No modules available</p>
                    ) : (
                      modules.map(module => (
                        <label key={module.id} className="module-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedModules.includes(module.id)}
                            onChange={() => handleModuleToggle(module.id)}
                          />
                          <div style={{ flex: 1 }}>
                            <span className="module-title">{module.title}</span>
                            {module.description && (
                              <span className="module-description">{module.description}</span>
                            )}
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  {selectedModules.length > 0 && (
                    <small style={{ color: '#3B82F6', marginTop: '0.5rem', display: 'block' }}>
                      {selectedModules.length} module{selectedModules.length !== 1 ? 's' : ''} selected
                    </small>
                  )}
                </div>

                {/* Date Range */}
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="start_date">Start Date *</label>
                    <input
                      type="date"
                      id="start_date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="end_date">End Date *</label>
                    <input
                      type="date"
                      id="end_date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setAssignModalOpen(false)
                    setUserSearchTerm('')
                  }}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || selectedModules.length === 0}
                >
                  {loading ? 'Assigning...' : 'Assign Modules'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {detailDrawerOpen && selectedUserDetail && (
        <div className="modal-backdrop" onClick={() => setDetailDrawerOpen(false)}>
          <div className="detail-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title">
                <h3>{selectedUserDetail.user?.full_name}'s Module Assignments</h3>
                <div className="drawer-subtitle">
                  {selectedUserDetail.user?.email} • {selectedUserDetail.moduleCount} module{selectedUserDetail.moduleCount !== 1 ? 's' : ''}
                </div>
              </div>
              <button className="btn-close" onClick={() => setDetailDrawerOpen(false)}>
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            
            <div className="drawer-body">
              <div className="detail-table-scroll">
                <table className="detail-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Module Name</th>
                      <th>Start Date</th>
                      <th>End Date</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedUserDetail.assignments.map((assignment, index) => (
                      <tr key={assignment.id}>
                        <td>{index + 1}</td>
                        <td>{assignment.modules?.title || 'Unknown Module'}</td>
                        <td>{formatDate(assignment.start_date)}</td>
                        <td>{formatDate(assignment.end_date)}</td>
                        <td>
                          <span className={`status-badge status-${assignment.status || 'active'}`}>
                            {assignment.status || 'active'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn-icon btn-delete"
                            onClick={() => handleDeleteAssignment(assignment.id)}
                            title="Delete this assignment"
                          >
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="drawer-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setDetailDrawerOpen(false)}
              >
                Close
              </button>
              <button
                className="btn btn-danger"
                onClick={() => handleDeleteAllUserAssignments(selectedUserDetail.user?.id)}
                disabled={loading}
              >
                <i className="fa-solid fa-trash"></i> Delete All Assignments
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default AssignModules
