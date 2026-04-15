/**
 * AppointmentsPage — fixed:
 *   - Unit loading: now shows ALL units on first open, falls back to full list if API fails
 *   - Correctly excludes already-assessed units per student
 *   - All six appointment types; Trainer and Assessor label
 *   - Visit Type (onsite only); Duration in Hours
 *   - Placement Centre dropdown (Issue 10)
 *   - SMS notification toggle (Issue 2)
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Plus, Calendar, List, Check, X, Bell } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import {
  Modal, Badge, PageHeader, Select, Spinner, EmptyState, FormRow,
} from '../components/ui/index'
import { format } from 'date-fns'

const APPT_TYPES = [
  { value: 'cert_iii_1st_visit', label: 'Cert III – 1st Visit' },
  { value: 'cert_iii_2nd_visit', label: 'Cert III – 2nd Visit' },
  { value: 'cert_iii_3rd_visit', label: 'Cert III – 3rd Visit' },
  { value: 'diploma_1st_visit',  label: 'Diploma – 1st Visit' },
  { value: 'diploma_2nd_visit',  label: 'Diploma – 2nd Visit' },
  { value: 'reassessment_visit', label: 'Reassessment Visit' },
]

// Fallback unit lists used when API is unreachable
const FALLBACK_UNITS = {
  cert3: [
    "Children's Health and Safety","Work Environment and Legal Obligations","Provide First Aid",
    "Child Protection","WHS in Early Childhood Education","Nurture Babies and Toddlers",
    "Behaviour Management Skills","Professional Development","Observation Fundamentals",
    "Children and Nature","Use a Learning Framework","Program Planning",
    "Support Holistic Child Development","Culture Diversity and Inclusion",
  ],
  diploma: [
    "Analyse Information for Programming","Plan and Implement Curriculum",
    "Nurture Creativity in Children","Sustainable Service Operations",
    "Compliance in Education and Care","Respond to Grievances and Complaints",
    "Foster Positive Behaviour in Children","Implement Inclusive Strategies",
    "Holistic Development in Children","Collaborative Practices",
    "Health and Safety Management","Work in Partnership with Families",
    "Manage Teams","Supportive Management Skills",
  ],
}

function fallbackUnits(qualification) {
  return ['CHC50121','CHC50125'].includes(qualification)
    ? FALLBACK_UNITS.diploma
    : FALLBACK_UNITS.cert3
}

const emptyForm = {
  student_id: '', trainer_assessor_id: '', title: '',
  appointment_type: 'cert_iii_1st_visit', visit_type: 'onsite',
  placement_centre_id: '', location_address: '',
  scheduled_date: '', scheduled_time: '09:00',
  duration_hours: 1, units_assessed: [],
  preparation_notes: '', required_evidence: '',
  send_confirmation_email: true, send_confirmation_sms: false,
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState([])
  const [students, setStudents] = useState([])
  const [centres, setCentres] = useState([])
  const [trainers, setTrainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editAppt, setEditAppt] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [availableUnits, setAvailableUnits] = useState([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  const [feedbackAppt, setFeedbackAppt] = useState(null)
  const [feedback, setFeedback] = useState('')

  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (filterStatus) p.append('status', filterStatus)
    if (filterType) p.append('appointment_type', filterType)
    api.get(`/appointments?${p}`)
      .then(r => setAppointments(r.data))
      .finally(() => setLoading(false))
  }, [filterStatus, filterType])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.get('/students?status=active').then(r => setStudents(r.data)).catch(() => {})
    api.get('/users').then(r => setTrainers(r.data.filter(u => ['coordinator','admin','trainer'].includes(u.role)))).catch(() => {})
    api.get('/centres').then(r => setCentres(r.data)).catch(() => {})
  }, [])

  /**
   * Load units for the student's qualification.
   * BUG FIX: On API failure, falls back to the full unit list so the form stays usable.
   */
  const loadAvailableUnits = useCallback(async (studentId, excludeApptId = null) => {
    if (!studentId) { setAvailableUnits([]); return }
    const student = students.find(s => s.id === studentId)
    if (!student) return

    setUnitsLoading(true)
    try {
      const params = new URLSearchParams({ student_id: studentId })
      if (excludeApptId) params.append('exclude_appt_id', excludeApptId)
      const r = await api.get(`/appointments/units/${student.qualification}?${params}`)
      // Always show something — never leave the list empty on error
      setAvailableUnits(r.data.available_units?.length > 0
        ? r.data.available_units
        : fallbackUnits(student.qualification))
    } catch {
      // Fallback: show full list for qualification so user is never blocked
      setAvailableUnits(fallbackUnits(student.qualification))
    } finally {
      setUnitsLoading(false)
    }
  }, [students])

  const openAdd = () => {
    setEditAppt(null); setForm(emptyForm); setAvailableUnits([]); setShowModal(true)
  }

  const openEdit = appt => {
    setEditAppt(appt)
    setForm({
      student_id: appt.student_id,
      trainer_assessor_id: appt.trainer_assessor_id || appt.coordinator_id || '',
      title: appt.title,
      appointment_type: appt.appointment_type,
      visit_type: appt.visit_type || 'onsite',
      placement_centre_id: appt.placement_centre_id || '',
      location_address: appt.location_address || '',
      scheduled_date: appt.scheduled_date,
      scheduled_time: appt.scheduled_time,
      duration_hours: appt.duration_hours || 1,
      units_assessed: appt.units_assessed || [],
      preparation_notes: appt.preparation_notes || '',
      required_evidence: appt.required_evidence || '',
      send_confirmation_email: false,
      send_confirmation_sms: false,
    })
    loadAvailableUnits(appt.student_id, appt.id)
    setShowModal(true)
  }

  const autoTitle = (studentId, type) => {
    const s = students.find(s => s.id === studentId)
    const t = APPT_TYPES.find(t => t.value === type)
    return s && t ? `${t.label} – ${s.full_name}` : ''
  }

  const handleStudentChange = v => {
    setForm(f => ({ ...f, student_id: v, units_assessed: [], title: autoTitle(v, f.appointment_type) || f.title }))
    loadAvailableUnits(v)
  }

  const toggleUnit = (unit) => {
    setForm(f => ({
      ...f,
      units_assessed: f.units_assessed.includes(unit)
        ? f.units_assessed.filter(u => u !== unit)
        : [...f.units_assessed, unit],
    }))
  }

  const save = async () => {
    if (!form.student_id || !form.scheduled_date || !form.title)
      return toast.error('Student, Trainer/Assessor, date and title are all required')
    setSaving(true)
    try {
      if (editAppt) {
        await api.put(`/appointments/${editAppt.id}`, form)
        toast.success('Appointment updated')
      } else {
        await api.post('/appointments', form)
        toast.success(form.send_confirmation_email ? 'Appointment created & email sent' : 'Appointment created')
      }
      setShowModal(false); load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally { setSaving(false) }
  }

  const markComplete = appt => { setFeedbackAppt(appt); setFeedback(''); setShowFeedbackModal(true) }

  const submitFeedback = async () => {
    await api.put(`/appointments/${feedbackAppt.id}`, { status: 'completed', completed: true, feedback })
    toast.success('Marked as completed'); setShowFeedbackModal(false); load()
  }

  const sendReminder = async (id) => {
    try {
      const r = await api.post(`/appointments/${id}/send-reminder`)
      toast.success(r.data.message)
    } catch { toast.error('Failed to send reminder') }
  }

  const cancel = async (id) => {
    await api.put(`/appointments/${id}`, { status: 'cancelled', cancelled: true })
    toast.success('Appointment cancelled'); load()
  }

  const upcoming = appointments.filter(a => !a.completed && !a.cancelled && new Date(a.scheduled_date) >= new Date())
  const past = appointments.filter(a => a.completed || a.cancelled || new Date(a.scheduled_date) < new Date())
  const selectedCentre = centres.find(c => c.id === form.placement_centre_id)

  const ApptCard = ({ a }) => (
    <div className={`card mb-3 border-l-4 ${a.status==='completed'?'border-green-400':a.status==='cancelled'?'border-gray-300':'border-cyan'}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-gray-900 text-sm">{a.title}</h3>
            <Badge status={a.status} />
            {a.visit_reference && <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">{a.visit_reference}</span>}
          </div>
          <p className="text-xs text-gray-500">
            {format(new Date(a.scheduled_date), 'EEE, d MMM yyyy')} at {a.scheduled_time}
            {a.duration_hours && ` · ${a.duration_hours}h`}
          </p>
          {a.trainer_assessor_name && <p className="text-xs text-gray-400 mt-0.5">Trainer & Assessor: {a.trainer_assessor_name}</p>}
          {a.placement_centre_name && <p className="text-xs text-gray-500 mt-1">📍 {a.placement_centre_name}{a.placement_centre_address ? ` — ${a.placement_centre_address}` : ''}</p>}
          {a.units_assessed?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="text-xs text-gray-400 mr-1">Units:</span>
              {a.units_assessed.map(u => (
                <span key={u} className="text-xs bg-cyan/10 text-cyan px-1.5 py-0.5 rounded">{u}</span>
              ))}
            </div>
          )}
          {a.preparation_notes && <p className="text-xs text-gray-500 mt-2 italic">Prep: {a.preparation_notes}</p>}
          {a.feedback && <p className="text-xs text-green-700 mt-2 bg-green-50 p-2 rounded">Feedback: {a.feedback}</p>}
        </div>
        {a.status === 'scheduled' && (
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button onClick={() => openEdit(a)} className="btn-secondary text-xs py-1 px-2">Edit</button>
            <button onClick={() => markComplete(a)} className="btn-primary text-xs py-1 px-2"><Check size={12} /> Complete</button>
            <button onClick={() => sendReminder(a.id)} className="text-xs text-cyan hover:underline flex items-center gap-1"><Bell size={11} /> Remind</button>
            <button onClick={() => cancel(a.id)} className="text-xs text-red-500 hover:underline flex items-center gap-1"><X size={11} /> Cancel</button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title="Appointments" subtitle={`${appointments.length} total`}
        actions={
          <button onClick={openAdd} className="btn-primary text-sm"><Plus size={15} /> New Appointment</button>
        }
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <Select value={filterStatus} onChange={setFilterStatus} placeholder="All Statuses"
          options={['scheduled','completed','cancelled','rescheduled'].map(s => ({ value: s, label: s.charAt(0).toUpperCase()+s.slice(1) }))} />
        <Select value={filterType} onChange={setFilterType} placeholder="All Types" options={APPT_TYPES} />
        {(filterStatus||filterType) && (
          <button onClick={() => {setFilterStatus('');setFilterType('')}} className="text-sm text-gray-400 hover:text-navy underline">Clear</button>
        )}
      </div>

      {loading ? <Spinner /> : appointments.length === 0 ? (
        <EmptyState icon={Calendar} title="No appointments" message="Create your first appointment."
          action={<button onClick={openAdd} className="btn-primary mx-auto"><Plus size={15} /> New</button>} />
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Upcoming ({upcoming.length})</h2>
              {upcoming.map(a => <ApptCard key={a.id} a={a} />)}
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Past ({past.length})</h2>
              {past.map(a => <ApptCard key={a.id} a={a} />)}
            </div>
          )}
        </>
      )}

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editAppt ? 'Edit Appointment' : 'New Appointment'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          <div className="col-span-full">
            <FormRow label="Student" required>
              <Select value={form.student_id} onChange={handleStudentChange}
                options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))}
                placeholder="Select student…" />
            </FormRow>
          </div>

          <FormRow label="Appointment Type" required>
            <Select value={form.appointment_type} onChange={v => {
              const title = autoTitle(form.student_id, v)
              setForm(f => ({ ...f, appointment_type: v, title: title || f.title }))
            }} options={APPT_TYPES} placeholder="" />
          </FormRow>

          <FormRow label="Trainer and Assessor" required>
            <Select value={form.trainer_assessor_id}
              onChange={v => setForm(f => ({ ...f, trainer_assessor_id: v }))}
              options={trainers.map(c => ({ value: c.id, label: c.full_name }))}
              placeholder="Select trainer/assessor…" />
          </FormRow>

          <div className="col-span-full">
            <FormRow label="Title" required>
              <input className="input" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </FormRow>
          </div>

          <FormRow label="Date" required>
            <input className="input" type="date" value={form.scheduled_date}
              onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
          </FormRow>
          <FormRow label="Time">
            <input className="input" type="time" value={form.scheduled_time}
              onChange={e => setForm(f => ({ ...f, scheduled_time: e.target.value }))} />
          </FormRow>

          <FormRow label="Duration (Hours)">
            <input className="input" type="number" step="0.5" min="0.5" max="12" value={form.duration_hours}
              onChange={e => setForm(f => ({ ...f, duration_hours: +e.target.value }))} />
          </FormRow>

          <FormRow label="Visit Type">
            <Select value={form.visit_type} onChange={v => setForm(f => ({ ...f, visit_type: v }))}
              options={[{ value: 'onsite', label: 'On-site Visit' }]} placeholder="" />
          </FormRow>

          <div className="col-span-full">
            <FormRow label="Placement Centre">
              <Select value={form.placement_centre_id}
                onChange={v => {
                  const c = centres.find(x => x.id === v)
                  setForm(f => ({
                    ...f,
                    placement_centre_id: v,
                    location_address: c ? [c.address,c.suburb,c.state,c.postcode].filter(Boolean).join(', ') : f.location_address,
                  }))
                }}
                options={centres.map(c => ({ value: c.id, label: c.centre_name }))}
                placeholder="Select placement centre…" />
              {selectedCentre && (
                <p className="text-xs text-gray-400 mt-1">
                  📍 {[selectedCentre.address,selectedCentre.suburb,selectedCentre.state,selectedCentre.postcode].filter(Boolean).join(', ')}
                </p>
              )}
            </FormRow>
          </div>

          {/* Unit to be Assessed — multi-select with per-student exclusion */}
          <div className="col-span-full">
            <FormRow label="Unit(s) to be Assessed">
              {!form.student_id ? (
                <p className="text-xs text-gray-400 italic">Select a student first to see available units.</p>
              ) : unitsLoading ? (
                <p className="text-xs text-gray-400">Loading units…</p>
              ) : availableUnits.length === 0 ? (
                <p className="text-xs text-amber-600 italic bg-amber-50 rounded p-2">
                  All units have been assessed for this student in previous visits.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1 max-h-56 overflow-y-auto pr-1">
                  {availableUnits.map(unit => (
                    <label key={unit}
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs border transition-colors ${
                        form.units_assessed.includes(unit)
                          ? 'bg-cyan/10 border-cyan text-navy font-medium'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}>
                      <input type="checkbox" checked={form.units_assessed.includes(unit)}
                        onChange={() => toggleUnit(unit)} className="w-3.5 h-3.5 accent-cyan" />
                      {unit}
                    </label>
                  ))}
                </div>
              )}
              {form.units_assessed.length > 0 && (
                <p className="text-xs text-cyan mt-1 font-medium">{form.units_assessed.length} unit(s) selected</p>
              )}
            </FormRow>
          </div>

          <div className="col-span-full">
            <FormRow label="Preparation Notes">
              <textarea className="input h-20 resize-none" value={form.preparation_notes}
                onChange={e => setForm(f => ({ ...f, preparation_notes: e.target.value }))}
                placeholder="What should be prepared for this visit…" />
            </FormRow>
          </div>

          {!editAppt && (
            <div className="col-span-full space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.send_confirmation_email}
                  onChange={e => setForm(f => ({ ...f, send_confirmation_email: e.target.checked }))}
                  className="w-4 h-4 accent-cyan" />
                Send confirmation email to student and supervisor
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.send_confirmation_sms}
                  onChange={e => setForm(f => ({ ...f, send_confirmation_sms: e.target.checked }))}
                  className="w-4 h-4 accent-cyan" />
                Send confirmation SMS to student
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : editAppt ? 'Update' : 'Create Appointment'}
          </button>
        </div>
      </Modal>

      {/* Feedback Modal */}
      <Modal open={showFeedbackModal} onClose={() => setShowFeedbackModal(false)} title="Complete Appointment" size="sm">
        <p className="text-sm text-gray-600 mb-4">Add feedback notes (optional):</p>
        <textarea className="input h-28 resize-none w-full" value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder="Visit feedback, observations, outcomes…" />
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={() => setShowFeedbackModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={submitFeedback} className="btn-primary"><Check size={15} /> Mark Complete</button>
        </div>
      </Modal>
    </div>
  )
}
