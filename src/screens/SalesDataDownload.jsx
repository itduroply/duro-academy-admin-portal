import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import './ExcelUpload.css'
import './SalesDataDownload.css'

const PAGE_SIZE = 1000

const SHEET_DOWNLOAD_CONFIGS = {
  influencer_claim: {
    label: 'Influencer Claim Stage Details',
    table: 'influencer_claim_details',
    icon: 'fa-solid fa-file-invoice',
    sheetName: 'InfluencerClaimStageDetails',
    fileName: 'InfluencerClaimStageDetails_Data.xlsx',
    columns: [
      { header: 'Parent Claim No', field: 'parent_claim_no' },
      { header: 'Claim No', field: 'claim_no' },
      { header: 'Claim Date', field: 'claim_date' },
      { header: 'Account Number', field: 'account_number' },
      { header: 'Influencer Name', field: 'influencer_name' },
      { header: 'Influencer Type', field: 'influencer_type' },
      { header: 'Influencer Market City', field: 'influencer_market_city' },
      { header: 'Mobile No', field: 'mobile_no' },
      { header: 'Pincode', field: 'pincode' },
      { header: 'Influencer City', field: 'influencer_city' },
      { header: 'Influencer District', field: 'influencer_district' },
      { header: 'Influencer State', field: 'influencer_state' },
      { header: 'Mapped ISR CODE', field: 'mapped_isr_code' },
      { header: 'Product Code', field: 'product_code' },
      { header: 'Dealer Name', field: 'dealer_name' },
      { header: 'Dealer Code', field: 'dealer_code' },
      { header: 'Claimed Qty(Sheets)', field: 'claimed_qty_sheets' },
      { header: 'Approved Qty', field: 'approved_qty' },
      { header: 'Approved Points', field: 'approved_points' },
      { header: 'Status', field: 'status' },
      { header: 'Influencer Tier', field: 'influencer_tier' },
    ],
  },
  influencer_enrollment: {
    label: 'Influencer Enrollment Detail',
    table: 'influencer_enrollment_details',
    icon: 'fa-solid fa-user-plus',
    sheetName: 'InfluencerEnrollmentDetail',
    fileName: 'InfluencerEnrollmentDetail_Data.xlsx',
    columns: [
      { header: 'Influencer ID', field: 'influencer_id' },
      { header: 'SE Name', field: 'se_name' },
      { header: 'Enrollment Date', field: 'enrollment_date' },
      { header: 'Influencer Name', field: 'influencer_name' },
      { header: 'Influencer Type', field: 'influencer_type' },
      { header: 'Mobile No', field: 'mobile_no' },
      { header: 'City', field: 'city' },
      { header: 'Market City', field: 'market_city' },
      { header: 'District', field: 'district' },
      { header: 'State', field: 'state' },
      { header: 'Pincode', field: 'pincode' },
      { header: 'Active Status', field: 'active_status' },
      { header: 'Opening Points', field: 'opening_points' },
      { header: 'Earned Points', field: 'earned_points' },
      { header: 'Redeemed Points', field: 'redeemed_points' },
      { header: 'Closing Points', field: 'closing_points' },
      { header: ' Influencer Tier', field: 'influencer_tier' },
    ],
  },
  influencer_visit: {
    label: 'Influencer Visit Report',
    table: 'influencer_visit_reports',
    icon: 'fa-solid fa-map-location-dot',
    sheetName: 'InfluencerVisitReportNew',
    fileName: 'InfluencerVisitReport_Data.xlsx',
    columns: [
      { header: 'Infuencer Code', field: 'influencer_code' },
      { header: 'Influencer Name', field: 'influencer_name' },
      { header: 'Visit Date', field: 'visit_date' },
      { header: 'Visit Time', field: 'visit_time' },
      { header: 'Infleuncer Location', field: 'influencer_location' },
      { header: 'District', field: 'district' },
      { header: 'State', field: 'state' },
      { header: 'Emp Login', field: 'emp_login' },
      { header: 'Emp Name', field: 'emp_name' },
      { header: 'Market City', field: 'market_city' },
      { header: 'Influencer Tier', field: 'influencer_tier' },
      { header: 'Days since last visit', field: 'days_since_last_visit' },
    ],
  },
  lead_details: {
    label: 'Lead Details Report',
    table: 'lead_details_reports',
    icon: 'fa-solid fa-bullseye',
    sheetName: 'LeadDetailsReport',
    fileName: 'LeadDetailsReport_Data.xlsx',
    columns: [
      { header: 'Lead Code', field: 'lead_code' },
      { header: 'Created Date', field: 'created_date' },
      { header: 'Project Name', field: 'project_name' },
      { header: 'City', field: 'city' },
      { header: 'District', field: 'district' },
      { header: 'State', field: 'state' },
      { header: 'Pincode', field: 'pincode' },
      { header: 'Source Of Lead', field: 'source_of_lead' },
      { header: 'Type Of Project', field: 'type_of_project' },
      { header: 'Lead Stage', field: 'lead_stage' },
      { header: 'Lead Status', field: 'lead_status' },
      { header: 'Lead Created By', field: 'lead_created_by' },
      { header: 'Market City', field: 'market_city' },
    ],
  },
  lead_task: {
    label: 'Lead Task Report',
    table: 'lead_task_reports',
    icon: 'fa-solid fa-list-check',
    sheetName: 'LeadTaskReport',
    fileName: 'LeadTaskReport_Data.xlsx',
    columns: [
      { header: ' Lead ID', field: 'lead_id' },
      { header: ' Lead Status', field: 'lead_status' },
      { header: 'Task Type', field: 'task_type' },
      { header: 'Task Assign To/DSO Code', field: 'task_assign_to_dso_code' },
      { header: 'Task Assign To/DSO Name', field: 'task_assign_to_dso_name' },
      { header: 'Purpose', field: 'purpose' },
      { header: 'Task Created On', field: 'task_created_on' },
      { header: 'Schedule Date', field: 'schedule_date' },
      { header: 'Contact Person', field: 'contact_person' },
      { header: 'Contact No', field: 'contact_no' },
      { header: 'Task Status', field: 'task_status' },
      { header: 'District', field: 'district' },
      { header: 'State', field: 'state' },
      { header: 'Market City', field: 'market_city' },
    ],
  },
  m_enrollment: {
    label: 'Master Enrollment (MEnrollment)',
    table: 'm_enrollment_details',
    icon: 'fa-solid fa-address-card',
    sheetName: 'Table',
    fileName: 'MEnrollment_Data.xlsx',
    columns: [
      { header: 'AccountNo', field: 'account_no' },
      { header: 'SALUTATION', field: 'salutation' },
      { header: 'First Name*', field: 'first_name' },
      { header: 'Last Name*', field: 'last_name' },
      { header: 'Date Of Birth*', field: 'date_of_birth' },
      { header: 'Gender*', field: 'gender' },
      { header: 'Mobile No*', field: 'mobile_no' },
      { header: 'Firm Name*', field: 'firm_name' },
      { header: 'Firm Address*', field: 'firm_address' },
      { header: 'Permanent Address*', field: 'permanent_address' },
      { header: 'City', field: 'city' },
      { header: 'State*', field: 'state' },
      { header: 'District*', field: 'district' },
      { header: 'Pincode', field: 'pincode' },
      { header: 'ISACTIVE*', field: 'is_active' },
      { header: 'Enrolled', field: 'enrolled' },
      { header: 'Tier', field: 'tier' },
    ],
  },
  tier_upgrade: {
    label: 'Tier Upgrade Performance Report',
    table: 'tier_upgrade_performance_report',
    icon: 'fa-solid fa-arrow-up-right-dots',
    sheetName: 'TierUpgradePerformanceReport',
    fileName: 'TierUpgradePerformanceReport_Data.xlsx',
    columns: [
      { header: 'DMI ID', field: 'dmi_id' },
      { header: 'DMI Name', field: 'dmi_name' },
      { header: 'DMI Market City', field: 'dmi_market_city' },
      { header: 'District', field: 'district' },
      { header: 'State', field: 'state' },
      { header: 'Tier Change Date', field: 'tier_change_date' },
      { header: 'Previous Tier', field: 'previous_tier' },
      { header: 'New Tier', field: 'new_tier' },
      { header: 'Change Type', field: 'change_type' },
      { header: 'Reason for Change', field: 'reason_for_change' },
      { header: 'Changed By', field: 'changed_by' },
      { header: 'Effective From', field: 'effective_from' },
      { header: 'Account Status', field: 'account_status' },
      { header: 'Tier Change Frequency', field: 'tier_change_frequency' },
      { header: 'Mapped ISR', field: 'mapped_isr' },
      { header: 'FY CLAIMPOINT', field: 'fy_claimpoint' },
      { header: 'FY TIERPOINTS', field: 'fy_tierpoints' },
    ],
  },
  telecalling_wartask: {
    label: 'TeleCalling Influencer War Task',
    table: 'telecalling_influencer_wartask',
    icon: 'fa-solid fa-phone-volume',
    sheetName: 'TeleCallingInfluencerWartask',
    fileName: 'TeleCallingInfluencerWartask_Data.xlsx',
    columns: [
      { header: 'Task Date', field: 'task_date' },
      { header: 'Task No', field: 'task_no' },
      { header: 'Influencer Market City', field: 'influencer_market_city' },
      { header: 'Influencer Type', field: 'influencer_type' },
      { header: 'Influencer ID', field: 'influencer_id' },
      { header: 'Influencer Name', field: 'influencer_name' },
      { header: 'Primary Phone No', field: 'primary_phone_no' },
      { header: 'Secondary Phone No', field: 'secondary_phone_no' },
      { header: 'Owner Name', field: 'owner_name' },
      { header: 'Task Priority', field: 'task_priority' },
      { header: 'Task Description', field: 'task_description' },
      { header: 'Task Description2', field: 'task_description2' },
      { header: 'Tele caller Comment', field: 'tele_caller_comment' },
      { header: 'Status as on Today', field: 'status_as_on_today' },
      { header: 'Status Change date', field: 'status_change_date' },
      { header: 'Status Elapse Days', field: 'status_elapse_days' },
      { header: 'Tele calling Escalation', field: 'tele_calling_escalation' },
      { header: 'Current Owner Type', field: 'current_owner_type' },
      { header: 'Current Owner Name', field: 'current_owner_name' },
      { header: 'ISR Contact Details', field: 'isr_contact_details' },
      { header: 'Distributor Code', field: 'distributor_code' },
      { header: 'Distributor Name', field: 'distributor_name' },
      { header: 'Task Remark', field: 'task_remark' },
      { header: 'Order Status (ByUser)', field: 'order_status' },
      { header: 'SO No', field: 'so_no' },
      { header: 'State', field: 'state' },
      { header: 'Call Type', field: 'call_type' },
      { header: 'Mapped ISR Name', field: 'mapped_isr_name' },
      { header: 'Mapped ISR Code', field: 'mapped_isr_code' },
      { header: 'Influencer Tier', field: 'influencer_tier' },
    ],
  },
  monthly_attendance: {
    label: 'Monthly Attendance Report',
    table: 'monthly_attendance_report',
    icon: 'fa-solid fa-user-check',
    sheetName: 'Monthly_Working_Hour',
    fileName: 'Monthly_Attendance_Report_Data.xlsx',
    columns: [
      { header: 'Employee Code', field: 'employee_code' },
      { header: 'Full name', field: 'full_name' },
      { header: 'Employment status', field: 'employment_status' },
      { header: 'Company', field: 'company' },
      { header: 'Business Unit', field: 'business_unit' },
      { header: 'Department', field: 'department' },
      { header: 'Designation', field: 'designation' },
      { header: 'Branch', field: 'branch' },
      { header: 'Sub branch', field: 'sub_branch' },
      { header: 'Attendance date', field: 'attendance_date' },
      { header: 'Working hour', field: 'working_hour' },
      { header: 'Shift code', field: 'shift_code' },
      { header: 'Shift timings', field: 'shift_timings' },
      { header: 'Attendance status', field: 'attendance_status' },
      { header: 'Checkin timings', field: 'checkin_timings' },
    ],
  },
}

async function fetchAllRows(table) {
  let from = 0
  let all = []
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    all = all.concat(data)
    from += PAGE_SIZE
    hasMore = data.length === PAGE_SIZE
  }

  return all
}

function buildSheet(rows) {
  if (!rows || rows.length === 0) {
    return XLSX.utils.json_to_sheet([])
  }

  // Use exact table column names as returned by Supabase select('*').
  const headers = Object.keys(rows[0])
  const mappedRows = rows.map(row => {
    const out = {}
    headers.forEach(header => {
      const value = row[header]
      out[header] = value === null || value === undefined ? '' : value
    })
    return out
  })

  return XLSX.utils.json_to_sheet(mappedRows, { header: headers, skipHeader: false })
}

function SalesDataDownload() {
  const [downloadingKey, setDownloadingKey] = useState('')
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [counts, setCounts] = useState({})
  const [loadingCounts, setLoadingCounts] = useState(true)

  const sheetEntries = useMemo(() => Object.entries(SHEET_DOWNLOAD_CONFIGS), [])

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        setLoadingCounts(true)
        const nextCounts = {}
        for (const [key, cfg] of sheetEntries) {
          const { count } = await supabase
            .from(cfg.table)
            .select('*', { head: true, count: 'exact' })
          nextCounts[key] = count || 0
        }
        setCounts(nextCounts)
      } catch (err) {
        console.error('Count fetch error:', err)
      } finally {
        setLoadingCounts(false)
      }
    }
    fetchCounts()
  }, [sheetEntries])

  const handleDownloadSheet = async (key) => {
    const cfg = SHEET_DOWNLOAD_CONFIGS[key]
    if (!cfg) return

    try {
      setDownloadingKey(key)
      const rows = await fetchAllRows(cfg.table)
      const ws = buildSheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, cfg.sheetName)
      XLSX.writeFile(wb, cfg.fileName)
    } catch (err) {
      console.error(err)
      alert(`Failed to download ${cfg.label}: ${err.message}`)
    } finally {
      setDownloadingKey('')
    }
  }

  const handleDownloadAll = async () => {
    try {
      setDownloadingAll(true)
      const wb = XLSX.utils.book_new()

      for (const [, cfg] of sheetEntries) {
        const rows = await fetchAllRows(cfg.table)
        const ws = buildSheet(rows)
        XLSX.utils.book_append_sheet(wb, ws, cfg.sheetName)
      }

      XLSX.writeFile(wb, 'SalesData_AllSheets.xlsx')
    } catch (err) {
      console.error(err)
      alert(`Failed to download all sheets: ${err.message}`)
    } finally {
      setDownloadingAll(false)
    }
  }

  return (
    <main className="excel-upload-main">
      <section className="excel-upload-header">
        <div>
          <h2>Sales Data Download</h2>
          <p>Download current uploaded data in Excel format for all Sales Upload sheets</p>
        </div>
      </section>

      <div className="upload-card">
        <div className="sdd-top-actions">
          <h3><i className="fa-solid fa-download"></i> Download Sheets</h3>
          <button
            className="btn-upload sdd-download-all"
            onClick={handleDownloadAll}
            disabled={downloadingAll || downloadingKey !== ''}
          >
            {downloadingAll
              ? <><i className="fa-solid fa-spinner fa-spin"></i> Preparing...</>
              : <><i className="fa-solid fa-file-arrow-down"></i> Download All Sheets</>}
          </button>
        </div>

        <div className="sheet-type-grid">
          {sheetEntries.map(([key, cfg]) => (
            <div key={key} className="sheet-type-btn sdd-card">
              <div className="sdd-card-title">
                <i className={cfg.icon}></i>
                <span>{cfg.label}</span>
              </div>

              <div className="sdd-card-meta">
                <span>{loadingCounts ? 'Rows: ...' : `Rows: ${(counts[key] || 0).toLocaleString()}`}</span>
                <span className="sdd-file-name">{cfg.fileName}</span>
              </div>

              <button
                className="btn-download-format sdd-download-btn"
                onClick={() => handleDownloadSheet(key)}
                disabled={downloadingAll || (downloadingKey !== '' && downloadingKey !== key)}
              >
                {downloadingKey === key
                  ? <><i className="fa-solid fa-spinner fa-spin"></i> Preparing...</>
                  : <><i className="fa-solid fa-download"></i> Download</>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

export default SalesDataDownload
