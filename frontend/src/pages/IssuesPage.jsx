import React, { useEffect, useState, useCallback } from 'react'
import { Plus, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { PageHeader, Spinner, Badge, Modal, FormRow, Select, EmptyState, SearchInput } from '../components/ui/index'
import { format } from 'date-fns'

const ISSUE_TYPES = ['attendance', 'behaviour', 'performance', 'compliance', 'safety', 'communication', 'other']
const PRIORITIES = ['low', 'medium', 'high', 'critical']

export default function IssuesPage() {
  const [issues, setIssues] = useState([])
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('open')
  const [filterPriority, setFilterPriority] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showResolveModal, setShowResolveModal] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [resolution, setResolution] = useState('')
  const [form, setForm] = useState({ student_id: '', issue_type: 'other', title: '', description: '', priority: 'medium' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (filterStatus) p.append('status', filterStatus)
    if (filterPriority) p.append('priority', filterPriority)
    Promise.all([api.get(`/issues?${p}`), api.get('/students')]).then(([i, s]) => {
      setIssues(i.data); setStudents(s.data)
    }).finally(() => setLoading(false))
  }, [filterStatus, filterPriority])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!form.student_id || !form.title) return toast.error('Student and title required')
    setSaving(true)
    try {
      await api.post('/issues', form)
      toast.success('Issue raised'); setShowModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') } finally { setSaving(false) }
  }

  const resolve = async () => {
    await api.put(`/issues/${selectedIssue.id}`, { status: 'resolved', resolution })
    toast.success('Issue resolved'); setShowResolveModal(false); load()
  }

  const updateStatus = async (id, status) => {
    await api.put(`/issues/${id}`, { status })
    toast.success(`Issue ${status}`); load()
  }

  const filtered = issues.filter(i => {
    if (!search) return true
    return i.title.toLowerCase().includes(search.toLowerCase()) ||
      i.student_name?.toLowerCase().includes(search.toLowerCase())
  })

  const priorityBorder = { critical: 'border-l-red-600', high: 'border-l-orange-400', medium: 'border-l-yellow-400', low: 'border-l-green-400' }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="Issues" subtitle={`${issues.length} issue${issues.length !== 1 ? 's' : ''}`}
        actions={<button onClick={() => setShowModal(true)} className="btn-primary text-sm"><Plus size={15} /> Raise Issue</button>} />

      <div className="flex flex-wrap gap-3 mb-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Search issues..." />
        <Select value={filterStatus} onChange={setFilterStatus} placeholder="All Statuses"
          options={['open', 'in_progress', 'resolved', 'closed'].map(s => ({ value: s, label: s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }))} />
        <Select value={filterPriority} onChange={setFilterPriority} placeholder="All Priorities"
          options={PRIORITIES.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No issues found" message="No issues match your current filters."
          action={<button onClick={() => setShowModal(true)} className="btn-primary mx-auto"><Plus size={15} /> Raise Issue</button>} />
      ) : (
        <div className="space-y-3">
          {filtered.map(issue => (
            <div key={issue.id} className={`card border-l-4 ${priorityBorder[issue.priority] || 'border-l-gray-300'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{issue.title}</h3>
                    <Badge status={issue.priority} />
                    <Badge status={issue.status} />
                  </div>
                  <p className="text-sm text-gray-500">
                    Student: <strong>{issue.student_name}</strong> · {issue.issue_type.replace(/_/g, ' ')}
                    · Reported by {issue.reporter_name} · {issue.created_at ? format(new Date(issue.created_at), 'd MMM yyyy') : ''}
                  </p>
                  {issue.description && <p className="text-sm text-gray-600 mt-2">{issue.description}</p>}
                  {issue.resolution && (
                    <div className="mt-2 p-3 bg-green-50 rounded-lg">
                      <p className="text-xs font-medium text-green-800">Resolution:</p>
                      <p className="text-sm text-green-700">{issue.resolution}</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  {issue.status === 'open' && (
                    <button onClick={() => updateStatus(issue.id, 'in_progress')} className="btn-secondary text-xs py-1 px-2">In Progress</button>
                  )}
                  {['open', 'in_progress'].includes(issue.status) && (
                    <button onClick={() => { setSelectedIssue(issue); setResolution(''); setShowResolveModal(true) }}
                      className="btn-primary text-xs py-1 px-2">Resolve</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Raise New Issue" size="md">
        <div className="space-y-4">
          <FormRow label="Student" required>
            <Select value={form.student_id} onChange={v => setForm(f => ({ ...f, student_id: v }))}
              options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))} placeholder="Select student..." />
          </FormRow>
          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Issue Type">
              <Select value={form.issue_type} onChange={v => setForm(f => ({ ...f, issue_type: v }))}
                options={ISSUE_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} placeholder="" />
            </FormRow>
            <FormRow label="Priority">
              <Select value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))}
                options={PRIORITIES.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))} placeholder="" />
            </FormRow>
          </div>
          <FormRow label="Title" required><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Brief issue summary..." /></FormRow>
          <FormRow label="Description"><textarea className="input h-28 resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Detailed description of the issue..." /></FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Raising...' : 'Raise Issue'}</button>
        </div>
      </Modal>

      <Modal open={showResolveModal} onClose={() => setShowResolveModal(false)} title="Resolve Issue" size="sm">
        <p className="text-sm text-gray-600 mb-4">Add a resolution note for: <strong>{selectedIssue?.title}</strong></p>
        <textarea className="input h-28 resize-none w-full" value={resolution} onChange={e => setResolution(e.target.value)} placeholder="Describe how the issue was resolved..." />
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={() => setShowResolveModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={resolve} className="btn-primary">Mark Resolved</button>
        </div>
      </Modal>
    </div>
  )
}
