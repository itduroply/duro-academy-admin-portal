import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Sidebar.css'

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  const isActive = (path) => {
    return location.pathname === path ? 'active' : ''
  }

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
      localStorage.removeItem('adminEmail')
      navigate('/login')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  return (
    <>
      {/* Sidebar Overlay for Mobile */}
      <div 
        className={`sidebar-overlay ${sidebarOpen ? 'active' : ''}`}
        onClick={toggleSidebar}
      ></div>

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1>DuroAcademy</h1>
        </div>
        <nav className="sidebar-nav">
          <a 
            href="#" 
            className={`nav-link ${isActive('/dashboard')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}
          >
            <i className="fa-solid fa-chart-pie"></i>
            Dashboard
          </a>
          <a 
            href="#" 
            className={`nav-link ${isActive('/modules')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/modules'); }}
          >
            <i className="fa-solid fa-puzzle-piece"></i>
            Modules
          </a>
          <a 
            href="#" 
            className={`nav-link ${isActive('/module-requests')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/module-requests'); }}
          >
            <i className="fa-solid fa-user-check"></i>
            Module Requests
          </a>
          <a 
            href="#" 
            className={`nav-link ${isActive('/users')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/users'); }}
          >
            <i className="fa-solid fa-users"></i>
            Users
          </a>
          <a 
            href="#" 
            className={`nav-link ${isActive('/banners')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/banners'); }}
          >
            <i className="fa-solid fa-image"></i>
            Banners
          </a>
          <a 
            href="#" 
            className={`nav-link ${isActive('/feedbacks')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/feedbacks'); }}
          >
            <i className="fa-solid fa-comment-dots"></i>
            Feedback
          </a>
          <a 
            href="#" 
            className={`nav-link ${isActive('/notifications')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/notifications'); }}
          >
            <i className="fa-regular fa-bell"></i>
            Notifications
          </a>
          <a 
            href="#" 
            className={`nav-link ${isActive('/assessments')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/assessments'); }}
          >
            <i className="fa-solid fa-clipboard-question"></i>
            Assessments
          </a>
          <a 
            href="#" 
            className={`nav-link ${isActive('/assignment-results')}`} 
            onClick={(e) => { e.preventDefault(); navigate('/assignment-results'); }}
          >
            <i className="fa-solid fa-clipboard-list"></i>
            Assignment Results
          </a>
          <a href="#" className="nav-link" onClick={(e) => e.preventDefault()}>
            <i className="fa-solid fa-chart-line"></i>
            Analytics
          </a>
        </nav>
        <div className="sidebar-footer">
          <a href="#" className="nav-link" onClick={(e) => e.preventDefault()}>
            <i className="fa-solid fa-gear"></i>
            Settings
          </a>
          <a href="#" className="nav-link logout-link" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
            <i className="fa-solid fa-right-from-bracket"></i>
            Logout
          </a>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
export { Sidebar }
