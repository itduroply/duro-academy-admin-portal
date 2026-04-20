import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import './PerformanceMasterUpload.css'

// ── Sheet configs ────────────────────────────────────────────
const SHEET_CONFIGS = {
  point_master: {
    label: 'Sheet Point Master',
    description: 'Brand name → Points per sheet mapping',
    table: 'sheet_point_master',
    uniqueKey: 'brand_name',
    icon: 'fa-solid fa-star-half-stroke',
    color: '#7C3AED',
    requiredColumns: ['brand_name', 'points_per_sheet'],
    preview: ['Brand Name', 'Points Per Sheet'],
    mapRow: (r) => {
      const brand = str(r['brand_name'] ?? r['Brand_name'] ?? r['Brand Name'] ?? r['BrandName'])
      const pts   = num(r['points_per_sheet'] ?? r['Points_per_sheet'] ?? r['Points Per Sheet'] ?? r['PointsPerSheet'])
      if (!brand) return null
      return { brand_name: brand, points_per_sheet: pts ?? 0 }
    },
  },
  goals_master: {
    label: 'Goals Master',
    description: 'Employee monthly sheet sales goals',
    table: 'goals_master',
    uniqueKey: 'employee_code',
    icon: 'fa-solid fa-bullseye',
    color: '#059669',
    requiredColumns: ['employee_code', 'monthly_sheet_goal'],
    preview: ['Employee Code', 'Designation', 'Monthly Sheet Goal'],
    mapRow: (r) => {
      const code = str(r['Employee_code'] ?? r['Employee Code'] ?? r['EmployeeCode'] ?? r['employee_code'])
      const goal = num(r['Monthly_Sheet_Goal'] ?? r['Monthly Sheet Goal'] ?? r['MonthlySheetGoal'] ?? r['monthly_sheet_goal'])
      if (!code) return null
      return {
        employee_code: code,
        designation: str(r['Designation'] ?? r['designation']) ?? null,
        monthly_sheet_goal: goal ?? 0,
      }
    },
  },
  brand_category: {
    label: 'Brand Category Master',
    description: 'Brand name → Category mapping',
    table: 'brand_category_master',
    uniqueKey: 'brand_name',
    icon: 'fa-solid fa-tags',
    color: '#D97706',
    requiredColumns: ['brand_name', 'brand_category'],
    preview: ['Brand Name', 'Brand Category'],
    mapRow: (r) => {
      const brand    = str(r['brand_name'] ?? r['Brand_Name'] ?? r['Brand_name'] ?? r['Brand Name'] ?? r['BrandName'])
      const category = str(r['brand_category'] ?? r['Brand_Category'] ?? r['Brand_category'] ?? r['Brand Category'] ?? r['BrandCategory'])
      if (!brand) return null
      return { brand_name: brand, brand_category: category ?? '' }
    },
  },
  dmi_raw_points: {
    label: 'DMI Raw Points Master',
    description: 'Tier → Points per DMI mapping',
    table: 'dmi_raw_points_master',
    uniqueKey: 'tier',
    icon: 'fa-solid fa-layer-group',
    color: '#2563EB',
    requiredColumns: ['tier', 'points_per_dmi'],
    preview: ['Tier', 'Points Per DMI'],
    mapRow: (r) => {
      const tier = str(r['tier'] ?? r['Tier'] ?? r['TIER'])
      const pts  = num(r['points_per_dmi'] ?? r['Points_per_DMI'] ?? r['Points per DMI'] ?? r['PointsPerDMI'] ?? r['Points_Per_DMI'])
      if (!tier) return null
      return { tier, points_per_dmi: pts ?? 0 }
    },
  },
  working_days: {
    label: 'Working Days',
    description: 'State-wise monthly working days',
    table: 'working_days_master',
    uniqueKey: 'state_month',
    icon: 'fa-solid fa-calendar-check',
    color: '#0891B2',
    requiredColumns: ['state_month'],
    preview: ['State / Month', 'Jan', 'Feb', 'Mar', 'Apr', 'Annual Total', 'Holidays (Annual)'],
    mapRow: (r) => {
      const state = str(r['state_month'] ?? r['State_Month'] ?? r['State / Month'] ?? r['State/Month'])
      if (!state) return null
      return {
        state_month: state,
        jan: num(r['Jan'] ?? r['jan']) ?? 0,
        feb: num(r['Feb'] ?? r['feb']) ?? 0,
        mar: num(r['Mar'] ?? r['mar']) ?? 0,
        apr: num(r['Apr'] ?? r['apr']) ?? 0,
        may: num(r['May'] ?? r['may']) ?? 0,
        jun: num(r['Jun'] ?? r['jun']) ?? 0,
        jul: num(r['Jul'] ?? r['jul']) ?? 0,
        aug: num(r['Aug'] ?? r['aug']) ?? 0,
        sep: num(r['Sep'] ?? r['sep']) ?? 0,
        oct: num(r['Oct'] ?? r['oct']) ?? 0,
        nov: num(r['Nov'] ?? r['nov']) ?? 0,
        dec: num(r['Dec'] ?? r['dec']) ?? 0,
        annual_total: num(r['Annual Total'] ?? r['Annual_Total'] ?? r['annual_total']) ?? 0,
        holidays_annual: num(r['Holidays (Annual)'] ?? r['Holidays_Annual'] ?? r['holidays_annual']) ?? 0,
      }
    },
  },
}

// ── Format templates (sample rows for download) ────────────
const SHEET_TEMPLATES = {
  point_master: {
    sheetName: 'Sheet_Point_Master',
    fileName: 'Sheet_Point_Master_Format.xlsx',
    rows: [
      { brand_name: 'DURO PUMAPLY', points_per_sheet: 13 },
      { brand_name: 'DURODOOR', points_per_sheet: 15 },
      { brand_name: 'DUROPLY', points_per_sheet: 10 },
    ],
  },
  goals_master: {
    sheetName: 'Goals_Master',
    fileName: 'Goals_Master_Format.xlsx',
    rows: [
      { Employee_code: 'EMP001', Designation: 'Sales Executive', Monthly_Sheet_Goal: 500 },
      { Employee_code: 'EMP002', Designation: 'Area Manager', Monthly_Sheet_Goal: 1000 },
      { Employee_code: 'EMP003', Designation: 'Regional Head', Monthly_Sheet_Goal: 2000 },
    ],
  },
  brand_category: {
    sheetName: 'Brand_Category_Master',
    fileName: 'Brand_Category_Master_Format.xlsx',
    rows: [
      { Brand_Name: 'DURO PUMAPLY', Brand_Category: 'Ply' },
      { Brand_Name: 'DURODOOR', Brand_Category: 'Door' },
      { Brand_Name: 'DUROPLY', Brand_Category: 'Ply' },
    ],
  },
  dmi_raw_points: {
    sheetName: 'DMI_Raw_Points_Master',
    fileName: 'DMI_Raw_Points_Master_Format.xlsx',
    rows: [
      { Tier: 'Tier 1', Points_per_DMI: 10 },
      { Tier: 'Tier 2', Points_per_DMI: 20 },
      { Tier: 'Tier 3', Points_per_DMI: 30 },
    ],
  },
  working_days: {
    sheetName: 'Working_Days',
    fileName: 'Working_Days_Format.xlsx',
    rows: [
      { 'State / Month': 'Andhra Pradesh', Jan: 22, Feb: 23, Mar: 23, Apr: 25, May: 24, Jun: 25, Jul: 26, Aug: 25, Sep: 24, Oct: 24, Nov: 24, Dec: 26, 'Annual Total': 291, 'Holidays (Annual)': 10 },
      { 'State / Month': 'Delhi Corporate Office', Jan: 23, Feb: 23, Mar: 24, Apr: 24, May: 25, Jun: 25, Jul: 26, Aug: 24, Sep: 24, Oct: 23, Nov: 23, Dec: 25, 'Annual Total': 289, 'Holidays (Annual)': 12 },
    ],
  },
}

// ── Helpers ──────────────────────────────────────────────────// Trims leading/trailing whitespace from all string keys and values in a row
function trimRow(row) {
  const result = {}
  for (const key in row) {
    const trimmedKey = typeof key === 'string' ? key.trim() : key
    const v = row[key]
    result[trimmedKey] = typeof v === 'string' ? v.trim() : v
  }
  return result
}function str(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

const BATCH_SIZE = 500

// ── Component ────────────────────────────────────────────────
function PerformanceMasterUpload() {
  const { user } = useAuth()
  const fileInputRef = useRef(null)

  const [selectedType, setSelectedType] = useState('')
  const [file, setFile] = useState(null)
  const [previewRows, setPreviewRows] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('point_master') // for data view tabs
  const [tableData, setTableData] = useState({ point_master: [], goals_master: [], brand_category: [], dmi_raw_points: [], working_days: [] })
  const [tableLoading, setTableLoading] = useState(false)

  useEffect(() => {
    fetchSessions()
    fetchTableData()
  }, [])

  const fetchSessions = async () => {
    setSessLoading(true)
    const { data } = await supabase
      .from('excel_upload_sessions')
      .select('*')
      .in('sheet_type', ['point_master', 'goals_master', 'brand_category', 'dmi_raw_points', 'working_days'])
      .order('upload_date', { ascending: false })
      .limit(20)
    if (data) setSessions(data)
    setSessLoading(false)
  }

  const fetchTableData = async () => {
    setTableLoading(true)
    const [{ data: pts }, { data: goals }, { data: brands }, { data: dmi }, { data: wd }] = await Promise.all([
      supabase.from('sheet_point_master').select('*').order('brand_name'),
      supabase.from('goals_master').select('*').order('employee_code'),
      supabase.from('brand_category_master').select('*').order('brand_name'),
      supabase.from('dmi_raw_points_master').select('*').order('tier'),
      supabase.from('working_days_master').select('*').order('state_month'),
    ])
    setTableData({
      point_master: pts || [],
      goals_master: goals || [],
      brand_category: brands || [],
      dmi_raw_points: dmi || [],
      working_days: wd || [],
    })
    setTableLoading(false)
  }

  const downloadFormat = (type) => {
    const tpl = SHEET_TEMPLATES[type]
    if (!tpl) return
    const ws = XLSX.utils.json_to_sheet(tpl.rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, tpl.sheetName)
    XLSX.writeFile(wb, tpl.fileName)
  }

  const handleTypeSelect = (type) => {
    setSelectedType(type)
    setFile(null)
    setPreviewRows([])
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileChange = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setResult(null)
    parsePreview(f)
  }

  const parsePreview = (f) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null })
      const config = SHEET_CONFIGS[selectedType]
      const mapped = rows
        .map(r => config.mapRow(trimRow(r)))
        .filter(Boolean)
        .slice(0, 5)
      setPreviewRows(mapped)
    }
    reader.readAsArrayBuffer(f)
  }

  const handleUpload = async () => {
    if (!selectedType || !file) return
    const config = SHEET_CONFIGS[selectedType]

    setUploading(true)
    setProgress(0)
    setResult(null)

    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null })

      const mappedRows = rawRows.map(r => config.mapRow(trimRow(r))).filter(Boolean)

      // Deduplicate by uniqueKey — last row wins (prevents ON CONFLICT batch error)
      const deduped = config.uniqueKey
        ? Object.values(
            mappedRows.reduce((acc, row) => { acc[row[config.uniqueKey]] = row; return acc }, {})
          )
        : mappedRows

      if (deduped.length === 0) {
        setResult({ inserted: 0, skipped: 0, errors: ['No valid rows found. Check column names match the expected format.'] })
        setUploading(false)
        return
      }

      // Create upload session
      const { data: sessionData, error: sessionError } = await supabase
        .from('excel_upload_sessions')
        .insert({
          sheet_type: selectedType,
          file_name: file.name,
          uploaded_by: user?.id || null,
          rows_inserted: 0,
          rows_skipped: 0,
          status: 'partial',
        })
        .select()
        .single()
      if (sessionError) throw sessionError

      const sessionId = sessionData.id
      let totalInserted = 0
      let totalSkipped = 0
      const errors = []

      const rowsWithSession = deduped.map(r => ({ ...r, upload_session_id: sessionId }))
      const batches = Math.ceil(rowsWithSession.length / BATCH_SIZE)

      for (let i = 0; i < batches; i++) {
        const batch = rowsWithSession.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
        const { error } = await supabase
          .from(config.table)
          .upsert(batch, { onConflict: config.uniqueKey, ignoreDuplicates: false })

        if (error) {
          errors.push(`Batch ${i + 1}: ${error.message}`)
          totalSkipped += batch.length
        } else {
          totalInserted += batch.length
        }
        setProgress(Math.round(((i + 1) / batches) * 100))
      }

      await supabase
        .from('excel_upload_sessions')
        .update({
          rows_inserted: totalInserted,
          rows_skipped: totalSkipped,
          status: errors.length === 0 ? 'success' : totalInserted > 0 ? 'partial' : 'failed',
          error_message: errors.length ? errors.slice(0, 3).join(' | ') : null,
        })
        .eq('id', sessionId)

      setResult({ inserted: totalInserted, skipped: totalSkipped, errors })
      setFile(null)
      setPreviewRows([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      await Promise.all([fetchSessions(), fetchTableData()])
    } catch (err) {
      console.error(err)
      setResult({ inserted: 0, skipped: 0, errors: [err.message] })
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteRow = async (table, id) => {
    if (!confirm('Delete this record?')) return
    await supabase.from(table).delete().eq('id', id)
    fetchTableData()
  }

  const formatDate = (d) => {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const statusColor = (s) => ({ success: '#10B981', partial: '#F59E0B', failed: '#EF4444' }[s] || '#6B7280')
  const cfg = selectedType ? SHEET_CONFIGS[selectedType] : null

  return (
    <main className="pmu-main">
      {/* Header */}
      <section className="pmu-header">
        <div>
          <h2>Performance Master Data</h2>
          <p>Upload and manage master sheets used for calculating performance scores</p>
        </div>
      </section>

      <div className="pmu-layout">
        {/* ── Left: Upload panel ── */}
        <div className="pmu-upload-panel">
          <div className="pmu-card">
            <h3><i className="fa-solid fa-upload"></i> Upload Master Sheet</h3>

            {/* Sheet type selector */}
            <div className="pmu-type-grid">
              {Object.entries(SHEET_CONFIGS).map(([key, c]) => (
                <button
                  key={key}
                  type="button"
                  className={`pmu-type-btn${selectedType === key ? ' selected' : ''}`}
                  style={selectedType === key ? { borderColor: c.color, background: c.color + '18', color: c.color } : {}}
                  onClick={() => handleTypeSelect(key)}
                >
                  <i className={c.icon} style={{ color: selectedType === key ? c.color : '#9CA3AF' }}></i>
                  <div>
                    <div className="pmu-type-label">{c.label}</div>
                    <div className="pmu-type-desc">{c.description}</div>
                  </div>
                </button>
              ))}
            </div>

            {/* Expected columns hint */}
            {cfg && (
              <div className="pmu-columns-hint">
                <i className="fa-solid fa-circle-info"></i>
                <span>Expected columns: <strong>{cfg.preview.join(', ')}</strong></span>
              </div>
            )}

            {/* File picker */}
            {selectedType && (
              <>
                <button
                  type="button"
                  className="pmu-btn-download-format"
                  onClick={() => downloadFormat(selectedType)}
                >
                  <i className="fa-solid fa-download"></i>
                  Download Format (.xlsx)
                </button>

                <div
                  className="pmu-file-zone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  {file ? (
                    <div className="pmu-file-selected">
                      <i className="fa-solid fa-file-excel"></i>
                      <div>
                        <div className="pmu-file-name">{file.name}</div>
                        <div className="pmu-file-size">{(file.size / 1024).toFixed(1)} KB</div>
                      </div>
                    </div>
                  ) : (
                    <div className="pmu-file-placeholder">
                      <i className="fa-solid fa-cloud-arrow-up"></i>
                      <span>Click to browse .xlsx / .xls</span>
                    </div>
                  )}
                </div>

                {/* Preview */}
                {previewRows.length > 0 && (
                  <div className="pmu-preview">
                    <div className="pmu-preview-title">
                      <i className="fa-solid fa-eye"></i> Preview (first {previewRows.length} rows)
                    </div>
                    <div className="pmu-preview-table-wrap">
                      <table className="pmu-preview-table">
                        <thead>
                          <tr>
                            {Object.keys(previewRows[0]).filter(k => k !== 'upload_session_id').map(k => (
                              <th key={k}>{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, i) => (
                            <tr key={i}>
                              {Object.entries(row).filter(([k]) => k !== 'upload_session_id').map(([k, v]) => (
                                <td key={k}>{v ?? '—'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Progress */}
                {uploading && (
                  <div className="pmu-progress-wrap">
                    <div className="pmu-progress-bar">
                      <div className="pmu-progress-fill" style={{ width: `${progress}%`, background: cfg?.color }}></div>
                    </div>
                    <span style={{ color: cfg?.color }}>{progress}%</span>
                  </div>
                )}

                {/* Result */}
                {result && (
                  <div className={`pmu-result ${result.errors.length === 0 ? 'success' : result.inserted > 0 ? 'partial' : 'failed'}`}>
                    <div className="pmu-result-stats">
                      <span><i className="fa-solid fa-check-circle"></i> {result.inserted} rows upserted</span>
                      {result.skipped > 0 && <span><i className="fa-solid fa-triangle-exclamation"></i> {result.skipped} skipped</span>}
                    </div>
                    {result.errors.length > 0 && (
                      <ul className="pmu-result-errors">
                        {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    )}
                  </div>
                )}

                <button
                  className="pmu-btn-upload"
                  style={{ background: cfg?.color }}
                  onClick={handleUpload}
                  disabled={uploading || !file}
                >
                  {uploading
                    ? <><i className="fa-solid fa-spinner fa-spin"></i> Uploading…</>
                    : <><i className="fa-solid fa-upload"></i> Upload & Upsert</>}
                </button>
              </>
            )}
          </div>

          {/* Recent uploads */}
          <div className="pmu-card">
            <div className="pmu-sessions-header">
              <h3><i className="fa-solid fa-clock-rotate-left"></i> Recent Uploads</h3>
              <button className="pmu-btn-refresh" onClick={fetchSessions} disabled={sessionsLoading}>
                <i className={`fa-solid fa-rotate-right${sessionsLoading ? ' fa-spin' : ''}`}></i>
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="pmu-empty">No uploads yet.</p>
            ) : (
              <div className="pmu-sessions-list">
                {sessions.map(s => {
                  const c = SHEET_CONFIGS[s.sheet_type]
                  return (
                    <div key={s.id} className="pmu-session-row">
                      <i className={c?.icon || 'fa-solid fa-file'} style={{ color: c?.color || '#9CA3AF' }}></i>
                      <div className="pmu-session-info">
                        <div className="pmu-session-name">{c?.label || s.sheet_type}</div>
                        <div className="pmu-session-file">{s.file_name} · {s.rows_inserted} rows · {formatDate(s.upload_date)}</div>
                      </div>
                      <span className="pmu-status-pill" style={{ background: statusColor(s.status) + '22', color: statusColor(s.status) }}>
                        {s.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Current data view ── */}
        <div className="pmu-data-panel">
          <div className="pmu-card pmu-data-card">
            <div className="pmu-tabs">
              {Object.entries(SHEET_CONFIGS).map(([key, c]) => (
                <button
                  key={key}
                  className={`pmu-tab${activeTab === key ? ' active' : ''}`}
                  style={activeTab === key ? { borderColor: c.color, color: c.color } : {}}
                  onClick={() => setActiveTab(key)}
                >
                  <i className={c.icon}></i> {c.label}
                  <span className="pmu-tab-count">{tableData[key].length}</span>
                </button>
              ))}
              <button className="pmu-btn-refresh pmu-tab-refresh" onClick={fetchTableData} disabled={tableLoading}>
                <i className={`fa-solid fa-rotate-right${tableLoading ? ' fa-spin' : ''}`}></i>
              </button>
            </div>

            <div className="pmu-table-wrap">
              {tableLoading ? (
                <div className="pmu-empty"><i className="fa-solid fa-spinner fa-spin"></i> Loading…</div>
              ) : tableData[activeTab].length === 0 ? (
                <div className="pmu-empty">
                  <i className={SHEET_CONFIGS[activeTab].icon}></i>
                  <p>No data yet. Upload a sheet to populate this table.</p>
                </div>
              ) : activeTab === 'point_master' ? (
                <table className="pmu-data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Brand Name</th>
                      <th>Points / Sheet</th>
                      <th>Last Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.point_master.map((row, i) => (
                      <tr key={row.id}>
                        <td>{i + 1}</td>
                        <td><span className="pmu-brand-badge">{row.brand_name}</span></td>
                        <td><strong style={{ color: '#7C3AED' }}>{row.points_per_sheet}</strong></td>
                        <td className="pmu-muted">{formatDate(row.updated_at)}</td>
                        <td>
                          <button className="pmu-btn-del" onClick={() => handleDeleteRow('sheet_point_master', row.id)} title="Delete">
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : activeTab === 'goals_master' ? (
                <table className="pmu-data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Employee Code</th>
                      <th>Designation</th>
                      <th>Monthly Goal (Sheets)</th>
                      <th>Last Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.goals_master.map((row, i) => (
                      <tr key={row.id}>
                        <td>{i + 1}</td>
                        <td><code className="pmu-code">{row.employee_code}</code></td>
                        <td>{row.designation || '—'}</td>
                        <td><strong style={{ color: '#059669' }}>{row.monthly_sheet_goal}</strong></td>
                        <td className="pmu-muted">{formatDate(row.updated_at)}</td>
                        <td>
                          <button className="pmu-btn-del" onClick={() => handleDeleteRow('goals_master', row.id)} title="Delete">
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : activeTab === 'brand_category' ? (
                <table className="pmu-data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Brand Name</th>
                      <th>Brand Category</th>
                      <th>Last Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.brand_category.map((row, i) => (
                      <tr key={row.id}>
                        <td>{i + 1}</td>
                        <td><span className="pmu-brand-badge">{row.brand_name}</span></td>
                        <td><strong style={{ color: '#D97706' }}>{row.brand_category}</strong></td>
                        <td className="pmu-muted">{formatDate(row.updated_at)}</td>
                        <td>
                          <button className="pmu-btn-del" onClick={() => handleDeleteRow('brand_category_master', row.id)} title="Delete">
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : activeTab === 'dmi_raw_points' ? (
                <table className="pmu-data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tier</th>
                      <th>Points Per DMI</th>
                      <th>Last Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.dmi_raw_points.map((row, i) => (
                      <tr key={row.id}>
                        <td>{i + 1}</td>
                        <td><span className="pmu-brand-badge">{row.tier}</span></td>
                        <td><strong style={{ color: '#2563EB' }}>{row.points_per_dmi}</strong></td>
                        <td className="pmu-muted">{formatDate(row.updated_at)}</td>
                        <td>
                          <button className="pmu-btn-del" onClick={() => handleDeleteRow('dmi_raw_points_master', row.id)} title="Delete">
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="pmu-data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>State</th>
                      <th>Jan</th><th>Feb</th><th>Mar</th><th>Apr</th><th>May</th><th>Jun</th>
                      <th>Jul</th><th>Aug</th><th>Sep</th><th>Oct</th><th>Nov</th><th>Dec</th>
                      <th>Annual</th>
                      <th>Holidays</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.working_days.map((row, i) => (
                      <tr key={row.id}>
                        <td>{i + 1}</td>
                        <td><span className="pmu-brand-badge">{row.state_month}</span></td>
                        <td>{row.jan}</td><td>{row.feb}</td><td>{row.mar}</td><td>{row.apr}</td>
                        <td>{row.may}</td><td>{row.jun}</td><td>{row.jul}</td><td>{row.aug}</td>
                        <td>{row.sep}</td><td>{row.oct}</td><td>{row.nov}</td><td>{row.dec}</td>
                        <td><strong style={{ color: '#0891B2' }}>{row.annual_total}</strong></td>
                        <td><strong style={{ color: '#F59E0B' }}>{row.holidays_annual}</strong></td>
                        <td>
                          <button className="pmu-btn-del" onClick={() => handleDeleteRow('working_days_master', row.id)} title="Delete">
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

export default PerformanceMasterUpload
