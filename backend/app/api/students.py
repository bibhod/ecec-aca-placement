"""
Students API
Fixes:
  Issue 9  — support all four qualifications (CHC30121/50121 superseded + CHC30125/50125)
  Issue 13 — bulk import from CSV/Excel
  Issue 17 — bulk upload endpoint
"""
import csv, io, uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List
from pydantic import BaseModel
from datetime import date

from app.database import get_db
from app.models import Student, PlacementCentre, ComplianceDocument, HoursLog, User, QUALIFICATION_CHOICES
from app.utils.auth import get_current_user

router = APIRouter()


def student_to_dict(s: Student, db: Session) -> dict:
    centre = s.placement_centre
    docs = db.query(ComplianceDocument).filter(ComplianceDocument.student_id == s.id).all()
    today = date.today()

    # A student is only compliant when ALL 4 required doc types are submitted
    REQUIRED_4 = ['working_with_children_check', 'first_aid_certificate',
                  'work_placement_agreement', 'memorandum_of_understanding']
    submitted_types = {d.document_type for d in docs}
    required_submitted_count = sum(1 for t in REQUIRED_4 if t in submitted_types)
    missing_count = len(REQUIRED_4) - required_submitted_count

    if missing_count > 0:
        compliance_status = "pending"
    else:
        # All 4 submitted — check expiry on the latest per required type
        latest_docs: dict = {}
        for d in docs:
            if d.document_type in REQUIRED_4:
                existing = latest_docs.get(d.document_type)
                if not existing or (d.created_at or date.min) > (existing.created_at or date.min):
                    latest_docs[d.document_type] = d
        expired = any(d.expiry_date and d.expiry_date < today for d in latest_docs.values())
        compliance_status = "expired" if expired else "compliant"

    return {
        "id": s.id,
        "student_id": s.student_id,
        "full_name": s.full_name,
        "email": s.email,
        "phone": s.phone,
        "date_of_birth": str(s.date_of_birth) if s.date_of_birth else None,
        "qualification": s.qualification,
        "campus": s.campus,
        "status": s.status,
        "course_start_date": str(s.course_start_date) if s.course_start_date else None,
        "course_end_date": str(s.course_end_date) if s.course_end_date else None,
        "placement_centre_id": s.placement_centre_id,
        "placement_start_date": str(s.placement_start_date) if s.placement_start_date else None,
        "placement_end_date": str(s.placement_end_date) if s.placement_end_date else None,
        "required_hours": s.required_hours,
        "completed_hours": s.completed_hours,
        "hours_percentage": round((s.completed_hours / s.required_hours * 100) if s.required_hours else 0, 1),
        "coordinator_id": s.coordinator_id,
        "preferred_suburb": getattr(s, "preferred_suburb", None),
        "preferred_state": getattr(s, "preferred_state", None),
        "notes": s.notes,
        "compliance_status": compliance_status,
        "compliance_submitted_count": required_submitted_count,
        "compliance_missing_count": missing_count,
        "placement_site": {
            "id": centre.id,
            "centre_name": centre.centre_name,
            "address": ", ".join(filter(None, [centre.address, centre.suburb, centre.state, centre.postcode])),
            "supervisor_name": centre.supervisor_name,
            "supervisor_email": centre.supervisor_email,
            "supervisor_phone": centre.supervisor_phone,
        } if centre else None,
        "compliance_documents": [
            {
                "id": d.id,
                "document_type": d.document_type,
                "document_number": d.document_number,
                "issue_date": str(d.issue_date) if d.issue_date else None,
                "expiry_date": str(d.expiry_date) if d.expiry_date else None,
                "verified": d.verified,
                "verified_by": d.verified_by,
                "verified_at": str(d.verified_at) if d.verified_at else None,
                "file_url": d.file_url,
                "notes": d.notes,
                "status": (
                    "expired" if d.expiry_date and d.expiry_date < today
                    else "expiring_soon" if d.expiry_date and (d.expiry_date - today).days <= 30
                    else "valid" if d.verified
                    else "pending"
                ),
            }
            for d in docs
        ],
        "created_at": str(s.created_at) if s.created_at else None,
    }


@router.get("")
def list_students(
    search: Optional[str] = None,
    campus: Optional[str] = None,
    qualification: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Student)
    if search:
        q = q.filter(or_(
            Student.full_name.ilike(f"%{search}%"),
            Student.student_id.ilike(f"%{search}%"),
            Student.email.ilike(f"%{search}%"),
        ))
    if campus:
        q = q.filter(Student.campus == campus)
    if qualification:
        q = q.filter(Student.qualification == qualification)
    if status:
        q = q.filter(Student.status == status)
    students = q.order_by(Student.full_name).all()
    return [student_to_dict(s, db) for s in students]


@router.get("/qualifications")
def get_qualifications():
    """Return all valid qualification codes and labels (Issue 9)."""
    labels = {
        "CHC30121": "CHC30121 – Certificate III in Early Childhood Education and Care (Superseded)",
        "CHC50121": "CHC50121 – Diploma of Early Childhood Education and Care (Superseded)",
        "CHC30125": "CHC30125 – Certificate III in Early Childhood Education and Care",
        "CHC50125": "CHC50125 – Diploma of Early Childhood Education and Care",
    }
    return [{"value": k, "label": v} for k, v in labels.items()]


@router.get("/{student_id}")
def get_student(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(Student).filter(Student.id == student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student not found")
    return student_to_dict(s, db)


class StudentCreate(BaseModel):
    student_id: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    qualification: str
    campus: str
    status: str = "active"
    course_start_date: Optional[str] = None
    course_end_date: Optional[str] = None
    placement_centre_id: Optional[str] = None
    placement_start_date: Optional[str] = None
    placement_end_date: Optional[str] = None
    required_hours: float = 160
    coordinator_id: Optional[str] = None
    preferred_suburb: Optional[str] = None
    preferred_state: Optional[str] = None
    notes: Optional[str] = None


@router.post("")
def create_student(
    data: StudentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(Student).filter(Student.student_id == data.student_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Student ID already exists")

    # Validate qualification (Issue 9)
    if data.qualification not in QUALIFICATION_CHOICES:
        raise HTTPException(status_code=400, detail=f"Invalid qualification. Valid: {QUALIFICATION_CHOICES}")

    # Auto-set hours based on qualification
    required_hours = data.required_hours
    if data.qualification in ("CHC50121", "CHC50125") and required_hours == 160:
        required_hours = 288

    s = Student(
        student_id=data.student_id,
        full_name=data.full_name,
        email=data.email,
        phone=data.phone,
        date_of_birth=date.fromisoformat(data.date_of_birth) if data.date_of_birth else None,
        qualification=data.qualification,
        campus=data.campus,
        status=data.status,
        course_start_date=date.fromisoformat(data.course_start_date) if data.course_start_date else None,
        course_end_date=date.fromisoformat(data.course_end_date) if data.course_end_date else None,
        placement_centre_id=data.placement_centre_id,
        placement_start_date=date.fromisoformat(data.placement_start_date) if data.placement_start_date else None,
        placement_end_date=date.fromisoformat(data.placement_end_date) if data.placement_end_date else None,
        required_hours=required_hours,
        completed_hours=0,
        coordinator_id=data.coordinator_id,
        preferred_suburb=data.preferred_suburb,
        preferred_state=data.preferred_state,
        notes=data.notes,
    )
    db.add(s)
    db.commit()
    db.refresh(s)

    if s.email:
        from app.services.email_service import email_welcome_student
        coordinator = db.query(User).filter(User.id == s.coordinator_id).first() if s.coordinator_id else current_user
        email_welcome_student(
            student_name=s.full_name,
            student_email=s.email,
            student_id=s.student_id,
            qualification=s.qualification,
            campus=s.campus,
            coordinator_name=coordinator.full_name if coordinator else current_user.full_name,
            coordinator_email=coordinator.email if coordinator else current_user.email,
            frontend_url="",
        )

    return student_to_dict(s, db)


@router.put("/{student_id}")
def update_student(
    student_id: str,
    data: StudentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(Student).filter(Student.id == student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student not found")

    if data.qualification not in QUALIFICATION_CHOICES:
        raise HTTPException(status_code=400, detail=f"Invalid qualification. Valid: {QUALIFICATION_CHOICES}")

    date_fields = {
        "course_start_date", "course_end_date",
        "placement_start_date", "placement_end_date", "date_of_birth",
    }
    for field, val in data.dict(exclude_none=True).items():
        if field in date_fields:
            setattr(s, field, date.fromisoformat(val) if val else None)
        else:
            if hasattr(s, field):
                setattr(s, field, val)

    db.commit()
    db.refresh(s)
    return student_to_dict(s, db)


@router.delete("/{student_id}")
def delete_student(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(Student).filter(Student.id == student_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Student not found")
    db.delete(s)
    db.commit()
    return {"message": "Student deleted"}


# ─── Issue 13 / 17 — Bulk Import from CSV/Excel ──────────────────────────────
@router.post("/bulk-import")
async def bulk_import_students(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Import students from a CSV or Excel (.xlsx) file.
    Expected CSV columns (header row required):
      student_id, full_name, email, phone, qualification, campus,
      status, required_hours, course_start_date, course_end_date
    Issue 13 — fixes broken Bulk Import.
    """
    filename = file.filename.lower()
    content = await file.read()

    rows = []
    if filename.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
        rows = list(reader)
    elif filename.endswith((".xlsx", ".xls")):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content))
        ws = wb.active
        headers = [str(c.value).strip() for c in next(ws.iter_rows(min_row=1, max_row=1))]
        for row in ws.iter_rows(min_row=2, values_only=True):
            rows.append(dict(zip(headers, [str(v).strip() if v is not None else "" for v in row])))
    else:
        raise HTTPException(status_code=400, detail="Only .csv and .xlsx files are supported")

    created, skipped, errors = [], [], []
    for i, row in enumerate(rows, start=2):
        sid = row.get("student_id", "").strip()
        name = row.get("full_name", "").strip()
        qual = row.get("qualification", "").strip()
        campus = row.get("campus", "sydney").strip()

        if not sid or not name or not qual:
            errors.append({"row": i, "error": "Missing required fields: student_id, full_name, qualification"})
            continue

        if qual not in QUALIFICATION_CHOICES:
            errors.append({"row": i, "error": f"Invalid qualification '{qual}'"})
            continue

        existing = db.query(Student).filter(Student.student_id == sid).first()
        if existing:
            skipped.append({"row": i, "student_id": sid, "reason": "Already exists"})
            continue

        try:
            req_hours = float(row.get("required_hours", 0) or 0)
            if req_hours == 0:
                req_hours = 288 if qual in ("CHC50121", "CHC50125") else 160

            s = Student(
                student_id=sid,
                full_name=name,
                email=row.get("email") or None,
                phone=row.get("phone") or None,
                qualification=qual,
                campus=campus,
                status=row.get("status", "active"),
                required_hours=req_hours,
                completed_hours=0,
                course_start_date=date.fromisoformat(row["course_start_date"]) if row.get("course_start_date") else None,
                course_end_date=date.fromisoformat(row["course_end_date"]) if row.get("course_end_date") else None,
            )
            db.add(s)
            created.append(sid)
        except Exception as e:
            errors.append({"row": i, "student_id": sid, "error": str(e)})

    db.commit()
    return {
        "message": f"Import complete: {len(created)} created, {len(skipped)} skipped, {len(errors)} errors",
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }
