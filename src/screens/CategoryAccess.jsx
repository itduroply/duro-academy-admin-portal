import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { cachedFetch, cacheDelete, TTL } from '../utils/cacheDB'
import { useNotification } from '../contexts/NotificationContext'
import { useAuth } from '../contexts/AuthContext'
import { SCREENS } from '../config/permissions'
import './CategoryAccess.css'

function CategoryAccess() {
  const mountedRef = useRef(true)
  const [loading, setLoading] = useState(true)
  const { showNotification } = useNotification()
  const { hasActionAccess } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [categories, setCategories] = useState([])
  const [modules, setModules] = useState([])
  const [departments, setDepartments] = useState([])
  const [assignments, setAssignments] = useState([])
  const [mandatoryAssignments, setMandatoryAssignments] = useState([])

  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [selectedDepartments, setSelectedDepartments] = useState([])
  const [selectedCategories, setSelectedCategories] = useState([])
  const [selectedMandatoryModules, setSelectedMandatoryModules] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [moduleSearchTerm, setModuleSearchTerm] = useState('')
  const [editingDeptId, setEditingDeptId] = useState(null)

  const canEditCategoryAccess = hasActionAccess(SCREENS.CATEGORY_ACCESS, 'edit')
  const canDeleteCategoryAccess = hasActionAccess(SCREENS.CATEGORY_ACCESS, 'delete')

  useEffect(() => {
    mountedRef.current = true
    fetchAllData()
    return () => { mountedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isMissingMandatoryTableError = (error) => {
    const message = String(error?.message || '').toLowerCase()
    return error?.code === '42P01' || message.includes('department_mandatory_modules')
  }

  const fetchAllRows = async (table, select, orderCol) => {
    const PAGE_SIZE = 1000
    let allData = []
    let from = 0
    let hasMore = true
    while (hasMore) {
      let query = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1)
      if (orderCol) query = query.order(orderCol, { ascending: true })
      const { data, error } = await query
      if (error) throw error
      if (data && data.length > 0) {
        allData = allData.concat(data)
        from += PAGE_SIZE
        hasMore = data.length === PAGE_SIZE
      } else {
        hasMore = false
      }
    }
    return allData
  }

  const fetchAllData = async () => {
    try {
      setLoading(true)
      setError(null)

      const [categoriesResult, departmentsResult, modulesResult] = await Promise.all([
        cachedFetch('categories_ca', async () => {
          const { data, error } = await supabase
            .from('categories')
            .select('id, name')
            .order('name', { ascending: true })
          if (error) throw error
          return data || []
        }, TTL.LONG),
        cachedFetch('departments_ca', async () => {
          const { data, error } = await supabase
            .from('departments')
            .select('id, department_name')
            .order('department_name', { ascending: true })
          if (error) throw error
          return data || []
        }, TTL.LONG),
        cachedFetch('modules_ca', async () => {
          const { data, error } = await supabase
            .from('modules')
            .select('id, title, category_id')
            .order('title', { ascending: true })
          if (error) throw error
          return data || []
        }, TTL.SHORT),
      ])

      if (!mountedRef.current) return

      const cats = categoriesResult?.data || categoriesResult || []
      setCategories(Array.isArray(cats) ? cats : [])
      const depts = departmentsResult?.data || departmentsResult || []
      setDepartments(Array.isArray(depts) ? depts : [])
      const moduleRows = modulesResult?.data || modulesResult || []
      setModules(Array.isArray(moduleRows) ? moduleRows : [])

      await fetchAssignments()
      await fetchMandatoryAssignments()
    } catch (err) {
      console.error('[CategoryAccess] Error fetching data:', err)
      if (mountedRef.current) setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const fetchAssignments = async () => {
    try {
      const data = await fetchAllRows('category_department_access', '*', 'created_at')
      if (mountedRef.current) setAssignments(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('[CategoryAccess] Error fetching assignments:', err)
    }
  }

  const fetchMandatoryAssignments = async () => {
    try {
      const data = await fetchAllRows('department_mandatory_modules', 'id, department_id, module_id, created_at', 'created_at')
      if (mountedRef.current) setMandatoryAssignments(Array.isArray(data) ? data : [])
    } catch (err) {
      if (!isMissingMandatoryTableError(err)) {
        console.error('[CategoryAccess] Error fetching mandatory mappings:', err)
      }
      if (mountedRef.current) setMandatoryAssignments([])
    }
  }

  // Group assignments by department
  const groupedByDept = useMemo(() => {
    const deptMap = new Map(departments.map(d => [d.id, d]))
    const catMap = new Map(categories.map(c => [c.id, c]))
    const moduleMap = new Map(modules.map(m => [m.id, m]))
    const mandatoryByDept = mandatoryAssignments.reduce((accumulator, row) => {
      const key = row.department_id
      if (!accumulator[key]) accumulator[key] = []
      const moduleRow = moduleMap.get(row.module_id)
      accumulator[key].push({
        id: row.id,
        module_id: row.module_id,
        module_title: moduleRow?.title || 'Unknown Module',
        category_id: moduleRow?.category_id || null,
      })
      return accumulator
    }, {})

    const grouped = {}

    assignments.forEach(a => {
      const dId = a.department_id
      if (!grouped[dId]) {
        const dept = deptMap.get(dId)
        grouped[dId] = {
          department_id: dId,
          department_name: dept?.department_name || 'Unknown Department',
          categories: [],
          assignmentIds: [],
        }
      }
      const cat = catMap.get(a.category_id)
      grouped[dId].categories.push({
        id: a.id,
        category_id: a.category_id,
        category_name: cat?.name || 'Unknown Category',
        created_at: a.created_at,
      })
      grouped[dId].assignmentIds.push(a.id)
    })

    Object.keys(mandatoryByDept).forEach((deptKey) => {
      if (!grouped[deptKey]) {
        const dept = deptMap.get(Number(deptKey))
        grouped[deptKey] = {
          department_id: Number(deptKey),
          department_name: dept?.department_name || 'Unknown Department',
          categories: [],
          assignmentIds: [],
          mandatoryModules: [],
        }
      }
      grouped[deptKey].mandatoryModules = mandatoryByDept[deptKey]
    })

    Object.values(grouped).forEach((row) => {
      if (!row.mandatoryModules) row.mandatoryModules = []
      row.mandatoryModules.sort((a, b) => a.module_title.localeCompare(b.module_title))
    })

    return Object.values(grouped).sort((a, b) => a.department_name.localeCompare(b.department_name))
  }, [assignments, mandatoryAssignments, departments, categories, modules])

  // Filter
  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return groupedByDept
    const q = searchTerm.toLowerCase()
    return groupedByDept.filter(g =>
      g.department_name.toLowerCase().includes(q) ||
      g.categories.some(c => c.category_name.toLowerCase().includes(q))
    )
  }, [groupedByDept, searchTerm])

  // Departments that don't have any assignments yet (for the modal dropdown)
  const availableDepartments = useMemo(() => {
    const assignedDeptIds = new Set(assignments.map(a => a.department_id))
    if (editingDeptId) {
      // When editing, include the currently-editing department
      return departments.filter(d => !assignedDeptIds.has(d.id) || d.id === editingDeptId)
    }
    return departments.filter(d => !assignedDeptIds.has(d.id))
  }, [departments, assignments, editingDeptId])

  const openAssignModal = (deptGroup = null) => {
    if (!canEditCategoryAccess) {
      showNotification('You do not have edit permission for Module Management.', 'error')
      return
    }

    if (deptGroup) {
      // Edit mode — single dept locked
      setEditingDeptId(deptGroup.department_id)
      setSelectedDepartments([deptGroup.department_id])
      setSelectedCategories(deptGroup.categories.map(c => c.category_id))
      setSelectedMandatoryModules((deptGroup.mandatoryModules || []).map(m => m.module_id))
    } else {
      // New mode — multi-select
      setEditingDeptId(null)
      setSelectedDepartments([])
      setSelectedCategories([])
      setSelectedMandatoryModules([])
    }
    setModuleSearchTerm('')
    setAssignModalOpen(true)
  }

  const handleDeptToggle = (deptId) => {
    setSelectedDepartments(prev =>
      prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]
    )
  }

  const handleSelectAllDepts = () => {
    if (selectedDepartments.length === availableDepartments.length) {
      setSelectedDepartments([])
    } else {
      setSelectedDepartments(availableDepartments.map(d => d.id))
    }
  }

  const handleCategoryToggle = (categoryId) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId) ? prev.filter(id => id !== categoryId) : [...prev, categoryId]
    )
  }

  const handleSelectAllCategories = () => {
    if (selectedCategories.length === categories.length) {
      setSelectedCategories([])
    } else {
      setSelectedCategories(categories.map(c => c.id))
    }
  }

  const filteredMandatoryModules = useMemo(() => {
    const selectedCategorySet = new Set(selectedCategories)
    const search = moduleSearchTerm.trim().toLowerCase()
    return modules.filter(module => {
      const inSelectedCategory = selectedCategorySet.size === 0 || selectedCategorySet.has(module.category_id)
      const inSearch = !search || (module.title || '').toLowerCase().includes(search)
      return inSelectedCategory && inSearch
    })
  }, [modules, selectedCategories, moduleSearchTerm])

  useEffect(() => {
    const allowedIds = new Set(filteredMandatoryModules.map(module => module.id))
    setSelectedMandatoryModules(prev => prev.filter(moduleId => allowedIds.has(moduleId)))
  }, [filteredMandatoryModules])

  const handleMandatoryModuleToggle = (moduleId) => {
    setSelectedMandatoryModules(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    )
  }

  const handleSelectAllMandatoryModules = () => {
    const filteredIds = filteredMandatoryModules.map(module => module.id)
    const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedMandatoryModules.includes(id))
    if (allSelected) {
      setSelectedMandatoryModules(prev => prev.filter(id => !filteredIds.includes(id)))
      return
    }
    setSelectedMandatoryModules(prev => [...new Set([...prev, ...filteredIds])])
  }

  const handleSave = async (e) => {
    e.preventDefault()

    if (!canEditCategoryAccess) {
      showNotification('You do not have edit permission for Module Management.', 'error')
      return
    }

    if (selectedDepartments.length === 0) {
      showNotification('Please select at least one department', 'warning')
      return
    }
    if (selectedCategories.length === 0) {
      showNotification('Please select at least one category', 'warning')
      return
    }

    try {
      setSaving(true)

      if (editingDeptId) {
        // Edit mode — delete old assignments then re-insert for that dept
        const { error: delError } = await supabase
          .from('category_department_access')
          .delete()
          .eq('department_id', editingDeptId)
        if (delError) throw delError

        const rows = selectedCategories.map(catId => ({
          department_id: editingDeptId,
          category_id: catId,
        }))
        const { error: insError } = await supabase
          .from('category_department_access')
          .insert(rows)
        if (insError) throw insError

        try {
          const { error: delMandatoryError } = await supabase
            .from('department_mandatory_modules')
            .delete()
            .eq('department_id', editingDeptId)
          if (delMandatoryError) throw delMandatoryError

          if (selectedMandatoryModules.length > 0) {
            const mandatoryRows = selectedMandatoryModules.map(moduleId => ({
              department_id: editingDeptId,
              module_id: moduleId,
            }))
            const { error: upsertMandatoryError } = await supabase
              .from('department_mandatory_modules')
              .upsert(mandatoryRows, { onConflict: 'department_id,module_id' })
            if (upsertMandatoryError) throw upsertMandatoryError
          }
        } catch (mandatoryError) {
          if (!isMissingMandatoryTableError(mandatoryError)) throw mandatoryError
        }
      } else {
        // New mode — insert for every selected department
        for (const deptId of selectedDepartments) {
          const rows = selectedCategories.map(catId => ({
            department_id: deptId,
            category_id: catId,
          }))
          const { error: insError } = await supabase
            .from('category_department_access')
            .insert(rows)
          if (insError) throw insError

          try {
            if (selectedMandatoryModules.length > 0) {
              const mandatoryRows = selectedMandatoryModules.map(moduleId => ({
                department_id: deptId,
                module_id: moduleId,
              }))
              const { error: upsertMandatoryError } = await supabase
                .from('department_mandatory_modules')
                .upsert(mandatoryRows, { onConflict: 'department_id,module_id' })
              if (upsertMandatoryError) throw upsertMandatoryError
            }
          } catch (mandatoryError) {
            if (!isMissingMandatoryTableError(mandatoryError)) throw mandatoryError
          }
        }
      }

      showNotification(editingDeptId ? 'Module management updated!' : 'Categories assigned successfully!', 'success')
      setAssignModalOpen(false)
      setEditingDeptId(null)
      setSelectedDepartments([])
      setSelectedCategories([])
      setSelectedMandatoryModules([])
      setModuleSearchTerm('')
      await cacheDelete('category_dept_access')
      await fetchAssignments()
      await fetchMandatoryAssignments()
    } catch (err) {
      console.error('[CategoryAccess] Save error:', err)
      showNotification('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteDeptAccess = async (deptId) => {
    if (!canDeleteCategoryAccess) {
      showNotification('You do not have delete permission for Module Management.', 'error')
      return
    }

    if (!confirm('Remove ALL module access for this department?')) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('category_department_access')
        .delete()
        .eq('department_id', deptId)
      if (error) throw error

      try {
        const { error: mandatoryError } = await supabase
          .from('department_mandatory_modules')
          .delete()
          .eq('department_id', deptId)
        if (mandatoryError) throw mandatoryError
      } catch (mandatoryDeleteError) {
        if (!isMissingMandatoryTableError(mandatoryDeleteError)) throw mandatoryDeleteError
      }

      showNotification('Module access removed!', 'success')
      await cacheDelete('category_dept_access')
      await fetchAssignments()
      await fetchMandatoryAssignments()
    } catch (err) {
      console.error('[CategoryAccess] Delete error:', err)
      showNotification('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteSingle = async (assignmentId) => {
    if (!canDeleteCategoryAccess) {
      showNotification('You do not have delete permission for Module Management.', 'error')
      return
    }

    if (!confirm('Remove this category assignment?')) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('category_department_access')
        .delete()
        .eq('id', assignmentId)
      if (error) throw error
      await fetchAssignments()
    } catch (err) {
      console.error('[CategoryAccess] Delete error:', err)
      showNotification('Error: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  if (loading && assignments.length === 0) {
    return (
      <main className="ca-main">
        <div className="ca-loading">
          <i className="fa-solid fa-spinner fa-spin"></i>
          <span>Loading...</span>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="ca-main">
        {/* Header */}
        <section className="ca-header">
          <div>
            <h2>Module Management</h2>
            <p>Assign categories to departments so users see content relevant to their department</p>
          </div>
          <div className="ca-actions">
            <button className="btn btn-secondary" onClick={fetchAllData} disabled={loading}>
              <i className={`fa-solid fa-refresh ${loading ? 'fa-spin' : ''}`}></i> Refresh
            </button>
            <button className="btn btn-primary" onClick={() => openAssignModal()} disabled={!canEditCategoryAccess}>
              <i className="fa-solid fa-plus"></i> Assign Categories
            </button>
          </div>
        </section>

        {error && (
          <div className="ca-error">
            <i className="fa-solid fa-circle-exclamation"></i>
            <span>{error}</span>
          </div>
        )}

        {/* KPI Cards */}
        <div className="ca-kpi-row">
          <div className="ca-kpi-card">
            <div className="ca-kpi-icon" style={{ background: '#EFF6FF', color: '#3B82F6' }}>
              <i className="fa-solid fa-building"></i>
            </div>
            <div>
              <p className="ca-kpi-label">Total Departments</p>
              <h3 className="ca-kpi-value">{departments.length}</h3>
            </div>
          </div>
          <div className="ca-kpi-card">
            <div className="ca-kpi-icon" style={{ background: '#F0FDF4', color: '#22C55E' }}>
              <i className="fa-solid fa-layer-group"></i>
            </div>
            <div>
              <p className="ca-kpi-label">Total Categories</p>
              <h3 className="ca-kpi-value">{categories.length}</h3>
            </div>
          </div>
          <div className="ca-kpi-card">
            <div className="ca-kpi-icon" style={{ background: '#FAF5FF', color: '#8B5CF6' }}>
              <i className="fa-solid fa-link"></i>
            </div>
            <div>
              <p className="ca-kpi-label">Assignments</p>
              <h3 className="ca-kpi-value">{assignments.length}</h3>
            </div>
          </div>
          <div className="ca-kpi-card">
            <div className="ca-kpi-icon" style={{ background: '#FFF7ED', color: '#F59E0B' }}>
              <i className="fa-solid fa-check-double"></i>
            </div>
            <div>
              <p className="ca-kpi-label">Mandatory Modules</p>
              <h3 className="ca-kpi-value">{mandatoryAssignments.length}</h3>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="ca-filters">
          <div className="ca-search-wrapper">
            <i className="fa-solid fa-search"></i>
            <input
              type="text"
              placeholder="Search by department or category..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        <div className="ca-table-card">
          <div className="ca-table-header">
            <h3>Department → Category Assignments</h3>
            <span className="ca-count-badge">{filteredGroups.length} department{filteredGroups.length !== 1 ? 's' : ''}</span>
          </div>

          {filteredGroups.length === 0 ? (
            <div className="ca-empty">
              <i className="fa-solid fa-layer-group"></i>
              <p>No category assignments found</p>
              <button className="btn btn-primary" onClick={() => openAssignModal()} disabled={!canEditCategoryAccess}>
                <i className="fa-solid fa-plus"></i> Create First Assignment
              </button>
            </div>
          ) : (
            <div className="ca-table-scroll">
              <table className="ca-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Department</th>
                    <th>Categories</th>
                    <th>Mandatory Modules</th>
                    <th>Count</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGroups.map((group, idx) => (
                    <tr key={group.department_id} className="ca-table-row">
                      <td style={{ color: '#94A3B8' }}>{idx + 1}</td>
                      <td>
                        <span className="ca-dept-name">{group.department_name}</span>
                      </td>
                      <td>
                        <div className="ca-cat-tags">
                          {group.categories.slice(0, 5).map(c => (
                            <span key={c.category_id} className="ca-cat-tag">{c.category_name}</span>
                          ))}
                          {group.categories.length > 5 && (
                            <span className="ca-cat-tag ca-cat-more">+{group.categories.length - 5} more</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="ca-cat-tags">
                          {(group.mandatoryModules || []).slice(0, 3).map(module => (
                            <span key={module.module_id} className="ca-cat-tag">{module.module_title}</span>
                          ))}
                          {(group.mandatoryModules || []).length > 3 && (
                            <span className="ca-cat-tag ca-cat-more">+{group.mandatoryModules.length - 3} more</span>
                          )}
                          {(group.mandatoryModules || []).length === 0 && (
                            <span style={{ color: '#94A3B8' }}>-</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="ca-count-pill">{group.categories.length}</span>
                      </td>
                      <td>
                        <div className="ca-row-actions">
                          {canEditCategoryAccess && (
                            <button className="btn-icon btn-view" onClick={() => openAssignModal(group)} title="Edit">
                              <i className="fa-solid fa-pen-to-square"></i>
                            </button>
                          )}
                          {canDeleteCategoryAccess && (
                            <button className="btn-icon btn-delete" onClick={() => handleDeleteDeptAccess(group.department_id)} title="Delete all">
                              <i className="fa-solid fa-trash"></i>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Assign / Edit Modal */}
      {assignModalOpen && (
        <div className="ca-modal-backdrop" onClick={() => { setAssignModalOpen(false); setEditingDeptId(null) }}>
          <div className="ca-modal" onClick={e => e.stopPropagation()}>
            <div className="ca-modal-header">
              <h3>{editingDeptId ? 'Edit Module Management' : 'Assign Categories to Department'}</h3>
              <button onClick={() => { setAssignModalOpen(false); setEditingDeptId(null) }}>
                <i className="fa-solid fa-times"></i>
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className="ca-modal-body">
                {/* Department Selection */}
                <div className="ca-form-group">
                  <label>
                    {editingDeptId ? 'Department' : 'Select Departments *'}
                    {!editingDeptId && (
                      <button type="button" className="ca-select-all-btn" onClick={handleSelectAllDepts}>
                        {selectedDepartments.length === availableDepartments.length ? 'Deselect All' : 'Select All'}
                      </button>
                    )}
                  </label>
                  <div className="ca-cat-list">
                    {editingDeptId ? (
                      <label className="ca-cat-checkbox">
                        <input type="checkbox" checked readOnly disabled />
                        <span className="ca-cat-checkbox-label">
                          {departments.find(d => d.id === editingDeptId)?.department_name}
                        </span>
                      </label>
                    ) : availableDepartments.length === 0 ? (
                      <p style={{ color: '#F59E0B', fontSize: '0.875rem', padding: '0.5rem' }}>
                        All departments already have assignments. Edit existing ones instead.
                      </p>
                    ) : (
                      availableDepartments.map(d => (
                        <label key={d.id} className="ca-cat-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedDepartments.includes(d.id)}
                            onChange={() => handleDeptToggle(d.id)}
                          />
                          <span className="ca-cat-checkbox-label">{d.department_name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  {!editingDeptId && selectedDepartments.length > 0 && (
                    <small style={{ color: '#4F46E5', marginTop: '0.5rem', display: 'block' }}>
                      {selectedDepartments.length} department{selectedDepartments.length !== 1 ? 's' : ''} selected
                    </small>
                  )}
                </div>

                {/* Categories Multi-select */}
                <div className="ca-form-group">
                  <label>
                    Select Categories *
                    <button type="button" className="ca-select-all-btn" onClick={handleSelectAllCategories}>
                      {selectedCategories.length === categories.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </label>
                  <div className="ca-cat-list">
                    {categories.length === 0 ? (
                      <p style={{ color: '#6B7280', fontSize: '0.875rem', padding: '0.5rem' }}>No categories available</p>
                    ) : (
                      categories.map(cat => (
                        <label key={cat.id} className="ca-cat-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedCategories.includes(cat.id)}
                            onChange={() => handleCategoryToggle(cat.id)}
                          />
                          <span className="ca-cat-checkbox-label">{cat.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  {selectedCategories.length > 0 && (
                    <small style={{ color: '#4F46E5', marginTop: '0.5rem', display: 'block' }}>
                      {selectedCategories.length} categor{selectedCategories.length !== 1 ? 'ies' : 'y'} selected
                    </small>
                  )}
                </div>

                {/* Mandatory Modules (per department) */}
                <div className="ca-form-group">
                  <label>
                    Mandatory Modules (Optional)
                    <button type="button" className="ca-select-all-btn" onClick={handleSelectAllMandatoryModules}>
                      Select All Visible
                    </button>
                  </label>

                  <input
                    type="text"
                    placeholder="Search mandatory modules..."
                    value={moduleSearchTerm}
                    onChange={(e) => setModuleSearchTerm(e.target.value)}
                    style={{ marginBottom: '0.5rem' }}
                  />

                  <div className="ca-cat-list">
                    {filteredMandatoryModules.length === 0 ? (
                      <p style={{ color: '#6B7280', fontSize: '0.875rem', padding: '0.5rem' }}>
                        No modules found for selected categories.
                      </p>
                    ) : (
                      filteredMandatoryModules.map(module => (
                        <label key={module.id} className="ca-cat-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedMandatoryModules.includes(module.id)}
                            onChange={() => handleMandatoryModuleToggle(module.id)}
                          />
                          <span className="ca-cat-checkbox-label">{module.title}</span>
                        </label>
                      ))
                    )}
                  </div>

                  {selectedMandatoryModules.length > 0 && (
                    <small style={{ color: '#4F46E5', marginTop: '0.5rem', display: 'block' }}>
                      {selectedMandatoryModules.length} mandatory module{selectedMandatoryModules.length !== 1 ? 's' : ''} selected
                    </small>
                  )}
                </div>
              </div>

              <div className="ca-modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => { setAssignModalOpen(false); setEditingDeptId(null) }} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!canEditCategoryAccess || saving || selectedCategories.length === 0 || selectedDepartments.length === 0}>
                  {saving ? 'Saving...' : editingDeptId ? 'Update Access' : 'Assign Categories'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

export default CategoryAccess
