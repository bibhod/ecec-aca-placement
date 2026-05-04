/**
 * StudentDetailPage — fixes Issues 3, 4, 5:
 *   Issue 3: Multi-row log hours (add multiple date entries at once)
 *   Issue 4: Five specific compliance doc types visible in the student Compliance tab
 *   Issue 5: Each section (Compliance, Appointments, Communications, Issues) has its own
 *            + Add button; "Log Hours" button no longer appears in all sections
 */
import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, MapPin, Clock, FileCheck, Calendar, AlertTriangle, MessageSquare, Plus, CheckCircle, XCircle, Trash2, UserCog } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { Badge, ProgressBar, Spinner, Modal, FormRow, Select } from '../components/ui/index'
import { format } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'

// Issue 4 — five required compliance document types
const COMPLIANCE_DOC_TYPES = [
  { value: 'working_with_children_check',   label: 'Working with Children Check' },
  { value: 'first_aid_certificate',          label: 'Valid First Aid Certificate (including CPR)' },
  { value: 'work_placement_agreement',       label: 'Work Placement Agreement' },
  { value: 'memorandum_of_understanding',    label: 'Memorandum of Understanding (MOU)' },
]

const ISSUE_TYPES = ['attendance', 'behaviour', 'performance', 'compliance', 'other']

export default function StudentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [student, setStudent] = useState(null)
  const [hours, setHours] = useState([])
  const [appointments, setAppointments] = useState([])
  const [comms, setComms] = useState([])
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  // Issue 3 — multi-row log hours
  const [showLogHours, setShowLogHours] = useState(false)
  const emptyEntry = { log_date: '', hours: '', activity_description: '' }
  const [hoursEntries, setHoursEntries] = useState([{ ...emptyEntry }])

  // Compliance modal (Issue 4, 8)
  const [showComplianceModal, setShowComplianceModal] = useState(false)
  const [compForm, setCompForm] = useState({
    document_type: 'working_with_children_check',
    entry_date: new Date().toISOString().split('T')[0],
    issue_date: '', expiry_date: '', notes: ''
  })
  // Appointment modal
  const [showApptModal, setShowApptModal] = useState(false)
  const [centres, setCentres] = useState([])
  const [trainers, setTrainers] = useState([])
  const [apptForm, setApptForm] = useState({
    appointment_type: 'cert_iii_1st_visit', placement_centre_id: '',
    scheduled_date: '', scheduled_time: '09:00', duration_hours: 1,
    preparation_notes: '', send_confirmation_email: true,
  })

  // Communications modal
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailForm, setEmailForm] = useState({ subject: '', body: '' })

  // Issues modal
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [issueForm, setIssueForm] = useState({ issue_type: 'attendance', title: '', description: '', priority: 'medium' })

  // Placement completion checklist
  const [checklist, setChecklist] = useState(null)
  const [checklistLoading, setChecklistLoading] = useState(false)
  const [generatingCompletion, setGeneratingCompletion] = useState(false)

  const loadChecklist = () => {
    setChecklistLoading(true)
    api.get(`/students/${id}/checklist`)
      .then(r => setChecklist(r.data))
      .catch(() => setChecklist(null))
      .finally(() => setChecklistLoading(false))
  }

  const load = () => {
    Promise.all([
      api.get(`/students/${id}`),
      api.get(`/hours?student_id=${id}`),
      api.get(`/appointments?student_id=${id}`),
      api.get(`/communications?student_id=${id}`),
      api.get(`/issues?student_id=${id}`),
    ]).then(([s, h, a, c, i]) => {
      setStudent(s.data); setHours(h.data); setAppointments(a.data); setComms(c.data); setIssues(i.data)
    }).catch(() => toast.error('Failed to load student')).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])
  useEffect(() => { if (activeTab === 'overview') loadChecklist() }, [id, activeTab])
  useEffect(() => {
    api.get('/centres').then(r => setCentres(r.data)).catch(() => {})
    api.get('/users').then(r => setTrainers(r.data.filter(u => ['coordinator', 'admin', 'trainer'].includes(u.role)))).catch(() => {})
  }, [])

  // ── Issue 3 — Multi-row hours log helpers ────────────────────────────────
  const addHoursRow = () => setHoursEntries(e => [...e, { ...emptyEntry }])
  const removeHoursRow = idx => setHoursEntries(e => e.filter((_, i) => i !== idx))
  const updateHoursRow = (idx, field, value) => setHoursEntries(e =>
    e.map((row, i) => i === idx ? { ...row, [field]: value } : row)
  )

  const logHours = async () => {
    const valid = hoursEntries.filter(e => e.log_date && e.hours && +e.hours > 0)
    if (valid.length === 0) return toast.error('At least one entry with date and hours is required')
    try {
      const r = await api.post('/hours/bulk', {
        student_id: id,
        entries: valid.map(e => ({ log_date: e.log_date, hours: +e.hours, activity_description: e.activity_description }))
      })
      const warnings = (r.data.results || []).flatMap(res => res.warnings || [])
      if (warnings.length > 0) {
        warnings.forEach(w => toast(w, { icon: '⚠️' }))
      }
      toast.success(`${valid.length} entry/entries logged`)
      setShowLogHours(false)
      setHoursEntries([{ ...emptyEntry }])
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to log hours') }
  }

  // ── Compliance add (Issue 4, 8) ──────────────────────────────────────────
  const addComplianceDoc = async () => {
    if (!compForm.document_type) return toast.error('Document type required')
    try {
      // Prepend entry_date to notes; issue_date goes to its own field
      const noteParts = []
      if (compForm.entry_date) noteParts.push(`Entry Date: ${compForm.entry_date}`)
      if (compForm.notes)      noteParts.push(compForm.notes)
      const { entry_date, ...rest } = compForm
      await api.post('/compliance', { ...rest, student_id: id, notes: noteParts.join('\n') || null })
      toast.success('Document added')
      setShowComplianceModal(false)
      setCompForm({ document_type: 'working_with_children_check', entry_date: new Date().toISOString().split('T')[0], issue_date: '', expiry_date: '', notes: '' })
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to add document') }
  }

  // ── Appointment add from student profile ────────────────────────────────
  const addAppointment = async () => {
    if (!apptForm.scheduled_date) return toast.error('Date is required')
    const APPT_LABELS = {
      'cert_iii_1st_visit': 'Cert III – 1st Visit', 'cert_iii_2nd_visit': 'Cert III – 2nd Visit',
      'cert_iii_3rd_visit': 'Cert III – 3rd Visit', 'diploma_1st_visit': 'Diploma – 1st Visit',
      'diploma_2nd_visit': 'Diploma – 2nd Visit', 'reassessment_visit': 'Reassessment Visit',
    }
    const label = APPT_LABELS[apptForm.appointment_type] || apptForm.appointment_type
    try {
      await api.post('/appointments', {
        student_id: id,
        title: `${label} – ${student.full_name}`,
        ...apptForm,
        visit_type: 'onsite',
      })
      toast.success('Appointment created')
      setShowApptModal(false)
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to create appointment') }
  }

  // ── Send email ────────────────────────────────────────────────────────────
  const sendEmail = async () => {
    if (!student?.email) return toast.error('Student has no email address')
    try {
      await api.post('/communications/send', {
        student_id: id, recipient_email: student.email,
        recipient_name: student.full_name, ...emailForm, message_type: 'email'
      })
      toast.success('Email sent')
      setShowEmailModal(false)
      setEmailForm({ subject: '', body: '' })
      load()
    } catch { toast.error('Failed to send email') }
  }

  // ── Issue add ─────────────────────────────────────────────────────────────
  const addIssue = async () => {
    if (!issueForm.title) return toast.error('Title required')
    try {
      await api.post('/issues', { ...issueForm, student_id: id })
      toast.success('Issue logged')
      setShowIssueModal(false)
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  const generateCompletion = async () => {
    setGeneratingCompletion(true)
    try {
      const r = await api.post(`/students/${id}/generate-completion`)
      toast.success(`Completion record ${r.data.reference_number} generated!`)
      loadChecklist()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not generate completion record')
    } finally { setGeneratingCompletion(false) }
  }

  // ── Admin status change ──────────────────────────────────────────────────
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [statusForm, setStatusForm] = useState({ status: '', notes: '' })
  const [savingStatus, setSavingStatus] = useState(false)

  const openStatusModal = () => {
    setStatusForm({ status: student.status, notes: '' })
    setShowStatusModal(true)
  }

  const changeStatus = async () => {
    if (!statusForm.status) return toast.error('Please select a status')
    if (statusForm.status === student.status) { setShowStatusModal(false); return }
    setSavingStatus(true)
    try {
      await api.patch(`/students/${id}/status`, statusForm)
      toast.success(`Status changed to ${statusForm.status}`)
      setShowStatusModal(false)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to change status')
    } finally { setSavingStatus(false) }
  }

  const approveHours = async (logId) => { await api.put(`/hours/${logId}/approve`); toast.success('Hours approved'); load() }
  const rejectHours = async (logId) => { await api.put(`/hours/${logId}/reject`); toast.success('Hours rejected'); load() }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>
  if (!student) return <div className="p-8 text-center text-gray-500">Student not found</div>

  const tabs = ['overview', 'hours', 'compliance', 'appointments', 'communications', 'issues']

  // Issue 5 — qualification display label
  const QUAL_LABELS = {
    'CHC30121': 'CHC30121 – Certificate III (Superseded)',
    'CHC50121': 'CHC50121 – Diploma (Superseded)',
    'CHC30125': 'CHC30125 – Certificate III in ECEC',
    'CHC50125': 'CHC50125 – Diploma of ECEC',
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <button onClick={() => navigate('/students')} className="p-2 text-gray-400 hover:text-navy hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-4 flex-1">
          <div className="w-14 h-14 rounded-full bg-navy flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
            {student.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-navy">{student.full_name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-gray-400 text-sm">{student.student_id}</span>
              <Badge status={student.status} />
              <Badge
                status={student.compliance_status}
                label={student.compliance_status === 'compliant'
                  ? 'Compliance: Complete'
                  : student.compliance_missing_count > 0
                    ? `Compliance: Pending (${student.compliance_missing_count} missing)`
                    : `Compliance: ${student.compliance_status}`}
              />
            </div>
          </div>
        </div>
        {/* Issue 5 — only global action is Email; each section has its own + Add */}
        <div className="flex gap-2">
          {['admin', 'superadmin'].includes(user?.role) && (
            <button onClick={openStatusModal} className="btn-secondary text-sm flex items-center gap-1">
              <UserCog size={15} /> Change Status
            </button>
          )}
          <button onClick={() => setShowEmailModal(true)} className="btn-secondary text-sm"><Mail size={15} /> Email</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-all
              ${activeTab === t ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="card">
              <h3 className="font-semibold text-navy mb-4">Student Information</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ['Qualification', QUAL_LABELS[student.qualification] || student.qualification],
                  ['Campus', <span className="capitalize">{student.campus}</span>],
                  ['Email', student.email || '—'],
                  ['Phone', student.phone || '—'],
                  ['Course Start', student.course_start_date ? format(new Date(student.course_start_date), 'd MMM yyyy') : '—'],
                  ['Course End', student.course_end_date ? format(new Date(student.course_end_date), 'd MMM yyyy') : '—'],
                  ['Placement Start', student.placement_start_date ? format(new Date(student.placement_start_date), 'd MMM yyyy') : '—'],
                  ['Placement End', student.placement_end_date ? format(new Date(student.placement_end_date), 'd MMM yyyy') : '—'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-gray-400 mb-0.5">{k}</p>
                    <p className="font-medium text-gray-900">{v}</p>
                  </div>
                ))}
              </div>
              {student.notes && <div className="mt-4 pt-4 border-t border-gray-100"><p className="text-xs text-gray-400 mb-1">Notes</p><p className="text-sm text-gray-700">{student.notes}</p></div>}
            </div>

            {student.placement_site && (
              <div className="card">
                <h3 className="font-semibold text-navy mb-3 flex items-center gap-2"><MapPin size={16} /> Placement Centre</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Centre', student.placement_site.centre_name],
                    ['Address', student.placement_site.address],
                    ['Trainer/Assessor', student.placement_site.supervisor_name || '—'],
                    ['Trainer/Assessor Email', student.placement_site.supervisor_email || '—'],
                    ['Trainer/Assessor Phone', student.placement_site.supervisor_phone || '—'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-gray-400 mb-0.5">{k}</p>
                      <p className="font-medium text-gray-900">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="card">
              <h3 className="font-semibold text-navy mb-4 flex items-center gap-2"><Clock size={16} /> Hours Progress</h3>
              <ProgressBar value={student.completed_hours} max={student.required_hours} />
              <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xl font-bold text-cyan">{student.completed_hours}</p>
                  <p className="text-xs text-gray-500">Completed</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xl font-bold text-navy">{student.required_hours - student.completed_hours}</p>
                  <p className="text-xs text-gray-500">Remaining</p>
                </div>
              </div>
              <button onClick={() => setShowLogHours(true)} className="btn-primary text-sm mt-3 w-full"><Plus size={14} /> Log Hours</button>
            </div>
            <div className="card">
              <h3 className="font-semibold text-navy mb-3">Quick Stats</h3>
              {[
                ['Appointments', appointments.length],
                ['Issues', issues.length],
                ['Communications', comms.length],
                ['Compliance', (() => {
                  const types = new Set((student.compliance_documents || []).map(d => d.document_type))
                  const required = ['working_with_children_check','first_aid_certificate','work_placement_agreement','memorandum_of_understanding']
                  const done = required.filter(t => types.has(t)).length
                  return `${done} / 4 required`
                })()],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 border-b border-gray-50 last:border-0 text-sm">
                  <span className="text-gray-500">{k}</span>
                  <span className="font-semibold text-gray-900">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Placement Completion Checklist ──────────────────────────────── */}
          <div className={`card mt-6 border-2 ${checklist?.all_complete ? 'border-green-400 bg-green-50/30' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy flex items-center gap-2">
                <CheckCircle size={16} className={checklist?.all_complete ? 'text-green-500' : 'text-gray-400'} />
                Placement Completion Checklist
              </h3>
              {checklist?.all_complete && !checklist?.completion_record && (
                <button
                  onClick={generateCompletion}
                  disabled={generatingCompletion}
                  className="btn-primary text-sm flex items-center gap-1">
                  <CheckCircle size={14} />
                  {generatingCompletion ? 'Generating...' : 'Generate Completion Record'}
                </button>
              )}
              {checklist?.completion_record && (
                <div className="text-right">
                  <span className="text-xs font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                    ✓ PLACEMENT COMPLETE
                  </span>
                  <p className="text-xs text-gray-400 mt-1">Ref: {checklist.completion_record.reference_number}</p>
                </div>
              )}
            </div>

            {checklistLoading ? (
              <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-2 border-cyan border-t-transparent" /></div>
            ) : checklist ? (
              <div className="space-y-2">
                {checklist.checklist.map(item => (
                  <div key={item.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border
                      ${item.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    {item.ok
                      ? <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
                      : <XCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />}
                    <div>
                      <p className="text-sm font-medium text-gray-800">{item.label}</p>
                      <p className={`text-xs mt-0.5 ${item.ok ? 'text-green-600' : 'text-red-500'}`}>{item.detail}</p>
                    </div>
                  </div>
                ))}
                {checklist.all_complete && !checklist.completion_record && (
                  <div className="mt-3 p-3 bg-green-100 rounded-xl border border-green-300 text-sm text-green-800 font-medium text-center">
                    All criteria met! Click "Generate Completion Record" to finalise.
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">Unable to load checklist</p>
            )}
          </div>
        </div>
      )}

      {/* ── Hours Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'hours' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-navy">Hours Log</h3>
            {/* Issue 5 — Log Hours button lives in the Hours tab */}
            <button onClick={() => setShowLogHours(true)} className="btn-primary text-sm"><Plus size={14} /> Log Hours</button>
          </div>
          {hours.length === 0 ? <p className="text-center text-gray-400 py-8">No hours logged yet</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50">{['Date', 'Hours', 'Activity', 'Flags', 'Approved', 'Actions'].map(h => <th key={h} className="px-3 py-2 text-left text-xs text-gray-500 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {hours.map(l => (
                    <tr key={l.id} className={l.flagged_unrealistic || l.flagged_duplicate ? 'bg-yellow-50/30' : ''}>
                      <td className="px-3 py-3">{format(new Date(l.log_date), 'd MMM yyyy')}</td>
                      <td className="px-3 py-3 font-medium">{l.hours}h</td>
                      <td className="px-3 py-3 text-gray-500">{l.activity_description || '—'}</td>
                      <td className="px-3 py-3">
                        {l.flagged_unrealistic && <span className="text-xs text-orange-600 bg-orange-50 px-1 py-0.5 rounded mr-1">⚠ Unrealistic</span>}
                        {l.flagged_duplicate && <span className="text-xs text-red-600 bg-red-50 px-1 py-0.5 rounded">⚠ Duplicate</span>}
                      </td>
                      <td className="px-3 py-3">
                        {l.approved ? <span className="text-green-600 flex items-center gap-1"><CheckCircle size={14} /> {l.approved_by}</span>
                          : <span className="text-yellow-600 text-xs">Pending</span>}
                      </td>
                      <td className="px-3 py-3">
                        {!l.approved && (
                          <div className="flex gap-2">
                            <button onClick={() => approveHours(l.id)} className="text-xs text-green-600 hover:underline">Approve</button>
                            <button onClick={() => rejectHours(l.id)} className="text-xs text-red-600 hover:underline">Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Compliance Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'compliance' && (() => {
        const REQUIRED = [
          { value: 'working_with_children_check', label: 'Working with Children Check' },
          { value: 'first_aid_certificate',        label: 'Valid First Aid Certificate (including CPR)' },
          { value: 'work_placement_agreement',     label: 'Work Placement Agreement' },
          { value: 'memorandum_of_understanding',  label: 'Memorandum of Understanding (MOU)' },
        ]
        const allDocs = student.compliance_documents || []
        const submittedTypes = new Set(allDocs.map(d => d.document_type))
        const submittedCount = REQUIRED.filter(r => submittedTypes.has(r.value)).length
        const pct = Math.round((submittedCount / REQUIRED.length) * 100)
        const barColor = pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'

        return (
          <div className="space-y-4">
            {/* Progress tracker */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-navy">Compliance Progress</h3>
                <span className={`text-sm font-bold ${pct === 100 ? 'text-green-600' : 'text-orange-500'}`}>
                  {submittedCount} / {REQUIRED.length} submitted
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
                <div className={`h-2.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="grid grid-cols-1 gap-2">
                {REQUIRED.map(r => {
                  const doc = allDocs.find(d => d.document_type === r.value)
                  return (
                    <div key={r.value} className={`flex items-center justify-between p-3 rounded-lg ${doc ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                      <div className="flex items-center gap-2">
                        {doc
                          ? <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
                          : <XCircle size={16} className="text-red-400 flex-shrink-0" />}
                        <span className="text-sm font-medium text-gray-800">{r.label}</span>
                      </div>
                      {doc
                        ? <Badge status={doc.status} />
                        : <span className="text-xs text-red-500 font-medium">Outstanding</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* All submitted documents — grouped by type, latest first */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-navy">Submitted Documents</h3>
                <button onClick={() => setShowComplianceModal(true)} className="btn-primary text-sm"><Plus size={14} /> Add Document</button>
              </div>
              {allDocs.length === 0
                ? <p className="text-center text-gray-400 py-8">No compliance documents recorded</p>
                : (() => {
                  // Group by document_type, sort each group newest first
                  const groups = {}
                  allDocs.forEach(d => {
                    if (!groups[d.document_type]) groups[d.document_type] = []
                    groups[d.document_type].push(d)
                  })
                  Object.values(groups).forEach(g => g.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')))

                  return (
                    <div className="space-y-3">
                      {Object.entries(groups).map(([dtype, docs]) => {
                        const latest = docs[0]
                        const older = docs.slice(1)
                        const docLabel = COMPLIANCE_DOC_TYPES.find(t => t.value === dtype)?.label
                          || dtype.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                        return (
                          <div key={dtype} className="border border-gray-100 rounded-xl overflow-hidden">
                            {/* Latest / current document */}
                            <div className="flex items-center justify-between p-4 bg-gray-50">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm text-gray-900">{docLabel}</p>
                                {latest.document_number && <p className="text-xs text-gray-500">#{latest.document_number}</p>}
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {latest.expiry_date ? `Expires: ${format(new Date(latest.expiry_date), 'd MMM yyyy')}` : 'No expiry'}
                                  {latest.verified && ` · Verified by ${latest.verified_by}`}
                                </p>
                                {latest.file_url && <a href={latest.file_url} target="_blank" rel="noreferrer" className="text-xs text-cyan hover:underline">View file</a>}
                              </div>
                              <div className="flex items-center gap-2 ml-3">
                                <Badge status={latest.status} />
                                <button
                                  onClick={async () => {
                                    if (!window.confirm('Delete this document?')) return
                                    try { await api.delete(`/compliance/${latest.id}`); toast.success('Deleted'); load() }
                                    catch { toast.error('Failed to delete') }
                                  }}
                                  className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"
                                  title="Delete"
                                ><Trash2 size={14} /></button>
                              </div>
                            </div>
                            {/* Previous submissions for same type (valid history) */}
                            {older.length > 0 && (
                              <div className="bg-gray-50 border-t border-gray-100 px-4 py-2">
                                <p className="text-xs text-gray-400 font-medium mb-1">Previous submissions ({older.length}):</p>
                                {older.map(od => (
                                  <div key={od.id} className="flex items-center justify-between py-1">
                                    <span className="text-xs text-gray-400">
                                      {od.document_number ? `#${od.document_number} · ` : ''}{od.expiry_date ? `Expired ${format(new Date(od.expiry_date), 'd MMM yyyy')}` : 'No expiry'}
                                      {od.file_url && <> · <a href={od.file_url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">View file</a></>}
                                    </span>
                                    <button
                                      onClick={async () => {
                                        if (!window.confirm('Delete this document from history?')) return
                                        try { await api.delete(`/compliance/${od.id}`); toast.success('Deleted'); load() }
                                        catch { toast.error('Failed to delete') }
                                      }}
                                      className="text-gray-300 hover:text-red-400 transition-colors p-1 ml-2"
                                      title="Remove from history"
                                    ><Trash2 size={12} /></button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()
              }
            </div>
          </div>
        )
      })()}

      {/* ── Appointments Tab ────────────────────────────────────────────────── */}
      {activeTab === 'appointments' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-navy">Appointments</h3>
            {/* Issue 5 — Appointments section has its own + Add button */}
            <button onClick={() => setShowApptModal(true)} className="btn-primary text-sm"><Plus size={14} /> Add Appointment</button>
          </div>
          {appointments.length === 0 ? <p className="text-center text-gray-400 py-8">No appointments scheduled</p>
            : <div className="space-y-3">
              {appointments.map(a => (
                <div key={a.id} className="p-4 bg-gray-50 rounded-xl">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{a.title}</p>
                    <Badge status={a.status} />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{format(new Date(a.scheduled_date), 'd MMM yyyy')} at {a.scheduled_time}</p>
                  {a.placement_centre_name && <p className="text-xs text-gray-500">📍 {a.placement_centre_name}</p>}
                  {a.units_assessed && a.units_assessed.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">Units: {a.units_assessed.join(', ')}</p>
                  )}
                  {a.feedback && <p className="text-xs text-gray-600 mt-2 italic">"{a.feedback}"</p>}
                </div>
              ))}
            </div>
          }
        </div>
      )}

      {/* ── Communications Tab ─────────────────────────────────────────────── */}
      {activeTab === 'communications' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-navy">Communications</h3>
            {/* Issue 5 — Communications section has its own + Add button */}
            <button onClick={() => setShowEmailModal(true)} className="btn-primary text-sm"><Mail size={14} /> Send Email</button>
          </div>
          {comms.length === 0 ? <p className="text-center text-gray-400 py-8">No communications yet</p>
            : <div className="space-y-3">
              {comms.map(c => (
                <div key={c.id} className="p-4 bg-gray-50 rounded-xl">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm">{c.subject}</p>
                    <span className="text-xs text-gray-400">{c.sent_at ? format(new Date(c.sent_at), 'd MMM yyyy HH:mm') : ''}</span>
                  </div>
                  <p className="text-xs text-gray-500">To: {c.recipient_name} &lt;{c.recipient_email}&gt;</p>
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">{c.body}</p>
                </div>
              ))}
            </div>
          }
        </div>
      )}

      {/* ── Issues Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'issues' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-navy">Issues</h3>
            {/* Issue 5 — Issues section has its own + Add button */}
            <button onClick={() => setShowIssueModal(true)} className="btn-primary text-sm"><Plus size={14} /> Log Issue</button>
          </div>
          {issues.length === 0 ? <p className="text-center text-gray-400 py-8">No issues recorded</p>
            : <div className="space-y-3">
              {issues.map(i => (
                <div key={i.id} className="p-4 bg-gray-50 rounded-xl">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm">{i.title}</p>
                    <div className="flex gap-2"><Badge status={i.priority} /><Badge status={i.status} /></div>
                  </div>
                  <p className="text-xs text-gray-500">{i.issue_type.replace(/_/g, ' ')}</p>
                  {i.description && <p className="text-sm text-gray-600 mt-2">{i.description}</p>}
                  {i.resolution && <p className="text-sm text-green-700 mt-2 bg-green-50 p-2 rounded">Resolution: {i.resolution}</p>}
                </div>
              ))}
            </div>
          }
        </div>
      )}

      {/* ── Issue 3 — Multi-row Log Hours Modal ──────────────────────────────── */}
      <Modal open={showLogHours} onClose={() => { setShowLogHours(false); setHoursEntries([{ ...emptyEntry }]) }} title="Log Placement Hours" size="lg">
        <p className="text-xs text-gray-500 mb-4">Add one or more entries. Click "+ Add Row" to log hours for different dates in a single session.</p>
        <div className="space-y-3">
          {hoursEntries.map((entry, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-start bg-gray-50 p-3 rounded-xl">
              <div className="col-span-4">
                <label className="text-xs text-gray-500 mb-1 block">Date *</label>
                <input className="input text-sm" type="date" value={entry.log_date}
                  onChange={e => updateHoursRow(idx, 'log_date', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">Hours *</label>
                <input className="input text-sm" type="number" step="0.5" min="0.5" max="24" value={entry.hours}
                  onChange={e => updateHoursRow(idx, 'hours', e.target.value)} placeholder="8" />
              </div>
              <div className="col-span-5">
                <label className="text-xs text-gray-500 mb-1 block">Activity Description</label>
                <input className="input text-sm" value={entry.activity_description}
                  onChange={e => updateHoursRow(idx, 'activity_description', e.target.value)}
                  placeholder="Describe activities..." />
              </div>
              <div className="col-span-1 flex items-end pb-0.5">
                {hoursEntries.length > 1 && (
                  <button onClick={() => removeHoursRow(idx)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <button onClick={addHoursRow} className="btn-secondary text-sm mt-3"><Plus size={14} /> Add Row</button>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => { setShowLogHours(false); setHoursEntries([{ ...emptyEntry }]) }} className="btn-secondary">Cancel</button>
          <button onClick={logHours} className="btn-primary">Log Hours</button>
        </div>
      </Modal>

      {/* ── Compliance Modal (Issue 4, 8) ─────────────────────────────────────── */}
      <Modal open={showComplianceModal} onClose={() => setShowComplianceModal(false)} title="Add Compliance Document" size="md">
        <div className="space-y-4">
          <FormRow label="Document Type" required>
            <Select value={compForm.document_type} onChange={v => setCompForm(f => ({ ...f, document_type: v }))}
              options={COMPLIANCE_DOC_TYPES} placeholder="" />
          </FormRow>
          <div className="grid grid-cols-3 gap-4">
            <FormRow label="Entry Date">
              <input className="input" type="date" value={compForm.entry_date} onChange={e => setCompForm(f => ({ ...f, entry_date: e.target.value }))} />
            </FormRow>
            <FormRow label="Issue Date">
              <input className="input" type="date" value={compForm.issue_date} onChange={e => setCompForm(f => ({ ...f, issue_date: e.target.value }))} />
            </FormRow>
            <FormRow label="Expiry Date">
              <input className="input" type="date" value={compForm.expiry_date} onChange={e => setCompForm(f => ({ ...f, expiry_date: e.target.value }))} />
            </FormRow>
          </div>
          <FormRow label="Notes"><textarea className="input h-16 resize-none" value={compForm.notes} onChange={e => setCompForm(f => ({ ...f, notes: e.target.value }))} /></FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowComplianceModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={addComplianceDoc} className="btn-primary">Add Document</button>
        </div>
      </Modal>

      {/* ── Appointment Modal ─────────────────────────────────────────────────── */}
      <Modal open={showApptModal} onClose={() => setShowApptModal(false)} title="Add Appointment" size="md">
        <div className="space-y-4">
          <FormRow label="Appointment Type" required>
            <Select value={apptForm.appointment_type} onChange={v => setApptForm(f => ({ ...f, appointment_type: v }))}
              options={[
                { value: 'cert_iii_1st_visit', label: 'Cert III – 1st Visit' },
                { value: 'cert_iii_2nd_visit', label: 'Cert III – 2nd Visit' },
                { value: 'cert_iii_3rd_visit', label: 'Cert III – 3rd Visit' },
                { value: 'diploma_1st_visit', label: 'Diploma – 1st Visit' },
                { value: 'diploma_2nd_visit', label: 'Diploma – 2nd Visit' },
                { value: 'reassessment_visit', label: 'Reassessment Visit' },
              ]} placeholder="" />
          </FormRow>
          <FormRow label="Placement Centre">
            <Select value={apptForm.placement_centre_id} onChange={v => setApptForm(f => ({ ...f, placement_centre_id: v }))}
              options={centres.map(c => ({ value: c.id, label: c.centre_name }))} placeholder="Select centre..." />
          </FormRow>
          <FormRow label="Trainer and Assessor">
            <Select value={apptForm.trainer_assessor_id || ''} onChange={v => setApptForm(f => ({ ...f, trainer_assessor_id: v }))}
              options={trainers.map(t => ({ value: t.id, label: t.full_name }))} placeholder="Select trainer..." />
          </FormRow>
          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Date" required><input className="input" type="date" value={apptForm.scheduled_date} onChange={e => setApptForm(f => ({ ...f, scheduled_date: e.target.value }))} /></FormRow>
            <FormRow label="Time"><input className="input" type="time" value={apptForm.scheduled_time} onChange={e => setApptForm(f => ({ ...f, scheduled_time: e.target.value }))} /></FormRow>
          </div>
          <FormRow label="Duration (Hours)">
            <input className="input" type="number" step="0.5" min="0.5" max="12" value={apptForm.duration_hours}
              onChange={e => setApptForm(f => ({ ...f, duration_hours: +e.target.value }))} />
          </FormRow>
          <FormRow label="Preparation Notes">
            <textarea className="input h-16 resize-none" value={apptForm.preparation_notes} onChange={e => setApptForm(f => ({ ...f, preparation_notes: e.target.value }))} />
          </FormRow>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={apptForm.send_confirmation_email} onChange={e => setApptForm(f => ({ ...f, send_confirmation_email: e.target.checked }))} className="accent-cyan" />
            Send confirmation email
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowApptModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={addAppointment} className="btn-primary"><Plus size={14} /> Create</button>
        </div>
      </Modal>

      {/* ── Email Modal ────────────────────────────────────────────────────────── */}
      <Modal open={showEmailModal} onClose={() => setShowEmailModal(false)} title={`Email ${student.full_name}`} size="sm">
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
            To: <strong>{student.full_name}</strong> {student.email ? `<${student.email}>` : <span className="text-red-500">(no email on file)</span>}
          </div>
          <FormRow label="Subject"><input className="input" value={emailForm.subject} onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))} /></FormRow>
          <FormRow label="Message"><textarea className="input h-32 resize-none" value={emailForm.body} onChange={e => setEmailForm(f => ({ ...f, body: e.target.value }))} /></FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowEmailModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={sendEmail} className="btn-primary"><Mail size={15} /> Send Email</button>
        </div>
      </Modal>

      {/* ── Issue Modal ────────────────────────────────────────────────────────── */}
      <Modal open={showIssueModal} onClose={() => setShowIssueModal(false)} title="Log Issue" size="sm">
        <div className="space-y-4">
          <FormRow label="Issue Type" required>
            <Select value={issueForm.issue_type} onChange={v => setIssueForm(f => ({ ...f, issue_type: v }))}
              options={ISSUE_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} placeholder="" />
          </FormRow>
          <FormRow label="Title" required><input className="input" value={issueForm.title} onChange={e => setIssueForm(f => ({ ...f, title: e.target.value }))} /></FormRow>
          <FormRow label="Priority">
            <Select value={issueForm.priority} onChange={v => setIssueForm(f => ({ ...f, priority: v }))}
              options={['low', 'medium', 'high', 'critical'].map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))} placeholder="" />
          </FormRow>
          <FormRow label="Description"><textarea className="input h-24 resize-none" value={issueForm.description} onChange={e => setIssueForm(f => ({ ...f, description: e.target.value }))} /></FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowIssueModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={addIssue} className="btn-primary"><Plus size={14} /> Log Issue</button>
        </div>
      </Modal>

      {/* ── Admin: Change Student Status Modal ────────────────────────────────── */}
      <Modal open={showStatusModal} onClose={() => setShowStatusModal(false)} title="Change Enrolment Status" size="sm">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
            <p>Current status: <strong className="capitalize">{student?.status}</strong></p>
            <p className="text-xs text-blue-600 mt-1">This action will be recorded in the audit log.</p>
          </div>
          <FormRow label="New Status" required>
            <Select
              value={statusForm.status}
              onChange={v => setStatusForm(f => ({ ...f, status: v }))}
              options={[
                { value: 'current',   label: '🔵 Current — actively enrolled' },
                { value: 'completed', label: '✅ Completed — course finished' },
                { value: 'withdrawn', label: '🔴 Withdrawn — left the course' },
              ]}
              placeholder=""
            />
          </FormRow>
          <FormRow label="Reason / Notes (optional)">
            <textarea
              className="input h-20 resize-none text-sm"
              value={statusForm.notes}
              onChange={e => setStatusForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Student withdrew due to personal reasons..."
            />
          </FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowStatusModal(false)} className="btn-secondary">Cancel</button>
          <button
            onClick={changeStatus}
            disabled={savingStatus || statusForm.status === student?.status}
            className={`btn-primary ${statusForm.status === 'withdrawn' ? 'bg-red-600 hover:bg-red-700 border-red-600' : statusForm.status === 'completed' ? 'bg-green-600 hover:bg-green-700 border-green-600' : ''}`}
          >
            {savingStatus ? 'Saving...' : `Set to ${statusForm.status || '...'}`}
          </button>
        </div>
      </Modal>
    </div>
  )
}
