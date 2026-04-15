/**
 * CommunicationsPage — all issues fixed:
 *   Issue 6:  Templates loaded from API, can be EDITED before sending
 *   Issue 14: Messaging system fully wired
 *   Issue 15: Email + SMS sending errors now surfaced to user
 */
import React, { useEffect, useState } from 'react'
import { Mail, Send, MessageSquare, Phone, Edit2, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { PageHeader, Spinner, Modal, FormRow, Select, EmptyState } from '../components/ui/index'
import { format } from 'date-fns'

export default function CommunicationsPage() {
  const [comms, setComms] = useState([])
  const [students, setStudents] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)

  // Email modal
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailForm, setEmailForm] = useState({ student_id: '', recipient_email: '', recipient_name: '', subject: '', body: '' })
  const [sendingEmail, setSendingEmail] = useState(false)

  // SMS modal
  const [showSMSModal, setShowSMSModal] = useState(false)
  const [smsForm, setSmsForm] = useState({ student_id: '', recipient_phone: '', recipient_name: '', body: '' })
  const [sendingSMS, setSendingSMS] = useState(false)

  // Template modal — Issue 6: includes editing before send
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
    ]).then(([c, s, t]) => {
      setComms(c.data); setStudents(s.data); setTemplates(t.data || [])
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
      else toast.error(r.data.error || r.data.message || 'Email failed — check SMTP settings in docker-compose.yml')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Email send error')
    } finally { setSendingEmail(false) }
  }

  // SMS send
  const sendSMS = async () => {
    if (!smsForm.recipient_phone || !smsForm.body)
      return toast.error('Phone number and message are required')
    setSendingSMS(true)
    try {
      const r = await api.post('/communications/send-sms', smsForm)
      if (r.data.success) { toast.success('SMS sent'); setShowSMSModal(false); load() }
      else toast.error(r.data.error || 'SMS failed — check Twilio credentials in docker-compose.yml')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'SMS send error')
    } finally { setSendingSMS(false) }
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
      else toast.error(r.data.error || 'Template email failed — check SMTP settings')
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

  const handleStudentEmailSelect = (v) => {
    const s = students.find(x => x.id === v)
    setEmailForm(f => ({ ...f, student_id: v, recipient_email: s?.email || '', recipient_name: s?.full_name || '' }))
  }

  const handleSMSStudentSelect = (v) => {
    const s = students.find(x => x.id === v)
    setSmsForm(f => ({ ...f, student_id: v, recipient_phone: s?.phone || '', recipient_name: s?.full_name || '' }))
  }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title="Communications" subtitle={`${comms.length} messages sent`}
        actions={
          <>
            <button onClick={() => setShowEditTemplateModal(true)} className="btn-secondary text-sm">
              <Edit2 size={15} /> Manage Templates
            </button>
            <button onClick={() => setShowTemplateModal(true)} className="btn-secondary text-sm">
              <MessageSquare size={15} /> Use Template
            </button>
            <button onClick={() => setShowSMSModal(true)} className="btn-secondary text-sm">
              <Phone size={15} /> Send SMS
            </button>
            <button onClick={() => setShowEmailModal(true)} className="btn-primary text-sm">
              <Mail size={15} /> Compose Email
            </button>
          </>
        }
      />

      {comms.length === 0 ? (
        <EmptyState icon={Mail} title="No communications yet"
          action={<button onClick={() => setShowEmailModal(true)} className="btn-primary mx-auto"><Mail size={15} /> Compose Email</button>} />
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

      {/* ── Send SMS Modal ──────────────────────────────────────────────────── */}
      <Modal open={showSMSModal} onClose={() => setShowSMSModal(false)} title="Send SMS" size="sm">
        <div className="space-y-4">
          <FormRow label="Student (auto-fill)">
            <Select value={smsForm.student_id} onChange={handleSMSStudentSelect}
              options={students.map(s => ({ value: s.id, label: `${s.full_name} (${s.student_id})` }))} placeholder="Select student…" />
          </FormRow>
          <FormRow label="Mobile Number" required>
            <input className="input" value={smsForm.recipient_phone} onChange={e => setSmsForm(f => ({ ...f, recipient_phone: e.target.value }))} placeholder="+61412345678 or 04XX XXX XXX" />
          </FormRow>
          <FormRow label="Message (max 160 chars)" required>
            <textarea className="input h-24 resize-none" value={smsForm.body}
              onChange={e => setSmsForm(f => ({ ...f, body: e.target.value }))} maxLength={160} />
            <p className="text-xs text-gray-400 text-right mt-0.5">{smsForm.body.length}/160</p>
          </FormRow>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowSMSModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={sendSMS} disabled={sendingSMS} className="btn-primary">
            <Phone size={15} />{sendingSMS ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </Modal>

      {/* ── Template Email Modal (Issue 6 — editable before sending) ────────── */}
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
    </div>
  )
}
