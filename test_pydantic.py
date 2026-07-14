from pydantic import BaseModel, ConfigDict
from typing import Optional

class EventResponse(BaseModel):
    id: str
    total_collections: Optional[float] = 0.0
    model_config = ConfigDict(from_attributes=True)

class WatchedEventResponse(BaseModel):
    id: int
    event_id: str
    event: EventResponse
    model_config = ConfigDict(from_attributes=True)

w_dict = {
    "id": 1,
    "event_id": "test",
    "event": {
        "id": "test",
        "total_collections": 500.5
    }
}

try:
    obj = WatchedEventResponse.model_validate(w_dict)
    print("SUCCESS:", obj.event.total_collections)
except Exception as e:
    print("ERROR:", e)
