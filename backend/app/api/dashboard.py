import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, timedelta

from app.database import get_db
from app.models import Student, Appointment, ComplianceDocument, Issue, HoursLog, User
from app.utils.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


def _safe(db, fn, default=0):
    """Run a DB query safely, rolling back and returning default on any error."""
    try:
        return fn()
    except Exception as e:
        logger.warning(f"Dashboard query failed (returning {default}): {e}")
        db.rollback()
        return default


@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    next_7_days = today + timedelta(days=7)
    expiry_30_days = today + timedelta(days=30)

    total_students = _safe(db, lambda: db.query(Student).filter(Student.status == "active").count())

    active_placements = _safe(db, lambda: db.query(Student).filter(
        Student.status == "active",
        Student.placement_centre_id.isnot(None),
        Student.placement_start_date <= today,
        Student.placement_end_date >= today
    ).count())

    # Try with cancelled filter first, fall back without it if column missing
    upcoming_appointments = _safe(db, lambda: db.query(Appointment).filter(
        Appointment.scheduled_date >= today,
        Appointment.scheduled_date <= next_7_days,
        Appointment.status == "scheduled",
        Appointment.cancelled == False
    ).count())
    if upcoming_appointments == 0:
        upcoming_appointments = _safe(db, lambda: db.query(Appointment).filter(
            Appointment.scheduled_date >= today,
            Appointment.scheduled_date <= next_7_days,
        ).count())

    pending_compliance = _safe(db, lambda: db.query(ComplianceDocument).filter(
        ComplianceDocument.verified == False
    ).count())

    open_issues = _safe(db, lambda: db.query(Issue).filter(
        Issue.status.in_(["open", "in_progress"])
    ).count())

    expiring_documents = _safe(db, lambda: db.query(ComplianceDocument).filter(
        ComplianceDocument.expiry_date >= today,
        ComplianceDocument.expiry_date <= expiry_30_days
    ).count())

    today_hours = _safe(db, lambda: db.query(func.sum(HoursLog.hours)).filter(
        HoursLog.log_date == today
    ).scalar() or 0, default=0)

    campus_breakdown = _safe(db, lambda: {
        c: n for c, n in db.query(Student.campus, func.count(Student.id)).filter(
            Student.status == "active"
        ).group_by(Student.campus).all() if c
    }, default={})

    qualification_breakdown = _safe(db, lambda: {
        q: n for q, n in db.query(Student.qualification, func.count(Student.id)).filter(
            Student.status == "active"
        ).group_by(Student.qualification).all() if q
    }, default={})

    return {
        "total_students": total_students,
        "active_placements": active_placements,
        "upcoming_appointments": upcoming_appointments,
        "pending_compliance": pending_compliance,
        "open_issues": open_issues,
        "expiring_documents": expiring_documents,
        "hours_logged_today": float(today_hours),
        "campus_breakdown": campus_breakdown,
        "qualification_breakdown": qualification_breakdown,
    }


@router.get("/upcoming-appointments")
def get_upcoming_appointments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    try:
        appointments = db.query(Appointment).filter(
            Appointment.scheduled_date >= today,
            Appointment.status == "scheduled",
            Appointment.cancelled == False
        ).order_by(Appointment.scheduled_date, Appointment.scheduled_time).limit(10).all()
    except Exception as e:
        logger.warning(f"Upcoming appointments (with cancelled) failed: {e}")
        db.rollback()
        try:
            appointments = db.query(Appointment).filter(
                Appointment.scheduled_date >= today,
            ).order_by(Appointment.scheduled_date).limit(10).all()
        except Exception:
            db.rollback()
            return []

    result = []
    for a in appointments:
        try:
            student = db.query(Student).filter(Student.id == a.student_id).first()
            result.append({
                "id": a.id,
                "title": getattr(a, "title", "Appointment"),
                "student_name": student.full_name if student else "Unknown",
                "student_id": a.student_id,
                "appointment_type": a.appointment_type,
                "scheduled_date": str(a.scheduled_date),
                "scheduled_time": getattr(a, "scheduled_time", ""),
                "location_type": getattr(a, "location_type", "on_site"),
                "meeting_link": getattr(a, "meeting_link", None),
            })
        except Exception as e:
            logger.warning(f"Skipping appointment: {e}")
    return result


@router.get("/expiring-documents")
def get_expiring_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    expiry_30 = today + timedelta(days=30)
    try:
        docs = db.query(ComplianceDocument).filter(
            ComplianceDocument.expiry_date >= today,
            ComplianceDocument.expiry_date <= expiry_30
        ).order_by(ComplianceDocument.expiry_date).all()
    except Exception as e:
        logger.warning(f"Expiring documents query failed: {e}")
        db.rollback()
        return []

    result = []
    for d in docs:
        try:
            student = db.query(Student).filter(Student.id == d.student_id).first()
            days_left = (d.expiry_date - today).days
            result.append({
                "id": d.id,
                "student_name": student.full_name if student else "Unknown",
                "document_type": d.document_type,
                "expiry_date": str(d.expiry_date),
                "days_until_expiry": days_left,
            })
        except Exception as e:
            logger.warning(f"Skipping document: {e}")
    return result
