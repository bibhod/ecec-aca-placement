/**
 * Reports & Audit
 * Tab 1: Custom Reports  — pick a report, set filters, run, export CSV
 * Tab 2: Email & SMS Log — every email / SMS sent by the system (searchable, filterable by date)
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Download, Play, BarChart2, Clock, Users, Mail, AlertTriangle, CheckCircle, XCircle, RefreshCw, Eye, EyeOff, FileText, Shield } from 'lucide-react'
import api, { downloadFile } from '../utils/api'
import { PageHeader, Spinner, EmptyState, Badge } from '../components/ui/index'
import { format, parseISO } from 'date-fns'

// ─── Report definitions ────────────────────────────────────────────────────────
const REPORTS = [
  {
    id: 'compliance_status',
    title: 'Compliance Status Report',
    description: 'All current students with their document submission status and any outstanding requirements.',
    icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50',
  },
  {
    id: 'expiring_documents',
    title: 'Expiring Documents',
    description: 'Compliance documents expiring within a chosen number of days.',
    icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-50',
  },
  {
    id: 'placement_hours',
    title: 'Placement Hours Summary',
    description: 'Hours completed vs required for each student.',
    icon: Clock, color: 'text-blue-500', bg: 'bg-blue-50',
  },
  {
    id: 'enrollment_summary',
    title: 'Student Enrollment Overview',
    description: 'All students with campus, qualification, status, and compliance breakdown.',
    icon: Users, color: 'text-purple-500', bg: 'bg-purple-50',
  },
]

const DOC_ABBR = {
  working_with_children_check: 'WWCC',
  first_aid_certificate: 'First Aid',
  work_placement_agreement: 'WPA',
  memorandum_of_understanding: 'MOU',
}

function applyQualFilter(students, qual) {
  if (!qual) return students
  if (qual === 'cert_iii') return students.filter(s => s.qualification?.includes('30'))
  if (qual === 'diploma')  return students.filter(s => s.qualification?.includes('50'))
  return students.filter(s => s.qualification === qual)
}

function exportCsv(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function AuditPage() {
  const [activeTab, setActiveTab] = useState('reports')

  // ── Custom Reports state ────────────────────────────────────────────────────
  const [selectedReport, setSelectedReport] = useState(null)
  const [filters, setFilters] = useState({
    campus: '', qualification: '', status: 'current',
    days: '30', missing_only: false,
  })
  const [results, setResults] = useState(null)
  const [running, setRunning] = useState(false)

  // ── Audit Log state ─────────────────────────────────────────────────────────
  const [auditLogs, setAuditLogs] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState(false)
  const [auditSearch, setAuditSearch] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [auditResource, setAuditResource] = useState('')

  // ── Email & SMS Log state ───────────────────────────────────────────────────
  const [allComms, setAllComms] = useState([])
  const [commsLoading, setCommsLoading] = useState(false)
  const [commsError, setCommsError] = useState(false)
  const [commsDateFrom, setCommsDateFrom] = useState('')
  const [commsDateTo, setCommsDateTo] = useState('')
  const [commsType, setCommsType] = useState('')
  const [commsSearch, setCommsSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  // ── Load audit log ──────────────────────────────────────────────────────────
  const loadAuditLogs = useCallback(() => {
    setAuditLoading(true)
    setAuditError(false)
    api.get('/audit')
      .then(r => setAuditLogs(Array.isArray(r.data) ? r.data : []))
      .catch(() => { setAuditError(true); setAuditLogs([]) })
      .finally(() => setAuditLoading(false))
  }, [])

  useEffect(() => { if (activeTab === 'audit') loadAuditLogs() }, [activeTab, loadAuditLogs])

  // Format audit detail into plain English
  const formatAuditDetail = (action, details) => {
    if (!details) return action.replace('.', ' → ')
    if (action === 'student.create') return `Created student ${details.student_id || ''} (${details.qualification || ''})`
    if (action === 'student.update') return `Updated fields: ${(details.updated_fields || []).join(', ')}`
    if (action === 'compliance.add') return `Added ${(details.document_type || '').replace(/_/g, ' ')} for student`
    if (action === 'compliance.delete') return `Deleted ${(details.document_type || '').replace(/_/g, ' ')}`
    if (action === 'hours.create') return `Logged ${details.hours}h on ${details.log_date}`
    if (action === 'hours.approve') return `Approved ${details.hours}h logged on ${details.log_date}`
    if (action === 'visit.create') return `Created visit on ${details.visit_date || ''}`
    if (action === 'visit.update') return `Updated fields: ${(details.updated_fields || []).join(', ')}`
    if (action === 'visit.approve') return `Claim approved by ${details.approved_by || ''}`
    if (action === 'placement.completion') return `Placement completion record ${details.reference_number || ''} generated`
    // Fallback: pretty-print the details object
    return Object.entries(details).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' | ')
  }

  // ── Load email/SMS log ──────────────────────────────────────────────────────
  const loadComms = useCallback(() => {
    setCommsLoading(true)
    setCommsError(false)
    api.get('/communications')
      .then(r => setAllComms(Array.isArray(r.data) ? r.data : []))
      .catch(() => { setCommsError(true); setAllComms([]) })
      .finally(() => setCommsLoading(false))
  }, [])

  useEffect(() => { if (activeTab === 'comms') loadComms() }, [activeTab, loadComms])

  // Filter comms client-side
  const filteredComms = allComms.filter(c => {
    if (commsType && c.message_type !== commsType) return false
    if (commsDateFrom && c.sent_at && c.sent_at.slice(0, 10) < commsDateFrom) return false
    if (commsDateTo   && c.sent_at && c.sent_at.slice(0, 10) > commsDateTo)   return false
    if (commsSearch) {
      const q = commsSearch.toLowerCase()
      if (!c.recipient_name?.toLowerCase().includes(q) &&
          !c.recipient_email?.toLowerCase().includes(q) &&
          !c.subject?.toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── Run custom report ───────────────────────────────────────────────────────
  const runReport = async () => {
    if (!selectedReport) return
    setRunning(true); setResults(null)
    try {
      let data
      switch (selectedReport.id) {
        case 'compliance_status': {
          const p = new URLSearchParams()
          if (filters.missing_only) p.append('missing_only', 'true')
          const r = await api.get(`/compliance/report?${p}`)
          data = filters.campus
            ? r.data.filter(row => row.campus?.toLowerCase() === filters.campus.toLowerCase())
            : r.data
          break
        }
        case 'expiring_documents': {
          const r = await api.get(`/compliance/expiring?days=${filters.days}`)
          data = r.data
          break
        }
        case 'placement_hours': {
          const p = new URLSearchParams()
          if (filters.status) p.append('status', filters.status)
          const r = await api.get(`/students?${p}`)
          let d = r.data
          if (filters.campus) d = d.filter(s => s.campus?.toLowerCase() === filters.campus.toLowerCase())
          if (filters.qualification) d = applyQualFilter(d, filters.qualification)
          data = [...d].sort((a, b) => a.hours_percentage - b.hours_percentage)
          break
        }
        case 'enrollment_summary': {
          const p = new URLSearchParams()
          if (filters.status) p.append('status', filters.status)
          const r = await api.get(`/students?${p}`)
          let d = r.data
          if (filters.campus) d = d.filter(s => s.campus?.toLowerCase() === filters.campus.toLowerCase())
          if (filters.qualification) d = applyQualFilter(d, filters.qualification)
          data = d
          break
        }
        default: data = []
      }
      setResults({ reportId: selectedReport.id, data, runAt: new Date() })
    } catch {
      setResults({ reportId: selectedReport.id, data: [], runAt: new Date(), error: true })
    } finally { setRunning(false) }
  }

  // ── CSV export ──────────────────────────────────────────────────────────────
  const doExportCsv = () => {
    if (!results) return
    const { reportId, data } = results
    const today = format(new Date(), 'yyyy-MM-dd')

    if (reportId === 'compliance_status') {
      const rows = [['Student ID','Student Name','Campus','Qualification','Submitted','Required','Compliant','WWCC','WPA','MOU','First Aid','Outstanding']]
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
      const rows = [['Student','Campus','Document','Expiry Date','Days Left','Status','Verified']]
      data.forEach(d => rows.push([
        d.student_name, d.campus, DOC_ABBR[d.document_type] || d.document_type,
        d.expiry_date, d.days_until_expiry, d.status, d.verified ? 'Yes' : 'No',
      ]))
      exportCsv(`expiring_docs_${today}.csv`, rows)
    } else if (reportId === 'placement_hours') {
      const rows = [['Student ID','Student Name','Campus','Qualification','Status','Completed Hrs','Required Hrs','Progress %']]
      data.forEach(s => rows.push([s.student_id, s.full_name, s.campus, s.qualification, s.status, s.completed_hours, s.required_hours, s.hours_percentage]))
      exportCsv(`placement_hours_${today}.csv`, rows)
    } else if (reportId === 'enrollment_summary') {
      const rows = [['Student ID','Full Name','Campus','Qualification','Status','Email','Course Start','Course End','Compliance','Missing Docs']]
      data.forEach(s => rows.push([s.student_id, s.full_name, s.campus, s.qualification, s.status, s.email, s.course_start_date, s.course_end_date, s.compliance_status, s.compliance_missing_count]))
      exportCsv(`enrollment_${today}.csv`, rows)
    }
  }

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }))

  // ── PDF export ───────────────────────────────────────────────────────────────
  const doExportPdf = () => {
    if (!results || !selectedReport) return
    const { reportId } = results
    const params = new URLSearchParams({ report_type: reportId })
    if (filters.campus)         params.append('campus', filters.campus)
    if (filters.qualification)  params.append('qualification', filters.qualification)
    if (filters.status)         params.append('status', filters.status)
    if (filters.days)           params.append('days', filters.days)
    if (filters.missing_only)   params.append('missing_only', 'true')
    // Use downloadFile util so auth token is sent
    import('../utils/api').then(({ downloadFile }) => {
      downloadFile(`/reports/export/pdf?${params}`, `${reportId}_report.pdf`)
    })
  }

  // ─── Filter panel for each report ──────────────────────────────────────────
  const renderFilters = () => {
    if (!selectedReport) return null
    const id = selectedReport.id
    const cls = 'input text-sm py-2 w-full'
    const campusOptions = ['sydney','melbourne','brisbane','perth','adelaide','online']
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 p-4 bg-gray-50 rounded-xl">
        {['compliance_status','placement_hours','enrollment_summary'].includes(id) && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Campus</label>
            <select className={cls} value={filters.campus} onChange={e => setFilter('campus', e.target.value)}>
              <option value="">All Campuses</option>
              {campusOptions.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </select>
          </div>
        )}
        {['placement_hours','enrollment_summary'].includes(id) && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Qualification</label>
            <select className={cls} value={filters.qualification} onChange={e => setFilter('qualification', e.target.value)}>
              <option value="">All Qualifications</option>
              <optgroup label="Grouped">
                <option value="cert_iii">All Cert III (30121 + 30125)</option>
                <option value="diploma">All Diploma (50121 + 50125)</option>
              </optgroup>
              <optgroup label="Specific">
                <option value="CHC30125">CHC30125 – Cert III (current)</option>
                <option value="CHC50125">CHC50125 – Diploma (current)</option>
                <option value="CHC30121">CHC30121 – Cert III (superseded)</option>
                <option value="CHC50121">CHC50121 – Diploma (superseded)</option>
              </optgroup>
            </select>
          </div>
        )}
        {['placement_hours','enrollment_summary'].includes(id) && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Student Status</label>
            <select className={cls} value={filters.status} onChange={e => setFilter('status', e.target.value)}>
              <option value="">All</option>
              <option value="current">Current</option>
              <option value="completed">Completed</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>
        )}
        {id === 'compliance_status' && (
          <div className="flex items-center gap-2 mt-5">
            <input type="checkbox" id="missing_only" checked={filters.missing_only}
              onChange={e => setFilter('missing_only', e.target.checked)} className="rounded" />
            <label htmlFor="missing_only" className="text-sm text-gray-600 cursor-pointer">Incomplete only</label>
          </div>
        )}
        {id === 'expiring_documents' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Expiring within</label>
            <select className={cls} value={filters.days} onChange={e => setFilter('days', e.target.value)}>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
        )}
      </div>
    )
  }

  // ─── Results table per report ───────────────────────────────────────────────
  const renderResults = () => {
    if (!results) return null
    const { reportId, data, error } = results
    if (error) return <p className="text-center text-red-500 py-8">Failed to load report. Please try again.</p>
    if (!data.length) return <p className="text-center text-gray-400 py-8">No data found for the selected filters.</p>

    if (reportId === 'compliance_status') return (
      <table className="w-full text-xs">
        <thead className="bg-gray-50 sticky top-0 z-10"><tr>
          {['Student','Campus','Qualification','Progress','WWCC','WPA','MOU','First Aid','Outstanding'].map(h =>
            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {data.map(r => {
            const outAbbr = r.outstanding?.map(o => ({'Working with Children Check':'WWCC','Valid First Aid Certificate (including CPR)':'First Aid','First Aid Certificate (incl. CPR)':'First Aid','Work Placement Agreement':'WPA','Memorandum of Understanding (MOU)':'MOU','Memorandum of Understanding':'MOU'}[o] || o))
            return (
              <tr key={r.student_id} className={r.fully_compliant ? 'bg-green-50/30' : ''}>
                <td className="px-3 py-2"><p className="font-medium text-gray-900">{r.student_name}</p><p className="text-gray-400">{r.student_ref}</p></td>
                <td className="px-3 py-2 text-gray-600 capitalize">{r.campus||'—'}</td>
                <td className="px-3 py-2 text-gray-500">{r.qualification||'—'}</td>
                <td className="px-3 py-2 whitespace-nowrap"><span className={`font-bold ${r.fully_compliant?'text-green-600':'text-orange-500'}`}>{r.submitted_count}/{r.required_count}</span></td>
                {['working_with_children_check','work_placement_agreement','memorandum_of_understanding','first_aid_certificate'].map(k => (
                  <td key={k} className="px-3 py-2 text-center">
                    {r.documents?.[k]?.submitted ? <CheckCircle size={14} className="text-green-500 mx-auto"/> : <XCircle size={14} className="text-red-300 mx-auto"/>}
                  </td>
                ))}
                <td className="px-3 py-2">{outAbbr?.length===0 ? <span className="text-green-600">✓ Complete</span> : <span className="text-red-500">{outAbbr?.join(', ')}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )

    if (reportId === 'expiring_documents') return (
      <table className="w-full text-xs">
        <thead className="bg-gray-50 sticky top-0 z-10"><tr>
          {['Student','Campus','Document','Expiry Date','Days Left','Status','Verified'].map(h =>
            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {data.map(d => (
            <tr key={d.id} className={d.days_until_expiry<=7?'bg-red-50/40':'bg-yellow-50/20'}>
              <td className="px-3 py-2 font-medium text-gray-900">{d.student_name}</td>
              <td className="px-3 py-2 text-gray-500 capitalize">{d.campus||'—'}</td>
              <td className="px-3 py-2 text-gray-600">{DOC_ABBR[d.document_type]||d.document_type}</td>
              <td className="px-3 py-2 text-gray-600">{d.expiry_date ? format(parseISO(d.expiry_date),'d MMM yyyy') : '—'}</td>
              <td className="px-3 py-2"><span className={`font-bold ${d.days_until_expiry<=7?'text-red-600':'text-yellow-600'}`}>{d.days_until_expiry} days</span></td>
              <td className="px-3 py-2"><Badge status={d.status}/></td>
              <td className="px-3 py-2">{d.verified ? <span className="text-green-600">✓ Yes</span> : <span className="text-gray-400">No</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )

    if (reportId === 'placement_hours') return (
      <table className="w-full text-xs">
        <thead className="bg-gray-50 sticky top-0 z-10"><tr>
          {['Student','Campus','Qualification','Status','Completed','Required','Progress'].map(h =>
            <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {data.map(s => (
            <tr key={s.id}>
              <td className="px-3 py-2"><p className="font-medium text-gray-900">{s.full_name}</p><p className="text-gray-400">{s.student_id}</p></td>
              <td className="px-3 py-2 text-gray-500 capitalize">{s.campus||'—'}</td>
              <td className="px-3 py-2 text-gray-500">{s.qualification||'—'}</td>
              <td className="px-3 py-2"><Badge status={s.status}/></td>
              <td className="px-3 py-2 font-medium text-gray-900">{s.completed_hours}h</td>
              <td className="px-3 py-2 text-gray-500">{s.required_hours}h</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-gray-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${s.hours_percentage>=100?'bg-green-500':s.hours_percentage>=50?'bg-yellow-400':'bg-red-400'}`}
                      style={{width:`${Math.min(s.hours_percentage,100)}%`}}/>
                  </div>
                  <span className={`font-bold ${s.hours_percentage>=100?'text-green-600':'text-orange-500'}`}>{s.hours_percentage}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )

    if (reportId === 'enrollment_summary') {
      const byCampus = data.reduce((a,s)=>{a[s.campus||'unknown']=(a[s.campus||'unknown']||0)+1;return a},{})
      return (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {Object.entries(byCampus).map(([c,n])=>(
              <div key={c} className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-navy">{n}</p>
                <p className="text-xs text-gray-500 capitalize">{c}</p>
              </div>
            ))}
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0 z-10"><tr>
              {['Student ID','Full Name','Campus','Qualification','Status','Email','Course Start','Course End','Compliance'].map(h =>
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {data.map(s=>(
                <tr key={s.id}>
                  <td className="px-3 py-2 text-gray-500 font-mono">{s.student_id}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{s.full_name}</td>
                  <td className="px-3 py-2 text-gray-500 capitalize">{s.campus||'—'}</td>
                  <td className="px-3 py-2 text-gray-500">{s.qualification||'—'}</td>
                  <td className="px-3 py-2"><Badge status={s.status}/></td>
                  <td className="px-3 py-2 text-gray-400">{s.email||'—'}</td>
                  <td className="px-3 py-2 text-gray-500">{s.course_start_date ? format(parseISO(s.course_start_date),'d MMM yyyy') : '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{s.course_end_date ? format(parseISO(s.course_end_date),'d MMM yyyy') : '—'}</td>
                  <td className="px-3 py-2">
                    <Badge status={s.compliance_status}/>
                    {s.compliance_missing_count>0 && <span className="text-xs text-orange-500 ml-1">({s.compliance_missing_count} missing)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )
    }
    return null
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Reports & Audit" subtitle="Run custom reports or view all email and SMS communications" />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {[
          { key: 'reports', label: 'Custom Reports',  icon: BarChart2 },
          { key: 'comms',   label: 'Email & SMS Log', icon: Mail },
          { key: 'audit',   label: 'Audit Log',       icon: Shield },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors
              ${activeTab===t.key ? 'border-navy text-navy' : 'border-transparent text-gray-500 hover:text-navy'}`}>
            <t.icon size={15}/> {t.label}
          </button>
        ))}
      </div>

      {/* ── Custom Reports ─────────────────────────────────────────────────── */}
      {activeTab === 'reports' && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Step 1 — Choose a report</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {REPORTS.map(r => (
              <button key={r.id} onClick={() => { setSelectedReport(r); setResults(null) }}
                className={`text-left p-4 rounded-xl border-2 transition-all
                  ${selectedReport?.id===r.id ? 'border-navy bg-navy/5' : 'border-gray-100 bg-white hover:border-gray-300'}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${r.bg} mb-3`}>
                  <r.icon size={18} className={r.color}/>
                </div>
                <p className={`text-sm font-semibold ${selectedReport?.id===r.id?'text-navy':'text-gray-800'}`}>{r.title}</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{r.description}</p>
              </button>
            ))}
          </div>

          {selectedReport && (
            <>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Step 2 — Set filters</p>
              {renderFilters()}
              <div className="flex items-center gap-3 mt-4">
                <button onClick={runReport} disabled={running} className="btn-primary flex items-center gap-2">
                  <Play size={15}/> {running ? 'Running…' : `Run: ${selectedReport.title}`}
                </button>
                {results && (
                  <div className="flex gap-2">
                    <button onClick={doExportCsv} className="btn-secondary flex items-center gap-2">
                      <Download size={15}/> Export CSV
                    </button>
                    <button onClick={doExportPdf} className="btn-secondary flex items-center gap-2 text-red-600 border-red-200 hover:bg-red-50">
                      <FileText size={15}/> Download PDF
                    </button>
                  </div>
                )}
                {results && (
                  <span className="text-xs text-gray-400">
                    {results.data.length} row{results.data.length!==1?'s':''} · Run at {format(results.runAt,'HH:mm:ss')}
                  </span>
                )}
              </div>
            </>
          )}

          {running && <div className="mt-6"><Spinner size="lg"/></div>}
          {!running && results && (
            <div className="mt-6 card p-0 overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>{renderResults()}</div>
          )}
          {!selectedReport && (
            <div className="mt-4 text-center py-12 text-gray-400">
              <BarChart2 size={40} className="mx-auto mb-3 opacity-30"/>
              <p className="text-sm">Select a report type above to get started</p>
            </div>
          )}
        </div>
      )}

      {/* ── Email & SMS Log ────────────────────────────────────────────────── */}
      {activeTab === 'comms' && (
        <div>
          {/* Explanation */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 text-sm text-blue-800">
            <strong>What is this?</strong> Every email and SMS sent through this system — including compliance reminders, welcome emails, appointment confirmations, and individual messages — is recorded here automatically.
            Use the filters below to find specific emails by date, type, or recipient name.
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-5">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From date</label>
              <input type="date" className="input text-sm py-2"
                value={commsDateFrom} onChange={e => setCommsDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To date</label>
              <input type="date" className="input text-sm py-2"
                value={commsDateTo} onChange={e => setCommsDateTo(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select className="input text-sm py-2" value={commsType} onChange={e => setCommsType(e.target.value)}>
                <option value="">All (Email + SMS)</option>
                <option value="email">Email only</option>
                <option value="sms">SMS only</option>
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="block text-xs text-gray-500 mb-1">Search recipient / subject</label>
              <input type="text" className="input text-sm py-2 w-full" placeholder="e.g. John Smith or 'compliance'…"
                value={commsSearch} onChange={e => setCommsSearch(e.target.value)} />
            </div>
            <div className="flex items-end">
              <button onClick={loadComms} className="btn-secondary text-sm flex items-center gap-1">
                <RefreshCw size={14}/> Refresh
              </button>
            </div>
            {(commsDateFrom || commsDateTo || commsType || commsSearch) && (
              <div className="flex items-end">
                <button onClick={() => { setCommsDateFrom(''); setCommsDateTo(''); setCommsType(''); setCommsSearch('') }}
                  className="text-sm text-gray-400 hover:text-navy underline self-end">Clear filters</button>
              </div>
            )}
          </div>

          {/* Export */}
          {filteredComms.length > 0 && (
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs text-gray-400">
                Showing <strong>{filteredComms.length}</strong> of {allComms.length} total messages
              </p>
              <button onClick={() => {
                const rows = [['Sent At','Recipient','Email / Phone','Type','Subject / Message','Status']]
                filteredComms.forEach(c => rows.push([
                  c.sent_at ? format(parseISO(c.sent_at),'d MMM yyyy HH:mm') : '',
                  c.recipient_name, c.recipient_email || c.recipient_phone,
                  c.message_type, c.subject || c.body?.slice(0,80),
                  c.sent_successfully ? 'Sent' : 'Failed',
                ]))
                exportCsv(`email_sms_log_${format(new Date(),'yyyy-MM-dd')}.csv`, rows)
              }} className="btn-secondary text-sm flex items-center gap-1">
                <Download size={14}/> Export CSV
              </button>
            </div>
          )}

          {/* Content */}
          {commsLoading ? (
            <Spinner size="lg"/>
          ) : commsError ? (
            <div className="text-center py-12">
              <p className="text-red-500 font-medium">Could not load email log.</p>
              <button onClick={loadComms} className="mt-3 btn-secondary text-sm">Try again</button>
            </div>
          ) : filteredComms.length === 0 ? (
            <EmptyState icon={Mail} title="No messages found"
              message={allComms.length > 0
                ? 'No messages match your current filters. Try adjusting the date range or clearing filters.'
                : 'No emails or SMS messages have been sent yet. Emails sent via Send Reminders or Communications will appear here.'}/>
          ) : (
            <div className="space-y-2">
              {filteredComms.map(c => (
                <div key={c.id}
                  className={`border rounded-xl overflow-hidden ${c.sent_successfully ? 'border-gray-100' : 'border-red-200 bg-red-50/20'}`}>
                  <div className="flex items-center justify-between px-4 py-3 gap-4">
                    {/* Left: status icon + details */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="mt-0.5 flex-shrink-0">
                        {c.sent_successfully
                          ? <CheckCircle size={16} className="text-green-500"/>
                          : <XCircle size={16} className="text-red-400"/>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{c.subject || '(No subject)'}</p>
                        <p className="text-xs text-gray-500">
                          To: <span className="font-medium text-gray-700">{c.recipient_name || '—'}</span>
                          {c.recipient_email && <span className="text-gray-400"> · {c.recipient_email}</span>}
                          {c.recipient_phone && <span className="text-gray-400"> · {c.recipient_phone}</span>}
                        </p>
                        {c.template_used && (
                          <span className="text-xs bg-purple-50 text-purple-600 border border-purple-100 px-2 py-0.5 rounded-full mt-1 inline-block">
                            {c.template_used.replace(/_/g,' ')}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Right: date + type + expand button */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          {c.sent_at ? format(parseISO(c.sent_at), 'd MMM yyyy') : '—'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {c.sent_at ? format(parseISO(c.sent_at), 'h:mm a') : ''}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0
                        ${c.message_type==='sms' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {c.message_type?.toUpperCase()}
                      </span>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0
                        ${c.sent_successfully ? 'bg-green-50 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {c.sent_successfully ? '✓ Sent' : '✗ Failed'}
                      </span>
                      {c.body && (
                        <button
                          onClick={() => setExpandedId(expandedId===c.id ? null : c.id)}
                          className="text-xs text-gray-400 hover:text-navy flex items-center gap-1 flex-shrink-0">
                          {expandedId===c.id ? <EyeOff size={13}/> : <Eye size={13}/>}
                          {expandedId===c.id ? 'Hide' : 'View'}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Expanded body */}
                  {expandedId===c.id && c.body && (
                    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                      <p className="text-xs font-semibold text-gray-500 mb-2">Email content sent:</p>
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{c.body}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Audit Log ─────────────────────────────────────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 text-sm text-blue-800">
            <strong>Audit Log</strong> — A read-only record of all create, update, and delete actions performed in the system. Each entry shows who did what and when.
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Action type</label>
              <select className="input text-sm py-2" value={auditAction} onChange={e => setAuditAction(e.target.value)}>
                <option value="">All actions</option>
                <option value="student.create">Student created</option>
                <option value="student.update">Student updated</option>
                <option value="compliance.add">Compliance doc added</option>
                <option value="compliance.delete">Compliance doc deleted</option>
                <option value="hours.create">Hours logged</option>
                <option value="hours.approve">Hours approved</option>
                <option value="visit.create">Visit created</option>
                <option value="visit.update">Visit updated</option>
                <option value="visit.approve">Visit claim approved</option>
                <option value="placement.completion">Placement completed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Resource type</label>
              <select className="input text-sm py-2" value={auditResource} onChange={e => setAuditResource(e.target.value)}>
                <option value="">All resources</option>
                <option value="student">Student</option>
                <option value="compliance_document">Compliance document</option>
                <option value="hours_log">Hours log</option>
                <option value="assessor_visit">Assessor visit</option>
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="block text-xs text-gray-500 mb-1">Search user / record</label>
              <input type="text" className="input text-sm py-2 w-full"
                placeholder="e.g. coordinator name or student ID…"
                value={auditSearch} onChange={e => setAuditSearch(e.target.value)} />
            </div>
            <button onClick={loadAuditLogs} className="btn-secondary text-sm flex items-center gap-1">
              <RefreshCw size={14}/> Refresh
            </button>
            {(auditAction || auditResource || auditSearch) && (
              <button onClick={() => { setAuditAction(''); setAuditResource(''); setAuditSearch('') }}
                className="text-sm text-gray-400 hover:text-navy underline self-end">Clear</button>
            )}
          </div>

          {auditLoading ? (
            <Spinner size="lg"/>
          ) : auditError ? (
            <div className="text-center py-12">
              <p className="text-red-500 font-medium">Could not load audit log.</p>
              <button onClick={loadAuditLogs} className="mt-3 btn-secondary text-sm">Try again</button>
            </div>
          ) : (() => {
            const filtered = auditLogs.filter(entry => {
              if (auditAction && entry.action !== auditAction) return false
              if (auditResource && entry.resource_type !== auditResource) return false
              if (auditSearch) {
                const q = auditSearch.toLowerCase()
                if (!entry.user_name?.toLowerCase().includes(q) &&
                    !entry.user_email?.toLowerCase().includes(q) &&
                    !entry.resource_label?.toLowerCase().includes(q) &&
                    !entry.resource_id?.toLowerCase().includes(q)) return false
              }
              return true
            })
            if (filtered.length === 0) return (
              <EmptyState icon={Shield} title="No audit entries found"
                message="Audit entries are created when coordinators create or update student, compliance, hours, or visit records." />
            )
            return (
              <div className="card p-0 overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                    <tr>
                      {['Timestamp', 'User', 'Action', 'Record', 'Detail'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map(entry => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                          {entry.created_at ? format(parseISO(entry.created_at), 'd MMM yyyy, h:mm a') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{entry.user_name || '—'}</p>
                          <p className="text-gray-400">{entry.user_email || ''}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap
                            ${entry.action?.includes('create') || entry.action?.includes('add') ? 'bg-green-100 text-green-700'
                              : entry.action?.includes('delete') ? 'bg-red-100 text-red-600'
                              : entry.action?.includes('approve') || entry.action?.includes('completion') ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-600'
                            }`}>
                            {entry.action || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-700 font-medium">{(entry.resource_type || '').replace(/_/g, ' ')}</p>
                          <p className="text-gray-400 truncate max-w-32" title={entry.resource_label}>{entry.resource_label || entry.resource_id || '—'}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs">
                          {formatAuditDetail(entry.action || '', entry.details)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
