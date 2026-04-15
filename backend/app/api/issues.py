from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.models import Issue, Student, User
from app.utils.auth import get_current_user
from app.services.email_service import email_issue_notification
from app.config import settings

router = APIRouter()


def issue_to_dict(i: Issue, db: Session) -> dict:
    student = db.query(Student).filter(Student.id == i.student_id).first()
    reporter = db.query(User).filter(User.id == i.reported_by).first() if i.reported_by else None
    return {
        "id": i.id,
        "student_id": i.student_id,
        "student_name": student.full_name if student else "Unknown",
        "reported_by": i.reported_by,
        "reporter_name": reporter.full_name if reporter else None,
        "issue_type": i.issue_type,
        "title": i.title,
        "description": i.description,
        "priority": i.priority,
        "status": i.status,
        "resolution": i.resolution,
        "resolved_by": i.resolved_by,
        "resolved_at": str(i.resolved_at) if i.resolved_at else None,
        "created_at": str(i.created_at) if i.created_at else None,
        "updated_at": str(i.updated_at) if i.updated_at else None,
    }


@router.get("")
def list_issues(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    student_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = db.query(Issue)
    if status:
        q = q.filter(Issue.status == status)
    if priority:
        q = q.filter(Issue.priority == priority)
    if student_id:
        q = q.filter(Issue.student_id == student_id)
    issues = q.order_by(Issue.created_at.desc()).all()
    return [issue_to_dict(i, db) for i in issues]


@router.get("/{issue_id}")
def get_issue(
    issue_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    i = db.query(Issue).filter(Issue.id == issue_id).first()
    if not i:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue_to_dict(i, db)


class IssueCreate(BaseModel):
    student_id: str
    issue_type: str
    title: str
    description: Optional[str] = None
    priority: str = "medium"


@router.post("")
def create_issue(
    data: IssueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    student = db.query(Student).filter(Student.id == data.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    issue = Issue(
        student_id=data.student_id,
        reported_by=current_user.id,
        issue_type=data.issue_type,
        title=data.title,
        description=data.description,
        priority=data.priority,
        status="open",
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)

    # Notify coordinator via email
    coordinator = None
    if student.coordinator_id:
        coordinator = db.query(User).filter(User.id == student.coordinator_id).first()
    if not coordinator:
        coordinator = current_user

    if coordinator and coordinator.email and coordinator.id != current_user.id:
        email_issue_notification(
            coordinator_name=coordinator.full_name,
            coordinator_email=coordinator.email,
            student_name=student.full_name,
            issue_title=data.title,
            issue_type=data.issue_type,
            priority=data.priority,
            description=data.description or "",
            frontend_url=settings.FRONTEND_URL
        )

    return issue_to_dict(issue, db)


class IssueUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    resolution: Optional[str] = None


@router.put("/{issue_id}")
def update_issue(
    issue_id: str,
    data: IssueUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    if data.title is not None:
        issue.title = data.title
    if data.description is not None:
        issue.description = data.description
    if data.priority is not None:
        issue.priority = data.priority
    if data.status is not None:
        issue.status = data.status
        if data.status in ("resolved", "closed"):
            issue.resolved_by = current_user.full_name
            issue.resolved_at = datetime.utcnow()
    if data.resolution is not None:
        issue.resolution = data.resolution

    db.commit()
    db.refresh(issue)
    return issue_to_dict(issue, db)


@router.delete("/{issue_id}")
def delete_issue(
    issue_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    db.delete(issue)
    db.commit()
    return {"message": "Issue deleted"}
