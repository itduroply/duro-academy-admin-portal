import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import Login from './screens/Login'
import ForgotPassword from './screens/ForgotPassword'
import ProtectedRoute from './components/ProtectedRoute'
import ErrorBoundary from './components/ErrorBoundary'
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
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <Routes>
        {/* Root route redirect */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/dashboard" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Dashboard /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/modules" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Modules /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/module-requests" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><ModuleRequests /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Users /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/banners" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Banners /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/feedbacks" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Feedbacks /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/assessments" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Assessments /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/quiz-builder" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><QuizBuilder /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/quiz-builder/:id" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><QuizBuilder /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><Notifications /></Suspense></ErrorBoundary></ProtectedRoute>} />
        <Route path="/assignment-results" element={<ProtectedRoute><ErrorBoundary><Suspense fallback={<LoadingFallback />}><AssignmentResults /></Suspense></ErrorBoundary></ProtectedRoute>} />
        {/* Catch-all route for 404s */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  )
}

export default App
