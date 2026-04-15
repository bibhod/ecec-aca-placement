/**
 * For Trainer/Assessor — Visit Reports
 * Auto-populated from Appointment data. No manual data entry.
 * Shows every visit each Trainer/Assessor did, with filters.
 */
import React, { useEffect, useState } from 'react'
import { Download, RefreshCw, ChevronDown, ChevronRight, User } from 'lucide-react'
import api, { downloadFile } from '../utils/api'
import { PageHeader, Spinner, Badge, Select, EmptyState } from '../components/ui/index'
import { format } from 'date-fns'

const APPT_LABELS = {
  cert_iii_1st_visit: 'Cert III – 1st Visit', cert_iii_2nd_visit: 'Cert III – 2nd Visit',
  cert_iii_3rd_visit: 'Cert III – 3rd Visit', diploma_1st_visit: 'Diploma – 1st Visit',
  diploma_2nd_visit: 'Diploma – 2nd Visit', reassessment_visit: 'Reassessment Visit',
}

export default function VisitReportsPage() {
  const [visits, setVisits] = useState([])
  const [trainers, setTrainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterTrainer, setFilterTrainer] = useState('')
  const [filterStudent, setFilterStudent] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [expanded, setExpanded] = useState({})
  const [viewMode, setViewMode] = useState('flat') // 'flat' | 'grouped'
  const [exporting, setExporting] = useState(false)

  const load = () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (filterTrainer) p.append('trainer_id', filterTrainer)
    if (filterStudent) p.append('student_name', filterStudent)
    if (filterDateFrom) p.append('date_from', filterDateFrom)
    if (filterDateTo) p.append('date_to', filterDateTo)
    if (filterStatus) p.append('status', filterStatus)

    Promise.all([
      api.get(`/visit-reports?${p}`),
      api.get('/users'),
    ]).then(([v, u]) => {
      setVisits(v.data)
      setTrainers(u.data.filter(x => ['trainer','admin','coordinator'].includes(x.role)))
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filterTrainer, filterStudent, filterDateFrom, filterDateTo, filterStatus])

  const doExport = async () => {
    setExporting(true)
    const p = new URLSearchParams()
    if (filterTrainer) p.append('trainer_id', filterTrainer)
    if (filterStudent) p.append('student_name', filterStudent)
    if (filterDateFrom) p.append('date_from', filterDateFrom)
    if (filterDateTo) p.append('date_to', filterDateTo)
    await downloadFile(`/visit-reports/export/csv?${p}`, 'visit_report.csv')
    setExporting(false)
  }

  const toggleExpand = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }))

  // Group by trainer for grouped view
  const grouped = visits.reduce((acc, v) => {
    const key = v.trainer_assessor_id || 'unassigned'
    if (!acc[key]) acc[key] = { name: v.trainer_assessor_name, visits: [] }
    acc[key].visits.push(v)
    return acc
  }, {})

  const clearFilters = () => {
    setFilterTrainer(''); setFilterStudent(''); setFilterDateFrom('')
    setFilterDateTo(''); setFilterStatus('')
  }

  const hasFilters = filterTrainer || filterStudent || filterDateFrom || filterDateTo || filterStatus

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Trainer/Assessor Visit Reports"
        subtitle={`${visits.length} visit record${visits.length !== 1 ? 's' : ''} — auto-populated from appointments`}
        actions={
          <>
            <button onClick={load} className="btn-secondary text-sm"><RefreshCw size={15} /> Refresh</button>
            <button onClick={doExport} disabled={exporting} className="btn-secondary text-sm">
              <Download size={15} /> {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </>
        }
      />

      {/* Filters */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filter Records</p>
        <div className="flex flex-wrap gap-3">
          <Select value={filterTrainer} onChange={setFilterTrainer} placeholder="All Trainers/Assessors"
            options={trainers.map(t => ({ value: t.id, label: t.full_name }))} />
          <input className="input text-sm py-2 w-48" placeholder="Student name…"
            value={filterStudent} onChange={e => setFilterStudent(e.target.value)} />
          <input className="input text-sm py-2" type="date" value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)} title="Date from" />
          <input className="input text-sm py-2" type="date" value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)} title="Date to" />
          <Select value={filterStatus} onChange={setFilterStatus} placeholder="All Statuses"
            options={['scheduled','completed','cancelled'].map(s => ({ value: s, label: s.charAt(0).toUpperCase()+s.slice(1) }))} />
          {hasFilters && <button onClick={clearFilters} className="text-sm text-gray-400 hover:text-navy underline">Clear</button>}
        </div>
        <div className="flex gap-2 pt-1">
          {['flat','grouped'].map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${viewMode===m?'bg-navy text-white border-navy':'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
              {m === 'flat' ? 'All Visits (flat)' : 'Grouped by Trainer'}
            </button>
          ))}
        </div>
      </div>

      {visits.length === 0 ? (
        <EmptyState icon={User} title="No visits found"
          message="Visit records are automatically created when appointments are scheduled. Adjust your filters or create an appointment." />
      ) : viewMode === 'flat' ? (
        /* ── Flat table view ──────────────────────────────────────────── */
        <div className="card p-0 overflow-hidden overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>{['Ref', 'Trainer/Assessor', 'Student', 'Qualification', 'Centre', 'Date', 'Time', 'Type', 'Units Assessed', 'Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visits.map(v => (
                <tr key={v.appointment_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{v.visit_reference || '—'}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{v.trainer_assessor_name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium">{v.student_name}</p>
                    <p className="text-xs text-gray-400">{v.student_id}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{v.student_qualification}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{v.placement_centre_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                    {v.visit_date ? format(new Date(v.visit_date), 'd MMM yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{v.visit_time}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                    {APPT_LABELS[v.appointment_type] || v.appointment_type}
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    {v.units_assessed?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {v.units_assessed.map(u => (
                          <span key={u} className="text-xs bg-cyan/10 text-cyan px-1.5 py-0.5 rounded">{u}</span>
                        ))}
                      </div>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3"><Badge status={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Grouped by Trainer view ──────────────────────────────────── */
        <div className="space-y-4">
          {Object.entries(grouped).map(([tid, group]) => (
            <div key={tid} className="card p-0 overflow-hidden">
              <button
                onClick={() => toggleExpand(tid)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-navy flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {group.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-gray-900">{group.name}</p>
                    <p className="text-xs text-gray-400">
                      {group.visits.length} visit{group.visits.length!==1?'s':''} ·{' '}
                      {group.visits.filter(v=>v.completed).length} completed
                    </p>
                  </div>
                </div>
                {expanded[tid] ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
              </button>

              {expanded[tid] && (
                <div className="border-t border-gray-100 overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>{['Student', 'Centre', 'Date & Time', 'Type', 'Units Assessed', 'Status', 'Feedback'].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-400 whitespace-nowrap">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {group.visits.map(v => (
                        <tr key={v.appointment_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium">{v.student_name}</p>
                            <p className="text-xs text-gray-400">{v.student_id} · {v.student_qualification}</p>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{v.placement_centre_name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {v.visit_date ? format(new Date(v.visit_date), 'd MMM yyyy') : '—'} {v.visit_time}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {APPT_LABELS[v.appointment_type] || v.appointment_type}
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            {v.units_assessed?.length > 0
                              ? <div className="flex flex-wrap gap-1">
                                  {v.units_assessed.map(u => (
                                    <span key={u} className="text-xs bg-cyan/10 text-cyan px-1.5 py-0.5 rounded">{u}</span>
                                  ))}
                                </div>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3"><Badge status={v.status} /></td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{v.feedback || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
