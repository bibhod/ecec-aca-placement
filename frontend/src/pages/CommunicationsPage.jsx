/**
 * CommunicationsPage - all issues fixed:
 *   Issue 6:  Templates loaded from API, can be EDITED before sending
 *   Issue 14: Messaging system fully wired
 *   Issue 15: Email + SMS sending errors now surfaced to user
 */
import React, { useEffect, useState } from 'react'
import { Mail, Send, MessageSquare, Phone, Edit2, Check, X, Bell, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { PageHeader, Spinner, Modal, FormRow, Select, EmptyState } from '../components/ui/index'
import { format } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'

export default function CommunicationsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [comms, setComms] = useState([])
  const [students, setStudents] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)

  // Automated Reminder Email section
  const [tab, setTab] = useState('log') // 'log' | 'reminders'
  const [reminderCatalog, setReminderCatalog] = useState([])
  const [reminderSummary, setReminderSummary] = useState([])
  const [editingAutoTemplate, setEditingAutoTemplate] = useState(null)
  const [savingAutoTemplate, setSavingAutoTemplate] = useState(false)
  const [viewingDetailFor, setViewingDetailFor] = useState(null) // { reminder, date }
  const [reminderDetail, setReminderDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const openReminderDetail = async (r) => {
    setViewingDetailFor({ reminder: r.reminder, date: r.date })
    setReminderDetail(null)
    setLoadingDetail(true)
    try {
      const res = await api.get('/communications/reminder-detail', { params: { reminder: r.reminder, date: r.date } })
      setReminderDetail(res.data)
    } catch {
      toast.error('Failed to load detail')
    } finally {
      setLoadingDetail(false)
    }
  }

  // Email modal
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailForm, setEmailForm] = useState({ student_id: '', recipient_email: '', recipient_name: '', subject: '', body: '' })
  const [sendingEmail, setSendingEmail] = useState(false)


  // Template modal - Issue 6: includes editing before send
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [templateForm, setTemplateForm] = useState({ student_id: '', template: '', custom_subject: '', custom_body: '' })
  const [sendingTemplate, setSendingTemplate] = useState(false)

  // Template management (edit stored templates)
  const [showEditTemplateModal, setShowEditTemplateModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [savingTemplate, setSavingTemplate] = useState(false)

  const load = () => {
    Promise.all([
      api.get('/communications'),
      api.get('/students'),
      api.get('/communications/templates'),
      api.get('/communications/reminder-catalog'),
      api.get('/communications/reminder-summary'),
    ]).then(([c, s, t, rc, rs]) => {
      setComms(c.data); setStudents(s.data); setTemplates(t.data || [])
      setReminderCatalog(rc.data?.reminders || [])
      setReminderSummary(rs.data?.summary || [])
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // When a student is selected, auto-fill template body with student name
  const handleTemplateStudentChange = (studentId) => {
    const s = students.find(x => x.id === studentId)
    const tmpl = templates.find(t => t.name === templateForm.template)
    setTemplateForm(f => ({
      ...f,
      student_id: studentId,
      custom_subject: tmpl ? tmpl.subject_template.replace('{student_name}', s?.full_name || '') : f.custom_subject,
      custom_body: tmpl ? tmpl.body_template.replace(/{student_name}/g, s?.full_name || '') : f.custom_body,
    }))
  }

  const handleTemplateChange = (templateName) => {
    const tmpl = templates.find(t => t.name === templateName)
    const s = students.find(x => x.id === templateForm.student_id)
    setTemplateForm(f => ({
      ...f,
      template: templateName,
      custom_subject: tmpl ? tmpl.subject_template.replace('{student_name}', s?.full_name || '') : '',
      custom_body: tmpl ? tmpl.body_template.replace(/{student_name}/g, s?.full_name || '') : '',
    }))
  }

  // Email send
  const sendEmail = async () => {
    if (!emailForm.recipient_email || !emailForm.subject || !emailForm.body)
      return toast.error('Recipient email, subject and message are required')
    setSendingEmail(true)
    try {
      const r = await api.post('/communications/send', { ...emailForm, message_type: 'email' })
      if (r.data.success) { toast.success('Email sent successfully'); setShowEmailModal(false); load() }
      else toast.error(r.data.error || r.data.message || 'Email failed - check SMTP settings in docker-compose.yml')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Email send error')
    } finally { setSendingEmail(false) }
  }

  // Template send
  const sendTemplate = async () => {
    if (!templateForm.student_id || !templateForm.template)
      return toast.error('Please select a student and template')
    setSendingTemplate(true)
    try {
      const r = await api.post('/communications/send-template', {
        student_id: templateForm.student_id,
        template: templateForm.template,
        custom_subject: templateForm.custom_subject || undefined,
        custom_body: templateForm.custom_body || undefined,
      })
      if (r.data.success) { toast.success('Template email sent'); setShowTemplateModal(false); load() }
      else toast.error(r.data.error || 'Template email failed - check SMTP settings')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Send error')
    } finally { setSendingTemplate(false) }
  }

  // Save edited template
  const saveTemplate = async () => {
    if (!editingTemplate) return
    setSavingTemplate(true)
    try {
      await api.put(`/communications/templates/${editingTemplate.id}`, {
        label: editingTemplate.label,
        subject_template: editingTemplate.subject_template,
        body_template: editingTemplate.body_template,
      })
      toast.success('Template saved')
      setShowEditTemplateModal(false)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally { setSavingTemplate(false) }
  }

  const saveAutoTemplate = async () => {
    if (!editingAutoTemplate) return
    setSavingAutoTemplate(true)
    try {
      await api.put(`/communications/templates/${editingAutoTemplate.template_id}`, {
        subject_template: editingAutoTemplate.template_subject,
        body_template: editingAutoTemplate.template_body,
      })
      toast.success('Reminder template saved')
      setEditingAutoTemplate(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally { setSavingAutoTemplate(false) }
  }

  const handleStudentEmailSelect = (v) => {
    const s = students.find(x => x.id === v)
    setEmailForm(f => ({ ...f, student_id: v, recipient_email: s?.email || '', recipient_name: s?.full_name || '' }))
  }
  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title="Communications" subtitle={`${comms.length} messages sent`}
        actions={
          isAdmin && (
            <>
              <button onClick={() => setShowEditTemplateModal(true)} className="btn-secondary text-sm">
                <Edit2 size={15} /> Manage Templates
              </button>
              <button onClick={() => setShowTemplateModal(true)} className="btn-secondary text-sm">
                <MessageSquare size={15} /> Use Template
              </button>
              <button onClick={() => setShowEmailModal(true)} className="btn-primary text-sm">
                <Mail size={15} /> Compose Email
              </button>
            </>
          )
        }
      />

      {/* ── Section tabs: Message Log / Automated Reminder Email ────────────── */}
      <div className="flex gap-2 border-b border-gray-200 mb-5">
        <button
          onClick={() => setTab('log')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'log' ? 'border-navy text-navy' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          Message Log
        </button>
        <button
          onClick={() => setTab('reminders')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${tab === 'reminders' ? 'border-navy text-navy' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          <Bell size={14} /> Automated Reminder Email
        </button>
      </div>

      {tab === 'reminders' ? (
        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Reminder Templates & Frequency</h3>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[27%]" />
                  <col className="w-[27%]" />
                  <col className="w-[27%]" />
                  <col className="w-[19%]" />
                </colgroup>
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                    <th className="pb-2 pr-4">Reminder</th>
                    <th className="pb-2 pr-4">Recipients</th>
                    <th className="pb-2 pr-4">Frequency</th>
                    <th className="pb-2">Template</th>
                  </tr>
                </thead>
                <tbody>
                  {reminderCatalog.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-2.5 pr-4 font-medium text-gray-900">{r.name}</td>
                      <td className="py-2.5 pr-4 text-gray-600">{r.recipients}</td>
                      <td className="py-2.5 pr-4 text-gray-600">{r.frequency}</td>
                      <td className="py-2.5">
                        <button onClick={() => setEditingAutoTemplate({ ...r })} className="btn-secondary text-xs py-1 px-2.5 whitespace-nowrap">
                          <Edit2 size={12} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
              <Clock size={14} /> Reminder Send Log
            </h3>
            {reminderSummary.length === 0 ? (
              <EmptyState icon={Bell} title="No automated reminders sent yet" />
            ) : (
              <div className="space-y-2">
                {reminderSummary.map((r, i) => (
                  <div key={i} className="card flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium text-sm text-gray-900">{r.reminder}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Sent to {r.student_count} student{r.student_count === 1 ? '' : 's'}
                        {r.sent_at ? ` · on ${format(new Date(r.sent_at), 'd MMMM yyyy \'at\' h:mm a')}` : ''}
                        {' · '}
                        <button onClick={() => openReminderDetail(r)} className="text-cyan hover:underline font-medium">
                          View in Detail
                        </button>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3">
              For the detailed per-student record of each send, see the Message Log tab.
            </p>
          </div>
        </div>
      ) : comms.length === 0 ? (
        <EmptyState icon={Mail} title="No communications yet"
          action={isAdmin ? <button onClick={() => setShowEmailModal(true)} className="btn-primary mx-auto"><Mail size={15} /> Compose Email</button> : undefined} />
      ) : (
        <div className="space-y-3">
          {comms.map(c => (
            <div key={c.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${c.sent_successfully ? 'bg-green-100' : 'bg-red-100'}`}>
                    {c.message_type === 'sms'
                      ? <Phone size={16} className={c.sent_successfully ? 'text-green-600' : 'text-red-600'} />
                      : <Mail size={16} className={c.sent_successfully ? 'text-green-600' : 'text-red-600'} />}
                  </div>
                  <div>
                    <p className="font-medium text-sm text-gray-900">{c.subject || '(SMS)'}</p>
                    <p className="text-xs text-gray-500">
                      To: {c.recipient_name}
                      {c.message_type === 'sms' ? ` · SMS` : ` <${c.recipient_email}>`}
                      {c.template_used && <span className="ml-1 text-gray-400">· {c.template_used}</span>}
                    </p>
                    {c.error_message && (
                      <p className="text-xs text-red-500 mt-0.5">Error: {c.error_message}</p>
                    )}
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{c.body}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">{c.sent_at ? format(new Date(c.sent_at), 'd MMM yyyy HH:mm') : ''}</p>
                  <span className={`text-xs font-medium ${c.sent_successfully ? 'text-green-600' : 'text-red-500'}`}>
                    {c.sent_successfully ? '✓ Sent' : '✗ Failed'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Compose Email Modal ─────────────────────────────────────────────── */}
      <Modal open={showEmailModal} onClose={() => setShowEmailModal(false)} title="Compose Email" size="md">
        <div className="space-y-4">
          <FormRow label="Student (auto-fill)">
            <Select value={emailForm.student_id} onChange={handleStudentEmailSelect}
              options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))} placeholder="Select student…" />
          </FormRow>
          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Recipient Name"><input className="input" value={emailForm.recipient_name} onChange={e => setEmailForm(f => ({ ...f, recipient_name: e.target.value }))} /></FormRow>
            <FormRow label="Recipient Email" required><input className="input" type="email" value={emailForm.recipient_email} onChange={e => setEmailForm(f => ({ ...f, recipient_email: e.target.value }))} /></FormRow>
          </div>
          <FormRow label="Subject" required><input className="input" value={emailForm.subject} onChange={e => setEmailForm(f => ({ ...f, subject: e.target.value }))} /></FormRow>
          <FormRow label="Message" required><textarea className="input h-36 resize-none" value={emailForm.body} onChange={e => setEmailForm(f => ({ ...f, body: e.target.value }))} /></FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowEmailModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={sendEmail} disabled={sendingEmail} className="btn-primary">
            <Send size={15} />{sendingEmail ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </Modal>

      {/* ── Template Email Modal (Issue 6 - editable before sending) ────────── */}
      <Modal open={showTemplateModal} onClose={() => setShowTemplateModal(false)} title="Send Template Email" size="md">
        <div className="space-y-4">
          <FormRow label="Student" required>
            <Select value={templateForm.student_id} onChange={handleTemplateStudentChange}
              options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))} placeholder="Select student…" />
          </FormRow>
          <FormRow label="Template" required>
            <Select value={templateForm.template} onChange={handleTemplateChange}
              options={templates.map(t => ({ value: t.name, label: t.label }))} placeholder="Select template…" />
          </FormRow>
          {templateForm.template && (
            <>
              <p className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2">
                ✏️ You can edit the subject and body below before sending.
              </p>
              <FormRow label="Subject">
                <input className="input" value={templateForm.custom_subject}
                  onChange={e => setTemplateForm(f => ({ ...f, custom_subject: e.target.value }))} />
              </FormRow>
              <FormRow label="Message Body">
                <textarea className="input h-48 resize-y" value={templateForm.custom_body}
                  onChange={e => setTemplateForm(f => ({ ...f, custom_body: e.target.value }))} />
              </FormRow>
            </>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowTemplateModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={sendTemplate} disabled={sendingTemplate} className="btn-primary">
            <Send size={15} />{sendingTemplate ? 'Sending…' : 'Send'}
          </button>
        </div>
      </Modal>

      {/* ── Manage Templates Modal (edit stored templates) ──────────────────── */}
      <Modal open={showEditTemplateModal} onClose={() => { setShowEditTemplateModal(false); setEditingTemplate(null) }}
        title="Manage Email Templates" size="lg">
        {!editingTemplate ? (
          <div className="space-y-3">
            {templates.map(t => (
              <div key={t.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div>
                  <p className="font-medium text-sm text-gray-900">{t.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t.subject_template}</p>
                </div>
                <button onClick={() => setEditingTemplate({ ...t })} className="btn-secondary text-xs py-1.5 px-3">
                  <Edit2 size={12} /> Edit
                </button>
              </div>
            ))}
            <p className="text-xs text-gray-400 pt-2">Click Edit to modify a template's subject and body.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setEditingTemplate(null)} className="text-sm text-gray-400 hover:text-navy flex items-center gap-1">
                ← Back to list
              </button>
              <span className="text-sm font-semibold text-navy">{editingTemplate.label}</span>
            </div>
            <FormRow label="Display Label">
              <input className="input" value={editingTemplate.label}
                onChange={e => setEditingTemplate(t => ({ ...t, label: e.target.value }))} />
            </FormRow>
            <FormRow label="Subject Template">
              <input className="input" value={editingTemplate.subject_template}
                onChange={e => setEditingTemplate(t => ({ ...t, subject_template: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-0.5">Use <code>{'{{student_name}}'}</code> for student's name.</p>
            </FormRow>
            <FormRow label="Body Template">
              <textarea className="input h-56 resize-y" value={editingTemplate.body_template}
                onChange={e => setEditingTemplate(t => ({ ...t, body_template: e.target.value }))} />
            </FormRow>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button onClick={() => setEditingTemplate(null)} className="btn-secondary">Cancel</button>
              <button onClick={saveTemplate} disabled={savingTemplate} className="btn-primary">
                <Check size={15} />{savingTemplate ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </div>
        )}
      </Modal>
      {/* ── Edit Automated Reminder Template Modal ──────────────────────────── */}
      <Modal open={!!editingAutoTemplate} onClose={() => setEditingAutoTemplate(null)}
        title={editingAutoTemplate ? `Edit Template - ${editingAutoTemplate.name}` : 'Edit Template'} size="lg">
        {editingAutoTemplate && (
          <div className="space-y-4">
            {reminderCatalog.filter(r => r.template_name === editingAutoTemplate.template_name && r.name !== editingAutoTemplate.name).length > 0 && (
              <p className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2">
                This template is shared - it also sends for: {reminderCatalog
                  .filter(r => r.template_name === editingAutoTemplate.template_name && r.name !== editingAutoTemplate.name)
                  .map(r => r.name).join(', ')}
              </p>
            )}
            <FormRow label="Subject Template">
              <input className="input" value={editingAutoTemplate.template_subject}
                onChange={e => setEditingAutoTemplate(t => ({ ...t, template_subject: e.target.value }))} />
            </FormRow>
            <FormRow label="Body Template">
              <textarea className="input h-56 resize-y text-sm" value={editingAutoTemplate.template_body}
                onChange={e => setEditingAutoTemplate(t => ({ ...t, template_body: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">Plain text - leave a blank line between paragraphs. Placeholders in curly braces (e.g. {'{student_name}'}) are filled in automatically when the email is sent.</p>
            </FormRow>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button onClick={() => setEditingAutoTemplate(null)} className="btn-secondary">Cancel</button>
              <button onClick={saveAutoTemplate} disabled={savingAutoTemplate} className="btn-primary">
                <Check size={15} />{savingAutoTemplate ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reminder Send Log - View in Detail modal */}
      <Modal open={!!viewingDetailFor} onClose={() => { setViewingDetailFor(null); setReminderDetail(null) }}
        title={viewingDetailFor ? `${viewingDetailFor.reminder} - ${viewingDetailFor.date}` : 'Reminder Detail'} size="lg">
        {loadingDetail ? (
          <div className="py-10 flex justify-center"><Spinner /></div>
        ) : reminderDetail ? (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4 text-center">
              <div className="bg-blue-50 rounded-xl p-3"><p className="text-xl font-bold text-blue-600">{reminderDetail.total_sent}</p><p className="text-xs text-gray-500">Total Sent</p></div>
              <div className="bg-green-50 rounded-xl p-3"><p className="text-xl font-bold text-green-600">{reminderDetail.delivered}</p><p className="text-xs text-gray-500">Delivered</p></div>
              <div className="bg-gray-50 rounded-xl p-3"><p className="text-xl font-bold text-gray-500">{reminderDetail.failed}</p><p className="text-xs text-gray-500">Failed</p></div>
            </div>
            {reminderDetail.items.length === 0 ? (
              <EmptyState icon={Bell} title="No recipient details found for this entry" />
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-2">
                {reminderDetail.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm">
                    <div>
                      <p className="font-medium text-gray-800">{item.student_name}</p>
                      <p className="text-xs text-gray-400">{item.recipient_email || 'No email on file'}</p>
                    </div>
                    <span className={`text-xs font-medium ${item.sent_successfully ? 'text-green-600' : 'text-red-500'}`}>
                      {item.sent_successfully ? 'Sent' : 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
