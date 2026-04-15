"""
Communications API — fixed version.
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
from datetime import datetime
import logging

from app.database import get_db
from app.models import Communication, Student, User, EmailTemplate
from app.utils.auth import get_current_user
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
            "• Memorandum of Understanding (MOU)\n\n"
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
    current_user: User = Depends(get_current_user),
):
    """Edit an existing email template (Issue 6 — template editing)."""
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
):
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
        student_id=data.student_id,
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
    current_user: User = Depends(get_current_user),
):
    error_msg = None
    try:
        success = send_sms(data.recipient_phone, data.body)
    except Exception as exc:
        success = False
        error_msg = str(exc)
        logger.error(f"send_sms_message error: {exc}")

    comm = Communication(
        student_id=data.student_id,
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
    current_user: User = Depends(get_current_user),
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
    return {
        "message": "Template email sent" if success else "Template email failed",
        "success": success,
        "error": error_msg,
    }
