import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import { cacheDelete, cachedFetch, TTL } from '../utils/cacheDB'
import { useNotification } from '../contexts/NotificationContext'
import { useAuth } from '../contexts/AuthContext'
import { SCREENS } from '../config/permissions'
import './DealerManagement.css'

function asText(value) {
  return String(value || '').trim()
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

const CACHE_KEY = 'dealer_management_rows_v1'

const EMPTY_FORM = {
  customer_code: '',
  customer_name: '',
  sales_rep_name: '',
  employee_id: '',
}

function DealerManagement() {
  const mountedRef = useRef(true)
  const uploadInputRef = useRef(null)
  const { showNotification } = useNotification()
  const { hasActionAccess } = useAuth()

  const canEdit = hasActionAccess(SCREENS.DEALER_MANAGEMENT, 'edit')
  const canDelete = hasActionAccess(SCREENS.DEALER_MANAGEMENT, 'delete')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const [showFormModal, setShowFormModal] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [formData, setFormData] = useState(EMPTY_FORM)

  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState({ type: '', text: '', errors: [] })

  const resetForm = useCallback(() => {
    setFormData(EMPTY_FORM)
    setFormError('')
    setFormSuccess('')
    setEditingId('')
  }, [])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const { data } = await cachedFetch(
        CACHE_KEY,
        async () => {
          const { data, error } = await supabase
            .from('dealers')
            .select('id, customer_code, customer_name, sales_rep_name, employee_id, updated_at')
            .order('customer_name', { ascending: true })

          if (error) throw error
          return data || []
        },
        TTL.SHORT
      )

      if (!mountedRef.current) return
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error loading dealer records:', err)
      if (mountedRef.current) setError(err.message || 'Failed to load dealer records')
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

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows

    return rows.filter(row =>
      asText(row.customer_code).toLowerCase().includes(query)
      || asText(row.customer_name).toLowerCase().includes(query)
      || asText(row.sales_rep_name).toLowerCase().includes(query)
      || asText(row.employee_id).toLowerCase().includes(query)
    )
  }, [rows, search])

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const openCreateForm = () => {
    if (!canEdit) {
      showNotification('You do not have edit permission for Dealer Management.', 'error')
      return
    }
    resetForm()
    setShowFormModal(true)
  }

  const openEditForm = (event, row) => {
    event.stopPropagation()
    if (!canEdit) {
      showNotification('You do not have edit permission for Dealer Management.', 'error')
      return
    }
    setEditingId(row.id)
    setFormData({
      customer_code: asText(row.customer_code),
      customer_name: asText(row.customer_name),
      sales_rep_name: asText(row.sales_rep_name),
      employee_id: asText(row.employee_id),
    })
    setFormError('')
    setFormSuccess('')
    setShowFormModal(true)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError('')
    setFormSuccess('')

    const customerCode = asText(formData.customer_code)
    const customerName = asText(formData.customer_name)

    if (!customerCode || !customerName) {
      setFormError('Customer Code and Customer Name are required.')
      return
    }

    try {
      setSaving(true)

      const payload = {
        customer_code: customerCode,
        customer_name: customerName,
        sales_rep_name: asText(formData.sales_rep_name) || null,
        employee_id: asText(formData.employee_id) || null,
      }

      if (editingId) {
        const { error: updateError } = await supabase
          .from('dealers')
          .update(payload)
          .eq('id', editingId)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase
          .from('dealers')
          .insert(payload)
        if (insertError) throw insertError
      }

      await cacheDelete(CACHE_KEY)
      await loadData()

      setFormSuccess(editingId ? 'Dealer updated successfully.' : 'Dealer added successfully.')
      resetForm()
      setShowFormModal(false)
    } catch (err) {
      console.error('Error saving dealer record:', err)
      if (String(err?.message || '').toLowerCase().includes('duplicate')) {
        setFormError('A dealer with this Customer Code already exists.')
      } else {
        setFormError(err.message || 'Failed to save dealer record.')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (event, row) => {
    event.stopPropagation()
    if (!canDelete) {
      showNotification('You do not have delete permission for Dealer Management.', 'error')
      return
    }

    const confirmed = window.confirm(`Delete dealer "${row.customer_name}" (${row.customer_code})?`)
    if (!confirmed) return

    try {
      setLoading(true)
      const { error: deleteError } = await supabase
        .from('dealers')
        .delete()
        .eq('id', row.id)

      if (deleteError) throw deleteError

      await cacheDelete(CACHE_KEY)
      await loadData()
    } catch (err) {
      console.error('Error deleting dealer record:', err)
      setError(err.message || 'Failed to delete dealer record')
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = () => {
    const template = [
      {
        'Customer Code*': 'CB0170',
        'Customer Name*': 'BALAJI PLYWOOD HOUSE',
        'Sales Representative Name': 'Rajendra Singh Rawat',
        'Employee ID': 'D10647',
      },
    ]

    const ws = XLSX.utils.json_to_sheet(template)
    ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 26 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Dealers Template')
    XLSX.writeFile(wb, 'dealer_management_template.xlsx')
  }

  const handleDownloadReport = () => {
    if (filteredRows.length === 0) {
      showNotification('No dealer records available to export', 'warning')
      return
    }

    const exportRows = filteredRows.map(row => ({
      'Customer Code': row.customer_code || '',
      'Customer Name': row.customer_name || '',
      'Sales Representative Name': row.sales_rep_name || '',
      'Employee ID': row.employee_id || '',
    }))

    const ws = XLSX.utils.json_to_sheet(exportRows)
    ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 26 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Dealers')

    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `dealer_management_${stamp}.xlsx`)
  }

  const handleUploadReport = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!canEdit) {
      showNotification('You do not have edit permission for Dealer Management.', 'error')
      event.target.value = ''
      return
    }

    setUploadMessage({ type: '', text: '', errors: [] })
    setUploading(true)

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const firstSheet = workbook.SheetNames[0]
      if (!firstSheet) throw new Error('No sheet found in uploaded file')

      const sheet = workbook.Sheets[firstSheet]
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      if (rawRows.length === 0) {
        throw new Error('The uploaded file has no data rows.')
      }

      const validRows = []
      const errors = []

      rawRows.forEach((row, index) => {
        const customerCode = asText(pickCell(row, ['customer_code', 'customer code', 'dealer code', 'code']))
        const customerName = asText(pickCell(row, ['customer_name', 'customer name', 'dealer name', 'name']))
        const salesRepName = asText(pickCell(row, ['sales_representative_name', 'sales representative name', 'sales rep name', 'sales_rep_name']))
        const employeeId = asText(pickCell(row, ['employee_id', 'employee id', 'emp id', 'empid']))

        if (!customerCode || !customerName) {
          errors.push({ row: index + 2, reason: 'Missing Customer Code or Customer Name' })
          return
        }

        validRows.push({
          customer_code: customerCode,
          customer_name: customerName,
          sales_rep_name: salesRepName || null,
          employee_id: employeeId || null,
        })
      })

      if (validRows.length === 0) {
        throw new Error('No valid rows found. Ensure Customer Code and Customer Name columns are present.')
      }

      const { error: upsertError } = await supabase
        .from('dealers')
        .upsert(validRows, { onConflict: 'customer_code' })

      if (upsertError) throw upsertError

      await cacheDelete(CACHE_KEY)
      await loadData()

      setUploadMessage({
        type: errors.length > 0 ? 'error' : 'success',
        text: `Uploaded ${validRows.length} record(s) successfully.${errors.length > 0 ? ` Skipped ${errors.length} invalid row(s).` : ''}`,
        errors,
      })
    } catch (err) {
      console.error('Dealer bulk upload failed:', err)
      setUploadMessage({ type: 'error', text: err.message || 'Failed to upload dealers.', errors: [] })
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  return (
    <main className="dm-main">
      <section className="dm-header">
        <div>
          <h2>Dealer Management</h2>
          <p>Dealer / customer master mapped to the sales representative who owns each account</p>
        </div>
        <div className="dm-header-actions">
          <button className="dm-add" onClick={openCreateForm} disabled={!canEdit}>
            <i className="fa-solid fa-plus"></i>
            Add New Dealer
          </button>
          <button
            type="button"
            className="dm-action-header-btn"
            onClick={() => uploadInputRef.current?.click()}
            disabled={!canEdit || uploading}
          >
            <i className={`fa-solid ${uploading ? 'fa-spinner fa-spin' : 'fa-file-arrow-up'}`}></i>
            {uploading ? 'Uploading...' : 'Bulk Upload'}
          </button>
          <button type="button" className="dm-action-header-btn" onClick={downloadTemplate}>
            <i className="fa-solid fa-file-export"></i>
            Download Template
          </button>
          <button
            type="button"
            className="dm-action-header-btn"
            onClick={handleDownloadReport}
            disabled={loading || filteredRows.length === 0}
          >
            <i className="fa-solid fa-file-arrow-down"></i>
            Download Data
          </button>
          <button className="dm-refresh" onClick={loadData} disabled={loading}>
            <i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`}></i>
            Refresh
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="dm-upload-input"
            onChange={handleUploadReport}
          />
        </div>
      </section>

      {uploadMessage.text && (
        <div className={`dm-upload-message ${uploadMessage.type === 'error' ? 'dm-upload-error' : 'dm-upload-success'}`}>
          {uploadMessage.text}
          {uploadMessage.errors?.length > 0 && (
            <ul className="dm-upload-errors-list">
              {uploadMessage.errors.slice(0, 20).map((e, idx) => (
                <li key={idx}>Row {e.row}: {e.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="dm-filters">
        <div className="dm-search">
          <i className="fa-solid fa-search"></i>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by customer code, customer name, sales rep, or employee ID"
          />
        </div>
      </section>

      <span className="dm-count-chip">{filteredRows.length} dealer{filteredRows.length === 1 ? '' : 's'}</span>

      <section className="dm-table-wrap" style={{ marginTop: '0.75rem' }}>
        {loading ? (
          <div className="dm-state"><i className="fa-solid fa-spinner fa-spin"></i> Loading dealer records...</div>
        ) : error ? (
          <div className="dm-state dm-error">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="dm-state">No dealers found. Add your first dealer!</div>
        ) : (
          <table className="dm-table">
            <thead>
              <tr>
                <th>Customer Code</th>
                <th>Customer Name</th>
                <th>Sales Representative Name</th>
                <th>Employee ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.customer_code || '-'}</td>
                  <td>{row.customer_name || '-'}</td>
                  <td>{row.sales_rep_name || '-'}</td>
                  <td>{row.employee_id || '-'}</td>
                  <td>
                    <div className="dm-row-actions">
                      {canEdit && (
                        <button type="button" className="dm-action-btn dm-action-edit" onClick={(event) => openEditForm(event, row)}>
                          <i className="fa-solid fa-pen"></i>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" className="dm-action-btn dm-action-delete" onClick={(event) => handleDelete(event, row)}>
                          <i className="fa-solid fa-trash"></i>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showFormModal && (
        <div className="dm-modal-backdrop" onClick={() => setShowFormModal(false)}>
          <section className="dm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="dm-modal-header">
              <h3>{editingId ? 'Edit Dealer' : 'Add Dealer'}</h3>
              <button
                type="button"
                className="dm-modal-close"
                onClick={() => { setShowFormModal(false); resetForm() }}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form className="dm-add-form" onSubmit={handleSubmit}>
              <div className="dm-field">
                <label>Customer Code *</label>
                <input
                  value={formData.customer_code}
                  onChange={(event) => handleFormChange('customer_code', event.target.value)}
                  placeholder="e.g. CB0170"
                  required
                />
              </div>

              <div className="dm-field">
                <label>Customer Name *</label>
                <input
                  value={formData.customer_name}
                  onChange={(event) => handleFormChange('customer_name', event.target.value)}
                  placeholder="e.g. BALAJI PLYWOOD HOUSE"
                  required
                />
              </div>

              <div className="dm-field">
                <label>Sales Representative Name</label>
                <input
                  value={formData.sales_rep_name}
                  onChange={(event) => handleFormChange('sales_rep_name', event.target.value)}
                  placeholder="e.g. Rajendra Singh Rawat"
                />
              </div>

              <div className="dm-field">
                <label>Employee ID</label>
                <input
                  value={formData.employee_id}
                  onChange={(event) => handleFormChange('employee_id', event.target.value)}
                  placeholder="e.g. D10647"
                />
              </div>

              <div className="dm-form-actions">
                <button type="button" className="dm-btn-secondary" onClick={() => { setShowFormModal(false); resetForm() }} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="dm-btn-primary" disabled={saving}>
                  <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                  {saving ? 'Saving...' : (editingId ? 'Update Dealer' : 'Save Dealer')}
                </button>
              </div>

              {formError && <div className="dm-form-message dm-form-error">{formError}</div>}
              {formSuccess && <div className="dm-form-message dm-form-success">{formSuccess}</div>}
            </form>
          </section>
        </div>
      )}
    </main>
  )
}

export default DealerManagement
