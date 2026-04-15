#!/usr/bin/env python3
"""
Emergency admin password reset.
Run from inside the container:
  docker-compose exec backend python reset_admin.py
"""
import sys
import os
sys.path.insert(0, '/app')

from app.database import SessionLocal, engine, Base
from app.models import User
from app.utils.auth import get_password_hash

EMAIL = "b.dotel@academies.edu.au"
PASSWORD = "aca0022z"

Base.metadata.create_all(bind=engine)
db = SessionLocal()
try:
    user = db.query(User).filter(User.email == EMAIL).first()
    if user:
        user.hashed_password = get_password_hash(PASSWORD)
        user.is_active = True
        user.role = "admin"
        db.commit()
        print(f"✓ Password reset successfully")
        print(f"  Email:    {EMAIL}")
        print(f"  Password: {PASSWORD}")
    else:
        new_user = User(
            id="3f328aff-6951-4367-b403-47b496346dab",
            email=EMAIL, username="bib", full_name="Bib Dotel",
            hashed_password=get_password_hash(PASSWORD),
            role="admin", campus="sydney", is_active=True,
        )
        db.add(new_user)
        db.commit()
        print(f"✓ Admin user created")
        print(f"  Email:    {EMAIL}")
        print(f"  Password: {PASSWORD}")
except Exception as e:
    print(f"✗ Error: {e}")
    db.rollback()
    sys.exit(1)
finally:
    db.close()
