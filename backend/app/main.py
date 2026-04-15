"""ECEC Work Placement Management System — FastAPI v3.1"""
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
import logging

from app.database import engine, Base, SessionLocal, get_db
from app.api import auth, students, appointments, hours, compliance, communications, issues, users, dashboard
from app.api._combined import centres_router, notifications_router, reports_router
from app.api.audit import router as audit_router
from app.api.visit_reports import router as visit_reports_router
from app.api.trainer_profiles import router as trainer_profiles_router
from app.api.bulk_upload import router as bulk_upload_router
from app.api.matching import router as matching_router
from app.scheduler import start_scheduler, shutdown_scheduler
from app.seed import seed_database

logger = logging.getLogger(__name__)


def ensure_admin():
    """
    ALWAYS run at startup.
    Guarantees the admin account exists with the correct password
    regardless of database state or prior migrations.
    """
    from app.models import User
    from app.utils.auth import get_password_hash

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == "b.dotel@academies.edu.au").first()
        if user:
            # Reset password to known value every startup
            user.hashed_password = get_password_hash("aca0022z")
            user.is_active = True
            user.role = "admin"
            db.commit()
            logger.info("Admin account verified and password synced — b.dotel@academies.edu.au / aca0022z")
        else:
            # Create from scratch
            new_admin = User(
                id="3f328aff-6951-4367-b403-47b496346dab",
                email="b.dotel@academies.edu.au",
                username="bib",
                full_name="Bib Dotel",
                hashed_password=get_password_hash("aca0022z"),
                role="admin",
                campus="sydney",
                phone="0431577425",
                is_active=True,
            )
            db.add(new_admin)
            db.commit()
            logger.info("Admin account created — b.dotel@academies.edu.au / aca0022z")
    except Exception as e:
        logger.error(f"ensure_admin failed: {e}")
        db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_database()
    ensure_admin()          # <-- always runs, guarantees login works
    start_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(title="ECEC Work Placement System", version="3.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.include_router(auth.router,               prefix="/api/auth",              tags=["Auth"])
app.include_router(dashboard.router,          prefix="/api/dashboard",         tags=["Dashboard"])
app.include_router(students.router,           prefix="/api/students",          tags=["Students"])
app.include_router(appointments.router,       prefix="/api/appointments",      tags=["Appointments"])
app.include_router(hours.router,              prefix="/api/hours",             tags=["Hours"])
app.include_router(compliance.router,         prefix="/api/compliance",        tags=["Compliance"])
app.include_router(communications.router,     prefix="/api/communications",    tags=["Communications"])
app.include_router(issues.router,             prefix="/api/issues",            tags=["Issues"])
app.include_router(reports_router,            prefix="/api/reports",           tags=["Reports"])
app.include_router(users.router,              prefix="/api/users",             tags=["Users"])
app.include_router(centres_router,            prefix="/api/centres",           tags=["Centres"])
app.include_router(notifications_router,      prefix="/api/notifications",     tags=["Notifications"])
app.include_router(audit_router,              prefix="/api/audit",             tags=["Audit"])
app.include_router(visit_reports_router,      prefix="/api/visit-reports",     tags=["Visit Reports"])
app.include_router(trainer_profiles_router,   prefix="/api/trainer-profiles",  tags=["Trainer Profiles"])
app.include_router(bulk_upload_router,        prefix="/api/bulk",              tags=["Bulk Upload"])
app.include_router(matching_router,           prefix="/api/matching",          tags=["Matching"])


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "3.1.0"}


@app.post("/api/setup/reset-admin")
def reset_admin(db=Depends(get_db)):
    """Emergency reset — accessible via POST http://localhost/api/setup/reset-admin"""
    from app.models import User
    from app.utils.auth import get_password_hash
    user = db.query(User).filter(User.email == "b.dotel@academies.edu.au").first()
    if user:
        user.hashed_password = get_password_hash("aca0022z")
        user.is_active = True
        db.commit()
        return {"message": "Password reset to aca0022z", "email": user.email}
    new_admin = User(
        id="3f328aff-6951-4367-b403-47b496346dab",
        email="b.dotel@academies.edu.au", username="bib", full_name="Bib Dotel",
        hashed_password=get_password_hash("aca0022z"),
        role="admin", campus="sydney", is_active=True,
    )
    db.add(new_admin); db.commit()
    return {"message": "Admin created with password aca0022z"}
