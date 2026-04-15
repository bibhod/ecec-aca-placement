"""
Database migration script — run once after upgrading from v2 to v3.
Adds new columns and tables for all 21 issue fixes.

Usage:
  cd backend
  python migrate.py

The script is idempotent — safe to run multiple times.
"""
import psycopg2
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://ecec:ecec_secret@localhost:5432/ecec_placement",
)


def run_migration():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    migrations = [
        # ── Appointments — new columns (Issue 1, 10, 21) ────────────────────
        ("appointments", "trainer_assessor_id", "ADD COLUMN trainer_assessor_id VARCHAR"),
        ("appointments", "visit_type", "ADD COLUMN visit_type VARCHAR DEFAULT 'onsite'"),
        ("appointments", "placement_centre_id", "ADD COLUMN placement_centre_id VARCHAR REFERENCES placement_centres(id)"),
        ("appointments", "duration_hours", "ADD COLUMN duration_hours FLOAT DEFAULT 1.0"),
        ("appointments", "units_assessed", "ADD COLUMN units_assessed JSONB DEFAULT '[]'"),
        ("appointments", "visit_reference", "ADD COLUMN visit_reference VARCHAR"),

        # ── PlacementCentre — new columns (Issue 20) ─────────────────────────
        ("placement_centres", "latitude", "ADD COLUMN latitude FLOAT"),
        ("placement_centres", "longitude", "ADD COLUMN longitude FLOAT"),
        ("placement_centres", "max_students", "ADD COLUMN max_students INTEGER DEFAULT 5"),
        ("placement_centres", "accepted_qualifications", "ADD COLUMN accepted_qualifications JSONB"),

        # ── ComplianceDocument — new columns (Issue 8) ────────────────────────
        ("compliance_documents", "file_name", "ADD COLUMN file_name VARCHAR"),

        # ── Student — new columns (Issue 20) ─────────────────────────────────
        ("students", "preferred_suburb", "ADD COLUMN preferred_suburb VARCHAR"),
        ("students", "preferred_state", "ADD COLUMN preferred_state VARCHAR"),

        # ── HoursLog — new columns (Issue 19) ────────────────────────────────
        ("hours_log", "flagged_unrealistic", "ADD COLUMN flagged_unrealistic BOOLEAN DEFAULT FALSE"),
        ("hours_log", "flagged_duplicate", "ADD COLUMN flagged_duplicate BOOLEAN DEFAULT FALSE"),

        # ── Communication — new column (Issue 2) ──────────────────────────────
        ("communications", "recipient_phone", "ADD COLUMN recipient_phone VARCHAR"),

        # ── AuditLog — new columns (Issue 14) ────────────────────────────────
        ("audit_logs", "user_name", "ADD COLUMN user_name VARCHAR"),
        ("audit_logs", "resource_label", "ADD COLUMN resource_label VARCHAR"),
    ]

    for table, column, stmt in migrations:
        try:
            cur.execute(f"""
                SELECT 1 FROM information_schema.columns
                WHERE table_name = %s AND column_name = %s
            """, (table, column))
            if cur.fetchone():
                logger.info(f"  SKIP  {table}.{column} — already exists")
            else:
                cur.execute(f"ALTER TABLE {table} {stmt}")
                logger.info(f"  ADD   {table}.{column}")
        except Exception as e:
            logger.warning(f"  WARN  {table}.{column}: {e}")

    # ── New tables ────────────────────────────────────────────────────────────
    new_tables = [
        # AssessorVisit (Issue 21)
        """
        CREATE TABLE IF NOT EXISTS assessor_visits (
            id VARCHAR PRIMARY KEY,
            visit_reference VARCHAR NOT NULL UNIQUE,
            student_id VARCHAR NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            assessor_id VARCHAR REFERENCES users(id),
            placement_centre_id VARCHAR REFERENCES placement_centres(id),
            visit_date DATE NOT NULL,
            start_time VARCHAR,
            end_time VARCHAR,
            visit_purpose VARCHAR,
            units_linked JSONB DEFAULT '[]',
            evidence_files JSONB DEFAULT '[]',
            observation_notes TEXT,
            supervisor_feedback TEXT,
            claim_submitted BOOLEAN DEFAULT FALSE,
            claim_submitted_at TIMESTAMP WITH TIME ZONE,
            claim_approved BOOLEAN DEFAULT FALSE,
            claim_approved_by VARCHAR,
            claim_approved_at TIMESTAMP WITH TIME ZONE,
            admin_approval_required BOOLEAN DEFAULT FALSE,
            admin_approved BOOLEAN DEFAULT FALSE,
            status VARCHAR DEFAULT 'pending',
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE
        )
        """,
        # EmailTemplate (Issue 6)
        """
        CREATE TABLE IF NOT EXISTS email_templates (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL UNIQUE,
            label VARCHAR NOT NULL,
            subject_template VARCHAR NOT NULL,
            body_template TEXT NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE
        )
        """,
    ]

    for ddl in new_tables:
        try:
            cur.execute(ddl)
            logger.info(f"  TABLE created/verified")
        except Exception as e:
            logger.warning(f"  TABLE error: {e}")

    cur.close()
    conn.close()
    logger.info("Migration complete.")


if __name__ == "__main__":
    run_migration()

# v3.1 additions
_v31_migrations = [
    ("appointments", "requires_admin_approval", "ADD COLUMN requires_admin_approval BOOLEAN DEFAULT FALSE"),
    ("appointments", "admin_approved", "ADD COLUMN admin_approved BOOLEAN DEFAULT FALSE"),
]

def run_v31():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()
    for table, column, stmt in _v31_migrations:
        cur.execute("SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s", (table, column))
        if cur.fetchone():
            logger.info(f"SKIP {table}.{column}")
        else:
            cur.execute(f"ALTER TABLE {table} {stmt}")
            logger.info(f"ADD {table}.{column}")
    # Create trainer_profiles table
    cur.execute("""
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
    """)
    logger.info("trainer_profiles table OK")
    cur.close(); conn.close()
    logger.info("v3.1 migration complete")

if __name__ == "__main__":
    run_migration()
    run_v31()
