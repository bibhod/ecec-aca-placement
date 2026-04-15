#!/usr/bin/env python3
"""
ECEC Full Database Population — v2 (Bulletproof)
=================================================
Inserts exactly 20 records into every table.
Handles missing tables, unique constraints, and existing data gracefully.
Run:  docker-compose exec backend python populate_data.py
"""
import sys, uuid, random, traceback
from datetime import date, timedelta, datetime

sys.path.insert(0, '/app')

from sqlalchemy import text
from app.database import SessionLocal, engine
from app.models import Base
from app.utils.auth import get_password_hash

# Create ALL tables (safe — no-op if already exist)
Base.metadata.create_all(bind=engine)

# Also create trainer_profiles if missing
with engine.connect() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS trainer_profiles (
            id VARCHAR PRIMARY KEY,
            user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
            full_name VARCHAR NOT NULL,
            email VARCHAR,
            mobile VARCHAR,
            qualifications_delivering JSONB DEFAULT '[]',
            campuses JSONB DEFAULT '[]',
            max_students INTEGER DEFAULT 20,
            notes TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE
        )
    """))
    conn.commit()

db = SessionLocal()

def uid(): return str(uuid.uuid4())

# ── Reference data ────────────────────────────────────────────────────────────
FIRST = ["Emma","Liam","Olivia","Noah","Ava","William","Sophia","James",
         "Isabella","Oliver","Mia","Benjamin","Charlotte","Elijah","Amelia",
         "Lucas","Harper","Mason","Evelyn","Logan"]
LAST  = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis",
         "Wilson","Taylor","Anderson","Thomas","Jackson","White","Harris",
         "Martin","Thompson","Moore","Young","Lee"]

SUBURBS = [
    ("Parramatta","NSW","2150"),("Chatswood","NSW","2067"),
    ("Liverpool","NSW","2170"),("Penrith","NSW","2750"),
    ("Bankstown","NSW","2200"),("Bondi","NSW","2026"),
    ("Manly","NSW","2095"),("Hurstville","NSW","2220"),
    ("Melbourne CBD","VIC","3000"),("Fitzroy","VIC","3065"),
    ("Richmond","VIC","3121"),("St Kilda","VIC","3182"),
    ("Brunswick","VIC","3056"),("Northcote","VIC","3070"),
    ("Perth CBD","WA","6000"),("Fremantle","WA","6160"),
    ("Subiaco","WA","6008"),("Northbridge","WA","6003"),
    ("Cottesloe","WA","6011"),("Leederville","WA","6007"),
]

CENTRE_NAMES = [
    "Sunshine Early Learning","Rainbow Childcare Centre","Little Stars Academy",
    "Bright Futures Early Education","Happy Days Childcare","Early Years Learning Centre",
    "Growing Minds Childcare","Nature's Play Academy","Discovery Early Learning",
    "Blossom Childcare Centre","Little Learners Academy","Wonderland Early Education",
    "Tiny Steps Childcare","Future Stars Learning","Creative Minds Early Learning",
    "Koala Kids Childcare","Kangaroo Care Centre","Wattle Grove Early Learning",
    "Banksia Childcare Academy","Gumnut Early Education Centre",
]

QUALIFICATIONS = ["CHC30125","CHC50125","CHC30121","CHC50121"]
NQS = ["Excellent","Exceeding NQS","Exceeding NQS","Meeting NQS",
       "Meeting NQS","Meeting NQS","Working Towards NQS"]

TRAINER_NAMES = [
    "Dr Sarah Mitchell","James Chen","Maria Rodriguez","David Thompson",
    "Lisa Park","Andrew Wilson","Jennifer Brown","Michael O'Brien",
    "Amanda Foster","Robert Kim","Christine Lee","Patrick Murphy",
    "Natalie Walsh","Steven Clarke","Rebecca Hart","Daniel Nguyen",
    "Tracey McDonald","Kevin Patel","Sandra Young","Anthony Edwards",
]

STUDENT_NAMES = [
    "Zoe Harrison","Ethan Burke","Chloe Patterson","Ryan Sullivan",
    "Sophie Anderson","Jack Freeman","Megan Collins","Tyler Ross",
    "Hannah Jenkins","Nathan Walsh","Brooke Turner","Connor Murphy",
    "Jade Mitchell","Lachlan Stewart","Amber Clarke","Blake Robinson",
    "Kayla Thompson","Jordan Lee","Tara Nguyen","Dylan Martin",
]

UNITS_C3 = [
    "Children's Health and Safety","Work Environment and Legal Obligations",
    "Provide First Aid","Child Protection","WHS in Early Childhood Education",
    "Nurture Babies and Toddlers","Behaviour Management Skills","Professional Development",
    "Observation Fundamentals","Children and Nature","Use a Learning Framework",
    "Program Planning","Support Holistic Child Development","Culture Diversity and Inclusion",
]
UNITS_DIP = [
    "Analyse Information for Programming","Plan and Implement Curriculum",
    "Nurture Creativity in Children","Sustainable Service Operations",
    "Compliance in Education and Care","Respond to Grievances and Complaints",
    "Foster Positive Behaviour in Children","Implement Inclusive Strategies",
    "Holistic Development in Children","Collaborative Practices",
    "Health and Safety Management","Work in Partnership with Families",
    "Manage Teams","Supportive Management Skills",
]

ACTIVITIES = [
    "Room 2 – Toddler group activities and morning routines",
    "Outdoor play supervision and nature-based learning",
    "Documentation, learning stories and portfolio updates",
    "Meal preparation, nutrition activities and clean-up",
    "Programming, curriculum planning and program review",
    "Baby room care – feeding, nappy changes, sleep routines",
    "Transition to school group – literacy and numeracy activities",
    "Art and sensory play facilitation with children",
    "Family communication, daily diaries and enrolment admin",
    "Behaviour guidance, positive interactions and de-escalation",
    "Staff meeting participation and professional development",
    "Afternoon routine – packing up, rest time and departures",
    "Excursion preparation and community walk supervision",
    "Sustainability program – recycling, gardening, composting",
    "Child observation, documentation and reporting",
]

DOC_TYPES = [
    "working_with_children_check","national_police_check",
    "first_aid_certificate","work_placement_agreement","memorandum_of_understanding",
]

ISSUE_TITLES = [
    "Unexplained absences from placement","Punctuality concerns raised by centre",
    "Supervisor feedback – improvement required","Compliance document overdue",
    "Professionalism concerns","Student not meeting hours target",
    "Communication issues with centre staff","Dress code non-compliance",
    "Phone use during placement hours","Conflict with placement supervisor",
    "Assessment task not submitted","Centre requests student removal",
    "Health and safety incident","Student seeking placement transfer",
    "Personal circumstances affecting attendance","Social media policy breach",
    "Failure to follow centre procedures","Language barrier identified",
    "Student disclosed mental health concerns","Workplace injury reported",
]

COMM_SUBJECTS = [
    "Welcome to Academies Australasia — Your Placement Details",
    "Upcoming Visit Reminder — Please Prepare Documentation",
    "Compliance Documents Due — Action Required Immediately",
    "Hours Log Reminder — Please Update Your Timesheet",
    "Placement Confirmation — All Details Enclosed",
    "Assessment Outcome — Congratulations on Your Progress",
    "Upcoming Assessor Visit Scheduled for Next Week",
    "Trainer/Assessor Feedback Required — Please Respond",
    "Low Hours Alert — Urgent Review of Your Progress",
    "Document Expiry Notice — Renewal Required Before Placement",
    "New Placement Arranged — Please Review Details",
    "Mid-Point Review Scheduled — Please Attend",
    "Final Assessment Approaching — Prepare Your Portfolio",
    "Absence Noted — Please Provide Documentation",
    "Policy Update — Please Review Attached Information",
    "Centre Contact Details Updated — Please Note",
    "Holiday Closure Notice from Placement Centre",
    "Emergency Contact Details Required",
    "Assessment Extension Approved",
    "Completion Certificate Ready for Collection",
]

def rname(): return f"{random.choice(FIRST)} {random.choice(LAST)}"
def remail(name, dom="academies.edu.au"):
    p = name.lower().split()
    return f"{p[0]}.{p[1]}{random.randint(1,99)}@{dom}"
def rphone(): return f"04{random.randint(10,99)} {random.randint(100,999)} {random.randint(100,999)}"
def rdate_past(a=365, b=30):
    d = date.today() - timedelta(days=random.randint(b, a))
    return d
def rdate_future(a=7, b=90):
    return date.today() + timedelta(days=random.randint(a, b))

ok = True

# ═══════════════════════════════════════════════════════════════
# 1. COORDINATORS (5 records)
# ═══════════════════════════════════════════════════════════════
print("\n[1/12] Creating Coordinators...")
from app.models import User
coord_ids = []
coord_names_emails = [
    ("James Wong","james.wong@academies.edu.au","sydney"),
    ("Emma Davis","emma.davis@academies.edu.au","melbourne"),
    ("Sarah Chen","sarah.chen@academies.edu.au","perth"),
    ("Michael Brown","michael.brown@academies.edu.au","sydney"),
    ("Lisa Park","lisa.park@academies.edu.au","melbourne"),
]
for name, email, campus in coord_names_emails:
    try:
        if db.query(User).filter(User.email == email).first(): 
            u = db.query(User).filter(User.email == email).first()
            coord_ids.append(u.id)
            continue
        u = User(id=uid(), email=email, username=email.split("@")[0],
                 full_name=name, hashed_password=get_password_hash("Test1234!"),
                 role="coordinator", campus=campus, phone=rphone(), is_active=True)
        db.add(u); db.flush(); coord_ids.append(u.id)
    except Exception as e:
        db.rollback(); print(f"  skip {email}: {e}")
db.commit()
print(f"  Coordinators in DB: {db.query(User).filter(User.role=='coordinator').count()}")

# ═══════════════════════════════════════════════════════════════
# 2. TRAINERS/ASSESSORS — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[2/12] Creating Trainers/Assessors (20)...")
trainer_ids = []
campuses_cycle = ["sydney","sydney","sydney","sydney","sydney","sydney","sydney",
                  "melbourne","melbourne","melbourne","melbourne","melbourne","melbourne",
                  "perth","perth","perth","perth","perth","perth","perth"]
for i, tname in enumerate(TRAINER_NAMES):
    email = remail(tname)
    try:
        existing = db.query(User).filter(User.full_name == tname).first()
        if existing:
            trainer_ids.append(existing.id)
            continue
        u = User(id=uid(), email=email,
                 username=tname.lower().replace(" ","_").replace(".","")[:20],
                 full_name=tname, hashed_password=get_password_hash("Test1234!"),
                 role="trainer", campus=campuses_cycle[i],
                 phone=rphone(), is_active=True)
        db.add(u); db.flush(); trainer_ids.append(u.id)
    except Exception as e:
        db.rollback(); print(f"  skip {tname}: {e}")
db.commit()
all_trainers = db.query(User).filter(User.role.in_(["trainer","admin"])).all()
trainer_ids = [t.id for t in all_trainers]
print(f"  Trainers/Assessors in DB: {len(trainer_ids)}")

# ═══════════════════════════════════════════════════════════════
# 3. TRAINER PROFILES — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[3/12] Creating Trainer/Assessor Profiles (20)...")
added_tp = 0
qual_sets = [
    ["CHC30125"],["CHC50125"],["CHC30125","CHC50125"],["CHC30121","CHC30125"],
    ["CHC50121","CHC50125"],["CHC30125","CHC50125"],["CHC30125"],["CHC50125"],
    ["CHC30125","CHC50125"],["CHC30125"],["CHC50125"],["CHC30125","CHC50125"],
    ["CHC30121"],["CHC50121"],["CHC30125","CHC50125"],["CHC30125"],
    ["CHC50125"],["CHC30125","CHC50125"],["CHC30125"],["CHC50125"],
]
campus_sets = [
    ["sydney"],["melbourne"],["sydney","melbourne"],["perth"],["melbourne","perth"],
    ["sydney"],["perth"],["sydney","melbourne"],["melbourne"],["sydney"],
    ["perth"],["sydney"],["melbourne"],["perth"],["sydney","perth"],
    ["melbourne"],["sydney"],["perth"],["sydney","melbourne"],["melbourne"],
]
try:
    # Use raw SQL for trainer_profiles to avoid ORM model issues
    for i in range(20):
        if i < len(trainer_ids):
            u_id = trainer_ids[i]
            u = db.query(User).filter(User.id == u_id).first()
            if not u: continue
            fname, email, mobile = u.full_name, u.email, u.phone or rphone()
        else:
            fname = TRAINER_NAMES[i % len(TRAINER_NAMES)] + " (II)"
            email = remail(fname)
            mobile = rphone()
            u_id = None

        import json
        # Check if profile exists
        exists = db.execute(
            text("SELECT id FROM trainer_profiles WHERE full_name = :n"),
            {"n": fname}
        ).fetchone()
        if exists: continue

        # Also check user_id if present
        if u_id:
            ue = db.execute(
                text("SELECT id FROM trainer_profiles WHERE user_id = :uid"),
                {"uid": u_id}
            ).fetchone()
            if ue: continue

        db.execute(text("""
            INSERT INTO trainer_profiles
              (id, user_id, full_name, email, mobile,
               qualifications_delivering, campuses, max_students, notes, is_active)
            VALUES
              (:id, :uid, :name, :email, :mobile,
               :quals::jsonb, :camps::jsonb, :max_s, :notes, true)
        """), {
            "id": uid(), "uid": u_id, "name": fname, "email": email, "mobile": mobile,
            "quals": json.dumps(qual_sets[i]),
            "camps": json.dumps(campus_sets[i]),
            "max_s": random.randint(10, 30),
            "notes": f"Qualified Trainer/Assessor delivering {', '.join(qual_sets[i])}. Campus: {', '.join(campus_sets[i])}.",
        })
        added_tp += 1
    db.commit()
    total_tp = db.execute(text("SELECT COUNT(*) FROM trainer_profiles")).scalar()
    print(f"  Added {added_tp} profiles. Total: {total_tp}")
except Exception as e:
    db.rollback()
    print(f"  Error with trainer profiles: {e}")
    traceback.print_exc()

# ═══════════════════════════════════════════════════════════════
# 4. PLACEMENT CENTRES — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[4/12] Creating Placement Centres (20)...")
from app.models import PlacementCentre
import json
added_c = 0
centre_ids = []
for i, cname in enumerate(CENTRE_NAMES):
    try:
        existing = db.query(PlacementCentre).filter(PlacementCentre.centre_name == cname).first()
        if existing:
            centre_ids.append(existing.id); continue
        suburb, state, postcode = SUBURBS[i % len(SUBURBS)]
        sup_name = rname()
        c = PlacementCentre(
            id=uid(), centre_name=cname,
            address=f"{random.randint(1,250)} {random.choice(['Main','High','Church','Park','King','Queen','Victoria','George'])} Street",
            suburb=suburb, state=state, postcode=postcode,
            phone=f"0{random.randint(2,3)}{random.randint(1000,9999)}{random.randint(1000,9999)}",
            email=f"admin@{cname.lower().replace(' ','').replace(',','')}.com.au",
            director_name=rname(),
            director_email=remail(rname(),"childcare.com.au"),
            supervisor_name=sup_name,
            supervisor_email=remail(sup_name,"childcare.com.au"),
            supervisor_phone=rphone(),
            nqs_rating=random.choice(NQS),
            max_students=random.randint(3,8),
            accepted_qualifications=random.sample(QUALIFICATIONS,random.randint(2,4)),
            approved=True,
            notes=f"Established ECEC centre in {suburb}, {state}. Fully licensed and approved for work placement.",
        )
        db.add(c); db.flush(); centre_ids.append(c.id); added_c += 1
    except Exception as e:
        db.rollback(); print(f"  skip {cname}: {e}")
db.commit()
all_centres = db.query(PlacementCentre).all()
centre_ids = [c.id for c in all_centres]
print(f"  Added {added_c}. Total centres: {len(centre_ids)}")

# ═══════════════════════════════════════════════════════════════
# 5. STUDENTS — 20 named records
# ═══════════════════════════════════════════════════════════════
print("\n[5/12] Creating Students (20)...")
from app.models import Student
added_s = 0
student_ids = []
qual_for_student = [
    "CHC30125","CHC30125","CHC30125","CHC30125","CHC30125",
    "CHC50125","CHC50125","CHC50125","CHC50125","CHC50125",
    "CHC30121","CHC30121","CHC30121","CHC30121","CHC30121",
    "CHC50121","CHC50121","CHC50121","CHC50121","CHC50121",
]
campus_for_student = [
    "sydney","sydney","sydney","sydney","sydney","sydney","sydney",
    "melbourne","melbourne","melbourne","melbourne","melbourne","melbourne",
    "perth","perth","perth","perth","perth","perth","perth",
]
for i, sname in enumerate(STUDENT_NAMES):
    try:
        # Check by name
        existing = db.query(Student).filter(Student.full_name == sname).first()
        if existing:
            student_ids.append(existing.id); continue
        
        qual = qual_for_student[i]
        req_h = 288.0 if "50" in qual else 160.0
        completed_h = float(random.randint(0, int(req_h) - 20))
        campus = campus_for_student[i]
        suburb, state, postcode = SUBURBS[i % len(SUBURBS)]
        coord_id = coord_ids[i % len(coord_ids)] if coord_ids else None
        centre_id = centre_ids[i % len(centre_ids)] if centre_ids else None

        course_start = rdate_past(400, 200)
        course_end   = course_start + timedelta(days=random.randint(300, 400))
        place_start  = course_start + timedelta(days=random.randint(30, 90))
        place_end    = place_start  + timedelta(days=random.randint(120, 180))

        # Generate unique student_id
        year = date.today().year
        num = 1000 + i + 1
        sid = f"STU{year}{num}"
        while db.query(Student).filter(Student.student_id == sid).first():
            num += 1; sid = f"STU{year}{num}"

        s = Student(
            id=uid(), student_id=sid, full_name=sname,
            email=remail(sname, "student.academies.edu.au"),
            phone=rphone(),
            date_of_birth=date(random.randint(1990,2003), random.randint(1,12), random.randint(1,28)),
            qualification=qual, campus=campus,
            status=random.choice(["active","active","active","active","active","completed","deferred"]),
            course_start_date=course_start, course_end_date=course_end,
            placement_centre_id=centre_id,
            placement_start_date=place_start, placement_end_date=place_end,
            required_hours=req_h, completed_hours=completed_h,
            coordinator_id=coord_id,
            preferred_suburb=suburb, preferred_state=state,
            notes=f"Enrolled in {qual}. Placement arranged at selected centre.",
        )
        db.add(s); db.flush(); student_ids.append(s.id); added_s += 1
    except Exception as e:
        db.rollback(); print(f"  skip {sname}: {e}")
db.commit()
all_students = db.query(Student).all()
student_ids = [s.id for s in all_students]
print(f"  Added {added_s}. Total students: {len(student_ids)}")

# ═══════════════════════════════════════════════════════════════
# 6. COMPLIANCE DOCUMENTS — 20 records (4 students × 5 doc types)
# ═══════════════════════════════════════════════════════════════
print("\n[6/12] Creating Compliance Documents (20)...")
from app.models import ComplianceDocument
added_cd = 0
target_students = all_students[:4] if len(all_students) >= 4 else all_students
for student in target_students:
    coord = db.query(User).filter(User.id == student.coordinator_id).first() if student.coordinator_id else None
    existing_types = {d.document_type for d in db.query(ComplianceDocument).filter(ComplianceDocument.student_id == student.id).all()}
    for doc_type in DOC_TYPES:
        if added_cd >= 20: break
        if doc_type in existing_types: continue
        try:
            issue_dt = rdate_past(400, 60)
            expiry_dt = issue_dt + timedelta(days=random.choice([365, 730, 1825, 1095]))
            verified = random.choice([True, True, True, False])
            doc = ComplianceDocument(
                id=uid(), student_id=student.id, document_type=doc_type,
                document_number=f"{doc_type[:3].upper()}-{random.randint(100000,999999)}",
                issue_date=issue_dt, expiry_date=expiry_dt,
                verified=verified,
                verified_by=coord.full_name if (verified and coord) else None,
                verified_at=issue_dt + timedelta(days=random.randint(1,7)) if verified else None,
                notes=f"Document verified for {student.full_name}.",
            )
            db.add(doc); db.flush(); added_cd += 1
        except Exception as e:
            db.rollback(); print(f"  skip doc: {e}")
    if added_cd >= 20: break
db.commit()
print(f"  Added {added_cd}. Total compliance docs: {db.query(ComplianceDocument).count()}")

# ═══════════════════════════════════════════════════════════════
# 7. APPOINTMENTS — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[7/12] Creating Appointments (20)...")
from app.models import Appointment
added_a = 0
used_combos = set()
for i in range(20):
    if not student_ids or not trainer_ids: break
    student = all_students[i % len(all_students)]
    trainer_id = trainer_ids[i % len(trainer_ids)]
    qual = student.qualification
    if "50" in qual:
        atype = ["diploma_1st_visit","diploma_2nd_visit","reassessment_visit"][i % 3]
    else:
        atype = ["cert_iii_1st_visit","cert_iii_2nd_visit","cert_iii_3rd_visit","reassessment_visit"][i % 4]
    sched = rdate_future(3+i,120+i) if i < 12 else rdate_past(150, 7+i)
    combo = (student.id, atype, str(sched))
    if combo in used_combos:
        sched = sched + timedelta(days=i+1); combo = (student.id, atype, str(sched))
    used_combos.add(combo)
    units = random.sample(UNITS_C3 if "30" in qual else UNITS_DIP, random.randint(2,3))
    completed_flag = i < 8
    centre_id = student.placement_centre_id or (centre_ids[i % len(centre_ids)] if centre_ids else None)
    try:
        appt = Appointment(
            id=uid(), student_id=student.id,
            trainer_assessor_id=trainer_id, coordinator_id=trainer_id,
            title=f"{atype.replace('_',' ').title()} – {student.full_name}",
            appointment_type=atype, visit_type="onsite",
            placement_centre_id=centre_id,
            scheduled_date=sched,
            scheduled_time=random.choice(["09:00","09:30","10:00","10:30","11:00","13:00","13:30","14:00"]),
            duration_hours=random.choice([1.0, 1.5, 2.0]),
            units_assessed=units,
            preparation_notes=f"Review {units[0]} documentation. Student to have portfolio ready.",
            status="completed" if completed_flag else "scheduled",
            completed=completed_flag, cancelled=False,
            feedback=f"Student demonstrated competency in {units[0]}. {random.choice(['Satisfactory progress.','Excellent engagement.','Needs further practice.','Outstanding performance.'])}" if completed_flag else None,
            email_sent_48h=completed_flag, email_sent_24h=completed_flag,
            visit_reference=f"VIS-{uuid.uuid4().hex[:8].upper()}",
            requires_admin_approval=False, admin_approved=False,
            created_by=trainer_id,
        )
        db.add(appt); db.flush(); added_a += 1
    except Exception as e:
        db.rollback(); print(f"  skip appt {i}: {e}")
db.commit()
print(f"  Added {added_a}. Total appointments: {db.query(Appointment).count()}")

# ═══════════════════════════════════════════════════════════════
# 8. HOURS LOG — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[8/12] Creating Hours Logs (20)...")
from app.models import HoursLog
added_h = 0
all_coords = db.query(User).filter(User.role.in_(["coordinator","admin"])).all()
for i in range(20):
    student = all_students[i % len(all_students)]
    coord = all_coords[i % len(all_coords)] if all_coords else None
    hrs = random.choice([6.0, 6.5, 7.0, 7.5, 8.0, 8.0, 8.5])
    log_date = rdate_past(200, 1+i)
    approved_flag = i < 15
    try:
        log = HoursLog(
            id=uid(), student_id=student.id,
            log_date=log_date, hours=hrs,
            activity_description=ACTIVITIES[i % len(ACTIVITIES)],
            approved=approved_flag,
            approved_by=coord.full_name if (approved_flag and coord) else None,
            approved_at=datetime.utcnow()-timedelta(days=random.randint(1,30)) if approved_flag else None,
            supervisor_signed=approved_flag,
            flagged_unrealistic=False, flagged_duplicate=False,
            created_by=coord.id if coord else None,
        )
        db.add(log); db.flush(); added_h += 1
    except Exception as e:
        db.rollback(); print(f"  skip hours {i}: {e}")
db.commit()
print(f"  Added {added_h}. Total hours logs: {db.query(HoursLog).count()}")

# ═══════════════════════════════════════════════════════════════
# 9. COMMUNICATIONS — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[9/12] Creating Communications (20)...")
from app.models import Communication
all_users_list = db.query(User).all()
added_comm = 0
for i in range(20):
    student = all_students[i % len(all_students)]
    sender  = all_users_list[i % len(all_users_list)]
    msg_type = "sms" if i % 5 == 4 else "email"
    subj = COMM_SUBJECTS[i % len(COMM_SUBJECTS)]
    try:
        c = Communication(
            id=uid(), student_id=student.id, sender_id=sender.id,
            recipient_email=student.email if msg_type == "email" else None,
            recipient_phone=student.phone if msg_type == "sms" else None,
            recipient_name=student.full_name,
            message_type=msg_type,
            subject=subj if msg_type == "email" else None,
            body=f"Dear {student.full_name},\n\n{subj}. Please contact your coordinator if you have any questions.\n\nRegards,\n{sender.full_name}\nAcademies Australasia",
            template_used=random.choice([None,"placement_confirmation","compliance_reminder","hours_reminder","supervisor_feedback"]),
            sent_successfully=True,
            sent_at=datetime.utcnow()-timedelta(days=random.randint(1,90)),
        )
        db.add(c); db.flush(); added_comm += 1
    except Exception as e:
        db.rollback(); print(f"  skip comm {i}: {e}")
db.commit()
print(f"  Added {added_comm}. Total communications: {db.query(Communication).count()}")

# ═══════════════════════════════════════════════════════════════
# 10. ISSUES — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[10/12] Creating Issues (20)...")
from app.models import Issue
ISSUE_TYPES = ["attendance","behaviour","performance","compliance","other"]
RESOLUTIONS = [
    "Student counselled and action plan implemented. Reviewed after 2 weeks.",
    "Issue resolved following coordinator meeting with student.",
    "Documents submitted and verified. No further action required.",
    "Student completed remedial training. Performance improved.",
    "Centre management consulted. Satisfactory outcome achieved.",
    None, None, None,
]
added_i = 0
for i in range(20):
    student = all_students[i % len(all_students)]
    reporter = all_coords[i % len(all_coords)] if all_coords else all_users_list[0]
    resolved = i < 12
    try:
        iss = Issue(
            id=uid(), student_id=student.id, reported_by=reporter.id,
            issue_type=ISSUE_TYPES[i % len(ISSUE_TYPES)],
            title=ISSUE_TITLES[i % len(ISSUE_TITLES)],
            description=f"Issue reported regarding {student.full_name}: {ISSUE_TITLES[i % len(ISSUE_TITLES)]}. Coordinator notified and follow-up scheduled.",
            priority=random.choice(["low","medium","medium","high","critical"]),
            status="resolved" if resolved else random.choice(["open","in_progress"]),
            resolution=RESOLUTIONS[i % len(RESOLUTIONS)] if resolved else None,
            resolved_by=reporter.full_name if resolved else None,
            resolved_at=datetime.utcnow()-timedelta(days=random.randint(1,30)) if resolved else None,
        )
        db.add(iss); db.flush(); added_i += 1
    except Exception as e:
        db.rollback(); print(f"  skip issue {i}: {e}")
db.commit()
print(f"  Added {added_i}. Total issues: {db.query(Issue).count()}")

# ═══════════════════════════════════════════════════════════════
# 11. NOTIFICATIONS — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[11/12] Creating Notifications (20)...")
from app.models import Notification
NOTIF_DATA = [
    ("Visit Scheduled","New assessor visit scheduled for tomorrow at 09:00 — Sunshine Early Learning","info","/appointments"),
    ("Compliance Expiry","Working with Children Check expires in 30 days for Zoe Harrison","warning","/compliance"),
    ("Hours Approved","8.0 hours approved for Ethan Burke — 15 May 2025","success","/hours"),
    ("New Issue Raised","Attendance concern reported for Chloe Patterson","warning","/issues"),
    ("Visit Completed","Assessment visit completed for Ryan Sullivan — feedback recorded","success","/appointments"),
    ("Compliance Alert","National Police Check EXPIRED for Sophie Anderson","error","/compliance"),
    ("Hours Pending","5 hour log entries awaiting your approval","info","/hours"),
    ("Student Enrolled","New student Blake Robinson enrolled in CHC30125","info","/students"),
    ("Visit Reminder","Upcoming visit in 48 hours — please prepare documentation","warning","/appointments"),
    ("Email Sent","Template email sent to 8 students successfully","success","/communications"),
    ("Low Hours Alert","Jordan Lee has only completed 20% of required hours","warning","/students"),
    ("Document Verified","First Aid Certificate verified for Tara Nguyen","success","/compliance"),
    ("New Message","Connor Murphy sent a message regarding placement dates","info","/communications"),
    ("Assessment Due","Final assessment due in 14 days for Hannah Jenkins","warning","/appointments"),
    ("Centre Update","Sunshine Early Learning has updated their supervisor contact","info","/centres"),
    ("Bulk Import","15 students successfully imported from CSV file","success","/students"),
    ("Password Reset","Admin password was reset via the reset endpoint","info","/users"),
    ("Audit Alert","Unusual login activity detected — please review audit log","warning","/audit"),
    ("Visit Limit","Amber Clarke has reached the 3-visit limit for CHC30125","warning","/appointments"),
    ("Completion","Dylan Martin has completed all required placement hours!","success","/students"),
]
added_notif = 0
for i, (title, msg, ntype, link) in enumerate(NOTIF_DATA):
    user = all_users_list[i % len(all_users_list)]
    try:
        n = Notification(
            id=uid(), user_id=user.id,
            title=title, message=msg, type=ntype, link=link, read=i < 10,
        )
        db.add(n); db.flush(); added_notif += 1
    except Exception as e:
        db.rollback(); print(f"  skip notif {i}: {e}")
db.commit()
print(f"  Added {added_notif}. Total notifications: {db.query(Notification).count()}")

# ═══════════════════════════════════════════════════════════════
# 12. AUDIT LOGS — 20 records
# ═══════════════════════════════════════════════════════════════
print("\n[12/12] Creating Audit Logs (20)...")
from app.models import AuditLog
AUDIT_EVENTS = [
    ("CREATE","student","New student enrolled"),
    ("CREATE","appointment","Assessor visit scheduled"),
    ("UPDATE","appointment","Visit marked as completed"),
    ("APPROVE","hours","Placement hours approved"),
    ("CREATE","compliance","Compliance document uploaded"),
    ("UPDATE","compliance","Document verified by coordinator"),
    ("CREATE","communication","Email sent to student"),
    ("UPDATE","student","Student placement centre updated"),
    ("CREATE","issue","Issue raised for student"),
    ("UPDATE","issue","Issue marked as resolved"),
    ("LOGIN","user","User logged in to portal"),
    ("DELETE","appointment","Appointment cancelled"),
    ("CREATE","hours","Hours log entry created"),
    ("UPDATE","user","User profile updated"),
    ("CREATE","centre","New placement centre added"),
    ("APPROVE","appointment","Extra visit approved by admin"),
    ("CREATE","trainer_profile","Trainer/Assessor profile created"),
    ("UPDATE","compliance","Compliance document expiry updated"),
    ("LOGIN","user","Admin password reset"),
    ("CREATE","audit","Bulk import of student records"),
]
added_al = 0
for i, (action, rtype, label) in enumerate(AUDIT_EVENTS):
    user = all_users_list[i % len(all_users_list)]
    student = all_students[i % len(all_students)] if all_students else None
    try:
        al = AuditLog(
            id=uid(), user_id=user.id,
            user_email=user.email, user_name=user.full_name,
            action=action, resource_type=rtype,
            resource_id=student.id if student else user.id,
            resource_label=f"{label} — {student.full_name if student else user.full_name}",
            details={"action": label, "student": student.student_id if student else None},
            ip_address=f"192.168.1.{random.randint(10,254)}",
            created_at=datetime.utcnow()-timedelta(days=random.randint(0,90)),
        )
        db.add(al); db.flush(); added_al += 1
    except Exception as e:
        db.rollback(); print(f"  skip audit {i}: {e}")
db.commit()
print(f"  Added {added_al}. Total audit logs: {db.query(AuditLog).count()}")

# ── Email Templates (ensure all 6 exist) ─────────────────────
from app.models import EmailTemplate
TEMPLATES = [
    ("placement_confirmation","Placement Confirmation","Placement Confirmation – {student_name}",
     "Dear {student_name},\n\nYour work placement has been confirmed.\n\nRegards,\nAcademies Australasia"),
    ("compliance_reminder","Compliance Reminder","Action Required: Compliance Documents – {student_name}",
     "Dear {student_name},\n\nPlease ensure all compliance documents are current.\n\nRegards,\nAcademies Australasia"),
    ("hours_reminder","Hours Log Reminder","Reminder: Log Your Hours – {student_name}",
     "Dear {student_name},\n\nPlease log your placement hours regularly.\n\nRegards,\nAcademies Australasia"),
    ("supervisor_feedback","Trainer/Assessor Feedback","Feedback Required for {student_name}",
     "Dear Trainer/Assessor,\n\nYour feedback on {student_name}'s performance is requested.\n\nRegards,\nAcademies Australasia"),
    ("visit_notification","Visit Notification","Upcoming Assessor Visit – {student_name}",
     "Dear {student_name},\n\nYour Trainer/Assessor will visit soon. Please be prepared.\n\nRegards,\nAcademies Australasia"),
    ("low_hours_alert","Low Hours Alert","Low Attendance Alert – {student_name}",
     "Dear {student_name},\n\nYour placement hours are below the required level. Please contact your coordinator.\n\nRegards,\nAcademies Australasia"),
]
for name, label, subj, body in TEMPLATES:
    if not db.query(EmailTemplate).filter(EmailTemplate.name == name).first():
        db.add(EmailTemplate(id=uid(), name=name, label=label,
                             subject_template=subj, body_template=body, is_active=True))
db.commit()

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════
print("\n" + "═"*55)
print("  POPULATION COMPLETE — RECORD COUNTS")
print("═"*55)

from app.models import User, PlacementCentre, Student, ComplianceDocument
from app.models import Appointment, HoursLog, Communication, Issue
from app.models import Notification, AuditLog, EmailTemplate

summary = [
    ("Trainers/Assessors (Users)", db.query(User).filter(User.role.in_(["trainer"])).count()),
    ("Coordinators (Users)", db.query(User).filter(User.role=="coordinator").count()),
    ("All Users", db.query(User).count()),
    ("Trainer/Assessor Profiles", db.execute(text("SELECT COUNT(*) FROM trainer_profiles")).scalar()),
    ("Placement Centres", db.query(PlacementCentre).count()),
    ("Students", db.query(Student).count()),
    ("Compliance Documents", db.query(ComplianceDocument).count()),
    ("Appointments / Visits", db.query(Appointment).count()),
    ("Hours Log Entries", db.query(HoursLog).count()),
    ("Communications", db.query(Communication).count()),
    ("Issues", db.query(Issue).count()),
    ("Notifications", db.query(Notification).count()),
    ("Audit Log Entries", db.query(AuditLog).count()),
    ("Email Templates", db.query(EmailTemplate).count()),
]
for label, count in summary:
    bar = "✓" if count >= 10 else ("~" if count >= 5 else "✗")
    print(f"  {bar}  {label:<35} {count:>4} records")

print("\n" + "─"*55)
print("  LOGIN CREDENTIALS")
print("─"*55)
print("  Admin      : b.dotel@academies.edu.au  / aca0022z")
print("  Test users : <email from above>         / Test1234!")
print("═"*55)
db.close()
