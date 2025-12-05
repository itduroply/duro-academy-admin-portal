import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import { supabase } from '../supabaseClient'
import './Users.css'

function Users() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addUserModalOpen, setAddUserModalOpen] = useState(false)
  const [editUserModalOpen, setEditUserModalOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [roleFilter, setRoleFilter] = useState('All Roles')
  const [departmentFilter, setDepartmentFilter] = useState('All Departments')
  const [searchQuery, setSearchQuery] = useState('')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [regions, setRegions] = useState([])
  const [branches, setBranches] = useState([])
  const [subBranches, setSubBranches] = useState([])
  const [departments, setDepartments] = useState([])
  const [subDepartments, setSubDepartments] = useState([])
  const [grades, setGrades] = useState([])
  const [designations, setDesignations] = useState([])
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    role: 'user',
    employee_id: '',
    password: '',
    date_of_birth: '',
    date_of_joining: '',
    region_id: '',
    branch_id: '',
    sub_branch_id: '',
    department_id: '',
    sub_department_id: '',
    grade_id: '',
    designation_id: ''
  })
  const [errorMessage, setErrorMessage] = useState('')

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  const breadcrumbItems = [
    { label: 'Home', link: true },
    { label: 'User Management', link: false }
  ]

  const getInitials = (name) => {
    const names = name.split(' ')
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase()
    }
    return name[0].toUpperCase()
  }

  // Fetch users and organizational data from Supabase
  useEffect(() => {
    console.log('Component mounted, fetching data...')
    fetchUsers()
    fetchRegions()
    fetchBranches()
    fetchSubBranches()
    fetchDepartments()
    fetchSubDepartments()
    fetchGrades()
    fetchDesignations()
  }, [])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      console.log('Fetching users from Supabase...')
      
      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          designations(designation_name),
          departments(department_name)
        `)
        .order('created_at', { ascending: false })

      console.log('Supabase response:', { data, error })

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }
      
      // Transform data to match component expectations
      const transformedUsers = data?.map(user => ({
        id: user.id,
        name: user.full_name || 'N/A',
        email: user.email,
        phone: user.phone,
        designation: user.designations?.designation_name || 'N/A',
        department: user.departments?.department_name || 'N/A',
        role: user.role || 'user',
        employeeId: user.employee_id,
        progress: 0, // This would come from progress tracking table
        createdAt: new Date(user.created_at).toISOString().split('T')[0]
      })) || []
      
      console.log('Transformed users:', transformedUsers)
      setUsers(transformedUsers)
      setErrorMessage('')
    } catch (error) {
      console.error('Error fetching users:', error)
      console.error('Error details:', error.message, error.code, error.details)
      
      // Set user-friendly error message
      if (error.message?.includes('JWT')) {
        setErrorMessage('Authentication error. Please check your Supabase credentials.')
      } else if (error.code === 'PGRST301') {
        setErrorMessage('Row Level Security is blocking access. Please disable RLS or add policies to the users table.')
      } else if (error.message) {
        setErrorMessage(`Error: ${error.message}`)
      } else {
        setErrorMessage('Failed to fetch users. Check browser console for details.')
      }
      
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  const fetchRegions = async () => {
    try {
      const { data, error } = await supabase
        .from('regions')
        .select('id, region_name')
        .order('region_name', { ascending: true })

      if (error) throw error
      setRegions(data || [])
    } catch (error) {
      console.error('Error fetching regions:', error)
    }
  }

  const fetchDepartments = async () => {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('id, department_name')
        .order('department_name', { ascending: true })

      if (error) throw error
      setDepartments(data || [])
    } catch (error) {
      console.error('Error fetching departments:', error)
    }
  }

  const fetchSubDepartments = async () => {
    try {
      const { data, error } = await supabase
        .from('sub_departments')
        .select('id, department_id, sub_department_name')
        .order('sub_department_name', { ascending: true })

      if (error) throw error
      setSubDepartments(data || [])
    } catch (error) {
      console.error('Error fetching sub-departments:', error)
    }
  }

  const fetchBranches = async () => {
    try {
      const { data, error } = await supabase
        .from('branches')
        .select('id, region_id, branch_name')
        .order('branch_name', { ascending: true })

      if (error) throw error
      setBranches(data || [])
    } catch (error) {
      console.error('Error fetching branches:', error)
    }
  }

  const fetchSubBranches = async () => {
    try {
      const { data, error } = await supabase
        .from('sub_branches')
        .select('id, branch_id, sub_branch_name')
        .order('sub_branch_name', { ascending: true })

      if (error) throw error
      setSubBranches(data || [])
    } catch (error) {
      console.error('Error fetching sub-branches:', error)
    }
  }

  const fetchGrades = async () => {
    try {
      const { data, error } = await supabase
        .from('grades')
        .select('id, grade_name')
        .order('grade_name', { ascending: true })

      if (error) throw error
      setGrades(data || [])
    } catch (error) {
      console.error('Error fetching grades:', error)
    }
  }

  const fetchDesignations = async () => {
    try {
      const { data, error } = await supabase
        .from('designations')
        .select('id, designation_name')
        .order('designation_name', { ascending: true })

      if (error) throw error
      setDesignations(data || [])
    } catch (error) {
      console.error('Error fetching designations:', error)
    }
  }

  const getDesignationName = (designationId) => {
    if (!designationId) return 'N/A'
    const designation = designations.find(d => d.id === designationId)
    return designation ? designation.designation_name : 'N/A'
  }

  const watchedVideos = [
    { title: 'Introduction to Sales Funnels', status: 'Completed' },
    { title: 'Advanced Negotiation Tactics', status: 'Completed' },
    { title: 'Closing High-Ticket Deals', status: 'In Progress' }
  ]

  const openDrawer = (user) => {
    setSelectedUser(user)
    setDrawerOpen(true)
    // Initialize charts after drawer opens
    setTimeout(() => initializeCharts(user.progress), 100)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setTimeout(() => setSelectedUser(null), 300)
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const openEditModal = async (user) => {
    try {
      // Fetch the full user data from database
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single()

      if (error) throw error

      // Populate form with user data
      setFormData({
        full_name: data.full_name || '',
        email: data.email || '',
        phone: data.phone || '',
        role: data.role || 'user',
        employee_id: data.employee_id || '',
        password: '', // Don't populate password for security
        date_of_birth: data.date_of_birth || '',
        date_of_joining: data.date_of_joining || '',
        region_id: data.region_id || '',
        branch_id: data.branch_id || '',
        sub_branch_id: data.sub_branch_id || '',
        department_id: data.department_id || '',
        sub_department_id: data.sub_department_id || '',
        grade_id: data.grade_id || '',
        designation_id: data.designation_id || ''
      })
      
      setEditingUserId(user.id)
      setEditUserModalOpen(true)
    } catch (error) {
      console.error('Error loading user for edit:', error)
      alert('Failed to load user data: ' + error.message)
    }
  }

  const handleAddUser = async (e) => {
    e.preventDefault()
    
    try {
      setLoading(true)
      
      // Validate required fields
      if (!formData.full_name || !formData.email || !formData.employee_id) {
        alert('Please fill in all required fields: Full Name, Email, and Employee ID')
        setLoading(false)
        return
      }
      // Call edge function to create auth user then profile row
      const requestBody = {
        email: formData.email,
        password: formData.password || undefined,
        full_name: formData.full_name,
        role: formData.role,
        employee_id: formData.employee_id,
        phone: formData.phone || null,
        date_of_birth: formData.date_of_birth || null,
        date_of_joining: formData.date_of_joining || null,
        region_id: formData.region_id ? parseInt(formData.region_id) : null,
        branch_id: formData.branch_id ? parseInt(formData.branch_id) : null,
        sub_branch_id: formData.sub_branch_id ? parseInt(formData.sub_branch_id) : null,
        department_id: formData.department_id ? parseInt(formData.department_id) : null,
        sub_department_id: formData.sub_department_id ? parseInt(formData.sub_department_id) : null,
        grade_id: formData.grade_id ? parseInt(formData.grade_id) : null,
        designation_id: formData.designation_id ? parseInt(formData.designation_id) : null
      }
      console.log('Sending to create-user function:', requestBody)
      
      const { data: fnData, error: fnError } = await supabase.functions.invoke('create-user', {
        body: requestBody
      })

      if (fnError) {
        console.error('Edge function error:', fnError)
        throw new Error(`Edge function error: ${fnError.message || JSON.stringify(fnError)}`)
      }
      if (!fnData?.success) {
        console.error('Function returned error:', fnData)
        throw new Error(fnData?.error || 'User creation failed')
      }

      // Show generated password if auto-created
      if (fnData.generatedPassword) {
        alert(`User created successfully!\n\nAuto-generated password: ${fnData.generatedPassword}\n\nPlease save this password and share it securely with the user.`)
      }

      // Refresh users list
      await fetchUsers()
      
      // Reset form and close modal
      setFormData({
        full_name: '',
        email: '',
        phone: '',
        role: 'user',
        employee_id: '',
        password: '',
        date_of_birth: '',
        date_of_joining: '',
        region_id: '',
        branch_id: '',
        sub_branch_id: '',
        department_id: '',
        sub_department_id: '',
        grade_id: '',
        designation_id: ''
      })
      setAddUserModalOpen(false)
      
    } catch (error) {
      console.error('Error adding user:', error)
      alert(`Failed to add user: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateUser = async (e) => {
    e.preventDefault()
    
    try {
      setLoading(true)
      
      // Validate required fields
      if (!formData.full_name || !formData.email || !formData.employee_id) {
        alert('Please fill in all required fields: Full Name, Email, and Employee ID')
        setLoading(false)
        return
      }

      // Prepare update data (exclude password and email as they're handled separately)
      const updateData = {
        full_name: formData.full_name,
        role: formData.role,
        employee_id: formData.employee_id,
        phone: formData.phone || null,
        date_of_birth: formData.date_of_birth || null,
        date_of_joining: formData.date_of_joining || null,
        region_id: formData.region_id ? parseInt(formData.region_id) : null,
        branch_id: formData.branch_id ? parseInt(formData.branch_id) : null,
        sub_branch_id: formData.sub_branch_id ? parseInt(formData.sub_branch_id) : null,
        department_id: formData.department_id ? parseInt(formData.department_id) : null,
        sub_department_id: formData.sub_department_id ? parseInt(formData.sub_department_id) : null,
        grade_id: formData.grade_id ? parseInt(formData.grade_id) : null,
        designation_id: formData.designation_id ? parseInt(formData.designation_id) : null
      }

      console.log('Updating user:', editingUserId, updateData)

      // Update user in database
      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', editingUserId)

      if (error) {
        console.error('Update error:', error)
        throw new Error(`Failed to update user: ${error.message}`)
      }

      alert('User updated successfully!')

      // Refresh users list
      await fetchUsers()
      
      // Reset form and close modal
      setFormData({
        full_name: '',
        email: '',
        phone: '',
        role: 'user',
        employee_id: '',
        password: '',
        date_of_birth: '',
        date_of_joining: '',
        region_id: '',
        branch_id: '',
        sub_branch_id: '',
        department_id: '',
        sub_department_id: '',
        grade_id: '',
        designation_id: ''
      })
      setEditingUserId(null)
      setEditUserModalOpen(false)
      
    } catch (error) {
      console.error('Error updating user:', error)
      alert(`Failed to update user: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = async (user) => {
    try {
      if (!user?.id) return
      const ok = window.confirm(`Delete user "${user.name}"? This removes their row in public.users.`)
      if (!ok) return
      setLoading(true)
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', user.id)

      if (error) {
        if (/row-level security/i.test(error.message)) {
          alert('RLS blocked delete. Ensure admin DELETE policy exists on public.users. See SUPABASE_SETUP.md Users policies.')
        } else {
          alert('Failed to delete user: ' + error.message)
        }
        return
      }

      await fetchUsers()
      alert('User deleted')
    } catch (err) {
      console.error('Delete user error:', err)
      alert('Failed to delete user: ' + (err.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  const initializeCharts = (progress) => {
    if (typeof Highcharts !== 'undefined') {
      // Module Completion Gauge
      Highcharts.chart('module-completion-gauge', {
        chart: { type: 'solidgauge', backgroundColor: 'transparent', height: 160 },
        title: { text: null },
        credits: { enabled: false },
        pane: {
          center: ['50%', '85%'],
          size: '140%',
          startAngle: -90,
          endAngle: 90,
          background: {
            backgroundColor: '#EEE',
            innerRadius: '60%',
            outerRadius: '100%',
            shape: 'arc'
          }
        },
        yAxis: {
          min: 0,
          max: 100,
          stops: [
            [0.1, '#EF4444'],
            [0.5, '#F59E0B'],
            [0.9, '#10B981']
          ],
          lineWidth: 0,
          tickWidth: 0,
          minorTickInterval: null,
          tickAmount: 2,
          labels: { y: 16 }
        },
        plotOptions: {
          solidgauge: {
            dataLabels: {
              y: -25,
              borderWidth: 0,
              useHTML: true,
              format: '<div style="text-align:center"><span style="font-size:2rem;font-weight:bold;color:#111827">{y}%</span></div>'
            }
          }
        },
        series: [{
          name: 'Progress',
          data: [progress],
          dataLabels: { format: '<div style="text-align:center"><span style="font-size:2rem;font-weight:bold">{y}%</span></div>' }
        }]
      })

      // Quiz Scores Chart
      Highcharts.chart('quiz-scores-chart', {
        chart: { type: 'column', backgroundColor: 'transparent', height: 192 },
        title: { text: null },
        credits: { enabled: false },
        xAxis: {
          categories: ['Quiz 1', 'Quiz 2', 'Quiz 3', 'Quiz 4', 'Quiz 5'],
          labels: { style: { color: '#6B7280', fontSize: '11px' } }
        },
        yAxis: {
          min: 0,
          max: 100,
          title: { text: null },
          labels: { style: { color: '#6B7280' } }
        },
        legend: { enabled: false },
        tooltip: { valueSuffix: '%' },
        plotOptions: {
          column: {
            borderRadius: 4,
            dataLabels: { enabled: false },
            colorByPoint: false,
            color: '#4F46E5'
          }
        },
        series: [{
          name: 'Score',
          data: [85, 92, 78, 88, 95]
        }]
      })
    }
  }

  return (
    <div className="dashboard-panel">
      <Sidebar />

      {/* Main Content */}
      <div className="main-content">
        <Header breadcrumbItems={breadcrumbItems} onMenuToggle={toggleSidebar} />

        {/* Users Main Content */}
        <main className="users-main">
          <section className="users-header">
            <div>
              <h2>User Management</h2>
              <p>Manage all users, their roles, and progress.</p>
            </div>
            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={fetchUsers} disabled={loading}>
                <i className={`fa-solid fa-refresh ${loading ? 'fa-spin' : ''}`}></i>Refresh
              </button>
              <button className="btn btn-primary" onClick={() => setAddUserModalOpen(true)}>
                <i className="fa-solid fa-user-plus"></i>Add New User
              </button>
            </div>
          </section>

          {errorMessage && (
            <div style={{
              padding: '1rem',
              marginBottom: '1rem',
              backgroundColor: '#FEE2E2',
              border: '1px solid #DC2626',
              borderRadius: '0.5rem',
              color: '#991B1B'
            }}>
              <strong>⚠️ Error:</strong> {errorMessage}
            </div>
          )}

          <section className="users-table-container">
            <div className="table-filters">
              <div className="search-wrapper">
                <i className="fa-solid fa-magnifying-glass"></i>
                <input 
                  type="text" 
                  placeholder="Search by name or email..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="filter-select-wrapper">
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                  <option>All Roles</option>
                  <option>Admin</option>
                  <option>User</option>
                  <option>Trainer</option>
                </select>
              </div>
              <div className="filter-select-wrapper">
                <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
                  <option>All Departments</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.department_name}>
                      {dept.department_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="table-wrapper">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Designation</th>
                    <th>Role</th>
                    <th>Progress</th>
                    <th>Created At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>
                        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#4F46E5' }}></i>
                        <p style={{ marginTop: '1rem', color: '#6B7280' }}>Loading users...</p>
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>
                        <i className="fa-solid fa-users" style={{ fontSize: '2rem', color: '#9CA3AF' }}></i>
                        <p style={{ marginTop: '1rem', color: '#6B7280' }}>No users found. Add your first user!</p>
                      </td>
                    </tr>
                  ) : (
                    users
                      .filter(user => {
                        const matchesRole = roleFilter === 'All Roles' || user.role.toLowerCase() === roleFilter.toLowerCase()
                        const matchesDepartment = departmentFilter === 'All Departments' || user.department === departmentFilter
                        const matchesSearch = searchQuery === '' || 
                          user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          user.email.toLowerCase().includes(searchQuery.toLowerCase())
                        return matchesRole && matchesDepartment && matchesSearch
                      })
                      .map(user => (
                      <tr key={user.id} className="user-row" onClick={() => openDrawer(user)}>
                        <td className="user-cell">
                          <div className="user-avatar">{getInitials(user.name)}</div>
                          <div>
                            <div className="user-name">{user.name}</div>
                            <div className="user-email">{user.email}</div>
                          </div>
                        </td>
                        <td>{user.designation}</td>
                        <td>
                          <span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span>
                        </td>
                        <td>
                          <div className="progress-wrapper">
                            <div className="progress-bar">
                              <div className="progress-fill" style={{ width: `${user.progress}%` }}></div>
                            </div>
                            <span className="progress-text">{user.progress}%</span>
                          </div>
                        </td>
                        <td>{user.createdAt}</td>
                        <td>
                          <div className="action-buttons">
                            <button className="action-btn edit-btn" onClick={(e) => { e.stopPropagation(); openEditModal(user); }}>
                              <i className="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button className="action-btn delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteUser(user) }}>
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>

      {/* User Details Drawer */}
      <div className={`drawer-overlay ${drawerOpen ? 'active' : ''}`} onClick={closeDrawer}></div>
      <aside className={`user-details-drawer ${drawerOpen ? 'open' : ''}`}>
        {selectedUser && (
          <div className="drawer-content">
            <div className="drawer-header">
              <h5>User Details</h5>
              <button className="close-drawer-btn" onClick={closeDrawer}>
                <i className="fa-solid fa-times"></i>
              </button>
            </div>

            <div className="user-profile">
              <div className="user-avatar-large">{getInitials(selectedUser.name)}</div>
              <div>
                <h3>{selectedUser.name}</h3>
                <p>Role: <span>{selectedUser.role}</span></p>
                <p>Department: <span>{selectedUser.department}</span></p>
              </div>
            </div>

            <div className="drawer-body">
              <div className="chart-card">
                <h4>Overall Module Completion</h4>
                <div id="module-completion-gauge"></div>
              </div>

              <div className="chart-card">
                <h4>Latest Quiz Scores</h4>
                <div id="quiz-scores-chart"></div>
              </div>

              <div className="videos-card">
                <h4>Watched Videos</h4>
                <ul className="videos-list">
                  {watchedVideos.map((video, index) => (
                    <li key={index}>
                      <span>{video.title}</span>
                      <span className={`video-status ${video.status.toLowerCase().replace(' ', '-')}`}>
                        {video.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="drawer-footer">
              <button className="btn btn-secondary">Send Reminder</button>
              <button className="btn btn-danger">Reset Progress</button>
            </div>
          </div>
        )}
      </aside>

      {/* Add User Modal */}
      {addUserModalOpen && (
        <div className="modal-backdrop" onClick={() => setAddUserModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New User</h3>
              <button onClick={() => setAddUserModalOpen(false)}>
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            <form className="modal-body" onSubmit={handleAddUser}>
              <div className="form-group">
                <label htmlFor="full_name">Full Name *</label>
                <input 
                  type="text" 
                  id="full_name" 
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleInputChange}
                  placeholder="John Doe" 
                  required 
                />
              </div>
              <div className="form-group">
                <label htmlFor="employee_id">Employee ID *</label>
                <input 
                  type="text" 
                  id="employee_id" 
                  name="employee_id"
                  value={formData.employee_id}
                  onChange={handleInputChange}
                  placeholder="EMP001" 
                  required 
                />
              </div>
              <div className="form-group">
                <label htmlFor="email">Email Address *</label>
                <input 
                  type="email" 
                  id="email" 
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="name@company.com" 
                  required 
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password (optional)</label>
                <input
                  type="text"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Auto-generate if left blank"
                />
              </div>
              <div className="form-group">
                <label htmlFor="phone">Phone</label>
                <input 
                  type="tel" 
                  id="phone" 
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="123-456-7890" 
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="region_id">Region</label>
                  <select 
                    id="region_id" 
                    name="region_id"
                    value={formData.region_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select region</option>
                    {regions.map(region => (
                      <option key={region.id} value={region.id}>
                        {region.region_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="branch_id">Branch</label>
                  <select 
                    id="branch_id" 
                    name="branch_id"
                    value={formData.branch_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select branch</option>
                    {branches
                      .filter(branch => !formData.region_id || branch.region_id === parseInt(formData.region_id))
                      .map(branch => (
                        <option key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="sub_branch_id">Sub-Branch</label>
                  <select 
                    id="sub_branch_id" 
                    name="sub_branch_id"
                    value={formData.sub_branch_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select sub-branch</option>
                    {subBranches
                      .filter(subBranch => !formData.branch_id || subBranch.branch_id === parseInt(formData.branch_id))
                      .map(subBranch => (
                        <option key={subBranch.id} value={subBranch.id}>
                          {subBranch.sub_branch_name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="department_id">Department</label>
                  <select 
                    id="department_id" 
                    name="department_id"
                    value={formData.department_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select department</option>
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>
                        {dept.department_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="sub_department_id">Sub-Department</label>
                  <select 
                    id="sub_department_id" 
                    name="sub_department_id"
                    value={formData.sub_department_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select sub-department</option>
                    {subDepartments
                      .filter(subDept => !formData.department_id || subDept.department_id === parseInt(formData.department_id))
                      .map(subDept => (
                        <option key={subDept.id} value={subDept.id}>
                          {subDept.sub_department_name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="grade_id">Grade</label>
                  <select 
                    id="grade_id" 
                    name="grade_id"
                    value={formData.grade_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select grade</option>
                    {grades.map(grade => (
                      <option key={grade.id} value={grade.id}>
                        {grade.grade_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="designation_id">Designation</label>
                  <select 
                    id="designation_id" 
                    name="designation_id"
                    value={formData.designation_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select designation</option>
                    {designations.map(designation => (
                      <option key={designation.id} value={designation.id}>
                        {designation.designation_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="role">Role</label>
                  <select 
                    id="role" 
                    name="role"
                    value={formData.role}
                    onChange={handleInputChange}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="trainer">Trainer</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="date_of_birth">Date of Birth</label>
                  <input 
                    type="date" 
                    id="date_of_birth" 
                    name="date_of_birth"
                    value={formData.date_of_birth}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="date_of_joining">Date of Joining</label>
                  <input 
                    type="date" 
                    id="date_of_joining" 
                    name="date_of_joining"
                    value={formData.date_of_joining}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setAddUserModalOpen(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUserModalOpen && (
        <div className="modal-backdrop" onClick={() => { setEditUserModalOpen(false); setEditingUserId(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit User</h3>
              <button onClick={() => { setEditUserModalOpen(false); setEditingUserId(null); }}>
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            <form className="modal-body" onSubmit={handleUpdateUser}>
              <div className="form-group">
                <label htmlFor="edit_full_name">Full Name *</label>
                <input 
                  type="text" 
                  id="edit_full_name" 
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleInputChange}
                  placeholder="John Doe" 
                  required 
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit_employee_id">Employee ID *</label>
                <input 
                  type="text" 
                  id="edit_employee_id" 
                  name="employee_id"
                  value={formData.employee_id}
                  onChange={handleInputChange}
                  placeholder="EMP001" 
                  required 
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit_email">Email Address *</label>
                <input 
                  type="email" 
                  id="edit_email" 
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="name@company.com" 
                  disabled
                  style={{ backgroundColor: '#f3f4f6', cursor: 'not-allowed' }}
                />
                <small style={{ color: '#6B7280', fontSize: '0.875rem' }}>Email cannot be changed</small>
              </div>
              <div className="form-group">
                <label htmlFor="edit_phone">Phone</label>
                <input 
                  type="tel" 
                  id="edit_phone" 
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="123-456-7890" 
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit_region_id">Region</label>
                  <select 
                    id="edit_region_id" 
                    name="region_id"
                    value={formData.region_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select region</option>
                    {regions.map(region => (
                      <option key={region.id} value={region.id}>
                        {region.region_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit_branch_id">Branch</label>
                  <select 
                    id="edit_branch_id" 
                    name="branch_id"
                    value={formData.branch_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select branch</option>
                    {branches
                      .filter(branch => !formData.region_id || branch.region_id === parseInt(formData.region_id))
                      .map(branch => (
                        <option key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit_sub_branch_id">Sub-Branch</label>
                  <select 
                    id="edit_sub_branch_id" 
                    name="sub_branch_id"
                    value={formData.sub_branch_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select sub-branch</option>
                    {subBranches
                      .filter(subBranch => !formData.branch_id || subBranch.branch_id === parseInt(formData.branch_id))
                      .map(subBranch => (
                        <option key={subBranch.id} value={subBranch.id}>
                          {subBranch.sub_branch_name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit_department_id">Department</label>
                  <select 
                    id="edit_department_id" 
                    name="department_id"
                    value={formData.department_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select department</option>
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>
                        {dept.department_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit_sub_department_id">Sub-Department</label>
                  <select 
                    id="edit_sub_department_id" 
                    name="sub_department_id"
                    value={formData.sub_department_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select sub-department</option>
                    {subDepartments
                      .filter(subDept => !formData.department_id || subDept.department_id === parseInt(formData.department_id))
                      .map(subDept => (
                        <option key={subDept.id} value={subDept.id}>
                          {subDept.sub_department_name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit_grade_id">Grade</label>
                  <select 
                    id="edit_grade_id" 
                    name="grade_id"
                    value={formData.grade_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select grade</option>
                    {grades.map(grade => (
                      <option key={grade.id} value={grade.id}>
                        {grade.grade_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit_designation_id">Designation</label>
                  <select 
                    id="edit_designation_id" 
                    name="designation_id"
                    value={formData.designation_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Select designation</option>
                    {designations.map(designation => (
                      <option key={designation.id} value={designation.id}>
                        {designation.designation_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit_role">Role</label>
                  <select 
                    id="edit_role" 
                    name="role"
                    value={formData.role}
                    onChange={handleInputChange}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="trainer">Trainer</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit_date_of_birth">Date of Birth</label>
                  <input 
                    type="date" 
                    id="edit_date_of_birth" 
                    name="date_of_birth"
                    value={formData.date_of_birth}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit_date_of_joining">Date of Joining</label>
                  <input 
                    type="date" 
                    id="edit_date_of_joining" 
                    name="date_of_joining"
                    value={formData.date_of_joining}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => { setEditUserModalOpen(false); setEditingUserId(null); }}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Updating...' : 'Update User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Users
