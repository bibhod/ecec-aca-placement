"""
Communications API - fixed version.
Bugs fixed:
  - Templates can now be EDITED (PUT /communications/templates/{id})
  - send-template body correctly applied
  - SMS endpoint properly stores phone number
  - All errors caught and returned with clear messages
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timedelta
import logging
import re

from app.database import get_db
from app.models import Communication, Student, User, EmailTemplate
from app.utils.auth import get_current_user, require_admin, require_admin_or_trainer
from app.api.audit import write_audit
from app.services.email_service import send_email, base_template as _base_template
from app.services.sms_service import send_sms

router = APIRouter()
logger = logging.getLogger(__name__)

# ─── Default templates (fallback when DB is empty) ───────────────────────────
_DEFAULT_TEMPLATES = [
    {
        "name": "placement_confirmation",
        "label": "Placement Confirmation",
        "subject_template": "Placement Confirmation – {student_name}",
        "body_template": (
            "Dear {student_name},\n\n"
            "Your work placement has been confirmed. "
            "Please review the details in the student portal and ensure all compliance "
            "documents are up to date before your placement commences.\n\n"
            "Regards,\nAcademies Australasia"
        ),
    },
    {
        "name": "compliance_reminder",
        "label": "Compliance Documents Reminder",
        "subject_template": "Action Required: Compliance Documents – {student_name}",
        "body_template": (
            "Dear {student_name},\n\n"
            "Please ensure all your compliance documents are current:\n"
            "• Working with Children Check\n"
            "• National Police Check\n"
            "• Valid First Aid Certificate (including CPR)\n"
            "• Work Placement Agreement\n"
            "• Memorandum of Understanding (MOU)\n"
            "• National Child Safety Training (Geccko)\n\n"
            "Regards,\nAcademies Australasia"
        ),
    },
    {
        "name": "hours_reminder",
        "label": "Hours Log Reminder",
        "subject_template": "Reminder: Log Your Placement Hours – {student_name}",
        "body_template": (
            "Dear {student_name},\n\n"
            "This is a reminder to log your placement hours regularly in the student portal.\n\n"
            "Regards,\nAcademies Australasia"
        ),
    },
    {
        "name": "supervisor_feedback",
        "label": "Supervisor Feedback Request",
        "subject_template": "Feedback Required for {student_name}",
        "body_template": (
            "Dear Supervisor,\n\n"
            "We would appreciate your feedback on {student_name}'s performance during "
            "their work placement. Please contact your student's coordinator.\n\n"
            "Regards,\nAcademies Australasia"
        ),
    },
    {
        "name": "visit_notification",
        "label": "Assessor Visit Notification",
        "subject_template": "Upcoming Assessor Visit – {student_name}",
        "body_template": (
            "Dear {student_name},\n\n"
            "Your Trainer and Assessor will be visiting your placement centre soon. "
            "Please ensure you are prepared and that your supervisor is available.\n\n"
            "Regards,\nAcademies Australasia"
        ),
    },
]


def _seed_templates_if_empty(db: Session):
    """Auto-seed default templates so the list is never empty."""
    if db.query(EmailTemplate).count() == 0:
        for t in _DEFAULT_TEMPLATES:
            db.add(EmailTemplate(
                name=t["name"], label=t["label"],
                subject_template=t["subject_template"],
                body_template=t["body_template"],
                is_active=True,
            ))
        db.commit()


def _get_templates(db: Session) -> list:
    _seed_templates_if_empty(db)
    rows = db.query(EmailTemplate).filter(EmailTemplate.is_active == True).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "label": t.label,
            "subject_template": t.subject_template,
            "body_template": t.body_template,
        }
        for t in rows
    ]


# ─── List communications ──────────────────────────────────────────────────────
@router.get("")
def list_communications(
    student_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Communication)
    if student_id:
        q = q.filter(Communication.student_id == student_id)
    comms = q.order_by(Communication.sent_at.desc()).all()
    return [
        {
            "id": c.id,
            "student_id": c.student_id,
            "sender_id": c.sender_id,
            "recipient_email": c.recipient_email,
            "recipient_phone": c.recipient_phone,
            "recipient_name": c.recipient_name,
            "message_type": c.message_type,
            "subject": c.subject,
            "body": c.body,
            "template_used": c.template_used,
            "sent_successfully": c.sent_successfully,
            "error_message": c.error_message,
            "sent_at": str(c.sent_at) if c.sent_at else None,
        }
        for c in comms
    ]


# ─── Template CRUD ────────────────────────────────────────────────────────────
@router.get("/templates")
def list_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all active templates. Auto-seeds defaults if empty."""
    return _get_templates(db)


class TemplateUpdate(BaseModel):
    label: Optional[str] = None
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    is_active: Optional[bool] = None


@router.put("/templates/{template_id}")
def update_template(
    template_id: str,
    data: TemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Edit an existing email template (Issue 6 - template editing)."""
    t = db.query(EmailTemplate).filter(EmailTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    if data.label is not None:
        t.label = data.label
    if data.subject_template is not None:
        t.subject_template = data.subject_template
    if data.body_template is not None:
        t.body_template = data.body_template
    if data.is_active is not None:
        t.is_active = data.is_active
    db.commit()
    db.refresh(t)

    # Audit: record template update
    write_audit(
        db, current_user, "communication.template_update", "communication_template",
        resource_id=t.id, resource_label=t.label,
        details={"updated_fields": list(data.dict(exclude_none=True).keys())},
    )
    db.commit()

    return {
        "id": t.id, "name": t.name, "label": t.label,
        "subject_template": t.subject_template,
        "body_template": t.body_template,
        "is_active": t.is_active,
    }


@router.post("/templates")
def create_template(
    data: TemplateUpdate,
    name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new custom email template."""
    existing = db.query(EmailTemplate).filter(EmailTemplate.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="A template with that name already exists")
    t = EmailTemplate(
        name=name,
        label=data.label or name,
        subject_template=data.subject_template or "",
        body_template=data.body_template or "",
        is_active=True,
    )
    db.add(t)
    db.commit()
    db.refresh(t)

    # Audit: record template creation
    write_audit(
        db, current_user, "communication.template_create", "communication_template",
        resource_id=t.id, resource_label=t.label,
        details={"name": t.name},
    )
    db.commit()

    return {"id": t.id, "name": t.name, "label": t.label}


# ─── Send email ───────────────────────────────────────────────────────────────
class SendEmailRequest(BaseModel):
    student_id: Optional[str] = None
    recipient_email: str
    recipient_name: str
    subject: str
    body: str
    message_type: str = "email"


@router.post("/send")
def send_communication(
    data: SendEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_trainer),
):
    # Trainers/Assessors may only email students directly (not supervisors,
    # coordinators, or arbitrary addresses) - and only via their own send.
    if current_user.role == "trainer":
        if not data.student_id:
            raise HTTPException(403, "Trainers/Assessors can only email students")
        student = db.query(Student).filter(Student.id == data.student_id).first()
        if not student or not student.email or student.email.strip().lower() != data.recipient_email.strip().lower():
            raise HTTPException(403, "Trainers/Assessors can only email the student's own address on file")

    html_body = _base_template(
        f"<h2>{data.subject}</h2><p>{data.body.replace(chr(10), '<br>')}</p>"
    )
    error_msg = None
    try:
        success = send_email(data.recipient_email, data.recipient_name, data.subject, html_body, data.body)
    except Exception as exc:
        success = False
        error_msg = str(exc)
        logger.error(f"send_communication error: {exc}")

    comm = Communication(
        student_id=data.student_id or None,
        sender_id=current_user.id,
        recipient_email=data.recipient_email,
        recipient_name=data.recipient_name,
        message_type="email",
        subject=data.subject,
        body=data.body,
        sent_successfully=success,
        error_message=error_msg,
    )
    db.add(comm)
    db.commit()

    # Audit: record communication send
    write_audit(
        db, current_user, "communication.send", "communication",
        resource_id=comm.id, resource_label=f"Email to {comm.recipient_name} ({comm.recipient_email})",
        details={"student_id": comm.student_id, "subject": comm.subject, "message_type": comm.message_type, "sent_successfully": comm.sent_successfully},
    )
    db.commit()

    return {"message": "Email sent" if success else "Email failed", "success": success, "error": error_msg}


# ─── Send SMS ─────────────────────────────────────────────────────────────────
class SendSMSRequest(BaseModel):
    student_id: Optional[str] = None
    recipient_phone: str
    recipient_name: str
    body: str


@router.post("/send-sms")
def send_sms_message(
    data: SendSMSRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    error_msg = None
    try:
        success = send_sms(data.recipient_phone, data.body)
    except Exception as exc:
        success = False
        error_msg = str(exc)
        logger.error(f"send_sms_message error: {exc}")

    comm = Communication(
        student_id=data.student_id or None,
        sender_id=current_user.id,
        recipient_phone=data.recipient_phone,
        recipient_name=data.recipient_name,
        message_type="sms",
        body=data.body,
        sent_successfully=success,
        error_message=error_msg,
    )
    db.add(comm)
    db.commit()

    # Audit: record communication send
    write_audit(
        db, current_user, "communication.send", "communication",
        resource_id=comm.id, resource_label=f"SMS to {comm.recipient_name} ({comm.recipient_phone})",
        details={"student_id": comm.student_id, "message_type": comm.message_type, "sent_successfully": comm.sent_successfully},
    )
    db.commit()

    return {"message": "SMS sent" if success else "SMS failed", "success": success, "error": error_msg}


# ─── Send template email ──────────────────────────────────────────────────────
class SendTemplateRequest(BaseModel):
    student_id: str
    template: str  # template name (slug)
    # Allow caller to override subject/body before sending
    custom_subject: Optional[str] = None
    custom_body: Optional[str] = None


@router.post("/send-template")
def send_template_email(
    data: SendTemplateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Send a template email. If custom_subject / custom_body are supplied they
    override the stored template, enabling in-UI editing before sending.
    """
    student = db.query(Student).filter(Student.id == data.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    templates = {t["name"]: t for t in _get_templates(db)}
    if data.template not in templates:
        raise HTTPException(
            status_code=400,
            detail=f"Template '{data.template}' not found. Available: {list(templates.keys())}",
        )

    tmpl = templates[data.template]
    subject = (data.custom_subject or tmpl["subject_template"]).format(student_name=student.full_name)
    body = (data.custom_body or tmpl["body_template"]).format(student_name=student.full_name)

    if not student.email:
        return {"message": "Student has no email address on file", "success": False}

    error_msg = None
    try:
        html = _base_template(f"<h2>{subject}</h2><p>{body.replace(chr(10), '<br>')}</p>")
        success = send_email(student.email, student.full_name, subject, html, body)
    except Exception as exc:
        success = False
        error_msg = str(exc)
        logger.error(f"Template email error: {exc}")

    comm = Communication(
        student_id=data.student_id,
        sender_id=current_user.id,
        recipient_email=student.email,
        recipient_name=student.full_name,
        message_type="email",
        subject=subject,
        body=body,
        template_used=data.template,
        sent_successfully=success,
        error_message=error_msg,
    )
    db.add(comm)
    db.commit()

    # Audit: record communication send
    write_audit(
        db, current_user, "communication.send", "communication",
        resource_id=comm.id, resource_label=f"Template email to {comm.recipient_name} ({comm.recipient_email})",
        details={"student_id": comm.student_id, "template_used": comm.template_used, "subject": comm.subject, "sent_successfully": comm.sent_successfully},
    )
    db.commit()

    return {
        "message": "Template email sent" if success else "Template email failed",
        "success": success,
        "error": error_msg,
    }


# ─── Automated Reminder Email catalog + summary log ──────────────────────────
# Static description of every automated (scheduler-driven) reminder email,
# shown under Communications -> Automated Reminder Email. Kept separate from
# the editable EmailTemplate rows above, since these are scheduler-triggered
# system emails, not manually-composed templates.
_AUTOMATED_REMINDER_CATALOG = [
    {
        "name": "Visit Advance Reminder",
        "recipients": "Student, trainer/assessor",
        "frequency": "14, 7, 3, and 1 day before each scheduled appointment",
    },
    {
        "name": "Visit Imminent Reminder",
        "recipients": "Student, trainer/assessor, site supervisor",
        "frequency": "48 hours and 24 hours before each scheduled appointment",
    },
    {
        "name": "Compliance Document Expiring",
        "recipients": "Student",
        "frequency": "30-day notice before a compliance document expires",
    },
    {
        "name": "Low Attendance Alert",
        "recipients": "Student",
        "frequency": "Checked daily - sent when hours completed are under 50% with under 30 days left in placement",
    },
    {
        "name": "Supervisor Feedback Pending",
        "recipients": "Trainer/assessor",
        "frequency": "3, 7, and 14 days after a completed visit with no feedback logged (stops once feedback is entered)",
    },
    {
        "name": "Placement Hours Log Reminder",
        "recipients": "Student",
        "frequency": "Fortnightly (every 14 days), to any student behind on required placement hours",
    },
    {
        "name": "Monthly Visit Reminder",
        "recipients": "Student, trainer/assessor",
        "frequency": "1st of each month, for any visit scheduled in the next 30 days",
    },
    {
        "name": "Compliance Documents Reminder (Bulk)",
        "recipients": "Student",
        "frequency": "1st of each month, to any student missing compliance documents",
    },
]

_REMINDER_LABELS = {
    "hours_log_reminder": "Placement Hours Log Reminder",
    "compliance_expiry_30d": "Compliance Document Expiring",
    "low_attendance_alert": "Low Attendance Alert",
    "compliance_reminder_bulk": "Compliance Documents Reminder (Bulk)",
}
_VISIT_RE = re.compile(r"^visit_reminder_.+_(\d+)d$")
_FEEDBACK_RE = re.compile(r"^feedback_pending_.+_(\d+)d$")
_MONTHLY_VISIT_RE = re.compile(r"^monthly_visit_reminder_.+_\d{4}-\d{2}$")


def _classify_reminder(template_used: Optional[str]) -> Optional[str]:
    """Map a Communication.template_used dedup key to a human-readable reminder name."""
    if not template_used:
        return None
    if template_used in _REMINDER_LABELS:
        return _REMINDER_LABELS[template_used]
    m = _VISIT_RE.match(template_used)
    if m:
        days = int(m.group(1))
        return "Visit Imminent Reminder" if days in (1, 2) else "Visit Advance Reminder"
    m = _FEEDBACK_RE.match(template_used)
    if m:
        return "Supervisor Feedback Pending"
    if _MONTHLY_VISIT_RE.match(template_used):
        return "Monthly Visit Reminder"
    return None


@router.get("/reminder-catalog")
def get_reminder_catalog(
    current_user: User = Depends(get_current_user),
):
    """Static list of every automated reminder email and how often it's sent."""
    return {"reminders": _AUTOMATED_REMINDER_CATALOG}


@router.get("/reminder-summary")
def get_reminder_summary(
    days: int = 90,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Aggregated log of automated reminder sends - one row per reminder type per
    day, with how many distinct students were reminded. Detailed per-student
    records remain available in the regular Communications list below.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = db.query(Communication).filter(Communication.sent_at >= cutoff).all()

    buckets = {}
    for c in rows:
        label = _classify_reminder(c.template_used)
        if not label:
            continue
        day_key = c.sent_at.date().isoformat() if c.sent_at else "unknown"
        key = (label, day_key)
        b = buckets.setdefault(key, {"student_ids": set(), "last_sent_at": None, "success_count": 0, "total": 0})
        if c.student_id:
            b["student_ids"].add(c.student_id)
        b["total"] += 1
        if c.sent_successfully:
            b["success_count"] += 1
        if c.sent_at and (b["last_sent_at"] is None or c.sent_at > b["last_sent_at"]):
            b["last_sent_at"] = c.sent_at

    summary = []
    for (label, day_key), b in buckets.items():
        summary.append({
            "reminder": label,
            "date": day_key,
            "sent_at": str(b["last_sent_at"]) if b["last_sent_at"] else None,
            "student_count": len(b["student_ids"]),
            "total_sent": b["total"],
            "success_count": b["success_count"],
        })

    summary.sort(key=lambda r: (r["date"], r["reminder"]), reverse=True)
    return {"summary": summary}
