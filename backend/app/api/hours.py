"""
Hours Log API
Fixes:
  Issue 3  - bulk create endpoint so UI can submit multiple rows in one session
  Issue 19 - smart validation: flag shifts >10h and duplicate dates per student
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from pydantic import BaseModel
from datetime import date, datetime

from app.database import get_db
from app.models import (
    HoursLog, Student, User,
    QUALIFICATION_LEVEL_CHOICES, qualification_level_for_code, required_hours_for_level,
)
from app.utils.auth import get_current_user, require_admin
from app.api.audit import write_audit

router = APIRouter()


def log_to_dict(log: HoursLog) -> dict:
    return {
        "id": log.id,
        "student_id": log.student_id,
        "log_date": str(log.log_date),
        "hours": log.hours,
        "qualification_level": log.qualification_level,
        "activity_description": log.activity_description,
        "approved": log.approved,
        "approved_by": log.approved_by,
        "approved_at": str(log.approved_at) if log.approved_at else None,
        "supervisor_signed": log.supervisor_signed,
        "flagged_unrealistic": getattr(log, "flagged_unrealistic", False),
        "flagged_duplicate": getattr(log, "flagged_duplicate", False),
        "created_at": str(log.created_at) if log.created_at else None,
    }


@router.get("/qualification-levels")
def get_qualification_levels():
    """Qualification levels available for tagging hour log entries."""
    return QUALIFICATION_LEVEL_CHOICES


@router.get("/summary")
def hours_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Hours progress, broken down per qualification level.

    Each student gets one row per distinct qualification level they have hours
    logged against (defaulting to their enrolled qualification's level when no
    logs exist yet, or when logs predate qualification-level tracking). This
    lets a student who is logging hours toward more than one level (e.g.
    transitioning from Cert III into Diploma) see separate progress for each.
    """
    students = db.query(Student).filter(Student.status == "current").all()

    # Batch-fetch every student's hours logs in a single query instead of one
    # query per student (was causing N+1 queries and a slow-loading Hours page).
    student_ids = [s.id for s in students]
    logs_by_student: dict = {sid: [] for sid in student_ids}
    if student_ids:
        all_logs = db.query(HoursLog).filter(HoursLog.student_id.in_(student_ids)).all()
        for l in all_logs:
            logs_by_student.setdefault(l.student_id, []).append(l)

    result = []
    for s in students:
        logs = logs_by_student.get(s.id, [])
        student_level = qualification_level_for_code(s.qualification)

        # Group logs by qualification level, defaulting missing/legacy values
        # to the student's own enrolled level.
        levels = {}
        for l in logs:
            level = l.qualification_level or student_level or "Unspecified"
            levels.setdefault(level, []).append(l)

        # Always show at least the student's own enrolled level, even with 0 logs.
        if student_level and student_level not in levels:
            levels[student_level] = []

        for level, level_logs in levels.items():
            approved_hours = sum(l.hours for l in level_logs if l.approved)
            pending_hours = sum(l.hours for l in level_logs if not l.approved)
            # "completed_hours" mirrors the existing Student.completed_hours
            # semantics (total hours logged, approved or pending), just scoped
            # to this qualification level instead of the whole student.
            completed_hours = approved_hours + pending_hours
            required = required_hours_for_level(level) or (s.required_hours if level == student_level else 0) or 0
            result.append({
                "student_id": s.id,
                "student_name": s.full_name,
                "student_ref": s.student_id,
                "campus": s.campus,
                "qualification": s.qualification,
                "qualification_level": level,
                "required_hours": required,
                "completed_hours": completed_hours,
                "approved_hours": approved_hours,
                "pending_hours": pending_hours,
                "percentage": round(completed_hours / required * 100, 1) if required else 0,
            })
    return result


@router.get("")
def list_hours(
    student_id: Optional[str] = None,
    approved: Optional[bool] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(HoursLog)
    if student_id:
        q = q.filter(HoursLog.student_id == student_id)
    if approved is not None:
        q = q.filter(HoursLog.approved == approved)
    if date_from:
        q = q.filter(HoursLog.log_date >= date.fromisoformat(date_from))
    if date_to:
        q = q.filter(HoursLog.log_date <= date.fromisoformat(date_to))
    logs = q.order_by(HoursLog.log_date.desc()).all()
    return [log_to_dict(l) for l in logs]


class HoursEntry(BaseModel):
    """A single date/hours entry (used in both single and bulk create)."""
    log_date: str
    hours: float
    qualification_level: Optional[str] = None
    activity_description: Optional[str] = None
    supervisor_signed: bool = False


class HoursCreate(BaseModel):
    student_id: str
    log_date: str
    hours: float
    qualification_level: Optional[str] = None
    activity_description: Optional[str] = None
    supervisor_signed: bool = False


def _validate_and_create(
    student: Student,
    entry_date: date,
    hours: float,
    description: Optional[str],
    supervisor_signed: bool,
    current_user_id: str,
    db: Session,
    qualification_level: Optional[str] = None,
) -> HoursLog:
    """
    Validate a single log entry (Issue 19) and create the HoursLog record.
    Flags unrealistic shifts (>10h) and duplicate dates without blocking.
    Duplicate-date checks are scoped per qualification level, since a student
    logging hours toward two levels may legitimately log for the same date once
    per level.
    """
    flagged_unrealistic = hours > 10
    level = qualification_level or qualification_level_for_code(student.qualification)
    # Check if there's already a log for this student on this date, at this level
    existing_today = db.query(HoursLog).filter(
        HoursLog.student_id == student.id,
        HoursLog.log_date == entry_date,
        HoursLog.qualification_level == level,
    ).first()
    flagged_duplicate = existing_today is not None

    log = HoursLog(
        student_id=student.id,
        log_date=entry_date,
        hours=hours,
        qualification_level=level,
        activity_description=description,
        supervisor_signed=supervisor_signed,
        approved=False,
        flagged_unrealistic=flagged_unrealistic,
        flagged_duplicate=flagged_duplicate,
        created_by=current_user_id,
    )
    return log, flagged_unrealistic, flagged_duplicate


@router.post("")
def create_hours_log(
    data: HoursCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    student = db.query(Student).filter(Student.id == data.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if data.hours <= 0 or data.hours > 24:
        raise HTTPException(status_code=400, detail="Hours must be between 0 and 24")

    prev_pct = int(student.completed_hours / student.required_hours * 100) if student.required_hours else 0

    entry_date = date.fromisoformat(data.log_date)
    log, flag_unreal, flag_dup = _validate_and_create(
        student, entry_date, data.hours,
        data.activity_description, data.supervisor_signed,
        current_user.id, db,
        qualification_level=data.qualification_level,
    )
    db.add(log)
    student.completed_hours = (student.completed_hours or 0) + data.hours
    db.commit()
    db.refresh(log)

    # Milestone emails
    new_pct = int(student.completed_hours / student.required_hours * 100) if student.required_hours else 0
    for milestone in [50, 100]:
        if prev_pct < milestone <= new_pct and student.email:
            from app.services.email_service import email_hours_milestone
            email_hours_milestone(student.full_name, student.email, student.completed_hours, student.required_hours, milestone, "")

    write_audit(
        db, current_user, "hours.create", "hours_log",
        resource_id=log.id,
        resource_label=f"{data.hours}h logged for student {data.student_id} on {data.log_date}",
        details={"student_id": data.student_id, "log_date": data.log_date, "hours": data.hours},
    )
    db.commit()

    result = log_to_dict(log)
    result["warnings"] = []
    if flag_unreal:
        result["warnings"].append("This shift exceeds 10 hours and has been flagged for review.")
    if flag_dup:
        result["warnings"].append("A log entry already exists for this student on this date.")
    return result


# ─── Issue 3 - bulk create (multiple rows in one session) ────────────────────
class HoursBulkCreate(BaseModel):
    student_id: str
    entries: List[HoursEntry]


@router.post("/bulk")
def create_hours_bulk(
    data: HoursBulkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Submit multiple placement-hour entries at once (Issue 3).
    Returns a list of created log records with any validation warnings.
    """
    student = db.query(Student).filter(Student.id == data.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if not data.entries:
        raise HTTPException(status_code=400, detail="No entries provided")

    prev_pct = int(student.completed_hours / student.required_hours * 100) if student.required_hours else 0

    results = []
    total_added = 0.0
    for entry in data.entries:
        if entry.hours <= 0 or entry.hours > 24:
            results.append({"error": f"Invalid hours ({entry.hours}) for date {entry.log_date}"})
            continue
        entry_date = date.fromisoformat(entry.log_date)
        log, flag_unreal, flag_dup = _validate_and_create(
            student, entry_date, entry.hours,
            entry.activity_description, entry.supervisor_signed,
            current_user.id, db,
            qualification_level=entry.qualification_level,
        )
        db.add(log)
        total_added += entry.hours
        student.completed_hours = (student.completed_hours or 0) + entry.hours
        db.flush()
        result = log_to_dict(log)
        result["warnings"] = []
        if flag_unreal:
            result["warnings"].append(f"Shift on {entry.log_date} exceeds 10 hours - flagged for review.")
        if flag_dup:
            result["warnings"].append(f"A log entry already exists for {entry.log_date} - flagged as duplicate.")
        results.append(result)

    db.commit()

    # Milestone emails
    new_pct = int(student.completed_hours / student.required_hours * 100) if student.required_hours else 0
    for milestone in [50, 100]:
        if prev_pct < milestone <= new_pct and student.email:
            from app.services.email_service import email_hours_milestone
            email_hours_milestone(student.full_name, student.email, student.completed_hours, student.required_hours, milestone, "")

    return {"message": f"{len(results)} entries processed", "results": results}


@router.put("/{log_id}/approve")
def approve_hours(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    log = db.query(HoursLog).filter(HoursLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    log.approved = True
    log.approved_by = current_user.full_name
    log.approved_at = datetime.utcnow()
    db.commit()

    write_audit(
        db, current_user, "hours.approve", "hours_log",
        resource_id=log.id,
        resource_label=f"Approved {log.hours}h for student on {log.log_date}",
        details={"hours": log.hours, "log_date": str(log.log_date), "student_id": log.student_id},
    )
    db.commit()

    return log_to_dict(log)


@router.put("/{log_id}/reject")
def reject_hours(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    log = db.query(HoursLog).filter(HoursLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    student = db.query(Student).filter(Student.id == log.student_id).first()
    if student:
        student.completed_hours = max(0, (student.completed_hours or 0) - log.hours)
    db.delete(log)
    db.commit()
    return {"message": "Hours log rejected and removed"}


@router.delete("/{log_id}")
def delete_hours_log(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    log = db.query(HoursLog).filter(HoursLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log not found")
    student = db.query(Student).filter(Student.id == log.student_id).first()
    if student:
        student.completed_hours = max(0, (student.completed_hours or 0) - log.hours)
    db.delete(log)
    db.commit()
    return {"message": "Hours log deleted"}
