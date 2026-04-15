"""
Background scheduler (APScheduler) — runs email/SMS alerts automatically.
Issues fixed:
  Issue 2  — SMS alongside email for appointment reminders
  Issue 16 — automated alerts:
              1. Non-submission of log hours
              2. Low attendance (< 50 % hours with < 30 days left)
              3. Upcoming work placement visits (48h / 24h)
              4. Supervisor feedback pending
"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import date, timedelta, datetime
import logging

from app.database import SessionLocal
from app.models import Appointment, ComplianceDocument, Student, User, HoursLog
from app.services.email_service import email_appointment_reminder, email_compliance_expiry
from app.services.sms_service import sms_appointment_reminder, sms_hours_overdue, sms_compliance_expiry
from app.config import settings

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()


# ─── Issue 2 / 16.3 — Appointment reminder (48h and 24h) ────────────────────
def check_appointment_reminders():
    """Send 48h and 24h email + optional SMS reminders for upcoming appointments."""
    db = SessionLocal()
    try:
        today = date.today()
        for hours_ahead, flag_field in [(48, "email_sent_48h"), (24, "email_sent_24h")]:
            target_date = today + timedelta(hours=hours_ahead)
            appointments = db.query(Appointment).filter(
                Appointment.scheduled_date == target_date,
                Appointment.status == "scheduled",
                Appointment.cancelled == False,
                getattr(Appointment, flag_field) == False,
            ).all()

            for appt in appointments:
                student = db.query(Student).filter(Student.id == appt.student_id).first()
                if not student:
                    continue

                from app.models import PlacementCentre
                centre = db.query(PlacementCentre).filter(PlacementCentre.id == appt.placement_centre_id).first() if appt.placement_centre_id else None
                location_detail = (
                    ", ".join(filter(None, [centre.address, centre.suburb, centre.state, centre.postcode]))
                    if centre else (appt.location_address or "To be confirmed")
                )

                # Email coordinator / trainer
                ta_id = getattr(appt, "trainer_assessor_id", None) or appt.coordinator_id
                if ta_id:
                    ta = db.query(User).filter(User.id == ta_id).first()
                    if ta and ta.email:
                        email_appointment_reminder(
                            ta.full_name, ta.email, student.full_name, appt.title,
                            str(appt.scheduled_date), appt.scheduled_time, "onsite",
                            location_detail, appt.preparation_notes or "", hours_ahead, settings.FRONTEND_URL,
                        )

                # Email student
                if student.email:
                    email_appointment_reminder(
                        student.full_name, student.email, student.full_name, appt.title,
                        str(appt.scheduled_date), appt.scheduled_time, "onsite",
                        location_detail, appt.preparation_notes or "", hours_ahead, settings.FRONTEND_URL,
                    )

                # SMS student (Issue 2)
                if student.phone:
                    sms_appointment_reminder(
                        student.full_name, student.phone, appt.title,
                        str(appt.scheduled_date), appt.scheduled_time, hours_ahead,
                    )

                # Email supervisor
                if centre and centre.supervisor_email:
                    email_appointment_reminder(
                        centre.supervisor_name or "Supervisor", centre.supervisor_email,
                        student.full_name, appt.title, str(appt.scheduled_date), appt.scheduled_time,
                        "onsite", location_detail, appt.preparation_notes or "", hours_ahead, settings.FRONTEND_URL,
                    )

                setattr(appt, flag_field, True)
                db.commit()
                logger.info(f"Sent {hours_ahead}h reminder for appointment {appt.id}")

    except Exception as e:
        logger.error(f"Appointment reminder job error: {e}")
        db.rollback()
    finally:
        db.close()


# ─── Compliance expiry alerts ────────────────────────────────────────────────
def check_compliance_expiry():
    """Alert coordinators (email + SMS) about documents expiring in 30, 14, and 7 days."""
    db = SessionLocal()
    try:
        today = date.today()
        for days_ahead in [30, 14, 7]:
            target_date = today + timedelta(days=days_ahead)
            docs = db.query(ComplianceDocument).filter(
                ComplianceDocument.expiry_date == target_date,
                ComplianceDocument.alert_sent == False,
            ).all()

            for doc in docs:
                student = db.query(Student).filter(Student.id == doc.student_id).first()
                if not student:
                    continue
                coordinator = None
                if student.coordinator_id:
                    coordinator = db.query(User).filter(User.id == student.coordinator_id).first()

                coord_name = coordinator.full_name if coordinator else "Coordinator"
                coord_email = coordinator.email if coordinator else None

                if coord_email:
                    email_compliance_expiry(
                        student.full_name, student.email or "",
                        coord_name, coord_email,
                        doc.document_type, str(doc.expiry_date), days_ahead, settings.FRONTEND_URL,
                    )

                # SMS student about their own expiring document
                if student.phone:
                    sms_compliance_expiry(student.full_name, student.phone, doc.document_type, days_ahead)

                doc.alert_sent = True
                db.commit()
                logger.info(f"Sent compliance expiry alert for doc {doc.id}")

    except Exception as e:
        logger.error(f"Compliance expiry job error: {e}")
        db.rollback()
    finally:
        db.close()


# ─── Issue 16.1 — Non-submission of log hours ────────────────────────────────
def check_hours_non_submission():
    """
    Flag active students who have not logged any hours in the past 14 days.
    Sends an email to the coordinator and an SMS to the student.
    """
    db = SessionLocal()
    try:
        today = date.today()
        cutoff = today - timedelta(days=14)
        students = db.query(Student).filter(Student.status == "active").all()

        for s in students:
            recent_log = db.query(HoursLog).filter(
                HoursLog.student_id == s.id,
                HoursLog.log_date >= cutoff,
            ).first()

            if not recent_log:
                # Notify coordinator
                if s.coordinator_id:
                    coordinator = db.query(User).filter(User.id == s.coordinator_id).first()
                    if coordinator and coordinator.email:
                        from app.services.email_service import send_email, base_template
                        subject = f"Hours Not Logged — {s.full_name}"
                        body = (
                            f"<h2>Hours Non-Submission Alert</h2>"
                            f"<p>Dear {coordinator.full_name},</p>"
                            f"<p>Student <strong>{s.full_name}</strong> ({s.student_id}) "
                            f"has not logged any placement hours in the past 14 days.</p>"
                            f"<p>Please follow up with the student to ensure their hours are up to date.</p>"
                        )
                        send_email(coordinator.email, coordinator.full_name, subject, base_template(body))

                # SMS student
                if s.phone:
                    sms_hours_overdue(s.full_name, s.phone, 2)

        logger.info("Hours non-submission check complete")
    except Exception as e:
        logger.error(f"Hours non-submission job error: {e}")
        db.rollback()
    finally:
        db.close()


# ─── Issue 16.2 — Low attendance alert ──────────────────────────────────────
def check_low_attendance():
    """
    Alert coordinator if a student's hours progress is below 50%
    and their placement end date is within 30 days.
    """
    db = SessionLocal()
    try:
        today = date.today()
        threshold_date = today + timedelta(days=30)
        students = db.query(Student).filter(
            Student.status == "active",
            Student.placement_end_date != None,
            Student.placement_end_date <= threshold_date,
        ).all()

        for s in students:
            pct = (s.completed_hours / s.required_hours * 100) if s.required_hours else 0
            if pct < 50:
                if s.coordinator_id:
                    coordinator = db.query(User).filter(User.id == s.coordinator_id).first()
                    if coordinator and coordinator.email:
                        from app.services.email_service import send_email, base_template
                        subject = f"Low Attendance Alert — {s.full_name}"
                        body = (
                            f"<h2>Low Attendance Alert</h2>"
                            f"<p>Dear {coordinator.full_name},</p>"
                            f"<p>Student <strong>{s.full_name}</strong> ({s.student_id}) "
                            f"has completed only <strong>{s.completed_hours:.1f} / {s.required_hours:.0f} hours ({pct:.0f}%)</strong> "
                            f"with their placement ending on <strong>{s.placement_end_date}</strong>.</p>"
                            f"<p>Urgent action may be required.</p>"
                        )
                        send_email(coordinator.email, coordinator.full_name, subject, base_template(body))

        logger.info("Low attendance check complete")
    except Exception as e:
        logger.error(f"Low attendance job error: {e}")
        db.rollback()
    finally:
        db.close()


# ─── Issue 16.4 — Supervisor feedback pending ────────────────────────────────
def check_supervisor_feedback():
    """
    After a visit is marked complete, alert the coordinator if no feedback has been recorded
    within 3 days.
    """
    db = SessionLocal()
    try:
        cutoff = date.today() - timedelta(days=3)
        appts = db.query(Appointment).filter(
            Appointment.completed == True,
            Appointment.feedback == None,
            Appointment.scheduled_date <= cutoff,
        ).all()

        for appt in appts:
            ta_id = getattr(appt, "trainer_assessor_id", None) or appt.coordinator_id
            if ta_id:
                ta = db.query(User).filter(User.id == ta_id).first()
                if ta and ta.email:
                    from app.services.email_service import send_email, base_template
                    student = db.query(Student).filter(Student.id == appt.student_id).first()
                    subject = f"Feedback Pending — {appt.title}"
                    body = (
                        f"<h2>Supervisor Feedback Pending</h2>"
                        f"<p>Dear {ta.full_name},</p>"
                        f"<p>The appointment <strong>{appt.title}</strong>"
                        + (f" for {student.full_name}" if student else "")
                        + f" was completed on {appt.scheduled_date} but no feedback has been recorded.</p>"
                        f"<p>Please log feedback in the portal at your earliest convenience.</p>"
                    )
                    send_email(ta.email, ta.full_name, subject, base_template(body))

        logger.info("Supervisor feedback check complete")
    except Exception as e:
        logger.error(f"Supervisor feedback job error: {e}")
        db.rollback()
    finally:
        db.close()


def start_scheduler():
    scheduler.add_job(
        check_appointment_reminders,
        trigger=IntervalTrigger(hours=1),
        id="appointment_reminders",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        check_compliance_expiry,
        trigger=IntervalTrigger(hours=6),
        id="compliance_expiry",
        replace_existing=True,
        max_instances=1,
    )
    # Issue 16 — new scheduled jobs
    scheduler.add_job(
        check_hours_non_submission,
        trigger=IntervalTrigger(hours=24),
        id="hours_non_submission",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        check_low_attendance,
        trigger=IntervalTrigger(hours=24),
        id="low_attendance",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        check_supervisor_feedback,
        trigger=IntervalTrigger(hours=12),
        id="supervisor_feedback",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("Background scheduler started (5 jobs registered)")


def shutdown_scheduler():
    scheduler.shutdown(wait=False)
    logger.info("Background scheduler stopped")
