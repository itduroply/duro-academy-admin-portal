import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import './OnrollOffrole.css'

const EMPTY_FORM = {
  oldEmployeeId: '',
  newEmployeeId: '',
  dateOfChange: '',
}

function formatDate(dateText) {
  if (!dateText) return '-'
  const d = new Date(dateText)
  if (Number.isNaN(d.getTime())) return dateText
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function OnrollOffrole() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState(EMPTY_FORM)

  const loadRows = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const { data, error } = await supabase
        .from('employee_id_change_log')
        .select('id, employee_name, old_employee_id, new_employee_id, date_of_change, created_at')
        .order('date_of_change', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Failed to load Onroll-Offrole report')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  const reportRows = useMemo(() => rows.map((row) => ({
    id: row.id,
    employeeName: row.employee_name || '-',
    oldEmployeeId: row.old_employee_id || '-',
    newEmployeeId: row.new_employee_id || '-',
    dateOfChange: row.date_of_change || '',
  })), [rows])

  const openModal = () => {
    setFormData(EMPTY_FORM)
    setFormError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (submitting) return
    setModalOpen(false)
    setFormError('')
    setFormData(EMPTY_FORM)
  }

  const onInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setFormError('')

    const oldEmployeeId = formData.oldEmployeeId.trim()
    const newEmployeeId = formData.newEmployeeId.trim()
    const dateOfChange = formData.dateOfChange

    if (!oldEmployeeId || !newEmployeeId || !dateOfChange) {
      setFormError('All fields are required')
      return
    }

    if (oldEmployeeId.toLowerCase() === newEmployeeId.toLowerCase()) {
      setFormError('Old Employee ID and New Employee ID cannot be the same')
      return
    }

    try {
      setSubmitting(true)

      const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('employee_id', oldEmployeeId)
        .maybeSingle()

      if (userError) throw userError

      const { error: rpcError } = await supabase.rpc('propagate_employee_id_change', {
        p_old_employee_id: oldEmployeeId,
        p_new_employee_id: newEmployeeId,
        p_date_of_change: dateOfChange,
        p_employee_name: userRow?.full_name || null,
      })

      if (rpcError) throw rpcError

      closeModal()
      await loadRows()
    } catch (err) {
      setFormError(err.message || 'Failed to update employee ID')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="oor-main">
      <div className="oor-header">
        <div>
          <h1>Onroll-Offrole</h1>
          <p>Employee ID change report</p>
        </div>
        <button className="oor-btn-primary" onClick={openModal}>
          <i className="fa-solid fa-pen-to-square"></i>
          Update Employee ID
        </button>
      </div>

      <section className="oor-card">
        {loading ? (
          <div className="oor-state"><i className="fa-solid fa-spinner fa-spin"></i> Loading report...</div>
        ) : error ? (
          <div className="oor-error">{error}</div>
        ) : reportRows.length === 0 ? (
          <div className="oor-state">No records found.</div>
        ) : (
          <div className="oor-table-wrap">
            <table className="oor-table">
              <thead>
                <tr>
                  <th>Employee Name</th>
                  <th>Old Employee ID</th>
                  <th>New Employee ID</th>
                  <th>Date Of Change</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.employeeName}</td>
                    <td>{row.oldEmployeeId}</td>
                    <td>{row.newEmployeeId}</td>
                    <td>{formatDate(row.dateOfChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="oor-modal-backdrop" onClick={closeModal}>
          <div className="oor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="oor-modal-header">
              <h3>Update Employee ID</h3>
              <button className="oor-close-btn" onClick={closeModal}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form className="oor-form" onSubmit={onSubmit}>
              <div className="oor-form-group">
                <label htmlFor="oldEmployeeId">Old Employee ID</label>
                <input
                  id="oldEmployeeId"
                  name="oldEmployeeId"
                  type="text"
                  value={formData.oldEmployeeId}
                  onChange={onInputChange}
                  placeholder="Enter old employee ID"
                  required
                />
              </div>

              <div className="oor-form-group">
                <label htmlFor="newEmployeeId">New Employee ID</label>
                <input
                  id="newEmployeeId"
                  name="newEmployeeId"
                  type="text"
                  value={formData.newEmployeeId}
                  onChange={onInputChange}
                  placeholder="Enter new employee ID"
                  required
                />
              </div>

              <div className="oor-form-group">
                <label htmlFor="dateOfChange">Date of Change</label>
                <input
                  id="dateOfChange"
                  name="dateOfChange"
                  type="date"
                  value={formData.dateOfChange}
                  onChange={onInputChange}
                  required
                />
              </div>

              {formError && <div className="oor-error">{formError}</div>}

              <div className="oor-form-actions">
                <button type="button" className="oor-btn-secondary" onClick={closeModal} disabled={submitting}>Cancel</button>
                <button type="submit" className="oor-btn-primary" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
