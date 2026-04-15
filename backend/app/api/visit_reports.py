"""
Visit Reports API — auto-populated from Appointment data.
Replaces the old AssessorVisits standalone table.
All visit data comes directly from Appointments so there is no duplication.

Endpoints:
  GET /visit-reports/trainer          — all visits grouped by Trainer/Assessor
  GET /visit-reports/student/{id}     — all visits for one student
  GET /visit-reports/summary          — aggregate stats
  GET /visit-reports/export/csv       — CSV download (auth-protected)
"""
import csv, io, uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date
import logging

from app.database import get_db
from app.models import (
    Appointment, Student, User, PlacementCentre,
    VISIT_LIMITS, QUALIFICATION_UNITS_MAP,
)
from app.utils.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

APPT_LABELS = {
    "cert_iii_1st_visit": "Cert III – 1st Visit",
    "cert_iii_2nd_visit": "Cert III – 2nd Visit",
    "cert_iii_3rd_visit": "Cert III – 3rd Visit",
    "diploma_1st_visit":  "Diploma – 1st Visit",
    "diploma_2nd_visit":  "Diploma – 2nd Visit",
    "reassessment_visit": "Reassessment Visit",
}


def _appt_to_visit(a: Appointment, db: Session) -> dict:
    student = db.query(Student).filter(Student.id == a.student_id).first()
    trainer = db.query(User).filter(User.id == a.trainer_assessor_id).first() if a.trainer_assessor_id else None
    centre = db.query(PlacementCentre).filter(PlacementCentre.id == a.placement_centre_id).first() if a.placement_centre_id else None
    return {
        "appointment_id": a.id,
        "visit_reference": a.visit_reference or "",
        "trainer_assessor_id": a.trainer_assessor_id,
        "trainer_assessor_name": trainer.full_name if trainer else "Unassigned",
        "student_id": student.student_id if student else None,
        "student_db_id": a.student_id,
        "student_name": student.full_name if student else "Unknown",
        "student_qualification": student.qualification if student else None,
        "placement_centre_id": a.placement_centre_id,
        "placement_centre_name": centre.centre_name if centre else (a.location_address or "—"),
        "visit_date": str(a.scheduled_date),
        "visit_time": a.scheduled_time,
        "duration_hours": a.duration_hours,
        "appointment_type": a.appointment_type,
        "appointment_type_label": APPT_LABELS.get(a.appointment_type, a.appointment_type),
        "units_assessed": a.units_assessed or [],
        "status": a.status,
        "completed": a.completed,
        "cancelled": a.cancelled,
        "feedback": a.feedback,
        "requires_admin_approval": getattr(a, "requires_admin_approval", False),
        "admin_approved": getattr(a, "admin_approved", False),
        "created_at": str(a.created_at) if a.created_at else None,
    }


def _build_query(
    db, trainer_id=None, student_name=None,
    date_from=None, date_to=None, status=None
):
    q = db.query(Appointment)
    if trainer_id:
        q = q.filter(Appointment.trainer_assessor_id == trainer_id)
    if status:
        q = q.filter(Appointment.status == status)
    if date_from:
        q = q.filter(Appointment.scheduled_date >= date.fromisoformat(date_from))
    if date_to:
        q = q.filter(Appointment.scheduled_date <= date.fromisoformat(date_to))
    if student_name:
        student_ids = [
            s.id for s in db.query(Student).filter(
                Student.full_name.ilike(f"%{student_name}%")
            ).all()
        ]
        if student_ids:
            q = q.filter(Appointment.student_id.in_(student_ids))
        else:
            return q.filter(False)
    return q.order_by(Appointment.scheduled_date.desc(), Appointment.scheduled_time)


# ─── All visits (filterable) ─────────────────────────────────────────────────
@router.get("")
def list_visit_reports(
    trainer_id: Optional[str] = None,
    student_name: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    appts = _build_query(db, trainer_id, student_name, date_from, date_to, status).all()
    return [_appt_to_visit(a, db) for a in appts]


# ─── Grouped by Trainer/Assessor ─────────────────────────────────────────────
@router.get("/by-trainer")
def visits_by_trainer(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns each trainer with their visit list — for the main report table."""
    trainers = db.query(User).filter(User.role.in_(["trainer", "admin", "coordinator"])).all()
    result = []
    for t in trainers:
        q = _build_query(db, trainer_id=t.id, date_from=date_from, date_to=date_to)
        appts = q.all()
        if not appts:
            continue
        result.append({
            "trainer_id": t.id,
            "trainer_name": t.full_name,
            "trainer_email": t.email,
            "total_visits": len(appts),
            "completed_visits": sum(1 for a in appts if a.completed),
            "visits": [_appt_to_visit(a, db) for a in appts],
        })
    return result


# ─── Student visit report (units assessed per visit) ─────────────────────────
@router.get("/student/{student_db_id}")
def student_visit_report(
    student_db_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Full visit report for one student:
    visits done, units assessed, visit limits, remaining units.
    """
    student = db.query(Student).filter(Student.id == student_db_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    appts = db.query(Appointment).filter(
        Appointment.student_id == student_db_id,
        Appointment.cancelled == False,
    ).order_by(Appointment.scheduled_date).all()

    all_units = QUALIFICATION_UNITS_MAP.get(student.qualification, [])
    assessed_units = list({u for a in appts for u in (a.units_assessed or [])})
    remaining_units = [u for u in all_units if u not in assessed_units]
    limit = VISIT_LIMITS.get(student.qualification, 3)
    regular_visits = [a for a in appts if a.appointment_type != "reassessment_visit"]

    centre = db.query(PlacementCentre).filter(PlacementCentre.id == student.placement_centre_id).first() if student.placement_centre_id else None

    return {
        "student_id": student.student_id,
        "student_name": student.full_name,
        "qualification": student.qualification,
        "placement_centre": centre.centre_name if centre else "—",
        "visit_limit": limit,
        "visits_used": len(regular_visits),
        "visits_remaining": max(0, limit - len(regular_visits)),
        "all_units": all_units,
        "assessed_units": assessed_units,
        "remaining_units": remaining_units,
        "visits": [_appt_to_visit(a, db) for a in appts],
    }


# ─── Summary stats ────────────────────────────────────────────────────────────
@router.get("/summary")
def visit_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    all_appts = db.query(Appointment).filter(Appointment.cancelled == False).all()
    trainers = {}
    for a in all_appts:
        tid = a.trainer_assessor_id or "unassigned"
        trainers.setdefault(tid, {"scheduled": 0, "completed": 0})
        if a.completed:
            trainers[tid]["completed"] += 1
        else:
            trainers[tid]["scheduled"] += 1
    return {
        "total_visits": len(all_appts),
        "completed": sum(1 for a in all_appts if a.completed),
        "scheduled": sum(1 for a in all_appts if not a.completed and not a.cancelled),
        "by_trainer": trainers,
    }


# ─── CSV Export ───────────────────────────────────────────────────────────────
@router.get("/export/csv")
def export_visits_csv(
    trainer_id: Optional[str] = None,
    student_name: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    appts = _build_query(db, trainer_id, student_name, date_from, date_to).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Visit Reference", "Trainer/Assessor", "Student ID", "Student Name",
        "Qualification", "Placement Centre", "Visit Date", "Visit Time",
        "Duration (hrs)", "Visit Type", "Units Assessed", "Status", "Feedback",
    ])
    for a in appts:
        v = _appt_to_visit(a, db)
        writer.writerow([
            v["visit_reference"], v["trainer_assessor_name"],
            v["student_id"], v["student_name"],
            v["student_qualification"], v["placement_centre_name"],
            v["visit_date"], v["visit_time"], v["duration_hours"],
            APPT_LABELS.get(a.appointment_type, a.appointment_type),
            "; ".join(v["units_assessed"]),
            v["status"], v["feedback"] or "",
        ])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=visit_report.csv"},
    )
