import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { cachedFetch, cacheDelete, TTL } from '../utils/cacheDB'
import './AssignPerformanceDashboard.css'

function AssignPerformanceDashboard() {
  const mountedRef = useRef(true)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [users, setUsers] = useState([])
  const [assignments, setAssignments] = useState([]) // rows from user_performance_dashboard
  const [departments, setDepartments] = useState([])

  const [searchTerm, setSearchTerm] = useState('')
  const [checkedRows, setCheckedRows] = useState([])

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [assignType, setAssignType] = useState('single')   // 'single' | 'multiple' | 'department'
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedUsers, setSelectedUsers] = useState([])
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [editingUserId, setEditingUserId] = useState(null)

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
      await Promise.all([fetchUsers(), fetchDepartments(), fetchAssignments()])
    } catch (err) {
      console.error('fetchAllData error:', err)
      if (mountedRef.current) setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const fetchUsers = async () => {
    const { data } = await cachedFetch('users_perf_dash', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, email, employee_id, department_id')
        .order('full_name', { ascending: true })
      if (error) throw error
      return data || []
    }, TTL.SHORT)
    if (mountedRef.current) setUsers(Array.isArray(data) ? data : [])
  }

  const fetchDepartments = async () => {
    const { data } = await cachedFetch('departments_list', async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, department_name')
        .order('department_name', { ascending: true })
      if (error) throw error
      return data || []
    }, TTL.SHORT)
    if (mountedRef.current) setDepartments(Array.isArray(data) ? data : [])
  }

  const fetchAssignments = async () => {
    const { data, error } = await supabase
      .from('user_performance_dashboard')
      .select('id, user_id, assigned_at, users:user_id(id, full_name, email, employee_id)')
      .order('assigned_at', { ascending: false })
    if (error) throw error
    if (mountedRef.current) setAssignments(Array.isArray(data) ? data : [])
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  const resetModal = () => {
    setModalOpen(false)
    setEditingUserId(null)
    setAssignType('single')
    setSelectedUser('')
    setSelectedUsers([])
    setSelectedDepartment('')
    setUserSearchTerm('')
  }

  const openAssignModal = () => {
    resetModal()
    setModalOpen(true)
  }

  const openEditModal = (userId) => {
    setEditingUserId(userId)
    setAssignType('single')
    setSelectedUser(userId)
    setSelectedUsers([])
    setSelectedDepartment('')
    setUserSearchTerm('')
    setModalOpen(true)
  }

  const handleUserToggle = (uid) =>
    setSelectedUsers(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid])

  // ── assign / edit ─────────────────────────────────────────────────────────
  const handleAssign = async (e) => {
    e.preventDefault()

    if (assignType === 'single' && !selectedUser) return alert('Please select a user')
    if (assignType === 'multiple' && selectedUsers.length === 0) return alert('Please select at least one user')
    if (assignType === 'department' && !selectedDepartment) return alert('Please select a department')

    try {
      setSaving(true)

      let targetUserIds = []

      if (assignType === 'single') {
        targetUserIds = [selectedUser]
      } else if (assignType === 'multiple') {
        targetUserIds = selectedUsers
      } else {
        const { data: deptUsers, error: dErr } = await supabase
          .from('users')
          .select('id')
          .eq('department_id', selectedDepartment)
        if (dErr) throw dErr
        if (!deptUsers?.length) {
          alert('No users found in the selected department')
          return
        }
        targetUserIds = deptUsers.map(u => u.id)
      }

      if (editingUserId) {
        // Edit mode: just ensure the record exists (upsert is safe; no extra fields)
        const rows = targetUserIds.map(uid => ({ user_id: uid }))
        const { error } = await supabase
          .from('user_performance_dashboard')
          .upsert(rows, { onConflict: 'user_id', ignoreDuplicates: true })
        if (error) throw error
        alert('Performance Dashboard access updated!')
      } else {
        const rows = targetUserIds.map(uid => ({
          user_id: uid,
          assigned_at: new Date().toISOString(),
        }))
        const { error } = await supabase
          .from('user_performance_dashboard')
          .upsert(rows, { onConflict: 'user_id', ignoreDuplicates: true })
        if (error) throw error
        const msg = assignType === 'department'
          ? `Performance Dashboard assigned to ${targetUserIds.length} user(s) in the department!`
          : `Performance Dashboard assigned to ${targetUserIds.length} user(s)!`
        alert(msg)
      }

      resetModal()
      await cacheDelete('user_perf_dash')
      await fetchAssignments()
    } catch (err) {
      console.error(err)
      alert('Error: ' + err.message)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  // ── delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (userId) => {
    if (!confirm('Remove Performance Dashboard access for this user?')) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('user_performance_dashboard')
        .delete()
        .eq('user_id', userId)
      if (error) throw error
      alert('Access removed.')
      setCheckedRows(prev => prev.filter(id => id !== userId))
      await fetchAssignments()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const handleBulkDelete = async () => {
    if (!checkedRows.length) return
    if (!confirm(`Remove Performance Dashboard access for ${checkedRows.length} selected user(s)?`)) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('user_performance_dashboard')
        .delete()
        .in('user_id', checkedRows)
      if (error) throw error
      alert(`Access removed for ${checkedRows.length} user(s).`)
      setCheckedRows([])
      await fetchAssignments()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  // ── derived data ──────────────────────────────────────────────────────────
  const assignedUserIds = useMemo(() => new Set(assignments.map(a => a.user_id)), [assignments])

  const filteredAssignments = useMemo(() => {
    const q = searchTerm.toLowerCase()
    if (!q) return assignments
    return assignments.filter(a => {
      const name = a.users?.full_name?.toLowerCase() || ''
      const email = a.users?.email?.toLowerCase() || ''
      const empId = a.users?.employee_id?.toLowerCase() || ''
      return name.includes(q) || email.includes(q) || empId.includes(q)
    })
  }, [assignments, searchTerm])

  const filteredUsers = useMemo(() => {
    const q = userSearchTerm.toLowerCase()
    return users.filter(u => {
      const name = u.full_name?.toLowerCase() || ''
      const email = u.email?.toLowerCase() || ''
      const empId = u.employee_id?.toLowerCase() || ''
      return name.includes(q) || email.includes(q) || empId.includes(q)
    })
  }, [users, userSearchTerm])

  const formatDate = (d) => {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  // ── KPI stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    totalAssigned: assignments.length,
    totalUsers: users.length,
    notAssigned: users.length - assignments.length,
    todayAssigned: assignments.filter(a => {
      if (!a.assigned_at) return false
      const d = new Date(a.assigned_at)
      const now = new Date()
      return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }).length,
  }), [assignments, users])

  if (loading) {
    return (
      <main className="apd-main">
        <div className="apd-loading">
          <i className="fa-solid fa-spinner fa-spin"></i>
          <span>Loading...</span>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="apd-main">
        {/* Header */}
        <section className="apd-header">
          <div>
            <h2>Assign Performance Dashboard</h2>
            <p>Control which users can access the Performance Dashboard</p>
          </div>
          <div className="apd-actions">
            <button className="btn btn-secondary" onClick={fetchAllData} disabled={loading || saving}>
              <i className={`fa-solid fa-rotate-right ${(loading || saving) ? 'fa-spin' : ''}`}></i>
              Refresh
            </button>
            <button className="btn btn-primary" onClick={openAssignModal}>
              <i className="fa-solid fa-plus"></i>
              Assign Access
            </button>
          </div>
        </section>

        {error && (
          <div className="apd-error">
            <i className="fa-solid fa-circle-exclamation"></i>
            <span>{error}</span>
          </div>
        )}

        {/* KPI Cards */}
        <div className="apd-kpi-row">
          <div className="apd-kpi-card">
            <div className="apd-kpi-icon" style={{ background: '#EEF2FF', color: '#4F46E5' }}>
              <i className="fa-solid fa-chart-bar"></i>
            </div>
            <div>
              <p className="apd-kpi-label">Assigned Users</p>
              <h3 className="apd-kpi-value">{stats.totalAssigned}</h3>
            </div>
          </div>
          <div className="apd-kpi-card">
            <div className="apd-kpi-icon" style={{ background: '#F0FDF4', color: '#16A34A' }}>
              <i className="fa-solid fa-users"></i>
            </div>
            <div>
              <p className="apd-kpi-label">Total Users</p>
              <h3 className="apd-kpi-value">{stats.totalUsers}</h3>
            </div>
          </div>
          <div className="apd-kpi-card">
            <div className="apd-kpi-icon" style={{ background: '#FFF7ED', color: '#EA580C' }}>
              <i className="fa-solid fa-user-xmark"></i>
            </div>
            <div>
              <p className="apd-kpi-label">Not Assigned</p>
              <h3 className="apd-kpi-value">{stats.notAssigned < 0 ? 0 : stats.notAssigned}</h3>
            </div>
          </div>
          <div className="apd-kpi-card">
            <div className="apd-kpi-icon" style={{ background: '#F0F9FF', color: '#0284C7' }}>
              <i className="fa-solid fa-calendar-day"></i>
            </div>
            <div>
              <p className="apd-kpi-label">Assigned Today</p>
              <h3 className="apd-kpi-value">{stats.todayAssigned}</h3>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="apd-filters">
          <div className="apd-search-wrapper">
            <i className="fa-solid fa-search"></i>
            <input
              type="text"
              placeholder="Search assigned users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Bulk action bar */}
        {checkedRows.length > 0 && (
          <div className="apd-bulk-bar">
            <span className="apd-bulk-count">
              <i className="fa-solid fa-check-square"></i>
              {checkedRows.length} user{checkedRows.length !== 1 ? 's' : ''} selected
            </span>
            <div className="apd-bulk-actions">
              <button className="btn btn-danger" onClick={handleBulkDelete} disabled={saving}>
                <i className="fa-solid fa-trash"></i> Remove Access
              </button>
              <button className="btn btn-secondary" onClick={() => setCheckedRows([])}>
                <i className="fa-solid fa-xmark"></i> Clear
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="apd-table-card">
          <div className="apd-table-header">
            <h3>Users with Dashboard Access</h3>
            <span className="apd-count-badge">{filteredAssignments.length} user{filteredAssignments.length !== 1 ? 's' : ''}</span>
          </div>

          {filteredAssignments.length === 0 ? (
            <div className="apd-empty">
              <i className="fa-solid fa-chart-bar"></i>
              <p>No users assigned yet</p>
              <button className="btn btn-primary" onClick={openAssignModal}>
                <i className="fa-solid fa-plus"></i> Assign Access
              </button>
            </div>
          ) : (
            <div className="apd-table-scroll">
              <table className="apd-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        className="apd-checkbox"
                        checked={checkedRows.length === filteredAssignments.length && filteredAssignments.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) setCheckedRows(filteredAssignments.map(a => a.user_id))
                          else setCheckedRows([])
                        }}
                      />
                    </th>
                    <th>#</th>
                    <th>User</th>
                    <th>Employee ID</th>
                    <th>Assigned On</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.map((row, idx) => {
                    const isChecked = checkedRows.includes(row.user_id)
                    return (
                      <tr key={row.id} className={`apd-row${isChecked ? ' apd-row-selected' : ''}`}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="apd-checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) setCheckedRows(prev => [...prev, row.user_id])
                              else setCheckedRows(prev => prev.filter(id => id !== row.user_id))
                            }}
                          />
                        </td>
                        <td style={{ color: '#94A3B8' }}>{idx + 1}</td>
                        <td>
                          <div className="apd-user-name">{row.users?.full_name || '—'}</div>
                          <div className="apd-user-email">{row.users?.email || '—'}</div>
                        </td>
                        <td>{row.users?.employee_id || '—'}</td>
                        <td>{formatDate(row.assigned_at)}</td>
                        <td>
                          <div className="apd-row-actions">
                            <button
                              className="apd-btn-icon apd-btn-delete"
                              onClick={() => handleDelete(row.user_id)}
                              title="Remove access"
                              disabled={saving}
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

      {/* Assign / Edit Modal */}
      {modalOpen && (
        <div className="apd-modal-backdrop" onClick={resetModal}>
          <div className="apd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="apd-modal-header">
              <h3>
                {editingUserId ? 'Edit Performance Dashboard Access' : 'Assign Performance Dashboard Access'}
              </h3>
              <button onClick={resetModal}><i className="fa-solid fa-times"></i></button>
            </div>
            <form onSubmit={handleAssign}>
              <div className="apd-modal-body">

                {/* Assignment Type */}
                {!editingUserId && (
                  <div className="apd-form-group">
                    <label>Assignment Type *</label>
                    <select
                      value={assignType}
                      onChange={(e) => {
                        setAssignType(e.target.value)
                        setSelectedUser('')
                        setSelectedUsers([])
                        setSelectedDepartment('')
                        setUserSearchTerm('')
                      }}
                    >
                      <option value="single">Single User</option>
                      <option value="multiple">Multiple Users</option>
                      <option value="department">Assign to Department</option>
                    </select>
                  </div>
                )}

                {/* Single User */}
                {assignType === 'single' && (
                  <div className="apd-form-group">
                    <label>Select User *</label>
                    {editingUserId ? (
                      <div className="apd-user-locked">
                        <i className="fa-solid fa-user"></i>
                        {users.find(u => u.id === selectedUser)?.full_name || selectedUser}
                        <span className="apd-locked-label">(locked)</span>
                      </div>
                    ) : (
                      <div className="apd-searchable-select">
                        <input
                          type="text"
                          placeholder="Search by name, email or ID..."
                          value={userSearchTerm}
                          onChange={(e) => setUserSearchTerm(e.target.value)}
                          className="apd-search-input"
                        />
                        <select
                          value={selectedUser}
                          onChange={(e) => setSelectedUser(e.target.value)}
                          required
                          size="5"
                          className="apd-user-select-list"
                        >
                          <option value="">-- Select User --</option>
                          {filteredUsers.length === 0
                            ? <option disabled>No users found</option>
                            : filteredUsers.map(u => (
                              <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                            ))
                          }
                        </select>
                        {selectedUser && (
                          <div className="apd-selected-notice">
                            <i className="fa-solid fa-check-circle"></i>
                            Selected: {users.find(u => u.id === selectedUser)?.full_name}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Multiple Users */}
                {assignType === 'multiple' && (
                  <div className="apd-form-group">
                    <label>
                      Select Users *
                      <button type="button" className="apd-select-all-btn"
                        onClick={() => setSelectedUsers(
                          selectedUsers.length === filteredUsers.length ? [] : filteredUsers.map(u => u.id)
                        )}
                      >
                        {selectedUsers.length === filteredUsers.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </label>
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={userSearchTerm}
                      onChange={(e) => setUserSearchTerm(e.target.value)}
                      className="apd-search-input"
                      style={{ marginBottom: '0.5rem' }}
                    />
                    <div className="apd-checkbox-list">
                      {filteredUsers.length === 0
                        ? <p className="apd-empty-msg">No users found</p>
                        : filteredUsers.map(u => (
                          <label key={u.id} className="apd-checkbox-item">
                            <input
                              type="checkbox"
                              checked={selectedUsers.includes(u.id)}
                              onChange={() => handleUserToggle(u.id)}
                            />
                            <div>
                              <span className="apd-cb-name">{u.full_name}</span>
                              <span className="apd-cb-email">{u.email}</span>
                            </div>
                          </label>
                        ))
                      }
                    </div>
                    {selectedUsers.length > 0 && (
                      <small className="apd-count-note">
                        {selectedUsers.length} user{selectedUsers.length !== 1 ? 's' : ''} selected
                      </small>
                    )}
                  </div>
                )}

                {/* Department */}
                {assignType === 'department' && (
                  <div className="apd-form-group">
                    <label>Select Department *</label>
                    <select
                      value={selectedDepartment}
                      onChange={(e) => setSelectedDepartment(e.target.value)}
                      required
                    >
                      <option value="">-- Select Department --</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.department_name}</option>
                      ))}
                    </select>
                    {selectedDepartment && (
                      <small className="apd-info-note">
                        <i className="fa-solid fa-info-circle"></i>
                        Access will be assigned to all users in this department
                      </small>
                    )}
                  </div>
                )}

              </div>
              <div className="apd-modal-footer">
                <button type="button" className="btn btn-secondary" onClick={resetModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : editingUserId ? 'Update Access' : 'Assign Access'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

export default AssignPerformanceDashboard
