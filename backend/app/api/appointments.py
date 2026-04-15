"""
Appointments API v3.1
Key changes:
  - trainer_assessor_id is now REQUIRED (raises 422 if missing)
  - Visit limits enforced: Cert III=3, Diploma=2; extra requires admin approval
  - Duplicate visit prevention for same student/type/date
  - Automated alert triggered on appointment creation (email + SMS)
  - All references to "supervisor" replaced with "trainer_assessor" in responses
"""
import uuid, logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from datetime import date

from app.database import get_db
from app.models import (
    Appointment, Student, User, PlacementCentre,
    APPOINTMENT_TYPE_CHOICES, QUALIFICATION_UNITS_MAP,
    UNITS_CHC30125, UNITS_CHC50125, VISIT_LIMITS,
)
from app.utils.auth import get_current_user
from app.services.email_service import email_appointment_reminder
from app.services.sms_service import sms_appointment_reminder

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

UNIT_MAP = {
    "CHC30121": UNITS_CHC30125, "CHC30125": UNITS_CHC30125,
    "CHC50121": UNITS_CHC50125, "CHC50125": UNITS_CHC50125,
}


def _gen_ref() -> str:
    return f"VIS-{uuid.uuid4().hex[:8].upper()}"


def _used_units(student_id: str, db: Session, exclude_id: Optional[str] = None) -> List[str]:
    q = db.query(Appointment).filter(
        Appointment.student_id == student_id,
        Appointment.cancelled == False,
    )
    if exclude_id:
        q = q.filter(Appointment.id != exclude_id)
    return list({u for a in q.all() for u in (a.units_assessed or [])})


def appt_to_dict(a: Appointment, db: Session) -> dict:
    student = db.query(Student).filter(Student.id == a.student_id).first()
    ta = db.query(User).filter(User.id == a.trainer_assessor_id).first() if a.trainer_assessor_id else None
    centre = db.query(PlacementCentre).filter(PlacementCentre.id == a.placement_centre_id).first() if a.placement_centre_id else None
    return {
        "id": a.id,
        "student_id": a.student_id,
        "student_name": student.full_name if student else "Unknown",
        "student_email": student.email if student else None,
        "student_phone": student.phone if student else None,
        "student_qualification": student.qualification if student else None,
        "trainer_assessor_id": a.trainer_assessor_id,
        "trainer_assessor_name": ta.full_name if ta else "Unassigned",
        "coordinator_id": a.trainer_assessor_id,
        "coordinator_name": ta.full_name if ta else None,
        "title": a.title,
        "appointment_type": a.appointment_type,
        "appointment_type_label": APPT_LABELS.get(a.appointment_type, a.appointment_type),
        "visit_type": getattr(a, "visit_type", "onsite"),
        "location_type": getattr(a, "visit_type", "onsite"),
        "placement_centre_id": a.placement_centre_id,
        "placement_centre_name": centre.centre_name if centre else None,
        "placement_centre_address": (
            ", ".join(filter(None, [centre.address, centre.suburb, centre.state, centre.postcode]))
            if centre else None
        ),
        "location_address": a.location_address,
        "scheduled_date": str(a.scheduled_date),
        "scheduled_time": a.scheduled_time,
        "duration_hours": a.duration_hours or 1.0,
        "units_assessed": a.units_assessed or [],
        "preparation_notes": a.preparation_notes,
        "required_evidence": a.required_evidence,
        "status": a.status,
        "completed": a.completed,
        "cancelled": a.cancelled,
        "feedback": a.feedback,
        "email_sent_48h": a.email_sent_48h,
        "email_sent_24h": a.email_sent_24h,
        "visit_reference": a.visit_reference,
        "requires_admin_approval": getattr(a, "requires_admin_approval", False),
        "admin_approved": getattr(a, "admin_approved", False),
        "created_at": str(a.created_at) if a.created_at else None,
    }


@router.get("")
def list_appointments(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    student_id: Optional[str] = None,
    appointment_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Appointment)
    if date_from: q = q.filter(Appointment.scheduled_date >= date.fromisoformat(date_from))
    if date_to: q = q.filter(Appointment.scheduled_date <= date.fromisoformat(date_to))
    if status: q = q.filter(Appointment.status == status)
    if student_id: q = q.filter(Appointment.student_id == student_id)
    if appointment_type: q = q.filter(Appointment.appointment_type == appointment_type)
    return [appt_to_dict(a, db) for a in q.order_by(
        Appointment.scheduled_date, Appointment.scheduled_time
    ).all()]


@router.get("/types")
def get_types():
    return [{"value": k, "label": v} for k, v in APPT_LABELS.items()]


@router.get("/units/{qualification}")
def get_units(
    qualification: str,
    student_id: Optional[str] = None,
    exclude_appt_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    all_units = UNIT_MAP.get(qualification, UNITS_CHC30125)
    used: List[str] = []
    if student_id:
        try:
            used = _used_units(student_id, db, exclude_appt_id)
        except Exception as exc:
            logger.warning(f"Could not load used units: {exc}")
    return {
        "qualification": qualification,
        "all_units": all_units,
        "used_units": used,
        "available_units": [u for u in all_units if u not in used],
    }


@router.get("/{appt_id}")
def get_appointment(appt_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    a = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not a: raise HTTPException(status_code=404, detail="Not found")
    return appt_to_dict(a, db)


class AppointmentCreate(BaseModel):
    student_id: str
    trainer_assessor_id: str          # REQUIRED — mandatory field
    title: str
    appointment_type: str
    visit_type: str = "onsite"
    placement_centre_id: Optional[str] = None
    location_address: Optional[str] = None
    scheduled_date: str
    scheduled_time: str = "09:00"
    duration_hours: float = 1.0
    units_assessed: Optional[List[str]] = None
    preparation_notes: Optional[str] = None
    required_evidence: Optional[str] = None
    send_confirmation_email: bool = True
    send_confirmation_sms: bool = False
    # For admin-approved extra visits
    force_create: bool = False


@router.post("")
def create_appointment(
    data: AppointmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate student
    student = db.query(Student).filter(Student.id == data.student_id).first()
    if not student: raise HTTPException(404, "Student not found")

    # Validate Trainer/Assessor (MANDATORY)
    ta = db.query(User).filter(User.id == data.trainer_assessor_id).first()
    if not ta: raise HTTPException(404, "Trainer/Assessor not found")

    # Validate appointment type
    if data.appointment_type not in APPOINTMENT_TYPE_CHOICES:
        raise HTTPException(400, f"Invalid appointment type")

    # ── Visit limit check ────────────────────────────────────────────────────
    requires_admin = False
    if data.appointment_type != "reassessment_visit":
        existing = db.query(Appointment).filter(
            Appointment.student_id == data.student_id,
            Appointment.cancelled == False,
            Appointment.appointment_type != "reassessment_visit",
        ).count()
        limit = VISIT_LIMITS.get(student.qualification, 3)
        if existing >= limit:
            if not data.force_create:
                raise HTTPException(
                    400,
                    f"Student has reached the {limit}-visit limit for {student.qualification}. "
                    f"Administrator approval required for additional visits. "
                    f"Set force_create=true if approved by admin."
                )
            requires_admin = True  # flagged but allowed

    # ── Duplicate check (same student + type + date) ──────────────────────
    dup = db.query(Appointment).filter(
        Appointment.student_id == data.student_id,
        Appointment.appointment_type == data.appointment_type,
        Appointment.scheduled_date == date.fromisoformat(data.scheduled_date),
        Appointment.cancelled == False,
    ).first()
    if dup:
        raise HTTPException(
            400,
            f"A '{APPT_LABELS.get(data.appointment_type)}' visit for this student on "
            f"{data.scheduled_date} already exists (ref: {dup.visit_reference}). "
            f"Duplicate visits are not allowed."
        )

    # ── Unit validation ───────────────────────────────────────────────────
    valid_units = UNIT_MAP.get(student.qualification, [])
    if data.units_assessed:
        invalid = [u for u in data.units_assessed if u not in valid_units]
        if invalid:
            raise HTTPException(400, f"Units not valid for {student.qualification}: {invalid}")
        used = _used_units(data.student_id, db)
        conflict = [u for u in data.units_assessed if u in used]
        if conflict:
            raise HTTPException(400, f"Units already assessed in a previous visit: {conflict}")

    a = Appointment(
        student_id=data.student_id,
        trainer_assessor_id=data.trainer_assessor_id,
        coordinator_id=data.trainer_assessor_id,
        title=data.title,
        appointment_type=data.appointment_type,
        visit_type=data.visit_type,
        placement_centre_id=data.placement_centre_id,
        location_address=data.location_address,
        scheduled_date=date.fromisoformat(data.scheduled_date),
        scheduled_time=data.scheduled_time,
        duration_hours=data.duration_hours,
        units_assessed=data.units_assessed or [],
        preparation_notes=data.preparation_notes,
        required_evidence=data.required_evidence,
        status="scheduled",
        visit_reference=_gen_ref(),
        requires_admin_approval=requires_admin,
        admin_approved=False,
        created_by=current_user.id,
    )
    db.add(a); db.commit(); db.refresh(a)

    # ── Notifications ─────────────────────────────────────────────────────
    centre = db.query(PlacementCentre).filter(PlacementCentre.id == data.placement_centre_id).first() if data.placement_centre_id else None
    location = (
        ", ".join(filter(None, [centre.address, centre.suburb, centre.state, centre.postcode]))
        if centre else (data.location_address or "TBC")
    )

    if data.send_confirmation_email:
        # Notify student
        if student.email:
            try:
                email_appointment_reminder(
                    student.full_name, student.email, student.full_name,
                    data.title, data.scheduled_date, data.scheduled_time,
                    "onsite", location, data.preparation_notes or "", 999, "",
                )
            except Exception as e:
                logger.error(f"Email to student failed: {e}")
        # Notify trainer/assessor
        if ta.email:
            try:
                email_appointment_reminder(
                    ta.full_name, ta.email, student.full_name,
                    data.title, data.scheduled_date, data.scheduled_time,
                    "onsite", location, data.preparation_notes or "", 999, "",
                )
            except Exception as e:
                logger.error(f"Email to trainer failed: {e}")

    if data.send_confirmation_sms and student.phone:
        try:
            sms_appointment_reminder(
                student.full_name, student.phone, data.title,
                data.scheduled_date, data.scheduled_time, 999,
            )
        except Exception as e:
            logger.error(f"SMS failed: {e}")

    return appt_to_dict(a, db)


class AppointmentUpdate(BaseModel):
    title: Optional[str] = None
    appointment_type: Optional[str] = None
    visit_type: Optional[str] = None
    placement_centre_id: Optional[str] = None
    location_address: Optional[str] = None
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    duration_hours: Optional[float] = None
    units_assessed: Optional[List[str]] = None
    preparation_notes: Optional[str] = None
    status: Optional[str] = None
    completed: Optional[bool] = None
    cancelled: Optional[bool] = None
    feedback: Optional[str] = None
    trainer_assessor_id: Optional[str] = None
    admin_approved: Optional[bool] = None


@router.put("/{appt_id}")
def update_appointment(
    appt_id: str, data: AppointmentUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    a = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not a: raise HTTPException(404, "Not found")
    for f, v in data.dict(exclude_none=True).items():
        if f == "scheduled_date": a.scheduled_date = date.fromisoformat(v)
        elif hasattr(a, f): setattr(a, f, v)
    db.commit(); db.refresh(a)
    return appt_to_dict(a, db)


@router.delete("/{appt_id}")
def delete_appointment(appt_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    a = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not a: raise HTTPException(404, "Not found")
    db.delete(a); db.commit()
    return {"message": "Deleted"}


@router.post("/{appt_id}/send-reminder")
def send_reminder(
    appt_id: str, send_sms_flag: bool = False,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    a = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not a: raise HTTPException(404, "Not found")
    student = db.query(Student).filter(Student.id == a.student_id).first()
    ta = db.query(User).filter(User.id == a.trainer_assessor_id).first() if a.trainer_assessor_id else None
    centre = db.query(PlacementCentre).filter(PlacementCentre.id == a.placement_centre_id).first() if a.placement_centre_id else None
    location = (
        ", ".join(filter(None, [centre.address, centre.suburb, centre.state, centre.postcode]))
        if centre else (a.location_address or "TBC")
    )
    days = (a.scheduled_date - date.today()).days
    sent = []

    for name, email_addr in [
        (student.full_name if student else None, student.email if student else None),
        (ta.full_name if ta else None, ta.email if ta else None),
    ]:
        if email_addr:
            try:
                email_appointment_reminder(
                    name, email_addr, student.full_name if student else "",
                    a.title, str(a.scheduled_date), a.scheduled_time,
                    "onsite", location, a.preparation_notes or "", days * 24, "",
                )
                sent.append(email_addr)
            except Exception as e:
                logger.error(f"Reminder email failed: {e}")

    if send_sms_flag and student and student.phone:
        try:
            sms_appointment_reminder(
                student.full_name, student.phone, a.title,
                str(a.scheduled_date), a.scheduled_time, days * 24,
            )
            sent.append(f"SMS:{student.phone}")
        except Exception as e:
            logger.error(f"Reminder SMS failed: {e}")

    return {"message": f"Reminder sent to: {', '.join(sent) or 'nobody (no contact info)'}"}
