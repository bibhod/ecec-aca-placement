/**
 * CompliancePage
 *  - Documents tab
 *  - Compliance Report tab
 *  - Email Log tab (view sent compliance reminder emails)
 *  - Send Reminders: preview first, then confirm-send
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Plus, Upload, CheckCircle, AlertTriangle, XCircle, Mail, FileText, Clock, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { PageHeader, Spinner, Badge, Modal, FormRow, Select, SearchInput, EmptyState } from '../components/ui/index'
import { format } from 'date-fns'

const DOC_TYPES = [
  { value: 'working_with_children_check', label: 'Working with Children Check', abbr: 'WWCC' },
  { value: 'first_aid_certificate',        label: 'First Aid Certificate (incl. CPR)', abbr: 'First Aid' },
  { value: 'work_placement_agreement',     label: 'Work Placement Agreement', abbr: 'WPA' },
  { value: 'memorandum_of_understanding',  label: 'Memorandum of Understanding', abbr: 'MOU' },
]

export default function CompliancePage() {
  const [activeTab, setActiveTab] = useState('documents')
  const [docs, setDocs] = useState([])
  const [students, setStudents] = useState([])
  const [report, setReport] = useState([])
  const [emailLog, setEmailLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [reportLoading, setReportLoading] = useState(false)
  const [emailLogLoading, setEmailLogLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const [reportSearch, setReportSearch] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    student_id: '', document_type: 'working_with_children_check',
    document_number: '', issue_date: '', expiry_date: '', notes: ''
  })
  const [uploadFile, setUploadFile] = useState(null)
  const [saving, setSaving] = useState(false)

  // ── Reminder preview / send state ────────────────────────────────────────
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState(null)      // preview modal open
  const [sendingReminders, setSendingReminders] = useState(false)
  const [reminderResults, setReminderResults] = useState(null) // results modal open
  const [expandedPreview, setExpandedPreview] = useState(null) // student_id whose email is expanded

  // ── Data loaders ─────────────────────────────────────────────────────────
  const load = useCallback(() => {
    Promise.all([api.get('/compliance'), api.get('/students')]).then(([d, s]) => {
      setDocs(d.data); setStudents(s.data)
    }).finally(() => setLoading(false))
  }, [])

  const loadReport = useCallback(() => {
    setReportLoading(true)
    api.get('/compliance/report').then(r => setReport(r.data)).finally(() => setReportLoading(false))
  }, [])

  const loadEmailLog = useCallback(() => {
    setEmailLogLoading(true)
    api.get('/communications').then(r => {
      // Show all compliance-related emails: bulk reminders + individual sends
      const filtered = r.data.filter(c =>
        c.template_used === 'compliance_reminder_bulk' ||
        c.subject?.toLowerCase().includes('compliance') ||
        c.subject?.toLowerCase().includes('outstanding')
      )
      setEmailLog(filtered)
    }).finally(() => setEmailLogLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (activeTab === 'report') loadReport() }, [activeTab, loadReport])
  useEffect(() => { if (activeTab === 'email_log') loadEmailLog() }, [activeTab, loadEmailLog])

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = docs.filter(d => {
    const student = students.find(s => s.id === d.student_id)
    const name = student?.full_name?.toLowerCase() || ''
    if (search && !name.includes(search.toLowerCase()) && !d.document_number?.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus && d.status !== filterStatus) return false
    if (filterType && d.document_type !== filterType) return false
    return true
  })

  const filteredReport = report.filter(r => {
    if (missingOnly && r.fully_compliant) return false
    if (reportSearch && !r.student_name.toLowerCase().includes(reportSearch.toLowerCase())) return false
    return true
  })

  // ── Actions ───────────────────────────────────────────────────────────────
  const verify = async id => {
    await api.put(`/compliance/${id}/verify`)
    toast.success('Document verified'); load()
  }

  const save = async () => {
    if (!form.student_id || !form.document_type) return toast.error('Student and type required')
    setSaving(true)
    try {
      if (uploadFile) {
        const fd = new FormData()
        Object.entries({ ...form }).forEach(([k, v]) => fd.append(k, v))
        fd.append('file', uploadFile)
        await api.post('/compliance/upload-with-doc', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      } else {
        await api.post('/compliance', form)
      }
      toast.success('Document added')
      setShowModal(false); setUploadFile(null)
      setForm({ student_id: '', document_type: 'working_with_children_check', document_number: '', issue_date: '', expiry_date: '', notes: '' })
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
    finally { setSaving(false) }
  }

  /** Step 1: fetch preview (no emails sent) */
  const openReminderPreview = async () => {
    setPreviewLoading(true)
    try {
      const res = await api.get('/compliance/reminder-preview')
      if (res.data.recipient_count === 0) {
        toast.success('All active students are fully compliant — no reminders needed!')
      } else {
        setPreviewData(res.data)
      }
    } catch { toast.error('Failed to load preview') }
    finally { setPreviewLoading(false) }
  }

  /** Step 2: confirmed — actually send */
  const sendReminders = async () => {
    setSendingReminders(true)
    try {
      const res = await api.post('/compliance/send-reminders')
      setPreviewData(null)
      setReminderResults(res.data)
      // Refresh email log if that tab is active later
      if (activeTab === 'email_log') loadEmailLog()
    } catch { toast.error('Failed to send reminders') }
    finally { setSendingReminders(false) }
  }

  // ── Summary cards ─────────────────────────────────────────────────────────
  const summary = {
    valid: docs.filter(d => d.status === 'valid').length,
    expiring: docs.filter(d => d.status === 'expiring_soon').length,
    expired: docs.filter(d => d.status === 'expired').length,
    pending: docs.filter(d => d.status === 'pending').length,
  }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Compliance" subtitle="Manage student compliance documents"
        actions={
          <div className="flex gap-2">
            <button onClick={openReminderPreview} disabled={previewLoading}
              className="btn-secondary text-sm flex items-center gap-1">
              <Mail size={15} /> {previewLoading ? 'Loading...' : 'Send Reminders'}
            </button>
            <button onClick={() => setShowModal(true)} className="btn-primary text-sm flex items-center gap-1">
              <Plus size={15} /> Add Document
            </button>
          </div>
        } />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Valid', count: summary.valid, icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50', filter: 'valid' },
          { label: 'Expiring Soon', count: summary.expiring, icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-50', filter: 'expiring_soon' },
          { label: 'Expired', count: summary.expired, icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', filter: 'expired' },
          { label: 'Pending Verification', count: summary.pending, icon: AlertTriangle, color: 'text-blue-500', bg: 'bg-blue-50', filter: 'pending' },
        ].map(c => (
          <div key={c.label} className="card flex items-center gap-3 cursor-pointer hover:shadow-md transition-all"
            onClick={() => { setFilterStatus(f => f === c.filter ? '' : c.filter); setActiveTab('documents') }}>
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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {[
          { key: 'documents', label: 'Documents', icon: FileText },
          { key: 'report', label: 'Compliance Report', icon: CheckCircle },
          { key: 'email_log', label: 'Email Log', icon: Mail },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.key ? 'border-navy text-navy' : 'border-transparent text-gray-500 hover:text-navy'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── Documents Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <>
          <div className="flex flex-wrap gap-3 mb-6">
            <SearchInput value={search} onChange={setSearch} placeholder="Search student or document #..." />
            <Select value={filterStatus} onChange={setFilterStatus} placeholder="All Statuses"
              options={['valid', 'expiring_soon', 'expired', 'pending'].map(s => ({ value: s, label: s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }))} />
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
                    const docLabel = DOC_TYPES.find(t => t.value === d.document_type)?.label || d.document_type.replace(/_/g, ' ')
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
                        <td className="px-4 py-3">{d.file_url ? <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs text-cyan hover:underline">View</a> : '—'}</td>
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
        </>
      )}

      {/* ── Compliance Report Tab ──────────────────────────────────────────── */}
      {activeTab === 'report' && (
        <>
          <div className="flex flex-wrap gap-3 mb-4 items-center">
            <SearchInput value={reportSearch} onChange={setReportSearch} placeholder="Search student..." />
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)} className="rounded" />
              Show incomplete only
            </label>
            <button onClick={openReminderPreview} disabled={previewLoading} className="btn-secondary text-sm flex items-center gap-1 ml-auto">
              <Mail size={15} /> {previewLoading ? 'Loading...' : 'Send Reminders to Incomplete Students'}
            </button>
          </div>

          {reportLoading ? <Spinner size="lg" /> : (
            <>
              <p className="text-xs text-gray-400 mb-3">
                Showing {filteredReport.length} student{filteredReport.length !== 1 ? 's' : ''} ·{' '}
                <span className="text-green-600 font-medium">{filteredReport.filter(r => r.fully_compliant).length} fully compliant</span> ·{' '}
                <span className="text-red-500 font-medium">{filteredReport.filter(r => !r.fully_compliant).length} incomplete</span>
              </p>
              <div className="card p-0 overflow-hidden overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap">Student</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap">Campus</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap">Qualification</th>
                      <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap">Progress</th>
                      {DOC_TYPES.map(t => (
                        <th key={t.value} className="px-3 py-3 text-center font-medium text-gray-500 whitespace-nowrap" title={t.label}>{t.abbr}</th>
                      ))}
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredReport.map(r => {
                      const ABBR_MAP = { 'Working with Children Check': 'WWCC', 'Valid First Aid Certificate (including CPR)': 'First Aid', 'First Aid Certificate (incl. CPR)': 'First Aid', 'Work Placement Agreement': 'WPA', 'Memorandum of Understanding (MOU)': 'MOU', 'Memorandum of Understanding': 'MOU' }
                      const outstandingAbbr = r.outstanding.map(o => ABBR_MAP[o] || o)
                      return (
                        <tr key={r.student_id} className={r.fully_compliant ? 'bg-green-50/30' : 'hover:bg-red-50/20'}>
                          <td className="px-4 py-3"><p className="font-medium text-gray-900">{r.student_name}</p><p className="text-gray-400">{r.student_ref}</p></td>
                          <td className="px-3 py-3 text-gray-600 capitalize">{r.campus || '—'}</td>
                          <td className="px-3 py-3 text-gray-500">{r.qualification || '—'}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-12 bg-gray-200 rounded-full h-1.5 flex-shrink-0">
                                <div className={`h-1.5 rounded-full ${r.fully_compliant ? 'bg-green-500' : r.submitted_count >= 2 ? 'bg-yellow-400' : 'bg-red-400'}`}
                                  style={{ width: `${(r.submitted_count / r.required_count) * 100}%` }} />
                              </div>
                              <span className={`font-bold whitespace-nowrap ${r.fully_compliant ? 'text-green-600' : 'text-orange-500'}`}>{r.submitted_count}/{r.required_count}</span>
                            </div>
                          </td>
                          {DOC_TYPES.map(t => {
                            const docInfo = r.documents?.[t.value]
                            const statusColor = docInfo?.status === 'expired' ? 'text-red-400' : docInfo?.status === 'expiring_soon' ? 'text-yellow-500' : 'text-green-500'
                            return (
                              <td key={t.value} className="px-3 py-3 text-center">
                                {docInfo?.submitted
                                  ? <CheckCircle size={15} className={`${statusColor} mx-auto`} title={`${t.abbr}: ${docInfo.status}`} />
                                  : <XCircle size={15} className="text-red-300 mx-auto" title={`${t.abbr}: not submitted`} />}
                              </td>
                            )
                          })}
                          <td className="px-4 py-3">
                            {outstandingAbbr.length === 0
                              ? <span className="text-green-600 font-medium">✓ Complete</span>
                              : <span className="text-red-500 font-medium">{outstandingAbbr.join(', ')}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filteredReport.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No students found</p>}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Email Log Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'email_log' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">All compliance-related emails sent via this system</p>
            <button onClick={loadEmailLog} className="btn-secondary text-sm">Refresh</button>
          </div>
          {emailLogLoading ? <Spinner size="lg" /> : emailLog.length === 0 ? (
            <EmptyState icon={Mail} title="No emails sent yet"
              message="Click 'Send Reminders' to send compliance reminder emails. They will appear here." />
          ) : (
            <div className="space-y-3">
              {emailLog.map(c => (
                <div key={c.id} className={`card border ${c.sent_successfully ? 'border-gray-100' : 'border-red-200 bg-red-50/20'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {c.sent_successfully
                          ? <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                          : <XCircle size={14} className="text-red-400 flex-shrink-0" />}
                        <p className="text-sm font-semibold text-gray-900 truncate">{c.subject || '(No subject)'}</p>
                      </div>
                      <p className="text-xs text-gray-500 mb-1">
                        To: <span className="font-medium text-gray-700">{c.recipient_name}</span>
                        {c.recipient_email && <span className="text-gray-400"> &lt;{c.recipient_email}&gt;</span>}
                      </p>
                      {c.body && (
                        <details className="mt-2">
                          <summary className="text-xs text-cyan cursor-pointer hover:underline flex items-center gap-1">
                            <Eye size={11} /> View email content
                          </summary>
                          <pre className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-sans border border-gray-100 max-h-48 overflow-y-auto">{c.body}</pre>
                        </details>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-400 flex items-center gap-1 justify-end">
                        <Clock size={11} />
                        {c.sent_at ? format(new Date(c.sent_at), 'd MMM yyyy, h:mm a') : '—'}
                      </p>
                      <span className={`mt-1 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${c.sent_successfully ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {c.sent_successfully ? 'Sent' : 'Failed'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ════════════ MODALS ════════════ */}

      {/* Preview Modal — shown BEFORE sending */}
      <Modal open={!!previewData} onClose={() => setPreviewData(null)} title="Preview: Compliance Reminder Email" size="lg">
        {previewData && (
          <div className="space-y-5">

            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">{previewData.recipient_count}</p>
                <p className="text-xs text-blue-600 font-medium">Will receive email</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-600">{previewData.compliant_count}</p>
                <p className="text-xs text-green-600 font-medium">Already compliant (skipped)</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-500">{previewData.no_email_count}</p>
                <p className="text-xs text-gray-500 font-medium">No email on file (skipped)</p>
              </div>
            </div>

            {/* Email subject */}
            <div className="bg-gray-50 rounded-lg px-4 py-3 flex items-center gap-2">
              <Mail size={14} className="text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Subject</p>
                <p className="text-sm font-semibold text-gray-800">{previewData.subject}</p>
              </div>
            </div>

            {/* Recipients list */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">
                Recipients ({previewData.recipient_count} students):
              </p>
              <div className="border border-gray-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-gray-50">
                {previewData.recipients.map((r, i) => (
                  <div key={r.student_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{r.student_name}</p>
                        <p className="text-xs text-gray-400">{r.email} · {r.campus || '—'}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {r.outstanding.map(o => (
                            <span key={o} className="text-xs bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-full font-medium">{o}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-xs text-orange-500 font-semibold">{r.submitted_count}/4 submitted</span>
                        <button
                          onClick={() => setExpandedPreview(expandedPreview === r.student_id ? null : r.student_id)}
                          className="block text-xs text-cyan hover:underline mt-1 ml-auto flex items-center gap-1">
                          <Eye size={11} /> {expandedPreview === r.student_id ? 'Hide' : 'Preview email'}
                        </button>
                      </div>
                    </div>
                    {expandedPreview === r.student_id && (
                      <pre className="mt-3 text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-sans border border-gray-100">{r.email_preview}</pre>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-gray-400 bg-amber-50 border border-amber-100 rounded-lg p-3">
              ⚠️ Emails will be sent immediately when you click the button below. All emails will be recorded in the <strong>Email Log</strong> tab for compliance purposes.
            </p>

            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
              <button onClick={() => { setPreviewData(null); setExpandedPreview(null) }} className="btn-secondary">
                Cancel
              </button>
              <button onClick={sendReminders} disabled={sendingReminders} className="btn-primary flex items-center gap-2">
                <Mail size={15} />
                {sendingReminders ? 'Sending…' : `Send to ${previewData.recipient_count} Students`}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Results Modal — shown AFTER sending */}
      <Modal open={!!reminderResults} onClose={() => { setReminderResults(null); if (activeTab !== 'email_log') setActiveTab('email_log') }} title="Reminder Emails Sent" size="lg">
        {reminderResults && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1 bg-green-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{reminderResults.sent?.length || 0}</p>
                <p className="text-sm text-green-700">Emails Sent</p>
              </div>
              <div className="flex-1 bg-gray-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-gray-500">{reminderResults.skipped?.length || 0}</p>
                <p className="text-sm text-gray-500">Skipped</p>
              </div>
            </div>

            {reminderResults.sent?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Sent to:</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden max-h-44 overflow-y-auto divide-y divide-gray-50">
                  {reminderResults.sent.map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{s.student}</p>
                        <p className="text-xs text-gray-400">{s.email}</p>
                      </div>
                      <span className="text-xs text-orange-500 font-medium">{s.submitted_count}/4 submitted</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs bg-blue-50 text-blue-700 rounded-lg p-3">
              All sent emails are recorded in the <strong>Email Log</strong> tab. Click Close to view them now.
            </p>

            <div className="flex justify-end pt-2">
              <button onClick={() => { setReminderResults(null); setActiveTab('email_log') }} className="btn-primary">
                View Email Log
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add Document Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setUploadFile(null) }} title="Add Compliance Document" size="md">
        <div className="space-y-4">
          <FormRow label="Student" required>
            <Select value={form.student_id} onChange={v => setForm(f => ({ ...f, student_id: v }))}
              options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))} placeholder="Select student..." />
          </FormRow>
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
