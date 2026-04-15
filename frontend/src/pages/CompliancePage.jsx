/**
 * CompliancePage — fixes Issues 8 and 12:
 *   Issue 8:  File upload input in the Add Document modal
 *   Issue 12: "All Types" filter shows only the five required document types
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Plus, Upload, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { PageHeader, Spinner, Badge, Modal, FormRow, Select, SearchInput, EmptyState } from '../components/ui/index'
import { format } from 'date-fns'

// Issue 12 — exactly five required compliance document types
const DOC_TYPES = [
  { value: 'working_with_children_check',   label: 'Working with Children Check' },
  { value: 'national_police_check',          label: 'National Police Check' },
  { value: 'first_aid_certificate',          label: 'Valid First Aid Certificate (including CPR)' },
  { value: 'work_placement_agreement',       label: 'Work Placement Agreement' },
  { value: 'memorandum_of_understanding',    label: 'Memorandum of Understanding (MOU)' },
]

export default function CompliancePage() {
  const [docs, setDocs] = useState([])
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    student_id: '', document_type: 'working_with_children_check',
    document_number: '', issue_date: '', expiry_date: '', notes: ''
  })
  const [uploadFile, setUploadFile] = useState(null)  // Issue 8
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    Promise.all([api.get('/compliance'), api.get('/students')]).then(([d, s]) => {
      setDocs(d.data); setStudents(s.data)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = docs.filter(d => {
    const student = students.find(s => s.id === d.student_id)
    const name = student?.full_name?.toLowerCase() || ''
    if (search && !name.includes(search.toLowerCase()) && !d.document_number?.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus && d.status !== filterStatus) return false
    if (filterType && d.document_type !== filterType) return false
    return true
  })

  const verify = async id => {
    await api.put(`/compliance/${id}/verify`)
    toast.success('Document verified'); load()
  }

  const save = async () => {
    if (!form.student_id || !form.document_type) return toast.error('Student and type required')
    setSaving(true)
    try {
      if (uploadFile) {
        // Issue 8 — multipart form with file attachment
        const fd = new FormData()
        Object.entries({ ...form }).forEach(([k, v]) => fd.append(k, v))
        fd.append('file', uploadFile)
        await api.post('/compliance/upload-with-doc', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      } else {
        await api.post('/compliance', form)
      }
      toast.success('Document added')
      setShowModal(false)
      setUploadFile(null)
      setForm({ student_id: '', document_type: 'working_with_children_check', document_number: '', issue_date: '', expiry_date: '', notes: '' })
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
    finally { setSaving(false) }
  }

  const exportStudents = () => { window.location.href = '/api/reports/export/students' }
  const exportHours = () => { window.location.href = '/api/reports/export/hours' }

  const summary = {
    total: docs.length,
    valid: docs.filter(d => d.status === 'valid').length,
    expiring: docs.filter(d => d.status === 'expiring_soon').length,
    expired: docs.filter(d => d.status === 'expired').length,
    pending: docs.filter(d => d.status === 'pending').length,
  }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Compliance" subtitle="Manage student compliance documents"
        actions={<button onClick={() => setShowModal(true)} className="btn-primary text-sm"><Plus size={15} /> Add Document</button>} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Valid', count: summary.valid, icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50', filter: 'valid' },
          { label: 'Expiring Soon', count: summary.expiring, icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-50', filter: 'expiring_soon' },
          { label: 'Expired', count: summary.expired, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', filter: 'expired' },
          { label: 'Pending Verification', count: summary.pending, icon: AlertTriangle, color: 'text-blue-500', bg: 'bg-blue-50', filter: 'pending' },
        ].map(c => (
          <div key={c.label} className="card flex items-center gap-3 cursor-pointer hover:shadow-md transition-all"
            onClick={() => setFilterStatus(f => f === c.filter ? '' : c.filter)}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.bg} flex-shrink-0`}>
              <c.icon size={20} className={c.color} />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{c.count}</p>
              <p className="text-xs text-gray-500">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Search student or document #..." />
        <Select value={filterStatus} onChange={setFilterStatus} placeholder="All Statuses"
          options={['valid', 'expiring_soon', 'expired', 'pending'].map(s => ({ value: s, label: s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }))} />
        {/* Issue 12 — only five types in dropdown */}
        <Select value={filterType} onChange={setFilterType} placeholder="All Types" options={DOC_TYPES} />
        {(filterStatus || filterType || search) && (
          <button onClick={() => { setFilterStatus(''); setFilterType(''); setSearch('') }} className="text-sm text-gray-500 hover:text-navy underline">Clear filters</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={CheckCircle} title="No documents found" message="Try adjusting your filters or add a new document." />
      ) : (
        <div className="card p-0 overflow-hidden overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Student', 'Document Type', 'Doc Number', 'Issue Date', 'Expiry Date', 'Status', 'File', 'Verified By', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(d => {
                const student = students.find(s => s.id === d.student_id)
                const docLabel = DOC_TYPES.find(t => t.value === d.document_type)?.label || d.document_type
                return (
                  <tr key={d.id} className={`hover:bg-gray-50 ${d.status === 'expired' ? 'bg-red-50/30' : d.status === 'expiring_soon' ? 'bg-yellow-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{student?.full_name || '—'}</p>
                      <p className="text-xs text-gray-400">{student?.student_id}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{docLabel}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{d.document_number || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{d.issue_date ? format(new Date(d.issue_date), 'd MMM yyyy') : '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {d.expiry_date ? (
                        <span className={d.status === 'expired' ? 'text-red-600 font-medium' : d.status === 'expiring_soon' ? 'text-yellow-600 font-medium' : 'text-gray-500'}>
                          {format(new Date(d.expiry_date), 'd MMM yyyy')}
                          {d.days_until_expiry != null && d.days_until_expiry <= 30 && ` (${d.days_until_expiry}d)`}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3"><Badge status={d.status} /></td>
                    <td className="px-4 py-3">
                      {d.file_url ? <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs text-cyan hover:underline">View</a> : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{d.verified_by || '—'}</td>
                    <td className="px-4 py-3">
                      {!d.verified && (
                        <button onClick={() => verify(d.id)} className="text-xs text-cyan hover:underline flex items-center gap-1">
                          <CheckCircle size={12} /> Verify
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Document Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setUploadFile(null) }} title="Add Compliance Document" size="md">
        <div className="space-y-4">
          <FormRow label="Student" required>
            <Select value={form.student_id} onChange={v => setForm(f => ({ ...f, student_id: v }))}
              options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))} placeholder="Select student..." />
          </FormRow>
          {/* Issue 12 — only five types */}
          <FormRow label="Document Type" required>
            <Select value={form.document_type} onChange={v => setForm(f => ({ ...f, document_type: v }))} options={DOC_TYPES} placeholder="" />
          </FormRow>
          <FormRow label="Document Number">
            <input className="input" value={form.document_number} onChange={e => setForm(f => ({ ...f, document_number: e.target.value }))} placeholder="e.g. WWC-NSW-123456" />
          </FormRow>
          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Issue Date"><input className="input" type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} /></FormRow>
            <FormRow label="Expiry Date"><input className="input" type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} /></FormRow>
          </div>
          {/* Issue 8 — file upload input */}
          <FormRow label="Upload Document">
            <label className="flex items-center gap-2 cursor-pointer">
              <div className="flex-1">
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={e => setUploadFile(e.target.files[0])}
                  className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-sm file:bg-gray-50 file:cursor-pointer hover:file:bg-gray-100" />
              </div>
              <Upload size={16} className="text-gray-400 flex-shrink-0" />
            </label>
            {uploadFile && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><CheckCircle size={12} /> {uploadFile.name}</p>}
          </FormRow>
          <FormRow label="Notes"><textarea className="input h-20 resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => { setShowModal(false); setUploadFile(null) }} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Adding...' : 'Add Document'}</button>
        </div>
      </Modal>
    </div>
  )
}
