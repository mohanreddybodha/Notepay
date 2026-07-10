"""
routers/donations_expenses.py — Donations, expenses, receipt uploads, summary, and full details endpoints
"""
import os
import boto3
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from database import get_db
import crud
import models
import schemas
from dependencies import get_current_user_id, verify_membership, verify_event_active_for_collector
from limiter import verify_rate_limit
from ws_manager import manager
from storage import storage_service

router = APIRouter()


#  DONATIONS 
@router.get("/events/{event_id}/donations", response_model=List[schemas.DonationResponse], tags=["Donations"])
def get_event_donations(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all donations. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_donations(db, event_id)


@router.post("/events/{event_id}/donations", response_model=schemas.DonationResponse, tags=["Donations"])
async def add_donation(event_id: str, donation: schemas.DonationCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Add a new donation row. Blocked if restricted or event deactivated."""
    verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    verify_rate_limit(f"user:{user_id}:add_entry", limit=30, window=60, detail="Adding entries too fast. Slow down.")
    res = crud.create_donation(db, event_id, user_id, donation)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_add"})
    await manager.broadcast_dashboard_update()
    return res


@router.put("/events/{event_id}/donations/{donation_id}", response_model=schemas.DonationResponse, tags=["Donations"])
async def update_donation(event_id: str, donation_id: int, data: schemas.DonationUpdate,
                    db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit a donation row. Organizer can edit any row. Collector can only edit their own."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    donation = crud.get_donation(db, donation_id)
    if not donation or donation["event_id"] != event_id:
        raise HTTPException(status_code=404, detail="Donation not found in this event")
    if member.role != models.UserRole.organizer and donation["collected_by"] != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own entries")
    result = crud.update_donation(db, donation_id, data)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_update"})
    await manager.broadcast_dashboard_update()
    return result


@router.delete("/events/{event_id}/donations/{donation_id}", tags=["Donations"])
async def delete_donation(event_id: str, donation_id: int,
                    db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Delete a donation row. Organizer can delete any. Collector can only delete their own."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    donation = crud.get_donation(db, donation_id)
    if not donation or donation["event_id"] != event_id:
        raise HTTPException(status_code=404, detail="Donation not found in this event")
    if member.role != models.UserRole.organizer and donation["collected_by"] != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own entries")
    crud.delete_donation(db, donation_id)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_delete"})
    await manager.broadcast_dashboard_update()
    return {"message": "Donation deleted"}


@router.get("/events/{event_id}/donations/{donation_id}/receipt", tags=["Donations"])
def get_donation_receipt(event_id: str, donation_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Fetch the receipt image securely."""
    verify_membership(db, event_id, user_id)
    donation = db.query(models.Donation).filter_by(id=donation_id, event_id=event_id).first()
    if not donation or not donation.receipt_key:
        raise HTTPException(status_code=404, detail="Receipt not found")
        
    s3_bucket = os.getenv("RECEIPTS_BUCKET")
    if not s3_bucket or donation.receipt_key.startswith("local://"):
        # Local fallback
        local_path = donation.receipt_key.replace("local://", "")
        # Construct absolute path to backend/uploads
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        abs_local_path = os.path.join(base_dir, local_path)
        if not os.path.exists(abs_local_path):
            raise HTTPException(status_code=404, detail="Receipt image not found on local disk")
        from fastapi.responses import FileResponse
        return FileResponse(abs_local_path)
        
    try:
        s3_client = boto3.client('s3')
        obj = s3_client.get_object(Bucket=s3_bucket, Key=donation.receipt_key)
        from fastapi.responses import StreamingResponse
        return StreamingResponse(obj['Body'], media_type=obj['ContentType'])
    except Exception as e:
        print(f"Failed to fetch receipt from S3: {e}")
        raise HTTPException(status_code=404, detail="Receipt image not found in storage")


@router.post("/events/{event_id}/donations/{donation_id}/receipt", tags=["Donations"])
async def upload_donation_receipt_manual(event_id: str, donation_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Manually upload a receipt for a donation."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    donation = db.query(models.Donation).filter_by(id=donation_id, event_id=event_id).first()
    if not donation:
        raise HTTPException(status_code=404, detail="Donation not found")
    if member.role != models.UserRole.organizer and donation.collected_by != user_id:
        raise HTTPException(status_code=403, detail="You can only upload receipts for your own entries")
        
    try:
        contents = await file.read()
        receipt_key = storage_service.upload_receipt(event_id, contents, file.content_type)
        donation.receipt_key = receipt_key
        db.commit()
        await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "receipt_upload"})
        return {"receipt_key": receipt_key, "message": "Receipt uploaded successfully"}
    except Exception as e:
        print(f"Failed to upload manual receipt: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload receipt")


#  EXPENSES 
@router.get("/events/{event_id}/expenses", response_model=List[schemas.ExpenseResponse], tags=["Expenses"])
def get_event_expenses(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all expenses. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_expenses(db, event_id)


@router.post("/events/{event_id}/expenses", response_model=schemas.ExpenseResponse, tags=["Expenses"])
async def add_expense(event_id: str, expense: schemas.ExpenseCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Add a new expense row. Blocked if restricted or event deactivated."""
    verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    verify_rate_limit(f"user:{user_id}:add_entry", limit=30, window=60, detail="Adding entries too fast. Slow down.")
    res = crud.create_expense(db, event_id, user_id, expense)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_add"})
    await manager.broadcast_dashboard_update()
    return res


@router.put("/events/{event_id}/expenses/{expense_id}", response_model=schemas.ExpenseResponse, tags=["Expenses"])
async def update_expense(event_id: str, expense_id: int, data: schemas.ExpenseUpdate,
                   db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit an expense row. Organizer can edit any. Collector can only edit their own."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    expense = crud.get_expense(db, expense_id)
    if not expense or expense["event_id"] != event_id:
        raise HTTPException(status_code=404, detail="Expense not found in this event")
    if member.role != models.UserRole.organizer and expense["collected_by"] != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own entries")
    res = crud.update_expense(db, expense_id, data)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_update"})
    await manager.broadcast_dashboard_update()
    return res


@router.delete("/events/{event_id}/expenses/{expense_id}", tags=["Expenses"])
async def delete_expense(event_id: str, expense_id: int,
                   db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Delete an expense row. Organizer can delete any. Collector can only delete their own."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    expense = crud.get_expense(db, expense_id)
    if not expense or expense["event_id"] != event_id:
        raise HTTPException(status_code=404, detail="Expense not found in this event")
    if member.role != models.UserRole.organizer and expense["collected_by"] != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own entries")
    crud.delete_expense(db, expense_id)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_delete"})
    await manager.broadcast_dashboard_update()
    return {"message": "Expense deleted"}


@router.get("/events/{event_id}/expenses/{expense_id}/receipt", tags=["Expenses"])
def get_expense_receipt(event_id: str, expense_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Fetch the receipt image securely."""
    verify_membership(db, event_id, user_id)
    expense = db.query(models.Expense).filter_by(id=expense_id, event_id=event_id).first()
    if not expense or not expense.receipt_key:
        raise HTTPException(status_code=404, detail="Receipt not found")
        
    s3_bucket = os.getenv("RECEIPTS_BUCKET")
    if not s3_bucket or expense.receipt_key.startswith("local://"):
        local_path = expense.receipt_key.replace("local://", "")
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        abs_local_path = os.path.join(base_dir, local_path)
        if not os.path.exists(abs_local_path):
            raise HTTPException(status_code=404, detail="Receipt image not found locally")
        from fastapi.responses import FileResponse
        return FileResponse(abs_local_path)
        
    try:
        s3_client = boto3.client('s3')
        obj = s3_client.get_object(Bucket=s3_bucket, Key=expense.receipt_key)
        from fastapi.responses import StreamingResponse
        return StreamingResponse(obj['Body'], media_type=obj['ContentType'])
    except Exception as e:
        print(f"Failed to fetch expense receipt from S3: {e}")
        raise HTTPException(status_code=404, detail="Receipt image not found in storage")


@router.post("/events/{event_id}/expenses/{expense_id}/receipt", tags=["Expenses"])
async def upload_expense_receipt_manual(event_id: str, expense_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Manually upload a receipt for an expense."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    expense = db.query(models.Expense).filter_by(id=expense_id, event_id=event_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if member.role != models.UserRole.organizer and expense.collected_by != user_id:
        raise HTTPException(status_code=403, detail="You can only upload receipts for your own entries")
        
    try:
        contents = await file.read()
        receipt_key = storage_service.upload_receipt(event_id, contents, file.content_type)
        expense.receipt_key = receipt_key
        db.commit()
        await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_receipt_upload"})
        return {"receipt_key": receipt_key, "message": "Receipt uploaded successfully"}
    except Exception as e:
        print(f"Failed to upload expense manual receipt: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload receipt")


#  SUMMARY 
@router.get("/events/{event_id}/summary", response_model=schemas.EventSummaryResponse, tags=["Summary"])
def get_event_summary(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Financial overview. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_event_summary(db, event_id)


@router.get("/events/{event_id}/full-details", response_model=schemas.EventFullDetailsResponse, tags=["Events"])
def get_event_full_details(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """The 'Big Bang' request. Returns everything for an event in one call. Highly optimized with caching."""
    member = verify_membership(db, event_id, user_id)
    
    # If visitor, record in history
    if not member:
        crud.add_watched_event(db, user_id, event_id)
    
    res = crud.get_event_full_details(db, event_id, user_id)
    
    if not res:
        raise HTTPException(status_code=404, detail="Event not found")
        
    return res
