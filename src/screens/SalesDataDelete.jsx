import { useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useNotification } from '../contexts/NotificationContext'
import './SalesDataDelete.css'

function SalesDataDelete() {
  const { showNotification } = useNotification()
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loadingCount, setLoadingCount] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [count, setCount] = useState(null)
  const [warTaskCount, setWarTaskCount] = useState(null)
  const [loadingWarTaskCount, setLoadingWarTaskCount] = useState(false)
  const [deletingWarTask, setDeletingWarTask] = useState(false)

  const canCheck = useMemo(() => Boolean(fromDate && toDate && fromDate <= toDate), [fromDate, toDate])

  const handleCheckRecords = async () => {
    if (!canCheck) {
      showNotification('Please choose a valid date range', 'warning')
      return
    }

    try {
      setLoadingCount(true)
      const { count: records, error } = await supabase
        .from('monthly_attendance_report')
        .select('*', { count: 'exact', head: true })
        .gte('attendance_date', fromDate)
        .lte('attendance_date', toDate)

      if (error) throw error
      setCount(records || 0)
    } catch (error) {
      showNotification('Failed to check records: ' + error.message, 'error')
    } finally {
      setLoadingCount(false)
    }
  }

  const handleDelete = async () => {
    if (!canCheck) {
      showNotification('Please choose a valid date range', 'warning')
      return
    }

    try {
      setDeleting(true)

      const { count: records, error: countError } = await supabase
        .from('monthly_attendance_report')
        .select('*', { count: 'exact', head: true })
        .gte('attendance_date', fromDate)
        .lte('attendance_date', toDate)

      if (countError) throw countError

      const total = records || 0
      if (total === 0) {
        setCount(0)
        showNotification('No records found in selected range', 'warning')
        return
      }

      const confirmed = window.confirm(
        `Delete ${total} attendance record(s) from ${fromDate} to ${toDate}? This cannot be undone.`
      )
      if (!confirmed) return

      const { error } = await supabase
        .from('monthly_attendance_report')
        .delete()
        .gte('attendance_date', fromDate)
        .lte('attendance_date', toDate)

      if (error) throw error

      setCount(0)
      showNotification(`Deleted ${total} attendance record(s) successfully`, 'success')
    } catch (error) {
      showNotification('Delete failed: ' + error.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const handleCheckWarTaskRecords = async () => {
    try {
      setLoadingWarTaskCount(true)
      const { count: records, error } = await supabase
        .from('telecalling_influencer_wartask')
        .select('*', { count: 'exact', head: true })

      if (error) throw error
      setWarTaskCount(records || 0)
    } catch (error) {
      showNotification('Failed to check TeleCalling records: ' + error.message, 'error')
    } finally {
      setLoadingWarTaskCount(false)
    }
  }

  const handleDeleteAllWarTaskRecords = async () => {
    try {
      setDeletingWarTask(true)

      const { count: records, error: countError } = await supabase
        .from('telecalling_influencer_wartask')
        .select('*', { count: 'exact', head: true })

      if (countError) throw countError

      const total = records || 0
      if (total === 0) {
        setWarTaskCount(0)
        showNotification('No TeleCalling records found to delete', 'warning')
        return
      }

      const confirmed = window.confirm(
        `Delete all ${total} row(s) from telecalling_influencer_wartask? This cannot be undone.`
      )
      if (!confirmed) return

      const { error: deleteNonNullError } = await supabase
        .from('telecalling_influencer_wartask')
        .delete()
        .not('task_no', 'is', null)

      if (deleteNonNullError) throw deleteNonNullError

      const { error: deleteNullError } = await supabase
        .from('telecalling_influencer_wartask')
        .delete()
        .is('task_no', null)

      if (deleteNullError) throw deleteNullError

      setWarTaskCount(0)
      showNotification(`Deleted ${total} TeleCalling row(s) successfully`, 'success')
    } catch (error) {
      showNotification('Delete failed: ' + error.message, 'error')
    } finally {
      setDeletingWarTask(false)
    }
  }

  return (
    <main className="sales-delete-main">
      <section className="sales-delete-header">
        <div>
          <h2>Sales Data Delete</h2>
          <p>Delete records from Monthly Attendance and TeleCalling sales tables</p>
        </div>
      </section>

      <section className="sales-delete-card">
        <h3>
          <i className="fa-solid fa-trash-can"></i>
          Monthly Attendance Report
        </h3>

        <div className="sales-delete-grid">
          <div className="sales-delete-field">
            <label htmlFor="from_date">From Date</label>
            <input
              id="from_date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="sales-delete-field">
            <label htmlFor="to_date">To Date</label>
            <input
              id="to_date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>

        <div className="sales-delete-actions">
          <button
            className="btn-check"
            onClick={handleCheckRecords}
            disabled={!canCheck || loadingCount || deleting}
          >
            {loadingCount ? (
              <><i className="fa-solid fa-spinner fa-spin"></i> Checking...</>
            ) : (
              <><i className="fa-solid fa-magnifying-glass"></i> Check Records</>
            )}
          </button>

          <button
            className="btn-delete"
            onClick={handleDelete}
            disabled={!canCheck || deleting || loadingCount}
          >
            {deleting ? (
              <><i className="fa-solid fa-spinner fa-spin"></i> Deleting...</>
            ) : (
              <><i className="fa-solid fa-trash"></i> Delete by Date Range</>
            )}
          </button>
        </div>

        <div className="sales-delete-info">
          <span>Table: monthly_attendance_report</span>
          <span>Column: attendance_date</span>
          {count !== null && <span>Matching Records: {count}</span>}
        </div>
      </section>

      <section className="sales-delete-card">
        <h3>
          <i className="fa-solid fa-phone-volume"></i>
          TeleCalling Influencer War Task
        </h3>

        <div className="sales-delete-actions">
          <button
            className="btn-check"
            onClick={handleCheckWarTaskRecords}
            disabled={loadingWarTaskCount || deletingWarTask}
          >
            {loadingWarTaskCount ? (
              <><i className="fa-solid fa-spinner fa-spin"></i> Checking...</>
            ) : (
              <><i className="fa-solid fa-magnifying-glass"></i> Check Records</>
            )}
          </button>

          <button
            className="btn-delete-all"
            onClick={handleDeleteAllWarTaskRecords}
            disabled={deletingWarTask || loadingWarTaskCount}
          >
            {deletingWarTask ? (
              <><i className="fa-solid fa-spinner fa-spin"></i> Deleting...</>
            ) : (
              <><i className="fa-solid fa-trash"></i> Delete All Rows</>
            )}
          </button>
        </div>

        <div className="sales-delete-info">
          <span>Table: telecalling_influencer_wartask</span>
          {warTaskCount !== null && <span>Total Records: {warTaskCount}</span>}
        </div>
      </section>
    </main>
  )
}

export default SalesDataDelete
