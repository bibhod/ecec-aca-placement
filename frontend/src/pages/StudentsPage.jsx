/**
 * StudentsPage - the list/search/filter/add/import screen.
 *
 * The manual "Reminders" tab (Compliance Reminders + Hours Reminders send-now
 * buttons) was removed - that's covered by Communications > Automated
 * Reminder Email, which lists both as automated catalog entries.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Grid, List, MapPin, Clock, Eye, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { Modal, Badge, ProgressBar, PageHeader, SearchInput, Select, Spinner, EmptyState, FormRow } from '../components/ui/index'
import { useAuth } from '../contexts/AuthContext'

// All qualifications that may already exist on historical records (kept
// selectable when editing an existing student so their current value still
// displays correctly).
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

export default function StudentsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // ── Student list state ────────────────────────────────────────────────────
  const [students, setStudents] = useState([])
  const [centres, setCentres] = useState([])
  const [trainers, setTrainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('grid')
  const [search, setSearch] = useState('')
  const [filterCampus, setFilterCampus] = useState('')
  const [filterQual, setFilterQual] = useState('')
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || 'current')
  const [showModal, setShowModal] = useState(false)

  const [editStudent, setEditStudent] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    student_id: '', full_name: '', email: '', phone: '', qualification: 'CHC30125',
    campus: 'sydney', status: 'current', course_start_date: '', course_end_date: '',
    placement_centre_id: '', placement_start_date: '', placement_end_date: '',
    required_hours: 160, coordinator_id: '', notes: ''
  })

  const load = useCallback(() => {
    const params = new URLSearchParams()
    if (search) params.append('search', search)
    if (filterCampus) params.append('campus', filterCampus)
    if (filterQual) params.append('qualification', filterQual)
    if (filterStatus) params.append('status', filterStatus)
    api.get(`/students?${params}`).then(r => setStudents(r.data)).finally(() => setLoading(false))
  }, [search, filterCampus, filterQual, filterStatus])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.get('/centres').then(r => setCentres(r.data)).catch(() => {})
    api.get('/users').then(r => setTrainers(r.data.filter(u => u.role === 'trainer'))).catch(() => {})
  }, [])

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
    setForm(f => ({ ...f, qualification: val, required_hours: isPostgrad ? 280 : 160 }))
  }

  const save = async () => {
    if (!form.student_id || !form.full_name || !form.qualification || !form.campus) {
      toast.error('Please fill in all required fields'); return
    }
    setSaving(true)
    try {
      if (editStudent) { await api.put(`/students/${editStudent.id}`, form); toast.success('Student updated') }
      else { await api.post('/students', form); toast.success('Student added successfully') }
      setShowModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Students"
        subtitle={`${students.length} student${students.length !== 1 ? 's' : ''} found`}
        actions={isAdmin && <button onClick={openAdd} className="btn-primary text-sm"><Plus size={15} /> Add Student</button>}
      />

          <p className="flex items-center gap-1.5 text-xs text-gray-400 mb-4 -mt-2">
            <Info size={13} className="flex-shrink-0" />
            Status automatically changes to Completed once a student's Course End Date has passed.
          </p>

          <div className="flex flex-wrap gap-3 mb-6">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by name, ID, email..." />
            <Select value={filterCampus} onChange={setFilterCampus} placeholder="All Campuses"
              options={CAMPUSES.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))} />
            <Select value={filterQual} onChange={setFilterQual} placeholder="All Qualifications" options={QUALIFICATIONS} />
            <Select value={filterStatus} onChange={v => { setFilterStatus(v); setSearchParams(v ? { status: v } : {}) }} placeholder="All Statuses"
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

          {loading ? <Spinner /> : students.length === 0 ? (
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
              <FormRow label="Placement Centre" hint="Optional - students often don't have one yet when the course starts. Can be added later.">
                <Select value={form.placement_centre_id} onChange={v => setForm(f => ({ ...f, placement_centre_id: v }))}
                  options={centres.map(c => ({ value: c.id, label: c.centre_name }))} placeholder="Select centre..." />
              </FormRow>
              <FormRow label="Trainer/Assessor">
                <Select value={form.coordinator_id} onChange={v => setForm(f => ({ ...f, coordinator_id: v }))}
                  options={trainers.map(c => ({ value: c.id, label: c.full_name }))} placeholder="Select trainer/assessor..." />
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
    </div>
  )
}
