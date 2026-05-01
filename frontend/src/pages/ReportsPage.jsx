/**
 * ReportsPage — all exports fixed.
 * Bug: window.location.href and window.open do NOT send the Authorization header,
 * so every export call returned 401. Fixed by using downloadFile() from api.js
 * which uses the axios instance (includes Bearer token).
 */
import React, { useEffect, useState } from 'react'
import { BarChart3, Download, TrendingUp, Users, Clock, FileCheck } from 'lucide-react'
import api, { downloadFile } from '../utils/api'
import toast from 'react-hot-toast'
import { PageHeader, Spinner, ProgressBar, Badge } from '../components/ui/index'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'

const COLORS = ['#1A2B5F', '#00AEEF', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

export default function ReportsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [exporting, setExporting] = useState('')

  useEffect(() => {
    api.get('/reports/overview').then(r => setData(r.data)).finally(() => setLoading(false))
  }, [])

  const doExport = async (path, filename, key) => {
    setExporting(key)
    await downloadFile(path, filename)
    setExporting('')
  }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>
  if (!data) return <div className="p-8 text-center text-gray-500">No data available</div>

  const campusData = Object.entries(data.by_campus || {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1), value,
  }))
  const qualData = Object.entries(data.by_qualification || {}).map(([name, value]) => ({ name, value }))
  const statusData = Object.entries(data.by_status || {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1), value,
  }))

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Reports & Analytics" subtitle="Placement and compliance reporting"
        actions={
          <>
            <button
              onClick={() => doExport('/reports/export/students', 'students_report.csv', 'students')}
              disabled={exporting === 'students'}
              className="btn-secondary text-sm">
              <Download size={15} /> {exporting === 'students' ? 'Exporting…' : 'Export Students'}
            </button>
            <button
              onClick={() => doExport('/reports/export/hours', 'hours_report.csv', 'hours')}
              disabled={exporting === 'hours'}
              className="btn-secondary text-sm">
              <Download size={15} /> {exporting === 'hours' ? 'Exporting…' : 'Export Hours'}
            </button>
            <button
              onClick={() => doExport('/reports/export/audit', 'audit_report.csv', 'audit')}
              disabled={exporting === 'audit'}
              className="btn-secondary text-sm">
              <Download size={15} /> {exporting === 'audit' ? 'Exporting…' : 'Export Audit'}
            </button>
          </>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Students', value: data.summary.total_students, icon: Users, color: 'text-navy' },
          { label: 'Total Hours Completed', value: `${(data.summary.total_hours_completed || 0).toFixed(0)}h`, icon: Clock, color: 'text-cyan' },
          { label: 'Total Hours Required', value: `${(data.summary.total_hours_required || 0).toFixed(0)}h`, icon: TrendingUp, color: 'text-purple-600' },
          { label: 'Compliance Rate', value: `${data.summary.compliance_rate || 0}%`, icon: FileCheck, color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="card flex items-center gap-3">
            <s.icon size={22} className={s.color} />
            <div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {['overview', 'hours', 'compliance'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-white text-navy shadow-sm' : 'text-gray-500'}`}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="card">
            <h3 className="font-semibold text-navy mb-4">Students by Campus</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={campusData}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#00AEEF" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-navy mb-4">By Qualification</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={qualData} cx="50%" cy="50%" outerRadius={70} dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}>
                  {qualData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-navy mb-4">By Status</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" outerRadius={70} dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}>
                  {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tab === 'hours' && (
        <div className="card p-0 overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10"><tr>
              {['Student', 'Qualification', 'Campus', 'Progress', 'Completed', 'Required', '%'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap bg-gray-50">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {(data.hours_data || []).map((s, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><p className="text-sm font-medium">{s.student_name}</p><p className="text-xs text-gray-400">{s.student_id}</p></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.qualification}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 capitalize">{s.campus}</td>
                  <td className="px-4 py-3 w-36"><ProgressBar value={s.completed_hours} max={s.required_hours} showPct={false} /></td>
                  <td className="px-4 py-3 text-sm font-medium text-cyan">{s.completed_hours}h</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.required_hours}h</td>
                  <td className="px-4 py-3 text-sm font-bold text-navy">{s.percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'compliance' && (
        <div className="card p-0 overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10"><tr>
              {['Student', 'Campus', 'Total Docs', 'Expired', 'Expiring Soon', 'Pending', 'Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap bg-gray-50">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {(data.compliance_data || []).map((s, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><p className="text-sm font-medium">{s.student_name}</p><p className="text-xs text-gray-400">{s.student_id}</p></td>
                  <td className="px-4 py-3 text-sm text-gray-500 capitalize">{s.campus}</td>
                  <td className="px-4 py-3 text-sm">{s.total_docs}</td>
                  <td className="px-4 py-3"><span className={s.expired > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>{s.expired}</span></td>
                  <td className="px-4 py-3"><span className={s.expiring_soon > 0 ? 'text-yellow-600 font-medium' : 'text-gray-400'}>{s.expiring_soon}</span></td>
                  <td className="px-4 py-3"><span className={s.pending_verification > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}>{s.pending_verification}</span></td>
                  <td className="px-4 py-3"><Badge status={s.compliant ? 'compliant' : 'pending'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
