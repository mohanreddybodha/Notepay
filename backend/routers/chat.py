"""
routers/chat.py — Event chat messages, reactions, status updates, and AI Advisor processing
"""
import os
import time
import requests
import asyncio
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db, SessionLocal
import crud
import models
import schemas
from dependencies import get_current_user_id, verify_membership
from limiter import verify_rate_limit, check_rate_limit
from cache import cache
from ws_manager import manager

router = APIRouter()


def process_ai_chat(event_id: str, question: str, loop: asyncio.AbstractEventLoop, reply_to_id: int = None):
    db = SessionLocal()
    try:
        event = db.query(models.Event).filter(models.Event.id == event_id).first()
        if not event:
            return
        
        # Limit to most recent 200 donations and 100 expenses for AI context
        # Prevents memory exhaustion on large events
        donations = db.query(models.Donation).filter(
            models.Donation.event_id == event_id
        ).order_by(models.Donation.collected_at.desc()).limit(200).all()
        expenses = db.query(models.Expense).filter(
            models.Expense.event_id == event_id
        ).order_by(models.Expense.collected_at.desc()).limit(100).all()

        # SQL aggregations for accurate totals (not limited)
        total_collected = db.query(func.sum(models.Donation.amount)).filter(
            models.Donation.event_id == event_id,
            models.Donation.payment_received != False  # noqa: E712
        ).scalar() or 0.0
        total_spent = db.query(func.sum(models.Expense.amount)).filter(
            models.Expense.event_id == event_id
        ).scalar() or 0.0
        balance = total_collected - total_spent

        # Get users for mapping — single batch query
        members = db.query(models.EventMember).filter(models.EventMember.event_id == event_id).all()
        user_ids = {m.user_id for m in members} | {d.collected_by for d in donations if d.collected_by} | {e.collected_by for e in expenses if e.collected_by}
        users = db.query(models.User).filter(models.User.id.in_(user_ids)).all() if user_ids else []
        user_map = {u.id: u.full_name for u in users}
        
        member_lines = "\n".join([f"  - {user_map.get(m.user_id, 'Unknown')}: {m.role.value}" + (" (RESTRICTED)" if m.is_restricted else "") for m in members])
        expense_lines = "\n".join([f"  - {e.description}: ₹{e.amount or 0} (Spent by: {user_map.get(e.collected_by, 'Unknown')})" for e in sorted(expenses, key=lambda x: x.amount or 0, reverse=True)])
        donation_lines = "\n".join([f"  - {d.donor_name}: ₹{d.amount or 0} (Collected by: {user_map.get(d.collected_by, 'Unknown')})" for d in sorted(donations, key=lambda x: x.amount or 0, reverse=True)])
        
        event_name = event.name
        event_desc = event.description
        goal_amount = event.goal_amount or 0
        num_donors = len(donations)
        num_expenses = len(expenses)
    except Exception as e:
        print(f"AI Chat DB Fetch Error: {type(e).__name__} - {e}")
        return
    finally:
        db.close()
    system_prompt = f"""
You are a friendly, helpful event management and financial assistant inside Notepay. Notepay is an app where friends and family work together to organize events, track shared expenses, and collect money.

You are helping the event organizer understand the event's finances and providing general advice for event management.
Follow these rules strictly:
1. Speak in plain, simple, everyday language. Avoid hard technical words (like "ledger", "fiscal", "liabilities"). Instead, use words like "money collected", "money spent", "remaining balance", etc.
2. Be warm, supportive, and extremely easy to understand.
3. Be concise and to the point.
4. Use ₹ for all money amounts.
5. Format your answer with clear bullet points.
6. When answering questions about the event's current numbers, ONLY use the exact data provided below. Do not make up any financial numbers.
7. You are allowed and encouraged to give general advice, ideas, and suggestions for event management (e.g., how to collect donations, how to organize activities, how to handle members).
8. Keep your response under 250 words.

KNOWLEDGE BASE: NOTEPAY MEMBER ROLES
- Organizer: The creator of the event. They can edit the event, delete the event, add/delete/edit any financial entries, and promote/restrict members.
- Collector: A normal member. They can read everything, add new donations/expenses, and edit/delete their own entries.
- Restricted Member: A member whose access has been temporarily blocked by the Organizer. They have absolutely ZERO permissions. They cannot read the finances, they cannot write, and they cannot add collections until they are unrestricted.

CRITICAL RULE: You must ONLY answer questions related to this event, its finances, its members, or general event management/organization advice.
You do NOT know how the Notepay app works technically. Do NOT give instructions on how to use Notepay features (like how to create an event, how to add members, etc).
If the user asks ANY unrelated question (like coding, history) OR asks how to use the Notepay app, you MUST reject the question. 
To reject a question, you must output EXACTLY the following sentence and absolutely nothing else (no greetings, no explanations):
"I'm your friendly Notepay assistant for the {event_name} event! I can help you with your event's finances, members, and give you general advice for organizing your event."

DO NOT output the above sentence if the user's question is relevant. If the question is relevant, just answer it directly without any introductory greeting.

═══ EVENT FINANCIAL DATA ═══
Event: {event_name}
Description: {event_desc}
Goal/Target: ₹{goal_amount}

MEMBERS LIST:
{member_lines}

COLLECTIONS:
  Total collected:    ₹{total_collected}
  Number of donors:   {num_donors}
{donation_lines}

EXPENSES (already paid):
  Total spent:        ₹{total_spent}
  Number of items:    {num_expenses}
{expense_lines}

FINANCIAL POSITION:
  Current balance:    ₹{balance}
═══ END OF EVENT DATA ═══
"""
        
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        try:
            import boto3
            ssm = boto3.client('ssm')
            param = ssm.get_parameter(Name='/notepay/groq_key', WithDecryption=True)
            groq_api_key = param['Parameter']['Value']
        except Exception as e:
            print(f"Chat SSM fetch failed: {e}")
            
    gemini_api_key = os.environ.get("GEMINI_KEY_1")
    
    ai_text = None
    if not groq_api_key and not gemini_api_key:
        print("AI Chat Error: Both GROQ_API_KEY and GEMINI_KEY_1 are missing.")
        ai_text = "AI Advisor configuration error: API keys are missing."
    else:
        # 1. Attempt Groq with multi-model fallback
        if groq_api_key:
            groq_models = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"]
            for model_id in groq_models:
                groq_payload = {
                    "model": model_id,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": question}
                    ],
                    "temperature": 0.4
                }
                for attempt in range(2):
                    try:
                        # Groq is fast, timeout is 30s
                        groq_resp = requests.post(
                            "https://api.groq.com/openai/v1/chat/completions",
                            headers={"Authorization": f"Bearer {groq_api_key}"},
                            json=groq_payload,
                            timeout=30
                        )
                        if groq_resp.status_code == 200:
                            ai_text = groq_resp.json()["choices"][0]["message"]["content"]
                            break
                        elif groq_resp.status_code == 429:
                            retry_after = groq_resp.headers.get("retry-after")
                            if retry_after and float(retry_after) <= 4.0 and attempt == 0:
                                print(f"Groq 429 Hit on {model_id}. Retrying after {retry_after}s...")
                                time.sleep(float(retry_after))
                                continue
                            else:
                                print(f"Groq {model_id} hit hard rate limit. Trying next model...")
                                break
                        else:
                            print(f"Groq API Error {groq_resp.status_code} on {model_id}: {groq_resp.text[:100]}")
                            break
                    except Exception as e:
                        print(f"Groq connection failed for {model_id}: {type(e).__name__} - {e}")
                        break
                        
                if ai_text:
                    break # Success! Exit the model loop
                
        # 2. Attempt Gemini Fallback if Groq failed or is unavailable
        if not ai_text and gemini_api_key:
            gemini_payload = {
                "contents": [{"parts": [{"text": system_prompt + "\n\nUser question: " + question}]}],
                "generationConfig": {"temperature": 0.4}
            }
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
            for attempt in range(2):
                try:
                    resp = requests.post(url, json=gemini_payload, timeout=60)
                    if resp.status_code == 200:
                        ai_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                        break
                    elif resp.status_code in (429, 503):
                        wait_sec = (2 ** attempt) * 5
                        print(f"Gemini rate limited ({resp.status_code}), retrying in {wait_sec}s (attempt {attempt+1})")
                        time.sleep(wait_sec)
                    else:
                        print(f"Gemini API Error {resp.status_code}: {resp.text[:100]}")
                        break
                except Exception as e:
                    print(f"Gemini connection failed: {type(e).__name__} - {e}")
                    break
    
    if not ai_text:
        ai_text = "I'm experiencing some technical difficulties right now. Please try asking again in a few minutes! 🛠️"
        
    # Save AI response as chat message
    db2 = SessionLocal()
    try:
        msg = crud.create_chat_message(db2, event_id, None, ai_text, reply_to_id)
        msg_data = jsonable_encoder(msg)
    except Exception as e:
        print(f"AI Chat DB Save Error: {type(e).__name__} - {e}")
        return
    finally:
        db2.close()

    # Broadcast safely across threads
    try:
        asyncio.run_coroutine_threadsafe(
            manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": msg_data}),
            loop
        )
    except Exception as e:
        print(f"AI Chat Broadcast Error: {type(e).__name__} - {e}")


#  CHAT 
@router.get("/events/{event_id}/chat", response_model=List[schemas.ChatMessageResponse], tags=["Chat"])
def get_chat_history(event_id: str, limit: int = 50, before_id: int = None,
                           db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Get chat message history for an event. Supports pagination via before_id."""
    verify_membership(db, event_id, user_id)
    return crud.get_chat_messages(db, event_id, limit=limit, before_id=before_id)


@router.post("/events/{event_id}/chat", response_model=schemas.ChatMessageResponse, tags=["Chat"])
async def send_chat_message(event_id: str, data: schemas.ChatMessageCreate, background_tasks: BackgroundTasks,
                            db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Send a chat message to all members of an event."""
    verify_membership(db, event_id, user_id, require_member=True, require_unrestricted=True)
    verify_rate_limit(f"user:{user_id}:chat", limit=20, window=60, detail="Sending messages too fast. Slow down.")
    if not data.message or not data.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
        
    if hasattr(data, "idempotency_key") and data.idempotency_key and cache:
        local_key = f"idemp:{user_id}:{data.idempotency_key}"
        existing = cache.get(local_key)
        if existing:
            existing_id = int(existing)
            existing_msg = db.query(models.ChatMessage).filter(models.ChatMessage.id == existing_id).first()
            if existing_msg:
                return existing_msg
    
    clean_msg = data.message.strip()
    
    ai_limit_reached = False
    if clean_msg.lower().startswith("@ai "):
        today_str = datetime.utcnow().strftime('%Y-%m-%d')
        if not check_rate_limit(f"event:{event_id}:user:{user_id}:ai_chat:{today_str}", limit=10, window=86400):
            ai_limit_reached = True
    
    msg = crud.create_chat_message(db, event_id, user_id, clean_msg, data.reply_to_id)
    
    if hasattr(data, "idempotency_key") and data.idempotency_key and cache:
        cache.set(f"idemp:{user_id}:{data.idempotency_key}", msg["id"], expire=86400)
        
    # Broadcast to all connected clients via WebSocket
    await manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": jsonable_encoder(msg)})
    
    # Process AI response asynchronously
    if clean_msg.lower().startswith("@ai "):
        if ai_limit_reached:
            # Friendly rate limit message
            friendly_text = "Hey! You've reached your AI query limit for today. I need to take a nap! 😴"
            loop = asyncio.get_running_loop()
            await manager.broadcast_change(event_id, {"type": "AI_TYPING"})
            
            async def send_friendly_nap():
                await asyncio.sleep(1.5)
                db2 = SessionLocal()
                try:
                    nap_msg = crud.create_chat_message(db2, event_id, None, friendly_text, msg["id"])
                    nap_data = jsonable_encoder(nap_msg)
                    asyncio.run_coroutine_threadsafe(
                        manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": nap_data}), loop
                    )
                finally:
                    db2.close()
                    
            background_tasks.add_task(send_friendly_nap)
        else:
            question = clean_msg[4:].strip()
            if question:
                loop = asyncio.get_running_loop()
                await manager.broadcast_change(event_id, {"type": "AI_TYPING"})
                background_tasks.add_task(process_ai_chat, event_id, question, loop, msg["id"])
            
    return msg


@router.post("/events/{event_id}/chat/{message_id}/react", tags=["Chat"])
async def react_to_message(event_id: str, message_id: int, data: schemas.ChatReactionRequest,
                           db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Toggle an emoji reaction on a chat message."""
    verify_membership(db, event_id, user_id, require_member=True, require_unrestricted=True)
    if not data.emoji or len(data.emoji) > 10: # Basic length check to prevent abuse
        raise HTTPException(status_code=400, detail="Invalid emoji length")
    msg = crud.toggle_reaction(db, message_id, event_id, user_id, data.emoji)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    await manager.broadcast_change(event_id, {"type": "CHAT_REACTION", "data": jsonable_encoder(msg)})
    return msg


@router.post("/events/{event_id}/chat/{message_id}/status", tags=["Chat"])
async def update_message_status(event_id: str, message_id: int, data: schemas.MessageStatusUpdate,
                           db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Update message status to delivered or read."""
    verify_membership(db, event_id, user_id, require_member=True)
    if data.status not in ["delivered", "read"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    msg = crud.update_chat_status(db, message_id, event_id, user_id, data.status)
    if not msg:
        return {"message": "Ignored"}
        
    await manager.broadcast_change(event_id, {"type": "CHAT_STATUS_UPDATE", "data": jsonable_encoder(msg)})
    return msg


@router.delete("/events/{event_id}/chat/{message_id}", tags=["Chat"])
async def delete_chat_message(event_id: str, message_id: int, 
                              db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Wipe a chat message (replaces content with 'deleted'). Only sender or organizer can delete."""
    verify_membership(db, event_id, user_id, require_member=True)
    mem = crud.get_member(db, event_id, user_id)
    ev = crud.get_event(db, event_id)
    is_org = bool(
        mem and mem.role == models.UserRole.organizer
    ) or bool(ev and ev.organizer_id == user_id)

    msg = crud.delete_chat_message(db, message_id, event_id, user_id, is_org)
    if not msg:
        raise HTTPException(status_code=403, detail="Not authorized to delete this message or message not found")
    
    await manager.broadcast_change(event_id, {"type": "CHAT_REACTION", "data": jsonable_encoder(msg)}) # Use CHAT_REACTION to update existing msg in place
    return {"message": "Message deleted"}
