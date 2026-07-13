/**
 * ReportsPage - Task #20: restricted to a single location (campus) based
 * report generator, replacing the previous overview charts + raw CSV export
 * buttons. Wired up to the backend's Custom Report data, which supports
 * campus/qualification/status/days filters server-side.
 *
 * Also see backend/app/api/_combined.py - the expiring_documents report type
 * accepted a campus filter but never applied it; that's fixed alongside this
 * page so every report type here is genuinely location-filterable. The PDF
 * export and this on-screen view now share one data builder
 * (_build_custom_report_data) so they can never show different numbers.
 *
 * Follow-up: results now display on screen (a "View Report" button fetches
 * JSON from /reports/data and renders it as a table) with a separate
 * "Download PDF" action alongside it, rather than only ever producing a PDF.
 */
import React, { useState } from 'react'
import { Download, MapPin, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { downloadFile } from '../utils/api'
import { PageHeader, FormRow, Select, Spinner } from '../components/ui/index'

const REPORT_TYPES = [
  { value: 'enrollment_summary',  label: 'Student Enrolment Summary',  description: 'Students enrolled at the selected campus, with qualification, status and hours progress.' },
  { value: 'placement_hours',     label: 'Placement Hours Summary',    description: 'Placement hours completed vs. required for students at the selected campus.' },
  { value: 'compliance_status',   label: 'Compliance Status',          description: 'Compliance document submission status for current students at the selected campus.' },
  { value: 'expiring_documents',  label: 'Expiring Documents',         description: 'Compliance documents expiring soon for students at the selected campus.' },
]

// All campuses that may exist on historical records. New student enrolments
// are restricted to Sydney/Melbourne (task #15), but reporting still needs to
// cover any legacy campuses so past data remains visible.
const CAMPUSES = ['sydney', 'melbourne', 'perth']

// Preset cohort intake dates for the Placement Hours Summary filters, rather
// than a free-form date range - these are the fixed course start/finish
// dates the college actually runs, "(Mid)" marking the mid-year intakes.
const START_DATE_OPTIONS = [
  { value: '2026-08-03', label: '3 August 2026 (Mid)' },
  { value: '2026-09-21', label: '21 September 2026' },
  { value: '2026-10-26', label: '26 October 2026 (Mid)' },
  { value: '2027-01-11', label: '11 January 2027' },
  { value: '2027-02-15', label: '15 February 2027 (Mid)' },
  { value: '2027-04-05', label: '5 April 2027' },
  { value: '2027-05-10', label: '10 May 2027 (Mid)' },
  { value: '2027-06-28', label: '28 June 2027' },
  { value: '2027-08-02', label: '2 August 2027 (Mid)' },
  { value: '2027-09-20', label: '20 September 2027' },
  { value: '2027-10-25', label: '25 October 2027 (Mid)' },
]

const FINISH_DATE_OPTIONS = [
  { value: '2026-08-28', label: '28 August 2026' },
  { value: '2026-11-20', label: '20 November 2026' },
  { value: '2027-03-12', label: '12 March 2027' },
  { value: '2027-06-04', label: '4 June 2027' },
  { value: '2027-08-27', label: '27 August 2027' },
  { value: '2027-11-19', label: '19 November 2027' },
]

// Cert III students require 160 placement hours, Diploma students require
// 280 - shown here just as a reference; the Completed Hours filter below
// buckets by percentage of each student's own required hours.
const CERT_III_REQUIRED_HOURS = 160
const DIPLOMA_REQUIRED_HOURS = 280

const COMPLETED_HOURS_OPTIONS = [
  { value: 'lt25', label: 'Less than 25%' },
  { value: 'gt25', label: 'More than 25%' },
  { value: '50',   label: '50%' },
  { value: 'gt75', label: 'More than 75%' },
  { value: '100',  label: '100%' },
]

export default function ReportsPage() {
  const [reportType, setReportType] = useState('enrollment_summary')
  const [campus, setCampus] = useState('')
  const [qualification, setQualification] = useState('')
  const [status, setStatus] = useState('current')
  const [days, setDays] = useState(30)
  const [missingOnly, setMissingOnly] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [finishDate, setFinishDate] = useState('')
  const [completedBucket, setCompletedBucket] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)   // { title, filter_desc, headers, rows, row_count }

  const meta = REPORT_TYPES.find(r => r.value === reportType)
  const showQualification = reportType === 'enrollment_summary' || reportType === 'placement_hours'
  const showStatus = reportType === 'enrollment_summary' || reportType === 'placement_hours'
  const showDays = reportType === 'expiring_documents'
  const showMissingOnly = reportType === 'compliance_status'
  const showHoursFilters = reportType === 'placement_hours'

  const buildParams = () => {
    const params = new URLSearchParams({ report_type: reportType })
    if (campus) params.append('campus', campus)
    if (showQualification && qualification) params.append('qualification', qualification)
    if (showStatus) params.append('status', status)
    if (showDays) params.append('days', String(days))
    if (showMissingOnly) params.append('missing_only', String(missingOnly))
    if (showHoursFilters) {
      if (startDate) params.append('start_date', startDate)
      if (finishDate) params.append('finish_date', finishDate)
      if (completedBucket) params.append('completed_bucket', completedBucket)
    }
    return params
  }

  const viewReport = async () => {
    setLoading(true)
    setResult(null)
    try {
      const params = buildParams()
      const r = await api.get(`/reports/data?${params}`)
      setResult(r.data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  const downloadPdf = async () => {
    setDownloading(true)
    const params = buildParams()
    const filenameCampus = campus ? `_${campus}` : ''
    await downloadFile(`/reports/export/pdf?${params}`, `${reportType}${filenameCampus}_${new Date().toISOString().split('T')[0]}.pdf`)
    setDownloading(false)
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title="Reports" subtitle="View a location-based report on screen, or download it as a PDF" />

      <div className="card space-y-5 max-w-3xl">
        <FormRow label="Report Type" required>
          <Select
            value={reportType}
            onChange={v => { setReportType(v); setResult(null) }}
            options={REPORT_TYPES.map(r => ({ value: r.value, label: r.label }))}
            placeholder=""
          />
          {meta && <p className="text-xs text-gray-400 mt-1.5">{meta.description}</p>}
        </FormRow>

        <FormRow label={<span className="flex items-center gap-1.5"><MapPin size={13} /> Campus</span>}>
          <Select
            value={campus}
            onChange={setCampus}
            options={CAMPUSES.map(c => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))}
            placeholder="All Campuses"
          />
        </FormRow>

        <div className="grid grid-cols-2 gap-4">
          {showQualification && (
            <FormRow label="Qualification">
              <Select
                value={qualification}
                onChange={setQualification}
                options={[
                  { value: 'cert_iii', label: 'Certificate III' },
                  { value: 'diploma',  label: 'Diploma' },
                ]}
                placeholder="All Qualifications"
              />
            </FormRow>
          )}

          {showStatus && (
            <FormRow label="Status">
              <Select
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'current',   label: 'Current' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'withdrawn', label: 'Withdrawn' },
                ]}
                placeholder="All Statuses"
              />
            </FormRow>
          )}

          {showDays && (
            <FormRow label="Expiring Within (Days)">
              <input
                className="input"
                type="number"
                min="1"
                max="365"
                value={days}
                onChange={e => setDays(+e.target.value)}
              />
            </FormRow>
          )}
        </div>

        {showHoursFilters && (
          <div className="grid grid-cols-2 gap-4 pt-1 border-t border-gray-100">
            <FormRow label="Start Date">
              <Select
                value={startDate}
                onChange={setStartDate}
                options={START_DATE_OPTIONS}
                placeholder="Any Start Date"
              />
            </FormRow>
            <FormRow label="Finish Date">
              <Select
                value={finishDate}
                onChange={setFinishDate}
                options={FINISH_DATE_OPTIONS}
                placeholder="Any Finish Date"
              />
            </FormRow>
            <FormRow label="Completed Hours">
              <Select
                value={completedBucket}
                onChange={setCompletedBucket}
                options={COMPLETED_HOURS_OPTIONS}
                placeholder="Any"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                % of each student's own required hours (Cert III: {CERT_III_REQUIRED_HOURS}h, Diploma: {DIPLOMA_REQUIRED_HOURS}h). Results still show actual hours completed.
              </p>
            </FormRow>
          </div>
        )}

        {showMissingOnly && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)} className="rounded" />
            Show incomplete students only
          </label>
        )}

        <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-3">
          <button onClick={viewReport} disabled={loading} className="btn-primary">
            <Eye size={15} /> {loading ? 'Loading...' : 'View Report'}
          </button>
          <button onClick={downloadPdf} disabled={downloading} className="btn-secondary">
            <Download size={15} /> {downloading ? 'Generating...' : 'Download PDF'}
          </button>
        </div>
      </div>

      {loading && <div className="mt-6"><Spinner size="lg" /></div>}

      {result && (
        <div className="card p-0 overflow-hidden mt-6">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-navy">{result.title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {result.filter_desc || 'All students'} · {result.row_count} row{result.row_count !== 1 ? 's' : ''}
            </p>
          </div>
          {result.rows.length === 0 ? (
            <p className="text-center text-gray-400 py-10 text-sm">No data found for the selected filters.</p>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                  <tr>
                    {result.headers.map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap bg-gray-50">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {row.map((cell, j) => (
                        <td key={j} className="px-4 py-3 text-gray-700 whitespace-nowrap">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
