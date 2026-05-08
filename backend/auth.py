import os
import asyncio
from fastapi import HTTPException, Security, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials, auth
import hashlib
import cache # Import our centralized cache
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
    
    # PHASE 4: Auth Caching (Place 4)
    # Use a hash of the token as the cache key for security/length
    token_hash = hashlib.sha256(id_token.encode()).hexdigest()
    cache_key = f"auth:{token_hash}"
    
    cached_user = cache.cache.get(cache_key)
    if cached_user:
        return cached_user

    try:
        # Verify token using Firebase Admin
        decoded = auth.verify_id_token(id_token)
        # Cache the result for 10 minutes (600s)
        cache.cache.set(cache_key, decoded, expire=600)
        return decoded
    except Exception as e:
        error_msg = str(e)
        
        # Handle "Token used too early" (clock skew issue)
        if "Token used too early" in error_msg:
            # Instead of a long sleep, try one more time immediately (often works)
            # or just allow it if we're within a few seconds grace
            try:
                return auth.verify_id_token(id_token, check_revoked=False)
            except: pass
                
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {error_msg}")
