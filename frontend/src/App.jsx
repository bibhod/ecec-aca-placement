import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import StudentsPage from './pages/StudentsPage'
import StudentDetailPage from './pages/StudentDetailPage'
import AppointmentsPage from './pages/AppointmentsPage'
import HoursPage from './pages/HoursPage'
import CompliancePage from './pages/CompliancePage'
import CommunicationsPage from './pages/CommunicationsPage'
import IssuesPage from './pages/IssuesPage'
import ReportsPage from './pages/ReportsPage'
import UsersPage from './pages/UsersPage'
import CentresPage from './pages/CentresPage'
import AuditPage from './pages/AuditPage'
import VisitReportsPage from './pages/VisitReportsPage'
import TrainerProfilesPage from './pages/TrainerProfilesPage'
import BulkUploadPage from './pages/BulkUploadPage'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-cyan border-t-transparent" />
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="students/:id" element={<StudentDetailPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="hours" element={<HoursPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="communications" element={<CommunicationsPage />} />
        <Route path="issues" element={<IssuesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="centres" element={<CentresPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="visit-reports" element={<VisitReportsPage />} />
        <Route path="trainer-profiles" element={<TrainerProfilesPage />} />
        <Route path="bulk-upload" element={<BulkUploadPage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>
}
