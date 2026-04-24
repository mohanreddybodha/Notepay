import os
import asyncio
from fastapi import HTTPException, Security, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials, auth
from dotenv import load_dotenv

load_dotenv()
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "notepay-de2b0")

# Initialize Firebase app only if not already initialized
if not firebase_admin._apps:
    try:
        # 1. Try using local service account file if it exists
        base_dir = os.path.dirname(__file__)
        service_account_path = os.path.join(base_dir, "service_account.json")
        
        if os.path.exists(service_account_path):
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
        else:
            # 2. Fallback to Application Default Credentials (for Cloud environments)
            cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {'projectId': FIREBASE_PROJECT_ID})
    except Exception:
        # 3. Final fallback: initialize with just the project ID (restricted functionality)
        firebase_admin.initialize_app(options={'projectId': FIREBASE_PROJECT_ID})

security = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    id_token = credentials.credentials
    try:
        # Verify token using Firebase Admin
        return auth.verify_id_token(id_token)
    except Exception as e:
        error_msg = str(e)
        
        # Handle "Token used too early" (clock skew issue)
        if "Token used too early" in error_msg:
            # Wait 3 seconds and retry once
            await asyncio.sleep(3)
            try:
                return auth.verify_id_token(id_token)
            except Exception as e2:
                raise HTTPException(
                    status_code=401, 
                    detail=f"Token used too early (Clock Skew). Server time is behind. Please check your system clock. Error: {str(e2)}"
                )
                
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {error_msg}")
