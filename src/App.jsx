import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Login from './screens/Login'
import ForgotPassword from './screens/ForgotPassword'
import ProtectedRoute from './components/ProtectedRoute'
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
const AdminPermissions = lazy(() => import('./screens/AdminPermissions'))

// Loading fallback component
const LoadingFallback = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    fontSize: '18px',
    color: '#6B7280'
  }}>
    <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }}></i>
    Loading...
  </div>
)

function App() {
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'
  const resolvedBase = baseUrl !== '/' && window.location.pathname.startsWith(baseUrl) ? baseUrl : '/'

  return (
    <AuthProvider>
      <Router basename={resolvedBase}>
        <Routes>
          {/* Root route redirect */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/dashboard" element={<ProtectedRoute requiredScreen={SCREENS.DASHBOARD}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Dashboard /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/modules" element={<ProtectedRoute requiredScreen={SCREENS.MODULES}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Modules /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/module-requests" element={<ProtectedRoute requiredScreen={SCREENS.MODULE_REQUESTS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><ModuleRequests /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute requiredScreen={SCREENS.USERS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Users /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/banners" element={<ProtectedRoute requiredScreen={SCREENS.BANNERS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Banners /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/feedbacks" element={<ProtectedRoute requiredScreen={SCREENS.FEEDBACKS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Feedbacks /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/assessments" element={<ProtectedRoute requiredScreen={SCREENS.ASSESSMENTS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Assessments /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/quiz-builder" element={<ProtectedRoute requiredScreen={SCREENS.QUIZ_BUILDER}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><QuizBuilder /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/quiz-builder/:id" element={<ProtectedRoute requiredScreen={SCREENS.QUIZ_BUILDER}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><QuizBuilder /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute requiredScreen={SCREENS.NOTIFICATIONS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Notifications /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/assignment-results" element={<ProtectedRoute requiredScreen={SCREENS.ASSIGNMENT_RESULTS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><AssignmentResults /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/video-progress" element={<ProtectedRoute requiredScreen={SCREENS.VIDEO_PROGRESS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><VideoProgress /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/active-logins" element={<ProtectedRoute requiredScreen={SCREENS.ACTIVE_LOGINS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><ActiveLogins /></Suspense></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin-permissions" element={<ProtectedRoute requiredScreen={SCREENS.ADMIN_PERMISSIONS}><ErrorBoundary><Suspense fallback={<LoadingFallback />}><AdminPermissions /></Suspense></ErrorBoundary></ProtectedRoute>} />
          {/* Catch-all route for 404s */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
