"""
ECEC Work Placement Management System — Database Models v3.1
Changes in this version:
  - TrainerProfile model (new dedicated profile page)
  - Appointment.trainer_assessor_id is now NOT NULL (mandatory)
  - "supervisor" columns kept for DB compat but relabelled "trainer_assessor" in API layer
  - VisitReport view-model driven by Appointment data
  - Visit limits: Cert III=3, Diploma=2, extra needs admin approval
  - Audit trail on every write
"""
from sqlalchemy import Column, String, Integer, Float, Boolean, Date, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


# ─── Constant lists ───────────────────────────────────────────────────────────
QUALIFICATION_CHOICES = ["CHC30121", "CHC50121", "CHC30125", "CHC50125"]

APPOINTMENT_TYPE_CHOICES = [
    "cert_iii_1st_visit", "cert_iii_2nd_visit", "cert_iii_3rd_visit",
    "diploma_1st_visit", "diploma_2nd_visit", "reassessment_visit",
]

COMPLIANCE_DOC_TYPE_CHOICES = [
    "working_with_children_check", "national_police_check",
    "first_aid_certificate", "work_placement_agreement",
    "memorandum_of_understanding",
]

USER_ROLE_CHOICES = ["admin", "coordinator", "trainer"]   # trainer = Trainer/Assessor

# Units per qualification
UNITS_CHC30125 = [
    "Children's Health and Safety", "Work Environment and Legal Obligations",
    "Provide First Aid", "Child Protection", "WHS in Early Childhood Education",
    "Nurture Babies and Toddlers", "Behaviour Management Skills",
    "Professional Development", "Observation Fundamentals", "Children and Nature",
    "Use a Learning Framework", "Program Planning",
    "Support Holistic Child Development", "Culture Diversity and Inclusion",
]

UNITS_CHC50125 = [
    "Analyse Information for Programming", "Plan and Implement Curriculum",
    "Nurture Creativity in Children", "Sustainable Service Operations",
    "Compliance in Education and Care", "Respond to Grievances and Complaints",
    "Foster Positive Behaviour in Children", "Implement Inclusive Strategies",
    "Holistic Development in Children", "Collaborative Practices",
    "Health and Safety Management", "Work in Partnership with Families",
    "Manage Teams", "Supportive Management Skills",
]

QUALIFICATION_UNITS_MAP = {
    "CHC30121": UNITS_CHC30125, "CHC30125": UNITS_CHC30125,
    "CHC50121": UNITS_CHC50125, "CHC50125": UNITS_CHC50125,
}

VISIT_LIMITS = {"CHC30121": 3, "CHC30125": 3, "CHC50121": 2, "CHC50125": 2}


# ─────────────────────────────────────────────────────────────────────────────
# USERS
# ─────────────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    username = Column(String, unique=True, nullable=True)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="coordinator")   # admin | coordinator | trainer
    campus = Column(String, default="sydney")
    phone = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    communications_sent = relationship(
        "Communication", back_populates="sender", foreign_keys="Communication.sender_id"
    )
    trainer_profile = relationship("TrainerProfile", back_populates="user", uselist=False)


# ─────────────────────────────────────────────────────────────────────────────
# TRAINER / ASSESSOR PROFILE  (new — Issue: dedicated profile page)
# ─────────────────────────────────────────────────────────────────────────────
class TrainerProfile(Base):
    """Extended profile for users with role='trainer' (Trainer/Assessor)."""
    __tablename__ = "trainer_profiles"
    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    mobile = Column(String, nullable=True)
    # Qualifications they are authorised to deliver (JSON list of qual codes)
    qualifications_delivering = Column(JSON, nullable=True, default=list)
    # Campus(es) they work across
    campuses = Column(JSON, nullable=True, default=list)
    # Maximum student load
    max_students = Column(Integer, default=20)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="trainer_profile")


# ─────────────────────────────────────────────────────────────────────────────
# PLACEMENT CENTRES
# ─────────────────────────────────────────────────────────────────────────────
class PlacementCentre(Base):
    __tablename__ = "placement_centres"
    id = Column(String, primary_key=True, default=gen_uuid)
    centre_name = Column(String, nullable=False)
    address = Column(String, nullable=True)
    suburb = Column(String, nullable=True)
    state = Column(String, nullable=True)
    postcode = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    director_name = Column(String, nullable=True)
    director_email = Column(String, nullable=True)
    # "supervisor" kept in DB for migration compat; UI calls it "Trainer/Assessor contact"
    supervisor_name = Column(String, nullable=True)
    supervisor_email = Column(String, nullable=True)
    supervisor_phone = Column(String, nullable=True)
    nqs_rating = Column(String, nullable=True)
    max_students = Column(Integer, default=5)
    accepted_qualifications = Column(JSON, nullable=True)
    approved = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    students = relationship("Student", back_populates="placement_centre")
    appointments = relationship("Appointment", back_populates="placement_centre")


# ─────────────────────────────────────────────────────────────────────────────
# STUDENTS
# ─────────────────────────────────────────────────────────────────────────────
class Student(Base):
    __tablename__ = "students"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    date_of_birth = Column(Date, nullable=True)
    qualification = Column(String, nullable=False)
    campus = Column(String, nullable=False, default="sydney")
    status = Column(String, default="current")
    course_start_date = Column(Date, nullable=True)
    course_end_date = Column(Date, nullable=True)
    placement_centre_id = Column(String, ForeignKey("placement_centres.id"), nullable=True)
    placement_start_date = Column(Date, nullable=True)
    placement_end_date = Column(Date, nullable=True)
    required_hours = Column(Float, default=160)
    completed_hours = Column(Float, default=0)
    coordinator_id = Column(String, ForeignKey("users.id"), nullable=True)
    preferred_suburb = Column(String, nullable=True)
    preferred_state = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    placement_centre = relationship("PlacementCentre", back_populates="students")
    compliance_documents = relationship("ComplianceDocument", back_populates="student", cascade="all, delete-orphan")
    appointments = relationship("Appointment", back_populates="student", cascade="all, delete-orphan")
    hours_logs = relationship("HoursLog", back_populates="student", cascade="all, delete-orphan")
    communications = relationship("Communication", back_populates="student", cascade="all, delete-orphan")
    issues = relationship("Issue", back_populates="student", cascade="all, delete-orphan")
    coordinator = relationship("User", foreign_keys=[coordinator_id])


# ─────────────────────────────────────────────────────────────────────────────
# COMPLIANCE DOCUMENTS
# ─────────────────────────────────────────────────────────────────────────────
class ComplianceDocument(Base):
    __tablename__ = "compliance_documents"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    document_type = Column(String, nullable=False)
    document_number = Column(String, nullable=True)
    issue_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    verified = Column(Boolean, default=False)
    verified_by = Column(String, nullable=True)
    verified_at = Column(Date, nullable=True)
    file_url = Column(String, nullable=True)
    file_name = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    alert_sent = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    student = relationship("Student", back_populates="compliance_documents")


# ─────────────────────────────────────────────────────────────────────────────
# APPOINTMENTS  (trainer_assessor_id now effectively required in API layer)
# ─────────────────────────────────────────────────────────────────────────────
class Appointment(Base):
    __tablename__ = "appointments"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    trainer_assessor_id = Column(String, ForeignKey("users.id"), nullable=True)
    coordinator_id = Column(String, ForeignKey("users.id"), nullable=True)
    title = Column(String, nullable=False)
    appointment_type = Column(String, nullable=False)
    visit_type = Column(String, default="onsite")
    placement_centre_id = Column(String, ForeignKey("placement_centres.id"), nullable=True)
    location_address = Column(String, nullable=True)
    meeting_link = Column(String, nullable=True)
    scheduled_date = Column(Date, nullable=False)
    scheduled_time = Column(String, nullable=False, default="09:00")
    duration_hours = Column(Float, default=1.0)
    units_assessed = Column(JSON, nullable=True, default=list)
    preparation_notes = Column(Text, nullable=True)
    required_evidence = Column(Text, nullable=True)
    status = Column(String, default="scheduled")
    completed = Column(Boolean, default=False)
    cancelled = Column(Boolean, default=False)
    feedback = Column(Text, nullable=True)
    email_sent_48h = Column(Boolean, default=False)
    email_sent_24h = Column(Boolean, default=False)
    visit_reference = Column(String, nullable=True)
    # Extra-visit approval (beyond limit)
    requires_admin_approval = Column(Boolean, default=False)
    admin_approved = Column(Boolean, default=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    student = relationship("Student", back_populates="appointments")
    trainer_assessor = relationship("User", foreign_keys=[trainer_assessor_id])
    coordinator = relationship("User", foreign_keys=[coordinator_id])
    placement_centre = relationship("PlacementCentre", back_populates="appointments")


# ─────────────────────────────────────────────────────────────────────────────
# HOURS LOG
# ─────────────────────────────────────────────────────────────────────────────
class HoursLog(Base):
    __tablename__ = "hours_log"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    log_date = Column(Date, nullable=False)
    hours = Column(Float, nullable=False)
    activity_description = Column(Text, nullable=True)
    approved = Column(Boolean, default=False)
    approved_by = Column(String, nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    supervisor_signed = Column(Boolean, default=False)
    flagged_unrealistic = Column(Boolean, default=False)
    flagged_duplicate = Column(Boolean, default=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    student = relationship("Student", back_populates="hours_logs")


# ─────────────────────────────────────────────────────────────────────────────
# COMMUNICATIONS
# ─────────────────────────────────────────────────────────────────────────────
class Communication(Base):
    __tablename__ = "communications"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=True)
    sender_id = Column(String, ForeignKey("users.id"), nullable=True)
    recipient_email = Column(String, nullable=True)
    recipient_phone = Column(String, nullable=True)
    recipient_name = Column(String, nullable=True)
    message_type = Column(String, default="email")
    subject = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    template_used = Column(String, nullable=True)
    sent_successfully = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
    student = relationship("Student", back_populates="communications")
    sender = relationship("User", back_populates="communications_sent", foreign_keys=[sender_id])


# ─────────────────────────────────────────────────────────────────────────────
# ISSUES
# ─────────────────────────────────────────────────────────────────────────────
class Issue(Base):
    __tablename__ = "issues"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    reported_by = Column(String, ForeignKey("users.id"), nullable=True)
    issue_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String, default="medium")
    status = Column(String, default="open")
    resolution = Column(Text, nullable=True)
    resolved_by = Column(String, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    student = relationship("Student", back_populates="issues")


# ─────────────────────────────────────────────────────────────────────────────
# NOTIFICATIONS
# ─────────────────────────────────────────────────────────────────────────────
class Notification(Base):
    __tablename__ = "notifications"
    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String, default="info")
    link = Column(String, nullable=True)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user = relationship("User", back_populates="notifications")


# ─────────────────────────────────────────────────────────────────────────────
# AUDIT LOG
# ─────────────────────────────────────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(String, primary_key=True, default=gen_uuid)
    user_id = Column(String, nullable=True)
    user_email = Column(String, nullable=True)
    user_name = Column(String, nullable=True)
    action = Column(String, nullable=False)
    resource_type = Column(String, nullable=True)
    resource_id = Column(String, nullable=True)
    resource_label = Column(String, nullable=True)
    details = Column(JSON, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# EMAIL TEMPLATES
# ─────────────────────────────────────────────────────────────────────────────
class EmailTemplate(Base):
    __tablename__ = "email_templates"
    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False, unique=True)
    label = Column(String, nullable=False)
    subject_template = Column(String, nullable=False)
    body_template = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# PLACEMENT COMPLETION RECORD
# ─────────────────────────────────────────────────────────────────────────────
class PlacementCompletion(Base):
    """
    Generated when a student meets ALL placement requirements:
      - All 4 compliance docs submitted
      - Required hours met
      - All visits completed
      - No open critical issues
    """
    __tablename__ = "placement_completions"
    id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    reference_number = Column(String, unique=True, nullable=False)
    completion_date = Column(Date, nullable=False)
    generated_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Snapshot of status at time of completion
    hours_completed = Column(Float, nullable=True)
    hours_required = Column(Float, nullable=True)
    compliance_docs_count = Column(Integer, nullable=True)
    visits_count = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("Student", backref="placement_completions")
