"""
Trainer/Assessor Profile API
New page: create, read, update profiles for users with role='trainer'.
Records: name, email, mobile, qualifications delivering, campuses, notes.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
import logging

from app.database import get_db
from app.models import TrainerProfile, User, Appointment, Student, PlacementCentre, QUALIFICATION_CHOICES
from app.utils.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


def profile_to_dict(p: TrainerProfile, db: Session) -> dict:
    user = db.query(User).filter(User.id == p.user_id).first()
    # Count visits (completed appointments) for this trainer
    visits_done = db.query(Appointment).filter(
        Appointment.trainer_assessor_id == p.user_id,
        Appointment.completed == True,
    ).count()
    active_students = db.query(Appointment).filter(
        Appointment.trainer_assessor_id == p.user_id,
        Appointment.status == "scheduled",
    ).distinct(Appointment.student_id).count()
    return {
        "id": p.id,
        "user_id": p.user_id,
        "full_name": p.full_name,
        "email": p.email,
        "mobile": p.mobile,
        "qualifications_delivering": p.qualifications_delivering or [],
        "campuses": p.campuses or [],
        "max_students": p.max_students,
        "notes": p.notes,
        "is_active": p.is_active,
        "user_role": user.role if user else None,
        "visits_done": visits_done,
        "active_students": active_students,
        "created_at": str(p.created_at) if p.created_at else None,
    }


@router.get("")
def list_trainer_profiles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all Trainer/Assessor profiles."""
    profiles = db.query(TrainerProfile).filter(TrainerProfile.is_active == True).all()
    return [profile_to_dict(p, db) for p in profiles]


@router.get("/{profile_id}")
def get_trainer_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = db.query(TrainerProfile).filter(TrainerProfile.id == profile_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile_to_dict(p, db)


class ProfileCreate(BaseModel):
    user_id: Optional[str] = None      # link to existing User, or create standalone
    full_name: str
    email: Optional[str] = None
    mobile: Optional[str] = None
    qualifications_delivering: Optional[List[str]] = None
    campuses: Optional[List[str]] = None
    max_students: int = 20
    notes: Optional[str] = None


@router.post("")
def create_trainer_profile(
    data: ProfileCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # If linking to a user, check they exist
    if data.user_id:
        user = db.query(User).filter(User.id == data.user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        # Ensure trainer role
        if user.role not in ("trainer", "admin"):
            user.role = "trainer"
        # Check no existing profile
        existing = db.query(TrainerProfile).filter(TrainerProfile.user_id == data.user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Profile already exists for this user")

    p = TrainerProfile(
        user_id=data.user_id,
        full_name=data.full_name,
        email=data.email,
        mobile=data.mobile,
        qualifications_delivering=data.qualifications_delivering or [],
        campuses=data.campuses or [],
        max_students=data.max_students,
        notes=data.notes,
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return profile_to_dict(p, db)


@router.put("/{profile_id}")
def update_trainer_profile(
    profile_id: str,
    data: ProfileCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = db.query(TrainerProfile).filter(TrainerProfile.id == profile_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    p.full_name = data.full_name
    if data.email is not None: p.email = data.email
    if data.mobile is not None: p.mobile = data.mobile
    if data.qualifications_delivering is not None: p.qualifications_delivering = data.qualifications_delivering
    if data.campuses is not None: p.campuses = data.campuses
    p.max_students = data.max_students
    if data.notes is not None: p.notes = data.notes
    db.commit()
    return profile_to_dict(p, db)


@router.delete("/{profile_id}")
def delete_trainer_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    p = db.query(TrainerProfile).filter(TrainerProfile.id == profile_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    p.is_active = False
    db.commit()
    return {"message": "Profile deactivated"}


@router.get("/{profile_id}/visit-report")
def trainer_visit_report(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All visits for a specific trainer/assessor."""
    p = db.query(TrainerProfile).filter(TrainerProfile.id == profile_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _build_visit_records(p.user_id, db)


def _build_visit_records(trainer_id: str, db: Session) -> list:
    """Build visit records from appointments for a trainer."""
    appts = db.query(Appointment).filter(
        Appointment.trainer_assessor_id == trainer_id,
    ).order_by(Appointment.scheduled_date.desc()).all()

    records = []
    for a in appts:
        student = db.query(Student).filter(Student.id == a.student_id).first()
        centre = db.query(PlacementCentre).filter(PlacementCentre.id == a.placement_centre_id).first() if a.placement_centre_id else None
        records.append({
            "appointment_id": a.id,
            "visit_reference": a.visit_reference,
            "student_id": student.student_id if student else None,
            "student_name": student.full_name if student else "Unknown",
            "student_qualification": student.qualification if student else None,
            "placement_centre": centre.centre_name if centre else a.location_address or "—",
            "visit_date": str(a.scheduled_date),
            "visit_time": a.scheduled_time,
            "duration_hours": a.duration_hours,
            "appointment_type": a.appointment_type,
            "units_assessed": a.units_assessed or [],
            "status": a.status,
            "completed": a.completed,
            "feedback": a.feedback,
        })
    return records
