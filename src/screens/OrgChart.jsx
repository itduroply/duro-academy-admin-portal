import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { cachedFetch, TTL } from '../utils/cacheDB'
import { useNotification } from '../contexts/NotificationContext'
import './OrgChart.css'

function buildOrgModel(users) {
  const nodesByEmployeeId = new Map()
  const childrenByManagerId = new Map()
  const rootNodes = []

  users.forEach(user => {
    const employeeId = (user.employeeId || '').trim()
    if (!employeeId) return
    nodesByEmployeeId.set(employeeId, { ...user })
  })

  nodesByEmployeeId.forEach((node) => {
    const managerId = (node.reportingManager || '').trim()
    const managerNode = managerId ? nodesByEmployeeId.get(managerId) : null

    if (managerNode && managerNode.employeeId !== node.employeeId) {
      const reports = childrenByManagerId.get(managerId) || []
      reports.push(node)
      childrenByManagerId.set(managerId, reports)
      return
    }

    rootNodes.push(node)
  })

  rootNodes.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  childrenByManagerId.forEach((children, managerId) => {
    children.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    childrenByManagerId.set(managerId, children)
  })

  return {
    nodesByEmployeeId,
    childrenByManagerId,
    rootNodes
  }
}

const clampZoom = (value) => Math.min(1.4, Math.max(0.65, value))

const matchesQuery = (user, query) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  return [user.name, user.employeeId, user.designation, user.department, user.branch]
    .some(value => (value || '').toLowerCase().includes(normalizedQuery))
}

function getManagerChain(user, nodesByEmployeeId) {
  const chain = []
  let currentManagerId = (user?.reportingManager || '').trim()

  while (currentManagerId) {
    const managerNode = nodesByEmployeeId.get(currentManagerId)
    if (!managerNode) break
    chain.unshift(managerNode)
    currentManagerId = (managerNode.reportingManager || '').trim()
  }

  return chain
}

function EmployeeCard({ user, variant = 'default', onSelect }) {
  const className = variant === 'focus'
    ? 'org-person-card is-focus'
    : variant === 'manager'
      ? 'org-person-card is-manager'
      : 'org-person-card'

  return (
    <button
      type="button"
      className={className}
      onClick={() => onSelect?.(user.employeeId)}
    >
      <span className="org-person-topbar" aria-hidden="true"></span>
      <div className="org-person-avatar">{user.initials}</div>
      <div className="org-person-name">{user.name}</div>
      <div className="org-person-id">{user.employeeId || 'No ID'}</div>
      <div className="org-person-role">{user.designation || 'Unassigned'}</div>
      <div className="org-person-meta">{user.department || user.branch || 'No department'}</div>
    </button>
  )
}

function OrgChart() {
  const { showNotification } = useNotification()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    fetchUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const result = await cachedFetch('org_chart_users', async () => {
        const pageSize = 1000
        let page = 0
        let allRows = []
        let hasMore = true

        while (hasMore) {
          const from = page * pageSize
          const to = from + pageSize - 1

          const { data, error } = await supabase
            .from('users')
            .select('id, full_name, employee_id, reporting_manager, designation_id, department_id, branch_id, status')
            .order('full_name', { ascending: true })
            .range(from, to)

          if (error) throw error
          allRows = allRows.concat(data || [])
          hasMore = (data || []).length === pageSize
          page += 1
        }

        const designationIds = [...new Set(allRows.map(u => u.designation_id).filter(Boolean))]
        const departmentIds = [...new Set(allRows.map(u => u.department_id).filter(Boolean))]
        const branchIds = [...new Set(allRows.map(u => u.branch_id).filter(Boolean))]

        const [designationsData, departmentsData, branchesData] = await Promise.all([
          designationIds.length > 0
            ? supabase.from('designations').select('id, designation_name').in('id', designationIds)
            : Promise.resolve({ data: [] }),
          departmentIds.length > 0
            ? supabase.from('departments').select('id, department_name').in('id', departmentIds)
            : Promise.resolve({ data: [] }),
          branchIds.length > 0
            ? supabase.from('branches').select('id, branch_name').in('id', branchIds)
            : Promise.resolve({ data: [] })
        ])

        const designationMap = new Map(designationsData.data?.map(item => [item.id, item.designation_name]) || [])
        const departmentMap = new Map(departmentsData.data?.map(item => [item.id, item.department_name]) || [])
        const branchMap = new Map(branchesData.data?.map(item => [item.id, item.branch_name]) || [])

        return allRows.map(user => ({
          id: user.id,
          name: user.full_name || 'N/A',
          employeeId: user.employee_id || '',
          reportingManager: user.reporting_manager || '',
          designation: designationMap.get(user.designation_id) || 'N/A',
          department: departmentMap.get(user.department_id) || 'N/A',
          branch: branchMap.get(user.branch_id) || 'N/A',
          status: user.status || 'active',
          initials: (user.full_name || 'N/A')
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0]?.toUpperCase())
            .join('') || 'U'
        }))
      }, TTL.LONG)

      setUsers(Array.isArray(result?.data) ? result.data : [])
    } catch (error) {
      console.error('Error loading org chart users:', error)
      showNotification(`Failed to load org chart: ${error.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const orgModel = useMemo(() => buildOrgModel(users), [users])

  const matchingUsers = useMemo(() => {
    if (!searchQuery.trim()) return []
    return users.filter(user => matchesQuery(user, searchQuery)).slice(0, 8)
  }, [users, searchQuery])

  const defaultFocusId = useMemo(() => {
    const firstManagerWithManager = users.find(user => {
      const employeeId = (user.employeeId || '').trim()
      const hasManager = Boolean((user.reportingManager || '').trim())
      const hasReports = (orgModel.childrenByManagerId.get(employeeId) || []).length > 0
      return employeeId && hasManager && hasReports
    })

    if (firstManagerWithManager) return firstManagerWithManager.employeeId

    const firstRootWithReports = orgModel.rootNodes.find(user => {
      const employeeId = (user.employeeId || '').trim()
      return (orgModel.childrenByManagerId.get(employeeId) || []).length > 0
    })

    return firstRootWithReports?.employeeId || users[0]?.employeeId || ''
  }, [orgModel, users])

  useEffect(() => {
    if (!defaultFocusId) return
    if (selectedEmployeeId && orgModel.nodesByEmployeeId.has(selectedEmployeeId)) return
    setSelectedEmployeeId(defaultFocusId)
  }, [defaultFocusId, orgModel, selectedEmployeeId])

  useEffect(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return

    const exactMatch = users.find(user => {
      const name = (user.name || '').toLowerCase()
      const employeeId = (user.employeeId || '').toLowerCase()
      return name === normalizedQuery || employeeId === normalizedQuery
    })

    if (exactMatch && exactMatch.employeeId !== selectedEmployeeId) {
      setSelectedEmployeeId(exactMatch.employeeId)
    }
  }, [users, searchQuery])

  const totalUsers = users.length
  const totalRoots = orgModel.rootNodes.length
  const focusedUser = selectedEmployeeId ? orgModel.nodesByEmployeeId.get(selectedEmployeeId) : null
  const managerChain = focusedUser ? getManagerChain(focusedUser, orgModel.nodesByEmployeeId) : []
  const directReports = focusedUser
    ? (orgModel.childrenByManagerId.get(focusedUser.employeeId) || [])
    : []
  const viewingLabel = searchQuery.trim() ? 'Focused' : 'Default'
  const selectedRootManager = managerChain[0] || focusedUser

  const handleSelectEmployee = (employeeId) => {
    setSelectedEmployeeId(employeeId)
    setZoom(1)
  }

  return (
    <div className="org-chart-page">
      <div className="org-chart-header">
        <div>
          <h1>Organisation Structure</h1>
          <p>Employee hierarchy based on reporting manager relationships</p>
        </div>
      </div>

      <div className="org-chart-stats">
        <div className="org-stat-card">
          <span>Total Users</span>
          <strong>{totalUsers}</strong>
        </div>
        <div className="org-stat-card">
          <span>Root Managers</span>
          <strong>{totalRoots}</strong>
        </div>
        <div className="org-stat-card">
          <span>Showing</span>
          <strong>{viewingLabel}</strong>
        </div>
      </div>

      <div className="org-chart-toolbar">
        <div className="org-chart-search">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search employee, designation, department, or branch"
          />
          {searchQuery && (
            <button
              type="button"
              className="org-clear-search"
              onClick={() => setSearchQuery('')}
            >
              Clear
            </button>
          )}
        </div>

        <div className="org-chart-zoom-controls">
          <button type="button" onClick={() => setZoom(current => clampZoom(current - 0.1))}>-</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom(current => clampZoom(current + 0.1))}>+</button>
        </div>
      </div>

      {loading ? (
        <div className="org-chart-empty">Loading organisation chart...</div>
      ) : !focusedUser ? (
        <div className="org-chart-empty">No users available to render the organisation chart.</div>
      ) : (
        <>
          {searchQuery.trim() && (
            <div className="org-search-results">
              {matchingUsers.length > 0 ? (
                matchingUsers.map(user => (
                  <button
                    type="button"
                    key={user.id}
                    className={`org-search-result ${user.employeeId === selectedEmployeeId ? 'is-active' : ''}`}
                    onClick={() => handleSelectEmployee(user.employeeId)}
                  >
                    <strong>{user.name}</strong>
                    <span>{user.designation}</span>
                    <small>{user.employeeId}</small>
                  </button>
                ))
              ) : (
                <div className="org-chart-empty compact">No employee matches that search.</div>
              )}
            </div>
          )}

          <div className="org-chart-focusbar">
            <div>
              <span className="org-focus-label">Focused Employee</span>
              <strong>{focusedUser.name}</strong>
            </div>
            <div>
              <span className="org-focus-label">Root Manager</span>
              <strong>{selectedRootManager?.name || 'N/A'}</strong>
            </div>
            <div>
              <span className="org-focus-label">Direct Reports</span>
              <strong>{directReports.length}</strong>
            </div>
          </div>

          <div className="org-tree-shell">
            <div className="org-tree-canvas" style={{ transform: `scale(${zoom})` }}>
              <div className="org-tree-lineage">
                {managerChain.map((manager, index) => (
                  <div className="org-lineage-node" key={manager.id}>
                    <EmployeeCard user={manager} variant="manager" onSelect={handleSelectEmployee} />
                    <div className="org-line-connector" aria-hidden="true">
                      <span className="org-line-dot"></span>
                    </div>
                    {index < managerChain.length - 1 && <div className="org-line-spacer" aria-hidden="true"></div>}
                  </div>
                ))}

                <div className="org-lineage-node is-focused">
                  <EmployeeCard user={focusedUser} variant="focus" onSelect={handleSelectEmployee} />
                </div>

                {directReports.length > 0 ? (
                  <div className="org-descendants-block">
                    <div className="org-line-connector is-branch" aria-hidden="true">
                      <span className="org-line-dot"></span>
                    </div>
                    <div className="org-children-grid">
                      {directReports.map((report) => (
                        <div className="org-child-item" key={report.id}>
                          <div className="org-child-stem" aria-hidden="true"></div>
                          <EmployeeCard user={report} onSelect={handleSelectEmployee} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="org-chart-empty compact">This employee does not have direct reports.</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default OrgChart
