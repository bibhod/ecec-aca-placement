from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, timedelta

from app.database import get_db
from app.models import Student, Appointment, ComplianceDocument, Issue, HoursLog, User
from app.utils.auth import get_current_user

router = APIRouter()


@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    next_7_days = today + timedelta(days=7)
    expiry_30_days = today + timedelta(days=30)

    total_students = db.query(Student).filter(Student.status == "active").count()
    active_placements = db.query(Student).filter(
        Student.status == "active",
        Student.placement_centre_id.isnot(None),
        Student.placement_start_date <= today,
        Student.placement_end_date >= today
    ).count()
    upcoming_appointments = db.query(Appointment).filter(
        Appointment.scheduled_date >= today,
        Appointment.scheduled_date <= next_7_days,
        Appointment.status == "scheduled",
        Appointment.cancelled == False
    ).count()
    pending_compliance = db.query(ComplianceDocument).filter(
        ComplianceDocument.verified == False
    ).count()
    open_issues = db.query(Issue).filter(Issue.status.in_(["open", "in_progress"])).count()
    expiring_documents = db.query(ComplianceDocument).filter(
        ComplianceDocument.expiry_date >= today,
        ComplianceDocument.expiry_date <= expiry_30_days
    ).count()

    # Hours logged today
    today_hours = db.query(func.sum(HoursLog.hours)).filter(
        HoursLog.log_date == today
    ).scalar() or 0

    # Campus breakdown
    campus_stats = db.query(Student.campus, func.count(Student.id)).filter(
        Student.status == "active"
    ).group_by(Student.campus).all()

    # Qualification breakdown
    qual_stats = db.query(Student.qualification, func.count(Student.id)).filter(
        Student.status == "active"
    ).group_by(Student.qualification).all()

    return {
        "total_students": total_students,
        "active_placements": active_placements,
        "upcoming_appointments": upcoming_appointments,
        "pending_compliance": pending_compliance,
        "open_issues": open_issues,
        "expiring_documents": expiring_documents,
        "hours_logged_today": float(today_hours),
        "campus_breakdown": {c: n for c, n in campus_stats},
        "qualification_breakdown": {q: n for q, n in qual_stats}
    }


@router.get("/upcoming-appointments")
def get_upcoming_appointments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    appointments = db.query(Appointment).filter(
        Appointment.scheduled_date >= today,
        Appointment.status == "scheduled",
        Appointment.cancelled == False
    ).order_by(Appointment.scheduled_date, Appointment.scheduled_time).limit(10).all()

    result = []
    for a in appointments:
        student = db.query(Student).filter(Student.id == a.student_id).first()
        result.append({
            "id": a.id,
            "title": a.title,
            "student_name": student.full_name if student else "Unknown",
            "student_id": a.student_id,
            "appointment_type": a.appointment_type,
            "scheduled_date": str(a.scheduled_date),
            "scheduled_time": a.scheduled_time,
            "location_type": a.location_type,
            "meeting_link": a.meeting_link,
        })
    return result


@router.get("/expiring-documents")
def get_expiring_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    expiry_30 = today + timedelta(days=30)
    docs = db.query(ComplianceDocument).filter(
        ComplianceDocument.expiry_date >= today,
        ComplianceDocument.expiry_date <= expiry_30
    ).order_by(ComplianceDocument.expiry_date).all()

    result = []
    for d in docs:
        student = db.query(Student).filter(Student.id == d.student_id).first()
        days_left = (d.expiry_date - today).days
        result.append({
            "id": d.id,
            "student_name": student.full_name if student else "Unknown",
            "document_type": d.document_type,
            "expiry_date": str(d.expiry_date),
            "days_until_expiry": days_left
        })
    return result
