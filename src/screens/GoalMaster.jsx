import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import { cacheDelete, cachedFetch, TTL } from '../utils/cacheDB'
import './GoalMaster.css'

function asText(value) {
  return String(value || '').trim()
}

function formatDate(value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function parseDateInput(value) {
  if (value == null || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const y = parsed.y
      const m = String(parsed.m).padStart(2, '0')
      const d = String(parsed.d).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
  }

  const text = String(value).trim()
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function pickCell(row, keys) {
  const entries = Object.entries(row || {})
  const normalizedCandidates = keys.map(normalizeHeader)
  for (const [key, val] of entries) {
    if (normalizedCandidates.includes(normalizeHeader(key))) return val
  }
  return ''
}

function getDurationLabel(startingDate, endingDate) {
  if (!startingDate || !endingDate) return '-'
  const start = new Date(startingDate)
  const end = new Date(endingDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '-'

  const dayMs = 24 * 60 * 60 * 1000
  const days = Math.floor((end.getTime() - start.getTime()) / dayMs) + 1
  return `${days} day${days === 1 ? '' : 's'}`
}

function todayDateString() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function normalizeQuarter(value) {
  const q = String(value || '').trim().toUpperCase()
  if (['Q1', 'Q2', 'Q3', 'Q4'].includes(q)) return q
  return ''
}

function getQuarterColumn(quarter) {
  const normalized = normalizeQuarter(quarter)
  if (normalized === 'Q1') return 'q1_monthly_goal'
  if (normalized === 'Q2') return 'q2_monthly_goal'
  if (normalized === 'Q3') return 'q3_monthly_goal'
  if (normalized === 'Q4') return 'q4_monthly_goal'
  return ''
}

function ensureFourQuarterRows(row, selectedEmployeeRow) {
  const quarterOrder = ['Q1', 'Q2', 'Q3', 'Q4']
  const base = row || {}

  return quarterOrder.map((quarter) => {
    const goalColumn = getQuarterColumn(quarter)
    const goalValue = toNumber(base?.[goalColumn])

    return {
      id: base?.id || null,
      employee_code: asText(base?.employee_code || selectedEmployeeRow?.employee_code),
      employee_name: asText(base?.employee_name || selectedEmployeeRow?.employee_name),
      reporting_manager: asText(base?.reporting_manager || selectedEmployeeRow?.reporting_manager),
      reporting_manager_id: asText(base?.reporting_manager_id || selectedEmployeeRow?.reporting_manager_id),
      designation: asText(base?.designation || selectedEmployeeRow?.designation),
      q1_monthly_goal: toNumber(base?.q1_monthly_goal),
      q2_monthly_goal: toNumber(base?.q2_monthly_goal),
      q3_monthly_goal: toNumber(base?.q3_monthly_goal),
      q4_monthly_goal: toNumber(base?.q4_monthly_goal),
      monthly_sheet_goal: goalValue,
      quarter,
      starting_date: base?.starting_date || null,
      ending_date: base?.ending_date || null,
      updated_at: base?.updated_at || null,
      _isPlaceholder: false,
    }
  })
}

function GoalMaster() {
  const mountedRef = useRef(true)
  const uploadInputRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [designationFilter, setDesignationFilter] = useState('All')
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [detailRows, setDetailRows] = useState([])
  const [detailQuarterFilter, setDetailQuarterFilter] = useState('All')
  const [detailSortOrder, setDetailSortOrder] = useState('latest')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingEmployeeCode, setEditingEmployeeCode] = useState('')
  const [editingGoalId, setEditingGoalId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState({ type: '', text: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [formData, setFormData] = useState({
    employee_code: '',
    employee_name: '',
    reporting_manager: '',
    reporting_manager_id: '',
    designation: '',
    q1_monthly_goal: '',
    q2_monthly_goal: '',
    q3_monthly_goal: '',
    q4_monthly_goal: '',
    starting_date: '',
    ending_date: '',
  })
  const [editingDetailRowId, setEditingDetailRowId] = useState('')
  const [detailEditData, setDetailEditData] = useState({
    monthly_sheet_goal: '',
    starting_date: '',
    ending_date: '',
  })

  const resetForm = useCallback(() => {
    setFormData({
      employee_code: '',
      employee_name: '',
      reporting_manager: '',
      reporting_manager_id: '',
      designation: '',
      q1_monthly_goal: '',
      q2_monthly_goal: '',
      q3_monthly_goal: '',
      q4_monthly_goal: '',
      starting_date: '',
      ending_date: '',
    })
    setFormError('')
    setFormSuccess('')
    setEditingEmployeeCode('')
    setEditingGoalId('')
  }, [])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const [usersResult, goalsResult] = await Promise.all([
        cachedFetch(
          'goal_master_users_v1',
          async () => {
            const { data, error } = await supabase
              .from('users')
              .select('employee_id, full_name, reporting_manager')
              .not('employee_id', 'is', null)

            if (error) throw error
            return data || []
          },
          TTL.SHORT
        ),
        cachedFetch(
          'goal_master_table_rows_v1',
          async () => {
            const { data, error } = await supabase
              .from('goals_master')
              .select('id, employee_code, employee_name, reporting_manager, reporting_manager_id, designation, q1_monthly_goal, q2_monthly_goal, q3_monthly_goal, q4_monthly_goal, starting_date, ending_date, updated_at')
              .order('ending_date', { ascending: true, nullsFirst: true })
              .order('updated_at', { ascending: false })

            if (error) throw error
            return data || []
          },
          TTL.SHORT
        ),
      ])

      if (!mountedRef.current) return

      const users = Array.isArray(usersResult?.data) ? usersResult.data : (Array.isArray(usersResult) ? usersResult : [])
      const goals = Array.isArray(goalsResult?.data) ? goalsResult.data : (Array.isArray(goalsResult) ? goalsResult : [])

      const nameByCode = new Map(users.map(user => [asText(user.employee_id).toLowerCase(), asText(user.full_name)]))

      const goalByCode = new Map()
      goals.forEach(goal => {
        const code = asText(goal.employee_code).toLowerCase()
        if (!code) return
        if (!goalByCode.has(code)) goalByCode.set(code, goal)
      })

      const merged = Array.from(goalByCode.values()).map(goal => {
        const code = asText(goal?.employee_code).toLowerCase()

        const managerCode = asText(goal?.reporting_manager_id)
        const managerNameFromCode = managerCode ? nameByCode.get(managerCode.toLowerCase()) : ''

        return {
          id: goal?.id || null,
          employee_code: asText(goal?.employee_code),
          employee_name: asText(goal?.employee_name),
          reporting_manager: asText(goal?.reporting_manager || managerNameFromCode),
          reporting_manager_id: managerCode,
          designation: asText(goal?.designation),
          q1_monthly_goal: Number(goal?.q1_monthly_goal || 0),
          q2_monthly_goal: Number(goal?.q2_monthly_goal || 0),
          q3_monthly_goal: Number(goal?.q3_monthly_goal || 0),
          q4_monthly_goal: Number(goal?.q4_monthly_goal || 0),
          monthly_sheet_goal: Math.round((
            Number(goal?.q1_monthly_goal || 0)
            + Number(goal?.q2_monthly_goal || 0)
            + Number(goal?.q3_monthly_goal || 0)
            + Number(goal?.q4_monthly_goal || 0)
          ) / 4),
          starting_date: goal?.starting_date || null,
          ending_date: goal?.ending_date || null,
          updated_at: goal?.updated_at || null,
          has_goal: true,
        }
      })

      merged.sort((a, b) => {
        return asText(a.employee_name).localeCompare(asText(b.employee_name))
      })

      setRows(merged)
    } catch (err) {
      console.error('Error loading Goal Master data:', err)
      if (mountedRef.current) setError(err.message || 'Failed to load Goal Master data')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    loadData()
    return () => {
      mountedRef.current = false
    }
  }, [loadData])

  const designationOptions = useMemo(() => {
    const values = Array.from(new Set(rows.map(r => asText(r.designation)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
    return ['All', ...values]
  }, [rows])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()

    return rows.filter(row => {
      const matchesSearch = !query
        || asText(row.employee_code).toLowerCase().includes(query)
        || asText(row.employee_name).toLowerCase().includes(query)
        || asText(row.reporting_manager).toLowerCase().includes(query)
        || asText(row.reporting_manager_id).toLowerCase().includes(query)

      const matchesDesignation = designationFilter === 'All' || asText(row.designation) === designationFilter

      return matchesSearch && matchesDesignation
    })
  }, [rows, search, designationFilter])

  const handleFormChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleAddRecord = async (event) => {
    event.preventDefault()
    setFormError('')
    setFormSuccess('')

    const employeeCode = asText(formData.employee_code)
    const q1Goal = Number(formData.q1_monthly_goal)
    const q2Goal = Number(formData.q2_monthly_goal)
    const q3Goal = Number(formData.q3_monthly_goal)
    const q4Goal = Number(formData.q4_monthly_goal)
    const startingDate = asText(formData.starting_date)
    const endingDate = asText(formData.ending_date)

    if (!employeeCode) {
      setFormError('Employee Code is required.')
      return
    }

    const quarterGoals = [q1Goal, q2Goal, q3Goal, q4Goal]
    const hasInvalidQuarterGoal = quarterGoals.some(value => !Number.isFinite(value) || value < 0)
    if (hasInvalidQuarterGoal) {
      setFormError('Please enter valid non-negative monthly goals for Q1, Q2, Q3 and Q4.')
      return
    }

    if (startingDate && endingDate && startingDate > endingDate) {
      setFormError('Ending Date cannot be earlier than Starting Date.')
      return
    }

    try {
      setSaving(true)

      const payload = {
        employee_code: employeeCode,
        employee_name: asText(formData.employee_name) || null,
        reporting_manager: asText(formData.reporting_manager) || null,
        reporting_manager_id: asText(formData.reporting_manager_id) || null,
        designation: asText(formData.designation) || null,
        q1_monthly_goal: q1Goal,
        q2_monthly_goal: q2Goal,
        q3_monthly_goal: q3Goal,
        q4_monthly_goal: q4Goal,
        starting_date: startingDate || null,
        ending_date: endingDate || null,
      }

      if (editingEmployeeCode && editingGoalId) {
        const { error: updateError } = await supabase
          .from('goals_master')
          .update(payload)
          .eq('id', editingGoalId)
        if (updateError) throw updateError
      } else {
        const { error: upsertError } = await supabase
          .from('goals_master')
          .upsert(payload, { onConflict: 'employee_code' })
        if (upsertError) throw upsertError
      }

      await cacheDelete('goal_master_table_rows_v1')
      await loadData()

      setFormSuccess(editingEmployeeCode ? 'Goal record updated successfully.' : 'Quarter-wise goal record saved successfully.')
      resetForm()
      setShowAddForm(false)
    } catch (err) {
      console.error('Error adding goal record:', err)
      if (String(err?.message || '').toLowerCase().includes('duplicate')) {
        setFormError('Could not save because this environment still has legacy UNIQUE(employee_code) on goals_master. Run the latest goals_master history migration and try again.')
      } else {
        setFormError(err.message || 'Failed to add record.')
      }
    } finally {
      setSaving(false)
    }
  }

  const openCreateForm = () => {
    resetForm()
    setShowAddForm(true)
  }

  const openEditForm = (event, row) => {
    event.stopPropagation()
    setEditingEmployeeCode(asText(row.employee_code))
    setEditingGoalId(asText(row.id))
    setFormData({
      employee_code: asText(row.employee_code),
      employee_name: asText(row.employee_name),
      reporting_manager: asText(row.reporting_manager),
      reporting_manager_id: asText(row.reporting_manager_id),
      designation: asText(row.designation),
      q1_monthly_goal: String(row.q1_monthly_goal ?? ''),
      q2_monthly_goal: String(row.q2_monthly_goal ?? ''),
      q3_monthly_goal: String(row.q3_monthly_goal ?? ''),
      q4_monthly_goal: String(row.q4_monthly_goal ?? ''),
      starting_date: asText(row.starting_date),
      ending_date: asText(row.ending_date),
    })
    setFormError('')
    setFormSuccess('')
    setShowAddForm(true)
  }

  const handleDeleteRecord = async (event, row) => {
    event.stopPropagation()
    const employeeCode = asText(row.employee_code)
    if (!employeeCode) return

    const confirmed = window.confirm(`Delete goal record for ${employeeCode}?`)
    if (!confirmed) return

    try {
      setLoading(true)
      let deleteError = null
      const rowId = asText(row.id)

      if (rowId) {
        const response = await supabase
          .from('goals_master')
          .delete()
          .eq('id', rowId)
        deleteError = response.error
      } else {
        const response = await supabase
          .from('goals_master')
          .delete()
          .eq('employee_code', employeeCode)
        deleteError = response.error
      }

      if (deleteError) throw deleteError

      await cacheDelete('goal_master_table_rows_v1')
      await loadData()
    } catch (err) {
      console.error('Error deleting goal record:', err)
      setError(err.message || 'Failed to delete record')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadReport = () => {
    const exportRows = filteredRows.map(row => ({
      employee_code: row.employee_code || '',
      employee_name: row.employee_name || '',
      reporting_manager: row.reporting_manager || '',
      reporting_manager_id: row.reporting_manager_id || '',
      designation: row.designation || '',
      q1_monthly_goal: Number(row.q1_monthly_goal || 0),
      q2_monthly_goal: Number(row.q2_monthly_goal || 0),
      q3_monthly_goal: Number(row.q3_monthly_goal || 0),
      q4_monthly_goal: Number(row.q4_monthly_goal || 0),
      starting_date: row.starting_date || '',
      ending_date: row.ending_date || '',
    }))

    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Goal_Master')

    const stamp = new Date()
    const fileName = `Goal_Master_Report_${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}.xlsx`
    XLSX.writeFile(workbook, fileName)
  }

  const handleUploadReport = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadMessage({ type: '', text: '' })
    setUploading(true)

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const firstSheet = workbook.SheetNames[0]
      if (!firstSheet) throw new Error('No sheet found in uploaded file')

      const sheet = workbook.Sheets[firstSheet]
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      const payloadRows = rawRows
        .map(row => {
          const employeeCode = asText(pickCell(row, ['employee_code', 'employee code', 'employeecode']))
          const q1Goal = Number(pickCell(row, ['q1_monthly_goal', 'q1 monthly goal', 'q1goal', 'q1']))
          const q2Goal = Number(pickCell(row, ['q2_monthly_goal', 'q2 monthly goal', 'q2goal', 'q2']))
          const q3Goal = Number(pickCell(row, ['q3_monthly_goal', 'q3 monthly goal', 'q3goal', 'q3']))
          const q4Goal = Number(pickCell(row, ['q4_monthly_goal', 'q4 monthly goal', 'q4goal', 'q4']))

          if (!employeeCode) return null
          if (![q1Goal, q2Goal, q3Goal, q4Goal].every(Number.isFinite)) return null

          return {
            employee_code: employeeCode,
            employee_name: asText(pickCell(row, ['employee_name', 'employee name'])) || null,
            reporting_manager: asText(pickCell(row, ['reporting_manager', 'reporting manager'])) || null,
            reporting_manager_id: asText(pickCell(row, ['reporting_manager_id', 'reporting manager id', 'reporting manager code'])) || null,
            designation: asText(pickCell(row, ['designation'])) || null,
            q1_monthly_goal: q1Goal,
            q2_monthly_goal: q2Goal,
            q3_monthly_goal: q3Goal,
            q4_monthly_goal: q4Goal,
            starting_date: parseDateInput(pickCell(row, ['starting_date', 'starting date'])) || null,
            ending_date: parseDateInput(pickCell(row, ['ending_date', 'ending date'])) || null,
          }
        })
        .filter(Boolean)

      if (payloadRows.length === 0) {
        throw new Error('No valid rows found. Ensure employee_code and q1/q2/q3/q4 monthly goals are present.')
      }

      for (const row of payloadRows) {
        const { error: upsertError } = await supabase
          .from('goals_master')
          .upsert(row, { onConflict: 'employee_code' })
        if (upsertError) throw upsertError
      }

      await cacheDelete('goal_master_table_rows_v1')
      await loadData()
      setUploadMessage({
        type: 'success',
        text: `Upload successful. Saved ${payloadRows.length} goal record(s).`,
      })
    } catch (err) {
      console.error('Goal report upload failed:', err)
      if (String(err?.message || '').toLowerCase().includes('duplicate')) {
        setUploadMessage({
          type: 'error',
          text: 'Upload failed because this environment still has legacy UNIQUE(employee_code) on goals_master. Run the latest goals_master history migration and retry.',
        })
      } else {
        setUploadMessage({ type: 'error', text: err.message || 'Failed to upload report.' })
      }
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleOpenDetails = async (row) => {
    const employeeCode = asText(row?.employee_code)
    if (!employeeCode) return

    setSelectedEmployee({
      employee_code: employeeCode,
      employee_name: asText(row?.employee_name),
    })
    setShowDetailModal(true)
    setDetailLoading(true)
    setDetailError('')
    setDetailRows([])
    setDetailQuarterFilter('All')
    setDetailSortOrder('latest')
    setEditingDetailRowId('')
    setDetailEditData({ monthly_sheet_goal: '', starting_date: '', ending_date: '' })

    try {
      const { data, error } = await supabase
        .from('goals_master')
        .select('id, employee_code, employee_name, reporting_manager, reporting_manager_id, designation, q1_monthly_goal, q2_monthly_goal, q3_monthly_goal, q4_monthly_goal, starting_date, ending_date, updated_at')
        .eq('employee_code', employeeCode)
        .order('starting_date', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false, nullsFirst: false })

      if (error) throw error

      const latestRow = (data || [])[0] || null
      const fourQuarterRows = ensureFourQuarterRows(latestRow, row).map(item => ({
        ...item,
        duration_label: getDurationLabel(item.starting_date, item.ending_date),
      }))

      if (!mountedRef.current) return
      setDetailRows(fourQuarterRows)
    } catch (err) {
      console.error('Error loading goal details:', err)
      if (mountedRef.current) setDetailError(err.message || 'Failed to load goal details')
    } finally {
      if (mountedRef.current) setDetailLoading(false)
    }
  }

  const detailQuarterOptions = useMemo(() => {
    const values = Array.from(new Set(detailRows.map(item => asText(item.quarter)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
    return ['All', ...values]
  }, [detailRows])

  const visibleDetailRows = useMemo(() => {
    const filtered = detailRows.filter(item =>
      detailQuarterFilter === 'All' || asText(item.quarter) === detailQuarterFilter
    )

    const sorted = [...filtered].sort((a, b) => {
      const ta = new Date(a.starting_date || a.updated_at || 0).getTime()
      const tb = new Date(b.starting_date || b.updated_at || 0).getTime()
      return detailSortOrder === 'latest' ? tb - ta : ta - tb
    })

    return sorted
  }, [detailRows, detailQuarterFilter, detailSortOrder])

  const detailStats = useMemo(() => {
    const totalRecords = visibleDetailRows.length
    const totalGoal = visibleDetailRows.reduce((sum, item) => sum + Number(item.monthly_sheet_goal || 0), 0)
    const avgGoal = totalRecords > 0 ? Math.round(totalGoal / totalRecords) : 0

    return { totalRecords, totalGoal, avgGoal }
  }, [visibleDetailRows])

  const startDetailEdit = (item) => {
    setEditingDetailRowId(asText(item?.id))
    setDetailEditData({
      monthly_sheet_goal: String(item?.monthly_sheet_goal ?? ''),
      starting_date: asText(item?.starting_date),
      ending_date: asText(item?.ending_date),
    })
    setDetailError('')
  }

  const cancelDetailEdit = () => {
    setEditingDetailRowId('')
    setDetailEditData({ monthly_sheet_goal: '', starting_date: '', ending_date: '' })
  }

  const saveDetailEdit = async (item) => {
    const rowId = asText(item?.id)
    const quarter = normalizeQuarter(item?.quarter)
    const goalColumn = getQuarterColumn(quarter)

    const goalValue = Number(detailEditData.monthly_sheet_goal)
    const startDate = asText(detailEditData.starting_date)
    const endDate = asText(detailEditData.ending_date)

    if (!Number.isFinite(goalValue) || goalValue < 0) {
      setDetailError('Monthly Sheet Goal must be a valid non-negative number.')
      return
    }

    if (startDate && endDate && startDate > endDate) {
      setDetailError('Ending Date cannot be earlier than Starting Date.')
      return
    }

    try {
      setSaving(true)
      setDetailError('')

      if (!rowId || !goalColumn) throw new Error('Unable to save quarter goal because row id or quarter is missing.')

      const { error: updateError } = await supabase
        .from('goals_master')
        .update({
          [goalColumn]: goalValue,
          starting_date: startDate || null,
          ending_date: endDate || null,
        })
        .eq('id', rowId)

      if (updateError) throw updateError

      const updatedRows = detailRows.map(detailRow => {
        const isCurrentRow = asText(detailRow.id) === rowId && normalizeQuarter(detailRow.quarter) === quarter

        if (!isCurrentRow) return detailRow

        const updatedRow = {
          ...detailRow,
          monthly_sheet_goal: goalValue,
          [goalColumn]: goalValue,
          starting_date: startDate || null,
          ending_date: endDate || null,
        }

        return {
          ...updatedRow,
          duration_label: getDurationLabel(updatedRow.starting_date, updatedRow.ending_date),
        }
      })

      setDetailRows(updatedRows)
      await cacheDelete('goal_master_table_rows_v1')
      await loadData()

      if (selectedEmployee?.employee_code) {
        const { data, error } = await supabase
          .from('goals_master')
          .select('id, employee_code, employee_name, reporting_manager, reporting_manager_id, designation, q1_monthly_goal, q2_monthly_goal, q3_monthly_goal, q4_monthly_goal, starting_date, ending_date, updated_at')
          .eq('employee_code', selectedEmployee.employee_code)
          .order('starting_date', { ascending: false, nullsFirst: false })
          .order('updated_at', { ascending: false, nullsFirst: false })

        if (!error) {
          const refreshed = ensureFourQuarterRows(
            (data || [])[0] || null,
            {
              employee_code: selectedEmployee.employee_code,
              employee_name: selectedEmployee.employee_name,
              reporting_manager: item.reporting_manager,
              reporting_manager_id: item.reporting_manager_id,
              designation: item.designation,
            }
          ).map(rowData => ({
            ...rowData,
            duration_label: getDurationLabel(rowData.starting_date, rowData.ending_date),
          }))

          setDetailRows(refreshed)
        }
      }

      cancelDetailEdit()
    } catch (err) {
      console.error('Error updating detail row:', err)
      setDetailError(err.message || 'Failed to update goal details.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="gm-main">
      <section className="gm-header">
        <div>
          <h2>Goal Master</h2>
          <p>All users and their mapped goals from goals_master</p>
        </div>
        <div className="gm-header-actions">
          <button
            className="gm-add"
            onClick={openCreateForm}
          >
            <i className="fa-solid fa-plus"></i>
            Add New Record
          </button>
          <button
            type="button"
            className="gm-action-header-btn"
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
          >
            <i className={`fa-solid ${uploading ? 'fa-spinner fa-spin' : 'fa-file-arrow-up'}`}></i>
            {uploading ? 'Uploading...' : 'Upload Report'}
          </button>
          <button
            type="button"
            className="gm-action-header-btn"
            onClick={handleDownloadReport}
            disabled={loading || filteredRows.length === 0}
          >
            <i className="fa-solid fa-file-arrow-down"></i>
            Download Report
          </button>
          <button className="gm-refresh" onClick={loadData} disabled={loading}>
            <i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`}></i>
            Refresh
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="gm-upload-input"
            onChange={handleUploadReport}
          />
        </div>
      </section>

      {uploadMessage.text && (
        <div className={`gm-upload-message ${uploadMessage.type === 'error' ? 'gm-upload-error' : 'gm-upload-success'}`}>
          {uploadMessage.text}
        </div>
      )}

      <section className="gm-filters">
        <div className="gm-search">
          <i className="fa-solid fa-search"></i>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by employee, manager, or code"
          />
        </div>

        <select
          value={designationFilter}
          onChange={(event) => setDesignationFilter(event.target.value)}
          className="gm-quarter"
        >
          {designationOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </section>

      <section className="gm-table-wrap">
        {loading ? (
          <div className="gm-state"><i className="fa-solid fa-spinner fa-spin"></i> Loading Goal Master data...</div>
        ) : error ? (
          <div className="gm-state gm-error">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="gm-state">No rows found.</div>
        ) : (
          <table className="gm-table">
            <thead>
              <tr>
                <th>Employee Code</th>
                <th>Employee Name</th>
                <th>Reporting Manager</th>
                <th>Reporting Manager ID</th>
                <th>Designation</th>
                <th>Q1 Goal</th>
                <th>Q2 Goal</th>
                <th>Q3 Goal</th>
                <th>Q4 Goal</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.employee_code || `${row.employee_name}-${row.reporting_manager_id}`}
                  className="gm-row-clickable"
                  onClick={() => handleOpenDetails(row)}
                  title="Click to view goal details"
                >
                  <td>{row.employee_code || '-'}</td>
                  <td>{row.employee_name || '-'}</td>
                  <td>{row.reporting_manager || '-'}</td>
                  <td>{row.reporting_manager_id || '-'}</td>
                  <td>{row.designation || '-'}</td>
                  <td>{Number(row.q1_monthly_goal || 0).toLocaleString()}</td>
                  <td>{Number(row.q2_monthly_goal || 0).toLocaleString()}</td>
                  <td>{Number(row.q3_monthly_goal || 0).toLocaleString()}</td>
                  <td>{Number(row.q4_monthly_goal || 0).toLocaleString()}</td>
                  <td>
                    <div className="gm-row-actions">
                      <button type="button" className="gm-action-btn gm-action-edit" onClick={(event) => openEditForm(event, row)}>
                        <i className="fa-solid fa-pen"></i>
                        Edit
                      </button>
                      <button type="button" className="gm-action-btn gm-action-delete" onClick={(event) => handleDeleteRecord(event, row)}>
                        <i className="fa-solid fa-trash"></i>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showAddForm && (
        <div className="gm-modal-backdrop" onClick={() => setShowAddForm(false)}>
          <section className="gm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="gm-modal-header">
              <h3>{editingEmployeeCode ? 'Edit Goal Record' : 'Add Goal Record'}</h3>
              <button
                type="button"
                className="gm-modal-close"
                onClick={() => {
                  setShowAddForm(false)
                  resetForm()
                }}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form className="gm-add-form" onSubmit={handleAddRecord}>
              <div className="gm-field">
                <label>Employee Code *</label>
                <input
                  value={formData.employee_code}
                  onChange={(event) => handleFormChange('employee_code', event.target.value)}
                  placeholder="e.g. D10234"
                  disabled={Boolean(editingEmployeeCode)}
                  required
                />
              </div>

              <div className="gm-field">
                <label>Employee Name</label>
                <input
                  value={formData.employee_name}
                  onChange={(event) => handleFormChange('employee_name', event.target.value)}
                  placeholder="Employee full name"
                />
              </div>

              <div className="gm-field">
                <label>Reporting Manager</label>
                <input
                  value={formData.reporting_manager}
                  onChange={(event) => handleFormChange('reporting_manager', event.target.value)}
                  placeholder="Manager name"
                />
              </div>

              <div className="gm-field">
                <label>Reporting Manager ID</label>
                <input
                  value={formData.reporting_manager_id}
                  onChange={(event) => handleFormChange('reporting_manager_id', event.target.value)}
                  placeholder="e.g. S10008"
                />
              </div>

              <div className="gm-field">
                <label>Designation</label>
                <input
                  value={formData.designation}
                  onChange={(event) => handleFormChange('designation', event.target.value)}
                  placeholder="ASM / DGO"
                />
              </div>

              <div className="gm-field">
                <label>Q1 Monthly Goal *</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.q1_monthly_goal}
                  onChange={(event) => handleFormChange('q1_monthly_goal', event.target.value)}
                  placeholder="e.g. 500"
                  required
                />
              </div>

              <div className="gm-field">
                <label>Q2 Monthly Goal *</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.q2_monthly_goal}
                  onChange={(event) => handleFormChange('q2_monthly_goal', event.target.value)}
                  placeholder="e.g. 500"
                  required
                />
              </div>

              <div className="gm-field">
                <label>Q3 Monthly Goal *</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.q3_monthly_goal}
                  onChange={(event) => handleFormChange('q3_monthly_goal', event.target.value)}
                  placeholder="e.g. 500"
                  required
                />
              </div>

              <div className="gm-field">
                <label>Q4 Monthly Goal *</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.q4_monthly_goal}
                  onChange={(event) => handleFormChange('q4_monthly_goal', event.target.value)}
                  placeholder="e.g. 500"
                  required
                />
              </div>

              <div className="gm-field">
                <label>Starting Date</label>
                <input
                  type="date"
                  value={formData.starting_date}
                  onChange={(event) => handleFormChange('starting_date', event.target.value)}
                />
              </div>

              <div className="gm-field">
                <label>Ending Date</label>
                <input
                  type="date"
                  value={formData.ending_date}
                  onChange={(event) => handleFormChange('ending_date', event.target.value)}
                />
              </div>

              <div className="gm-form-actions">
                <button type="button" className="gm-btn-secondary" onClick={resetForm} disabled={saving}>
                  Reset
                </button>
                <button type="button" className="gm-btn-secondary" onClick={() => {
                  setShowAddForm(false)
                  resetForm()
                }} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="gm-btn-primary" disabled={saving}>
                  <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                  {saving ? 'Saving...' : (editingEmployeeCode ? 'Update Record' : 'Save Record')}
                </button>
              </div>

              {formError && <div className="gm-form-message gm-form-error">{formError}</div>}
              {formSuccess && <div className="gm-form-message gm-form-success">{formSuccess}</div>}
            </form>
          </section>
        </div>
      )}

      {showDetailModal && (
        <div className="gm-drawer-backdrop" onClick={() => setShowDetailModal(false)}>
          <aside className="gm-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="gm-drawer-header">
              <h3>Goal Details</h3>
              <button
                type="button"
                className="gm-modal-close"
                onClick={() => setShowDetailModal(false)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <p className="gm-drawer-subtitle">
              {selectedEmployee?.employee_name || '-'} ({selectedEmployee?.employee_code || '-'})
            </p>

            {detailLoading ? (
              <div className="gm-state"><i className="fa-solid fa-spinner fa-spin"></i> Loading details...</div>
            ) : detailError ? (
              <div className="gm-state gm-error">{detailError}</div>
            ) : detailRows.length === 0 ? (
              <div className="gm-state">No goal records found for this employee.</div>
            ) : (
              <>
                <div className="gm-detail-toolbar">
                  <div className="gm-stat-chips">
                    <span className="gm-chip"><strong>{detailStats.totalRecords}</strong> Records</span>
                    <span className="gm-chip"><strong>{detailStats.totalGoal.toLocaleString()}</strong> Total Goal</span>
                    <span className="gm-chip"><strong>{detailStats.avgGoal.toLocaleString()}</strong> Avg Goal</span>
                  </div>
                  <div className="gm-detail-controls">
                    <select
                      value={detailQuarterFilter}
                      onChange={(event) => setDetailQuarterFilter(event.target.value)}
                      className="gm-quarter"
                    >
                      {detailQuarterOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="gm-btn-secondary"
                      onClick={() => setDetailSortOrder(prev => (prev === 'latest' ? 'oldest' : 'latest'))}
                    >
                      <i className="fa-solid fa-arrow-up-wide-short"></i>
                      {detailSortOrder === 'latest' ? 'Latest First' : 'Oldest First'}
                    </button>
                  </div>
                </div>

                <div className="gm-detail-table-wrap">
                <table className="gm-table gm-detail-table">
                  <thead>
                    <tr>
                      <th>Quarter</th>
                      <th>Monthly Sheet Goal</th>
                      <th>Updated At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDetailRows.map((item, index) => (
                      <tr key={`${item.employee_code || 'emp'}-${item.updated_at || index}-${index}`}>
                        <td>{asText(item.quarter) || '-'}</td>
                        <td>
                          {editingDetailRowId === asText(item.id) ? (
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={detailEditData.monthly_sheet_goal}
                              onChange={(event) => setDetailEditData(prev => ({ ...prev, monthly_sheet_goal: event.target.value }))}
                            />
                          ) : Number(item.monthly_sheet_goal || 0).toLocaleString()}
                        </td>
                        <td>{formatDate(item.updated_at)}</td>
                        <td>
                          {editingDetailRowId === asText(item.id) ? (
                            <div className="gm-row-actions">
                              <button
                                type="button"
                                className="gm-action-btn gm-action-edit"
                                onClick={() => saveDetailEdit(item)}
                                disabled={saving}
                              >
                                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                                Save
                              </button>
                              <button
                                type="button"
                                className="gm-action-btn gm-action-delete"
                                onClick={cancelDetailEdit}
                                disabled={saving}
                              >
                                <i className="fa-solid fa-xmark"></i>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="gm-action-btn gm-action-edit"
                              onClick={() => startDetailEdit(item)}
                            >
                              <i className="fa-solid fa-pen"></i>
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}

export default GoalMaster
