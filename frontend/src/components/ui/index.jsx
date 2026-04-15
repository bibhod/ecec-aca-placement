import React, { useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'

// ─── MODAL ──────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${sizes[size]} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-semibold text-navy">{title}</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-6">{children}</div>
      </div>
    </div>
  )
}

// ─── CONFIRM DIALOG ──────────────────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', variant = 'danger' }) {
  if (!open) return null
  return (
    <div className="modal-backdrop">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={20} className="text-red-600" />
          </div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
        </div>
        <p className="text-sm text-gray-600 mb-6 ml-13">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
          <button onClick={() => { onConfirm(); onClose() }} className={variant === 'danger' ? 'btn-danger text-sm py-1.5 px-4' : 'btn-primary text-sm py-1.5 px-4'}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── STAT CARD ───────────────────────────────────────────────────────────────
export function StatCard({ label, value, icon: Icon, color = 'cyan', sub, onClick }) {
  const colors = {
    cyan: 'bg-cyan/10 text-cyan',
    navy: 'bg-navy/10 text-navy',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
  }
  return (
    <div onClick={onClick} className={`card flex items-center gap-4 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── BADGE ───────────────────────────────────────────────────────────────────
export function Badge({ status, label }) {
  const map = {
    // Compliance
    valid: 'badge-green', compliant: 'badge-green', active: 'badge-green',
    completed: 'badge-green', resolved: 'badge-green', approved: 'badge-green',
    expired: 'badge-red', expiring_soon: 'badge-yellow',
    pending: 'badge-yellow', open: 'badge-yellow', in_progress: 'badge-blue',
    scheduled: 'badge-blue', deferred: 'badge-gray', withdrawn: 'badge-gray',
    cancelled: 'badge-gray', closed: 'badge-gray',
    // Priority
    critical: 'badge-red', high: 'badge-yellow', medium: 'badge-blue', low: 'badge-green',
    // Location
    online: 'badge-blue', onsite: 'badge-green', phone: 'badge-gray',
  }
  const cls = map[status] || 'badge-gray'
  return <span className={cls}>{label || status?.replace(/_/g, ' ')}</span>
}

// ─── PROGRESS BAR ────────────────────────────────────────────────────────────
export function ProgressBar({ value, max, label, showPct = true }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const color = pct >= 100 ? 'bg-green-500' : pct >= 75 ? 'bg-cyan' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-400'
  return (
    <div className="w-full">
      {(label || showPct) && (
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          {label && <span>{label}</span>}
          {showPct && <span className="font-medium">{pct.toFixed(0)}%</span>}
        </div>
      )}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {max && <p className="text-xs text-gray-400 mt-1">{value} / {max} hours</p>}
    </div>
  )
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="text-center py-16">
      {Icon && <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Icon size={28} className="text-gray-400" />
      </div>}
      <h3 className="text-gray-900 font-medium mb-1">{title}</h3>
      {message && <p className="text-gray-500 text-sm mb-4">{message}</p>}
      {action}
    </div>
  )
}

// ─── LOADING SPINNER ─────────────────────────────────────────────────────────
export function Spinner({ size = 'md' }) {
  const s = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' }
  return (
    <div className="flex justify-center items-center py-8">
      <div className={`animate-spin rounded-full border-3 border-cyan border-t-transparent ${s[size]}`}
        style={{ borderWidth: '3px' }} />
    </div>
  )
}

// ─── PAGE HEADER ─────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">{title}</h1>
        {subtitle && <p className="text-gray-500 text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ─── SEARCH INPUT ────────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="input pl-9 pr-4 w-64" />
    </div>
  )
}

// ─── FORM ROW ────────────────────────────────────────────────────────────────
export function FormRow({ label, required, children, hint }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

// ─── SELECT ──────────────────────────────────────────────────────────────────
export function Select({ value, onChange, options, placeholder = 'Select...', className = '' }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`input bg-white ${className}`}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value || o} value={o.value || o}>{o.label || o}</option>
      ))}
    </select>
  )
}
