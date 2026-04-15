import React, { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  LayoutDashboard, Users, Calendar, Clock, FileCheck,
  MessageSquare, AlertTriangle, BarChart3, UserCog,
  Building2, Bell, ChevronDown, LogOut, Menu, X,
  Shield, ClipboardList, UserCheck, Upload
} from 'lucide-react'
import NotificationPanel from './NotificationPanel'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/students', label: 'Students', icon: Users },
  { to: '/appointments', label: 'Appointments', icon: Calendar },
  { to: '/hours', label: 'Hours Tracking', icon: Clock },
  { to: '/compliance', label: 'Compliance', icon: FileCheck },
  { to: '/communications', label: 'Communications', icon: MessageSquare },
  { to: '/issues', label: 'Issues', icon: AlertTriangle },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  null,
  { to: '/visit-reports', label: 'For Trainer/Assessor', icon: ClipboardList },
  { to: '/trainer-profiles', label: 'Trainer/Assessor Profiles', icon: UserCheck },
  null,
  { to: '/centres', label: 'Centres', icon: Building2 },
  { to: '/bulk-upload', label: 'Bulk Upload', icon: Upload },
  { to: '/users', label: 'User Management', icon: UserCog },
  { to: '/audit', label: 'Audit Trail', icon: Shield },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const handleLogout = () => { logout(); navigate('/login') }
  const initials = user?.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2) || 'U'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-64 bg-navy flex flex-col transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <img src="https://customer-assets.emergentagent.com/job_placement-hours-hub/artifacts/4rqai4vy_logo.jpg"
            alt="Academies Australasia" className="h-10 w-auto rounded" />
          <div>
            <p className="text-white text-xs font-semibold leading-tight">Academies Australasia</p>
            <p className="text-cyan text-xs">ECEC Placement Portal</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {NAV.map((item, i) => {
            if (item === null) return <div key={i} className="h-px bg-white/10 my-2 mx-2" />
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.exact}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-sm font-medium transition-all
                  ${isActive ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`
                }>
                <Icon size={18} className="flex-shrink-0" />
                <span className="leading-tight">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-cyan flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{user?.full_name}</p>
              <p className="text-white/50 text-xs capitalize truncate">{user?.role === 'trainer' ? 'Trainer/Assessor' : user?.role}</p>
            </div>
            <button onClick={handleLogout} className="text-white/40 hover:text-white p-1 rounded transition-colors">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 text-gray-400 hover:text-navy rounded-lg">
            <Menu size={20} />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 text-gray-400 hover:text-navy hover:bg-gray-100 rounded-xl transition-colors">
                <Bell size={20} />
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 z-50">
                  <NotificationPanel onClose={() => setShowNotifications(false)} />
                </div>
              )}
            </div>
            <button onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 transition-colors">
              <div className="w-7 h-7 rounded-full bg-navy flex items-center justify-center text-white text-xs font-bold">{initials}</div>
              <span className="hidden sm:block text-sm font-medium text-gray-700">{user?.full_name}</span>
              <ChevronDown size={14} className="text-gray-400" />
            </button>
            {showUserMenu && (
              <div className="absolute right-4 top-14 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 min-w-[180px]">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900">{user?.full_name}</p>
                  <p className="text-xs text-gray-400 capitalize">{user?.role === 'trainer' ? 'Trainer/Assessor' : user?.role}</p>
                </div>
                <button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
