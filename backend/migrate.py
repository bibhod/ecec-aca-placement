"""
Database migration script - run once after upgrading from v2 to v3.
Adds new columns and tables for all 21 issue fixes.

Usage:
  cd backend
  python migrate.py

The script is idempotent - safe to run multiple times.
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
        # ── Appointments - new columns (Issue 1, 10, 21) ────────────────────
        ("appointments", "trainer_assessor_id", "ADD COLUMN trainer_assessor_id VARCHAR"),
        ("appointments", "visit_type", "ADD COLUMN visit_type VARCHAR DEFAULT 'onsite'"),
        ("appointments", "placement_centre_id", "ADD COLUMN placement_centre_id VARCHAR REFERENCES placement_centres(id)"),
        ("appointments", "duration_hours", "ADD COLUMN duration_hours FLOAT DEFAULT 1.0"),
        ("appointments", "units_assessed", "ADD COLUMN units_assessed JSONB DEFAULT '[]'"),
        ("appointments", "visit_reference", "ADD COLUMN visit_reference VARCHAR"),

        # ── PlacementCentre - new columns (Issue 20) ─────────────────────────
        ("placement_centres", "latitude", "ADD COLUMN latitude FLOAT"),
        ("placement_centres", "longitude", "ADD COLUMN longitude FLOAT"),
        ("placement_centres", "max_students", "ADD COLUMN max_students INTEGER DEFAULT 5"),
        ("placement_centres", "accepted_qualifications", "ADD COLUMN accepted_qualifications JSONB"),
        ("placement_centres", "children_age_groups", "ADD COLUMN children_age_groups JSONB DEFAULT '[]'"),

        # ── ComplianceDocument - new columns (Issue 8) ────────────────────────
        ("compliance_documents", "file_name", "ADD COLUMN file_name VARCHAR"),

        # ── Student - new columns (Issue 20) ─────────────────────────────────
        ("students", "preferred_suburb", "ADD COLUMN preferred_suburb VARCHAR"),
        ("students", "preferred_state", "ADD COLUMN preferred_state VARCHAR"),

        # ── HoursLog - new columns (Issue 19) ────────────────────────────────
        ("hours_log", "flagged_unrealistic", "ADD COLUMN flagged_unrealistic BOOLEAN DEFAULT FALSE"),
        ("hours_log", "flagged_duplicate", "ADD COLUMN flagged_duplicate BOOLEAN DEFAULT FALSE"),

        # ── Communication - new column (Issue 2) ──────────────────────────────
        ("communications", "recipient_phone", "ADD COLUMN recipient_phone VARCHAR"),

        # ── AuditLog - new columns (Issue 14) ────────────────────────────────
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
                logger.info(f"  SKIP  {table}.{column} - already exists")
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

# v3.2 - allow a student to be re-enrolled under a new qualification
# (e.g. Cert III graduate progressing into the Diploma). Previously
# student_id was globally unique, which blocked this. Uniqueness is now
# per (student_id, qualification).
def run_v32():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # Find and drop whatever the existing single-column unique constraint
    # on students.student_id is called (Postgres auto-names it, commonly
    # students_student_id_key).
    cur.execute("""
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'students'
          AND tc.constraint_type = 'UNIQUE'
          AND kcu.column_name = 'student_id'
          AND tc.constraint_name NOT IN (
              SELECT constraint_name FROM information_schema.table_constraints
              WHERE table_name = 'students' AND constraint_type = 'UNIQUE'
              GROUP BY constraint_name HAVING COUNT(*) > 1
          )
    """)
    row = cur.fetchone()
    if row:
        constraint_name = row[0]
        cur.execute(f'ALTER TABLE students DROP CONSTRAINT "{constraint_name}"')
        logger.info(f"  DROP  students.{constraint_name} (old single-column unique on student_id)")
    else:
        logger.info("  SKIP  no single-column unique constraint found on students.student_id")

    # Add the new composite unique constraint if it doesn't already exist.
    cur.execute("""
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'students' AND constraint_name = 'uq_student_id_qualification'
    """)
    if cur.fetchone():
        logger.info("  SKIP  uq_student_id_qualification already exists")
    else:
        cur.execute("""
            ALTER TABLE students
            ADD CONSTRAINT uq_student_id_qualification UNIQUE (student_id, qualification)
        """)
        logger.info("  ADD   uq_student_id_qualification (student_id, qualification)")

    cur.close(); conn.close()
    logger.info("v3.2 migration complete")


# v3.3 - v3.2 only searched information_schema.table_constraints for a named
# UNIQUE CONSTRAINT on students.student_id and correctly added
# uq_student_id_qualification. But the live database's actual blocker turned
# out to be a plain UNIQUE INDEX (ix_students_student_id) left over from an
# earlier schema version. A unique index created without a backing named
# constraint does not show up in table_constraints at all, so v3.2 never
# found or dropped it. It was still silently enforcing single-column
# uniqueness on student_id, which is why re-enrolling a Cert III graduate
# under the Diploma (same student_id, new qualification) failed with a 500 /
# IntegrityError on "ix_students_student_id" even after v3.2 ran successfully.
def run_v33():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # Find any unique index on students covering ONLY the student_id column.
    cur.execute("""
        SELECT ix.relname AS index_name
        FROM pg_index i
        JOIN pg_class ix ON ix.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE t.relname = 'students'
          AND i.indisunique = true
          AND i.indnkeyatts = 1
          AND (
            SELECT a.attname FROM pg_attribute a
            WHERE a.attrelid = t.oid AND a.attnum = i.indkey[0]
          ) = 'student_id'
    """)
    rows = cur.fetchall()
    if not rows:
        logger.info("  SKIP  no stale single-column unique index found on students.student_id")
    for (index_name,) in rows:
        # Defensive: don't touch it if it happens to be the backing index of
        # a named table constraint (shouldn't happen given indnkeyatts=1, but
        # a composite constraint's index would have indnkeyatts=2).
        cur.execute("""
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_name = 'students' AND constraint_name = %s
        """, (index_name,))
        if cur.fetchone():
            logger.info(f"  SKIP  {index_name} backs a named constraint, leaving alone")
            continue
        cur.execute(f'DROP INDEX IF EXISTS "{index_name}"')
        logger.info(f"  DROP  stale unique index students.{index_name} (single-column unique on student_id)")

    # Recreate a plain (non-unique) index on student_id for lookup
    # performance, matching the Student model's index=True declaration.
    cur.execute("""
        SELECT 1 FROM pg_indexes WHERE tablename = 'students' AND indexname = 'ix_students_student_id'
    """)
    if cur.fetchone():
        logger.info("  SKIP  ix_students_student_id already exists")
    else:
        cur.execute('CREATE INDEX ix_students_student_id ON students (student_id)')
        logger.info("  ADD   ix_students_student_id (non-unique, for lookup performance)")

    cur.close(); conn.close()
    logger.info("v3.3 migration complete")


if __name__ == "__main__":
    run_migration()
    run_v31()
    run_v32()
    run_v33()
