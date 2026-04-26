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

    current_students  = _safe(db, lambda: db.query(Student).filter(Student.status == "current").count())
    completed_students = _safe(db, lambda: db.query(Student).filter(Student.status == "completed").count())
    withdrawn_students = _safe(db, lambda: db.query(Student).filter(Student.status == "withdrawn").count())
    total_students = current_students + completed_students + withdrawn_students

    active_placements = _safe(db, lambda: db.query(Student).filter(
        Student.status == "current",
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

    # Campus: normalise to lower-case so "Sydney"/"sydney" don't produce duplicates
    def _campus_breakdown():
        rows = db.query(func.lower(Student.campus), func.count(Student.id)).filter(
            Student.status == "current"
        ).group_by(func.lower(Student.campus)).all()
        return {c.title(): n for c, n in rows if c}

    campus_breakdown = _safe(db, _campus_breakdown, default={})

    # Qualification: aggregate CHC30121/CHC30125 → "Cert III", CHC50121/CHC50125 → "Diploma"
    def _qual_breakdown():
        rows = db.query(Student.qualification, func.count(Student.id)).filter(
            Student.status == "current"
        ).group_by(Student.qualification).all()
        agg: dict = {}
        for q, n in rows:
            if not q:
                continue
            label = "Cert III" if "30" in q else "Diploma"
            agg[label] = agg.get(label, 0) + n
        return agg

    qualification_breakdown = _safe(db, _qual_breakdown, default={})

    return {
        "total_students": total_students,
        "current_students": current_students,
        "completed_students": completed_students,
        "withdrawn_students": withdrawn_students,
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


@router.get("/action-items")
def get_action_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns live counts for the dashboard 'Action Required' panel.
    All four items are always returned (count may be 0).
    """
    from datetime import date, timedelta
    today = date.today()

    # 1. Students with compliance docs expiring within 7 days (unique student count)
    in_7 = today + timedelta(days=7)
    expiring_student_ids = (
        db.query(ComplianceDocument.student_id)
        .filter(
            ComplianceDocument.expiry_date >= today,
            ComplianceDocument.expiry_date <= in_7,
        )
        .distinct()
    )
    expiring_7d = _safe(db, lambda: expiring_student_ids.count(), 0)

    # 2. Overdue visits — scheduled date has passed, not yet completed or cancelled
    overdue_visits = _safe(db, lambda: db.query(Appointment).filter(
        Appointment.scheduled_date < today,
        Appointment.completed == False,
        Appointment.cancelled == False,
        Appointment.status == "scheduled",
    ).count(), 0)

    # 3. Appointments in the next 7 days
    appts_7d = _safe(db, lambda: db.query(Appointment).filter(
        Appointment.scheduled_date >= today,
        Appointment.scheduled_date <= today + timedelta(days=7),
        Appointment.status == "scheduled",
        Appointment.cancelled == False,
    ).count(), 0)

    # 4. Active students with zero hours logged this calendar month
    month_start = today.replace(day=1)
    students_with_hours_this_month = (
        db.query(HoursLog.student_id)
        .filter(HoursLog.log_date >= month_start)
        .distinct()
        .subquery()
    )
    zero_hours_month = _safe(db, lambda: db.query(Student).filter(
        Student.status == "current",
        ~Student.id.in_(students_with_hours_this_month),
    ).count(), 0)

    return {
        "expiring_compliance_7d": expiring_7d,
        "overdue_visits": overdue_visits,
        "appointments_7d": appts_7d,
        "zero_hours_this_month": zero_hours_month,
    }
