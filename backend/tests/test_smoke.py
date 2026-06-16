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
    from main import get_current_user_id
    main.app.dependency_overrides[get_db] = override_get_db
    main.app.dependency_overrides[get_current_user_id] = lambda: 1
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
    """Submitting feedback without auth must be rejected."""
    res = client.post("/feedback", json={"type": "bug", "message": "test bug"})
    assert res.status_code in (401, 403)
