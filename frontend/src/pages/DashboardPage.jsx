import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Building2, Calendar, FileCheck, AlertTriangle, Clock, FileX, TrendingUp, ShieldAlert } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import api from '../utils/api'
import { useAuth } from '../contexts/AuthContext'
import { StatCard, Badge, ProgressBar, Spinner } from '../components/ui/index'
import { format } from 'date-fns'

const COLORS = ['#1A2B5F', '#00AEEF', '#10b981', '#f59e0b', '#ef4444']

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [upcoming, setUpcoming] = useState([])
  const [expiring, setExpiring] = useState([])
  const [actionItems, setActionItems] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // Fetch each independently so one failure doesn't blank the whole dashboard
    api.get('/dashboard/stats')
      .then(r => setStats(r.data))
      .catch(e => console.error('Dashboard stats failed:', e))
    api.get('/dashboard/upcoming-appointments')
      .then(r => setUpcoming(r.data))
      .catch(() => setUpcoming([]))
    api.get('/dashboard/expiring-documents')
      .then(r => setExpiring(r.data))
      .catch(() => setExpiring([]))
      .finally(() => setLoading(false))
    api.get('/dashboard/action-items')
      .then(r => setActionItems(r.data))
      .catch(() => setActionItems(null))
  }, [])

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  const campusData = stats?.campus_breakdown
    ? Object.entries(stats.campus_breakdown).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
    : []

  const qualData = stats?.qualification_breakdown
    ? Object.entries(stats.qualification_breakdown).map(([name, value]) => ({
        name: name === 'CHC30121' ? 'Cert III' : 'Diploma', value
      }))
    : []

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Welcome */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Welcome back, {user?.full_name?.split(' ')[0]} 👋</h1>
        <p className="text-gray-500 text-sm mt-1">Here's an overview of your placement activities — {format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </div>

      {/* ── Action Required ───────────────────────────────────────────────────────────────── */}
      <div className="mb-6 card border-l-4 border-red-400">
        <h2 className="font-semibold text-navy flex items-center gap-2 mb-4">
          <ShieldAlert size={18} className="text-red-500" />
          Action Required
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              label: 'Compliance Expiring',
              sublabel: 'within 7 days',
              count: actionItems?.expiring_compliance_7d ?? '—',
              color: 'red',
              link: '/compliance',
              icon: FileX,
            },
            {
              label: 'Overdue Visits',
              sublabel: 'not yet completed',
              count: actionItems?.overdue_visits ?? '—',
              color: 'orange',
              link: '/appointments',
              icon: Calendar,
            },
            {
              label: 'Upcoming Appointments',
              sublabel: 'in the next 7 days',
              count: actionItems?.appointments_7d ?? '—',
              color: 'purple',
              link: '/appointments',
              icon: Calendar,
            },
            {
              label: 'Students — No Hours',
              sublabel: 'logged this month',
              count: actionItems?.zero_hours_this_month ?? '—',
              color: 'yellow',
              link: '/hours',
              icon: Clock,
            },
          ].map(item => {
            const isZero = item.count === 0
            return (
              <button
                key={item.label}
                onClick={() => navigate(item.link)}
                className={`text-left p-4 rounded-xl border-2 transition-all hover:shadow-md
                  ${isZero
                    ? 'border-gray-100 bg-gray-50 opacity-60 cursor-default'
                    : item.color === 'red'    ? 'border-red-200 bg-red-50 hover:border-red-400'
                    : item.color === 'orange' ? 'border-orange-200 bg-orange-50 hover:border-orange-400'
                    : item.color === 'purple' ? 'border-purple-200 bg-purple-50 hover:border-purple-400'
                    : 'border-yellow-200 bg-yellow-50 hover:border-yellow-400'
                  }`}
              >
                <p className={`text-2xl font-bold mb-1
                  ${isZero ? 'text-gray-400'
                    : item.color === 'red'    ? 'text-red-600'
                    : item.color === 'orange' ? 'text-orange-600'
                    : item.color === 'purple' ? 'text-purple-600'
                    : 'text-yellow-600'
                  }`}>
                  {item.count}
                </p>
                <p className="text-sm font-semibold text-gray-700">{item.label}</p>
                <p className="text-xs text-gray-400">{item.sublabel}</p>
                {!isZero && (
                  <p className="text-xs mt-2 font-medium text-cyan">View →</p>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Students" value={stats?.total_students ?? 0} icon={Users} color="navy"
          onClick={() => navigate('/students')} />
        <StatCard label="Active Placements" value={stats?.active_placements ?? 0} icon={Building2} color="cyan"
          onClick={() => navigate('/students')} />
        <StatCard label="Upcoming Appointments" value={stats?.upcoming_appointments ?? 0} icon={Calendar} color="purple"
          onClick={() => navigate('/appointments')} />
        <StatCard label="Pending Compliance" value={stats?.pending_compliance ?? 0} icon={FileCheck} color="yellow"
          onClick={() => navigate('/compliance')} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Open Issues" value={stats?.open_issues ?? 0} icon={AlertTriangle} color="orange"
          onClick={() => navigate('/issues')} />
        <StatCard label="Expiring Documents" value={stats?.expiring_documents ?? 0} icon={FileX} color="red"
          onClick={() => navigate('/compliance')} />
        <StatCard label="Hours Logged Today" value={`${stats?.hours_logged_today ?? 0}h`} icon={Clock} color="green" />
        <StatCard label="Reports" value="View" icon={TrendingUp} color="cyan" onClick={() => navigate('/reports')} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Upcoming Appointments */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-navy flex items-center gap-2"><Calendar size={18} /> Upcoming Appointments</h2>
            <button onClick={() => navigate('/appointments')} className="text-sm text-cyan hover:underline">View all →</button>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">No upcoming appointments in the next 7 days</p>
          ) : (
            <div className="space-y-3">
              {upcoming.map(a => (
                <div key={a.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 cursor-pointer transition-colors"
                  onClick={() => navigate('/appointments')}>
                  <div className="w-10 h-10 bg-navy rounded-lg flex items-center justify-center flex-shrink-0">
                    <Calendar size={18} className="text-cyan" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{a.title}</p>
                    <p className="text-xs text-gray-500">{a.student_name} · {format(new Date(a.scheduled_date), 'd MMM yyyy')} at {a.scheduled_time}</p>
                  </div>
                  <Badge status={a.location_type} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Charts */}
        <div className="space-y-4">
          {/* Campus breakdown */}
          {campusData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-navy text-sm mb-3">Students by Campus</h3>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={campusData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#00AEEF" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Qualification breakdown */}
          {qualData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-navy text-sm mb-3">By Qualification</h3>
              <ResponsiveContainer width="100%" height={100}>
                <PieChart>
                  <Pie data={qualData} cx="50%" cy="50%" innerRadius={28} outerRadius={45} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                    {qualData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Expiring Documents Alert */}
      {expiring.length > 0 && (
        <div className="mt-6 card border-l-4 border-yellow-400">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-navy flex items-center gap-2"><FileX size={18} className="text-yellow-500" /> Documents Expiring Soon</h2>
            <button onClick={() => navigate('/compliance')} className="text-sm text-cyan hover:underline">Manage →</button>
          </div>
          <div className="space-y-2">
            {expiring.slice(0, 5).map(d => (
              <div key={d.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                <div>
                  <span className="font-medium text-gray-900">{d.student_name}</span>
                  <span className="text-gray-500 ml-2">· {d.document_type.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 text-xs">{format(new Date(d.expiry_date), 'd MMM yyyy')}</span>
                  <Badge status={d.days_until_expiry <= 7 ? 'expired' : 'expiring_soon'}
                    label={`${d.days_until_expiry}d left`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
