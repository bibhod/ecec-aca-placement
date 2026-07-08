from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel

from app.database import get_db
from app.models import User, NEW_ENTRY_CAMPUS_CHOICES, Student, Appointment, Communication, Issue
from app.utils.auth import get_current_user, get_password_hash, require_admin
from app.api.audit import write_audit

router = APIRouter()


def user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "username": u.username,
        "full_name": u.full_name,
        "role": u.role,
        "campus": u.campus,
        "phone": u.phone,
        "is_active": u.is_active,
        "must_change_password": u.must_change_password,
        # Trainer/Assessor-specific fields (only meaningful when role == "trainer",
        # but always returned so the User Management form can populate them).
        "qualifications_delivering": u.qualifications_delivering or [],
        "max_students": u.max_students,
        "created_at": str(u.created_at) if u.created_at else None,
    }


@router.get("")
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    users = db.query(User).order_by(User.full_name).all()
    return [user_to_dict(u) for u in users]


@router.get("/{user_id}")
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return user_to_dict(u)


class UserCreate(BaseModel):
    email: str
    full_name: str
    password: str
    role: str = "coordinator"
    campus: str = "sydney"
    phone: Optional[str] = None
    username: Optional[str] = None
    # Trainer/Assessor-specific fields (only used when role == "trainer")
    qualifications_delivering: Optional[List[str]] = None
    max_students: Optional[int] = 20


@router.post("")
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # New staff accounts may only be assigned to the current Sydney/Melbourne
    # campuses - existing staff elsewhere are untouched.
    if (data.campus or "").lower().strip() not in NEW_ENTRY_CAMPUS_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid campus for a new user. Valid: {NEW_ENTRY_CAMPUS_CHOICES}",
        )

    u = User(
        email=data.email,
        username=data.username or data.email.split("@")[0],
        full_name=data.full_name,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        campus=data.campus,
        phone=data.phone,
        is_active=True,
        # New accounts must change the admin-set password on first login.
        must_change_password=True,
        qualifications_delivering=data.qualifications_delivering or [] if data.role == "trainer" else [],
        max_students=data.max_students if data.role == "trainer" else None,
    )
    db.add(u)
    db.commit()
    db.refresh(u)

    # Audit: record user creation
    write_audit(
        db, current_user, "user.create", "user",
        resource_id=u.id, resource_label=f"{u.full_name} ({u.email})",
        details={"role": u.role, "campus": u.campus},
    )
    db.commit()

    return user_to_dict(u)


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    campus: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    # Trainer/Assessor-specific fields (only used when role == "trainer")
    qualifications_delivering: Optional[List[str]] = None
    max_students: Optional[int] = None


@router.put("/{user_id}")
def update_user(
    user_id: str,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if data.full_name is not None:
        u.full_name = data.full_name
    if data.role is not None:
        u.role = data.role
    if data.campus is not None:
        u.campus = data.campus
    if data.phone is not None:
        u.phone = data.phone
    if data.is_active is not None:
        u.is_active = data.is_active
    if data.password:
        u.hashed_password = get_password_hash(data.password)
        # Password was reset by an admin - force the user to set their own
        # new password the next time they log in.
        u.must_change_password = True
    if data.qualifications_delivering is not None:
        u.qualifications_delivering = data.qualifications_delivering
    if data.max_students is not None:
        u.max_students = data.max_students

    db.commit()
    db.refresh(u)

    # Audit: record user update
    write_audit(
        db, current_user, "user.update", "user",
        resource_id=u.id, resource_label=f"{u.full_name} ({u.email})",
        details={"updated_fields": list(data.dict(exclude_none=True).keys())},
    )
    db.commit()

    return user_to_dict(u)


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Permanently delete a user account. Admin-only (require_admin).

    A user can't be deleted (only deactivated) while they're still
    referenced elsewhere in the system - as a student's coordinator, an
    appointment's trainer/assessor/coordinator/creator, a communication
    sender, or an issue reporter - since the database would otherwise
    either block the delete with a foreign-key error or silently orphan
    that history. Reassign or clear those records first, or use
    PUT /{user_id} with is_active: false to disable the account instead,
    which keeps the audit trail intact.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    blockers = []
    if db.query(Student).filter(Student.coordinator_id == user_id).count():
        blockers.append("assigned as a coordinator to one or more students")
    if db.query(Appointment).filter(
        (Appointment.trainer_assessor_id == user_id)
        | (Appointment.coordinator_id == user_id)
        | (Appointment.created_by == user_id)
    ).count():
        blockers.append("linked to one or more appointments")
    if db.query(Communication).filter(Communication.sender_id == user_id).count():
        blockers.append("the sender of one or more logged communications")
    if db.query(Issue).filter(Issue.reported_by == user_id).count():
        blockers.append("the reporter of one or more logged issues")

    if blockers:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot permanently delete {u.full_name}: this account is still "
                f"{', and '.join(blockers)}. Reassign those records first, or use "
                "Deactivate instead to disable the account without losing history."
            ),
        )

    user_label = f"{u.full_name} ({u.email})"
    user_role = u.role

    db.delete(u)
    db.commit()

    # Audit: record permanent user deletion (audit_logs.user_id is a plain
    # string, not a foreign key, so this row safely outlives the deleted user).
    write_audit(
        db, current_user, "user.delete", "user",
        resource_id=user_id, resource_label=f"{user_label} - permanently deleted",
        details={"role": user_role},
    )
    db.commit()

    return {"message": "User permanently deleted"}
