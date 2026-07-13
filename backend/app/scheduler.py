"""
Background scheduler (APScheduler) - runs automated email alerts.

Automated reminders:
  1. Upcoming work placement visits - 14/7 days advance, plus 48h/24h imminent
  2. Compliance document expiry - 30-day notice, sent directly to the student
  3. Low attendance (< 50 % hours with < 30 days left) - sent directly to the student
  4. Supervisor feedback pending - 3/7/14 days after a completed visit with no feedback logged
  5. Placement Hours Log Reminder - fortnightly, to students behind on hours
  6. Monthly bulk compliance + upcoming-visit reminders
"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from datetime import date, timedelta, datetime
import logging

from app.database import SessionLocal
from app.models import Appointment, ComplianceDocument, Student, User
from app.services.email_service import send_email, base_template
from app.config import settings

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()


# ─── Shared dedup helper ──────────────────────────────────────────────────────
# check_appointment_reminders() (48h/24h, flag-based) and
# check_visit_advance_reminders() (14/7/3/1-day, Communication-log-based) both
# cover the "1 day before" case - 24 hours == 1 day - and would otherwise each
# independently email the student/trainer for the same appointment. Both jobs
# consult this helper before sending, and both record their send the same way,
# so whichever job runs first "claims" that appointment + day and the other
# skips it.
def _visit_reminder_already_sent(db, appointment, days_ahead: int) -> bool:
    from app.models import Communication
    dedup_key = f"visit_reminder_{appointment.id}_{days_ahead}d"
    if db.query(Communication).filter(Communication.template_used == dedup_key).first():
        return True
    if days_ahead == 2 and getattr(appointment, "email_sent_48h", False):
        return True
    if days_ahead == 1 and getattr(appointment, "email_sent_24h", False):
        return True
    return False


def _mark_visit_reminder_sent(db, appointment, days_ahead: int):
    from app.models import Communication
    dedup_key = f"visit_reminder_{appointment.id}_{days_ahead}d"
    db.add(Communication(
        student_id=appointment.student_id,
        recipient_email="",
        recipient_name="system",
        message_type="email",
        subject=f"{days_ahead}-day advance reminder - {appointment.title}",
        body=f"Automated {days_ahead}-day reminder sent for appointment {appointment.id} on {appointment.scheduled_date}.",
        template_used=dedup_key,
        sent_successfully=True,
    ))


# ─── Issue 2 / 16.3 - Appointment reminder (48h and 24h) ────────────────────
def check_appointment_reminders():
    """Send 48h and 24h email reminders for upcoming appointments."""
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

            days_ahead = hours_ahead // 24

            for appt in appointments:
                if _visit_reminder_already_sent(db, appt, days_ahead):
                    # Already covered by the other reminder job (or a previous
                    # run) - just clear this job's own flag so it doesn't keep
                    # re-checking, without sending a second email.
                    setattr(appt, flag_field, True)
                    db.commit()
                    continue

                student = db.query(Student).filter(Student.id == appt.student_id).first()
                if not student:
                    continue

                from app.models import PlacementCentre
                centre = db.query(PlacementCentre).filter(PlacementCentre.id == appt.placement_centre_id).first() if appt.placement_centre_id else None
                location_detail = (
                    ", ".join(filter(None, [centre.address, centre.suburb, centre.state, centre.postcode]))
                    if centre else (appt.location_address or "To be confirmed")
                )

                from app.api.communications import render_auto_template
                time_label = f"{hours_ahead}-Hour"
                prep_text = f"Preparation Notes: {appt.preparation_notes}\n\n" if appt.preparation_notes else ""

                def _send_imminent(recipient_name, recipient_email):
                    subject, body = render_auto_template(
                        db, "auto_appointment_reminder",
                        recipient_name=recipient_name, student_name=student.full_name,
                        appointment_title=appt.title, scheduled_date=str(appt.scheduled_date),
                        scheduled_time=appt.scheduled_time, location_type="Onsite",
                        location_detail=location_detail, preparation_notes_text=prep_text,
                        time_label=time_label, frontend_url=settings.FRONTEND_URL,
                    )
                    send_email(recipient_email, recipient_name, subject, base_template(body))

                # Email coordinator / trainer
                ta_id = getattr(appt, "trainer_assessor_id", None) or appt.coordinator_id
                if ta_id:
                    ta = db.query(User).filter(User.id == ta_id).first()
                    if ta and ta.email:
                        _send_imminent(ta.full_name, ta.email)

                # Email student
                if student.email:
                    _send_imminent(student.full_name, student.email)

                # Email supervisor
                if centre and centre.supervisor_email:
                    _send_imminent(centre.supervisor_name or "Supervisor", centre.supervisor_email)

                _mark_visit_reminder_sent(db, appt, days_ahead)
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
    """Alert the student directly about a document expiring in 30 days."""
    db = SessionLocal()
    try:
        today = date.today()
        days_ahead = 30
        target_date = today + timedelta(days=days_ahead)
        docs = db.query(ComplianceDocument).filter(
            ComplianceDocument.expiry_date == target_date,
            ComplianceDocument.alert_sent == False,
        ).all()

        from app.models import Communication
        from app.api.communications import render_auto_template

        for doc in docs:
            student = db.query(Student).filter(Student.id == doc.student_id).first()
            if not student:
                continue

            if student.email:
                doc_label = doc.document_type.replace("_", " ").title()
                subject, body = render_auto_template(
                    db, "auto_compliance_expiry",
                    student_name=student.full_name, doc_label=doc_label,
                    expiry_date=str(doc.expiry_date), days_until_expiry=days_ahead,
                    frontend_url=settings.FRONTEND_URL,
                )
                ok = send_email(student.email, student.full_name, subject, base_template(body))
                db.add(Communication(
                    student_id=student.id,
                    recipient_email=student.email,
                    recipient_name=student.full_name,
                    message_type="email",
                    subject=subject,
                    body=f"Automated 30-day compliance expiry reminder sent for document {doc.id}.",
                    template_used="compliance_expiry_30d",
                    sent_successfully=ok,
                ))

            doc.alert_sent = True
            db.commit()
            logger.info(f"Sent 30-day compliance expiry alert to student for doc {doc.id}")

    except Exception as e:
        logger.error(f"Compliance expiry job error: {e}")
        db.rollback()
    finally:
        db.close()


# ─── Issue 16.2 - Low attendance alert ──────────────────────────────────────
def check_low_attendance():
    """
    Alert the student directly if their hours progress is below 50%
    and their placement end date is within 30 days.
    """
    db = SessionLocal()
    try:
        today = date.today()
        threshold_date = today + timedelta(days=30)
        students = db.query(Student).filter(
            Student.status == "current",
            Student.placement_end_date != None,
            Student.placement_end_date <= threshold_date,
        ).all()

        from app.models import Communication
        from app.api.communications import render_auto_template

        for s in students:
            pct = (s.completed_hours / s.required_hours * 100) if s.required_hours else 0
            if pct < 50 and s.email:
                subject, body = render_auto_template(
                    db, "auto_low_attendance_alert",
                    student_name=s.full_name,
                    completed_hours=f"{s.completed_hours:.1f}",
                    required_hours=f"{s.required_hours:.0f}",
                    pct=f"{pct:.0f}",
                    placement_end_date=str(s.placement_end_date),
                )
                ok = send_email(s.email, s.full_name, subject, base_template(body))
                db.add(Communication(
                    student_id=s.id,
                    recipient_email=s.email,
                    recipient_name=s.full_name,
                    message_type="email",
                    subject=subject,
                    body=f"Automated low-attendance alert ({pct:.0f}% of required hours).",
                    template_used="low_attendance_alert",
                    sent_successfully=ok,
                ))
                db.commit()

        logger.info("Low attendance check complete")
    except Exception as e:
        logger.error(f"Low attendance job error: {e}")
        db.rollback()
    finally:
        db.close()


# ─── Issue 16.4 - Supervisor feedback pending ────────────────────────────────
def _feedback_reminder_already_sent(db, appointment, days_after: int) -> bool:
    from app.models import Communication
    dedup_key = f"feedback_pending_{appointment.id}_{days_after}d"
    return db.query(Communication).filter(Communication.template_used == dedup_key).first() is not None


def _mark_feedback_reminder_sent(db, appointment, days_after: int):
    from app.models import Communication
    dedup_key = f"feedback_pending_{appointment.id}_{days_after}d"
    db.add(Communication(
        student_id=appointment.student_id,
        recipient_email="", recipient_name="system",
        message_type="email",
        subject=f"Feedback pending reminder ({days_after}d) - {appointment.title}",
        body=f"Automated {days_after}-day feedback-pending reminder sent for appointment {appointment.id}.",
        template_used=dedup_key,
        sent_successfully=True,
    ))


def check_supervisor_feedback():
    """
    After a visit is marked complete, alert the trainer/assessor if no feedback has been
    recorded, at 3, 7, and 14 days after the visit. Stops automatically once feedback is
    logged (the query excludes appointments that already have feedback), and each interval
    only fires once per appointment thanks to the Communication-log dedup below.
    """
    db = SessionLocal()
    try:
        today = date.today()
        for days_after in [3, 7, 14]:
            cutoff = today - timedelta(days=days_after)
            appts = db.query(Appointment).filter(
                Appointment.completed == True,
                Appointment.feedback == None,
                Appointment.scheduled_date == cutoff,
            ).all()

            for appt in appts:
                if _feedback_reminder_already_sent(db, appt, days_after):
                    continue

                ta_id = getattr(appt, "trainer_assessor_id", None) or appt.coordinator_id
                if ta_id:
                    ta = db.query(User).filter(User.id == ta_id).first()
                    if ta and ta.email:
                        from app.api.communications import render_auto_template
                        student = db.query(Student).filter(Student.id == appt.student_id).first()
                        student_clause = f" for {student.full_name}" if student else ""
                        subject, body = render_auto_template(
                            db, "auto_supervisor_feedback_pending",
                            recipient_name=ta.full_name, appointment_title=appt.title,
                            student_clause=student_clause, scheduled_date=str(appt.scheduled_date),
                            days_after=days_after,
                        )
                        send_email(ta.email, ta.full_name, subject, base_template(body))

                _mark_feedback_reminder_sent(db, appt, days_after)
                db.commit()

        logger.info("Supervisor feedback check complete")
    except Exception as e:
        logger.error(f"Supervisor feedback job error: {e}")
        db.rollback()
    finally:
        db.close()


def check_visit_advance_reminders():
    """
    Send 14-day and 7-day advance reminders for upcoming appointments (3-day and
    1-day notice are covered by check_appointment_reminders' 48h/24h Visit
    Imminent Reminder instead, so they're not repeated here).
    Sends to both the student and assigned trainer/assessor.
    Uses the Communication log as a dedup gate - each appointment+interval is sent only once,
    even if the scheduler restarts.
    """
    db = SessionLocal()
    try:
        today = date.today()
        from app.models import PlacementCentre
        from app.api.communications import render_auto_template

        for days_ahead in [14, 7]:
            target_date = today + timedelta(days=days_ahead)
            appointments = db.query(Appointment).filter(
                Appointment.scheduled_date == target_date,
                Appointment.status == "scheduled",
                Appointment.cancelled == False,
            ).all()

            for appt in appointments:
                # Skip if already sent for this appointment + interval - by this
                # job or a previous run.
                if _visit_reminder_already_sent(db, appt, days_ahead):
                    continue

                student = db.query(Student).filter(Student.id == appt.student_id).first()
                if not student:
                    continue

                centre = (
                    db.query(PlacementCentre).filter(
                        PlacementCentre.id == appt.placement_centre_id
                    ).first()
                    if appt.placement_centre_id else None
                )
                location_detail = (
                    ", ".join(filter(None, [
                        centre.address if centre else None,
                        centre.suburb if centre else None,
                        centre.state if centre else None,
                        centre.postcode if centre else None,
                    ]))
                    or getattr(appt, "location_address", None)
                    or "To be confirmed"
                )
                location_type = (getattr(appt, "visit_type", "onsite") or "onsite").title()
                time_label = f"{days_ahead}-Day"
                prep_text = f"Preparation Notes: {appt.preparation_notes}\n\n" if appt.preparation_notes else ""

                # --- Write dedup sentinel BEFORE sending to prevent double-send on restart ---
                _mark_visit_reminder_sent(db, appt, days_ahead)
                db.commit()

                def _send_advance(recipient_name, recipient_email):
                    subject, body = render_auto_template(
                        db, "auto_appointment_reminder",
                        recipient_name=recipient_name, student_name=student.full_name,
                        appointment_title=appt.title, scheduled_date=str(appt.scheduled_date),
                        scheduled_time=appt.scheduled_time or "09:00", location_type=location_type,
                        location_detail=location_detail, preparation_notes_text=prep_text,
                        time_label=time_label, frontend_url=settings.FRONTEND_URL,
                    )
                    send_email(recipient_email, recipient_name, subject, base_template(body))

                # --- Send to trainer/assessor ---
                ta_id = getattr(appt, "trainer_assessor_id", None) or appt.coordinator_id
                if ta_id:
                    ta = db.query(User).filter(User.id == ta_id).first()
                    if ta and ta.email:
                        try:
                            _send_advance(ta.full_name, ta.email)
                        except Exception as e:
                            logger.warning(f"Failed to email trainer {ta.email}: {e}")

                # --- Send to student ---
                if student.email:
                    try:
                        _send_advance(student.full_name, student.email)
                    except Exception as e:
                        logger.warning(f"Failed to email student {student.email}: {e}")

                logger.info(
                    f"Sent {days_ahead}-day advance reminder for appointment {appt.id} "
                    f"({student.full_name})"
                )

    except Exception as e:
        logger.error(f"Visit advance reminder job error: {e}")
        db.rollback()
    finally:
        db.close()


# ─── Auto-complete students when course_end_date has passed ──────────────────
def auto_complete_students():
    """
    Daily job: automatically set status to 'completed' for any student whose
    course_end_date has passed and who is still 'current'.
    Withdrawn students are never auto-completed.
    """
    db = SessionLocal()
    try:
        today = date.today()
        students = db.query(Student).filter(
            Student.status == "current",
            Student.course_end_date.isnot(None),
            Student.course_end_date < today,
        ).all()

        for s in students:
            logger.info(f"Auto-completing student {s.student_id} - course end date {s.course_end_date} has passed")
            s.status = "completed"

        if students:
            db.commit()
            logger.info(f"Auto-completed {len(students)} student(s)")
        else:
            logger.info("Auto-complete check: no students to complete")

    except Exception as e:
        logger.error(f"Auto-complete students job error: {e}")
        db.rollback()
    finally:
        db.close()


def send_monthly_reminders():
    """
    Runs on the 1st of every month. Reuses the existing, already-working manual
    reminder functions (rather than duplicating their email wording /
    Communication-log behaviour) to notify:
      1. Students missing compliance documents
      2. Students + trainers with a visit scheduled in the next 30 days

    (The placement-hours-log reminder used to run here too; it now runs on its
    own fortnightly schedule - see send_hours_log_reminders_fortnightly below.)
    """
    db = SessionLocal()
    try:
        system_user = (
            db.query(User).filter(User.role == "admin").order_by(User.created_at.asc()).first()
        )
        if not system_user:
            logger.warning("Monthly reminders: no admin user found in the database, skipping run")
            return

        from app.api.compliance import send_compliance_reminders

        try:
            result = send_compliance_reminders(db=db, current_user=system_user)
            logger.info(f"Monthly compliance reminders: {result.get('message')}")
        except Exception as e:
            logger.error(f"Monthly compliance reminders failed: {e}")
            db.rollback()

        try:
            from app.models import Communication
            from app.api.appointments import send_reminder

            today = date.today()
            month_ahead = today + timedelta(days=30)
            month_key = today.strftime("%Y-%m")
            upcoming = db.query(Appointment).filter(
                Appointment.scheduled_date >= today,
                Appointment.scheduled_date <= month_ahead,
                Appointment.status == "scheduled",
                Appointment.cancelled == False,
            ).all()

            sent_count = 0
            for appt in upcoming:
                dedup_key = f"monthly_visit_reminder_{appt.id}_{month_key}"
                if db.query(Communication).filter(Communication.template_used == dedup_key).first():
                    continue
                try:
                    send_reminder(appt_id=appt.id, send_sms_flag=False, db=db, current_user=system_user)
                    db.add(Communication(
                        student_id=appt.student_id,
                        recipient_email="", recipient_name="system",
                        message_type="email",
                        subject=f"Monthly visit reminder - {appt.title}",
                        body=f"Automated monthly reminder sent for appointment {appt.id} on {appt.scheduled_date}.",
                        template_used=dedup_key,
                        sent_successfully=True,
                    ))
                    db.commit()
                    sent_count += 1
                except Exception as e:
                    logger.warning(f"Monthly visit reminder failed for appointment {appt.id}: {e}")
            logger.info(f"Monthly visit reminders: sent for {sent_count} upcoming appointment(s)")
        except Exception as e:
            logger.error(f"Monthly visit reminders failed: {e}")

    except Exception as e:
        logger.error(f"Monthly reminders job error: {e}")
        db.rollback()
    finally:
        db.close()


def send_hours_log_reminders_fortnightly():
    """
    Runs every 14 days. Sends the 'Placement Hours Log Reminder' email to every
    active student who hasn't met their required placement hours yet (reuses
    the existing manual send_hours_reminders logic / wording / Communication-log
    behaviour). Split out from send_monthly_reminders so its cadence can be
    changed independently of the other monthly reminders.
    """
    db = SessionLocal()
    try:
        system_user = (
            db.query(User).filter(User.role == "admin").order_by(User.created_at.asc()).first()
        )
        if not system_user:
            logger.warning("Fortnightly hours reminders: no admin user found, skipping run")
            return

        from app.api.compliance import send_hours_reminders
        result = send_hours_reminders(db=db, current_user=system_user)
        logger.info(f"Fortnightly hours reminders: {result.get('message')}")
    except Exception as e:
        logger.error(f"Fortnightly hours reminders job error: {e}")
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
    # 14/7/3/1 day advance visit reminders, runs daily
    scheduler.add_job(
        check_visit_advance_reminders,
        trigger=IntervalTrigger(hours=24),
        id="visit_advance_reminders",
        replace_existing=True,
        max_instances=1,
    )
    # Auto-complete students whose course_end_date has passed
    scheduler.add_job(
        auto_complete_students,
        trigger=IntervalTrigger(hours=24),
        id="auto_complete_students",
        replace_existing=True,
        max_instances=1,
    )
    # Monthly reminders (compliance + upcoming visits), 1st of each month at 8am
    scheduler.add_job(
        send_monthly_reminders,
        trigger=CronTrigger(day=1, hour=8, minute=0),
        id="monthly_reminders",
        replace_existing=True,
        max_instances=1,
    )
    # Placement Hours Log Reminder - fortnightly (every 14 days)
    scheduler.add_job(
        send_hours_log_reminders_fortnightly,
        trigger=IntervalTrigger(days=14),
        id="hours_log_reminder_fortnightly",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("Background scheduler started (8 jobs registered)")


def shutdown_scheduler():
    scheduler.shutdown(wait=False)
    logger.info("Background scheduler stopped")
