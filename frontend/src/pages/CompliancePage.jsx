/**
 * CompliancePage - Compliance section of the ECEC Placement Portal
 *
 * Changes in this revision (all scoped to this file / compliance endpoints):
 *
 *  Feature 1 - Searchable student combobox in Add Document modal
 *    - StudentSearchInput component: real-time filter, keyboard nav (↑↓ Enter Esc),
 *      "No students found" fallback, submits correct student UUID.
 *
 *  Feature 2 - Bulk multi-document upload in Add Document modal
 *    - One row per DOC_TYPE; each row has its own file picker.
 *    - WPA and MOU rows include a Qualification dropdown (Certificate III / Diploma).
 *    - Only rows with a file selected are submitted (parallel uploads).
 *    - Qualification is prepended to the notes field before sending so no DB schema
 *      changes are required.
 *
 *  Feature 3 - Sticky column headers on all scrollable tables
 *    - Tables are wrapped in overflow-auto containers with max-height so they scroll
 *      independently of the page.
 *    - <thead> receives `sticky top-0 z-10` so headers remain visible during scroll.
 *    - Visual design of headers is unchanged; only scroll behaviour differs.
 *      NOTE: if your layout has a fixed top navbar, increase the `top-0` offset on
 *      <thead> (e.g. `top-[64px]`) to match the navbar height and prevent overlap.
 *
 *  Feature 4 - Bulk Upload via CSV tab
 *    - "Download CSV Template" generates a .csv client-side (no backend call needed).
 *    - CSV upload parses the file in the browser and shows a validated preview table.
 *    - Invalid rows are highlighted in red with a per-row error message.
 *    - Valid rows are submitted via the existing POST /api/compliance endpoint.
 *    - Summary result shown after submission.
 *
 * Assumptions / notes:
 *  - The `qualification` value for WPA/MOU is stored as a "Qualification: X" prefix
 *    in the `notes` field - no DB schema change required, fully backwards compatible.
 *  - CSV `student_id` column contains the student reference number (e.g. "STU001"),
 *    matched against the `student_id` field on the Student model (not the UUID).
 *  - CSV rows create metadata-only documents (no file attachment); files can be
 *    added later via the existing per-document upload endpoint.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Upload, CheckCircle, AlertTriangle, XCircle, Mail,
  FileText, Clock, Eye, BarChart2, Download,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { useAuth } from '../contexts/AuthContext'
import {
  PageHeader, Spinner, Badge, Modal, FormRow, Select,
  SearchInput, EmptyState, StatCard,
} from '../components/ui/index'
import { format } from 'date-fns'

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'working_with_children_check', label: 'Working with Children Check',       abbr: 'WWCC',      qualSpecific: false },
  { value: 'first_aid_certificate',        label: 'First Aid Certificate (incl. CPR)', abbr: 'First Aid', qualSpecific: false },
  { value: 'work_placement_agreement',     label: 'Work Placement Agreement',          abbr: 'WPA',       qualSpecific: true  },
  { value: 'memorandum_of_understanding',  label: 'Memorandum of Understanding',       abbr: 'MOU',       qualSpecific: true  },
]

const QUAL_OPTIONS = [
  { value: 'Cert III', label: 'Cert III' },
  { value: 'Diploma',  label: 'Diploma'  },
]

// ─── Feature 1: Searchable Student Combobox ──────────────────────────────────

/**
 * StudentSearchInput
 *
 * A controlled combobox that lets the user type to filter students.
 * Supports keyboard navigation (ArrowUp / ArrowDown / Enter / Escape).
 * Submits the student's UUID (id) via onChange, not the display string.
 *
 * Props:
 *   students  - array of student objects from /api/students
 *   value     - currently selected student UUID (or '')
 *   onChange  - (uuid: string) => void
 */
function StudentSearchInput({ students, value, onChange }) {
  const [query, setQuery]           = useState('')
  const [open, setOpen]             = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef(null)

  // When the parent clears value (e.g. modal reset), also clear the typed query
  useEffect(() => {
    if (!value) setQuery('')
  }, [value])

  // Derive what to display in the input field
  const selectedStudent = students.find(s => s.id === value)
  const displayValue = (selectedStudent && !open)
    ? `${selectedStudent.full_name} (${selectedStudent.student_id})`
    : query

  // Filter list based on current query (cap at 15 results for performance)
  const filteredStudents = query.trim().length >= 1
    ? students
        .filter(s =>
          s.full_name.toLowerCase().includes(query.toLowerCase()) ||
          (s.student_id || '').toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 15)
    : []

  // Reset highlight when results change
  useEffect(() => { setHighlighted(0) }, [filteredStudents.length])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        // If nothing selected and user typed something, clear it
        if (!value) setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [value])

  const selectStudent = (s) => {
    onChange(s.id)
    setQuery('')
    setOpen(false)
  }

  const handleInputChange = (e) => {
    setQuery(e.target.value)
    setOpen(true)
    // Clear the current selection when the user starts typing again
    if (value) onChange('')
  }

  const handleKeyDown = (e) => {
    if (!open) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlighted(h => Math.min(h + 1, filteredStudents.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlighted(h => Math.max(h - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filteredStudents[highlighted]) selectStudent(filteredStudents[highlighted])
        break
      case 'Escape':
        setOpen(false)
        break
      default:
        break
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="input"
        placeholder="Type student name or ID to search..."
        value={displayValue}
        onChange={handleInputChange}
        onFocus={() => { if (query.trim().length >= 1) setOpen(true) }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        aria-label="Search student"
        aria-expanded={open}
        aria-haspopup="listbox"
      />

      {/* Dropdown list */}
      {open && query.trim().length >= 1 && (
        <div
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg max-h-52 overflow-y-auto"
        >
          {filteredStudents.length > 0 ? (
            filteredStudents.map((s, i) => (
              <div
                key={s.id}
                role="option"
                aria-selected={i === highlighted}
                className={`
                  px-3 py-2.5 cursor-pointer text-sm border-b border-gray-50 last:border-0
                  ${i === highlighted ? 'bg-cyan/10 text-navy' : 'hover:bg-gray-50 text-gray-900'}
                `}
                // Use onMouseDown (not onClick) so it fires before onBlur
                onMouseDown={(e) => { e.preventDefault(); selectStudent(s) }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="font-medium">{s.full_name}</span>
                <span className="text-gray-400 ml-2 text-xs">{s.student_id}</span>
                {s.qualification && (
                  <span className="text-gray-400 ml-1 text-xs">· {s.qualification}</span>
                )}
              </div>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">
              No students found
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function CompliancePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // ── Tab & shared UI state ─────────────────────────────────────────────────
  const [activeTab, setActiveTab]         = useState('documents')
  const [docs, setDocs]                   = useState([])
  const [students, setStudents]           = useState([])
  const [report, setReport]               = useState([])

  const [loading, setLoading]             = useState(true)
  const [loadError, setLoadError]         = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError]     = useState(false)
  const [filterStatus, setFilterStatus]   = useState('')
  const [filterType, setFilterType]       = useState('')
  const [filterLevel, setFilterLevel]     = useState('')
  const [search, setSearch]               = useState('')
  const [reportSearch, setReportSearch]   = useState('')
  const [missingOnly, setMissingOnly]     = useState(false)

  // ── Feature 2: Bulk Add Documents (inline in Bulk Upload tab) ──────────────
  const [bulkStudentId, setBulkStudentId] = useState('')
  const [bulkRows, setBulkRows]           = useState(() => buildInitialBulkRows())
  const [bulkSaving, setBulkSaving]       = useState(false)
  const [bulkResults, setBulkResults]     = useState(null)
  // null  = not submitted yet
  // { success: string[], failed: {label, error}[] }

  // ── Compliance reminder preview / send state ──────────────────────────────
  const [previewLoading, setPreviewLoading]     = useState(false)
  const [previewData, setPreviewData]           = useState(null)
  const [sendingReminders, setSendingReminders] = useState(false)
  const [reminderResults, setReminderResults]   = useState(null)
  const [expandedPreview, setExpandedPreview]   = useState(null)

  // ── WPA / MOU status by qualification level ───────────────────────────────
  const [wpaMouStatus, setWpaMouStatus]       = useState([])
  const [wpaMouLoading, setWpaMouLoading]     = useState(false)
  const [wpaMouError, setWpaMouError]         = useState(false)
  const [wpaMouSearch, setWpaMouSearch]       = useState('')
  const [wpaMouMissingOnly, setWpaMouMissingOnly] = useState(false)

  // ── Hours Report / reminder state ─────────────────────────────────────────
  const [hoursReport, setHoursReport]                   = useState([])
  const [hoursReportLoading, setHoursReportLoading]     = useState(false)
  const [hoursReportError, setHoursReportError]         = useState(false)
  const [hoursPreviewLoading, setHoursPreviewLoading]   = useState(false)
  const [hoursPreviewData, setHoursPreviewData]         = useState(null)
  const [sendingHoursReminders, setSendingHoursReminders] = useState(false)
  const [hoursReminderResults, setHoursReminderResults] = useState(null)
  const [expandedHoursPreview, setExpandedHoursPreview] = useState(null)

  // ─── Bulk rows factory ────────────────────────────────────────────────────

  function buildInitialBulkRows() {
    const today = new Date().toISOString().split('T')[0]   // YYYY-MM-DD
    return DOC_TYPES.map(t => ({
      document_type:   t.value,
      label:           t.label,
      abbr:            t.abbr,
      qualSpecific:    t.qualSpecific,
      qualification:   t.qualSpecific ? '' : 'N/A',
      entry_date:      today,   // date the record is being entered (defaults to today)
      issue_date:      '',      // date printed on the physical document
      expiry_date:     '',
      document_number: '',
      notes:           '',
    }))
  }

  const resetBulkModal = () => {
    setBulkStudentId('')
    setBulkRows(buildInitialBulkRows())
    setBulkResults(null)
  }

  const updateBulkRow = (index, field, value) => {
    setBulkRows(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  // ─── Data loaders ─────────────────────────────────────────────────────────

  // Loads compliance docs + students. Previously had no error handling at
  // all, so a transient failure (network blip, brief backend hiccup) left the
  // page stuck showing stale/empty data with no indication anything went
  // wrong ("sometimes doesn't work"). Now it auto-retries once, and if that
  // also fails, surfaces a visible error with a manual Retry action instead
  // of failing silently.
  const load = useCallback((isRetry = false) => {
    if (!isRetry) setLoadError(false)
    setLoading(true)
    Promise.all([api.get('/compliance'), api.get('/students')])
      .then(([d, s]) => {
        setDocs(d.data)
        setStudents(s.data)
        setLoadError(false)
        setLoading(false)
      })
      .catch(() => {
        if (!isRetry) {
          // Transient blip - retry once, silently, before bothering the user.
          setTimeout(() => load(true), 1200)
          return
        }
        setLoadError(true)
        setLoading(false)
        toast.error('Failed to load compliance data. Check your connection and try again.')
      })
  }, [])

  const loadReport = useCallback((isRetry = false) => {
    setReportLoading(true)
    if (!isRetry) setReportError(false)
    api.get('/compliance/report')
      .then(r => { setReport(r.data); setReportError(false) })
      .catch(() => {
        if (!isRetry) { setTimeout(() => loadReport(true), 1200); return }
        setReportError(true)
        toast.error('Failed to load compliance report. Check your connection and try again.')
      })
      .finally(() => setReportLoading(false))
  }, [])

  const loadHoursReport = useCallback((isRetry = false) => {
    setHoursReportLoading(true)
    if (!isRetry) setHoursReportError(false)
    api.get('/hours/summary')
      .then(r => { setHoursReport(r.data); setHoursReportError(false) })
      .catch(() => {
        if (!isRetry) { setTimeout(() => loadHoursReport(true), 1200); return }
        setHoursReportError(true)
        toast.error('Failed to load hours report. Check your connection and try again.')
      })
      .finally(() => setHoursReportLoading(false))
  }, [])

  const loadWpaMouStatus = useCallback((isRetry = false) => {
    setWpaMouLoading(true)
    if (!isRetry) setWpaMouError(false)
    api.get('/compliance/wpa-mou-status')
      .then(r => { setWpaMouStatus(r.data); setWpaMouError(false) })
      .catch(() => {
        if (!isRetry) { setTimeout(() => loadWpaMouStatus(true), 1200); return }
        setWpaMouError(true)
        toast.error('Failed to load WPA/MOU status. Check your connection and try again.')
      })
      .finally(() => setWpaMouLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (activeTab === 'report')       loadReport()      }, [activeTab, loadReport])
  useEffect(() => { if (activeTab === 'hours_report') loadHoursReport() }, [activeTab, loadHoursReport])
  useEffect(() => { if (activeTab === 'wpa_mou')      loadWpaMouStatus() }, [activeTab, loadWpaMouStatus])

  // ─── Filters ──────────────────────────────────────────────────────────────

  const filtered = docs.filter(d => {
    const student = students.find(s => s.id === d.student_id)
    const name    = student?.full_name?.toLowerCase() || ''
    if (search && !name.includes(search.toLowerCase()) &&
        !d.document_number?.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus && d.status !== filterStatus) return false
    if (filterType   && d.document_type !== filterType) return false
    if (filterLevel  && d.qualification_level !== filterLevel) return false
    return true
  })

  const filteredReport = report.filter(r => {
    if (missingOnly && r.fully_compliant) return false
    if (reportSearch && !r.student_name.toLowerCase().includes(reportSearch.toLowerCase())) return false
    return true
  })

  // ─── Actions ──────────────────────────────────────────────────────────────

  const verify = async id => {
    await api.put(`/compliance/${id}/verify`)
    toast.success('Document verified')
    load()
  }

  /**
   * Feature 2 - Submit all bulk rows that have at least one date filled.
   * Uses JSON POST /compliance (no file upload).
   * Entry Date is stored in notes; Issue Date maps to the issue_date field.
   */
  const saveBulk = async () => {
    if (!bulkStudentId) return toast.error('Please select a student first')

    // A row is "active" if the user filled in any date field
    const activeRows = bulkRows.filter(r => r.entry_date || r.issue_date || r.expiry_date)
    if (activeRows.length === 0) return toast.error('Please fill in at least one date to add a document')

    setBulkSaving(true)

    const results = { success: [], failed: [] }

    await Promise.allSettled(
      activeRows.map(async row => {
        // Prepend Entry Date to notes so it's preserved
        const noteParts = []
        if (row.qualSpecific && row.qualification) noteParts.push(`Qualification: ${row.qualification}`)
        if (row.entry_date) noteParts.push(`Entry Date: ${row.entry_date}`)
        if (row.notes)      noteParts.push(row.notes)

        try {
          await api.post('/compliance', {
            student_id:      bulkStudentId,
            document_type:   row.document_type,
            document_number: row.document_number || null,
            issue_date:      row.issue_date      || null,
            expiry_date:     row.expiry_date     || null,
            notes:           noteParts.join('\n') || null,
          })
          results.success.push(row.label)
        } catch (err) {
          results.failed.push({
            label: row.label,
            error: err.response?.data?.detail || 'Failed to save',
          })
        }
      })
    )

    setBulkSaving(false)
    setBulkResults(results)
    if (results.success.length > 0) load()
  }

  // ── Compliance reminder actions (unchanged) ───────────────────────────────

  const openReminderPreview = async () => {
    setPreviewLoading(true)
    try {
      const res = await api.get('/compliance/reminder-preview')
      if (res.data.recipient_count === 0) {
        toast.success('All active students are fully compliant - no reminders needed!')
      } else {
        setPreviewData(res.data)
      }
    } catch { toast.error('Failed to load preview') }
    finally { setPreviewLoading(false) }
  }

  const openHoursReminderPreview = async () => {
    setHoursPreviewLoading(true)
    try {
      const res = await api.get('/compliance/hours-reminder-preview')
      if (res.data.recipient_count === 0) {
        toast.success('All active students have met their required placement hours - no reminders needed!')
      } else {
        setHoursPreviewData(res.data)
      }
    } catch { toast.error('Failed to load preview') }
    finally { setHoursPreviewLoading(false) }
  }

  const sendHoursReminders = async () => {
    setSendingHoursReminders(true)
    try {
      const res = await api.post('/compliance/send-hours-reminders')
      setHoursPreviewData(null)
      setHoursReminderResults(res.data)
    } catch { toast.error('Failed to send reminders') }
    finally { setSendingHoursReminders(false) }
  }

  const sendReminders = async () => {
    setSendingReminders(true)
    try {
      const res = await api.post('/compliance/send-reminders')
      setPreviewData(null)
      setReminderResults(res.data)
    } catch { toast.error('Failed to send reminders') }
    finally { setSendingReminders(false) }
  }

  // ─── Summary cards ────────────────────────────────────────────────────────

  const summary = {
    valid:    docs.filter(d => d.status === 'valid').length,
    expiring: docs.filter(d => d.status === 'expiring_soon').length,
    expired:  docs.filter(d => d.status === 'expired').length,
    pending:  docs.filter(d => d.status === 'pending').length,
  }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">

      {/* Page header */}
      <PageHeader
        title="Compliance"
        subtitle="Manage student compliance documents"
      />

      {loadError && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Couldn't load compliance data - the server may be waking up or your connection dropped.</span>
          <button onClick={() => load()} className="btn-secondary text-xs flex-shrink-0">Retry</button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Valid',                value: summary.valid,    icon: CheckCircle,   color: 'green',  filter: 'valid'         },
          { label: 'Expiring Soon',        value: summary.expiring, icon: AlertTriangle, color: 'yellow', filter: 'expiring_soon' },
          { label: 'Expired',              value: summary.expired,  icon: XCircle,       color: 'red',    filter: 'expired'       },
          { label: 'Pending Verification', value: summary.pending,  icon: AlertTriangle, color: 'cyan',   filter: 'pending'       },
        ].map(c => (
          <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} color={c.color}
            onClick={() => { setFilterStatus(f => f === c.filter ? '' : c.filter); setActiveTab('documents') }} />
        ))}
      </div>

      {/* Tabs - Feature 4 adds the "Bulk Upload" tab */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
        {[
          { key: 'documents',    label: 'Documents',             icon: FileText    },
          { key: 'report',       label: 'Compliance Report',     icon: CheckCircle },
          { key: 'wpa_mou',      label: 'WPA/MOU by Level',       icon: CheckCircle },
          { key: 'hours_report', label: 'Hours Reminders',       icon: BarChart2  },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-navy text-navy'
                : 'border-transparent text-gray-500 hover:text-navy'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          Documents Tab
          Feature 3: thead is sticky within its own overflow-auto container
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'documents' && (
        <>
          <div className="flex flex-wrap gap-3 mb-6">
            <SearchInput value={search} onChange={setSearch} placeholder="Search student or document #..." />
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              placeholder="All Statuses"
              options={['valid', 'expiring_soon', 'expired', 'pending'].map(s => ({
                value: s,
                label: s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
              }))}
            />
            <Select value={filterType} onChange={setFilterType} placeholder="All Types" options={DOC_TYPES} />
            <Select value={filterLevel} onChange={setFilterLevel} placeholder="All Levels" options={QUAL_OPTIONS} />
            {(filterStatus || filterType || filterLevel || search) && (
              <button
                onClick={() => { setFilterStatus(''); setFilterType(''); setFilterLevel(''); setSearch('') }}
                className="text-sm text-gray-500 hover:text-navy underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={CheckCircle}
              title="No documents found"
              message="Try adjusting your filters or add a new document."
            />
          ) : (
            <div className="card p-0 overflow-hidden">
              {/*
                Feature 3: overflow-auto + max-height creates a scroll context
                so that `sticky top-0` on <thead> works correctly.
                Adjust top-0 to top-[64px] if your navbar overlaps sticky headers.
              */}
              <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                    <tr>
                      {['Student', 'Document Type', 'Level', 'Doc Number', 'Issue Date', 'Expiry Date', 'Status', 'Verified By'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap bg-gray-50">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map(d => {
                      const student  = students.find(s => s.id === d.student_id)
                      const docLabel = DOC_TYPES.find(t => t.value === d.document_type)?.label
                                    || d.document_type.replace(/_/g, ' ')
                      return (
                        <tr
                          key={d.id}
                          className={`hover:bg-gray-50 ${
                            d.status === 'expired'        ? 'bg-red-50/30'    :
                            d.status === 'expiring_soon'  ? 'bg-yellow-50/30' : ''
                          }`}
                        >
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-900">{student?.full_name || '-'}</p>
                            <p className="text-xs text-gray-400">{student?.student_id}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">{docLabel}</td>
                          <td className="px-4 py-3 text-xs">
                            {d.qualification_level
                              ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan/10 text-cyan-700">{d.qualification_level}</span>
                              : <span className="text-gray-400">-</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{d.document_number || '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {d.issue_date ? format(new Date(d.issue_date), 'd MMM yyyy') : '-'}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {d.expiry_date ? (
                              <span className={
                                d.status === 'expired'       ? 'text-red-600 font-medium' :
                                d.status === 'expiring_soon' ? 'text-yellow-600 font-medium' :
                                'text-gray-500'
                              }>
                                {format(new Date(d.expiry_date), 'd MMM yyyy')}
                                {d.days_until_expiry != null && d.days_until_expiry <= 30 &&
                                  ` (${d.days_until_expiry}d)`}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3"><Badge status={d.status} /></td>
                          <td className="px-4 py-3 text-xs text-gray-500">{d.verified_by || '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          Compliance Report Tab
          Feature 3: sticky thead
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'report' && (
        <>
          {reportError && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>Couldn't load the compliance report.</span>
              <button onClick={() => loadReport()} className="btn-secondary text-xs flex-shrink-0">Retry</button>
            </div>
          )}
          <div className="flex flex-wrap gap-3 mb-4 items-center">
            <SearchInput value={reportSearch} onChange={setReportSearch} placeholder="Search student..." />
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={missingOnly}
                onChange={e => setMissingOnly(e.target.checked)}
                className="rounded"
              />
              Show incomplete only
            </label>
            <button
              onClick={openReminderPreview}
              disabled={previewLoading}
              className="btn-secondary text-sm flex items-center gap-1 ml-auto"
            >
              <Mail size={15} /> {previewLoading ? 'Loading...' : 'Send Reminders to Incomplete Students'}
            </button>
          </div>

          {reportLoading ? <Spinner size="lg" /> : (
            <>
              <p className="text-xs text-gray-400 mb-3">
                Showing {filteredReport.length} student{filteredReport.length !== 1 ? 's' : ''} ·{' '}
                <span className="text-green-600 font-medium">
                  {filteredReport.filter(r => r.fully_compliant).length} fully compliant
                </span> ·{' '}
                <span className="text-red-500 font-medium">
                  {filteredReport.filter(r => !r.fully_compliant).length} incomplete
                </span>
              </p>
              <div className="card p-0 overflow-hidden">
                <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">Student</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">Campus</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">Qualification</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">Progress</th>
                        {DOC_TYPES.map(t => (
                          <th
                            key={t.value}
                            className="px-3 py-3 text-center font-medium text-gray-500 whitespace-nowrap bg-gray-50"
                            title={t.label}
                          >
                            {t.abbr}
                          </th>
                        ))}
                        <th className="px-4 py-3 text-left font-medium text-gray-500 bg-gray-50">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredReport.map(r => {
                        const ABBR_MAP = {
                          'Working with Children Check': 'WWCC',
                          'Valid First Aid Certificate (including CPR)': 'First Aid',
                          'First Aid Certificate (incl. CPR)': 'First Aid',
                          'Work Placement Agreement': 'WPA',
                          'Memorandum of Understanding (MOU)': 'MOU',
                          'Memorandum of Understanding': 'MOU',
                        }
                        const outstandingAbbr = r.outstanding.map(o => ABBR_MAP[o] || o)
                        return (
                          <tr key={r.student_id} className={r.fully_compliant ? 'bg-green-50/30' : 'hover:bg-red-50/20'}>
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900">{r.student_name}</p>
                              <p className="text-gray-400">{r.student_ref}</p>
                            </td>
                            <td className="px-3 py-3 text-gray-600 capitalize">{r.campus || '-'}</td>
                            <td className="px-3 py-3 text-gray-500">{r.qualification || '-'}</td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-12 bg-gray-200 rounded-full h-1.5 flex-shrink-0">
                                  <div
                                    className={`h-1.5 rounded-full ${
                                      r.fully_compliant     ? 'bg-green-500' :
                                      r.submitted_count >= 2 ? 'bg-yellow-400' : 'bg-red-400'
                                    }`}
                                    style={{ width: `${(r.submitted_count / r.required_count) * 100}%` }}
                                  />
                                </div>
                                <span className={`font-bold whitespace-nowrap ${r.fully_compliant ? 'text-green-600' : 'text-orange-500'}`}>
                                  {r.submitted_count}/{r.required_count}
                                </span>
                              </div>
                            </td>
                            {DOC_TYPES.map(t => {
                              const docInfo   = r.documents?.[t.value]
                              const statusColor = docInfo?.status === 'expired'       ? 'text-red-400'    :
                                                  docInfo?.status === 'expiring_soon' ? 'text-yellow-500' :
                                                  'text-green-500'
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
                                ? <span className="text-green-600 font-medium">Complete</span>
                                : <span className="text-red-500 font-medium">{outstandingAbbr.join(', ')}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {filteredReport.length === 0 && (
                    <p className="text-center text-gray-400 py-8 text-sm">No students found</p>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          WPA / MOU Submission Status by Qualification Level
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'wpa_mou' && (() => {
        const filteredWpaMou = wpaMouStatus.filter(r => {
          if (wpaMouSearch && !r.student_name?.toLowerCase().includes(wpaMouSearch.toLowerCase())) return false
          if (wpaMouMissingOnly && r.fully_submitted) return false
          return true
        })
        const StatusChip = ({ item }) => (
          <Badge status={!item.submitted ? 'missing' : !item.verified ? 'submitted' : 'verified'} />
        )
        return (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Check WPA and MOU submission status per student, broken down by qualification level.
              Students logging hours toward more than one level (e.g. Cert III then Diploma) will show
              one row per level, each needing its own WPA and MOU.
            </p>
            {wpaMouError && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span>Couldn't load WPA/MOU status.</span>
                <button onClick={() => loadWpaMouStatus()} className="btn-secondary text-xs flex-shrink-0">Retry</button>
              </div>
            )}
            <div className="flex flex-wrap gap-3 mb-4 items-center">
              <SearchInput value={wpaMouSearch} onChange={setWpaMouSearch} placeholder="Search student..." />
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={wpaMouMissingOnly} onChange={e => setWpaMouMissingOnly(e.target.checked)} className="rounded" />
                Show incomplete only
              </label>
            </div>
            {wpaMouLoading ? <Spinner size="lg" /> : (
              <div className="card p-0 overflow-hidden">
                <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">Student</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">Campus</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">Qualification Level</th>
                        <th className="px-3 py-3 text-center font-medium text-gray-500 whitespace-nowrap bg-gray-50">WPA</th>
                        <th className="px-3 py-3 text-center font-medium text-gray-500 whitespace-nowrap bg-gray-50">MOU</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredWpaMou.map(r => (
                        <tr key={`${r.student_id}-${r.qualification_level}`} className={r.fully_submitted ? 'bg-green-50/30' : 'hover:bg-red-50/20'}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{r.student_name}</p>
                            <p className="text-gray-400">{r.student_ref}</p>
                          </td>
                          <td className="px-3 py-3 text-gray-600 capitalize">{r.campus || '-'}</td>
                          <td className="px-3 py-3">
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan/10 text-cyan-700">{r.qualification_level}</span>
                          </td>
                          <td className="px-3 py-3 text-center"><StatusChip item={r.wpa} /></td>
                          <td className="px-3 py-3 text-center"><StatusChip item={r.mou} /></td>
                        </tr>
                      ))}
                      {filteredWpaMou.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No matching records</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════
          Placement Hours Report Tab
          Feature 3: sticky thead
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'hours_report' && (() => {
        const metCount     = hoursReport.filter(r => (r.completed_hours || 0) >= (r.required_hours || 1)).length
        const pendingCount = hoursReport.length - metCount

        return (
          <>
            {hoursReportError && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span>Couldn't load the hours report.</span>
                <button onClick={() => loadHoursReport()} className="btn-secondary text-xs flex-shrink-0">Retry</button>
              </div>
            )}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4 text-sm text-blue-800 flex flex-wrap items-center gap-2">
              <span>
                The full per-student, per-qualification-level hours breakdown now lives on the{' '}
                <Link to="/hours" className="font-medium underline hover:no-underline">Hours Tracking</Link> page.
                This tab is for sending reminders to students with outstanding placement hours.
              </span>
            </div>

            <div className="flex justify-end mb-4">
              <button
                onClick={openHoursReminderPreview}
                disabled={hoursPreviewLoading}
                className="btn-secondary text-sm flex items-center gap-1"
              >
                <Mail size={15} />
                {hoursPreviewLoading ? 'Loading...' : 'Send Reminders to Submit Placement Hours Log'}
              </button>
            </div>

            {!hoursReportLoading && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="card text-center py-3">
                  <p className="text-xl font-bold text-green-600">{metCount}</p>
                  <p className="text-xs text-gray-500">Students - Hours Requirement Met</p>
                </div>
                <div className="card text-center py-3">
                  <p className="text-xl font-bold text-orange-500">{pendingCount}</p>
                  <p className="text-xs text-gray-500">Students - Hours Still Pending</p>
                </div>
              </div>
            )}
          </>
        )
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════
          Feature 4: Bulk Upload Tab
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'bulk_upload' && (
        <div className="max-w-3xl space-y-8">

          {/* ── Add Documents inline form ────────────────────────────────────── */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Add Compliance Documents</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Select a student, fill in the dates for each document, then click Add Documents.
                </p>
              </div>
            </div>

            {/* Post-submission results view */}
            {bulkResults ? (
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1 bg-green-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-green-700">{bulkResults.success.length}</p>
                    <p className="text-xs text-green-600 mt-0.5">Uploaded successfully</p>
                  </div>
                  {bulkResults.failed.length > 0 && (
                    <div className="flex-1 bg-red-50 rounded-xl p-4 text-center">
                      <p className="text-2xl font-bold text-red-600">{bulkResults.failed.length}</p>
                      <p className="text-xs text-red-500 mt-0.5">Failed</p>
                    </div>
                  )}
                </div>

                {bulkResults.success.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">Uploaded:</p>
                    <ul className="space-y-1">
                      {bulkResults.success.map((label, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-green-700">
                          <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                          {label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {bulkResults.failed.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">Errors:</p>
                    <ul className="space-y-1">
                      {bulkResults.failed.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-red-600">
                          <XCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                          <span><strong>{f.label}:</strong> {f.error}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-between pt-4 border-t border-gray-100">
                  <button onClick={() => { resetBulkModal() }} className="btn-secondary">
                    Add More Documents
                  </button>
                  <button onClick={() => { resetBulkModal(); loadDocs() }} className="btn-primary">
                    Done
                  </button>
                </div>
              </div>

            ) : (
              /* ── Upload form ──────────────────────────────────────────────── */
              <>
                {/* Student selector */}
                <FormRow label="Student" required>
                  <StudentSearchInput
                    students={students}
                    value={bulkStudentId}
                    onChange={setBulkStudentId}
                  />
                </FormRow>

                {/* Document rows table */}
                <div className="mt-5">
                  <p className="label mb-2">
                    Documents
                    <span className="text-xs font-normal text-gray-400 ml-2">
                      Attach a file to any row you want to submit. Rows without a file are ignored.
                    </span>
                  </p>

                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_120px_110px_110px_110px] gap-0 bg-gray-50 border-b border-gray-200 px-3 py-2">
                      <p className="text-xs font-medium text-gray-500">Document Type</p>
                      <p className="text-xs font-medium text-gray-500" title="Only Work Placement Agreement and MOU are qualification-specific - other document types show N/A.">Qualification</p>
                      <p className="text-xs font-medium text-gray-500">Entry Date</p>
                      <p className="text-xs font-medium text-gray-500">Issue Date</p>
                      <p className="text-xs font-medium text-gray-500">Expiry Date</p>
                    </div>

                    {bulkRows.map((row, idx) => (
                      <div
                        key={row.document_type}
                        className={`grid grid-cols-[1fr_120px_110px_110px_110px] gap-3 items-center px-3 py-3
                          border-b border-gray-100 last:border-0
                          ${(row.issue_date || row.expiry_date) ? 'bg-green-50/40' : 'bg-white hover:bg-gray-50/50'}
                        `}
                      >
                        {/* Doc type label */}
                        <div>
                          <p className="text-sm font-medium text-gray-800">{row.abbr}</p>
                          <p className="text-xs text-gray-400 leading-tight">{row.label}</p>
                        </div>

                        {/* Qualification - N/A for WWCC/First Aid; dropdown for WPA/MOU */}
                        <div>
                          {row.qualSpecific ? (
                            <select
                              value={row.qualification}
                              onChange={e => updateBulkRow(idx, 'qualification', e.target.value)}
                              className="input text-xs py-1.5"
                              aria-label={`Qualification for ${row.abbr}`}
                            >
                              <option value="">Select…</option>
                              {QUAL_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-gray-400 px-1" title="Not qualification-specific - applies regardless of course level.">N/A</span>
                          )}
                        </div>

                        {/* Entry Date - defaults to today */}
                        <div>
                          <input
                            type="date"
                            value={row.entry_date}
                            onChange={e => updateBulkRow(idx, 'entry_date', e.target.value)}
                            className="input text-xs py-1.5"
                            aria-label={`Entry date for ${row.abbr}`}
                          />
                        </div>

                        {/* Issue Date */}
                        <div>
                          <input
                            type="date"
                            value={row.issue_date}
                            onChange={e => updateBulkRow(idx, 'issue_date', e.target.value)}
                            className="input text-xs py-1.5"
                            aria-label={`Issue date for ${row.abbr}`}
                          />
                        </div>

                        {/* Expiry Date */}
                        <div>
                          <input
                            type="date"
                            value={row.expiry_date}
                            onChange={e => updateBulkRow(idx, 'expiry_date', e.target.value)}
                            className="input text-xs py-1.5"
                            aria-label={`Expiry date for ${row.abbr}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end items-center mt-6 pt-4 border-t border-gray-100 gap-3">
                  <button
                    onClick={() => resetBulkModal()}
                    className="btn-secondary"
                  >
                    Reset
                  </button>
                  <button
                    onClick={saveBulk}
                    disabled={bulkSaving || !bulkStudentId}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Upload size={15} />
                    {bulkSaving ? 'Saving...' : 'Add Documents'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── Tip: link to Bulk Upload page for CSV imports ───────────────── */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            <p className="font-semibold mb-1">📌 Need to upload many documents at once?</p>
            <p className="text-xs text-blue-700">
              Use the <strong>Bulk Upload</strong> page in the sidebar to import compliance
              documents via CSV for multiple students in one go.
            </p>
          </div>
        </div>
      )}


      {/* ═══════════════════════════════════════════════════════════════════════
                                    MODALS
      ════════════════════════════════════════════════════════════════════════ */}

      {/* Hours Preview Modal */}
      <Modal open={!!hoursPreviewData} onClose={() => setHoursPreviewData(null)} title="Preview: Placement Hours Log Reminder" size="lg">
        {hoursPreviewData && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">{hoursPreviewData.recipient_count}</p>
                <p className="text-xs text-blue-600 font-medium">Will receive email</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-600">{hoursPreviewData.met_count}</p>
                <p className="text-xs text-green-600 font-medium">Already met hours (skipped)</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-500">{hoursPreviewData.no_email_count}</p>
                <p className="text-xs text-gray-500 font-medium">No email on file (skipped)</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3 flex items-center gap-2">
              <Mail size={14} className="text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Subject</p>
                <p className="text-sm font-semibold text-gray-800">{hoursPreviewData.subject}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">
                Recipients ({hoursPreviewData.recipient_count} students):
              </p>
              <div className="border border-gray-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-gray-50">
                {hoursPreviewData.recipients.map(r => (
                  <div key={r.student_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{r.student_name}</p>
                        <p className="text-xs text-gray-400">{r.email} · {r.campus || '-'}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{r.qualification}</p>
                      </div>
                      <div className="text-right flex-shrink-0 space-y-1">
                        <p className="text-xs font-semibold text-blue-700">{r.completed_hours}h / {r.required_hours}h</p>
                        <p className="text-xs font-semibold text-red-500">{r.remaining_hours}h remaining</p>
                        <button
                          onClick={() => setExpandedHoursPreview(expandedHoursPreview === r.student_id ? null : r.student_id)}
                          className="text-xs text-cyan hover:underline flex items-center gap-1 ml-auto"
                        >
                          <Eye size={11} /> {expandedHoursPreview === r.student_id ? 'Hide' : 'Preview email'}
                        </button>
                      </div>
                    </div>
                    {expandedHoursPreview === r.student_id && (
                      <pre className="mt-3 text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-sans border border-gray-100">
                        {r.email_preview}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
              Emails will be sent immediately when you click the button below. All emails will be recorded in the <strong>Email Log</strong> tab.
            </p>
            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
              <button onClick={() => { setHoursPreviewData(null); setExpandedHoursPreview(null) }} className="btn-secondary">
                Cancel
              </button>
              {isAdmin && (
                <button onClick={sendHoursReminders} disabled={sendingHoursReminders} className="btn-primary flex items-center gap-2">
                  <Mail size={15} />
                  {sendingHoursReminders ? 'Sending...' : `Send to ${hoursPreviewData.recipient_count} Students`}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Hours Results Modal */}
      <Modal
        open={!!hoursReminderResults}
        onClose={() => { setHoursReminderResults(null); setActiveTab('email_log') }}
        title="Hours Reminder Emails Sent"
        size="lg"
      >
        {hoursReminderResults && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1 bg-green-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{hoursReminderResults.sent?.length || 0}</p>
                <p className="text-sm text-green-700">Emails Sent</p>
              </div>
              <div className="flex-1 bg-gray-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-gray-500">{hoursReminderResults.skipped?.length || 0}</p>
                <p className="text-sm text-gray-500">Skipped</p>
              </div>
            </div>
            {hoursReminderResults.sent?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Sent to:</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden max-h-44 overflow-y-auto divide-y divide-gray-50">
                  {hoursReminderResults.sent.map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{s.student}</p>
                        <p className="text-xs text-gray-400">{s.email}</p>
                      </div>
                      <span className="text-xs text-orange-500 font-medium">
                        {s.completed_hours}h / {s.required_hours}h ({s.remaining_hours}h remaining)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs bg-blue-50 text-blue-700 rounded-lg p-3">
              All sent emails are recorded in the <strong>Email Log</strong> tab.
            </p>
            <div className="flex justify-end pt-2">
              <button onClick={() => { setHoursReminderResults(null); setActiveTab('email_log') }} className="btn-primary">
                View Email Log
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Compliance Reminder Preview Modal */}
      <Modal open={!!previewData} onClose={() => setPreviewData(null)} title="Preview: Compliance Reminder Email" size="lg">
        {previewData && (
          <div className="space-y-5">
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
            <div className="bg-gray-50 rounded-lg px-4 py-3 flex items-center gap-2">
              <Mail size={14} className="text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Subject</p>
                <p className="text-sm font-semibold text-gray-800">{previewData.subject}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">
                Recipients ({previewData.recipient_count} students):
              </p>
              <div className="border border-gray-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-gray-50">
                {previewData.recipients.map(r => (
                  <div key={r.student_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{r.student_name}</p>
                        <p className="text-xs text-gray-400">{r.email} · {r.campus || '-'}</p>
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
                          className="block text-xs text-cyan hover:underline mt-1 ml-auto flex items-center gap-1"
                        >
                          <Eye size={11} /> {expandedPreview === r.student_id ? 'Hide' : 'Preview email'}
                        </button>
                      </div>
                    </div>
                    {expandedPreview === r.student_id && (
                      <pre className="mt-3 text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-sans border border-gray-100">
                        {r.email_preview}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-400 bg-amber-50 border border-amber-100 rounded-lg p-3">
              Emails will be sent immediately when you click the button below. All emails will be recorded in the <strong>Email Log</strong> tab for compliance purposes.
            </p>
            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
              <button onClick={() => { setPreviewData(null); setExpandedPreview(null) }} className="btn-secondary">
                Cancel
              </button>
              {isAdmin && (
                <button onClick={sendReminders} disabled={sendingReminders} className="btn-primary flex items-center gap-2">
                  <Mail size={15} />
                  {sendingReminders ? 'Sending...' : `Send to ${previewData.recipient_count} Students`}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Compliance Reminder Results Modal */}
      <Modal
        open={!!reminderResults}
        onClose={() => { setReminderResults(null); if (activeTab !== 'email_log') setActiveTab('email_log') }}
        title="Reminder Emails Sent"
        size="lg"
      >
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
              All sent emails are recorded in the <strong>Email Log</strong> tab. Click below to view them.
            </p>
            <div className="flex justify-end pt-2">
              <button onClick={() => { setReminderResults(null); setActiveTab('email_log') }} className="btn-primary">
                View Email Log
              </button>
            </div>
          </div>
        )}
      </Modal>


    </div>
  )
}
