---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Developer's Extension & Implementation Guide

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Engineering Constraints Handbook**: [docs/architecture-rules.md](architecture-rules.md)
*   **PR Contributions & Commits**: [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## ➕ 1. How to Add a New API Endpoint

To add a new endpoint, follow this sequence:

### Step A: Define the Data Schemas
Open [schemas.py](../backend/schemas.py) and define the request input and response output schemas using Pydantic:
```python
class ItemCreate(BaseModel):
    name: str
    quantity: int

class ItemResponse(BaseModel):
    id: int
    name: str
    quantity: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True) # Enables SQLAlchemy mapping
```

### Step B: Create the Database Operation (CRUD)
Open [crud.py](../backend/crud.py) and write the database operations:
```python
def create_item(db: Session, item: schemas.ItemCreate, user_id: int):
    db_item = models.Item(name=item.name, quantity=item.quantity, owner_id=user_id)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item
```

### Step C: Define the API Route
Open the appropriate router file in `backend/routers/` (e.g. `events.py` or `profile.py`) and write the route logic, injecting the necessary dependencies:
```python
@router.post("/items", response_model=schemas.ItemResponse)
def add_new_item(
    item: schemas.ItemCreate, 
    db: Session = Depends(get_db), 
    user_id: int = Depends(get_current_user_id)
):
    verify_rate_limit(f"user:{user_id}:add_item", limit=10, window=60)
    return crud.create_item(db=db, item=item, user_id=user_id)
```

### Step D: Add Smoke Tests
Open [test_smoke.py](../backend/tests/test_smoke.py) and add tests:
```python
def test_create_item_requires_auth(client):
    res = client.post("/items", json={"name": "Apples", "quantity": 5})
    assert res.status_code in (401, 403)
```

---

## ➕ 2. How to Add a New Page

### Step A: Create the HTML Template
Create a new HTML file in `/frontend` (e.g. `invite.html`) using the global styling variables:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="css/global.css">
  <script src="js/auth-guard.js"></script> <!-- Enforce authentication early -->
</head>
<body>
  <np-sidebar active-link="invite"></np-sidebar> <!-- Embed shared sidebar -->
  ...
</body>
</html>
```

### Step B: Register the Route in serve_frontend.py
Open [serve_frontend.py](../serve_frontend.py) and register the clean URL routing path:
```python
STATIC_ROUTES = {
    '/':                '/',
    '/dashboard':       'dashboard.html',
    '/invite':          'invite.html', # Maps clean path to the template
}
```

### Step C: Update buildUrl in shared-utils.js
Open [shared-utils.js](../frontend/js/shared-utils.js) and register the page to allow clean URL resolution on localhost:
```javascript
const pageToHtml = {
  'dashboard':    'dashboard.html',
  'invite':       'invite.html',
};
```

---

## ➕ 3. How to Add a New Database Model

### Step A: Define the SQLAlchemy Model
Open [models.py](../backend/models.py) and declare the new table class:
```python
class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    quantity = Column(Integer)
    owner_id = Column(Integer, ForeignKey("users.id"), index=True)
```

### Step B: Generate the Alembic Migration
Run the autogenerate migration command inside `/backend`:
```bash
alembic revision --autogenerate -m "add_items_table"
```
Review the generated file inside `/backend/migrations/versions/` to verify it maps the columns correctly.

### Step C: Apply the Migration
Run the upgrade command to apply the changes to your local database:
```bash
alembic upgrade head
```

---

## ➕ 4. How to Enforce Endpoint Permissions

Notepay uses dependencies to enforce permissions. Inject the following guards into your API routes:

*   **Enforce Event Membership**:
    ```python
    @router.get("/events/{event_id}/details")
    def get_details(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
        verify_membership(db, event_id, user_id) # Raises 403 if not a member
    ```
*   **Restrict to Organizer**:
    ```python
    @router.put("/events/{event_id}/settings")
    def edit_settings(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
        verify_membership(db, event_id, user_id, require_organizer=True)
    ```
*   **Block Restricted Collectors**:
    ```python
    @router.post("/events/{event_id}/transactions")
    def add_tx(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
        # Checks if user is unrestricted and if the event is active
        verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    ```
