/**
 * CompliancePage — Compliance section of the ECEC Placement Portal
 *
 * Changes in this revision (all scoped to this file / compliance endpoints):
 *
 *  Feature 1 — Searchable student combobox in Add Document modal
 *    - StudentSearchInput component: real-time filter, keyboard nav (↑↓ Enter Esc),
 *      "No students found" fallback, submits correct student UUID.
 *
 *  Feature 2 — Bulk multi-document upload in Add Document modal
 *    - One row per DOC_TYPE; each row has its own file picker.
 *    - WPA and MOU rows include a Qualification dropdown (Certificate III / Diploma).
 *    - Only rows with a file selected are submitted (parallel uploads).
 *    - Qualification is prepended to the notes field before sending so no DB schema
 *      changes are required.
 *
 *  Feature 3 — Sticky column headers on all scrollable tables
 *    - Tables are wrapped in overflow-auto containers with max-height so they scroll
 *      independently of the page.
 *    - <thead> receives `sticky top-0 z-10` so headers remain visible during scroll.
 *    - Visual design of headers is unchanged; only scroll behaviour differs.
 *      NOTE: if your layout has a fixed top navbar, increase the `top-0` offset on
 *      <thead> (e.g. `top-[64px]`) to match the navbar height and prevent overlap.
 *
 *  Feature 4 — Bulk Upload via CSV tab
 *    - "Download CSV Template" generates a .csv client-side (no backend call needed).
 *    - CSV upload parses the file in the browser and shows a validated preview table.
 *    - Invalid rows are highlighted in red with a per-row error message.
 *    - Valid rows are submitted via the existing POST /api/compliance endpoint.
 *    - Summary result shown after submission.
 *
 * Assumptions / notes:
 *  - The `qualification` value for WPA/MOU is stored as a "Qualification: X" prefix
 *    in the `notes` field — no DB schema change required, fully backwards compatible.
 *  - CSV `student_id` column contains the student reference number (e.g. "STU001"),
 *    matched against the `student_id` field on the Student model (not the UUID).
 *  - CSV rows create metadata-only documents (no file attachment); files can be
 *    added later via the existing per-document upload endpoint.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  Upload, CheckCircle, AlertTriangle, XCircle, Mail,
  FileText, Clock, Eye, BarChart2, Download,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import {
  PageHeader, Spinner, Badge, Modal, FormRow, Select,
  SearchInput, EmptyState,
} from '../components/ui/index'
import { format } from 'date-fns'

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'working_with_children_check', label: 'Working with Children Check', abbr: 'WWCC',       qualSpecific: false },
  { value: 'first_aid_certificate',        label: 'First Aid Certificate (incl. CPR)', abbr: 'First Aid', qualSpecific: false },
  { value: 'work_placement_agreement',     label: 'Work Placement Agreement',          abbr: 'WPA',       qualSpecific: true  },
  { value: 'memorandum_of_understanding',  label: 'Memorandum of Understanding',       abbr: 'MOU',       qualSpecific: true  },
]

// Qualification options for WPA / MOU rows
const QUAL_OPTIONS = [
  { value: '',               label: 'Select qualification...' },
  { value: 'Certificate III', label: 'Certificate III' },
  { value: 'Diploma',         label: 'Diploma' },
]

// Valid document type values (used for CSV validation)
const VALID_DOC_TYPE_VALUES = DOC_TYPES.map(t => t.value)

// ─── CSV Helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a single CSV line, respecting double-quoted fields (RFC 4180).
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const result = []
  let current = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      // Escaped quote inside a quoted field: ""
      if (inQuote && line[i + 1] === '"') { current += '"'; i++ }
      else { inQuote = !inQuote }
    } else if (ch === ',' && !inQuote) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

/**
 * Parse full CSV text into an array of row objects keyed by the header row.
 * @param {string} text  Raw CSV string
 * @returns {object[]}   Each object has a `_rowNum` property (1-based, skipping header)
 */
function parseCsvText(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 1) return []
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values = parseCsvLine(line)
    const row = { _rowNum: i + 1 }
    headers.forEach((h, j) => { row[h] = values[j] ?? '' })
    rows.push(row)
  }
  return rows
}

/**
 * Validate a single parsed CSV row.
 * @param {object} row   Parsed row from parseCsvText
 * @param {object[]} students  Loaded student list for reference-number lookup
 * @returns {string[]}  Array of human-readable error strings (empty = valid)
 */
function validateCsvRow(row, students) {
  const errors = []

  // Required: student_id (reference number, not UUID)
  if (!row.student_id) {
    errors.push('student_id is required')
  } else if (!students.some(s => s.student_id === row.student_id)) {
    errors.push(`Student "${row.student_id}" not found in the system`)
  }

  // Required: document_type
  if (!row.document_type) {
    errors.push('document_type is required')
  } else if (!VALID_DOC_TYPE_VALUES.includes(row.document_type)) {
    errors.push(
      `Invalid document_type "${row.document_type}". ` +
      `Valid values: ${VALID_DOC_TYPE_VALUES.join(', ')}`
    )
  }

  // Optional: qualification — only validated if present
  if (row.qualification) {
    const q = row.qualification.toLowerCase().trim()
    if (!['cert iii', 'certificate iii', 'diploma'].includes(q)) {
      errors.push(`Invalid qualification "${row.qualification}". Use "Cert III" or "Diploma"`)
    }
  }

  // Optional: expiry_date — must be YYYY-MM-DD if provided
  if (row.expiry_date && row.expiry_date.trim() !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiry_date.trim())) {
      errors.push('expiry_date must be YYYY-MM-DD format (e.g. 2027-06-30)')
    }
  }

  return errors
}

// ─── Feature 1: Searchable Student Combobox ──────────────────────────────────

/**
 * StudentSearchInput
 *
 * A controlled combobox that lets the user type to filter students.
 * Supports keyboard navigation (ArrowUp / ArrowDown / Enter / Escape).
 * Submits the student's UUID (id) via onChange, not the display string.
 *
 * Props:
 *   students  — array of student objects from /api/students
 *   value     — currently selected student UUID (or '')
 *   onChange  — (uuid: string) => void
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

  // ── Tab & shared UI state ─────────────────────────────────────────────────
  const [activeTab, setActiveTab]         = useState('documents')
  const [docs, setDocs]                   = useState([])
  const [students, setStudents]           = useState([])
  const [report, setReport]               = useState([])
  const [emailLog, setEmailLog]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [reportLoading, setReportLoading] = useState(false)
  const [emailLogLoading, setEmailLogLoading] = useState(false)
  const [filterStatus, setFilterStatus]   = useState('')
  const [filterType, setFilterType]       = useState('')
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

  // ── Hours Report / reminder state ─────────────────────────────────────────
  const [hoursReport, setHoursReport]                   = useState([])
  const [hoursReportLoading, setHoursReportLoading]     = useState(false)
  const [hoursSearch, setHoursSearch]                   = useState('')
  const [hoursCampus, setHoursCampus]                   = useState('')
  const [hoursPreviewLoading, setHoursPreviewLoading]   = useState(false)
  const [hoursPreviewData, setHoursPreviewData]         = useState(null)
  const [sendingHoursReminders, setSendingHoursReminders] = useState(false)
  const [hoursReminderResults, setHoursReminderResults] = useState(null)
  const [expandedHoursPreview, setExpandedHoursPreview] = useState(null)

  // ── Feature 4: CSV Bulk Upload state ─────────────────────────────────────
  const [csvFile, setCsvFile]         = useState(null)
  const [csvPreview, setCsvPreview]   = useState(null)
  // null | { rows: [{...rowData, _errors:[]}], validCount, errorCount }
  const [csvParsing, setCsvParsing]   = useState(false)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResults, setCsvResults]   = useState(null)
  // null | { success: number, failed: number, failedDetails: [{rowNum, error}] }
  const csvInputRef = useRef(null)

  // ─── Bulk rows factory ────────────────────────────────────────────────────

  function buildInitialBulkRows() {
    return DOC_TYPES.map(t => ({
      document_type:   t.value,
      label:           t.label,
      abbr:            t.abbr,
      qualSpecific:    t.qualSpecific,
      qualification:   '',
      file:            null,
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

  const load = useCallback(() => {
    Promise.all([api.get('/compliance'), api.get('/students')]).then(([d, s]) => {
      setDocs(d.data)
      setStudents(s.data)
    }).finally(() => setLoading(false))
  }, [])

  const loadReport = useCallback(() => {
    setReportLoading(true)
    api.get('/compliance/report')
      .then(r => setReport(r.data))
      .finally(() => setReportLoading(false))
  }, [])

  const loadEmailLog = useCallback(() => {
    setEmailLogLoading(true)
    api.get('/communications').then(r => {
      const filtered = r.data.filter(c =>
        c.template_used === 'compliance_reminder_bulk' ||
        c.template_used === 'hours_log_reminder' ||
        c.subject?.toLowerCase().includes('compliance') ||
        c.subject?.toLowerCase().includes('outstanding') ||
        c.subject?.toLowerCase().includes('hours log')
      )
      setEmailLog(filtered)
    }).finally(() => setEmailLogLoading(false))
  }, [])

  const loadHoursReport = useCallback(() => {
    setHoursReportLoading(true)
    api.get('/hours/summary')
      .then(r => setHoursReport(r.data))
      .finally(() => setHoursReportLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (activeTab === 'report')       loadReport()      }, [activeTab, loadReport])
  useEffect(() => { if (activeTab === 'email_log')    loadEmailLog()    }, [activeTab, loadEmailLog])
  useEffect(() => { if (activeTab === 'hours_report') loadHoursReport() }, [activeTab, loadHoursReport])

  // ─── Filters ──────────────────────────────────────────────────────────────

  const filtered = docs.filter(d => {
    const student = students.find(s => s.id === d.student_id)
    const name    = student?.full_name?.toLowerCase() || ''
    if (search && !name.includes(search.toLowerCase()) &&
        !d.document_number?.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus && d.status !== filterStatus) return false
    if (filterType   && d.document_type !== filterType) return false
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
   * Feature 2 — Submit all bulk rows that have a file selected.
   * Each row is submitted as a separate POST /compliance/upload-with-doc call.
   * If a row has a qualification set, it is prepended to the notes field.
   */
  const saveBulk = async () => {
    if (!bulkStudentId) return toast.error('Please select a student first')

    const activeRows = bulkRows.filter(r => r.file !== null)
    if (activeRows.length === 0) return toast.error('Please attach at least one file to upload')

    setBulkSaving(true)

    const results = { success: [], failed: [] }

    // Run all uploads in parallel for speed
    await Promise.allSettled(
      activeRows.map(async row => {
        const fd = new FormData()
        fd.append('student_id',      bulkStudentId)
        fd.append('document_type',   row.document_type)
        fd.append('document_number', row.document_number || '')
        fd.append('expiry_date',     row.expiry_date || '')

        // Compose notes: qualification prefix (for WPA/MOU) + optional user notes
        const noteParts = []
        if (row.qualSpecific && row.qualification) {
          noteParts.push(`Qualification: ${row.qualification}`)
        }
        if (row.notes) noteParts.push(row.notes)
        fd.append('notes', noteParts.join('\n'))

        fd.append('file', row.file)

        try {
          await api.post('/compliance/upload-with-doc', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          results.success.push(row.label)
        } catch (err) {
          results.failed.push({
            label: row.label,
            error: err.response?.data?.detail || 'Upload failed',
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
        toast.success('All active students are fully compliant — no reminders needed!')
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
        toast.success('All active students have met their required placement hours — no reminders needed!')
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
      if (activeTab === 'email_log') loadEmailLog()
    } catch { toast.error('Failed to send reminders') }
    finally { setSendingHoursReminders(false) }
  }

  const sendReminders = async () => {
    setSendingReminders(true)
    try {
      const res = await api.post('/compliance/send-reminders')
      setPreviewData(null)
      setReminderResults(res.data)
      if (activeTab === 'email_log') loadEmailLog()
    } catch { toast.error('Failed to send reminders') }
    finally { setSendingReminders(false) }
  }

  // ── Feature 4: CSV helpers ─────────────────────────────────────────────────

  /**
   * Generate and trigger download of the CSV template file entirely client-side.
   * No backend call required; the template structure is static.
   */
  const downloadCsvTemplate = () => {
    const headers   = 'student_id,student_name,document_type,qualification,expiry_date,notes'
    const exampleRow = 'STU001,Jane Smith,working_with_children_check,,2027-06-30,WWCC card scanned'
    const notesRow  = `# Valid document_type values: ${VALID_DOC_TYPE_VALUES.join(' | ')}`
    const qualNote  = '# Valid qualification values: Cert III | Diploma (leave blank for WWCC / First Aid)'
    const csv = [headers, exampleRow, notesRow, qualNote].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href     = url
    link.download = 'compliance_documents_template.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  /**
   * Parse the selected CSV file, validate each row, and populate the preview state.
   * Called automatically when the user selects a file.
   */
  const handleCsvUpload = async (file) => {
    if (!file) return
    // Skip comment rows that start with #
    setCsvFile(file)
    setCsvPreview(null)
    setCsvResults(null)
    setCsvParsing(true)

    try {
      const text = await file.text()
      // Filter out comment lines (starting with #) before parsing
      const cleanedText = text
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith('#'))
        .join('\n')

      const rawRows = parseCsvText(cleanedText)

      const annotated = rawRows.map(row => ({
        ...row,
        _errors: validateCsvRow(row, students),
      }))

      const validCount = annotated.filter(r => r._errors.length === 0).length
      const errorCount = annotated.length - validCount

      setCsvPreview({ rows: annotated, validCount, errorCount })
    } catch (err) {
      toast.error('Failed to parse CSV file. Ensure it is a valid .csv.')
      console.error('CSV parse error:', err)
    } finally {
      setCsvParsing(false)
    }
  }

  /**
   * Submit all valid CSV rows to POST /api/compliance (metadata only — no files).
   * The student_id column contains the reference number (e.g. "STU001"), which is
   * resolved to the student UUID before sending.
   */
  const submitCsvImport = async () => {
    const validRows = (csvPreview?.rows || []).filter(r => r._errors.length === 0)
    if (validRows.length === 0) return toast.error('No valid rows to submit')

    setCsvImporting(true)
    let successCount  = 0
    let failedCount   = 0
    const failedDetails = []

    for (const row of validRows) {
      try {
        // Resolve student reference number -> UUID
        const student = students.find(s => s.student_id === row.student_id)
        if (!student) {
          failedCount++
          failedDetails.push({ rowNum: row._rowNum, error: `Student "${row.student_id}" not found` })
          continue
        }

        // Build the notes field: qualification prefix + user notes
        const noteParts = []
        if (row.qualification) noteParts.push(`Qualification: ${row.qualification}`)
        if (row.notes)         noteParts.push(row.notes)

        await api.post('/compliance', {
          student_id:      student.id,
          document_type:   row.document_type,
          expiry_date:     row.expiry_date?.trim() || null,
          notes:           noteParts.join('\n') || null,
        })
        successCount++
      } catch (err) {
        failedCount++
        failedDetails.push({
          rowNum: row._rowNum,
          error:  err.response?.data?.detail || 'Submission failed',
        })
      }
    }

    setCsvImporting(false)
    setCsvResults({ success: successCount, failed: failedCount, failedDetails })
    if (successCount > 0) load()
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

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Valid',                count: summary.valid,    icon: CheckCircle,   color: 'text-green-500',  bg: 'bg-green-50',  filter: 'valid'         },
          { label: 'Expiring Soon',        count: summary.expiring, icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-50', filter: 'expiring_soon' },
          { label: 'Expired',              count: summary.expired,  icon: XCircle,       color: 'text-red-500',    bg: 'bg-red-50',    filter: 'expired'       },
          { label: 'Pending Verification', count: summary.pending,  icon: AlertTriangle, color: 'text-blue-500',   bg: 'bg-blue-50',   filter: 'pending'       },
        ].map(c => (
          <div
            key={c.label}
            className="card flex items-center gap-3 cursor-pointer hover:shadow-md transition-all"
            onClick={() => { setFilterStatus(f => f === c.filter ? '' : c.filter); setActiveTab('documents') }}
          >
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

      {/* Tabs — Feature 4 adds the "Bulk Upload" tab */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
        {[
          { key: 'documents',    label: 'Documents',             icon: FileText    },
          { key: 'report',       label: 'Compliance Report',     icon: CheckCircle },
          { key: 'hours_report', label: 'Placement Hours Report', icon: BarChart2  },
          { key: 'email_log',    label: 'Email Log',             icon: Mail        },
          { key: 'bulk_upload',  label: 'Bulk Upload',           icon: Upload      },
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
            {(filterStatus || filterType || search) && (
              <button
                onClick={() => { setFilterStatus(''); setFilterType(''); setSearch('') }}
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
                      {['Student', 'Document Type', 'Doc Number', 'Issue Date', 'Expiry Date', 'Status', 'File', 'Verified By', 'Actions'].map(h => (
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
                          <td className="px-4 py-3">
                            {d.file_url
                              ? <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs text-cyan hover:underline">View</a>
                              : '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{d.verified_by || '-'}</td>
                          <td className="px-4 py-3">
                            {!d.verified && (
                              <button
                                onClick={() => verify(d.id)}
                                className="text-xs text-cyan hover:underline flex items-center gap-1"
                              >
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
          Email Log Tab (unchanged)
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'email_log' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">All compliance-related emails sent via this system</p>
            <button onClick={loadEmailLog} className="btn-secondary text-sm">Refresh</button>
          </div>
          {emailLogLoading ? <Spinner size="lg" /> : emailLog.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No emails sent yet"
              message="Click 'Send Reminders' to send compliance reminder emails. They will appear here."
            />
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
                          <pre className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap font-sans border border-gray-100 max-h-48 overflow-y-auto">
                            {c.body}
                          </pre>
                        </details>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-400 flex items-center gap-1 justify-end">
                        <Clock size={11} />
                        {c.sent_at ? format(new Date(c.sent_at), 'd MMM yyyy, h:mm a') : '-'}
                      </p>
                      <span className={`mt-1 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                        c.sent_successfully ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>
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

      {/* ═══════════════════════════════════════════════════════════════════════
          Placement Hours Report Tab
          Feature 3: sticky thead
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'hours_report' && (() => {
        const campuses        = [...new Set(hoursReport.map(r => r.campus).filter(Boolean))]
        const filteredHours   = hoursReport.filter(r => {
          if (hoursSearch && !r.student_name?.toLowerCase().includes(hoursSearch.toLowerCase()) &&
              !r.student_ref?.toLowerCase().includes(hoursSearch.toLowerCase())) return false
          if (hoursCampus && (r.campus || '').toLowerCase() !== hoursCampus) return false
          return true
        })
        const metCount     = filteredHours.filter(r => (r.completed_hours || 0) >= (r.required_hours || 1)).length
        const pendingCount = filteredHours.length - metCount

        return (
          <>
            <div className="flex flex-wrap gap-3 mb-4 items-center">
              <input
                className="input text-sm py-2 w-56"
                placeholder="Search student name or ID..."
                value={hoursSearch}
                onChange={e => setHoursSearch(e.target.value)}
              />
              <select
                className="input text-sm py-2 w-44"
                value={hoursCampus}
                onChange={e => setHoursCampus(e.target.value)}
              >
                <option value="">All Campuses</option>
                {campuses.map(c => <option key={c} value={c.toLowerCase()}>{c}</option>)}
              </select>
              {(hoursSearch || hoursCampus) && (
                <button
                  onClick={() => { setHoursSearch(''); setHoursCampus('') }}
                  className="text-sm text-gray-500 hover:text-navy underline"
                >
                  Clear
                </button>
              )}
              <button
                onClick={openHoursReminderPreview}
                disabled={hoursPreviewLoading}
                className="btn-secondary text-sm flex items-center gap-1 ml-auto"
              >
                <Mail size={15} />
                {hoursPreviewLoading ? 'Loading...' : 'Send Reminders to Submit Placement Hours Log'}
              </button>
            </div>

            {!hoursReportLoading && (
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="card text-center py-3">
                  <p className="text-xl font-bold text-gray-800">{filteredHours.length}</p>
                  <p className="text-xs text-gray-500">Active Students</p>
                </div>
                <div className="card text-center py-3">
                  <p className="text-xl font-bold text-green-600">{metCount}</p>
                  <p className="text-xs text-gray-500">Hours Requirement Met</p>
                </div>
                <div className="card text-center py-3">
                  <p className="text-xl font-bold text-orange-500">{pendingCount}</p>
                  <p className="text-xs text-gray-500">Hours Still Pending</p>
                </div>
              </div>
            )}

            {hoursReportLoading ? <Spinner size="lg" /> : (
              <div className="card p-0 overflow-hidden">
                <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                      <tr>
                        {['Student', 'Campus', 'Qualification', 'Required', 'Completed', 'Unapproved', 'Remaining', 'Progress', 'Status'].map(h => (
                          <th key={h} className="px-4 py-3 text-left font-medium text-gray-500 whitespace-nowrap bg-gray-50">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredHours.map(r => {
                        const required  = r.required_hours  || 0
                        const completed = r.completed_hours || 0
                        const pending   = r.pending_hours   || 0
                        const remaining = Math.max(0, required - completed)
                        const pct       = required > 0 ? Math.min(100, Math.round(completed / required * 100)) : 0
                        const met       = required > 0 && completed >= required
                        return (
                          <tr key={r.student_id} className={met ? 'bg-green-50/30' : 'hover:bg-orange-50/20'}>
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-900">{r.student_name}</p>
                              <p className="text-gray-400">{r.student_ref}</p>
                            </td>
                            <td className="px-3 py-3 text-gray-600 capitalize">{r.campus || '-'}</td>
                            <td className="px-3 py-3 text-gray-500">{r.qualification || '-'}</td>
                            <td className="px-3 py-3 font-medium text-gray-700">{required}h</td>
                            <td className="px-3 py-3 font-semibold text-blue-700">{completed}h</td>
                            <td className="px-3 py-3 text-gray-500">{pending > 0 ? `${pending}h` : '-'}</td>
                            <td className={`px-3 py-3 font-semibold ${
                              met ? 'text-green-600' : remaining > required * 0.5 ? 'text-red-500' : 'text-orange-500'
                            }`}>
                              {met ? '-' : `${remaining}h`}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-gray-200 rounded-full h-1.5 flex-shrink-0">
                                  <div
                                    className={`h-1.5 rounded-full ${
                                      met ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'
                                    }`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className={`font-bold whitespace-nowrap ${met ? 'text-green-600' : 'text-orange-500'}`}>
                                  {pct}%
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {met
                                ? <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Met</span>
                                : <span className="text-xs font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">Pending</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {filteredHours.length === 0 && (
                    <p className="text-center text-gray-400 py-8 text-sm">No students found</p>
                  )}
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
                  Select a student, attach files for the documents you want to upload, then click Add Documents.
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
                    <div className="grid grid-cols-[1fr_140px_1fr_120px] gap-0 bg-gray-50 border-b border-gray-200 px-3 py-2">
                      <p className="text-xs font-medium text-gray-500">Document Type</p>
                      <p className="text-xs font-medium text-gray-500">Qualification</p>
                      <p className="text-xs font-medium text-gray-500">File</p>
                      <p className="text-xs font-medium text-gray-500">Expiry Date</p>
                    </div>

                    {bulkRows.map((row, idx) => (
                      <div
                        key={row.document_type}
                        className={`grid grid-cols-[1fr_140px_1fr_120px] gap-3 items-center px-3 py-3
                          border-b border-gray-100 last:border-0
                          ${row.file ? 'bg-green-50/40' : 'bg-white hover:bg-gray-50/50'}
                        `}
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-800">{row.abbr}</p>
                          <p className="text-xs text-gray-400 leading-tight">{row.label}</p>
                        </div>

                        <div>
                          {row.qualSpecific ? (
                            <select
                              value={row.qualification}
                              onChange={e => updateBulkRow(idx, 'qualification', e.target.value)}
                              className="input text-xs py-1.5 bg-white"
                              aria-label={`Qualification for ${row.abbr}`}
                            >
                              {QUAL_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-gray-300 px-1">N/A</span>
                          )}
                        </div>

                        <div>
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                            onChange={e => updateBulkRow(idx, 'file', e.target.files[0] || null)}
                            className="block w-full text-xs text-gray-500
                              file:mr-2 file:py-1 file:px-2 file:rounded-md file:border
                              file:border-gray-300 file:text-xs file:bg-gray-50
                              file:cursor-pointer hover:file:bg-gray-100"
                            aria-label={`Upload file for ${row.abbr}`}
                          />
                          {row.file && (
                            <p className="text-xs text-green-600 mt-1 flex items-center gap-1 truncate">
                              <CheckCircle size={11} className="flex-shrink-0" />
                              <span className="truncate">{row.file.name}</span>
                            </p>
                          )}
                        </div>

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

                <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    {bulkRows.filter(r => r.file).length} file{bulkRows.filter(r => r.file).length !== 1 ? 's' : ''} selected
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => resetBulkModal()}
                      className="btn-secondary"
                    >
                      Reset
                    </button>
                    <button
                      onClick={saveBulk}
                      disabled={bulkSaving || !bulkStudentId || bulkRows.every(r => !r.file)}
                      className="btn-primary flex items-center gap-2"
                    >
                      <Upload size={15} />
                      {bulkSaving ? 'Uploading...' : 'Add Documents'}
                    </button>
                  </div>
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
              <button onClick={sendHoursReminders} disabled={sendingHoursReminders} className="btn-primary flex items-center gap-2">
                <Mail size={15} />
                {sendingHoursReminders ? 'Sending...' : `Send to ${hoursPreviewData.recipient_count} Students`}
              </button>
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
              <button onClick={sendReminders} disabled={sendingReminders} className="btn-primary flex items-center gap-2">
                <Mail size={15} />
                {sendingReminders ? 'Sending...' : `Send to ${previewData.recipient_count} Students`}
              </button>
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
