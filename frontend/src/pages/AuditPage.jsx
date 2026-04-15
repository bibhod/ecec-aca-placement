/**
 * AuditPage — Issue 14. Export fixed to use authenticated downloadFile().
 */
import React, { useEffect, useState } from 'react'
import { Download, Shield, RefreshCw } from 'lucide-react'
import api, { downloadFile } from '../utils/api'
import { PageHeader, Spinner, EmptyState } from '../components/ui/index'
import { format } from 'date-fns'

const ACTION_COLORS = {
  CREATE: 'badge-green', UPDATE: 'badge-blue', DELETE: 'badge-red',
  APPROVE: 'badge-green', LOGIN: 'badge-gray', REJECT: 'badge-yellow',
}

export default function AuditPage() {
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterAction, setFilterAction] = useState('')
  const [filterResource, setFilterResource] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  const LIMIT = 50

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: LIMIT, offset })
    if (filterAction) params.append('action', filterAction)
    if (filterResource) params.append('resource_type', filterResource)
    if (dateFrom) params.append('date_from', dateFrom)
    if (dateTo) params.append('date_to', dateTo)
    api.get(`/audit?${params}`)
      .then(r => { setEntries(r.data.entries || []); setTotal(r.data.total || 0) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filterAction, filterResource, dateFrom, dateTo, offset])

  const doExport = async () => {
    setExporting(true)
    const params = new URLSearchParams()
    if (dateFrom) params.append('date_from', dateFrom)
    if (dateTo) params.append('date_to', dateTo)
    await downloadFile(`/audit/export/csv?${params}`, 'audit_report.csv')
    setExporting(false)
  }

  const RESOURCE_TYPES = ['student', 'appointment', 'hours', 'compliance', 'communication', 'issue', 'centre', 'user', 'assessor_visit']
  const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN']

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Audit Trail" subtitle={`${total} total log entries`}
        actions={
          <>
            <button onClick={load} className="btn-secondary text-sm"><RefreshCw size={15} /> Refresh</button>
            <button onClick={doExport} disabled={exporting} className="btn-secondary text-sm">
              <Download size={15} /> {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </>
        }
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <select className="input text-sm py-2" value={filterAction} onChange={e => { setFilterAction(e.target.value); setOffset(0) }}>
          <option value="">All Actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input text-sm py-2" value={filterResource} onChange={e => { setFilterResource(e.target.value); setOffset(0) }}>
          <option value="">All Resources</option>
          {RESOURCE_TYPES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
        </select>
        <input className="input text-sm py-2" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setOffset(0) }} />
        <input className="input text-sm py-2" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setOffset(0) }} />
        {(filterAction || filterResource || dateFrom || dateTo) && (
          <button onClick={() => { setFilterAction(''); setFilterResource(''); setDateFrom(''); setDateTo(''); setOffset(0) }}
            className="text-sm text-gray-500 hover:text-navy underline">Clear</button>
        )}
      </div>

      {loading ? <Spinner /> : entries.length === 0 ? (
        <EmptyState icon={Shield} title="No audit entries" message="Actions taken in the system will appear here." />
      ) : (
        <>
          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>{['Timestamp', 'User', 'Action', 'Resource', 'ID / Label', 'IP'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {e.created_at ? format(new Date(e.created_at), 'd MMM yyyy HH:mm:ss') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-gray-900">{e.user_name || '—'}</p>
                      <p className="text-xs text-gray-400">{e.user_email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[e.action] || 'badge-gray'}`}>
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 capitalize">{e.resource_type || '—'}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-700">{e.resource_label || '—'}</p>
                      <p className="text-xs text-gray-400 font-mono">{e.resource_id || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{e.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
            <div className="flex gap-2">
              <button onClick={() => setOffset(o => Math.max(0, o - LIMIT))} disabled={offset === 0}
                className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40">← Prev</button>
              <button onClick={() => setOffset(o => o + LIMIT)} disabled={offset + LIMIT >= total}
                className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40">Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
