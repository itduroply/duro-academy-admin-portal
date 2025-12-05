import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import { supabase } from '../supabaseClient'
import './Dashboard.css'

function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalModules: 0,
    totalVideos: 0,
    totalAssessments: 0,
    loading: true
  })
  const [weeklySignups, setWeeklySignups] = useState([])

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  const breadcrumbItems = [
    { label: 'Home', link: true },
    { label: 'Dashboard', link: false }
  ]

  useEffect(() => {
    // Fetch stats and initialize charts when component mounts
    fetchStats()
    fetchWeeklySignups()
  }, [])

  useEffect(() => {
    // Initialize charts when weekly signups data is loaded
    if (weeklySignups.length > 0) {
      initializeCharts()
    }
  }, [weeklySignups])

  const fetchWeeklySignups = async () => {
    try {
      // Get signups from the last 7 weeks
      const weeksAgo = new Date()
      weeksAgo.setDate(weeksAgo.getDate() - 49) // 7 weeks = 49 days

      const { data, error } = await supabase
        .from('users')
        .select('created_at')
        .gte('created_at', weeksAgo.toISOString())
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Error fetching weekly signups:', error)
        // Set default data if error
        setWeeklySignups([0, 0, 0, 0, 0, 0, 0])
        return
      }

      // Group signups by week
      const weekCounts = [0, 0, 0, 0, 0, 0, 0]
      const now = new Date()

      data.forEach(user => {
        const signupDate = new Date(user.created_at)
        const daysAgo = Math.floor((now - signupDate) / (1000 * 60 * 60 * 24))
        const weekIndex = Math.floor(daysAgo / 7)
        
        if (weekIndex >= 0 && weekIndex < 7) {
          weekCounts[6 - weekIndex]++ // Reverse order so newest is last
        }
      })

      setWeeklySignups(weekCounts)
    } catch (error) {
      console.error('Error processing weekly signups:', error)
      setWeeklySignups([0, 0, 0, 0, 0, 0, 0])
    }
  }

  const fetchStats = async () => {
    try {
      // Fetch users count
      const { count: usersCount, error: usersError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })

      if (usersError) console.error('Error fetching users count:', usersError)

      // Fetch modules count
      const { count: modulesCount, error: modulesError } = await supabase
        .from('modules')
        .select('*', { count: 'exact', head: true })

      if (modulesError) console.error('Error fetching modules count:', modulesError)

      // Fetch videos count
      const { count: videosCount, error: videosError } = await supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })

      if (videosError) console.error('Error fetching videos count:', videosError)

      // Fetch assessments count
      const { count: assessmentsCount, error: assessmentsError } = await supabase
        .from('quizzes')
        .select('*', { count: 'exact', head: true })

      if (assessmentsError) console.error('Error fetching assessments count:', assessmentsError)

      setStats({
        totalUsers: usersCount || 0,
        totalModules: modulesCount || 0,
        totalVideos: videosCount || 0,
        totalAssessments: assessmentsCount || 0,
        loading: false
      })
    } catch (error) {
      console.error('Error fetching stats:', error)
      setStats(prev => ({ ...prev, loading: false }))
    }
  }

  const initializeCharts = () => {
    // Check if Highcharts is available
    if (typeof Highcharts !== 'undefined') {
      // Get week labels based on current date
      const getWeekLabels = () => {
        const labels = []
        const now = new Date()
        for (let i = 6; i >= 0; i--) {
          const weekDate = new Date(now)
          weekDate.setDate(weekDate.getDate() - (i * 7))
          const month = weekDate.toLocaleString('en-US', { month: 'short' })
          const day = weekDate.getDate()
          labels.push(`${month} ${day}`)
        }
        return labels
      }

      // Weekly User Signups Chart
      Highcharts.chart('weekly-signups-chart', {
        chart: { type: 'area', backgroundColor: 'transparent' },
        title: { text: null },
        credits: { enabled: false },
        xAxis: {
          categories: getWeekLabels(),
          labels: { style: { color: '#6B7280' } }
        },
        yAxis: {
          title: { text: null },
          labels: { style: { color: '#6B7280' } },
          allowDecimals: false
        },
        legend: { enabled: false },
        tooltip: {
          shared: true,
          headerFormat: '<b>{point.x}</b><br/>',
          pointFormat: '{series.name}: {point.y}<br/>'
        },
        plotOptions: {
          area: {
            fillColor: {
              linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
              stops: [
                [0, 'rgba(79, 70, 229, 0.3)'],
                [1, 'rgba(79, 70, 229, 0)']
              ]
            },
            marker: { radius: 2 },
            lineWidth: 2,
            states: { hover: { lineWidth: 3 } },
            threshold: null
          }
        },
        series: [{
          name: 'New Users',
          data: weeklySignups.length > 0 ? weeklySignups : [0, 0, 0, 0, 0, 0, 0],
          color: '#4F46E5'
        }]
      })

      // Module Completion Chart
      Highcharts.chart('module-completion-chart', {
        chart: { type: 'bar', backgroundColor: 'transparent' },
        title: { text: null },
        credits: { enabled: false },
        xAxis: {
          categories: ['Intro', 'Sales', 'HR', 'Support'],
          labels: { enabled: false },
          lineWidth: 0,
        },
        yAxis: {
          min: 0, max: 100,
          title: { text: null },
          gridLineWidth: 0,
          labels: { enabled: false }
        },
        legend: { enabled: false },
        tooltip: { valueSuffix: '%' },
        plotOptions: {
          bar: {
            dataLabels: { enabled: true, format: '{y}%', style: { color: '#374151', textOutline: 'none' } },
            pointWidth: 15,
            borderRadius: 5
          }
        },
        series: [{
          name: 'Completion',
          data: [85, 72, 90, 65],
          colorByPoint: true,
          colors: ['#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8']
        }]
      })

      // User Status Chart
      Highcharts.chart('user-status-chart', {
        chart: { type: 'pie', backgroundColor: 'transparent' },
        title: { text: null },
        credits: { enabled: false },
        tooltip: { pointFormat: '<b>{point.percentage:.1f}%</b>' },
        plotOptions: {
          pie: {
            innerSize: '60%',
            dataLabels: { enabled: false },
            showInLegend: true,
            borderWidth: 0
          }
        },
        legend: {
          align: 'right',
          verticalAlign: 'middle',
          layout: 'vertical',
          itemStyle: { color: '#4B5563', fontWeight: 'normal' }
        },
        series: [{
          name: 'Users',
          data: [
            { name: 'Active', y: 82, color: '#10B981' },
            { name: 'Inactive', y: 18, color: '#F59E0B' }
          ]
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

        {/* Dashboard Main */}
        <main className="dashboard-main">
          {/* Dashboard Header */}
          <section className="dashboard-header">
            <div>
              <h2>Platform Overview</h2>
              <p>Welcome back, here's a summary of DuroAcademy.</p>
            </div>
            <div className="action-buttons">
              <button className="btn btn-primary">
                <i className="fa-solid fa-puzzle-piece"></i>
                Add Module
              </button>
              <button className="btn btn-secondary">
                <i className="fa-solid fa-user-plus"></i>
                Add User
              </button>
              <button className="btn btn-secondary">
                <i className="fa-solid fa-upload"></i>
                Upload Video
              </button>
            </div>
          </section>

          {/* Metric Cards */}
          <section className="metric-cards">
            <div className="metric-card">
              <div className="metric-content">
                <p className="metric-label">Total Users</p>
                <p className="metric-value">
                  {stats.loading ? (
                    <i className="fa-solid fa-spinner fa-spin"></i>
                  ) : (
                    stats.totalUsers.toLocaleString()
                  )}
                </p>
                <p className="metric-change positive">
                  <i className="fa-solid fa-users"></i> Registered users
                </p>
              </div>
              <div className="metric-icon indigo">
                <i className="fa-solid fa-users"></i>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-content">
                <p className="metric-label">Total Modules</p>
                <p className="metric-value">
                  {stats.loading ? (
                    <i className="fa-solid fa-spinner fa-spin"></i>
                  ) : (
                    stats.totalModules.toLocaleString()
                  )}
                </p>
                <p className="metric-change positive">
                  <i className="fa-solid fa-puzzle-piece"></i> Learning modules
                </p>
              </div>
              <div className="metric-icon blue">
                <i className="fa-solid fa-puzzle-piece"></i>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-content">
                <p className="metric-label">Total Videos</p>
                <p className="metric-value">
                  {stats.loading ? (
                    <i className="fa-solid fa-spinner fa-spin"></i>
                  ) : (
                    stats.totalVideos.toLocaleString()
                  )}
                </p>
                <p className="metric-change positive">
                  <i className="fa-solid fa-video"></i> Video content
                </p>
              </div>
              <div className="metric-icon green">
                <i className="fa-solid fa-video"></i>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-content">
                <p className="metric-label">Assessments</p>
                <p className="metric-value">
                  {stats.loading ? (
                    <i className="fa-solid fa-spinner fa-spin"></i>
                  ) : (
                    stats.totalAssessments.toLocaleString()
                  )}
                </p>
                <p className="metric-change positive">
                  <i className="fa-solid fa-clipboard-question"></i> Total quizzes
                </p>
              </div>
              <div className="metric-icon orange">
                <i className="fa-solid fa-clipboard-question"></i>
              </div>
            </div>
          </section>

          {/* Charts Section */}
          <section className="charts-section">
            <div className="chart-large">
              <h3>Weekly User Signups</h3>
              <div id="weekly-signups-chart" className="chart-container"></div>
            </div>

            <div className="charts-side">
              <div className="chart-small">
                <h3>Module Completion</h3>
                <div id="module-completion-chart" className="chart-container-small"></div>
              </div>
              <div className="chart-small">
                <h3>User Status</h3>
                <div id="user-status-chart" className="chart-container-small"></div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export default Dashboard
