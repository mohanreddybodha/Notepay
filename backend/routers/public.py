"""
routers/public.py — Public Portal endpoints for guest receipt upload, manual donation entry, and event preview
"""
import os
import re
import json
import uuid
import base64
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from database import get_db
import crud
import schemas
from storage import storage_service
from ws_manager import manager
try:
    from cache import cache
except ImportError:
    cache = None

router = APIRouter()


@router.post("/api/public/event/{event_id}/upload_receipt", tags=["Public Portal"])
async def upload_receipt(event_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    event = crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not event.upi_id or not event.upi_owner_name:
        raise HTTPException(status_code=409, detail="The organizer must verify the event UPI ID before accepting donations")
    
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="File is empty")
        
        if len(contents) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 5MB)")
            
        receipt_key = None
        try:
            receipt_key = storage_service.upload_receipt(event_id, contents, file.content_type)
        except Exception as e:
            print(f"Failed to upload receipt early: {e}")

        def get_fallback_response(msg):
            session_id = str(uuid.uuid4())
            try:
                if cache:
                    cache.set(f"receipt:{session_id}", {
                        "receipt_key": receipt_key,
                        "extraction_api": "manual_fallback"
                    }, expire=900)
            except Exception as e:
                print(f"Failed to cache fallback receipt session: {e}")
            return {
                "status": "extraction_failed",
                "extraction_failed": True,
                "message": msg,
                "receipt_session_id": session_id
            }
        
        prompt = '''You are analyzing an Indian UPI payment receipt screenshot. Extract these 5 fields:
1. amount: The payment amount in INR as a number (e.g., 10.00, 110.00)
2. sender_name: The person who SENT the money (the payer)
3. receiver_name: The person or business who RECEIVED the money (the payee)
4. transaction_date: The date in YYYY-MM-DD format
5. status: "success" if this is a successful payment receipt, "failed" if the screenshot shows a failed or pending transaction, "unrelated_image" if the image is NOT a payment receipt (e.g., selfie, scenery, random text).

KEY RULES FOR DIFFERENT UPI APPS:

PhonePe receipts:
- "Banking Name: John Doe" → receiver_name is "John Doe" (this is the RECEIVER\'s account name)
- "Debited from" section = the SENDER\'s bank account
- "Transfer to" section = the RECEIVER\'s bank account
- The name under "Banking Name" in the "Transfer to" section = receiver_name

Google Pay receipts:
- "Paid to [Name]" or "To [Name]" = receiver_name
- "From: [Name]" or "Sender: [Name]" = sender_name
- "Banking name: [Name]" = receiver_name if in paid-to section

Paytm/BHIM/Other receipts:
- "Paid To", "Beneficiary", "To", "Merchant" = receiver_name
- "From", "Debited", "Your Account" = sender_name

GENERAL RULES:
- receiver_name: Look for "Banking Name", "Paid to", "To", "Transfer to", "Merchant", "Beneficiary"
- sender_name: Look for "From", "Debited from", "Paid by", "Your name" - must be a PERSON NAME not bank name
- CRITICAL SENDER NAME RULE: You MUST return null for sender_name unless the sender's name is EXPLICITLY labeled with "From", "Paid by", "Sender", "Payer", "Debited from", or "From A/C". If the image does not contain the sender's name explicitly, you MUST return null. DO NOT guess, DO NOT use the receiver's name, and DO NOT hallucinate.
- NEVER confuse sender and receiver
- transaction_date: Look for dates near "Transaction", time stamps at top of screen (e.g., "04:44 pm on 12 Jun 2026" → "2026-06-12")
- Transaction Successful Rule: You MUST detect words or messages indicating a successful payment completion (like "Success", "Paid", "Payment Successful", "Transaction Complete", or any other clear success indicator). However, if the screenshot shows "Pending", "Processing", or "Failed", you MUST immediately set status to "failed" and return.

Return ONLY valid JSON:
{"amount": 10.00, "sender_name": null, "receiver_name": "Boda Mohan Reddy", "transaction_date": "2026-06-12", "status": "success"}'''

        extracted_text = None
        extraction_api = None

        # Fetch keys
        groq_key_1 = os.getenv("GROQ_API_KEY")
        groq_key_2 = os.getenv("GROQ_API_KEY_2")
        groq_key_3 = os.getenv("GROQ_API_KEY_3")

        try:
            import boto3
            ssm = boto3.client('ssm')
            if not groq_key_1:
                try:
                    param = ssm.get_parameter(Name='/notepay/groq_key_for_payment', WithDecryption=True)
                    groq_key_1 = param['Parameter']['Value']
                except Exception:
                    pass
            if not groq_key_2:
                try:
                    param2 = ssm.get_parameter(Name='/notepay/groq_key_for_payment-2', WithDecryption=True)
                    groq_key_2 = param2['Parameter']['Value']
                except Exception:
                    pass
            if not groq_key_3:
                try:
                    param3 = ssm.get_parameter(Name='/notepay/groq_key_for_payment-3', WithDecryption=True)
                    groq_key_3 = param3['Parameter']['Value']
                except Exception:
                    pass
        except Exception as e:
            print(f"SSM client failed: {e}")

        # Order: key_2 first, key_3 second fallback, key_1 third fallback
        keys_to_try = []
        if groq_key_2: keys_to_try.append(groq_key_2)
        if groq_key_3: keys_to_try.append(groq_key_3)
        if groq_key_1: keys_to_try.append(groq_key_1)

        # Llama 4 Scout is the ONLY vision model on Groq free tier (tested June 2026)
        # Both API keys have identical model access
        groq_vision_models = [
            "meta-llama/llama-4-scout-17b-16e-instruct",  # Only vision model available
        ]

        for g_key in keys_to_try:
            if extracted_text:
                break
            try:
                from groq import Groq as GroqClient
                groq_client = GroqClient(api_key=g_key)
                image_b64 = base64.standard_b64encode(contents).decode("utf-8")
                
                for model_id in groq_vision_models:
                    try:
                        response = groq_client.chat.completions.create(
                            model=model_id,
                            messages=[
                                {
                                    "role": "user",
                                    "content": [
                                        {"type": "text", "text": prompt},
                                        {
                                            "type": "image_url",
                                            "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}
                                        }
                                    ]
                                }
                            ],
                            temperature=0.1,
                            response_format={"type": "json_object"},
                            max_completion_tokens=256
                        )
                        extracted_text = response.choices[0].message.content.strip()
                        extraction_api = "groq"
                        break  # Break out of model loop if successful
                    except Exception as model_e:
                        print(f"Groq {model_id} with key {g_key[:5]}... failed: {model_e}")
                        
            except Exception as e:
                print(f"Groq setup failed for key: {e}")

        if not extracted_text:
            gemini_key = os.getenv("GEMINI_KEY_1") or os.getenv("GEMINI_API_KEY")
            if gemini_key:
                try:
                    import google.generativeai as genai
                    import PIL.Image, io
                    genai.configure(api_key=gemini_key)
                    image = PIL.Image.open(io.BytesIO(contents))
                    
                    model = genai.GenerativeModel('gemini-2.0-flash')
                    response = model.generate_content([image, prompt])
                    extracted_text = response.text.strip()
                    extraction_api = "gemini"
                except Exception as e:
                    print(f"Gemini failed: {e}")

        if not extracted_text:
            return get_fallback_response("AI services are currently unavailable. Please enter manually.")

        json_match = re.search(r'\{.*?\}', extracted_text, re.DOTALL)
        if not json_match:
            return get_fallback_response("AI failed to return structured data. Please enter manually.")

        parsed_data = json.loads(json_match.group(0))
        
        if parsed_data.get("status") == "unrelated_image":
            return {
                "status": "unrelated_image",
                "message": "Please upload a valid payment screenshot. The uploaded image does not appear to be a UPI receipt."
            }
            
        if parsed_data.get("status") == "failed":
            return {
                "status": "failed",
                "message": "This screenshot shows a failed, pending, or incomplete transaction. Please upload a receipt for a successful payment."
            }
            
        amount = float(parsed_data.get("amount", 0)) if parsed_data.get("amount") else 0
        donor_name = str(parsed_data.get("sender_name", "") or "")[:100].strip()
        receiver_name = str(parsed_data.get("receiver_name", "") or "")[:100].strip()
        transaction_date_str = parsed_data.get("transaction_date")

        if amount <= 0:
            return {
                "status": "rejected",
                "message": "The uploaded image does not appear to be a valid UPI receipt. We could not find a payment amount. Please upload a clear screenshot of a genuine receipt."
            }

        # Validate receiver name (Flexible Match)
        owner_name = event.upi_owner_name or ""
        rn_clean = re.sub(r'[^a-zA-Z0-9]', '', receiver_name).lower()
        owner_clean = re.sub(r'[^a-zA-Z0-9]', '', owner_name).lower()

        if not rn_clean:
            return {
                "status": "rejected",
                "message": "The uploaded image does not appear to be a valid UPI receipt. We could not find a receiver name. Please upload a clear screenshot of a genuine receipt."
            }

        rn_words = set(re.findall(r'[a-z0-9]+', receiver_name.lower()))
        owner_words = set(re.findall(r'[a-z0-9]+', owner_name.lower()))
        shared_significant_words = {w for w in rn_words.intersection(owner_words) if len(w) > 2}
        is_substring = (rn_clean in owner_clean or owner_clean in rn_clean)

        if owner_clean and not is_substring and not shared_significant_words:
            # AI found a receiver name but it doesn't match — genuine rejection
            return {
                "status": "rejected",
                "message": f"Payment was made to '{receiver_name}', but the registered name for this QR or UPI ID is '{owner_name}'. Please upload the correct receipt."
            }

        # Validation Passed

        # Check donor name
        dn_clean = re.sub(r'[^a-zA-Z0-9]', '', donor_name).lower()
        if dn_clean and rn_clean and (dn_clean == rn_clean):
            donor_name = ""  # Same person
        if donor_name.lower() in ["none", "null", "unknown"]:
            donor_name = ""

        try:
            transaction_date = datetime.strptime(transaction_date_str, "%Y-%m-%d") if transaction_date_str else datetime.now()
        except Exception as _date_err:
            print(f"Date parse warning (value={transaction_date_str!r}): {_date_err}. Falling back to now().")
            transaction_date = datetime.now()

        # Check if there are any required donor custom columns
        has_required_donor_cols = False
        cols = event.donation_custom_columns or []
        if isinstance(cols, str):
            try:
                cols = json.loads(cols)
            except Exception:
                cols = []
        for col in cols:
            if isinstance(col, dict) and col.get("reqByDonor") and not col.get("hidden"):
                has_required_donor_cols = True
                break

        # If donor name missing or required custom columns exist, initiate Partial Success flow
        if not donor_name or has_required_donor_cols:
            session_id = str(uuid.uuid4())
            try:
                if cache:
                    cache.set(f"receipt:{session_id}", {
                        "amount": amount,
                        "transaction_date": transaction_date.isoformat(),
                        "receiver_name": receiver_name,
                        "extraction_api": extraction_api,
                        "receipt_key": receipt_key
                    }, expire=900)  # 15 minutes
            except Exception as e:
                print(f"Failed to cache receipt session: {e}")

            return {
                "status": "partial_success",
                "amount": amount,
                "receipt_session_id": session_id,
                "receiver_name": receiver_name,
                "donor_name": donor_name if donor_name else "",
                "message": "Receipt valid! Please complete the required details."
            }

        # Full Success - Create Donation Automatically
        
        new_donation = schemas.DonationCreate(
            donor_name=donor_name,
            amount=amount,
            entry_source="ai",
            transaction_date=transaction_date,
            collector_name=event.upi_owner_name,
            payment_received=False,
            custom_fields={
                "method": f"UPI Auto-Receipt ({extraction_api.upper()})",
                "status": "ai_verified",
                "receiver_name": event.upi_owner_name,
                "receipt_receiver_name": receiver_name,
                "verified_upi_id": event.upi_id,
                "extraction_api": extraction_api
            },
            receipt_key=receipt_key
        )
        
        res = crud.create_donation(db, event_id, event.organizer_id, new_donation)
        await manager.broadcast_change(event_id, {"type": "DONATION_ADDED", "data": jsonable_encoder(res)})
        await manager.broadcast_dashboard_update()
        
        return {
            "message": "Success",
            "donation": res,
            "verification": "ai_verified",
            "extraction_api": extraction_api
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error processing receipt: {str(e)}")


@router.post("/api/public/event/{event_id}/submit_manual_donation", tags=["Public Portal"])
async def submit_manual_donation(event_id: str, data: schemas.ManualDonationEntry, db: Session = Depends(get_db)):
    event = crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not event.upi_id or not event.upi_owner_name:
        raise HTTPException(status_code=409, detail="The organizer must verify the event UPI ID before accepting donations")
    
    try:
        donor_name = data.donor_name.strip()
        amount = float(data.amount)
        if not donor_name or len(donor_name) < 2:
            raise ValueError("Donor name must be at least 2 characters")
        if amount <= 0:
            raise ValueError("Amount must be greater than 0")
        if amount > 1000000:
            raise ValueError("Amount seems too high (max ₹10,00,000)")
            
        transaction_date = datetime.now()
        entry_source = "manual"
        status = "manual_entry"
        method = "Manual Entry"
        receipt_receiver_name = None
        extraction_api = None
        receipt_key = None
        
        # Secure Partial AI Validation Logic
        if data.receipt_session_id and cache:
            try:
                cached_data = cache.get(f"receipt:{data.receipt_session_id}")
                if cached_data:
                    # Enforce cached values
                    if cached_data.get("amount"):
                        amount = float(cached_data.get("amount"))
                        entry_source = "ai_partial"
                        status = "ai_partial_verified"
                        extraction_api = cached_data.get("extraction_api")
                        method = f"UPI Partial Auto ({str(extraction_api).upper()})"
                    else:
                        entry_source = "manual"
                        status = "manual_entry"
                        extraction_api = "manual_fallback"
                        method = "Manual Entry (with image)"

                    try:
                        if cached_data.get("transaction_date"):
                            transaction_date = datetime.fromisoformat(cached_data.get("transaction_date"))
                    except Exception:
                        pass
                    receipt_receiver_name = cached_data.get("receiver_name")
                    receipt_key = cached_data.get("receipt_key")
                    # Clear cache to prevent replay
                    cache.delete(f"receipt:{data.receipt_session_id}")
            except Exception as e:
                print(f"Error reading cache for partial ai: {e}")
        
        custom_fields = {
            "method": method,
            "status": status,
            "receiver_name": event.upi_owner_name,
            "verified_upi_id": event.upi_id
        }
        if receipt_receiver_name:
            custom_fields["receipt_receiver_name"] = receipt_receiver_name
        if extraction_api:
            custom_fields["extraction_api"] = extraction_api
            
        if data.custom_fields:
            # Merge user-filled custom fields
            custom_fields.update(data.custom_fields)

        new_donation = schemas.DonationCreate(
            donor_name=donor_name,
            amount=amount,
            entry_source=entry_source,
            transaction_date=transaction_date,
            collector_name=event.upi_owner_name,
            payment_received=False,
            custom_fields=custom_fields,
            receipt_key=receipt_key
        )
        res = crud.create_donation(db, event_id, event.organizer_id, new_donation, is_public_entry=True)
        await manager.broadcast_change(event_id, {"type": "DONATION_ADDED", "data": jsonable_encoder(res)})
        await manager.broadcast_dashboard_update()
        return {
            "message": "Success",
            "donation": res,
            "verification": status
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/public/event/{event_id}", tags=["Public Portal"])
def get_public_event(event_id: str, db: Session = Depends(get_db)):
    event = crud.get_event(db, event_id)
    if not event or not event.is_active:
        raise HTTPException(status_code=404, detail="Event not found")
    
    organizer = crud.get_user(db, event.organizer_id)
    
    return {
        "id": event.id,
        "name": event.name,
        "description": event.description,
        "upi_id": event.upi_id,
        "upi_owner_name": event.upi_owner_name,
        "organizer_name": organizer.full_name if organizer else "Organizer",
        "donation_custom_columns": event.donation_custom_columns
    }
