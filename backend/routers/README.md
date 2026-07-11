# API Routers Directory

This directory contains the FastAPI router modules for Notepay, grouping endpoints logically by resource.

---

## 📂 Router Modules

*   [admin.py](admin.py): Administrative endpoints. Manages users (banning/unbanning/deletion), events (deactivation/deletion), system logs, audit trails, and feedback status. Protected by the `require_admin` dependency.
*   [profile.py](profile.py): User profile management, registration, and feedback submission.
*   [events.py](events.py): Event lifecycle endpoints. Handles event creation, joining, deactivation, and Discovery history tracking.
*   [contributions_expenses.py](contributions_expenses.py): Transaction management. Manages contributions, expenses, receipt image uploads, and financial summary aggregations.
*   [chat.py](chat.py): Chat message routing, emoji reactions, message delivery status tracking, and the AI Advisor workflow.
*   [public.py](public.py): Public Portal endpoints. Guest receipt uploads, manual guest contributions, and public event information.

---

## 🔒 Permission Gating Pattern

To secure routes and enforce permissions, routers inject dependency guards:

```python
from dependencies import get_current_user_id, verify_membership, verify_event_active_for_collector

@router.post("/events/{event_id}/contributions")
async def add_contribution(
    event_id: str, 
    contribution: schemas.ContributionCreate, 
    db: Session = Depends(get_db), 
    user_id: int = Depends(get_current_user_id)
):
    # Enforces that the collector is an active, unrestricted member of the event
    verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    ...
```

*   `verify_membership(db, event_id, user_id)`: Verifies the user belongs to the event. Adding `require_organizer=True` restricts the route to the event organizer.
*   `verify_event_active_for_collector(db, event_id, user_id, for_write=True)`: Verifies that the event is active. If `for_write=True`, the route requires event membership and an unrestricted role status.
