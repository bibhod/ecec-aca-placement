"""
Run this script to fix the admin password directly in the database.
Usage: docker-compose exec backend python fix_password.py
"""
import sys
import time

print("=" * 50)
print("ECEC Portal - Password Fix Script")
print("=" * 50)

# Wait for DB
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "postgresql://ecec:ecec_secret@db:5432/ecec_placement"

print(f"\nConnecting to database...")
engine = create_engine(DATABASE_URL)

for i in range(10):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("Connected!")
        break
    except Exception as e:
        print(f"  Waiting... ({i+1}/10)")
        time.sleep(2)

Session = sessionmaker(bind=engine)
db = Session()

# Import models
try:
    from app.models import Base, User
    from app.utils.auth import get_password_hash

    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    print("Tables verified.")

    # Check if user exists
    user = db.query(User).filter(User.email == "b.dotel@academies.edu.au").first()

    if user:
        print(f"\nFound user: {user.email}")
        print(f"  Active: {user.is_active}")
        print(f"  Role: {user.role}")

        # Reset password
        user.hashed_password = get_password_hash("aca0022z")
        user.is_active = True
        db.commit()
        print("\n✅ Password reset to: aca0022z")

    else:
        print("\nUser not found - creating admin user...")
        new_user = User(
            id="3f328aff-6951-4367-b403-47b496346dab",
            email="b.dotel@academies.edu.au",
            username="bib",
            full_name="Bib Dotel",
            hashed_password=get_password_hash("aca0022z"),
            role="admin",
            campus="sydney",
            phone="0431577425",
            is_active=True
        )
        db.add(new_user)
        db.commit()
        print("✅ Admin user created with password: aca0022z")

    # Verify it works
    from app.utils.auth import verify_password
    check_user = db.query(User).filter(User.email == "b.dotel@academies.edu.au").first()
    works = verify_password("aca0022z", check_user.hashed_password)
    print(f"\nPassword verification test: {'✅ PASS' if works else '❌ FAIL'}")

    if works:
        print("\n" + "=" * 50)
        print("LOGIN SHOULD NOW WORK!")
        print("  URL:      http://localhost")
        print("  Email:    b.dotel@academies.edu.au")
        print("  Password: aca0022z")
        print("=" * 50)
    else:
        print("\n❌ Something is wrong with bcrypt - trying alternative...")
        # Use SHA256 as fallback test
        import hashlib
        h = hashlib.sha256("aca0022z".encode()).hexdigest()
        print(f"SHA256 hash: {h}")

except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
