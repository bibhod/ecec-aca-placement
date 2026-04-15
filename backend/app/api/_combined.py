"""
Combined routers for centres, notifications, and reports.
Fixes:
  Issue 11 — NQS label change (API returns field; label is in the UI)
  Issue 12 — export functions produce valid CSV output
  Issue 17 — bulk import for centres
"""
import csv, io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from datetime import date

from app.database import get_db
from app.models import PlacementCentre, Student, Notification, User, HoursLog, ComplianceDocument, Appointment
from app.utils.auth import get_current_user

# ─── CENTRES ────────────────────────────────────────────────────────────────
centres_router = APIRouter()


def centre_to_dict(c: PlacementCentre) -> dict:
    return {
        "id": c.id,
        "centre_name": c.centre_name,
        "address": c.address,
        "suburb": c.suburb,
        "state": c.state,
        "postcode": c.postcode,
        "latitude": c.latitude,
        "longitude": c.longitude,
        "phone": c.phone,
        "email": c.email,
        "director_name": c.director_name,
        "director_email": c.director_email,
        "supervisor_name": c.supervisor_name,
        "supervisor_email": c.supervisor_email,
        "supervisor_phone": c.supervisor_phone,
        # Issue 11 — field name unchanged; UI renames the label
        "nqs_rating": c.nqs_rating,
        "max_students": c.max_students,
        "accepted_qualifications": c.accepted_qualifications,
        "approved": c.approved,
        "notes": c.notes,
        "created_at": str(c.created_at) if c.created_at else None,
    }


@centres_router.get("")
def list_centres(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    centres = db.query(PlacementCentre).order_by(PlacementCentre.centre_name).all()
    result = []
    for c in centres:
        d = centre_to_dict(c)
        d["student_count"] = db.query(Student).filter(
            Student.placement_centre_id == c.id, Student.status == "active"
        ).count()
        result.append(d)
    return result


@centres_router.get("/{centre_id}")
def get_centre(centre_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(PlacementCentre).filter(PlacementCentre.id == centre_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Centre not found")
    return centre_to_dict(c)


class CentreCreate(BaseModel):
    centre_name: str
    address: Optional[str] = None
    suburb: Optional[str] = None
    state: Optional[str] = None
    postcode: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    director_name: Optional[str] = None
    director_email: Optional[str] = None
    supervisor_name: Optional[str] = None
    supervisor_email: Optional[str] = None
    supervisor_phone: Optional[str] = None
    nqs_rating: Optional[str] = None
    max_students: int = 5
    accepted_qualifications: Optional[list] = None
    approved: bool = True
    notes: Optional[str] = None


@centres_router.post("")
def create_centre(data: CentreCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = PlacementCentre(**data.dict())
    db.add(c)
    db.commit()
    db.refresh(c)
    return centre_to_dict(c)


@centres_router.put("/{centre_id}")
def update_centre(centre_id: str, data: CentreCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(PlacementCentre).filter(PlacementCentre.id == centre_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Centre not found")
    for k, v in data.dict(exclude_none=True).items():
        if hasattr(c, k):
            setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return centre_to_dict(c)


@centres_router.delete("/{centre_id}")
def delete_centre(centre_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(PlacementCentre).filter(PlacementCentre.id == centre_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Centre not found")
    db.delete(c)
    db.commit()
    return {"message": "Centre deleted"}


@centres_router.post("/bulk-import")
async def bulk_import_centres(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Bulk-import placement centres from CSV (Issue 17).
    Expected CSV headers: centre_name, address, suburb, state, postcode,
    phone, email, director_name, supervisor_name, supervisor_email,
    supervisor_phone, nqs_rating
    """
    content = await file.read()
    if file.filename.lower().endswith(".csv"):
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
        rows = list(reader)
    elif file.filename.lower().endswith((".xlsx", ".xls")):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content))
        ws = wb.active
        headers = [str(c.value).strip() for c in next(ws.iter_rows(min_row=1, max_row=1))]
        rows = [dict(zip(headers, [str(v).strip() if v is not None else "" for v in row])) for row in ws.iter_rows(min_row=2, values_only=True)]
    else:
        raise HTTPException(status_code=400, detail="Only .csv and .xlsx files are supported")

    created, errors = [], []
    for i, row in enumerate(rows, start=2):
        name = row.get("centre_name", "").strip()
        if not name:
            errors.append({"row": i, "error": "centre_name is required"})
            continue
        try:
            c = PlacementCentre(
                centre_name=name,
                address=row.get("address") or None,
                suburb=row.get("suburb") or None,
                state=row.get("state") or None,
                postcode=row.get("postcode") or None,
                phone=row.get("phone") or None,
                email=row.get("email") or None,
                director_name=row.get("director_name") or None,
                supervisor_name=row.get("supervisor_name") or None,
                supervisor_email=row.get("supervisor_email") or None,
                supervisor_phone=row.get("supervisor_phone") or None,
                nqs_rating=row.get("nqs_rating") or None,
                approved=True,
            )
            db.add(c)
            created.append(name)
        except Exception as e:
            errors.append({"row": i, "name": name, "error": str(e)})

    db.commit()
    return {
        "message": f"Import complete: {len(created)} created, {len(errors)} errors",
        "created": created,
        "errors": errors,
    }


# ─── NOTIFICATIONS ──────────────────────────────────────────────────────────
notifications_router = APIRouter()


@notifications_router.get("")
def list_notifications(
    unread_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        q = q.filter(Notification.read == False)
    notes = q.order_by(Notification.created_at.desc()).limit(50).all()
    return [
        {
            "id": n.id,
            "title": n.title,
            "message": n.message,
            "type": n.type,
            "link": n.link,
            "read": n.read,
            "created_at": str(n.created_at) if n.created_at else None,
        }
        for n in notes
    ]


@notifications_router.put("/read-all")
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Notification).filter(
        Notification.user_id == current_user.id, Notification.read == False
    ).update({"read": True})
    db.commit()
    return {"message": "All notifications marked as read"}


@notifications_router.put("/{notif_id}/read")
def mark_read(notif_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    n = db.query(Notification).filter(
        Notification.id == notif_id, Notification.user_id == current_user.id
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.read = True
    db.commit()
    return {"message": "Marked as read"}


# ─── REPORTS ────────────────────────────────────────────────────────────────
reports_router = APIRouter()

# Qualification labels (Issue 9)
QUAL_LABELS = {
    "CHC30121": "Cert III (Superseded)",
    "CHC50121": "Diploma (Superseded)",
    "CHC30125": "Cert III",
    "CHC50125": "Diploma",
}


@reports_router.get("/overview")
def report_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    students = db.query(Student).all()

    by_campus, by_qualification, by_status = {}, {}, {}
    hours_data, compliance_data = [], []

    for s in students:
        by_campus[s.campus] = by_campus.get(s.campus, 0) + 1
        qual_label = QUAL_LABELS.get(s.qualification, s.qualification)
        by_qualification[qual_label] = by_qualification.get(qual_label, 0) + 1
        by_status[s.status] = by_status.get(s.status, 0) + 1

        pct = round(s.completed_hours / s.required_hours * 100, 1) if s.required_hours else 0
        hours_data.append({
            "student_id": s.student_id,
            "student_name": s.full_name,
            "campus": s.campus,
            "qualification": QUAL_LABELS.get(s.qualification, s.qualification),
            "required_hours": s.required_hours,
            "completed_hours": s.completed_hours,
            "percentage": pct,
            "status": s.status,
        })

        docs = db.query(ComplianceDocument).filter(ComplianceDocument.student_id == s.id).all()
        expired = sum(1 for d in docs if d.expiry_date and d.expiry_date < today)
        expiring = sum(1 for d in docs if d.expiry_date and today <= d.expiry_date <= date.fromordinal(today.toordinal() + 30))
        pending = sum(1 for d in docs if not d.verified)
        compliance_data.append({
            "student_id": s.student_id,
            "student_name": s.full_name,
            "campus": s.campus,
            "total_docs": len(docs),
            "expired": expired,
            "expiring_soon": expiring,
            "pending_verification": pending,
            "compliant": len(docs) > 0 and expired == 0 and pending == 0,
        })

    return {
        "by_campus": by_campus,
        "by_qualification": by_qualification,
        "by_status": by_status,
        "hours_data": sorted(hours_data, key=lambda x: x["percentage"], reverse=True),
        "compliance_data": compliance_data,
        "summary": {
            "total_students": len(students),
            "total_hours_completed": sum(s.completed_hours for s in students),
            "total_hours_required": sum(s.required_hours for s in students),
            "compliance_rate": round(
                sum(1 for c in compliance_data if c["compliant"]) / len(compliance_data) * 100, 1
            ) if compliance_data else 0,
        },
    }


@reports_router.get("/export/students")
def export_students_csv(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Export all students to CSV (Issue 12)."""
    from fastapi.responses import StreamingResponse
    students = db.query(Student).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Student ID", "Full Name", "Email", "Phone", "Qualification", "Campus",
        "Status", "Required Hours", "Completed Hours", "Progress %",
        "Placement Centre", "Course Start", "Course End",
    ])
    for s in students:
        centre = s.placement_centre
        pct = round(s.completed_hours / s.required_hours * 100, 1) if s.required_hours else 0
        writer.writerow([
            s.student_id, s.full_name, s.email or "", s.phone or "",
            s.qualification, s.campus, s.status,
            s.required_hours, s.completed_hours, f"{pct}%",
            centre.centre_name if centre else "",
            str(s.course_start_date) if s.course_start_date else "",
            str(s.course_end_date) if s.course_end_date else "",
        ])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=students_report.csv"},
    )


@reports_router.get("/export/hours")
def export_hours_csv(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Export all hours logs to CSV (Issue 12)."""
    from fastapi.responses import StreamingResponse
    logs = db.query(HoursLog).order_by(HoursLog.log_date.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Student ID", "Student Name", "Hours", "Activity", "Approved", "Approved By", "Flagged"])
    for l in logs:
        student = db.query(Student).filter(Student.id == l.student_id).first()
        flags = []
        if getattr(l, "flagged_unrealistic", False):
            flags.append("unrealistic")
        if getattr(l, "flagged_duplicate", False):
            flags.append("duplicate")
        writer.writerow([
            str(l.log_date), student.student_id if student else "", student.full_name if student else "",
            l.hours, l.activity_description or "", "Yes" if l.approved else "No",
            l.approved_by or "", ",".join(flags) if flags else "",
        ])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=hours_report.csv"},
    )


@reports_router.get("/export/audit")
def export_audit_csv(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Export audit log to CSV (Issue 14)."""
    from fastapi.responses import StreamingResponse
    from app.models import AuditLog
    entries = db.query(AuditLog).order_by(AuditLog.created_at.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp", "User Email", "User Name", "Action", "Resource Type", "Resource ID", "Resource Label"])
    for e in entries:
        writer.writerow([
            str(e.created_at), e.user_email or "", e.user_name or "",
            e.action, e.resource_type or "", e.resource_id or "", e.resource_label or "",
        ])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_report.csv"},
    )
