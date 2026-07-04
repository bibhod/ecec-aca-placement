/**
 * DashboardPage - Task #18 restructure:
 *   Dashboard is now the single entry point for finding a student. It keeps
 *   the existing summary stats/alerts/charts, and folds in the student
 *   list/search/filter/add/import UI that used to live on its own
 *   "Students" nav page (now removed from the sidebar).
 */
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Building2, Calendar, FileCheck, AlertTriangle, Clock, FileX, TrendingUp,
  ShieldAlert, GraduationCap, UserX, BookOpen, Plus, Upload, Grid, List, MapPin,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { useAuth } from '../contexts/AuthContext'
import {
  StatCard, Badge, ProgressBar, Spinner, Modal, PageHeader,
  SearchInput, Select, EmptyState, FormRow,
} from '../components/ui/index'
import { format } from 'date-fns'

const COLORS = ['#1A2B5F', '#00AEEF', '#10b981', '#f59e0b', '#ef4444']

// All qualifications that may already exist on historical student records
// (kept selectable when editing an existing student so their current value
// still displays correctly).
const QUALIFICATIONS = [
  { value: 'CHC30121', label: 'CHC30121 – Certificate III in ECEC (Superseded)' },
  { value: 'CHC50121', label: 'CHC50121 – Diploma of ECEC (Superseded)' },
  { value: 'CHC30125', label: 'CHC30125 – Certificate III in Early Childhood Education and Care' },
  { value: 'CHC50125', label: 'CHC50125 – Diploma of Early Childhood Education and Care' },
]
// New students may only be enrolled under the current, non-superseded codes.
const NEW_STUDENT_QUALIFICATIONS = QUALIFICATIONS.filter(
  q => q.value === 'CHC30125' || q.value === 'CHC50125'
)
const CAMPUSES = ['sydney', 'melbourne', 'perth']
const NEW_STUDENT_CAMPUSES = ['sydney', 'melbourne']
const QUAL_SHORT = {
  'CHC30121': 'Cert III (Superseded)',
  'CHC50121': 'Diploma (Superseded)',
  'CHC30125': 'Cert III',
  'CHC50125': 'Diploma',
}

function StudentCard({ student, onClick }) {
  const compColor = { compliant: 'text-green-600', expired: 'text-red-600', pending: 'text-yellow-600' }
  return (
    <div onClick={onClick} className="card hover:shadow-md cursor-pointer transition-all hover:-translate-y-0.5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-navy flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {student.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 leading-tight">{student.full_name}</h3>
            <p className="text-xs text-gray-400">{student.student_id}</p>
          </div>
        </div>
        <Badge status={student.status} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="badge-blue text-xs">{QUAL_SHORT[student.qualification] || student.qualification}</span>
        <span className="badge-gray text-xs capitalize">{student.campus}</span>
      </div>
      {student.placement_site && (
        <p className="text-xs text-gray-500 flex items-center gap-1 mb-3 truncate">
          <MapPin size={11} className="flex-shrink-0" />{student.placement_site.centre_name}
        </p>
      )}
      <ProgressBar value={student.completed_hours} max={student.required_hours} />
      <div className="flex items-center justify-between mt-2">
        <span className={`text-xs font-medium ${compColor[student.compliance_status] || 'text-gray-500'}`}>
          {student.compliance_status === 'compliant'
            ? '✓ Compliant'
            : student.compliance_missing_count > 0
              ? `Pending - ${student.compliance_missing_count} doc${student.compliance_missing_count > 1 ? 's' : ''} missing`
              : `Compliance: ${student.compliance_status}`}
        </span>
        <span className="text-xs text-gray-400"><Clock size={10} className="inline mr-0.5" />{student.completed_hours}h</span>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const studentsRef = useRef(null)

  // ── Summary/overview state (unchanged from previous Dashboard) ───────────
  const [stats, setStats] = useState(null)
  const [upcoming, setUpcoming] = useState([])
  const [expiring, setExpiring] = useState([])
  const [actionItems, setActionItems] = useState(null)
  const [loading, setLoading] = useState(true)

  // ── Student list/search state (moved in from the old Students page) ──────
  const [students, setStudents] = useState([])
  const [centres, setCentres] = useState([])
  const [coordinators, setCoordinators] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [view, setView] = useState('grid')
  const [search, setSearch] = useState('')
  const [filterCampus, setFilterCampus] = useState('')
  const [filterQual, setFilterQual] = useState('')
  const [filterStatus, setFilterStatus] = useState('current')
  const [showModal, setShowModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [editStudent, setEditStudent] = useState(null)
  const [saving, setSaving] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [form, setForm] = useState({
    student_id: '', full_name: '', email: '', phone: '', qualification: 'CHC30125',
    campus: 'sydney', status: 'current', course_start_date: '', course_end_date: '',
    placement_centre_id: '', placement_start_date: '', placement_end_date: '',
    required_hours: 160, coordinator_id: '', notes: ''
  })

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

  const loadStudents = useCallback(() => {
    const params = new URLSearchParams()
    if (search) params.append('search', search)
    if (filterCampus) params.append('campus', filterCampus)
    if (filterQual) params.append('qualification', filterQual)
    if (filterStatus) params.append('status', filterStatus)
    api.get(`/students?${params}`).then(r => setStudents(r.data)).finally(() => setStudentsLoading(false))
  }, [search, filterCampus, filterQual, filterStatus])

  useEffect(() => { loadStudents() }, [loadStudents])
  useEffect(() => {
    api.get('/centres').then(r => setCentres(r.data)).catch(() => {})
    api.get('/users').then(r => setCoordinators(r.data.filter(u => ['coordinator', 'admin'].includes(u.role)))).catch(() => {})
  }, [])

  const goToStudents = (status) => {
    if (status) setFilterStatus(status)
    studentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openAdd = () => {
    setEditStudent(null)
    setForm({ student_id: '', full_name: '', email: '', phone: '', qualification: 'CHC30125', campus: 'sydney', status: 'current', course_start_date: '', course_end_date: '', placement_centre_id: '', placement_start_date: '', placement_end_date: '', required_hours: 160, coordinator_id: '', notes: '' })
    setShowModal(true)
  }

  const openEdit = (s, e) => {
    e?.stopPropagation()
    setEditStudent(s)
    setForm({
      student_id: s.student_id, full_name: s.full_name, email: s.email || '', phone: s.phone || '',
      qualification: s.qualification, campus: s.campus, status: s.status,
      course_start_date: s.course_start_date || '', course_end_date: s.course_end_date || '',
      placement_centre_id: s.placement_centre_id || '', placement_start_date: s.placement_start_date || '',
      placement_end_date: s.placement_end_date || '', required_hours: s.required_hours,
      coordinator_id: s.coordinator_id || '', notes: s.notes || ''
    })
    setShowModal(true)
  }

  const handleQualChange = val => {
    const isPostgrad = ['CHC50121', 'CHC50125'].includes(val)
    setForm(f => ({ ...f, qualification: val, required_hours: isPostgrad ? 288 : 160 }))
  }

  const save = async () => {
    if (!form.student_id || !form.full_name || !form.qualification || !form.campus) {
      toast.error('Please fill in all required fields'); return
    }
    setSaving(true)
    try {
      if (editStudent) { await api.put(`/students/${editStudent.id}`, form); toast.success('Student updated') }
      else { await api.post('/students', form); toast.success('Student added successfully') }
      setShowModal(false); loadStudents()
    } catch (err) { toast.error(err.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const doImport = async () => {
    if (!importFile) return toast.error('Please select a file')
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      const r = await api.post('/bulk/import/students', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setImportResult(r.data)
      toast.success(r.data.message)
      loadStudents()
    } catch (err) { toast.error(err.response?.data?.detail || 'Import failed') }
    finally { setImporting(false) }
  }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  const campusData = stats?.campus_breakdown
    ? Object.entries(stats.campus_breakdown).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
    : []
  const qualData = stats?.qualification_breakdown
    ? Object.entries(stats.qualification_breakdown).map(([name, value]) => ({ name, value }))
    : []

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Welcome */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Welcome back, {user?.full_name?.split(' ')[0]} 👋</h1>
        <p className="text-gray-500 text-sm mt-1">Here's an overview of your placement activities - {format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </div>

      {/* ── Action Required ───────────────────────────────────────────────── */}
      <div className="mb-6 card border-l-4 border-red-400">
        <h2 className="font-semibold text-navy flex items-center gap-2 mb-4">
          <ShieldAlert size={18} className="text-red-500" />
          Action Required
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Compliance Expiring', sublabel: 'within 7 days', count: actionItems?.expiring_compliance_7d ?? '-', color: 'red', link: '/compliance', icon: FileX },
            { label: 'Overdue Visits', sublabel: 'not yet completed', count: actionItems?.overdue_visits ?? '-', color: 'orange', link: '/appointments', icon: Calendar },
            { label: 'Upcoming Appointments', sublabel: 'in the next 7 days', count: actionItems?.appointments_7d ?? '-', color: 'purple', link: '/appointments', icon: Calendar },
            { label: 'Students - No Hours', sublabel: 'logged this month', count: actionItems?.zero_hours_this_month ?? '-', color: 'yellow', link: '/hours', icon: Clock },
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

      {/* Student Status Overview - clicking scrolls down to the student list below */}
      <div className="mb-4 card">
        <h2 className="font-semibold text-navy flex items-center gap-2 mb-4">
          <Users size={18} />
          Student Enrolment Status
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <button
            onClick={() => goToStudents('current')}
            className="flex flex-col items-center p-4 rounded-xl bg-blue-50 border border-blue-200 hover:border-blue-400 transition-all hover:shadow-md cursor-pointer"
          >
            <BookOpen size={24} className="text-blue-600 mb-2" />
            <p className="text-3xl font-bold text-blue-700">{stats?.current_students ?? '-'}</p>
            <p className="text-sm font-semibold text-blue-600 mt-1">Current</p>
            <p className="text-xs text-gray-400">Enrolled students</p>
          </button>
          <button
            onClick={() => goToStudents('completed')}
            className="flex flex-col items-center p-4 rounded-xl bg-green-50 border border-green-200 hover:border-green-400 transition-all hover:shadow-md cursor-pointer"
          >
            <GraduationCap size={24} className="text-green-600 mb-2" />
            <p className="text-3xl font-bold text-green-700">{stats?.completed_students ?? '-'}</p>
            <p className="text-sm font-semibold text-green-600 mt-1">Completed</p>
            <p className="text-xs text-gray-400">Course finished</p>
          </button>
          <button
            onClick={() => goToStudents('withdrawn')}
            className="flex flex-col items-center p-4 rounded-xl bg-red-50 border border-red-200 hover:border-red-400 transition-all hover:shadow-md cursor-pointer"
          >
            <UserX size={24} className="text-red-600 mb-2" />
            <p className="text-3xl font-bold text-red-700">{stats?.withdrawn_students ?? '-'}</p>
            <p className="text-sm font-semibold text-red-600 mt-1">Withdrawn</p>
            <p className="text-xs text-gray-400">Left the course</p>
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Current Students" value={stats?.current_students ?? 0} icon={Users} color="navy"
          onClick={() => goToStudents('current')} />
        <StatCard label="Active Placements" value={stats?.active_placements ?? 0} icon={Building2} color="cyan"
          onClick={() => goToStudents()} />
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

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
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
        <div className="mb-8 card border-l-4 border-yellow-400">
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

      {/* ── Students (moved in from the former Students nav page) ───────────── */}
      <div ref={studentsRef} className="pt-2">
        <PageHeader
          title="Students"
          subtitle={`${students.length} student${students.length !== 1 ? 's' : ''} found`}
          actions={
            <>
              {isAdmin && (
                <button onClick={() => { setShowImportModal(true); setImportResult(null) }} className="btn-secondary text-sm"><Upload size={15} /> Bulk Import</button>
              )}
              {isAdmin && (
                <button onClick={openAdd} className="btn-primary text-sm"><Plus size={15} /> Add Student</button>
              )}
            </>
          }
        />

        <div className="flex flex-wrap gap-3 mb-6">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, ID, email..." />
          <Select value={filterCampus} onChange={setFilterCampus} placeholder="All Campuses"
            options={CAMPUSES.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))} />
          <Select value={filterQual} onChange={setFilterQual} placeholder="All Qualifications" options={QUALIFICATIONS} />
          <Select value={filterStatus} onChange={setFilterStatus} placeholder="All Statuses"
            options={[
              { value: 'current',   label: 'Current'   },
              { value: 'completed', label: 'Completed' },
              { value: 'withdrawn', label: 'Withdrawn' },
            ]} />
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden ml-auto">
            <button onClick={() => setView('grid')} className={`p-2 ${view === 'grid' ? 'bg-navy text-white' : 'text-gray-500 hover:bg-gray-50'}`}><Grid size={16} /></button>
            <button onClick={() => setView('list')} className={`p-2 ${view === 'list' ? 'bg-navy text-white' : 'text-gray-500 hover:bg-gray-50'}`}><List size={16} /></button>
          </div>
        </div>

        {studentsLoading ? <Spinner /> : students.length === 0 ? (
          <EmptyState icon={null} title="No students found" message="Try adjusting your filters or add a new student."
            action={isAdmin ? <button onClick={openAdd} className="btn-primary mx-auto">Add Student</button> : undefined} />
        ) : view === 'grid' ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {students.map(s => <StudentCard key={s.id} student={s} onClick={() => navigate(`/students/${s.id}`)} />)}
          </div>
        ) : (
          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Student', 'Qualification', 'Campus', 'Centre', 'Hours', 'Compliance', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {students.map(s => (
                  <tr key={s.id} onClick={() => navigate(`/students/${s.id}`)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-navy text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {s.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{s.full_name}</p>
                          <p className="text-xs text-gray-400">{s.student_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{QUAL_SHORT[s.qualification] || s.qualification}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{s.campus}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{s.placement_site?.centre_name || '-'}</td>
                    <td className="px-4 py-3"><div className="w-32"><ProgressBar value={s.completed_hours} max={s.required_hours} /></div></td>
                    <td className="px-4 py-3"><Badge status={s.compliance_status} /></td>
                    <td className="px-4 py-3"><Badge status={s.status} /></td>
                    <td className="px-4 py-3">{isAdmin && <button onClick={e => openEdit(s, e)} className="text-xs text-cyan hover:underline">Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add/Edit Modal */}
        <Modal open={showModal} onClose={() => setShowModal(false)} title={editStudent ? 'Edit Student' : 'Add New Student'} size="lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormRow label="Student ID" required>
              <input className="input" value={form.student_id} onChange={e => setForm(f => ({ ...f, student_id: e.target.value }))} placeholder="e.g. STU2025001" disabled={!!editStudent} />
            </FormRow>
            <FormRow label="Full Name" required>
              <input className="input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            </FormRow>
            <FormRow label="Email">
              <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </FormRow>
            <FormRow label="Phone">
              <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </FormRow>
            <FormRow label="Qualification" required>
              <Select value={form.qualification} onChange={handleQualChange} options={editStudent ? QUALIFICATIONS : NEW_STUDENT_QUALIFICATIONS} placeholder="" />
            </FormRow>
            <FormRow label="Campus" required>
              <Select value={form.campus} onChange={v => setForm(f => ({ ...f, campus: v }))} options={(editStudent ? CAMPUSES : NEW_STUDENT_CAMPUSES).map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))} placeholder="" />
            </FormRow>
            <FormRow label="Status">
              <Select value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))}
                options={[
                  { value: 'current',   label: 'Current'   },
                  { value: 'completed', label: 'Completed' },
                  { value: 'withdrawn', label: 'Withdrawn' },
                ]} placeholder="" />
            </FormRow>
            <FormRow label="Required Hours">
              <input className="input" type="number" value={form.required_hours} onChange={e => setForm(f => ({ ...f, required_hours: +e.target.value }))} />
            </FormRow>
            <FormRow label="Course Start Date"><input className="input" type="date" value={form.course_start_date} onChange={e => setForm(f => ({ ...f, course_start_date: e.target.value }))} /></FormRow>
            <FormRow label="Course End Date"><input className="input" type="date" value={form.course_end_date} onChange={e => setForm(f => ({ ...f, course_end_date: e.target.value }))} /></FormRow>
            <FormRow label="Placement Centre">
              <Select value={form.placement_centre_id} onChange={v => setForm(f => ({ ...f, placement_centre_id: v }))}
                options={centres.map(c => ({ value: c.id, label: c.centre_name }))} placeholder="Select centre..." />
            </FormRow>
            <FormRow label="Coordinator">
              <Select value={form.coordinator_id} onChange={v => setForm(f => ({ ...f, coordinator_id: v }))}
                options={coordinators.map(c => ({ value: c.id, label: c.full_name }))} placeholder="Select coordinator..." />
            </FormRow>
            <FormRow label="Placement Start Date"><input className="input" type="date" value={form.placement_start_date} onChange={e => setForm(f => ({ ...f, placement_start_date: e.target.value }))} /></FormRow>
            <FormRow label="Placement End Date"><input className="input" type="date" value={form.placement_end_date} onChange={e => setForm(f => ({ ...f, placement_end_date: e.target.value }))} /></FormRow>
            <div className="col-span-full">
              <FormRow label="Notes"><textarea className="input h-20 resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></FormRow>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editStudent ? 'Update Student' : 'Add Student'}</button>
          </div>
        </Modal>

        {/* Bulk Import Modal */}
        <Modal open={showImportModal} onClose={() => setShowImportModal(false)} title="Bulk Import Students" size="md">
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-800">
              <p className="font-semibold mb-2">CSV/Excel format requirements:</p>
              <p className="text-xs font-mono bg-blue-100 p-2 rounded overflow-x-auto">
                student_id, full_name, email, phone, qualification, campus, status, required_hours, course_start_date, course_end_date, placement_start_date, placement_end_date, notes
              </p>
              <p className="text-xs mt-2">Qualifications: CHC30121, CHC50121, CHC30125, CHC50125</p>
              <p className="text-xs">Date format: YYYY-MM-DD (e.g. 2025-03-01)</p>
            </div>
            <FormRow label="Upload CSV or Excel File">
              <input type="file" accept=".csv,.xlsx,.xls"
                onChange={e => { setImportFile(e.target.files[0]); setImportResult(null) }}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-sm file:bg-gray-50 file:cursor-pointer" />
            </FormRow>
            {importResult && (
              <div className={`rounded-xl p-4 text-sm ${importResult.errors.length > 0 ? 'bg-yellow-50' : 'bg-green-50'}`}>
                <p className="font-semibold mb-2">{importResult.message}</p>
                {importResult.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-red-700 mb-1">Errors:</p>
                    {importResult.errors.map((e, i) => <p key={i} className="text-xs text-red-600">Row {e.row}: {e.error}</p>)}
                  </div>
                )}
                {importResult.skipped.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-yellow-700 mb-1">Skipped (already exist):</p>
                    <p className="text-xs text-yellow-600">{importResult.skipped.map(s => s?.student_id || s).join(', ')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button onClick={() => setShowImportModal(false)} className="btn-secondary">Close</button>
            <button onClick={doImport} disabled={importing || !importFile} className="btn-primary">
              <Upload size={15} />{importing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </Modal>
      </div>
    </div>
  )
}
