from datetime import date
import time
import logging
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import SessionLocal, engine
from app.models import Base, User, Student, PlacementCentre, ComplianceDocument, Appointment, HoursLog
from app.utils.auth import get_password_hash

logger = logging.getLogger(__name__)


def wait_for_db(retries=30, delay=2):
    for i in range(retries):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Database is ready.")
            return True
        except Exception as e:
            logger.warning(f"Waiting for database... attempt {i+1}/{retries}")
            time.sleep(delay)
    raise RuntimeError("Database never became ready")


def seed_database():
    try:
        wait_for_db()
    except RuntimeError as e:
        logger.error(str(e))
        return

    Base.metadata.create_all(bind=engine)
    logger.info("Tables created/verified.")

    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            logger.info("Database already has data, skipping seed.")
            return
        logger.info("Seeding database...")
        _do_seed(db)
        logger.info("Database seeded successfully!")
    except Exception as e:
        logger.error(f"Seed error: {e}")
        import traceback; traceback.print_exc()
        db.rollback()
    finally:
        db.close()


def _do_seed(db: Session):
    admin = User(
        id="3f328aff-6951-4367-b403-47b496346dab",
        email="b.dotel@academies.edu.au", username="bib", full_name="Bib Dotel",
        hashed_password=get_password_hash("aca0022z"),
        role="admin", campus="sydney", phone="0431577425", is_active=True
    )
    c1 = User(
        id="7f854ead-5e55-4919-b7ac-6a1542d5b46b",
        email="james.wong@academies.edu.au", username="jwong", full_name="James Wong",
        hashed_password=get_password_hash("password123"),
        role="coordinator", campus="sydney", is_active=True
    )
    c2 = User(
        id="86e12151-deac-4815-802a-25d73f82a2b9",
        email="emma.davis@academies.edu.au", username="edavis", full_name="Emma Davis",
        hashed_password=get_password_hash("password123"),
        role="coordinator", campus="melbourne", is_active=True
    )
    db.add_all([admin, c1, c2]); db.flush()

    centres = [
        PlacementCentre(id="centre-001", centre_name="Sunshine Childcare Centre", address="78 Collins Street", suburb="Melbourne", state="VIC", postcode="3000", supervisor_name="Michael Brown", supervisor_email="michael.brown@sunshinechildcare.com.au", supervisor_phone="0456 789 012", approved=True, nqs_rating="Meeting NQS"),
        PlacementCentre(id="centre-002", centre_name="Bright Futures Childcare", address="123 Pitt Street", suburb="Sydney", state="NSW", postcode="2000", supervisor_name="Amanda Wilson", supervisor_email="amanda@brightfutures.com.au", supervisor_phone="0456 111 222", approved=True, nqs_rating="Exceeding NQS"),
        PlacementCentre(id="centre-003", centre_name="Rainbow Kids Academy", address="200 Bourke Street", suburb="Melbourne", state="VIC", postcode="3000", supervisor_name="Sarah Chen", supervisor_email="sarah@rainbowkids.com.au", supervisor_phone="0456 333 444", approved=True, nqs_rating="Meeting NQS"),
        PlacementCentre(id="centre-004", centre_name="Little Stars Early Learning", address="45 George Street", suburb="Sydney", state="NSW", postcode="2000", supervisor_name="Robert Kim", supervisor_email="robert@littlestars.com.au", supervisor_phone="0456 555 666", approved=True, nqs_rating="Exceeding NQS"),
        PlacementCentre(id="centre-005", centre_name="Sunshine Early Learning", address="123 Main Street", suburb="Sydney", state="NSW", postcode="2000", supervisor_name="Lisa Park", supervisor_email="lisa@sunshineearlylearning.com.au", supervisor_phone="0456 777 888", approved=True, nqs_rating="Working Towards NQS"),
    ]
    db.add_all(centres); db.flush()

    students = [
        Student(id="24abb829-fb8d-46ab-9e43-b55244b5773c", student_id="STU2024004", full_name="Liam Taylor", email="liam.taylor@student.academies.edu.au", phone="0412 345 678", qualification="CHC30121", campus="sydney", status="active", course_start_date=date(2024,2,20), course_end_date=date(2024,11,30), placement_centre_id="centre-001", placement_start_date=date(2024,5,15), placement_end_date=date(2024,10,30), required_hours=160, completed_hours=124, coordinator_id="7f854ead-5e55-4919-b7ac-6a1542d5b46b"),
        Student(id="69147dbb-2f96-446c-bd9f-cdeab63ab3ac", student_id="STU2024002", full_name="Noah Johnson", email="noah.johnson@student.academies.edu.au", phone="0423 456 789", qualification="CHC30121", campus="sydney", status="active", course_start_date=date(2024,3,15), course_end_date=date(2024,12,20), placement_centre_id="centre-002", placement_start_date=date(2024,7,1), placement_end_date=date(2024,11,30), required_hours=160, completed_hours=70, coordinator_id="7f854ead-5e55-4919-b7ac-6a1542d5b46b"),
        Student(id="aa3c8d12-f1b2-4e56-9c78-def012340001", student_id="STU2024003", full_name="Olivia Smith", email="olivia.smith@student.academies.edu.au", phone="0434 567 890", qualification="CHC50121", campus="sydney", status="active", course_start_date=date(2024,1,10), course_end_date=date(2025,6,30), placement_centre_id="centre-002", placement_start_date=date(2024,4,1), placement_end_date=date(2025,3,31), required_hours=288, completed_hours=0, coordinator_id="7f854ead-5e55-4919-b7ac-6a1542d5b46b"),
        Student(id="bb4d9e23-a2c3-5f67-0d89-ef0123456002", student_id="STU2024005", full_name="Emma Williams", email="emma.williams@student.academies.edu.au", phone="0445 678 901", qualification="CHC50121", campus="melbourne", status="active", course_start_date=date(2024,2,1), course_end_date=date(2025,7,31), placement_centre_id="centre-003", placement_start_date=date(2024,5,1), placement_end_date=date(2025,4,30), required_hours=288, completed_hours=147, coordinator_id="86e12151-deac-4815-802a-25d73f82a2b9"),
        Student(id="cc5e0f34-a3d4-6a78-1e90-f01234567003", student_id="STU2024001", full_name="Sophie Brown", email="sophie.brown@student.academies.edu.au", phone="0456 789 012", qualification="CHC50121", campus="sydney", status="active", course_start_date=date(2024,3,1), course_end_date=date(2025,8,31), placement_centre_id="centre-004", placement_start_date=date(2024,6,1), placement_end_date=date(2025,5,31), required_hours=288, completed_hours=109, coordinator_id="7f854ead-5e55-4919-b7ac-6a1542d5b46b"),
        Student(id="dd6f1045-a4e5-7b89-2f01-012345678004", student_id="202512345", full_name="Mike Quinn", email="mike.quinn@student.academies.edu.au", phone="0467 890 123", qualification="CHC30121", campus="melbourne", status="active", course_start_date=date(2025,1,15), course_end_date=date(2025,12,15), placement_centre_id="centre-005", placement_start_date=date(2025,3,1), placement_end_date=date(2025,11,30), required_hours=160, completed_hours=29.3, coordinator_id="86e12151-deac-4815-802a-25d73f82a2b9"),
        Student(id="ee7a2156-b5f6-8c90-3a12-123456789005", student_id="STU2024006", full_name="Jessica Lee", email="jessica.lee@student.academies.edu.au", phone="0478 901 234", qualification="CHC30121", campus="sydney", status="active", course_start_date=date(2024,4,1), course_end_date=date(2024,12,31), placement_centre_id="centre-002", placement_start_date=date(2024,6,15), placement_end_date=date(2024,12,15), required_hours=160, completed_hours=45, coordinator_id="7f854ead-5e55-4919-b7ac-6a1542d5b46b"),
        Student(id="ff8b3267-c6a7-9d01-4b23-234567890006", student_id="STU2024007", full_name="Daniel Park", email="daniel.park@student.academies.edu.au", phone="0489 012 345", qualification="CHC50121", campus="perth", status="active", course_start_date=date(2024,2,15), course_end_date=date(2025,9,30), placement_centre_id=None, required_hours=288, completed_hours=0, coordinator_id="86e12151-deac-4815-802a-25d73f82a2b9"),
    ]
    db.add_all(students); db.flush()

    docs = [
        ComplianceDocument(student_id="24abb829-fb8d-46ab-9e43-b55244b5773c", document_type="working_with_children_check", document_number="WWC-VIC-456789", issue_date=date(2024,2,1), expiry_date=date(2029,2,1), verified=True, verified_by="James Wong", verified_at=date(2024,2,20), notes="VIC WWCC"),
        ComplianceDocument(student_id="24abb829-fb8d-46ab-9e43-b55244b5773c", document_type="first_aid_certificate", document_number="FA-2024-001", issue_date=date(2024,2,15), expiry_date=date(2027,2,15), verified=True, verified_by="James Wong"),
        ComplianceDocument(student_id="69147dbb-2f96-446c-bd9f-cdeab63ab3ac", document_type="working_with_children_check", document_number="WWC9876543", issue_date=date(2023,6,10), expiry_date=date(2028,6,10), verified=True, verified_by="Emma Davis"),
        ComplianceDocument(student_id="69147dbb-2f96-446c-bd9f-cdeab63ab3ac", document_type="first_aid_certificate", document_number="FA-2024-002", issue_date=date(2024,1,20), expiry_date=date(2024,10,20), verified=True, verified_by="Emma Davis"),
        ComplianceDocument(student_id="aa3c8d12-f1b2-4e56-9c78-def012340001", document_type="working_with_children_check", document_number="WWC-NSW-112233", issue_date=date(2024,1,5), expiry_date=date(2029,1,5), verified=False),
        ComplianceDocument(student_id="bb4d9e23-a2c3-5f67-0d89-ef0123456002", document_type="working_with_children_check", document_number="WWC-VIC-778899", issue_date=date(2024,1,15), expiry_date=date(2029,1,15), verified=True, verified_by="Emma Davis"),
        ComplianceDocument(student_id="cc5e0f34-a3d4-6a78-1e90-f01234567003", document_type="working_with_children_check", document_number="WWC-NSW-445566", issue_date=date(2024,2,28), expiry_date=date(2029,2,28), verified=True, verified_by="James Wong"),
        ComplianceDocument(student_id="dd6f1045-a4e5-7b89-2f01-012345678004", document_type="working_with_children_check", document_number="WWC-VIC-998877", issue_date=date(2025,1,10), expiry_date=date(2030,1,10), verified=True, verified_by="Emma Davis"),
    ]
    db.add_all(docs)

    appointments = [
        Appointment(id="637c742f-d6c6-4df0-adc7-cd007ed34955", student_id="24abb829-fb8d-46ab-9e43-b55244b5773c", coordinator_id="7f854ead-5e55-4919-b7ac-6a1542d5b46b", title="Check-in Meeting - Liam Taylor", appointment_type="cert_iii_1st_visit", location_type="online", meeting_link="https://zoom.us/j/123456789", scheduled_date=date(2024,9,10), scheduled_time="15:00", duration_minutes=45, preparation_notes="Review progress and address any concerns", status="scheduled", created_by="86e12151-deac-4815-802a-25d73f82a2b9"),
        Appointment(student_id="69147dbb-2f96-446c-bd9f-cdeab63ab3ac", coordinator_id="7f854ead-5e55-4919-b7ac-6a1542d5b46b", title="Supervisor Observation - Noah Johnson", appointment_type="cert_iii_1st_visit", location_type="onsite", location_address="123 Pitt Street, Sydney NSW 2000", scheduled_date=date(2024,8,22), scheduled_time="10:00", duration_minutes=60, preparation_notes="Observe student interaction", status="completed", completed=True, feedback="Student demonstrated excellent communication skills.", created_by="7f854ead-5e55-4919-b7ac-6a1542d5b46b"),
        Appointment(student_id="bb4d9e23-a2c3-5f67-0d89-ef0123456002", coordinator_id="86e12151-deac-4815-802a-25d73f82a2b9", title="Mid-Point Review - Emma Williams", appointment_type="diploma_2nd_visit", location_type="online", meeting_link="https://teams.microsoft.com/meet/abc123", scheduled_date=date(2024,10,5), scheduled_time="14:00", duration_minutes=60, preparation_notes="Review portfolio and hours", status="scheduled", created_by="86e12151-deac-4815-802a-25d73f82a2b9"),
    ]
    db.add_all(appointments)

    hours_logs = [
        HoursLog(student_id="24abb829-fb8d-46ab-9e43-b55244b5773c", log_date=date(2024,7,1), hours=8, activity_description="Room 2 - Toddler group activities", approved=True, approved_by="James Wong"),
        HoursLog(student_id="24abb829-fb8d-46ab-9e43-b55244b5773c", log_date=date(2024,7,2), hours=8, activity_description="Outdoor play and programming", approved=True, approved_by="James Wong"),
        HoursLog(student_id="69147dbb-2f96-446c-bd9f-cdeab63ab3ac", log_date=date(2024,8,1), hours=7.5, activity_description="Preschool room observations", approved=True, approved_by="James Wong"),
        HoursLog(student_id="bb4d9e23-a2c3-5f67-0d89-ef0123456002", log_date=date(2024,6,10), hours=8, activity_description="Documentation and planning", approved=True, approved_by="Emma Davis"),
        HoursLog(student_id="cc5e0f34-a3d4-6a78-1e90-f01234567003", log_date=date(2024,7,15), hours=8, activity_description="Baby room routines", approved=False),
    ]
    db.add_all(hours_logs)
    db.commit()


def seed_email_templates():
    """Seed default email templates into the database (Issue 6)."""
    db = SessionLocal()
    try:
        from app.models import EmailTemplate
        if db.query(EmailTemplate).count() > 0:
            return   # Already seeded

        templates = [
            EmailTemplate(name="placement_confirmation", label="Placement Confirmation",
                subject_template="Placement Confirmation – {student_name}",
                body_template="Dear {student_name},\n\nYour work placement has been confirmed. Please review the details in the student portal and ensure all compliance documents are up to date before your placement commences.\n\nRegards,\nAcademies Australasia"),
            EmailTemplate(name="compliance_reminder", label="Compliance Documents Reminder",
                subject_template="Action Required: Compliance Documents – {student_name}",
                body_template="Dear {student_name},\n\nPlease ensure all your compliance documents are current:\n• Working with Children Check\n• National Police Check\n• Valid First Aid Certificate (including CPR)\n• Work Placement Agreement\n• Memorandum of Understanding (MOU)\n\nRegards,\nAcademies Australasia"),
            EmailTemplate(name="hours_reminder", label="Hours Log Reminder",
                subject_template="Reminder: Log Your Placement Hours – {student_name}",
                body_template="Dear {student_name},\n\nThis is a reminder to log your placement hours regularly in the student portal. Regular updates help your coordinator track your progress.\n\nRegards,\nAcademies Australasia"),
            EmailTemplate(name="supervisor_feedback", label="Supervisor Feedback Request",
                subject_template="Feedback Required for {student_name}",
                body_template="Dear Supervisor,\n\nWe would appreciate your feedback on {student_name}'s performance during their work placement. Please contact your student's coordinator at your earliest convenience.\n\nRegards,\nAcademies Australasia"),
            EmailTemplate(name="visit_notification", label="Assessor Visit Notification",
                subject_template="Upcoming Assessor Visit – {student_name}",
                body_template="Dear {student_name},\n\nYour Trainer and Assessor will be visiting your placement centre soon. Please ensure you are prepared and that your supervisor is available.\n\nRegards,\nAcademies Australasia"),
        ]
        db.add_all(templates)
        db.commit()
        logger.info("Email templates seeded.")
    except Exception as e:
        logger.error(f"Email template seed error: {e}")
        db.rollback()
    finally:
        db.close()


# Call template seeding from the main seed_database function
_orig_seed_database = seed_database


def seed_database():
    _orig_seed_database()
    seed_email_templates()
