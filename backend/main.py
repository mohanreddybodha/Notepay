import os
import sys
import json
import time
import asyncio
import concurrent.futures
from datetime import datetime
from typing import List, Optional, Dict
import boto3
from dotenv import load_dotenv
load_dotenv()  # Load .env for local development

# Ensure local modules (models, schemas, crud, auth) can be found regardless of current directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Request, Query, Header, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.encoders import jsonable_encoder
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
import requests

_init_error = None
try:
    import models, schemas, crud, auth
    from storage import storage_service
    try:
        from cache import cache
    except ImportError:
        cache = None
    from database import engine, get_db
    from limiter import verify_rate_limit, check_rate_limit
    models.Base.metadata.create_all(bind=engine)
except Exception as e:
    import traceback
    _init_error = traceback.format_exc()

def _run_legacy_migrations():
    """
    LEGACY: Idempotent migration for feedback.name and feedback.email columns.
    These were added before Alembic was set up and cannot be removed safely.
    DO NOT add new migrations here — use Alembic (alembic revision --autogenerate) instead.
    """
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if "feedback" in inspector.get_table_names():
        columns = [col["name"] for col in inspector.get_columns("feedback")]
        with engine.begin() as conn:
            if "name" not in columns:
                try:
                    conn.execute(text("ALTER TABLE feedback ADD COLUMN name VARCHAR"))
                    print("Added column 'name' to 'feedback' table.")
                except Exception as e:
                    print("Error adding 'name' column:", e)
            if "email" not in columns:
                try:
                    conn.execute(text("ALTER TABLE feedback ADD COLUMN email VARCHAR"))
                    print("Added column 'email' to 'feedback' table.")
                except Exception as e:
                    print("Error adding 'email' column:", e)

_run_legacy_migrations()

app = FastAPI(
    title="NotePay API",
    description="Backend for NotePay  PRD v12.0",
    version="1.0.0"
)

from fastapi.responses import JSONResponse

#  CORS  named production origins + localhost entries for dev
#  In development we explicitly whitelist common local frontend ports (3000) to avoid intermittent
#  CORS failures caused by overly strict regex matching in some browsers / setups.
_DEFAULT_ORIGINS = "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000,http://127.0.0.1:3000"
env_origins = os.getenv("ALLOWED_ORIGINS")
if os.getenv("ENVIRONMENT") == "production":
    _ALLOWED_ORIGINS = [o.strip() for o in env_origins.split(",")] if env_origins else []
    admin_domain = os.getenv("ADMIN_DOMAIN")
    if admin_domain:
        _ALLOWED_ORIGINS.append(admin_domain)
    _ALLOWED_ORIGINS.extend([
        "https://admin.notepay.in",
        "https://notepay.in",
        "https://www.notepay.in"
    ])
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # Development: explicitly whitelist common local origins to avoid missing ACAO headers
    _ALLOWED_ORIGINS = [o.strip() for o in (env_origins or _DEFAULT_ORIGINS).split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


#  WEBSOCKET MANAGER 
from ws_manager import manager, ConnectionManager

_DEBUG_MODE = os.getenv("DEBUG", "false").lower() in ("1", "true", "yes")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # This prevents 500 errors from stripping CORS headers!
    if _DEBUG_MODE:
        detail = f"Internal Server Error: {repr(exc)}"
    else:
        print(f"Unhandled error on {request.url.path}: {exc!r}")
        detail = "Internal server error"
    return JSONResponse(status_code=500, content={"detail": detail})

# Firebase Bearer token scheme and auth helpers
from dependencies import (
    _bearer,
    get_current_user_id,
    get_optional_current_user_id,
    verify_membership,
    verify_event_active_for_collector,
)

#  ROOT 
@app.get("/")
def read_root():
    return {"message": "NotePay API  PRD v12.0 Complete", "docs": "/docs"}


@app.get("/health", tags=["System"])
def health_check():
    """Simple health check for deployment pipelines."""
    return {"status": "ok"}








#  WEBSOCKET ENDPOINT 
async def _authenticate_ws_user(db: Session, token: str) -> int:
    """Verify Firebase token and return internal user id."""
    if not token:
        raise HTTPException(status_code=401, detail="Token required")
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    decoded = await auth.verify_token(creds)
    user = crud.get_user_by_firebase_uid(db, decoded["uid"])
    if not user:
        raise HTTPException(status_code=404, detail="User not registered")
    return user.id


async def _ws_send_auth_ok(websocket: WebSocket) -> bool:
    """Send AUTH_OK; return False if the client already disconnected."""
    try:
        await websocket.send_json({"type": "AUTH_OK"})
        return True
    except WebSocketDisconnect:
        return False

@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """Authenticated dashboard channel for DASHBOARD_UPDATE broadcasts (no event membership)."""
    await websocket.accept()
    from database import SessionLocal
    db = SessionLocal()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
        auth_msg = json.loads(raw)
        if auth_msg.get("type") != "AUTH" or not auth_msg.get("token"):
            raise ValueError("Auth required")
        await _authenticate_ws_user(db, auth_msg["token"])
    except Exception:
        db.close()
        try:
            await websocket.close(code=4401, reason="Auth failed")
        except Exception:
            pass
        return
        
    db.close()
    
    manager.register_dashboard(websocket)
    if not await _ws_send_auth_ok(websocket):
        manager.disconnect_dashboard(websocket)
        return

    try:
        while True:
            await websocket.receive_text()
    except Exception:
        manager.disconnect_dashboard(websocket)

import traceback
import json

try:
    from routers import admin, profile, events, donations_expenses, chat, public
    app.include_router(admin.router)
    app.include_router(profile.router)
    app.include_router(events.router)
    app.include_router(donations_expenses.router)
    app.include_router(chat.router)
    app.include_router(public.router)

    #  AWS SERVERLESS HANDLER 
    from mangum import Mangum
    mangum_handler = Mangum(app)
except Exception as e:
    if _init_error is None:
        _init_error = traceback.format_exc()
    mangum_handler = None


def handler(event, context):
    if _init_error:
        # Return 200 so the deploy script health check succeeds and we can read the body!
        return {
            "statusCode": 200,
            "body": json.dumps({"status": "error", "traceback": _init_error}),
            "headers": {"Content-Type": "application/json"}
        }

    # ── EventBridge warmup ping — return immediately to keep Lambda warm ──
    event_source = event.get("source", "")
    if event_source in ("notepay-warmup", "aws.events"):
        print("Lambda warmup ping received — container is warm.")
        return {"statusCode": 200, "body": "warm"}

    request_context = event.get('requestContext', {})
    conn_id = request_context.get('connectionId')
    
    # Handle API Gateway WebSocket events natively, bypassing Mangum for WS
    if conn_id and request_context.get('eventType'):
        event_type = request_context['eventType']
        
        if event_type == 'CONNECT':
            return {'statusCode': 200}
            
        elif event_type == 'DISCONNECT':
            if cache.client:
                mapping = cache.client.get(f"ws:conn:{conn_id}")
                if mapping:
                    if mapping.startswith("evt:"):
                        evt_id = mapping.split(":")[1]
                        cache.client.srem(f"ws:evt:{evt_id}", conn_id)
                    elif mapping == "dash":
                        cache.client.srem("ws:dash", conn_id)
                    cache.client.delete(f"ws:conn:{conn_id}")
            return {'statusCode': 200}
            
        elif event_type == 'MESSAGE':
            body = event.get('body', '{}')
            # Handle empty keep-alive ping
            if body.strip() == '':
                return {'statusCode': 200}
                
            try:
                data = json.loads(body)
            except Exception:
                return {'statusCode': 400}
                
            if data.get('type') == 'AUTH' and data.get('token'):
                # Enforce cryptographic validation of token in AWS Lambda
                from database import SessionLocal
                import asyncio
                db = SessionLocal()
                try:
                    # Synchronously await the auth check (FastAPI dependencies can be reused if adapted, or use raw auth)
                    # _authenticate_ws_user is async
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    user_id = loop.run_until_complete(_authenticate_ws_user(db, data.get('token')))
                    loop.close()
                except Exception as e:
                    db.close()
                    print(f"WS Auth Error: {e}")
                    return {'statusCode': 401}
                db.close()

                if data.get('dashboard'):
                    if cache.client:
                        cache.client.sadd("ws:dash", conn_id)
                        cache.client.setex(f"ws:conn:{conn_id}", 86400, "dash")
                        cache.client.expire("ws:dash", 86400)
                elif data.get('eventId'):
                    evt_id = str(data['eventId'])
                    if cache.client:
                        cache.client.sadd(f"ws:evt:{evt_id}", conn_id)
                        cache.client.setex(f"ws:conn:{conn_id}", 86400, f"evt:{evt_id}")
                        cache.client.expire(f"ws:evt:{evt_id}", 86400)
                
                # Send AUTH_OK back via boto3
                try:
                    apigw = boto3.client('apigatewaymanagementapi', endpoint_url=os.getenv('WEBSOCKET_URL').replace('wss://', 'https://'))
                    apigw.post_to_connection(ConnectionId=conn_id, Data=json.dumps({"type": "AUTH_OK"}).encode('utf-8'))
                except Exception as e:
                    print("Boto3 WS Auth OK Error:", e)
            
            return {'statusCode': 200}
            
    # If not a WebSocket event, route HTTP request through Mangum to FastAPI
    return mangum_handler(event, context)


@app.websocket("/ws/{event_id}")
async def websocket_endpoint(websocket: WebSocket, event_id: str):
    """Authenticate via first JSON message {type:AUTH, token}  avoids huge JWT in query string."""
    await websocket.accept()
    from database import SessionLocal
    db = SessionLocal()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
        auth_msg = json.loads(raw)
        if auth_msg.get("type") != "AUTH" or not auth_msg.get("token"):
            raise ValueError("Auth required")
        await _authenticate_ws_user(db, auth_msg["token"])
    except Exception:
        db.close()
        try:
            await websocket.close(code=4401, reason="Auth failed")
        except Exception:
            pass
        return
        
    db.close()
    
    manager.register(websocket, event_id)
    if not await _ws_send_auth_ok(websocket):
        manager.disconnect(websocket, event_id)
        return

    try:
        while True:
            await websocket.receive_text()
    except Exception:
        manager.disconnect(websocket, event_id)

