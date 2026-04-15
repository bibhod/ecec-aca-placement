"""
Compliance API
Fixes:
  Issue 4  — five specific compliance document types with file upload provision
  Issue 8  — functional file upload within Add Document (combined create + upload)
  Issue 12 — document type filter shows only the five required types
"""
import os, uuid, shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from datetime import date, datetime

from app.database import get_db
from app.models import ComplianceDocument, Student, User, COMPLIANCE_DOC_TYPE_CHOICES
from app.utils.auth import get_current_user

router = APIRouter()

# Directory for uploaded compliance files
UPLOAD_DIR = "uploads/compliance"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Human-readable labels for the five required document types (Issue 4, 12)
DOC_TYPE_LABELS = {
    "working_with_children_check":   "Working with Children Check",
    "national_police_check":          "National Police Check",
    "first_aid_certificate":          "Valid First Aid Certificate (including CPR)",
    "work_placement_agreement":       "Work Placement Agreement",
    "memorandum_of_understanding":    "Memorandum of Understanding (MOU)",
}


def doc_to_dict(d: ComplianceDocument) -> dict:
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

    return {
        "id": d.id,
        "student_id": d.student_id,
        "document_type": d.document_type,
        "document_type_label": DOC_TYPE_LABELS.get(d.document_type, d.document_type.replace("_", " ").title()),
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
    result = [doc_to_dict(d) for d in docs]
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
        dd = doc_to_dict(d)
        dd["student_name"] = student.full_name if student else "Unknown"
        dd["campus"] = student.campus if student else None
        result.append(dd)
    return result


# ─── Create with optional file upload (Issue 8) ──────────────────────────────
class DocCreate(BaseModel):
    student_id: str
    document_type: str
    document_number: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


@router.post("")
def create_document(
    data: DocCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
        document_number=data.document_number,
        issue_date=date.fromisoformat(data.issue_date) if data.issue_date else None,
        expiry_date=date.fromisoformat(data.expiry_date) if data.expiry_date else None,
        verified=False,
        notes=data.notes,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc_to_dict(doc)


@router.post("/upload-with-doc")
async def create_document_with_upload(
    student_id: str = Form(...),
    document_type: str = Form(...),
    document_number: str = Form(""),
    issue_date: str = Form(""),
    expiry_date: str = Form(""),
    notes: str = Form(""),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a compliance document AND optionally attach a file in one request.
    Issue 8 — functional file upload within Add Document.
    """
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    if document_type not in COMPLIANCE_DOC_TYPE_CHOICES:
        raise HTTPException(status_code=400, detail=f"Invalid document type.")

    doc = ComplianceDocument(
        student_id=student_id,
        document_type=document_type,
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
):
    doc = db.query(ComplianceDocument).filter(ComplianceDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.verified = True
    doc.verified_by = current_user.full_name
    doc.verified_at = date.today()
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
    current_user: User = Depends(get_current_user),
):
    doc = db.query(ComplianceDocument).filter(ComplianceDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
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
    return doc_to_dict(doc)


# ─── Delete ───────────────────────────────────────────────────────────────────
@router.delete("/{doc_id}")
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(ComplianceDocument).filter(ComplianceDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(doc)
    db.commit()
    return {"message": "Document deleted"}
