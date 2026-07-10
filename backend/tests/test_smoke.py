"""
Notepay Backend – Smoke Tests
Runs against a real SQLite test DB (no Postgres, no Firebase, no Redis).
Tests cover: health, user creation guard, event lifecycle, donations.
"""

import os
import sys
import pytest

# ── Point at test SQLite DB before any app imports ──
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_notepay.db")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("FIREBASE_CREDENTIALS_PATH", "")
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", "")

# Add backend dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
import main  # noqa: must import after env vars are set

# ── In-memory SQLite for tests ──
TEST_DB_URL = "sqlite:///./test_notepay.db"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    """Create all tables once for the test session, drop them after."""
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)
    # Clean up test DB file
    import database
    database.engine.dispose()
    test_engine.dispose()
    if os.path.exists("./test_notepay.db"):
        os.remove("./test_notepay.db")


@pytest.fixture(scope="session")
def client(setup_db):
    main.app.dependency_overrides[get_db] = override_get_db
    with TestClient(main.app, raise_server_exceptions=False) as c:
        yield c
    main.app.dependency_overrides.clear()


@pytest.fixture
def auth_client(setup_db):
    from main import get_current_user_id, get_optional_current_user_id
    main.app.dependency_overrides[get_db] = override_get_db
    main.app.dependency_overrides[get_current_user_id] = lambda: 1
    main.app.dependency_overrides[get_optional_current_user_id] = lambda: 1
    with TestClient(main.app, raise_server_exceptions=False) as c:
        yield c
    main.app.dependency_overrides.clear()


# ══════════════════════════════════════════
# 1. Health Check
# ══════════════════════════════════════════

def test_health(client):
    """Health endpoint must return 200 and status ok."""
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body.get("status") == "ok"


def test_root(client):
    """Root endpoint should respond."""
    res = client.get("/")
    assert res.status_code == 200


# ══════════════════════════════════════════
# 2. Auth Guard — Unauthenticated Requests
# ══════════════════════════════════════════

def test_get_my_events_requires_auth(client):
    """Fetching events without a token must be rejected."""
    res = client.get("/events/my")
    assert res.status_code in (401, 403), f"Expected 401/403, got {res.status_code}"


def test_create_event_requires_auth(client):
    """Creating an event without auth must be rejected."""
    res = client.post("/events", json={"name": "Test", "description": "Test", "event_date": "2025-01-01"})
    assert res.status_code in (401, 403), f"Expected 401/403, got {res.status_code}"


def test_get_profile_requires_auth(client):
    """Getting profile without auth must be rejected."""
    res = client.get("/users/me")
    assert res.status_code in (401, 403), f"Expected 401/403, got {res.status_code}"


# ══════════════════════════════════════════
# 3. Public Endpoints — Accessible Without Auth
# ══════════════════════════════════════════

def test_public_event_nonexistent(client):
    """Public portal for non-existent event must return 404."""
    res = client.get("/api/public/event/nonexistentid123456789012")
    assert res.status_code == 404


def test_public_upload_receipt_nonexistent(client):
    """Public receipt upload for non-existent event must return 404 or 422."""
    import io
    fake_file = io.BytesIO(b"fake image data")
    res = client.post(
        "/api/public/event/nonexistentid123456789012/upload_receipt",
        files={"file": ("receipt.png", fake_file, "image/png")}
    )
    # 404 = event not found, 422 = validation, both acceptable
    assert res.status_code in (404, 422, 400)


# ══════════════════════════════════════════
# 4. Rate Limiting — OTP / Login
# ══════════════════════════════════════════

def test_invalid_token_rejected(client):
    """A clearly fake Bearer token must be rejected."""
    res = client.get("/users/me", headers={"Authorization": "Bearer fake.token.here"})
    assert res.status_code in (401, 403)


# ══════════════════════════════════════════
# 5. Input Validation
# ══════════════════════════════════════════

def test_join_event_missing_code(auth_client):
    """Joining an event without invite code must fail with 422."""
    res = auth_client.post("/events/join")
    assert res.status_code == 422  # FastAPI validation error


def test_feedback_requires_auth(client):
    """Submitting feedback without auth or guest details must be rejected."""
    res = client.post("/feedback", json={"type": "bug", "message": "test bug"})
    assert res.status_code in (401, 403)


def test_feedback_guest_submission(client):
    """Guest submitting feedback with name/email must succeed."""
    res = client.post("/feedback", json={
        "type": "general",
        "message": "hello guest feedback",
        "name": "John Doe",
        "email": "john@example.com"
    })
    assert res.status_code == 200
    assert res.json() == {"message": "Feedback submitted successfully"}


def test_feedback_auth_submission(auth_client):
    """Authenticated user submitting feedback must succeed."""
    res = auth_client.post("/feedback", json={
        "type": "bug",
        "message": "hello auth feedback"
    })
    assert res.status_code == 200
    assert res.json() == {"message": "Feedback submitted successfully"}


# ══════════════════════════════════════════
# Preview Tests
# ══════════════════════════════════════════

def test_preview_code_success(auth_client):
    import models
    db = TestingSessionLocal()
    
    # Create a test organizer user
    user = models.User(id=2, firebase_uid="uid2", phone_number="0987654321", full_name="Alice Organizer")
    db.add(user)
    db.commit()

    # Create event
    event = models.Event(
        id="test-event-id-999",
        name="Birthday Bash",
        description="Birthday party",
        event_date=models.datetime.now(models.timezone.utc),
        invite_code="ABCDE-FGHI-JKLMN",
        is_active=True,
        organizer_id=2
    )
    db.add(event)
    db.commit()

    # Add organizer membership
    member = models.EventMember(
        user_id=2,
        event_id=event.id,
        role=models.UserRole.organizer
    )
    db.add(member)
    db.commit()
    db.close()

    # Query the preview endpoint
    res = auth_client.get("/events/preview-code?invite_code=ABCDE-FGHI-JKLMN")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert data["name"] == "Birthday Bash"
    assert data["organizer_name"] == "Alice Organizer"
    assert data["is_active"] is True


def test_preview_code_not_found(auth_client):
    res = auth_client.get("/events/preview-code?invite_code=INVALID-CODE-XYZ")
    assert res.status_code == 404


def test_sanitize_json_payload():
    import crud
    dirty = {
        "field1": "<script>alert('xss')</script>Hello",
        "nested": {
            "key": "Click <a href='javascript:alert(1)'>here</a>"
        },
        "list_items": ["Safe", "<img src=x onerror=alert(1)>"]
    }
    cleaned = crud.sanitize_json_payload(dirty)
    assert "<script>" not in cleaned["field1"]
    assert "Hello" in cleaned["field1"]
    assert "javascript:" not in cleaned["nested"]["key"]
    assert "<img" not in cleaned["list_items"][1]
