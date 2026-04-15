import React, { useEffect, useState } from 'react'
import { Plus, UserCheck, UserX } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { PageHeader, Spinner, Badge, Modal, FormRow, Select } from '../components/ui/index'
import { format } from 'date-fns'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'coordinator', campus: 'sydney', phone: '' })

  const load = () => api.get('/users').then(r => setUsers(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const openAdd = () => { setEditUser(null); setForm({ email: '', full_name: '', password: '', role: 'coordinator', campus: 'sydney', phone: '' }); setShowModal(true) }
  const openEdit = u => { setEditUser(u); setForm({ email: u.email, full_name: u.full_name, password: '', role: u.role, campus: u.campus, phone: u.phone || '' }); setShowModal(true) }

  const save = async () => {
    if (!editUser && (!form.email || !form.full_name || !form.password)) return toast.error('Email, name and password required')
    setSaving(true)
    try {
      if (editUser) {
        const payload = { full_name: form.full_name, role: form.role, campus: form.campus, phone: form.phone }
        if (form.password) payload.password = form.password
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

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="User Management" subtitle={`${users.length} staff accounts`}
        actions={<button onClick={openAdd} className="btn-primary text-sm"><Plus size={15} /> Add User</button>} />

      <div className="card p-0 overflow-hidden">
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
                <td className="px-4 py-3 text-sm text-gray-500">{u.phone || '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{u.created_at ? format(new Date(u.created_at), 'd MMM yyyy') : '—'}</td>
                <td className="px-4 py-3"><Badge status={u.is_active ? 'active' : 'withdrawn'} label={u.is_active ? 'Active' : 'Inactive'} /></td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(u)} className="text-xs text-cyan hover:underline">Edit</button>
                    <button onClick={() => toggleActive(u)} className={`text-xs hover:underline ${u.is_active ? 'text-red-500' : 'text-green-600'}`}>
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
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
                options={['sydney', 'melbourne', 'perth'].map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))} placeholder="" />
            </FormRow>
          </div>
          <FormRow label="Phone"><input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="04xx xxx xxx" /></FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editUser ? 'Update User' : 'Create User'}</button>
        </div>
      </Modal>
    </div>
  )
}
