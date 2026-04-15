/**
 * Trainer/Assessor Profile Management Page
 * Create and manage profiles for Trainer/Assessors.
 * Records: name, email, mobile, qualifications delivering, campuses.
 */
import React, { useEffect, useState } from 'react'
import { Plus, Edit2, User, Mail, Phone, BookOpen, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { downloadFile } from '../utils/api'
import { PageHeader, Spinner, Badge, Modal, FormRow, Select, EmptyState } from '../components/ui/index'

const QUALIFICATIONS = [
  { value: 'CHC30121', label: 'CHC30121 – Certificate III (Superseded)' },
  { value: 'CHC50121', label: 'CHC50121 – Diploma (Superseded)' },
  { value: 'CHC30125', label: 'CHC30125 – Certificate III in ECEC' },
  { value: 'CHC50125', label: 'CHC50125 – Diploma of ECEC' },
]
const CAMPUSES = ['Sydney', 'Melbourne', 'Perth', 'Brisbane', 'Adelaide', 'Online']

const emptyForm = {
  user_id: '', full_name: '', email: '', mobile: '',
  qualifications_delivering: [], campuses: [], max_students: 20, notes: '',
}

export default function TrainerProfilesPage() {
  const [profiles, setProfiles] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showVisitModal, setShowVisitModal] = useState(false)
  const [editProfile, setEditProfile] = useState(null)
  const [selectedVisits, setSelectedVisits] = useState([])
  const [selectedName, setSelectedName] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = () => {
    Promise.all([api.get('/trainer-profiles'), api.get('/users')])
      .then(([p, u]) => { setProfiles(p.data); setUsers(u.data) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const openAdd = () => { setEditProfile(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = (p) => {
    setEditProfile(p)
    setForm({
      user_id: p.user_id || '', full_name: p.full_name, email: p.email || '',
      mobile: p.mobile || '', qualifications_delivering: p.qualifications_delivering || [],
      campuses: p.campuses || [], max_students: p.max_students, notes: p.notes || '',
    })
    setShowModal(true)
  }

  const viewVisits = async (p) => {
    try {
      const r = await api.get(`/trainer-profiles/${p.id}/visit-report`)
      setSelectedVisits(r.data); setSelectedName(p.full_name); setShowVisitModal(true)
    } catch { toast.error('Failed to load visit history') }
  }

  const toggleQual = (q) => setForm(f => ({
    ...f, qualifications_delivering: f.qualifications_delivering.includes(q)
      ? f.qualifications_delivering.filter(x => x !== q)
      : [...f.qualifications_delivering, q],
  }))
  const toggleCampus = (c) => setForm(f => ({
    ...f, campuses: f.campuses.includes(c) ? f.campuses.filter(x => x !== c) : [...f.campuses, c],
  }))

  const save = async () => {
    if (!form.full_name) return toast.error('Full name required')
    setSaving(true)
    try {
      if (editProfile) {
        await api.put(`/trainer-profiles/${editProfile.id}`, form)
        toast.success('Profile updated')
      } else {
        await api.post('/trainer-profiles', form)
        toast.success('Profile created')
      }
      setShowModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const trainers = users.filter(u => ['trainer','admin','coordinator'].includes(u.role))

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Trainer/Assessor Profiles"
        subtitle={`${profiles.length} profile${profiles.length!==1?'s':''} registered`}
        actions={<button onClick={openAdd} className="btn-primary text-sm"><Plus size={15} /> Add Profile</button>} />

      {profiles.length === 0 ? (
        <EmptyState icon={User} title="No profiles yet"
          message="Create a Trainer/Assessor profile to track their qualifications and visit activity."
          action={<button onClick={openAdd} className="btn-primary mx-auto"><Plus size={15} /> Add Profile</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map(p => (
            <div key={p.id} className="card hover:shadow-md transition-all">
              {/* Header */}
              <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-navy flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                  {p.full_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 leading-tight">{p.full_name}</h3>
                  <p className="text-xs text-gray-400">Trainer/Assessor</p>
                </div>
                <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-navy p-1 rounded">
                  <Edit2 size={14} />
                </button>
              </div>

              {/* Contact */}
              <div className="space-y-1 mb-3">
                {p.email && <p className="text-xs text-gray-500 flex items-center gap-1.5"><Mail size={11} />{p.email}</p>}
                {p.mobile && <p className="text-xs text-gray-500 flex items-center gap-1.5"><Phone size={11} />{p.mobile}</p>}
              </div>

              {/* Qualifications */}
              {p.qualifications_delivering?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-400 mb-1.5 flex items-center gap-1"><BookOpen size={10} /> Qualifications Delivering</p>
                  <div className="flex flex-wrap gap-1">
                    {p.qualifications_delivering.map(q => (
                      <span key={q} className="text-xs badge-blue">{q}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-cyan">{p.visits_done}</p>
                  <p className="text-xs text-gray-400">Visits Done</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-navy">{p.active_students}</p>
                  <p className="text-xs text-gray-400">Scheduled</p>
                </div>
              </div>

              <button onClick={() => viewVisits(p)}
                className="w-full text-xs text-cyan hover:underline text-center py-1">
                View Visit History →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editProfile ? 'Edit Trainer/Assessor Profile' : 'Add Trainer/Assessor Profile'} size="lg">
        <div className="space-y-4">
          {/* Link to existing user */}
          {!editProfile && (
            <FormRow label="Link to Existing User (optional)">
              <Select value={form.user_id} onChange={v => {
                const u = users.find(x => x.id === v)
                setForm(f => ({
                  ...f, user_id: v,
                  full_name: u?.full_name || f.full_name,
                  email: u?.email || f.email,
                  mobile: u?.phone || f.mobile,
                }))
              }}
                options={trainers.map(u => ({ value: u.id, label: `${u.full_name} (${u.role})` }))}
                placeholder="Select user to link profile…" />
              <p className="text-xs text-gray-400 mt-0.5">Select a user to auto-fill details, or leave blank to create standalone profile.</p>
            </FormRow>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <FormRow label="Full Name" required>
              <input className="input" value={form.full_name} onChange={e => setForm(f => ({...f, full_name: e.target.value}))} />
            </FormRow>
            <FormRow label="Email">
              <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
            </FormRow>
            <FormRow label="Mobile">
              <input className="input" value={form.mobile} onChange={e => setForm(f => ({...f, mobile: e.target.value}))} placeholder="04XX XXX XXX" />
            </FormRow>
            <FormRow label="Max Students">
              <input className="input" type="number" min="1" max="100" value={form.max_students}
                onChange={e => setForm(f => ({...f, max_students: +e.target.value}))} />
            </FormRow>
          </div>

          <FormRow label="Qualifications Delivering">
            <div className="flex flex-wrap gap-2 mt-1">
              {QUALIFICATIONS.map(q => (
                <label key={q.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                  form.qualifications_delivering.includes(q.value)
                    ? 'bg-cyan/10 border-cyan text-navy font-medium'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                }`}>
                  <input type="checkbox" checked={form.qualifications_delivering.includes(q.value)}
                    onChange={() => toggleQual(q.value)} className="w-3 h-3 accent-cyan" />
                  {q.value}
                </label>
              ))}
            </div>
          </FormRow>

          <FormRow label="Campus(es)">
            <div className="flex flex-wrap gap-2 mt-1">
              {CAMPUSES.map(c => (
                <label key={c} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                  form.campuses.includes(c)
                    ? 'bg-navy/10 border-navy text-navy font-medium'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                }`}>
                  <input type="checkbox" checked={form.campuses.includes(c)}
                    onChange={() => toggleCampus(c)} className="w-3 h-3 accent-navy" />
                  {c}
                </label>
              ))}
            </div>
          </FormRow>

          <FormRow label="Notes">
            <textarea className="input h-20 resize-none" value={form.notes}
              onChange={e => setForm(f => ({...f, notes: e.target.value}))}
              placeholder="Additional notes about this trainer/assessor…" />
          </FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : editProfile ? 'Update Profile' : 'Create Profile'}
          </button>
        </div>
      </Modal>

      {/* Visit History Modal */}
      <Modal open={showVisitModal} onClose={() => setShowVisitModal(false)}
        title={`Visit History — ${selectedName}`} size="xl">
        {selectedVisits.length === 0 ? (
          <p className="text-center text-gray-400 py-8">No visits recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>{['Student', 'Centre', 'Date', 'Type', 'Units Assessed', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {selectedVisits.map(v => (
                  <tr key={v.appointment_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{v.student_name}</p>
                      <p className="text-xs text-gray-400">{v.student_id}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{v.placement_centre}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{v.visit_date}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{v.appointment_type}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(v.units_assessed || []).map(u => (
                          <span key={u} className="text-xs bg-cyan/10 text-cyan px-1.5 py-0.5 rounded">{u}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge status={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
          <button onClick={() => setShowVisitModal(false)} className="btn-secondary">Close</button>
        </div>
      </Modal>
    </div>
  )
}
