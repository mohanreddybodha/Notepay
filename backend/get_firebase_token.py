"""
NotePay -- Firebase Test Token Generator
=========================================
Gets a real Firebase ID token WITHOUT any frontend or mobile app.

HOW IT WORKS:
  1. Firebase Admin SDK creates a "custom token" for a test UID.
  2. We exchange that custom token for a real ID token via Firebase REST API.
  3. Copy the printed token and paste it into Swagger /docs as:
         Authorization: Bearer <token>

SETUP (one-time):
  1. Go to Firebase Console -> Project Settings -> Service Accounts
  2. Click "Generate new private key" -> download the JSON file
  3. Rename it to service_account.json and place it in the backend/ folder
  4. FIREBASE_WEB_API_KEY is already set in your .env

Run:
  python get_firebase_token.py

Optional -- specify a custom UID:
  python get_firebase_token.py --uid "your_firebase_uid_here"
"""

import os
import sys
import argparse
import requests
import firebase_admin
from firebase_admin import credentials, auth
from dotenv import load_dotenv

load_dotenv()

# -- Config -----------------------------------------------------------------------
FIREBASE_WEB_API_KEY = os.getenv("FIREBASE_WEB_API_KEY")
SERVICE_ACCOUNT_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")


def init_firebase():
    if firebase_admin._apps:
        return
    if SERVICE_ACCOUNT_PATH and os.path.exists(SERVICE_ACCOUNT_PATH):
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)
        print(f"[OK] Firebase initialized with service account: {SERVICE_ACCOUNT_PATH}")
    else:
        try:
            firebase_admin.initialize_app()
            print("[OK] Firebase initialized with Application Default Credentials")
        except Exception as e:
            print("[ERROR] Firebase initialization failed.")
            print("   Set GOOGLE_APPLICATION_CREDENTIALS in your .env to your service account JSON path.")
            print(f"   Error: {e}")
            sys.exit(1)


def get_id_token_for_uid(uid: str) -> str:
    """
    Creates a Firebase custom token for the given UID,
    then exchanges it for a real ID token via the Firebase REST API.
    """
    if not FIREBASE_WEB_API_KEY:
        print("\n[ERROR] FIREBASE_WEB_API_KEY not set in .env")
        print("   Find it in: Firebase Console -> Project Settings -> General -> Web API Key")
        sys.exit(1)

    # Step 1: Create a custom token (signed by our service account)
    print(f"\n[1/2] Creating custom token for UID: {uid}")
    custom_token = auth.create_custom_token(uid)
    custom_token_str = custom_token.decode("utf-8") if isinstance(custom_token, bytes) else custom_token
    print("      Custom token created OK")

    # Step 2: Exchange custom token -> ID token via Firebase REST API
    print("[2/2] Exchanging for ID token via Firebase REST API...")
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={FIREBASE_WEB_API_KEY}"
    response = requests.post(url, json={
        "token": custom_token_str,
        "returnSecureToken": True
    })

    if response.status_code != 200:
        print(f"[ERROR] Token exchange failed: {response.json()}")
        sys.exit(1)

    data = response.json()
    id_token = data["idToken"]
    expires_in = int(data.get("expiresIn", 3600))
    print(f"      ID token obtained OK  (expires in {expires_in // 60} minutes)\n")
    return id_token


def main():
    parser = argparse.ArgumentParser(description="Get a Firebase ID token for API testing")
    parser.add_argument("--uid", type=str, default="test-user-001",
                        help="Firebase UID to generate token for (default: test-user-001)")
    args = parser.parse_args()

    init_firebase()
    id_token = get_id_token_for_uid(args.uid)

    print("=" * 70)
    print("YOUR FIREBASE ID TOKEN (valid ~1 hour)")
    print("=" * 70)
    print(id_token)
    print("=" * 70)
    print()
    print("HOW TO USE:")
    print()
    print("  Option A -- Swagger UI (http://localhost:8000/docs):")
    print('    Click "Authorize" (lock icon) at the top right')
    print("    Paste the token in the 'HTTPBearer' field -> Authorize")
    print()
    print("  Option B -- curl:")
    print('    curl -H "Authorization: Bearer <token>" http://localhost:8000/users/me')
    print()
    print("  FIRST TIME: Register your user ->")
    print('    POST /users  body: {"phone_number": "+91...", "full_name": "Name", "gender": "Male"}')
    print("  THEN call any endpoint normally.")
    print()


if __name__ == "__main__":
    main()
