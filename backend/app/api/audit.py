"""
Audit Trail API (Issue 14)
Provides:
  - Listing/filtering of all audit log entries
  - Exportable CSV/Excel reports
  - Helper function write_audit() used by other routers
"""
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from app.database import get_db
from app.models import AuditLog, User
from app.utils.auth import get_current_user

router = APIRouter()


# ─── Helper used by other routers to record audit events ─────────────────────
def write_audit(
    db: Session,
    user: User,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    resource_label: Optional[str] = None,
    details: Optional[dict] = None,
    request: Optional[Request] = None,
):
    """
    Insert a row into audit_logs.
    Call this from any API endpoint that creates, updates, or deletes data.
    """
    ip = None
    if request:
        forwarded = request.headers.get("X-Forwarded-For")
        ip = forwarded.split(",")[0].strip() if forwarded else request.client.host if request.client else None

    entry = AuditLog(
        user_id=user.id,
        user_email=user.email,
        user_name=user.full_name,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_label=resource_label,
        details=details,
        ip_address=ip,
    )
    db.add(entry)
    # Note: caller is responsible for db.commit()


# ─── List audit logs ──────────────────────────────────────────────────────────
@router.get("")
def list_audit_logs(
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    user_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(AuditLog)
    if action:
        q = q.filter(AuditLog.action.ilike(f"%{action}%"))
    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if date_from:
        q = q.filter(AuditLog.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(AuditLog.created_at <= datetime.fromisoformat(date_to))
    total = q.count()
    entries = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "entries": [
            {
                "id": e.id,
                "user_id": e.user_id,
                "user_email": e.user_email,
                "user_name": e.user_name,
                "action": e.action,
                "resource_type": e.resource_type,
                "resource_id": e.resource_id,
                "resource_label": e.resource_label,
                "details": e.details,
                "ip_address": e.ip_address,
                "created_at": str(e.created_at) if e.created_at else None,
            }
            for e in entries
        ],
    }


# ─── Export CSV ───────────────────────────────────────────────────────────────
@router.get("/export/csv")
def export_audit_csv(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(AuditLog)
    if date_from:
        q = q.filter(AuditLog.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(AuditLog.created_at <= datetime.fromisoformat(date_to))
    entries = q.order_by(AuditLog.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Timestamp", "User Email", "User Name", "Action",
        "Resource Type", "Resource ID", "Resource Label", "IP Address",
    ])
    for e in entries:
        writer.writerow([
            str(e.created_at), e.user_email or "", e.user_name or "",
            e.action, e.resource_type or "", e.resource_id or "",
            e.resource_label or "", e.ip_address or "",
        ])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_report.csv"},
    )
