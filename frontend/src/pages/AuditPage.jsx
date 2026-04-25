/**
 * Reports & Audit — Issue 7 redesign.
 * Tab 1: Custom Reports — choose a report type, set filters, run, export CSV.
 * Tab 2: Audit Log    — existing timestamped activity log.
 */
import React, { useState, useEffect } from 'react'
import { Download, Shield, RefreshCw, Play, BarChart2, Clock, Users, FileText, Mail, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import api, { downloadFile } from '../utils/api'
import { PageHeader, Spinner, EmptyState, Badge } from '../components/ui/index'
import { format } from 'date-fns'

// ─── Report definitions ────────────────────────────────────────────────────────
const REPORTS = [
  {
    id: 'compliance_status',
    title: 'Compliance Status Report',
    description: 'All active students with their document submission status and any outstanding requirements.',
    icon: CheckCircle,
    color: 'text-green-500',
    bg: 'bg-green-50',
  },
  {
    id: 'expiring_documents',
    title: 'Expiring Documents',
    description: 'Compliance documents expiring within a chosen number of days.',
    icon: AlertTriangle,
    color: 'text-yellow-500',
    bg: 'bg-yellow-50',
  },
  {
    id: 'placement_hours',
    title: 'Placement Hours Summary',
    description: 'Hours completed vs required for each student, sortable by progress.',
    icon: Clock,
    color: 'text-blue-500',
    bg: 'bg-blue-50',
  },
  {
    id: 'enrollment_summary',
    title: 'Student Enrollment Overview',
    description: 'All students with enrolment status, campus, and qualification breakdown.',
    icon: Users,
    color: 'text-purple-500',
    bg: 'bg-purple-50',
  },
  {
    id: 'communications_log',
    title: 'Communications Log',
    description: 'All emails and SMS messages sent, filterable by date and type.',
    icon: Mail,
    color: 'text-cyan-500',
    bg: 'bg-cyan-50',
  },
]

const DOC_ABBR = {
  working_with_children_check: 'WWCC',
  first_aid_certificate: 'First Aid',
  work_placement_agreement: 'WPA',
  memorandum_of_understanding: 'MOU',
}

const ACTION_COLORS = {
  CREATE: 'badge-green', UPDATE: 'badge-blue', DELETE: 'badge-red',
  APPROVE: 'badge-green', LOGIN: 'badge-gray', REJECT: 'badge-yellow',
}

// ─── CSV export helper ─────────────────────────────────────────────────────────
function exportCsv(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function AuditPage() {
  const [activeTab, setActiveTab] = useState('reports')

  // ── Reports state ─────────────────────────────────────────────────────────
  const [selectedReport, setSelectedReport] = useState(null)
  const [filters, setFilters] = useState({
    campus: '', qualification: '', status: 'active',
    days: '30', missing_only: false,
    date_from: '', date_to: '', message_type: '',
  })
  const [results, setResults] = useState(null)
  const [running, setRunning] = useState(false)

  // ── Audit log state ───────────────────────────────────────────────────────
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const [filterAction, setFilterAction] = useState('')
  const [filterResource, setFilterResource] = useState('')
  const [auditDateFrom, setAuditDateFrom] = useState('')
  const [auditDateTo, setAuditDateTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const LIMIT = 50

  const loadAudit = () => {
    setAuditLoading(true)
    const params = new URLSearchParams({ limit: LIMIT, offset })
    if (filterAction) params.append('action', filterAction)
    if (filterResource) params.append('resource_type', filterResource)
    if (auditDateFrom) params.append('date_from', auditDateFrom)
    if (auditDateTo) params.append('date_to', auditDateTo)
    api.get(`/audit?${params}`)
      .then(r => { setEntries(r.data.entries || []); setTotal(r.data.total || 0) })
      .catch(() => {})
      .finally(() => setAuditLoading(false))
  }

  useEffect(() => { if (activeTab === 'audit') loadAudit() }, [activeTab, filterAction, filterResource, auditDateFrom, auditDateTo, offset])

  const runReport = async () => {
    if (!selectedReport) return
    setRunning(true)
    setResults(null)
    try {
      let data
      switch (selectedReport.id) {
        case 'compliance_status': {
          const p = new URLSearchParams()
          if (filters.campus) p.append('campus', filters.campus)
          if (filters.missing_only) p.append('missing_only', 'true')
          const r = await api.get(`/compliance/report?${p}`)
          data = r.data
          break
        }
        case 'expiring_documents': {
          const r = await api.get(`/compliance/expiring?days=${filters.days}`)
          data = r.data
          break
        }
        case 'placement_hours': {
          const p = new URLSearchParams()
          if (filters.campus) p.append('campus', filters.campus)
          if (filters.qualification) p.append('qualification', filters.qualification)
          if (filters.status) p.append('status', filters.status)
          const r = await api.get(`/students?${p}`)
          data = [...r.data].sort((a, b) => a.hours_percentage - b.hours_percentage)
          break
        }
        case 'enrollment_summary': {
          const p = new URLSearchParams()
          if (filters.status) p.append('status', filters.status)
          if (filters.campus) p.append('campus', filters.campus)
          const r = await api.get(`/students?${p}`)
          data = r.data
          break
        }
        case 'communications_log': {
          const r = await api.get('/communications')
          let d = r.data
          if (filters.message_type) d = d.filter(c => c.message_type === filters.message_type)
          if (filters.date_from) d = d.filter(c => c.sent_at && c.sent_at >= filters.date_from)
          if (filters.date_to) d = d.filter(c => c.sent_at && c.sent_at <= filters.date_to + 'T23:59:59')
          data = d
          break
        }
        default: data = []
      }
      setResults({ reportId: selectedReport.id, data, runAt: new Date() })
    } catch {
      setResults({ reportId: selectedReport.id, data: [], runAt: new Date(), error: true })
    } finally {
      setRunning(false)
    }
  }

  const doExportCsv = () => {
    if (!results) return
    const { reportId, data } = results
    const today = format(new Date(), 'yyyy-MM-dd')

    if (reportId === 'compliance_status') {
      const rows = [['Student ID', 'Student Name', 'Campus', 'Qualification', 'Submitted', 'Required', 'Compliant', 'WWCC', 'WPA', 'MOU', 'First Aid', 'Outstanding']]
      data.forEach(r => rows.push([
        r.student_ref, r.student_name, r.campus, r.qualification,
        r.submitted_count, r.required_count, r.fully_compliant ? 'Yes' : 'No',
        r.documents?.working_with_children_check?.submitted ? 'Yes' : 'No',
        r.documents?.work_placement_agreement?.submitted ? 'Yes' : 'No',
        r.documents?.memorandum_of_understanding?.submitted ? 'Yes' : 'No',
        r.documents?.first_aid_certificate?.submitted ? 'Yes' : 'No',
        r.outstanding?.join('; '),
      ]))
      exportCsv(`compliance_status_${today}.csv`, rows)

    } else if (reportId === 'expiring_documents') {
      const rows = [['Student', 'Campus', 'Document Type', 'Expiry Date', 'Days Until Expiry', 'Status', 'Verified']]
      data.forEach(r => rows.push([
        r.student_name, r.campus,
        DOC_ABBR[r.document_type] || r.document_type,
        r.expiry_date, r.days_until_expiry, r.status, r.verified ? 'Yes' : 'No',
      ]))
      exportCsv(`expiring_documents_${today}.csv`, rows)

    } else if (reportId === 'placement_hours') {
      const rows = [['Student ID', 'Student Name', 'Campus', 'Qualification', 'Status', 'Completed Hours', 'Required Hours', 'Progress %']]
      data.forEach(s => rows.push([
        s.student_id, s.full_name, s.campus, s.qualification, s.status,
        s.completed_hours, s.required_hours, s.hours_percentage,
      ]))
      exportCsv(`placement_hours_${today}.csv`, rows)

    } else if (reportId === 'enrollment_summary') {
      const rows = [['Student ID', 'Full Name', 'Campus', 'Qualification', 'Status', 'Email', 'Phone', 'Course Start', 'Course End', 'Compliance']]
      data.forEach(s => rows.push([
        s.student_id, s.full_name, s.campus, s.qualification, s.status,
        s.email, s.phone, s.course_start_date, s.course_end_date, s.compliance_status,
      ]))
      exportCsv(`enrollment_summary_${today}.csv`, rows)

    } else if (reportId === 'communications_log') {
      const rows = [['Sent At', 'Recipient', 'Email', 'Type', 'Subject', 'Status']]
      data.forEach(c => rows.push([
        c.sent_at ? format(new Date(c.sent_at), 'd MMM yyyy HH:mm') : '',
        c.recipient_name, c.recipient_email, c.message_type,
        c.subject, c.sent_successfully ? 'Sent' : 'Failed',
      ]))
      exportCsv(`communications_log_${today}.csv`, rows)
    }
  }

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }))

  // ─── Render filter panel per report type ────────────────────────────────────
  const renderFilters = () => {
    if (!selectedReport) return null
    const id = selectedReport.id
    const inputCls = 'input text-sm py-2 w-full'
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 p-4 bg-gray-50 rounded-xl">
        {(id === 'compliance_status' || id === 'placement_hours' || id === 'enrollment_summary') && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Campus</label>
            <select className={inputCls} value={filters.campus} onChange={e => setFilter('campus', e.target.value)}>
              <option value="">All Campuses</option>
              {['sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'online'].map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
        )}
        {(id === 'placement_hours' || id === 'enrollment_summary') && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Qualification</label>
            <select className={inputCls} value={filters.qualification} onChange={e => setFilter('qualification', e.target.value)}>
              <option value="">All Qualifications</option>
              <option value="CHC30125">Cert III (CHC30125)</option>
              <option value="CHC50125">Diploma (CHC50125)</option>
              <option value="CHC30121">Cert III (CHC30121)</option>
              <option value="CHC50121">Diploma (CHC50121)</option>
            </select>
          </div>
        )}
        {(id === 'placement_hours' || id === 'enrollment_summary') && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Student Status</label>
            <select className={inputCls} value={filters.status} onChange={e => setFilter('status', e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>
        )}
        {id === 'compliance_status' && (
          <div className="flex items-center gap-2 mt-5">
            <input type="checkbox" id="missing_only" checked={filters.missing_only} onChange={e => setFilter('missing_only', e.target.checked)} className="rounded" />
            <label htmlFor="missing_only" className="text-sm text-gray-600 cursor-pointer">Incomplete only</label>
          </div>
        )}
        {id === 'expiring_documents' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Expiring within (days)</label>
            <select className={inputCls} value={filters.days} onChange={e => setFilter('days', e.target.value)}>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
        )}
        {id === 'communications_log' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
              <input type="date" className={inputCls} value={filters.date_from} onChange={e => setFilter('date_from', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
              <input type="date" className={inputCls} value={filters.date_to} onChange={e => setFilter('date_to', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select className={inputCls} value={filters.message_type} onChange={e => setFilter('message_type', e.target.value)}>
                <option value="">All Types</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
          </>
        )}
      </div>
    )
  }

  // ─── Render results table per report type ───────────────────────────────────
  const renderResults = () => {
    if (!results) return null
    const { reportId, data, error } = results
    if (error) return <p className="text-center text-red-500 py-8">Failed to load report. Please try again.</p>
    if (!data.length) return <p className="text-center text-gray-400 py-8">No data found for the selected filters.</p>

    if (reportId === 'compliance_status') return (
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            {['Student', 'Campus', 'Qualification', 'Progress', 'WWCC', 'WPA', 'MOU', 'First Aid', 'Outstanding'].map(h => (
              <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {data.map(r => {
            const outAbbr = r.outstanding?.map(o => {
              const m = {'Working with Children Check':'WWCC','Valid First Aid Certificate (including CPR)':'First Aid','First Aid Certificate (incl. CPR)':'First Aid','Work Placement Agreement':'WPA','Memorandum of Understanding (MOU)':'MOU','Memorandum of Understanding':'MOU'}
              return m[o] || o
            })
            return (
              <tr key={r.student_id} className={r.fully_compliant ? 'bg-green-50/30' : ''}>
                <td className="px-3 py-2"><p className="font-medium text-gray-900">{r.student_name}</p><p className="text-gray-400">{r.student_ref}</p></td>
                <td className="px-3 py-2 text-gray-600 capitalize">{r.campus || '—'}</td>
                <td className="px-3 py-2 text-gray-500">{r.qualification || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={`font-bold ${r.fully_compliant ? 'text-green-600' : 'text-orange-500'}`}>{r.submitted_count}/{r.required_count}</span>
                </td>
                {['working_with_children_check', 'work_placement_agreement', 'memorandum_of_understanding', 'first_aid_certificate'].map(k => (
                  <td key={k} className="px-3 py-2 text-center">
                    {r.documents?.[k]?.submitted
                      ? <CheckCircle size={14} className="text-green-500 mx-auto" />
                      : <XCircle size={14} className="text-red-300 mx-auto" />}
                  </td>
                ))}
                <td className="px-3 py-2">
                  {outAbbr?.length === 0
                    ? <span className="text-green-600">✓ Complete</span>
                    : <span className="text-red-500">{outAbbr?.join(', ')}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )

    if (reportId === 'expiring_documents') return (
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>{['Student', 'Campus', 'Document', 'Expiry Date', 'Days Left', 'Status', 'Verified'].map(h => (
            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {data.map(d => (
            <tr key={d.id} className={d.days_until_expiry <= 7 ? 'bg-red-50/40' : 'bg-yellow-50/20'}>
              <td className="px-3 py-2 font-medium text-gray-900">{d.student_name}</td>
              <td className="px-3 py-2 text-gray-500 capitalize">{d.campus || '—'}</td>
              <td className="px-3 py-2 text-gray-600">{DOC_ABBR[d.document_type] || d.document_type}</td>
              <td className="px-3 py-2 text-gray-600">{d.expiry_date ? format(new Date(d.expiry_date), 'd MMM yyyy') : '—'}</td>
              <td className="px-3 py-2">
                <span className={`font-bold ${d.days_until_expiry <= 7 ? 'text-red-600' : 'text-yellow-600'}`}>{d.days_until_expiry} days</span>
              </td>
              <td className="px-3 py-2"><Badge status={d.status} /></td>
              <td className="px-3 py-2">{d.verified ? <span className="text-green-600">✓ Yes</span> : <span className="text-gray-400">No</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )

    if (reportId === 'placement_hours') return (
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>{['Student', 'Campus', 'Qualification', 'Status', 'Completed', 'Required', 'Progress'].map(h => (
            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {data.map(s => (
            <tr key={s.id}>
              <td className="px-3 py-2"><p className="font-medium text-gray-900">{s.full_name}</p><p className="text-gray-400">{s.student_id}</p></td>
              <td className="px-3 py-2 text-gray-500 capitalize">{s.campus || '—'}</td>
              <td className="px-3 py-2 text-gray-500">{s.qualification || '—'}</td>
              <td className="px-3 py-2"><Badge status={s.status} /></td>
              <td className="px-3 py-2 font-medium text-gray-900">{s.completed_hours}h</td>
              <td className="px-3 py-2 text-gray-500">{s.required_hours}h</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${s.hours_percentage >= 100 ? 'bg-green-500' : s.hours_percentage >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                      style={{ width: `${Math.min(s.hours_percentage, 100)}%` }} />
                  </div>
                  <span className={`font-bold ${s.hours_percentage >= 100 ? 'text-green-600' : 'text-orange-500'}`}>{s.hours_percentage}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )

    if (reportId === 'enrollment_summary') {
      const byCampus = data.reduce((acc, s) => { acc[s.campus || 'unknown'] = (acc[s.campus || 'unknown'] || 0) + 1; return acc }, {})
      const byStatus = data.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc }, {})
      return (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {Object.entries(byCampus).map(([c, n]) => (
              <div key={c} className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-navy">{n}</p>
                <p className="text-xs text-gray-500 capitalize">{c}</p>
              </div>
            ))}
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>{['Student ID', 'Full Name', 'Campus', 'Qualification', 'Status', 'Email', 'Course Start', 'Course End', 'Compliance'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.map(s => (
                <tr key={s.id}>
                  <td className="px-3 py-2 text-gray-500 font-mono">{s.student_id}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{s.full_name}</td>
                  <td className="px-3 py-2 text-gray-500 capitalize">{s.campus || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{s.qualification || '—'}</td>
                  <td className="px-3 py-2"><Badge status={s.status} /></td>
                  <td className="px-3 py-2 text-gray-400">{s.email || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{s.course_start_date ? format(new Date(s.course_start_date), 'd MMM yyyy') : '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{s.course_end_date ? format(new Date(s.course_end_date), 'd MMM yyyy') : '—'}</td>
                  <td className="px-3 py-2">
                    <Badge status={s.compliance_status} />
                    {s.compliance_missing_count > 0 && <span className="text-xs text-orange-500 ml-1">({s.compliance_missing_count} missing)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )
    }

    if (reportId === 'communications_log') return (
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>{['Sent At', 'Recipient', 'Email / Phone', 'Type', 'Subject / Message', 'Status'].map(h => (
            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {data.map(c => (
            <tr key={c.id} className={!c.sent_successfully ? 'bg-red-50/30' : ''}>
              <td className="px-3 py-2 whitespace-nowrap text-gray-500">{c.sent_at ? format(new Date(c.sent_at), 'd MMM yyyy HH:mm') : '—'}</td>
              <td className="px-3 py-2 font-medium text-gray-900">{c.recipient_name || '—'}</td>
              <td className="px-3 py-2 text-gray-400">{c.recipient_email || c.recipient_phone || '—'}</td>
              <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.message_type === 'email' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{c.message_type?.toUpperCase()}</span></td>
              <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{c.subject || c.body?.slice(0, 60) || '—'}</td>
              <td className="px-3 py-2">{c.sent_successfully ? <span className="text-green-600">✓ Sent</span> : <span className="text-red-500">✗ Failed</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )

    return null
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Reports & Audit"
        subtitle="Run custom reports or view the system audit log"
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {[{ key: 'reports', label: 'Custom Reports', icon: BarChart2 }, { key: 'audit', label: 'Audit Log', icon: Shield }].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.key ? 'border-navy text-navy' : 'border-transparent text-gray-500 hover:text-navy'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── Custom Reports Tab ─────────────────────────────────────────────── */}
      {activeTab === 'reports' && (
        <div>
          {/* Step 1: Select report */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Step 1 — Choose a report</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {REPORTS.map(r => (
              <button key={r.id} onClick={() => { setSelectedReport(r); setResults(null) }}
                className={`text-left p-4 rounded-xl border-2 transition-all ${selectedReport?.id === r.id ? 'border-navy bg-navy/5' : 'border-gray-100 bg-white hover:border-gray-300'}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${r.bg} mb-3`}>
                  <r.icon size={18} className={r.color} />
                </div>
                <p className={`text-sm font-semibold ${selectedReport?.id === r.id ? 'text-navy' : 'text-gray-800'}`}>{r.title}</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{r.description}</p>
              </button>
            ))}
          </div>

          {/* Step 2: Filters */}
          {selectedReport && (
            <>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Step 2 — Set filters</p>
              {renderFilters()}

              {/* Step 3: Run */}
              <div className="flex items-center gap-3 mt-4">
                <button onClick={runReport} disabled={running}
                  className="btn-primary flex items-center gap-2">
                  <Play size={15} /> {running ? 'Running…' : `Run: ${selectedReport.title}`}
                </button>
                {results && (
                  <button onClick={doExportCsv} className="btn-secondary flex items-center gap-2">
                    <Download size={15} /> Export CSV
                  </button>
                )}
                {results && (
                  <span className="text-xs text-gray-400">
                    {results.data.length} row{results.data.length !== 1 ? 's' : ''} · Run at {format(results.runAt, 'HH:mm:ss')}
                  </span>
                )}
              </div>
            </>
          )}

          {/* Results */}
          {running && <div className="mt-6"><Spinner size="lg" /></div>}
          {!running && results && (
            <div className="mt-6 card p-0 overflow-hidden overflow-x-auto">
              {renderResults()}
            </div>
          )}
          {!selectedReport && (
            <div className="mt-4 text-center py-12 text-gray-400">
              <BarChart2 size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a report type above to get started</p>
            </div>
          )}
        </div>
      )}

      {/* ── Audit Log Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <select className="input text-sm py-2" value={filterAction} onChange={e => { setFilterAction(e.target.value); setOffset(0) }}>
              <option value="">All Actions</option>
              {['CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN'].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="input text-sm py-2" value={filterResource} onChange={e => { setFilterResource(e.target.value); setOffset(0) }}>
              <option value="">All Resources</option>
              {['student', 'appointment', 'hours', 'compliance', 'communication', 'issue', 'centre', 'user'].map(r => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
            <input className="input text-sm py-2" type="date" value={auditDateFrom} onChange={e => { setAuditDateFrom(e.target.value); setOffset(0) }} />
            <input className="input text-sm py-2" type="date" value={auditDateTo} onChange={e => { setAuditDateTo(e.target.value); setOffset(0) }} />
            {(filterAction || filterResource || auditDateFrom || auditDateTo) && (
              <button onClick={() => { setFilterAction(''); setFilterResource(''); setAuditDateFrom(''); setAuditDateTo(''); setOffset(0) }}
                className="text-sm text-gray-500 hover:text-navy underline">Clear</button>
            )}
            <button onClick={loadAudit} className="btn-secondary text-sm ml-auto"><RefreshCw size={14} /> Refresh</button>
            <button onClick={async () => {
              setExporting(true)
              const p = new URLSearchParams()
              if (auditDateFrom) p.append('date_from', auditDateFrom)
              if (auditDateTo) p.append('date_to', auditDateTo)
              await downloadFile(`/audit/export/csv?${p}`, 'audit_log.csv')
              setExporting(false)
            }} disabled={exporting} className="btn-secondary text-sm">
              <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>

          {auditLoading ? <Spinner /> : entries.length === 0 ? (
            <EmptyState icon={Shield} title="No audit entries" message="Actions taken in the system will appear here." />
          ) : (
            <>
              <div className="card p-0 overflow-hidden overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>{['Timestamp', 'User', 'Action', 'Resource', 'ID / Label', 'IP'].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {entries.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-gray-500">{e.created_at ? format(new Date(e.created_at), 'd MMM yyyy HH:mm:ss') : '—'}</td>
                        <td className="px-4 py-3"><p className="font-medium text-gray-900">{e.user_name || '—'}</p><p className="text-gray-400">{e.user_email}</p></td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[e.action] || 'badge-gray'}`}>{e.action}</span></td>
                        <td className="px-4 py-3 text-gray-600 capitalize">{e.resource_type || '—'}</td>
                        <td className="px-4 py-3"><p className="text-gray-700">{e.resource_label || '—'}</p><p className="text-gray-400 font-mono">{e.resource_id || ''}</p></td>
                        <td className="px-4 py-3 text-gray-400 font-mono">{e.ip_address || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
                <span>Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
                <div className="flex gap-2">
                  <button onClick={() => setOffset(o => Math.max(0, o - LIMIT))} disabled={offset === 0} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40">← Prev</button>
                  <button onClick={() => setOffset(o => o + LIMIT)} disabled={offset + LIMIT >= total} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40">Next →</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
