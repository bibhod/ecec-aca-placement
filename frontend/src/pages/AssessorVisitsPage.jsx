/**
 * AssessorVisitsPage — Issue 21
 * Full UI for assessor visit logging, evidence upload, and claim verification.
 */
import React, { useEffect, useState } from 'react'
import { Plus, Upload, CheckCircle, FileText, AlertTriangle, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { downloadFile } from '../utils/api'
import { PageHeader, Spinner, Badge, Modal, FormRow, Select, EmptyState } from '../components/ui/index'
import { format } from 'date-fns'

const STATUS_COLORS = {
  pending: 'badge-yellow', evidence_required: 'badge-yellow',
  submitted: 'badge-blue', approved: 'badge-green', rejected: 'badge-red',
}

export default function AssessorVisitsPage() {
  const [visits, setVisits] = useState([])
  const [students, setStudents] = useState([])
  const [centres, setCentres] = useState([])
  const [assessors, setAssessors] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [evidenceFile, setEvidenceFile] = useState(null)
  const [form, setForm] = useState({
    student_id: '', assessor_id: '', placement_centre_id: '',
    visit_date: '', start_time: '', end_time: '',
    visit_purpose: 'observation', units_linked: [],
    observation_notes: '', notes: '',
  })
  const [availableUnits, setAvailableUnits] = useState([])

  const load = () => {
    const p = new URLSearchParams()
    if (filterStatus) p.append('status', filterStatus)
    Promise.all([
      api.get(`/assessor-visits?${p}`),
      api.get('/students'),
      api.get('/centres'),
      api.get('/users'),
    ]).then(([v, s, c, u]) => {
      setVisits(v.data)
      setStudents(s.data)
      setCentres(c.data)
      setAssessors(u.data.filter(x => ['admin','coordinator','trainer'].includes(x.role)))
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [filterStatus])

  const loadUnits = async (studentId) => {
    if (!studentId) { setAvailableUnits([]); return }
    const student = students.find(s => s.id === studentId)
    if (!student) return
    try {
      const r = await api.get(`/appointments/units/${student.qualification}?student_id=${studentId}`)
      setAvailableUnits(r.data.all_units || [])
    } catch { setAvailableUnits([]) }
  }

  const handleStudentChange = v => {
    setForm(f => ({ ...f, student_id: v, units_linked: [] }))
    loadUnits(v)
  }

  const toggleUnit = u => setForm(f => ({
    ...f,
    units_linked: f.units_linked.includes(u) ? f.units_linked.filter(x => x !== u) : [...f.units_linked, u],
  }))

  const save = async () => {
    if (!form.student_id || !form.visit_date) return toast.error('Student and visit date required')
    setSaving(true)
    try {
      const r = await api.post('/assessor-visits', form)
      if (r.data.warning) toast(r.data.warning, { icon: '⚠️', duration: 6000 })
      toast.success(`Visit created — Ref: ${r.data.visit_reference}`)
      setShowModal(false)
      setForm({ student_id:'', assessor_id:'', placement_centre_id:'', visit_date:'', start_time:'', end_time:'', visit_purpose:'observation', units_linked:[], observation_notes:'', notes:'' })
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const uploadEvidence = async (visitId) => {
    if (!evidenceFile) return toast.error('Select a file first')
    setUploading(true)
    const fd = new FormData()
    fd.append('file', evidenceFile)
    try {
      await api.post(`/assessor-visits/${visitId}/upload-evidence`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      toast.success('Evidence uploaded')
      setEvidenceFile(null)
      load()
      // Refresh detail
      const r = await api.get(`/assessor-visits`)
      const updated = r.data.find(v => v.id === visitId)
      if (updated) setSelected(updated)
    } catch (err) { toast.error(err.response?.data?.detail || 'Upload failed') }
    finally { setUploading(false) }
  }

  const submitClaim = async (visitId) => {
    try {
      await api.post(`/assessor-visits/${visitId}/submit-claim`)
      toast.success('Claim submitted for approval')
      load()
      const r = await api.get('/assessor-visits')
      const updated = r.data.find(v => v.id === visitId)
      if (updated) setSelected(updated)
    } catch (err) { toast.error(err.response?.data?.detail || 'Submit failed') }
  }

  const approveClaim = async (visitId) => {
    try {
      await api.put(`/assessor-visits/${visitId}/approve-claim`)
      toast.success('Claim approved')
      load()
      setShowDetailModal(false)
    } catch (err) { toast.error(err.response?.data?.detail || 'Approve failed') }
  }

  const exportVisits = () => downloadFile('/assessor-visits/export/csv', 'assessor_visits.csv')

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Assessor Visits" subtitle={`${visits.length} visits recorded`}
        actions={
          <>
            <button onClick={exportVisits} className="btn-secondary text-sm"><Download size={15} /> Export</button>
            <button onClick={() => setShowModal(true)} className="btn-primary text-sm"><Plus size={15} /> Record Visit</button>
          </>
        }
      />

      <div className="flex gap-3 mb-6">
        <Select value={filterStatus} onChange={setFilterStatus} placeholder="All Statuses"
          options={['pending','evidence_required','submitted','approved','rejected'].map(s => ({
            value: s, label: s.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())
          }))} />
        {filterStatus && <button onClick={() => setFilterStatus('')} className="text-sm text-gray-400 hover:text-navy underline">Clear</button>}
      </div>

      {visits.length === 0 ? (
        <EmptyState icon={FileText} title="No visits recorded"
          action={<button onClick={() => setShowModal(true)} className="btn-primary mx-auto"><Plus size={15} /> Record Visit</button>} />
      ) : (
        <div className="space-y-3">
          {visits.map(v => {
            const student = students.find(s => s.id === v.student_id)
            const centre = centres.find(c => c.id === v.placement_centre_id)
            return (
              <div key={v.id} className="card hover:shadow-md cursor-pointer transition-shadow"
                onClick={() => { setSelected(v); setShowDetailModal(true) }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{v.visit_reference}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[v.status] || 'badge-gray'}`}>
                        {v.status.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}
                      </span>
                      {v.admin_approval_required && !v.admin_approved && (
                        <span className="badge-red text-xs">Admin Approval Required</span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900">{student?.full_name || 'Unknown Student'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {v.visit_date ? format(new Date(v.visit_date), 'd MMM yyyy') : '—'}
                      {v.start_time && ` · ${v.start_time}–${v.end_time || '?'}`}
                      {centre ? ` · ${centre.centre_name}` : ''}
                    </p>
                    {v.units_linked?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {v.units_linked.map(u => (
                          <span key={u} className="text-xs bg-cyan/10 text-cyan px-1.5 py-0.5 rounded">{u}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    {v.evidence_files?.length > 0 && (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle size={12} /> {v.evidence_files.length} file(s)
                      </span>
                    )}
                    {v.claim_submitted && <span className="badge-blue">Claim Submitted</span>}
                    {v.claim_approved && <span className="badge-green">Approved</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Create Visit Modal ─────────────────────────────────────────────── */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Record Assessor Visit" size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormRow label="Student" required>
            <Select value={form.student_id} onChange={handleStudentChange}
              options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))}
              placeholder="Select student…" />
          </FormRow>
          <FormRow label="Assessor">
            <Select value={form.assessor_id} onChange={v => setForm(f => ({ ...f, assessor_id: v }))}
              options={assessors.map(a => ({ value: a.id, label: `${a.full_name} (${a.role})` }))}
              placeholder="Select assessor…" />
          </FormRow>
          <FormRow label="Placement Centre">
            <Select value={form.placement_centre_id} onChange={v => setForm(f => ({ ...f, placement_centre_id: v }))}
              options={centres.map(c => ({ value: c.id, label: c.centre_name }))} placeholder="Select centre…" />
          </FormRow>
          <FormRow label="Visit Purpose">
            <Select value={form.visit_purpose} onChange={v => setForm(f => ({ ...f, visit_purpose: v }))}
              options={['observation','assessment','follow-up','reassessment','other'].map(x => ({ value: x, label: x.charAt(0).toUpperCase()+x.slice(1) }))} placeholder="" />
          </FormRow>
          <FormRow label="Visit Date" required>
            <input className="input" type="date" value={form.visit_date} onChange={e => setForm(f => ({ ...f, visit_date: e.target.value }))} />
          </FormRow>
          <div className="grid grid-cols-2 gap-2">
            <FormRow label="Start Time"><input className="input" type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} /></FormRow>
            <FormRow label="End Time"><input className="input" type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} /></FormRow>
          </div>

          {form.student_id && availableUnits.length > 0 && (
            <div className="col-span-full">
              <FormRow label="Units Assessed During This Visit">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1 max-h-48 overflow-y-auto pr-1">
                  {availableUnits.map(u => (
                    <label key={u} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs border transition-colors ${
                      form.units_linked.includes(u) ? 'bg-cyan/10 border-cyan text-navy font-medium' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input type="checkbox" checked={form.units_linked.includes(u)} onChange={() => toggleUnit(u)} className="w-3.5 h-3.5 accent-cyan" />
                      {u}
                    </label>
                  ))}
                </div>
              </FormRow>
            </div>
          )}

          <div className="col-span-full">
            <FormRow label="Observation Notes">
              <textarea className="input h-28 resize-none" value={form.observation_notes}
                onChange={e => setForm(f => ({ ...f, observation_notes: e.target.value }))}
                placeholder="Record your observations during this visit…" />
            </FormRow>
          </div>
          <div className="col-span-full">
            <FormRow label="Additional Notes">
              <textarea className="input h-16 resize-none" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </FormRow>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Record Visit'}
          </button>
        </div>
      </Modal>

      {/* ── Visit Detail Modal ─────────────────────────────────────────────── */}
      {selected && (
        <Modal open={showDetailModal} onClose={() => { setShowDetailModal(false); setSelected(null) }}
          title={`Visit ${selected.visit_reference}`} size="lg">
          <div className="space-y-4">
            {/* Status row */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_COLORS[selected.status] || 'badge-gray'}`}>
                {selected.status.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}
              </span>
              {selected.admin_approval_required && !selected.admin_approved && (
                <span className="badge-red text-sm">⚠ Admin Approval Required for Extra Visit</span>
              )}
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 rounded-xl p-4">
              {[
                ['Student', students.find(s => s.id === selected.student_id)?.full_name || '—'],
                ['Assessor', assessors.find(a => a.id === selected.assessor_id)?.full_name || '—'],
                ['Centre', centres.find(c => c.id === selected.placement_centre_id)?.centre_name || '—'],
                ['Visit Date', selected.visit_date ? format(new Date(selected.visit_date), 'd MMM yyyy') : '—'],
                ['Start–End', `${selected.start_time || '—'} – ${selected.end_time || '—'}`],
                ['Purpose', selected.visit_purpose || '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs text-gray-400 mb-0.5">{k}</p>
                  <p className="font-medium text-gray-900">{v}</p>
                </div>
              ))}
            </div>

            {/* Units */}
            {selected.units_linked?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Units Assessed</p>
                <div className="flex flex-wrap gap-1">
                  {selected.units_linked.map(u => (
                    <span key={u} className="text-xs bg-cyan/10 text-cyan px-2 py-0.5 rounded">{u}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Observation notes */}
            {selected.observation_notes && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Observation Notes</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 whitespace-pre-wrap">{selected.observation_notes}</p>
              </div>
            )}

            {/* Evidence files */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Evidence Files</p>
              {(selected.evidence_files || []).length === 0 ? (
                <p className="text-xs text-amber-600">No evidence uploaded yet. Evidence required before claim submission.</p>
              ) : (
                <div className="space-y-1">
                  {selected.evidence_files.map((f, i) => (
                    <a key={i} href={f.url || f} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-xs text-cyan hover:underline">
                      <FileText size={12} /> {f.name || f.url || `File ${i + 1}`}
                    </a>
                  ))}
                </div>
              )}

              {/* Upload evidence */}
              {!selected.claim_submitted && (
                <div className="mt-3 flex items-center gap-2">
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    onChange={e => setEvidenceFile(e.target.files[0])}
                    className="text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-gray-300 file:text-xs file:bg-gray-50 file:cursor-pointer" />
                  <button onClick={() => uploadEvidence(selected.id)} disabled={uploading || !evidenceFile}
                    className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50">
                    <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                </div>
              )}
            </div>

            {/* Supervisor feedback */}
            {selected.supervisor_feedback && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Supervisor Feedback</p>
                <p className="text-sm text-gray-700 bg-green-50 rounded-xl p-3">{selected.supervisor_feedback}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-3 border-t border-gray-100 flex-wrap">
              {!selected.claim_submitted && (selected.evidence_files?.length > 0) && !selected.admin_approval_required && (
                <button onClick={() => submitClaim(selected.id)} className="btn-primary text-sm">
                  <CheckCircle size={15} /> Submit Claim
                </button>
              )}
              {selected.claim_submitted && !selected.claim_approved && (
                <button onClick={() => approveClaim(selected.id)} className="btn-primary text-sm">
                  <CheckCircle size={15} /> Approve Claim
                </button>
              )}
              {selected.claim_approved && (
                <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle size={15} /> Claim approved by {selected.claim_approved_by}
                </span>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
