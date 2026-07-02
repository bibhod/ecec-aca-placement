/**
 * AuditPage — Audit Trail
 *
 * Previously this page also carried a "Custom Reports" tab and an
 * "Email & SMS Log" tab, both of which duplicated the dedicated Reports page
 * (/reports) and Communications page (/communications). Consolidated so each
 * fact lives in exactly one place — this page is now the audit log only.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Shield, BarChart3, MessageSquare } from 'lucide-react'
import api from '../utils/api'
import { PageHeader, Spinner, EmptyState } from '../components/ui/index'
import { format, parseISO } from 'date-fns'

export default function AuditPage() {
  // ── Audit Log state ─────────────────────────────────────────────────────────
  const [auditLogs, setAuditLogs] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState(false)
  const [auditSearch, setAuditSearch] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [auditResource, setAuditResource] = useState('')

  const loadAuditLogs = useCallback(() => {
    setAuditLoading(true)
    setAuditError(false)
    api.get('/audit', { params: { limit: 500 } })
      .then(r => setAuditLogs(Array.isArray(r.data?.entries) ? r.data.entries : []))
      .catch(() => { setAuditError(true); setAuditLogs([]) })
      .finally(() => setAuditLoading(false))
  }, [])

  useEffect(() => { loadAuditLogs() }, [loadAuditLogs])

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

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Audit Trail" subtitle="Read-only record of every create, update, and delete action in the system" />

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 text-sm text-blue-800 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span><strong>Looking for something else?</strong> Custom reports and analytics live on the</span>
        <Link to="/reports" className="inline-flex items-center gap-1 font-medium underline hover:no-underline">
          <BarChart3 size={13} /> Reports
        </Link>
        <span>page, and the full email/SMS log lives on the</span>
        <Link to="/communications" className="inline-flex items-center gap-1 font-medium underline hover:no-underline">
          <MessageSquare size={13} /> Communications
        </Link>
        <span>page.</span>
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
      ) : filtered.length === 0 ? (
        <EmptyState icon={Shield} title="No audit entries found"
          message="Audit entries are created when coordinators create or update student, compliance, hours, or visit records." />
      ) : (
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
      )}
    </div>
  )
}
