import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import { supabase } from '../supabaseClient'
import { cachedFetch, TTL } from '../utils/cacheDB'
import './VideoProgress.css'

function VideoProgress() {
  const mountedRef = useRef(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Data
  const [progressData, setProgressData] = useState([])
  const [users, setUsers] = useState([])
  const [videos, setVideos] = useState([])
  const [modules, setModules] = useState([])
  const [branches, setBranches] = useState([])

  // Filters
  const [searchUser, setSearchUser] = useState('')
  const [searchVideo, setSearchVideo] = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [filterModule, setFilterModule] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  // Detail panel
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState(null)

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), [])

  const breadcrumbItems = useMemo(() => [
    { label: 'Home', link: true },
    { label: 'Reports', link: false },
    { label: 'Video Progress', link: false }
  ], [])

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

      const [usersResult, videosResult, modulesResult, branchesResult] = await Promise.all([
        cachedFetch('users_full_vp', async () => {
          const { data, error } = await supabase
            .from('users')
            .select('id, full_name, email, employee_id, branch_id, department_id')
          if (error) throw error
          return data || []
        }, TTL.MEDIUM),
        cachedFetch('videos_full_vp', async () => {
          const { data, error } = await supabase
            .from('videos')
            .select('id, title, module_id, duration')
            .order('title')
          if (error) throw error
          return data || []
        }, TTL.LONG),
        cachedFetch('modules_list', async () => {
          const { data, error } = await supabase
            .from('modules')
            .select('id, title')
            .order('title')
          if (error) throw error
          return data || []
        }, TTL.LONG),
        cachedFetch('branches', async () => {
          const { data, error } = await supabase
            .from('branches')
            .select('id, branch_name')
            .order('branch_name')
          if (error) throw error
          return data || []
        }, TTL.VERY_LONG)
      ])

      if (!mountedRef.current) return

      setUsers(usersResult.data)
      setVideos(videosResult.data)
      setModules(modulesResult.data)
      setBranches(branchesResult.data)

      // Try fetching user_video_progress table
      await fetchVideoProgress(usersResult.data, videosResult.data, modulesResult.data, branchesResult.data)
    } catch (err) {
      console.error('[VideoProgress] Error loading data:', err)
      if (mountedRef.current) {
        setError(err.message)
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const fetchVideoProgress = async (usersData, videosData, modulesData, branchesData) => {
    try {
      const { data, error } = await supabase
        .from('user_video_progress')
        .select('id, user_id, video_id, watched_duration, completed, last_watched_at')
        .order('last_watched_at', { ascending: false })

      if (error) throw error

      const userMap = new Map(usersData.map(u => [u.id, u]))
      const videoMap = new Map(videosData.map(v => [v.id, v]))
      const moduleMap = new Map(modulesData.map(m => [m.id, m]))
      const branchMap = new Map(branchesData.map(b => [b.id, b]))

      const mapped = (data || []).map(record => {
        const user = userMap.get(record.user_id) || {}
        const video = videoMap.get(record.video_id) || {}
        const module = moduleMap.get(video.module_id) || {}
        const branch = branchMap.get(user.branch_id) || {}

        const watchedSeconds = parseInt(record.watched_duration, 10) || 0
        const totalSeconds = parseDuration(video.duration)
        const isCompleted = record.completed === true
        const progress = isCompleted ? 100 : (totalSeconds > 0 ? Math.min(Math.round((watchedSeconds / totalSeconds) * 100), 99) : 0)

        let status = 'Not Started'
        if (isCompleted) status = 'Completed'
        else if (watchedSeconds > 0) status = 'In Progress'

        return {
          id: record.id,
          userId: record.user_id,
          userName: user.full_name || 'Unknown',
          userEmail: user.email || '',
          employeeId: user.employee_id || '',
          branchId: user.branch_id,
          branchName: branch.branch_name || 'N/A',
          videoId: record.video_id,
          videoTitle: video.title || 'Unknown Video',
          moduleId: video.module_id,
          moduleName: module.title || 'N/A',
          watchedSeconds,
          totalSeconds,
          progress,
          status,
          lastWatchedAt: record.last_watched_at,
          completedAt: isCompleted ? record.last_watched_at : null,
          sessions: 1,
        }
      })

      if (mountedRef.current) setProgressData(mapped)
    } catch (err) {
      console.error('[VideoProgress] Error fetching video progress:', err)
      if (mountedRef.current) setError('Failed to load video progress data')
    }
  }

  // Filtered & paginated data
  const filteredData = useMemo(() => {
    let data = [...progressData]

    if (searchUser) {
      const q = searchUser.toLowerCase()
      data = data.filter(r =>
        r.userName.toLowerCase().includes(q) ||
        (r.employeeId && r.employeeId.toLowerCase().includes(q)) ||
        (r.userEmail && r.userEmail.toLowerCase().includes(q))
      )
    }
    if (searchVideo) {
      const q = searchVideo.toLowerCase()
      data = data.filter(r => r.videoTitle.toLowerCase().includes(q))
    }
    if (filterBranch) {
      data = data.filter(r => r.branchName === filterBranch)
    }
    if (filterModule) {
      data = data.filter(r => r.moduleName === filterModule)
    }
    if (filterStatus) {
      data = data.filter(r => r.status === filterStatus)
    }
    if (filterDate) {
      const now = new Date()
      let startDate, endDate
      if (filterDate === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + 1)
      } else if (filterDate === 'yesterday') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      } else if (filterDate === 'this_week') {
        const day = now.getDay()
        const diffToMonday = day === 0 ? 6 : day - 1
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday)
        endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + 7)
      } else if (filterDate === 'custom') {
        if (customDateFrom) startDate = new Date(customDateFrom)
        if (customDateTo) {
          endDate = new Date(customDateTo)
          endDate.setDate(endDate.getDate() + 1)
        }
      }
      if (startDate || endDate) {
        data = data.filter(r => {
          if (!r.lastWatchedAt) return false
          const d = new Date(r.lastWatchedAt)
          if (startDate && d < startDate) return false
          if (endDate && d >= endDate) return false
          return true
        })
      }
    }

    return data
  }, [progressData, searchUser, searchVideo, filterBranch, filterModule, filterStatus, filterDate, customDateFrom, customDateTo])

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize))
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredData.slice(start, start + pageSize)
  }, [filteredData, currentPage])

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1) }, [searchUser, searchVideo, filterBranch, filterModule, filterStatus, filterDate, customDateFrom, customDateTo])

  // Unique values for dropdowns
  const uniqueBranches = useMemo(() => [...new Set(progressData.map(r => r.branchName).filter(Boolean).filter(b => b !== 'N/A'))].sort(), [progressData])
  const uniqueModules = useMemo(() => [...new Set(progressData.map(r => r.moduleName).filter(Boolean).filter(m => m !== 'N/A'))].sort(), [progressData])

  const resetFilters = () => {
    setSearchUser('')
    setSearchVideo('')
    setFilterBranch('')
    setFilterModule('')
    setFilterStatus('')
    setFilterDate('')
    setCustomDateFrom('')
    setCustomDateTo('')
  }

  // Parse "HH:MM:SS" or "MM:SS" text duration to total seconds
  const parseDuration = (duration) => {
    if (!duration) return 0
    if (typeof duration === 'number') return duration
    const parts = String(duration).split(':').map(Number)
    if (parts.some(isNaN)) return 0
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    return parseInt(duration, 10) || 0
  }

  // Format seconds to MM:SS or HH:MM:SS
  const formatDuration = (seconds) => {
    const num = parseInt(seconds, 10)
    if (!num || isNaN(num) || num <= 0) return '00:00'
    const h = Math.floor(num / 3600)
    const m = Math.floor((num % 3600) / 60)
    const s = num % 60
    const mm = String(m).padStart(2, '0')
    const ss = String(s).padStart(2, '0')
    if (h > 0) return `${String(h).padStart(2, '0')}:${mm}:${ss}`
    return `${mm}:${ss}`
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatTime = (dateStr) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const getProgressColor = (progress) => {
    if (progress >= 100) return 'green'
    if (progress >= 80) return 'blue'
    if (progress > 0) return 'yellow'
    return 'red'
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Completed': return 'status-completed'
      case 'In Progress': return 'status-in-progress'
      default: return 'status-not-started'
    }
  }

  const getEngagementIcon = (record) => {
    if (record.status === 'Not Started') return { icon: '❌', title: 'No Activity', cls: 'badge-inactive' }
    if (record.progress >= 80) return { icon: '🔥', title: 'Highly Engaged', cls: 'badge-hot' }
    if (record.sessions <= 1 && record.progress < 30) return { icon: '⚠️', title: 'At Risk', cls: 'badge-risk' }
    return null
  }

  const openDetail = (record) => {
    setSelectedRecord(record)
    setDetailOpen(true)
  }

  const exportCSV = () => {
    const headers = ['User Name', 'Employee ID', 'Branch', 'Video Title', 'Module', 'Watched', 'Total', 'Progress %', 'Status', 'Last Watched']
    const rows = filteredData.map(r => [
      r.userName, r.employeeId, r.branchName, r.videoTitle, r.moduleName,
      formatDuration(r.watchedSeconds), formatDuration(r.totalSeconds),
      r.progress + '%', r.status, r.lastWatchedAt ? formatDate(r.lastWatchedAt) : '-'
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'video_progress_report.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Pagination helpers
  const getPageNumbers = () => {
    const pages = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1, 2, 3)
      if (currentPage > 4) pages.push('...')
      if (currentPage > 3 && currentPage < totalPages - 2) pages.push(currentPage)
      if (currentPage < totalPages - 3) pages.push('...')
      pages.push(totalPages - 1, totalPages)
    }
    return [...new Set(pages)]
  }

  return (
    <div className="video-progress-panel">
      <Sidebar />
      <div className="vp-main-wrapper">
        <Header
          toggleSidebar={toggleSidebar}
          breadcrumbItems={breadcrumbItems}
        />
        <div className="video-progress-main">
          {/* Page Header */}
          <div className="vp-page-header">
            <div>
              <h2>Video Progress Report</h2>
              <p>Track user video watching progress across all modules</p>
            </div>
            <div className="vp-header-actions">
              <span className="vp-last-updated">Last updated: Just now</span>
              <button className="vp-refresh-btn" onClick={fetchAllData} title="Refresh">
                <i className="fa-solid fa-arrows-rotate"></i>
              </button>
            </div>
          </div>

          {/* Filters Section */}
          <div className="vp-filters-card">
            <div className="vp-filters-header">
              <h3><i className="fa-solid fa-filter"></i> Filters</h3>
              <button className="vp-reset-btn" onClick={resetFilters}>Reset All</button>
            </div>
            <div className="vp-filters-grid">
              <div className="vp-search-input">
                <i className="fa-solid fa-magnifying-glass"></i>
                <input
                  type="text"
                  placeholder="Search User (Name/ID)"
                  value={searchUser}
                  onChange={(e) => setSearchUser(e.target.value)}
                />
              </div>
              <div className="vp-search-input">
                <i className="fa-solid fa-video"></i>
                <input
                  type="text"
                  placeholder="Search Video Title"
                  value={searchVideo}
                  onChange={(e) => setSearchVideo(e.target.value)}
                />
              </div>
              <div className="vp-select-wrapper">
                <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
                  <option value="">All Branches</option>
                  {uniqueBranches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <i className="fa-solid fa-chevron-down"></i>
              </div>
              <div className="vp-select-wrapper">
                <select value={filterModule} onChange={(e) => setFilterModule(e.target.value)}>
                  <option value="">All Modules</option>
                  {uniqueModules.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <i className="fa-solid fa-chevron-down"></i>
              </div>
              <div className="vp-select-wrapper">
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  <option value="Completed">Completed</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Not Started">Not Started</option>
                </select>
                <i className="fa-solid fa-chevron-down"></i>
              </div>
              <div className="vp-select-wrapper">
                <select value={filterDate} onChange={(e) => { setFilterDate(e.target.value); if (e.target.value !== 'custom') { setCustomDateFrom(''); setCustomDateTo('') } }}>
                  <option value="">All Time</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="this_week">This Week</option>
                  <option value="custom">Custom Range</option>
                </select>
                <i className="fa-solid fa-chevron-down"></i>
              </div>
              <div className="vp-filter-actions">
                <button className="vp-export-btn" onClick={exportCSV}>
                  <i className="fa-solid fa-file-export"></i> Export
                </button>
              </div>
            </div>
            {filterDate === 'custom' && (
              <div className="vp-custom-date-row">
                <div className="vp-date-input">
                  <label>From</label>
                  <input
                    type="date"
                    value={customDateFrom}
                    onChange={(e) => setCustomDateFrom(e.target.value)}
                  />
                </div>
                <div className="vp-date-input">
                  <label>To</label>
                  <input
                    type="date"
                    value={customDateTo}
                    onChange={(e) => setCustomDateTo(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Data Table */}
          <div className="vp-table-card">
            <div className="vp-table-header">
              <h3>User Video Progress</h3>
              <span className="vp-record-badge">{filteredData.length.toLocaleString()} Records</span>
            </div>

            {loading ? (
              <div className="vp-loading">
                <i className="fa-solid fa-spinner fa-spin"></i>
                <span>Loading video progress data...</span>
              </div>
            ) : error && progressData.length === 0 ? (
              <div className="vp-error">
                <i className="fa-solid fa-circle-exclamation"></i>
                <p>{error}</p>
                <button onClick={fetchAllData}>Retry</button>
              </div>
            ) : filteredData.length === 0 ? (
              <div className="vp-empty">
                <i className="fa-solid fa-inbox"></i>
                <p>No records match your filters</p>
                <button onClick={resetFilters}>Clear Filters</button>
              </div>
            ) : (
              <>
                <div className="vp-table-scroll">
                  <table className="vp-table">
                    <thead>
                      <tr>
                        <th>User Name</th>
                        <th>Branch</th>
                        <th>Video Title</th>
                        <th>Duration</th>
                        <th className="progress-col">Progress</th>
                        <th>Status</th>
                        <th>Last Watched</th>
                        <th className="action-col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedData.map((record) => {
                        const color = getProgressColor(record.progress)
                        const engagement = getEngagementIcon(record)
                        return (
                          <tr key={record.id} className="vp-table-row">
                            <td>
                              <div className="vp-user-cell">
                                <div className="vp-avatar">{record.userName.charAt(0).toUpperCase()}</div>
                                <div>
                                  <div className="vp-user-name">{record.userName}</div>
                                  <div className="vp-user-id">ID: {record.employeeId || 'N/A'}</div>
                                </div>
                              </div>
                            </td>
                            <td className="vp-cell-text">{record.branchName}</td>
                            <td>
                              <div className="vp-video-name">{record.videoTitle}</div>
                              <div className="vp-module-name">Module: {record.moduleName}</div>
                            </td>
                            <td className="vp-cell-text">
                              {formatDuration(record.watchedSeconds)} / {formatDuration(record.totalSeconds)}
                            </td>
                            <td>
                              <div className="vp-progress-cell">
                                <div className="vp-progress-bar">
                                  <div
                                    className={`vp-progress-fill progress-${color}`}
                                    style={{ width: `${record.progress}%` }}
                                  ></div>
                                </div>
                                <span className={`vp-progress-text progress-text-${color}`}>{record.progress}%</span>
                              </div>
                            </td>
                            <td>
                              <span className={`vp-status-badge ${getStatusBadge(record.status)}`}>
                                <span className="vp-status-dot"></span>
                                {record.status}
                              </span>
                              {engagement && (
                                <span className={`vp-engagement-badge ${engagement.cls}`} title={engagement.title}>
                                  {engagement.icon}
                                </span>
                              )}
                            </td>
                            <td className="vp-cell-text">
                              {record.lastWatchedAt ? (
                                <>
                                  {formatDate(record.lastWatchedAt)}
                                  <span className="vp-time-sub">{formatTime(record.lastWatchedAt)}</span>
                                </>
                              ) : '-'}
                            </td>
                            <td>
                              <button className="vp-view-btn" onClick={() => openDetail(record)}>
                                View Details
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="vp-pagination">
                  <div className="vp-pagination-info">
                    Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to{' '}
                    <strong>{Math.min(currentPage * pageSize, filteredData.length)}</strong> of{' '}
                    <strong>{filteredData.length.toLocaleString()}</strong> results
                  </div>
                  <div className="vp-pagination-controls">
                    <button
                      className="vp-page-btn"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => p - 1)}
                    >
                      <i className="fa-solid fa-chevron-left"></i>
                    </button>
                    {getPageNumbers().map((page, i) =>
                      page === '...' ? (
                        <span key={`dots-${i}`} className="vp-page-dots">...</span>
                      ) : (
                        <button
                          key={page}
                          className={`vp-page-btn ${currentPage === page ? 'active' : ''}`}
                          onClick={() => setCurrentPage(page)}
                        >
                          {page}
                        </button>
                      )
                    )}
                    <button
                      className="vp-page-btn"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(p => p + 1)}
                    >
                      <i className="fa-solid fa-chevron-right"></i>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Detail Slide-over Panel */}
      {detailOpen && selectedRecord && (
        <div className="vp-detail-overlay" onClick={() => setDetailOpen(false)}>
          <div className="vp-detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="vp-detail-header">
              <h2>Progress Details</h2>
              <button className="vp-detail-close" onClick={() => setDetailOpen(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="vp-detail-body">
              {/* User Profile */}
              <div className="vp-detail-profile">
                <div className="vp-detail-avatar">{selectedRecord.userName.charAt(0).toUpperCase()}</div>
                <div>
                  <h3>{selectedRecord.userName}</h3>
                  <p>{selectedRecord.employeeId || 'N/A'} • {selectedRecord.branchName}</p>
                </div>
              </div>

              {/* Video Info Card */}
              <div className="vp-detail-info-card">
                <h4>Video Information</h4>
                <div className="vp-detail-info-grid">
                  <div>
                    <span className="vp-detail-label">Module Name</span>
                    <span className="vp-detail-value">{selectedRecord.moduleName}</span>
                  </div>
                  <div>
                    <span className="vp-detail-label">Video Title</span>
                    <span className="vp-detail-value">{selectedRecord.videoTitle}</span>
                  </div>
                  <div>
                    <span className="vp-detail-label">Watched / Total</span>
                    <span className="vp-detail-value">
                      {formatDuration(selectedRecord.watchedSeconds)} / {formatDuration(selectedRecord.totalSeconds)}
                    </span>
                  </div>
                  <div>
                    <span className="vp-detail-label">Completion Status</span>
                    <span className={`vp-status-badge ${getStatusBadge(selectedRecord.status)}`}>
                      <span className="vp-status-dot"></span>
                      {selectedRecord.status}
                    </span>
                  </div>
                </div>
                <div className="vp-detail-progress-section">
                  <div className="vp-detail-progress-header">
                    <span>Completion</span>
                    <span className={`vp-detail-progress-pct progress-text-${getProgressColor(selectedRecord.progress)}`}>
                      {selectedRecord.progress}%
                    </span>
                  </div>
                  <div className="vp-progress-bar large">
                    <div
                      className={`vp-progress-fill progress-${getProgressColor(selectedRecord.progress)}`}
                      style={{ width: `${selectedRecord.progress}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="vp-detail-timeline">
                <h4>Activity Timeline</h4>
                <div className="vp-timeline">
                  {selectedRecord.completedAt && (
                    <div className="vp-timeline-item">
                      <div className="vp-timeline-dot green"></div>
                      <div>
                        <p className="vp-timeline-date">{formatDate(selectedRecord.completedAt)}, {formatTime(selectedRecord.completedAt)}</p>
                        <h5>Completed Video</h5>
                        <p>User finished watching "{selectedRecord.videoTitle}".</p>
                      </div>
                    </div>
                  )}
                  {selectedRecord.lastWatchedAt && (
                    <div className="vp-timeline-item">
                      <div className="vp-timeline-dot blue"></div>
                      <div>
                        <p className="vp-timeline-date">{formatDate(selectedRecord.lastWatchedAt)}, {formatTime(selectedRecord.lastWatchedAt)}</p>
                        <h5>{selectedRecord.status === 'Completed' ? 'Last Session' : 'Most Recent Session'}</h5>
                        <p>Watched up to {formatDuration(selectedRecord.watchedSeconds)} mark.</p>
                      </div>
                    </div>
                  )}
                  <div className="vp-timeline-item">
                    <div className="vp-timeline-dot grey"></div>
                    <div>
                      <p className="vp-timeline-date">First interaction</p>
                      <h5>Video Assigned</h5>
                      <p>Video "{selectedRecord.videoTitle}" was available to the user.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats Summary */}
              <div className="vp-detail-stats">
                <div className="vp-detail-stat-box">
                  <p className="vp-detail-stat-label">Total Sessions</p>
                  <p className="vp-detail-stat-value">{selectedRecord.sessions}</p>
                </div>
                <div className="vp-detail-stat-box">
                  <p className="vp-detail-stat-label">Time Spent</p>
                  <p className="vp-detail-stat-value">{formatDuration(selectedRecord.watchedSeconds)}</p>
                </div>
                <div className="vp-detail-stat-box">
                  <p className="vp-detail-stat-label">Avg Session</p>
                  <p className="vp-detail-stat-value">
                    {selectedRecord.sessions > 0 ? formatDuration(Math.round(selectedRecord.watchedSeconds / selectedRecord.sessions)) : '0m'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default VideoProgress
