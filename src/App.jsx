import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Login from './screens/Login'
import ForgotPassword from './screens/ForgotPassword'
import ProtectedRoute from './components/ProtectedRoute'
import AdminLayout from './components/AdminLayout'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './contexts/AuthContext'
import { SCREENS } from './config/permissions'
import './App.css'

// Lazy load heavy components to reduce initial bundle size
const Dashboard = lazy(() => import('./screens/Dashboard'))
const Modules = lazy(() => import('./screens/Modules'))
const ModuleRequests = lazy(() => import('./screens/ModuleRequests'))
const Users = lazy(() => import('./screens/Users'))
const Banners = lazy(() => import('./screens/Banners'))
const Feedbacks = lazy(() => import('./screens/Feedbacks'))
const Assessments = lazy(() => import('./screens/Assessments'))
const Notifications = lazy(() => import('./screens/Notifications'))
const QuizBuilder = lazy(() => import('./screens/QuizBuilder'))
const AssignmentResults = lazy(() => import('./screens/AssignmentResults'))
const VideoProgress = lazy(() => import('./screens/VideoProgress'))
const ActiveLogins = lazy(() => import('./screens/ActiveLogins'))
const AssignModules = lazy(() => import('./screens/AssignModules'))
const AdminPermissions = lazy(() => import('./screens/AdminPermissions'))
const Videos = lazy(() => import('./screens/Videos'))

// Loading fallback component
const LoadingFallback = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: '200px',
    fontSize: '18px',
    color: '#6B7280'
  }}>
    <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }}></i>
    Loading...
  </div>
)

// Helper to wrap lazy-loaded screens with Suspense + ErrorBoundary + permission check
const Screen = ({ screen, children }) => (
  <ProtectedRoute requiredScreen={screen}>
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  </ProtectedRoute>
)

function App() {
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'
  const resolvedBase = baseUrl !== '/' && window.location.pathname.startsWith(baseUrl) ? baseUrl : '/'

  return (
    <AuthProvider>
      <Router basename={resolvedBase}>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* All admin routes share a single mounted layout */}
          <Route element={<AdminLayout />}>
            <Route path="/dashboard" element={<Screen screen={SCREENS.DASHBOARD}><Dashboard /></Screen>} />
            <Route path="/modules" element={<Screen screen={SCREENS.MODULES}><Modules /></Screen>} />
            <Route path="/videos" element={<Screen screen={SCREENS.VIDEOS}><Videos /></Screen>} />
            <Route path="/module-requests" element={<Screen screen={SCREENS.MODULE_REQUESTS}><ModuleRequests /></Screen>} />
            <Route path="/users" element={<Screen screen={SCREENS.USERS}><Users /></Screen>} />
            <Route path="/banners" element={<Screen screen={SCREENS.BANNERS}><Banners /></Screen>} />
            <Route path="/feedbacks" element={<Screen screen={SCREENS.FEEDBACKS}><Feedbacks /></Screen>} />
            <Route path="/assessments" element={<Screen screen={SCREENS.ASSESSMENTS}><Assessments /></Screen>} />
            <Route path="/quiz-builder" element={<Screen screen={SCREENS.QUIZ_BUILDER}><QuizBuilder /></Screen>} />
            <Route path="/quiz-builder/:id" element={<Screen screen={SCREENS.QUIZ_BUILDER}><QuizBuilder /></Screen>} />
            <Route path="/notifications" element={<Screen screen={SCREENS.NOTIFICATIONS}><Notifications /></Screen>} />
            <Route path="/assignment-results" element={<Screen screen={SCREENS.ASSIGNMENT_RESULTS}><AssignmentResults /></Screen>} />
            <Route path="/video-progress" element={<Screen screen={SCREENS.VIDEO_PROGRESS}><VideoProgress /></Screen>} />
            <Route path="/active-logins" element={<Screen screen={SCREENS.ACTIVE_LOGINS}><ActiveLogins /></Screen>} />
            <Route path="/assign-modules" element={<Screen screen={SCREENS.ASSIGN_MODULES}><AssignModules /></Screen>} />
            <Route path="/admin-permissions" element={<Screen screen={SCREENS.ADMIN_PERMISSIONS}><AdminPermissions /></Screen>} />
          </Route>

          {/* Catch-all route for 404s */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
