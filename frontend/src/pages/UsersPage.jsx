import React, { useEffect, useState } from 'react'
import { Plus, UserCheck, UserX, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { PageHeader, Spinner, Badge, Modal, FormRow, Select } from '../components/ui/index'
import { format } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'

// Trainer/Assessor-specific fields, shown only when role === 'trainer' (the
// dedicated Trainer/Assessor Profiles page has been removed; these fields now
// live directly on the user record).
const ALL_TRAINER_QUALIFICATIONS = [
  { value: 'CHC30121', label: 'CHC30121 - Certificate III (Superseded)' },
  { value: 'CHC50121', label: 'CHC50121 - Diploma (Superseded)' },
  { value: 'CHC30125', label: 'CHC30125 - Certificate III in ECEC' },
  { value: 'CHC50125', label: 'CHC50125 - Diploma of ECEC' },
]
// New trainer accounts may only deliver the current, non-superseded quals.
const NEW_TRAINER_QUALIFICATIONS = ALL_TRAINER_QUALIFICATIONS.filter(
  q => q.value === 'CHC30125' || q.value === 'CHC50125'
)

export default function UsersPage() {
  const { user: currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'admin'
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'coordinator', campus: 'sydney', phone: '', qualifications_delivering: [], max_students: 20 })

  const load = () => api.get('/users').then(r => setUsers(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const openAdd = () => { setEditUser(null); setForm({ email: '', full_name: '', password: '', role: 'coordinator', campus: 'sydney', phone: '', qualifications_delivering: [], max_students: 20 }); setShowModal(true) }
  const openEdit = u => { setEditUser(u); setForm({ email: u.email, full_name: u.full_name, password: '', role: u.role, campus: u.campus, phone: u.phone || '', qualifications_delivering: u.qualifications_delivering || [], max_students: u.max_students ?? 20 }); setShowModal(true) }
  const toggleQual = q => setForm(f => ({
    ...f, qualifications_delivering: f.qualifications_delivering.includes(q)
      ? f.qualifications_delivering.filter(x => x !== q)
      : [...f.qualifications_delivering, q],
  }))

  const save = async () => {
    if (!editUser && (!form.email || !form.full_name || !form.password)) return toast.error('Email, name and password required')
    setSaving(true)
    try {
      if (editUser) {
        const payload = { full_name: form.full_name, role: form.role, campus: form.campus, phone: form.phone }
        if (form.password) payload.password = form.password
        if (form.role === 'trainer') {
          payload.qualifications_delivering = form.qualifications_delivering
          payload.max_students = form.max_students
        }
        await api.put(`/users/${editUser.id}`, payload)
        toast.success('User updated')
      } else {
        await api.post('/users', form)
        toast.success('User created')
      }
      setShowModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') } finally { setSaving(false) }
  }

  const toggleActive = async (u) => {
    await api.put(`/users/${u.id}`, { is_active: !u.is_active })
    toast.success(u.is_active ? 'User deactivated' : 'User activated')
    load()
  }

  // Admin-only, permanent removal (distinct from Deactivate above, which just
  // disables login and keeps the account + its history). The backend blocks
  // this if the user is still referenced elsewhere (coordinator, trainer on
  // an appointment, communication sender, issue reporter) and returns a
  // clear reason instead - surfaced to the admin via the error toast.
  const removeUser = async (u) => {
    if (!window.confirm(`Permanently delete ${u.full_name}? This cannot be undone.`)) return
    try {
      await api.delete(`/users/${u.id}`)
      toast.success('User permanently deleted')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete user')
    }
  }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="User Management" subtitle={`${users.length} staff accounts`}
        actions={isAdmin && <button onClick={openAdd} className="btn-primary text-sm"><Plus size={15} /> Add User</button>} />

      <div className="card p-0 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50"><tr>
            {['User', 'Role', 'Campus', 'Phone', 'Created', 'Status', 'Actions'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-navy flex items-center justify-center text-white text-xs font-bold">
                      {u.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{u.full_name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><Badge status={u.role} label={u.role==='trainer'?'Trainer/Assessor':u.role.charAt(0).toUpperCase()+u.role.slice(1)} /></td>
                <td className="px-4 py-3 text-sm text-gray-600 capitalize">{u.campus}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{u.phone || '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{u.created_at ? format(new Date(u.created_at), 'd MMM yyyy') : '-'}</td>
                <td className="px-4 py-3"><Badge status={u.is_active ? 'active' : 'withdrawn'} label={u.is_active ? 'Active' : 'Inactive'} /></td>
                <td className="px-4 py-3">
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(u)} className="text-xs text-cyan hover:underline">Edit</button>
                      <button onClick={() => toggleActive(u)} className={`text-xs hover:underline ${u.is_active ? 'text-red-500' : 'text-green-600'}`}>
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      {u.id !== currentUser?.id && (
                        <button onClick={() => removeUser(u)} title="Permanently delete user"
                          className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded hover:bg-red-50">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editUser ? 'Edit User' : 'Add New User'} size="sm">
        <div className="space-y-4">
          <FormRow label="Full Name" required><input className="input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></FormRow>
          <FormRow label="Email" required><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} disabled={!!editUser} /></FormRow>
          <FormRow label={editUser ? 'New Password (leave blank to keep current)' : 'Password'} required={!editUser}>
            <input className="input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editUser ? 'Leave blank to keep current' : 'Minimum 8 characters'} />
          </FormRow>
          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Role">
              <Select value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))}
                options={[{value:'admin',label:'Admin'},{value:'coordinator',label:'Coordinator'},{value:'trainer',label:'Trainer/Assessor'}]} placeholder="" />
            </FormRow>
            <FormRow label="Campus">
              <Select value={form.campus} onChange={v => setForm(f => ({ ...f, campus: v }))}
                options={(editUser ? ['sydney', 'melbourne', 'perth'] : ['sydney', 'melbourne']).map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))} placeholder="" />
            </FormRow>
          </div>
          <FormRow label="Phone"><input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="04xx xxx xxx" /></FormRow>

          {/* Trainer/Assessor-specific fields - shown only when Role is Trainer/Assessor */}
          {form.role === 'trainer' && (
            <div className="border-t border-gray-100 pt-4 mt-1 space-y-4">
              <p className="text-sm font-medium text-gray-700">Trainer/Assessor Details</p>
              <FormRow label="Max Students">
                <input className="input" type="number" min="1" max="100" value={form.max_students}
                  onChange={e => setForm(f => ({ ...f, max_students: +e.target.value }))} />
              </FormRow>
              <FormRow label="Qualifications Delivering">
                <div className="space-y-1.5">
                  {(editUser ? ALL_TRAINER_QUALIFICATIONS : NEW_TRAINER_QUALIFICATIONS).map(q => (
                    <label key={q.value} className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="w-4 h-4 accent-cyan"
                        checked={form.qualifications_delivering.includes(q.value)}
                        onChange={() => toggleQual(q.value)} />
                      {q.label}
                    </label>
                  ))}
                </div>
              </FormRow>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
          {isAdmin && <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editUser ? 'Update User' : 'Create User'}</button>}
        </div>
      </Modal>
    </div>
  )
}
