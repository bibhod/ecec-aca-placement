"""
Assessor Visit Logging & Claim Verification API (Issue 21)
Implements:
  - Create visit record with auto-generated reference
  - Evidence upload (observation notes, files)
  - Claim submission with duplicate prevention
  - Visit limit enforcement (Cert III = 3, Diploma = 2)
  - Admin approval for extra visits
  - Full audit trail via AuditLog
"""
import uuid, os, shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from datetime import date, datetime

from app.database import get_db
from app.models import AssessorVisit, Student, User, PlacementCentre
from app.utils.auth import get_current_user, require_admin
from app.api.audit import write_audit

router = APIRouter()

UPLOAD_DIR = "uploads/visit_evidence"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Visit limits per qualification (Issue 21)
VISIT_LIMITS = {
    "CHC30121": 3,
    "CHC30125": 3,
    "CHC50121": 2,
    "CHC50125": 2,
}


def _gen_ref(db: Session) -> str:
    """Generate a sequential visit reference like VIS-2025-00042."""
    year = datetime.utcnow().year
    count = db.query(AssessorVisit).count() + 1
    return f"VIS-{year}-{count:05d}"


def visit_to_dict(v: AssessorVisit) -> dict:
    return {
        "id": v.id,
        "visit_reference": v.visit_reference,
        "student_id": v.student_id,
        "assessor_id": v.assessor_id,
        "placement_centre_id": v.placement_centre_id,
        "visit_date": str(v.visit_date),
        "start_time": v.start_time,
        "end_time": v.end_time,
        "visit_purpose": v.visit_purpose,
        "units_linked": v.units_linked or [],
        "evidence_files": v.evidence_files or [],
        "observation_notes": v.observation_notes,
        "supervisor_feedback": v.supervisor_feedback,
        "claim_submitted": v.claim_submitted,
        "claim_submitted_at": str(v.claim_submitted_at) if v.claim_submitted_at else None,
        "claim_approved": v.claim_approved,
        "claim_approved_by": v.claim_approved_by,
        "claim_approved_at": str(v.claim_approved_at) if v.claim_approved_at else None,
        "admin_approval_required": v.admin_approval_required,
        "admin_approved": v.admin_approved,
        "status": v.status,
        "notes": v.notes,
        "created_at": str(v.created_at) if v.created_at else None,
    }


# ─── List ─────────────────────────────────────────────────────────────────────
@router.get("")
def list_visits(
    student_id: Optional[str] = None,
    assessor_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(AssessorVisit)
    if student_id:
        q = q.filter(AssessorVisit.student_id == student_id)
    if assessor_id:
        q = q.filter(AssessorVisit.assessor_id == assessor_id)
    if status:
        q = q.filter(AssessorVisit.status == status)
    visits = q.order_by(AssessorVisit.visit_date.desc()).all()
    return [visit_to_dict(v) for v in visits]


# ─── Create ───────────────────────────────────────────────────────────────────
class VisitCreate(BaseModel):
    student_id: str
    assessor_id: Optional[str] = None
    placement_centre_id: Optional[str] = None
    visit_date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    visit_purpose: Optional[str] = None
    units_linked: Optional[List[str]] = None
    observation_notes: Optional[str] = None
    notes: Optional[str] = None


@router.post("")
def create_visit(
    data: VisitCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = db.query(Student).filter(Student.id == data.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Check visit limit
    existing = db.query(AssessorVisit).filter(
        AssessorVisit.student_id == data.student_id,
        AssessorVisit.status != "rejected",
    ).count()
    limit = VISIT_LIMITS.get(student.qualification, 3)
    admin_approval_required = existing >= limit

    visit = AssessorVisit(
        visit_reference=_gen_ref(db),
        student_id=data.student_id,
        assessor_id=data.assessor_id or current_user.id,
        placement_centre_id=data.placement_centre_id,
        visit_date=date.fromisoformat(data.visit_date),
        start_time=data.start_time,
        end_time=data.end_time,
        visit_purpose=data.visit_purpose,
        units_linked=data.units_linked or [],
        evidence_files=[],
        observation_notes=data.observation_notes,
        admin_approval_required=admin_approval_required,
        status="pending",
        notes=data.notes,
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)

    write_audit(
        db, current_user, "visit.create", "assessor_visit",
        resource_id=visit.id,
        resource_label=f"{visit.visit_reference} — {student.full_name}",
        details={"visit_date": data.visit_date, "student_id": data.student_id, "purpose": data.visit_purpose},
    )
    db.commit()

    result = visit_to_dict(visit)
    if admin_approval_required:
        result["warning"] = (
            f"This student has reached the {limit}-visit limit for {student.qualification}. "
            "Administrator approval is required before this visit can be claimed."
        )
    return result


# ─── Upload evidence ──────────────────────────────────────────────────────────
@router.post("/{visit_id}/upload-evidence")
async def upload_evidence(
    visit_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visit = db.query(AssessorVisit).filter(AssessorVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")

    ext = os.path.splitext(file.filename)[1]
    filename = f"{visit_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)

    url = f"/uploads/visit_evidence/{filename}"
    files = list(visit.evidence_files or [])
    files.append({"url": url, "name": file.filename})
    visit.evidence_files = files
    visit.status = "evidence_required" if visit.status == "pending" else visit.status
    db.commit()
    return {"file_url": url, "file_name": file.filename}


# ─── Submit claim ─────────────────────────────────────────────────────────────
@router.post("/{visit_id}/submit-claim")
def submit_claim(
    visit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visit = db.query(AssessorVisit).filter(AssessorVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if visit.claim_submitted:
        raise HTTPException(status_code=400, detail="Claim already submitted for this visit")
    if not visit.evidence_files:
        raise HTTPException(status_code=400, detail="Evidence must be uploaded before claim submission")
    if visit.admin_approval_required and not visit.admin_approved:
        raise HTTPException(status_code=400, detail="Administrator approval required before claim submission")

    visit.claim_submitted = True
    visit.claim_submitted_at = datetime.utcnow()
    visit.status = "submitted"
    db.commit()
    return visit_to_dict(visit)


# ─── Admin approve extra visit ────────────────────────────────────────────────
@router.put("/{visit_id}/admin-approve")
def admin_approve_visit(
    visit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    visit = db.query(AssessorVisit).filter(AssessorVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    visit.admin_approved = True
    db.commit()
    return visit_to_dict(visit)


# ─── Approve claim ────────────────────────────────────────────────────────────
@router.put("/{visit_id}/approve-claim")
def approve_claim(
    visit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visit = db.query(AssessorVisit).filter(AssessorVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if not visit.claim_submitted:
        raise HTTPException(status_code=400, detail="Claim has not been submitted yet")
    visit.claim_approved = True
    visit.claim_approved_by = current_user.full_name
    visit.claim_approved_at = datetime.utcnow()
    visit.status = "approved"
    db.commit()

    write_audit(
        db, current_user, "visit.approve", "assessor_visit",
        resource_id=visit.id,
        resource_label=f"{visit.visit_reference} — claim approved",
        details={"approved_by": current_user.full_name, "status": "approved"},
    )
    db.commit()

    return visit_to_dict(visit)


# ─── Update notes / feedback ──────────────────────────────────────────────────
class VisitUpdate(BaseModel):
    observation_notes: Optional[str] = None
    supervisor_feedback: Optional[str] = None
    units_linked: Optional[List[str]] = None
    notes: Optional[str] = None


@router.put("/{visit_id}")
def update_visit(
    visit_id: str,
    data: VisitUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    visit = db.query(AssessorVisit).filter(AssessorVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    changed = data.dict(exclude_none=True)
    for field, val in changed.items():
        setattr(visit, field, val)
    db.commit()

    write_audit(
        db, current_user, "visit.update", "assessor_visit",
        resource_id=visit.id,
        resource_label=f"{visit.visit_reference} updated",
        details={"updated_fields": list(changed.keys())},
    )
    db.commit()

    return visit_to_dict(visit)


# ─── Export visits to CSV (Issue 21) ─────────────────────────────────────────
@router.get("/export/csv")
def export_visits_csv(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export all assessor visits to CSV for timesheet/invoice verification."""
    import csv, io
    from fastapi.responses import StreamingResponse

    visits = db.query(AssessorVisit).order_by(AssessorVisit.visit_date.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Visit Reference", "Student Name", "Student ID", "Assessor",
        "Placement Centre", "Visit Date", "Start Time", "End Time",
        "Purpose", "Units Assessed", "Evidence Files", "Claim Submitted",
        "Claim Approved", "Approved By", "Status",
    ])
    for v in visits:
        student = db.query(Student).filter(Student.id == v.student_id).first()
        assessor = db.query(User).filter(User.id == v.assessor_id).first()
        from app.models import PlacementCentre
        centre = db.query(PlacementCentre).filter(PlacementCentre.id == v.placement_centre_id).first()
        writer.writerow([
            v.visit_reference,
            student.full_name if student else "",
            student.student_id if student else "",
            assessor.full_name if assessor else "",
            centre.centre_name if centre else "",
            str(v.visit_date),
            v.start_time or "",
            v.end_time or "",
            v.visit_purpose or "",
            "; ".join(v.units_linked or []),
            str(len(v.evidence_files or [])),
            "Yes" if v.claim_submitted else "No",
            "Yes" if v.claim_approved else "No",
            v.claim_approved_by or "",
            v.status,
        ])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=assessor_visits.csv"},
    )
