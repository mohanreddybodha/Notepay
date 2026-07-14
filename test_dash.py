import sys, os
sys.path.append(os.getcwd())
from backend.database import SessionLocal
from backend.crud import get_user_full_dashboard
db = SessionLocal()
try:
    dash = get_user_full_dashboard(db, 1)
    if dash.watched_events:
        print('WATCHED:', dash.watched_events[0].event.total_collections)
    else:
        print('NO WATCHED EVENTS')
except Exception as e:
    print('ERROR:', e)
