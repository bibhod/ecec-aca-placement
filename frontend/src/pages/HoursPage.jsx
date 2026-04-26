/**
 * HoursPage — Issue 3:
 * Allow multiple log hour entries with separate dates in a single session.
 */
import React, { useEffect, useState } from 'react'
import api from '../utils/api'
import toast from 'react-hot-toast'
import { CheckCircle, XCircle, Clock, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { PageHeader, Spinner, ProgressBar, Badge, Modal, FormRow, Select } from '../components/ui/index'
import { format } from 'date-fns'

const emptyEntry = { log_date: '', hours: '', activity_description: '' }

export function HoursPage() {
  const [summary, setSummary] = useState([])
  const [logs, setLogs] = useState([])
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState('')
  const [entries, setEntries] = useState([{ ...emptyEntry }])
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('summary')

  const load = () => {
    Promise.all([
      api.get('/hours/summary'),
      api.get('/hours'),
      api.get('/students?status=current'),
    ]).then(([s, l, st]) => { setSummary(s.data); setLogs(l.data); setStudents(st.data) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const approve = async id => { await api.put(`/hours/${id}/approve`); toast.success('Approved'); load() }
  const reject = async id => { await api.put(`/hours/${id}/reject`); toast.success('Rejected'); load() }

  const addRow = () => setEntries(e => [...e, { ...emptyEntry }])
  const removeRow = idx => setEntries(e => e.filter((_, i) => i !== idx))
  const updateRow = (idx, field, value) => setEntries(e =>
    e.map((row, i) => i === idx ? { ...row, [field]: value } : row)
  )

  const save = async () => {
    if (!selectedStudent) return toast.error('Please select a student')
    const valid = entries.filter(e => e.log_date && e.hours && +e.hours > 0)
    if (valid.length === 0) return toast.error('At least one entry with date and hours is required')
    setSaving(true)
    try {
      const r = await api.post('/hours/bulk', {
        student_id: selectedStudent,
        entries: valid.map(e => ({ log_date: e.log_date, hours: +e.hours, activity_description: e.activity_description }))
      })
      const allWarnings = (r.data.results || []).flatMap(res => res.warnings || [])
      if (allWarnings.length > 0) {
        allWarnings.forEach(w => toast(w, { icon: '⚠️', duration: 5000 }))
      }
      toast.success(`${valid.length} entry/entries logged`)
      setShowModal(false)
      setEntries([{ ...emptyEntry }])
      setSelectedStudent('')
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
    finally { setSaving(false) }
  }

  const pending = logs.filter(l => !l.approved)
  const flagged = logs.filter(l => l.flagged_unrealistic || l.flagged_duplicate)

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Hours Tracking" subtitle={`${logs.length} total log entries`}
        actions={<button onClick={() => setShowModal(true)} className="btn-primary text-sm"><Plus size={15} /> Log Hours</button>} />

      {pending.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex items-center gap-3">
          <Clock size={18} className="text-yellow-600 flex-shrink-0" />
          <p className="text-sm text-yellow-800 font-medium">{pending.length} hour log{pending.length !== 1 ? 's' : ''} pending approval</p>
        </div>
      )}
      {flagged.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertTriangle size={18} className="text-orange-600 flex-shrink-0" />
          <p className="text-sm text-orange-800 font-medium">{flagged.length} entry/entries flagged for review (unrealistic or duplicate)</p>
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {['summary', 'all logs', 'pending', 'flagged'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-white text-navy shadow-sm' : 'text-gray-500'}`}>{t}</button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="card p-0 overflow-hidden overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50"><tr>
              {['Student', 'Qualification', 'Campus', 'Progress', 'Completed', 'Pending Approval', '%'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {summary.map(s => (
                <tr key={s.student_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><p className="text-sm font-medium text-gray-900">{s.student_name}</p><p className="text-xs text-gray-400">{s.student_ref}</p></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.qualification}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 capitalize">{s.campus}</td>
                  <td className="px-4 py-3 w-40"><ProgressBar value={s.completed_hours} max={s.required_hours} showPct={false} /></td>
                  <td className="px-4 py-3 text-sm font-medium">{s.completed_hours}h</td>
                  <td className="px-4 py-3 text-sm text-yellow-600">{s.pending_hours > 0 ? `${s.pending_hours}h` : '—'}</td>
                  <td className="px-4 py-3 text-sm font-bold text-navy">{s.percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(tab === 'all logs' || tab === 'pending' || tab === 'flagged') && (
        <div className="card p-0 overflow-hidden overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50"><tr>
              {['Date', 'Student', 'Hours', 'Activity', 'Flags', 'Status', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {(tab === 'pending' ? pending : tab === 'flagged' ? flagged : logs).map(l => (
                <tr key={l.id} className={`hover:bg-gray-50 ${(l.flagged_unrealistic || l.flagged_duplicate) ? 'bg-orange-50/20' : ''}`}>
                  <td className="px-4 py-3 text-sm">{format(new Date(l.log_date), 'd MMM yyyy')}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{students.find(s => s.id === l.student_id)?.full_name || '—'}</td>
                  <td className="px-4 py-3 text-sm font-medium">{l.hours}h</td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{l.activity_description || '—'}</td>
                  <td className="px-4 py-3">
                    {l.flagged_unrealistic && <span className="text-xs text-orange-600 bg-orange-50 px-1 py-0.5 rounded mr-1">⚠ Unrealistic</span>}
                    {l.flagged_duplicate && <span className="text-xs text-red-600 bg-red-50 px-1 py-0.5 rounded">⚠ Duplicate</span>}
                  </td>
                  <td className="px-4 py-3"><Badge status={l.approved ? 'approved' : 'pending'} /></td>
                  <td className="px-4 py-3">
                    {!l.approved && (
                      <div className="flex gap-2">
                        <button onClick={() => approve(l.id)} className="text-xs text-green-600 hover:underline flex items-center gap-1"><CheckCircle size={12} /> Approve</button>
                        <button onClick={() => reject(l.id)} className="text-xs text-red-500 hover:underline flex items-center gap-1"><XCircle size={12} /> Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Issue 3 — multi-row log hours modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setEntries([{ ...emptyEntry }]); setSelectedStudent('') }} title="Log Placement Hours" size="lg">
        <div className="mb-4">
          <FormRow label="Student" required>
            <Select value={selectedStudent} onChange={setSelectedStudent}
              options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))} placeholder="Select student..." />
          </FormRow>
        </div>
        <p className="text-xs text-gray-500 mb-3">Add one or more entries. Click "+ Add Row" to log hours for multiple dates at once.</p>
        <div className="space-y-3">
          {entries.map((entry, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-start bg-gray-50 p-3 rounded-xl">
              <div className="col-span-4">
                <label className="text-xs text-gray-500 mb-1 block">Date *</label>
                <input className="input text-sm" type="date" value={entry.log_date}
                  onChange={e => updateRow(idx, 'log_date', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">Hours *</label>
                <input className="input text-sm" type="number" step="0.5" min="0.5" max="24" value={entry.hours}
                  onChange={e => updateRow(idx, 'hours', e.target.value)} placeholder="8" />
              </div>
              <div className="col-span-5">
                <label className="text-xs text-gray-500 mb-1 block">Activity</label>
                <input className="input text-sm" value={entry.activity_description}
                  onChange={e => updateRow(idx, 'activity_description', e.target.value)}
                  placeholder="Describe activities..." />
              </div>
              <div className="col-span-1 flex items-end pb-0.5">
                {entries.length > 1 && (
                  <button onClick={() => removeRow(idx)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <button onClick={addRow} className="btn-secondary text-sm mt-3"><Plus size={14} /> Add Row</button>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => { setShowModal(false); setEntries([{ ...emptyEntry }]); setSelectedStudent('') }} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Log Hours'}</button>
        </div>
      </Modal>
    </div>
  )
}

export default HoursPage
