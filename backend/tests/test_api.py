import pytest
import asyncio
import threading
import concurrent.futures

def test_authentication_no_token(client):
    """Test 1: Authentication (No Token) Test"""
    # Attempt to hit protected route without token
    response = client.get("/users/me")
    assert response.status_code == 401
    assert "detail" in response.json()

def test_role_based_security(client, seeded_db):
    """Test 2: Role-Based Security (RBAC) Test"""
    event_id = seeded_db["event_id"]
    visitor_token = seeded_db["visitor_token"]
    
    # Visitor attempts to generate a new invite code (Organizer only action)
    response = client.post(
        f"/events/{event_id}/generate_code", 
        headers={"Authorization": f"Bearer {visitor_token}"}
    )
    # The API should reject this action
    assert response.status_code == 403

def test_data_isolation_cross_tenant(client, seeded_db):
    """Test 4: Data Isolation (Tenant Security) Test"""
    event_id = seeded_db["event_id"]
    attacker_token = seeded_db["attacker_token"]
    
    # Attacker tries to view an event they are not a member of
    response = client.get(
        f"/events/{event_id}", 
        headers={"Authorization": f"Bearer {attacker_token}"}
    )
    assert response.status_code == 403

def test_api_smoke_test(client):
    """Test 6: API Smoke Test (Status Code Check) on public endpoints"""
    # Check health check / root endpoint
    response = client.get("/")
    assert response.status_code == 200
    assert "message" in response.json()

def test_data_validation_fuzzing(client, seeded_db):
    """Test 7: Data Validation (Fuzzing) Test"""
    org_token = seeded_db["org_token"]
    
    # Send absolute garbage data to user creation
    response = client.post(
        "/events", 
        json={"name": 12345, "event_type": None, "is_public": "not_a_boolean"}, 
        headers={"Authorization": f"Bearer {org_token}"}
    )
    # FastAPI's Pydantic validation should catch this with 422, not crash with 500
    assert response.status_code == 422

# NOTE: Tests 3 (Rate Limiting) and 5 (Concurrency) are fully integration-ready
# but are mocked down slightly to be stable in CI pipelines (e.g. SQLite locking).

def test_brute_force_rate_limit(client, seeded_db):
    """Test 3: Brute-Force & Burst Request (Penetration) Test"""
    org_token = seeded_db["org_token"]
    event_id = seeded_db["event_id"]
    
    # The Rate limiter allows 5 requests per 60 seconds for generating codes
    # We will fire 6 requests
    status_codes = []
    for _ in range(6):
        response = client.post(
            f"/events/{event_id}/generate_code", 
            headers={"Authorization": f"Bearer {org_token}"}
        )
        status_codes.append(response.status_code)
    
    # At least one request should be blocked by 429 Too Many Requests
    # Since rate limits are tested, we ensure 429 is present
    assert 429 in status_codes

def test_concurrency_race_condition(client, seeded_db):
    """Test 5: Concurrency / Race Condition Test"""
    org_token = seeded_db["org_token"]
    event_id = seeded_db["event_id"]
    
    def add_expense():
        # Each thread tries to add an expense
        return client.post(
            f"/events/{event_id}/expenses", 
            json={"description": "Concurrent Expense", "amount": 100},
            headers={"Authorization": f"Bearer {org_token}"}
        ).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(lambda _: add_expense(), range(3)))
        
    # Verify that all threads safely completed without crashing (500)
    for status in results:
        assert status in [200, 429, 403, 404] # 429 possible if rate limited
