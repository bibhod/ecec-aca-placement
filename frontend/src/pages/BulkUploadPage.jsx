/**
 * Bulk Upload Page — Issue 17
 * Download CSV templates, populate them, upload to import data.
 * Covers: Students, Centres, Hours, Visits.
 */
import React, { useState } from 'react'
import { Download, Upload, CheckCircle, AlertTriangle, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { downloadFile } from '../utils/api'
import { PageHeader } from '../components/ui/index'

const UPLOAD_TYPES = [
  {
    key: 'students',
    label: 'Student Lists',
    description: 'Import students from another system. Includes: student ID, name, email, phone, qualification, campus, dates.',
    template: '/bulk/templates/students',
    import: '/bulk/import/students',
    filename: 'template_students.csv',
    color: 'bg-blue-50 border-blue-200',
    icon: '👨‍🎓',
  },
  {
    key: 'centres',
    label: 'Centre Lists',
    description: 'Import placement centres. Includes: centre name, address, contact details, NQS rating.',
    template: '/bulk/templates/centres',
    import: '/bulk/import/centres',
    filename: 'template_centres.csv',
    color: 'bg-green-50 border-green-200',
    icon: '🏫',
  },
  {
    key: 'hours',
    label: 'Log Hours',
    description: 'Bulk-import historical placement hours. Includes: student ID, date, hours, activity description.',
    template: '/bulk/templates/hours',
    import: '/bulk/import/hours',
    filename: 'template_hours.csv',
    color: 'bg-yellow-50 border-yellow-200',
    icon: '🕐',
  },
  {
    key: 'visits',
    label: 'Workplace Visits',
    description: 'Import scheduled visits. Includes: student ID, trainer email, centre name, date, time, appointment type, units.',
    template: '/bulk/templates/visits',
    import: '/bulk/import/visits',
    filename: 'template_visits.csv',
    color: 'bg-purple-50 border-purple-200',
    icon: '📋',
  },
  {
    key: 'compliance',
    label: 'Compliance Documents',
    description: 'Bulk-import compliance records. Includes: student ID, document type (WWCC, First Aid, WPA, MOU), qualification, expiry date, notes.',
    template: '/bulk/templates/compliance',
    import: '/bulk/import/compliance',
    filename: 'template_compliance.csv',
    color: 'bg-red-50 border-red-200',
    icon: '🛡️',
  },
  {
    key: 'units',
    label: 'Unit/Competency Reference',
    description: 'Download the full list of available units for CHC30125 and CHC50125 for reference.',
    template: '/bulk/templates/units',
    import: null,
    filename: 'template_units_reference.csv',
    color: 'bg-gray-50 border-gray-200',
    icon: '📚',
  },
]

function UploadCard({ type }) {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const doDownload = async () => {
    setDownloading(true)
    await downloadFile(type.template, type.filename)
    setDownloading(false)
  }

  const doImport = async () => {
    if (!file) return toast.error('Select a file first')
    setImporting(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.post(type.import, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setResult(r.data)
      if (r.data.errors?.length === 0) toast.success(r.data.message)
      else toast(r.data.message, { icon: '⚠️' })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Import failed')
    } finally { setImporting(false) }
  }

  return (
    <div className={`rounded-xl border-2 p-5 ${type.color}`}>
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl">{type.icon}</span>
        <div>
          <h3 className="font-semibold text-gray-900">{type.label}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{type.description}</p>
        </div>
      </div>

      {/* Step 1: Download template */}
      <div className="bg-white/80 rounded-lg p-3 mb-3">
        <p className="text-xs font-semibold text-gray-600 mb-2">Step 1 — Download Template</p>
        <button onClick={doDownload} disabled={downloading}
          className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 w-full justify-center">
          <Download size={13} /> {downloading ? 'Downloading…' : `Download ${type.filename}`}
        </button>
        <p className="text-xs text-gray-400 mt-1.5 text-center">
          Open in Excel, fill in your data, save as .csv or .xlsx
        </p>
      </div>

      {/* Step 2: Upload — only if type has an import endpoint */}
      {type.import && (
        <div className="bg-white/80 rounded-lg p-3">
          <p className="text-xs font-semibold text-gray-600 mb-2">Step 2 — Upload Completed File</p>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={e => { setFile(e.target.files[0]); setResult(null) }}
            className="block w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-xs file:bg-gray-50 file:cursor-pointer mb-2"
          />
          {file && (
            <button onClick={doImport} disabled={importing}
              className="btn-primary text-xs py-1.5 px-3 w-full flex items-center justify-center gap-1.5">
              <Upload size={13} /> {importing ? 'Importing…' : 'Import Now'}
            </button>
          )}

          {/* Results */}
          {result && (
            <div className={`mt-3 rounded-lg p-3 text-xs ${result.errors?.length > 0 ? 'bg-yellow-50' : 'bg-green-50'}`}>
              <p className="font-semibold mb-1 flex items-center gap-1">
                {result.errors?.length === 0
                  ? <><CheckCircle size={12} className="text-green-600" /> {result.message}</>
                  : <><AlertTriangle size={12} className="text-yellow-600" /> {result.message}</>}
              </p>
              {result.skipped?.length > 0 && (
                <p className="text-gray-500">Skipped (already exist): {result.skipped.join(', ')}</p>
              )}
              {result.errors?.length > 0 && (
                <div className="mt-1">
                  <p className="text-red-600 font-medium">Errors:</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-red-500">Row {e.row}: {e.error}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BulkUploadPage() {
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Bulk Upload Tools"
        subtitle="Download CSV templates, populate them, then import into the system"
      />

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800">
        <p className="font-semibold mb-1">📌 How to use bulk upload:</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Click <strong>Download Template</strong> for the data type you want to import</li>
          <li>Open the CSV in Excel or Google Sheets and fill in your data (do not change the column headers)</li>
          <li>Save as <strong>.csv</strong> or <strong>.xlsx</strong></li>
          <li>Click <strong>Upload Completed File</strong> and select your file</li>
          <li>Review the import results — errors will be listed with the row number</li>
        </ol>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {UPLOAD_TYPES.map(t => <UploadCard key={t.key} type={t} />)}
      </div>
    </div>
  )
}
