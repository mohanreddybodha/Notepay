import os
import asyncio
import time
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
    # 1. Try using local service account file if it exists (Local Development)
    base_dir = os.path.dirname(__file__)
    service_account_path = os.path.join(base_dir, "service_account.json")
    
    if os.path.exists(service_account_path):
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
    else:
        # 2. Production AWS Lambda fallback: No credentials needed for verifying tokens!
        # Just provide the Project ID. Do NOT use ApplicationDefault() as it crashes in AWS.
        firebase_admin.initialize_app(options={'projectId': FIREBASE_PROJECT_ID})

security = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    id_token = credentials.credentials
    
    # PHASE 4: Auth Caching (Place 4)
    # Use a hash of the token as the cache key for security/length
    token_hash = hashlib.sha1(id_token.encode()).hexdigest()
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
        
        # Handle "Token used too early" (clock skew between backend and Firebase servers)
        # Firebase issues tokens with an iat (issued-at) slightly in the future relative
        # to the backend's clock. We wait up to 5 seconds for clocks to align and retry.
        if "Token used too early" in error_msg:
            print(f" Clock skew detected: {error_msg}. Retrying after delay...")
            for attempt in range(3):
                await asyncio.sleep(2)  # Wait 2 seconds for clocks to align
                try:
                    decoded = auth.verify_id_token(id_token, check_revoked=False)
                    cache.cache.set(cache_key, decoded, expire=600)
                    print(f" Clock skew resolved on attempt {attempt + 1}")
                    return decoded
                except Exception as retry_e:
                    if "Token used too early" not in str(retry_e):
                        # A different error  stop retrying
                        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {retry_e}")
            # All retries exhausted  clock skew is too large
            raise HTTPException(
                status_code=401,
                detail="Authentication failed: server clock is out of sync. Please try again in a few seconds."
            )
                
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {error_msg}")
