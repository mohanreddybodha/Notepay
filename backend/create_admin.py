import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models import AdminUser
from admin_auth import get_password_hash

def create_admin():
    db = SessionLocal()
    email = input("Enter admin email: ")
    
    existing = db.query(AdminUser).filter(AdminUser.email == email).first()
    if existing:
        print(f"Admin {email} already exists!")
        return

    password = input("Enter admin password: ")
    
    admin = AdminUser(
        email=email,
        password_hash=get_password_hash(password),
        role="admin"
    )
    db.add(admin)
    db.commit()
    print(f"Admin {email} created successfully!")

if __name__ == "__main__":
    create_admin()
