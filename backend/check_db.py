"""
Run this to check what's in the database.
Usage: docker-compose exec backend python check_db.py
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import time

DATABASE_URL = "postgresql://ecec:ecec_secret@db:5432/ecec_placement"
engine = create_engine(DATABASE_URL)

print("Checking database contents...")

with engine.connect() as conn:
    # Check if users table exists
    tables = conn.execute(text(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
    )).fetchall()
    print(f"\nTables: {[t[0] for t in tables]}")

    if any(t[0] == 'users' for t in tables):
        users = conn.execute(text("SELECT id, email, role, is_active FROM users")).fetchall()
        print(f"\nUsers ({len(users)} found):")
        for u in users:
            print(f"  - {u[1]} | role={u[2]} | active={u[3]}")

        if len(users) == 0:
            print("\n⚠️  NO USERS IN DATABASE - seed did not run!")
    else:
        print("\n⚠️  NO TABLES - database is completely empty!")

print("\nDone.")
