from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel

from app.database import get_db
from app.models import User
from app.utils.auth import get_current_user, get_password_hash, require_admin

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


@router.post("")
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    u = User(
        email=data.email,
        username=data.username or data.email.split("@")[0],
        full_name=data.full_name,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        campus=data.campus,
        phone=data.phone,
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return user_to_dict(u)


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    campus: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


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

    db.commit()
    db.refresh(u)
    return user_to_dict(u)


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.is_active = False
    db.commit()
    return {"message": "User deactivated"}
