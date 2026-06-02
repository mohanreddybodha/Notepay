import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database import Base, get_db
from main import app
import auth
import crud
import schemas

# 1. Setup In-Memory SQLite Database for tests
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session")
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db_session(setup_database):
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

@pytest.fixture
def mock_firebase_auth(monkeypatch):
    async def mock_verify_token(credentials):
        token = credentials.credentials
        if token == "fake_organizer_token":
            return {"uid": "org_uid", "phone_number": "+1111111111"}
        elif token == "fake_visitor_token":
            return {"uid": "visitor_uid", "phone_number": "+2222222222"}
        elif token == "fake_attacker_token":
            return {"uid": "attacker_uid", "phone_number": "+3333333333"}
        raise Exception("Invalid token")
    monkeypatch.setattr(auth, "verify_token", mock_verify_token)

@pytest.fixture(autouse=True)
def mock_rate_limit(request, monkeypatch):
    if "test_brute_force_rate_limit" in request.node.name:
        import cache
        cache.cache._local_cache.clear()
        return

    def fake_rate_limit(*args, **kwargs):
        pass
    import main
    monkeypatch.setattr(main, "verify_rate_limit", fake_rate_limit)
    
@pytest.fixture
def seeded_db(client, db_session, mock_firebase_auth):
    # Seed users
    org_res = client.post("/users", json={"phone_number": "+1111111111", "full_name": "Organizer User", "gender": "Male"}, headers={"Authorization": "Bearer fake_organizer_token"})
    assert org_res.status_code in [200, 201], f"User creation failed: {org_res.json()}"
    
    visitor_res = client.post("/users", json={"phone_number": "+2222222222", "full_name": "Visitor User", "gender": "Female"}, headers={"Authorization": "Bearer fake_visitor_token"})
    attacker_res = client.post("/users", json={"phone_number": "+3333333333", "full_name": "Attacker User", "gender": "Male"}, headers={"Authorization": "Bearer fake_attacker_token"})
    
    # Seed event
    event_res = client.post("/events", json={"name": "Org Private Event", "event_type": "Trip", "is_public": False, "description": "A private test event", "event_date": "2026-06-01"}, headers={"Authorization": "Bearer fake_organizer_token"})
    assert event_res.status_code in [200, 201], f"Event creation failed: {event_res.json()}"
    event_id = event_res.json()["id"]
    
    return {"org_token": "fake_organizer_token", "visitor_token": "fake_visitor_token", "attacker_token": "fake_attacker_token", "event_id": event_id}
