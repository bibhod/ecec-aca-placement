"""
Compliance API
Fixes:
  Issue 4  - five specific compliance document types with file upload provision
  Issue 8  - functional file upload within Add Document (combined create + upload)
  Issue 12 - document type filter shows only the five required types
"""
import os, uuid, shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from datetime import date, datetime

from app.database import get_db
from app.models import (
    ComplianceDocument, Student, User, COMPLIANCE_DOC_TYPE_CHOICES,
    QUALIFICATION_LEVEL_CHOICES, qualification_level_for_code, required_hours_for_level,
)
from app.utils.auth import get_current_user, require_admin
from app.api.audit import write_audit

router = APIRouter()

# Directory for uploaded compliance files
UPLOAD_DIR = "uploads/compliance"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# The 4 required compliance document types
REQUIRED_DOC_TYPES = {
    "working_with_children_check": "Working with Children Check",
    "first_aid_certificate":       "Valid First Aid Certificate (including CPR)",
    "work_placement_agreement":    "Work Placement Agreement",
    "memorandum_of_understanding": "Memorandum of Understanding (MOU)",
}

# Keep legacy label map for backward compatibility with existing data
DOC_TYPE_LABELS = {**REQUIRED_DOC_TYPES, "national_police_check": "National Police Check"}


def _extract_qualification_level(d: ComplianceDocument) -> Optional[str]:
    """
    Qualification level ("Cert III" / "Diploma") a WPA/MOU document applies to.
    Prefers the dedicated column; falls back to parsing the legacy
    "Qualification: X" notes prefix for documents created before that column
    existed.
    """
    if d.qualification_level:
        return d.qualification_level
    if d.notes:
        for level in QUALIFICATION_LEVEL_CHOICES:
            if d.notes.strip().startswith(f"Qualification: {level}"):
                return level
    return None


WPA_MOU_DOC_TYPES = ("work_placement_agreement", "memorandum_of_understanding")


# ─── Required-hours helper (single source of truth) ──────────────────────────
# Previously duplicated (with copy-pasted qualification-substring logic) in two
# separate reminder functions below. Now both defer to the same models.py
# mapping used everywhere else (Hours Tracking, WPA/MOU status, etc.) so a
# student's "required hours" figure can't drift between screens/emails.
def _required_hours_for_student(student) -> float:
    level = qualification_level_for_code(student.qualification)
    return required_hours_for_level(level) or float(student.required_hours or 0)


def _qualification_label(student) -> str:
    level = qualification_level_for_code(student.qualification)
    if level == "Cert III":
        return f"Certificate III in ECEC ({student.qualification})"
    if level == "Diploma":
        return f"Diploma of ECEC ({student.qualification})"
    return student.qualification or "Unknown"


def doc_to_dict(d: ComplianceDocument, default_level: Optional[str] = None) -> dict:
    """
    default_level - the student's own qualification level (Cert III / Diploma),
    used as a fallback for WPA/MOU documents that predate qualification-level
    tagging and have no level recorded on the document itself. Non-WPA/MOU
    document types never show a level.
    """
    today = date.today()
    status = "pending"
    if d.expiry_date:
        if d.expiry_date < today:
            status = "expired"
        elif (d.expiry_date - today).days <= 30:
            status = "expiring_soon"
        elif d.verified:
            status = "valid"
    elif d.verified:
        status = "valid"

    level = _extract_qualification_level(d)
    if not level and default_level and d.document_type in WPA_MOU_DOC_TYPES:
        level = default_level

    return {
        "id": d.id,
        "student_id": d.student_id,
        "document_type": d.document_type,
        "document_type_label": DOC_TYPE_LABELS.get(d.document_type, d.document_type.replace("_", " ").title()),
        "qualification_level": level,
        "document_number": d.document_number,
        "issue_date": str(d.issue_date) if d.issue_date else None,
        "expiry_date": str(d.expiry_date) if d.expiry_date else None,
        "verified": d.verified,
        "verified_by": d.verified_by,
        "verified_at": str(d.verified_at) if d.verified_at else None,
        "file_url": d.file_url,
        "file_name": getattr(d, "file_name", None),
        "notes": d.notes,
        "status": status,
        "days_until_expiry": (
            (d.expiry_date - today).days if d.expiry_date and d.expiry_date >= today else None
        ),
        "created_at": str(d.created_at) if d.created_at else None,
    }


# ─── List ─────────────────────────────────────────────────────────────────────
@router.get("")
def list_compliance(
    student_id: Optional[str] = None,
    document_type: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ComplianceDocument)
    if student_id:
        q = q.filter(ComplianceDocument.student_id == student_id)
    if document_type:
        q = q.filter(ComplianceDocument.document_type == document_type)
    docs = q.all()

    # Map each student to their enrolled qualification level, used as a
    # fallback level for WPA/MOU documents that predate level tagging.
    student_ids = {d.student_id for d in docs}
    level_by_student = {
        s.id: qualification_level_for_code(s.qualification)
        for s in db.query(Student).filter(Student.id.in_(student_ids)).all()
    } if student_ids else {}

    result = [doc_to_dict(d, default_level=level_by_student.get(d.student_id)) for d in docs]
    if status:
        result = [d for d in result if d["status"] == status]
    return result


@router.get("/types")
def get_document_types():
    """Return the five required compliance document types for front-end dropdowns."""
    return [{"value": k, "label": v} for k, v in DOC_TYPE_LABELS.items()]


@router.get("/expiring")
def expiring_docs(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    docs = db.query(ComplianceDocument).filter(
        ComplianceDocument.expiry_date >= today,
        ComplianceDocument.expiry_date <= date.fromordinal(today.toordinal() + days),
    ).order_by(ComplianceDocument.expiry_date).all()

    result = []
    for d in docs:
        student = db.query(Student).filter(Student.id == d.student_id).first()
        dd = doc_to_dict(d, default_level=qualification_level_for_code(student.qualification) if student else None)
        dd["student_name"] = student.full_name if student else "Unknown"
        dd["campus"] = student.campus if student else None
        result.append(dd)
    return result


# ─── Create with optional file upload (Issue 8) ──────────────────────────────
class DocCreate(BaseModel):
    student_id: str
    document_type: str
    qualification_level: Optional[str] = None
    document_number: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


@router.post("")
def create_document(
    data: DocCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    student = db.query(Student).filter(Student.id == data.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Validate document type against the five required types
    if data.document_type not in COMPLIANCE_DOC_TYPE_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid document type. Valid types: {COMPLIANCE_DOC_TYPE_CHOICES}",
        )

    doc = ComplianceDocument(
        student_id=data.student_id,
        document_type=data.document_type,
        qualification_level=data.qualification_level,
        document_number=data.document_number,
        issue_date=date.fromisoformat(data.issue_date) if data.issue_date else None,
        expiry_date=date.fromisoformat(data.expiry_date) if data.expiry_date else None,
        verified=False,
        notes=data.notes,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    write_audit(
        db, current_user, "compliance.add", "compliance_document",
        resource_id=doc.id,
        resource_label=f"{doc.document_type.replace('_', ' ').title()} for student {doc.student_id}",
        details={"document_type": doc.document_type, "student_id": doc.student_id},
    )
    db.commit()

    return doc_to_dict(doc)


@router.post("/upload-with-doc")
async def create_document_with_upload(
    student_id: str = Form(...),
    document_type: str = Form(...),
    document_number: str = Form(""),
    issue_date: str = Form(""),
    expiry_date: str = Form(""),
    notes: str = Form(""),
    qualification: str = Form(""),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Create a compliance document AND optionally attach a file in one request.
    Issue 8 - functional file upload within Add Document.
    qualification - optional, for WPA/MOU rows; prepended to notes if provided.
    """
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    if document_type not in COMPLIANCE_DOC_TYPE_CHOICES:
        raise HTTPException(status_code=400, detail=f"Invalid document type.")

    # Prepend qualification to notes for WPA/MOU documents
    if qualification:
        notes = f"Qualification: {qualification}\n{notes}".strip() if notes else f"Qualification: {qualification}"

    doc = ComplianceDocument(
        student_id=student_id,
        document_type=document_type,
        qualification_level=qualification or None,
        document_number=document_number or None,
        issue_date=date.fromisoformat(issue_date) if issue_date else None,
        expiry_date=date.fromisoformat(expiry_date) if expiry_date else None,
        verified=False,
        notes=notes or None,
    )
    db.add(doc)
    db.flush()   # get the ID before commit

    if file and file.filename:
        ext = os.path.splitext(file.filename)[1]
        filename = f"{doc.id}_{uuid.uuid4().hex[:8]}{ext}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, "wb") as f:
            shutil.copyfileobj(file.file, f)
        doc.file_url = f"/uploads/compliance/{filename}"
        doc.file_name = file.filename

    db.commit()
    db.refresh(doc)
    return doc_to_dict(doc)


# ─── File upload for existing document (Issue 8) ─────────────────────────────
@router.post("/{doc_id}/upload")
async def upload_document_file(
    doc_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    doc = db.query(ComplianceDocument).filter(ComplianceDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    ext = os.path.splitext(file.filename)[1]
    filename = f"{doc_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    doc.file_url = f"/uploads/compliance/{filename}"
    doc.file_name = file.filename
    db.commit()
    return {"file_url": doc.file_url, "file_name": doc.file_name}


# ─── Verify ───────────────────────────────────────────────────────────────────
@router.put("/{doc_id}/verify")
def verify_document(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    doc = db.query(ComplianceDocument).filter(ComplianceDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.verified = True
    doc.verified_by = current_user.full_name
    doc.verified_at = date.today()
    db.commit()

    # Audit trail gap fix: verifying a document previously left no audit
    # record at all, even though deleting one (compliance.delete) did.
    write_audit(
        db, current_user, "compliance.verify", "compliance_document",
        resource_id=doc.id,
        resource_label=f"{doc.document_type.replace('_', ' ').title()} for student {doc.student_id}",
        details={"document_type": doc.document_type, "student_id": doc.student_id},
    )
    db.commit()

    return doc_to_dict(doc)


# ─── Update ───────────────────────────────────────────────────────────────────
class DocUpdate(BaseModel):
    document_number: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None
    verified: Optional[bool] = None


@router.put("/{doc_id}")
def update_document(
    doc_id: str,
    data: DocUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    doc = db.query(ComplianceDocument).filter(ComplianceDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    updated_fields = list(data.dict(exclude_none=True).keys())
    if data.document_number is not None:
        doc.document_number = data.document_number
    if data.issue_date:
        doc.issue_date = date.fromisoformat(data.issue_date)
    if data.expiry_date:
        doc.expiry_date = date.fromisoformat(data.expiry_date)
        doc.alert_sent = False
    if data.notes is not None:
        doc.notes = data.notes
    if data.verified is not None:
        doc.verified = data.verified
        if data.verified:
            doc.verified_by = current_user.full_name
            doc.verified_at = date.today()
    db.commit()

    # Audit trail gap fix: editing a document's details previously left no
    # audit record at all.
    if updated_fields:
        write_audit(
            db, current_user, "compliance.update", "compliance_document",
            resource_id=doc.id,
            resource_label=f"{doc.document_type.replace('_', ' ').title()} for student {doc.student_id}",
            details={"updated_fields": updated_fields},
        )
        db.commit()

    return doc_to_dict(doc)


# ─── Compliance Report - per-student document status ─────────────────────────
@router.get("/report")
def compliance_report(
    campus: Optional[str] = None,
    qualification: Optional[str] = None,
    missing_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns every active student with their compliance status for each of the
    4 required document types, plus a submitted count and list of outstanding docs.
    """
    q = db.query(Student).filter(Student.status == "current")
    if campus:
        q = q.filter(Student.campus == campus)
    if qualification:
        q = q.filter(Student.qualification == qualification)
    students = q.order_by(Student.full_name).all()

    result = []
    for s in students:
        docs = db.query(ComplianceDocument).filter(ComplianceDocument.student_id == s.id).all()
        submitted_types = {d.document_type for d in docs}

        doc_status = {}
        for dtype, dlabel in REQUIRED_DOC_TYPES.items():
            matching = [d for d in docs if d.document_type == dtype]
            if matching:
                latest = sorted(matching, key=lambda d: d.created_at or date.min, reverse=True)[0]
                dd = doc_to_dict(latest)
                doc_status[dtype] = {"submitted": True, "label": dlabel, "status": dd["status"], "verified": dd["verified"]}
            else:
                doc_status[dtype] = {"submitted": False, "label": dlabel, "status": "missing", "verified": False}

        submitted_count = sum(1 for v in doc_status.values() if v["submitted"])
        outstanding = [v["label"] for v in doc_status.values() if not v["submitted"]]
        fully_compliant = submitted_count == len(REQUIRED_DOC_TYPES)

        if missing_only and fully_compliant:
            continue

        result.append({
            "student_id": s.id,
            "student_ref": s.student_id,
            "student_name": s.full_name,
            "email": s.email,
            "campus": s.campus,
            "qualification": s.qualification,
            "submitted_count": submitted_count,
            "required_count": len(REQUIRED_DOC_TYPES),
            "fully_compliant": fully_compliant,
            "outstanding": outstanding,
            "documents": doc_status,
        })
    return result


# ─── WPA / MOU submission status by qualification level ──────────────────────
WPA_MOU_TYPES = {
    "work_placement_agreement":    "Work Placement Agreement (WPA)",
    "memorandum_of_understanding": "Memorandum of Understanding (MOU)",
}


def _student_relevant_levels(student, docs, hours_logs) -> list:
    """
    The set of qualification levels a student is relevant for: their own
    enrolled level, plus any level their existing WPA/MOU docs or hour logs
    reference (covers students transitioning between levels).
    """
    levels = []
    own_level = qualification_level_for_code(student.qualification)
    if own_level:
        levels.append(own_level)
    for d in docs:
        lvl = _extract_qualification_level(d)
        if lvl and lvl not in levels:
            levels.append(lvl)
    for l in hours_logs:
        lvl = l.qualification_level
        if lvl and lvl not in levels:
            levels.append(lvl)
    return levels or ["Unspecified"]


@router.get("/wpa-mou-status")
def wpa_mou_status_by_level(
    campus: Optional[str] = None,
    qualification_level: Optional[str] = None,
    missing_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    WPA and MOU submission status for every active student, broken down per
    qualification level ("Cert III" / "Diploma") rather than just per student.
    A student progressing across levels will get one row per level, each with
    its own WPA/MOU submission + verification status.
    """
    from app.models import HoursLog

    q = db.query(Student).filter(Student.status == "current")
    if campus:
        q = q.filter(Student.campus == campus)
    students = q.order_by(Student.full_name).all()

    result = []
    for s in students:
        docs = db.query(ComplianceDocument).filter(
            ComplianceDocument.student_id == s.id,
            ComplianceDocument.document_type.in_(list(WPA_MOU_TYPES.keys())),
        ).all()
        hours_logs = db.query(HoursLog).filter(HoursLog.student_id == s.id).all()
        levels = _student_relevant_levels(s, docs, hours_logs)

        for level in levels:
            if qualification_level and level != qualification_level:
                continue

            level_docs = [d for d in docs if (_extract_qualification_level(d) or levels[0]) == level]
            doc_status = {}
            for dtype, dlabel in WPA_MOU_TYPES.items():
                matching = [d for d in level_docs if d.document_type == dtype]
                if matching:
                    latest = sorted(matching, key=lambda d: d.created_at or date.min, reverse=True)[0]
                    dd = doc_to_dict(latest)
                    doc_status[dtype] = {
                        "submitted": True, "label": dlabel,
                        "status": dd["status"], "verified": dd["verified"],
                    }
                else:
                    doc_status[dtype] = {"submitted": False, "label": dlabel, "status": "missing", "verified": False}

            fully_submitted = all(v["submitted"] for v in doc_status.values())
            if missing_only and fully_submitted:
                continue

            result.append({
                "student_id": s.id,
                "student_ref": s.student_id,
                "student_name": s.full_name,
                "email": s.email,
                "campus": s.campus,
                "qualification": s.qualification,
                "qualification_level": level,
                "wpa": doc_status["work_placement_agreement"],
                "mou": doc_status["memorandum_of_understanding"],
                "fully_submitted": fully_submitted,
            })
    return result


# ─── Outstanding-documents helper (qualification-level aware) ────────────────
ABBREV = {
    "working_with_children_check": "Working with Children Check (WWCC)",
    "first_aid_certificate":       "First Aid Certificate (incl. CPR)",
    "work_placement_agreement":    "Work Placement Agreement (WPA)",
    "memorandum_of_understanding": "Memorandum of Understanding (MOU)",
}


def _outstanding_docs_for_student(db: Session, s: Student):
    """
    Outstanding compliance documents for a student. WWCC / First Aid are
    checked once per student as before. WPA / MOU are checked per relevant
    qualification level, since Feature: students logging hours across more
    than one level (e.g. Cert III -> Diploma) need a WPA and MOU submitted
    for each level, not just one overall.
    """
    from app.models import HoursLog

    docs = db.query(ComplianceDocument).filter(ComplianceDocument.student_id == s.id).all()
    hours_logs = db.query(HoursLog).filter(HoursLog.student_id == s.id).all()
    wpa_mou_docs = [d for d in docs if d.document_type in WPA_MOU_TYPES]
    levels = _student_relevant_levels(s, wpa_mou_docs, hours_logs)

    outstanding = []
    submitted_types = {d.document_type for d in docs}
    for dtype, label in REQUIRED_DOC_TYPES.items():
        if dtype in WPA_MOU_TYPES:
            continue
        if dtype not in submitted_types:
            outstanding.append(ABBREV.get(dtype, label))

    for level in levels:
        level_docs = [d for d in wpa_mou_docs if (_extract_qualification_level(d) or levels[0]) == level]
        level_submitted_types = {d.document_type for d in level_docs}
        suffix = f" - {level}" if level != "Unspecified" else ""
        for dtype, label in WPA_MOU_TYPES.items():
            if dtype not in level_submitted_types:
                outstanding.append(f"{ABBREV.get(dtype, label)}{suffix}")

    total_required = (len(REQUIRED_DOC_TYPES) - len(WPA_MOU_TYPES)) + len(WPA_MOU_TYPES) * len(levels)
    submitted_count = total_required - len(outstanding)
    return outstanding, submitted_count, total_required


# ─── Preview which students would receive reminders (no emails sent) ─────────
@router.get("/reminder-preview")
def get_reminder_preview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns the list of students who would receive a compliance reminder,
    including each student's outstanding documents (WPA/MOU broken out per
    qualification level) and a personalised email preview. No emails are sent.
    """
    students_list = db.query(Student).filter(Student.status == "current").all()
    recipients, compliant_count, no_email_count = [], 0, 0

    for s in students_list:
        if not s.email:
            no_email_count += 1
            continue
        outstanding_labels, submitted_count, total_required = _outstanding_docs_for_student(db, s)
        if not outstanding_labels:
            compliant_count += 1
            continue
        outstanding_txt = "\n".join(f"  - {item}" for item in outstanding_labels)
        email_preview = (
            f"Dear {s.full_name},\n\n"
            f"This is a reminder that the following compliance documents are still outstanding "
            f"for your work placement:\n\n{outstanding_txt}\n\n"
            f"You currently have {submitted_count} of {total_required} required "
            f"documents submitted.\n\n"
            "Please submit the outstanding documents as soon as possible to ensure your "
            "placement is not affected.\n\n"
            "If you have any questions, please contact your coordinator."
        )
        recipients.append({
            "student_id": s.id,
            "student_name": s.full_name,
            "email": s.email,
            "campus": s.campus,
            "submitted_count": submitted_count,
            "outstanding": outstanding_labels,
            "email_preview": email_preview,
        })

    return {
        "subject": "Action Required: Outstanding Compliance Documents",
        "recipient_count": len(recipients),
        "compliant_count": compliant_count,
        "no_email_count": no_email_count,
        "recipients": recipients,
    }


# ─── Send reminder emails to students with outstanding documents ──────────────
@router.post("/send-reminders")
def send_compliance_reminders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Send reminder emails to all active students who have outstanding compliance documents."""
    from app.services.email_service import send_email, _base_template
    from app.models import Communication

    students_list = db.query(Student).filter(Student.status == "current").all()
    sent, skipped = [], []

    for s in students_list:
        if not s.email:
            skipped.append({"student": s.full_name, "reason": "No email address"})
            continue

        outstanding_labels, submitted_count, total_required = _outstanding_docs_for_student(db, s)

        if not outstanding_labels:
            skipped.append({"student": s.full_name, "reason": "Fully compliant"})
            continue

        outstanding_list_html = "".join(f"<li>{item}</li>" for item in outstanding_labels)
        outstanding_list_txt = "\n".join(f"  - {item}" for item in outstanding_labels)
        subject = "Action Required: Outstanding Compliance Documents"
        body_text = (
            f"Dear {s.full_name},\n\n"
            f"This is a reminder that the following compliance documents are still outstanding "
            f"for your work placement:\n\n{outstanding_list_txt}\n\n"
            f"You currently have {submitted_count} of {total_required} required documents submitted.\n\n"
            "Please submit the outstanding documents as soon as possible to ensure your placement "
            "is not affected.\n\nIf you have any questions, please contact your coordinator."
        )
        html_content = f"""
<h2>Compliance Documents Reminder</h2>
<p>Dear {s.full_name},</p>
<p>This is a reminder that the following compliance documents are still outstanding for your work placement:</p>
<div class="highlight">
  <ul>{outstanding_list_html}</ul>
</div>
<p>You currently have <strong>{submitted_count} of {total_required}</strong> required documents submitted.</p>
<p>Please submit the outstanding documents as soon as possible to ensure your placement is not affected.</p>
<p>If you have any questions, please contact your coordinator.</p>
"""
        ok = send_email(s.email, s.full_name, subject, _base_template(html_content))

        # Record every attempt in the communications log
        comm = Communication(
            student_id=s.id,
            sender_id=current_user.id,
            recipient_email=s.email,
            recipient_name=s.full_name,
            message_type="email",
            subject=subject,
            body=body_text,
            template_used="compliance_reminder_bulk",
            sent_successfully=ok,
        )
        db.add(comm)

        if ok:
            sent.append({
                "student": s.full_name,
                "email": s.email,
                "outstanding": outstanding_labels,
                "submitted_count": submitted_count,
            })
        else:
            skipped.append({"student": s.full_name, "reason": "Email send failed"})

    db.commit()

    return {
        "message": f"Reminders sent to {len(sent)} students, {len(skipped)} skipped",
        "sent": sent,
        "skipped": skipped,
    }


# ─── Hours Reminder: Preview (no emails sent) ────────────────────────────────
@router.get("/hours-reminder-preview")
def get_hours_reminder_preview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns the list of students who have not yet met their required placement
    hours, including a personalised email preview for each. No emails are sent.
    Cert III (qualification contains '30') = 160 h required.
    Diploma  (qualification contains '50') = 288 h required.
    """
    students_list = db.query(Student).filter(Student.status == "current").all()
    recipients, met_count, no_email_count = [], 0, 0

    for s in students_list:
        if not s.email:
            no_email_count += 1
            continue
        required  = _required_hours_for_student(s)
        completed = float(s.completed_hours or 0)
        remaining = max(0.0, required - completed)
        qual_label = _qualification_label(s)

        if required > 0 and completed >= required:
            met_count += 1
            continue

        email_preview = (
            f"Dear {s.full_name},\n\n"
            f"This is a reminder that your placement hours are still outstanding.\n\n"
            f"  Qualification:   {qual_label}\n"
            f"  Required Hours:  {required:.0f} h\n"
            f"  Completed Hours: {completed:.1f} h\n"
            f"  Remaining Hours: {remaining:.1f} h\n\n"
            f"Please ensure you are submitting your placement hours log regularly so "
            f"your coordinator can track your progress.\n\n"
            f"If you have recently completed placement hours that have not been recorded, "
            f"please contact your coordinator to update your records as soon as possible."
        )
        recipients.append({
            "student_id":      s.id,
            "student_name":    s.full_name,
            "email":           s.email,
            "campus":          s.campus,
            "qualification":   qual_label,
            "completed_hours": completed,
            "required_hours":  required,
            "remaining_hours": remaining,
            "email_preview":   email_preview,
        })

    return {
        "subject":          "Reminder: Please Submit Your Placement Hours Log",
        "recipient_count":  len(recipients),
        "met_count":        met_count,
        "no_email_count":   no_email_count,
        "recipients":       recipients,
    }


# ─── Hours Reminder: Send ─────────────────────────────────────────────────────
@router.post("/send-hours-reminders")
def send_hours_reminders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Send 'Hours Log Submission Reminder' emails to students who haven't met their required hours."""
    from app.services.email_service import send_email, _base_template
    from app.models import Communication

    students_list = db.query(Student).filter(Student.status == "current").all()
    sent, skipped = [], []

    for s in students_list:
        if not s.email:
            skipped.append({"student": s.full_name, "reason": "No email address"})
            continue

        required  = _required_hours_for_student(s)
        completed = float(s.completed_hours or 0)
        remaining = max(0.0, required - completed)
        qual_label = _qualification_label(s)

        if required > 0 and completed >= required:
            skipped.append({"student": s.full_name, "reason": "Hours requirement met"})
            continue

        subject = "Reminder: Please Submit Your Placement Hours Log"
        body_text = (
            f"Dear {s.full_name},\n\n"
            f"This is a reminder that your placement hours are still outstanding.\n\n"
            f"  Qualification:   {qual_label}\n"
            f"  Required Hours:  {required:.0f} h\n"
            f"  Completed Hours: {completed:.1f} h\n"
            f"  Remaining Hours: {remaining:.1f} h\n\n"
            f"Please ensure you are submitting your placement hours log regularly so your "
            f"coordinator can track your progress.\n\n"
            f"If you have recently completed placement hours that have not been recorded, "
            f"please contact your coordinator to update your records as soon as possible."
        )
        rem_color = "red" if remaining > required * 0.5 else "darkorange"
        html_content = f"""
<h2>Placement Hours Log Reminder</h2>
<p>Dear {s.full_name},</p>
<p>This is a reminder that your placement hours are still outstanding and need to be submitted and kept up to date.</p>
<div class="highlight">
  <table>
    <tr><th>Qualification</th><td>{qual_label}</td></tr>
    <tr><th>Required Hours</th><td>{required:.0f} hours</td></tr>
    <tr><th>Completed Hours</th><td>{completed:.1f} hours</td></tr>
    <tr><th>Remaining Hours</th><td style="color:{rem_color};font-weight:bold">{remaining:.1f} hours</td></tr>
  </table>
</div>
<p>Please ensure you are submitting your placement hours log regularly so your coordinator can track your progress and support your completion.</p>
<p>If you have recently completed placement hours that have not yet been recorded, please contact your coordinator to update your records as soon as possible.</p>
"""
        ok = send_email(s.email, s.full_name, subject, _base_template(html_content))

        comm = Communication(
            student_id=s.id,
            sender_id=current_user.id,
            recipient_email=s.email,
            recipient_name=s.full_name,
            message_type="email",
            subject=subject,
            body=body_text,
            template_used="hours_log_reminder",
            sent_successfully=ok,
        )
        db.add(comm)

        if ok:
            sent.append({
                "student":         s.full_name,
                "email":           s.email,
                "completed_hours": completed,
                "required_hours":  required,
                "remaining_hours": remaining,
            })
        else:
            skipped.append({"student": s.full_name, "reason": "Email send failed"})

    db.commit()
    return {
        "message": f"Hours reminders sent to {len(sent)} students, {len(skipped)} skipped",
        "sent":    sent,
        "skipped": skipped,
    }


# ─── Delete ───────────────────────────────────────────────────────────────────
@router.delete("/{doc_id}")
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    doc = db.query(ComplianceDocument).filter(ComplianceDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    student_id = doc.student_id
    doc_type = doc.document_type
    doc_id = doc.id
    db.delete(doc)
    db.commit()

    write_audit(
        db, current_user, "compliance.delete", "compliance_document",
        resource_id=doc_id,
        resource_label=f"{doc_type.replace('_', ' ').title()} deleted",
        details={"document_type": doc_type, "student_id": student_id},
    )
    db.commit()

    return {"message": "Document deleted"}
