import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Login from './screens/Login'
import ForgotPassword from './screens/ForgotPassword'
import Dashboard from './screens/Dashboard'
import Modules from './screens/Modules'
import ModuleRequests from './screens/ModuleRequests'
import Users from './screens/Users'
import Banners from './screens/Banners'
import Feedbacks from './screens/Feedbacks'
import Assessments from './screens/Assessments'
import Notifications from './screens/Notifications'
import QuizBuilder from './screens/QuizBuilder'
import ProtectedRoute from './components/ProtectedRoute'
import './App.css'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/duro-academy-admin-portal" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/modules" element={<ProtectedRoute><Modules /></ProtectedRoute>} />
        <Route path="/module-requests" element={<ProtectedRoute><ModuleRequests /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute><Users /></ProtectedRoute>} />
        <Route path="/banners" element={<ProtectedRoute><Banners /></ProtectedRoute>} />
        <Route path="/feedbacks" element={<ProtectedRoute><Feedbacks /></ProtectedRoute>} />
        <Route path="/assessments" element={<ProtectedRoute><Assessments /></ProtectedRoute>} />
        <Route path="/quiz-builder" element={<ProtectedRoute><QuizBuilder /></ProtectedRoute>} />
        <Route path="/quiz-builder/:id" element={<ProtectedRoute><QuizBuilder /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
      </Routes>
    </Router>
  )
}

export default App
