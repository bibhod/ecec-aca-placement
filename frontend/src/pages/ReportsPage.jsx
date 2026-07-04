/**
 * ReportsPage - Task #20: restricted to a single location (campus) based
 * report generator, replacing the previous overview charts + raw CSV export
 * buttons. Wired up to the existing (previously unused by the frontend)
 * /reports/export/pdf endpoint, which already supported campus/qualification/
 * status/days filters server-side.
 *
 * Also see backend/app/api/_combined.py - the expiring_documents report type
 * accepted a campus filter but never applied it; that's fixed alongside this
 * page so every report type here is genuinely location-filterable.
 */
import React, { useState } from 'react'
import { Download, MapPin } from 'lucide-react'
import { downloadFile } from '../utils/api'
import { PageHeader, FormRow, Select } from '../components/ui/index'

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

export default function ReportsPage() {
  const [reportType, setReportType] = useState('enrollment_summary')
  const [campus, setCampus] = useState('')
  const [qualification, setQualification] = useState('')
  const [status, setStatus] = useState('current')
  const [days, setDays] = useState(30)
  const [missingOnly, setMissingOnly] = useState(false)
  const [generating, setGenerating] = useState(false)

  const meta = REPORT_TYPES.find(r => r.value === reportType)
  const showQualification = reportType === 'enrollment_summary' || reportType === 'placement_hours'
  const showStatus = reportType === 'enrollment_summary' || reportType === 'placement_hours'
  const showDays = reportType === 'expiring_documents'
  const showMissingOnly = reportType === 'compliance_status'

  const generate = async () => {
    setGenerating(true)
    const params = new URLSearchParams({ report_type: reportType })
    if (campus) params.append('campus', campus)
    if (showQualification && qualification) params.append('qualification', qualification)
    if (showStatus) params.append('status', status)
    if (showDays) params.append('days', String(days))
    if (showMissingOnly) params.append('missing_only', String(missingOnly))
    const filenameCampus = campus ? `_${campus}` : ''
    await downloadFile(`/reports/export/pdf?${params}`, `${reportType}${filenameCampus}_${new Date().toISOString().split('T')[0]}.pdf`)
    setGenerating(false)
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <PageHeader title="Reports" subtitle="Generate a location-based report as a PDF" />

      <div className="card space-y-5">
        <FormRow label="Report Type" required>
          <Select
            value={reportType}
            onChange={v => setReportType(v)}
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

        {showMissingOnly && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)} className="rounded" />
            Show incomplete students only
          </label>
        )}

        <div className="pt-2 border-t border-gray-100">
          <button onClick={generate} disabled={generating} className="btn-primary w-full sm:w-auto">
            <Download size={15} /> {generating ? 'Generating...' : 'Generate PDF Report'}
          </button>
        </div>
      </div>
    </div>
  )
}
