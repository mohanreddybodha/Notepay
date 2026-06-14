import os, base64, json
from groq import Groq
import boto3

image_path = 'C:/Users/bodha/.gemini/antigravity-ide/brain/7298972d-8c5d-4d7b-9bfc-97eb315843bd/media__1781445098759.jpg'
with open(image_path, 'rb') as f:
    img_b64 = base64.b64encode(f.read()).decode('utf-8')

prompt = '''You are analyzing an Indian UPI payment receipt screenshot. Extract these 5 fields:
  1. amount: The payment amount in INR as a number (e.g., 10.00, 110.00)
  2. sender_name: The person who SENT the money (the payer)
  3. receiver_name: The person or business who RECEIVED the money (the payee)
  4. transaction_date: The date in YYYY-MM-DD format
  5. status: "success" if this is a successful payment receipt, "failed" if the screenshot shows a failed or pending transaction, "unrelated_image" if the image is NOT a payment receipt (e.g., selfie, scenery, random text).
  
  GENERAL RULES:
  - receiver_name: Look for "Banking Name", "Paid to", "To", "Transfer to", "Merchant", "Beneficiary"
  - sender_name: Look for "From", "Debited from", "Paid by", "Your name" - must be a PERSON NAME not bank name
  - If sender_name is NOT clearly and explicitly written on the screen, return null for sender_name - DO NOT guess or hallucinate a name!
  - NEVER confuse sender and receiver
  - transaction_date: Look for dates near "Transaction", time stamps at top of screen (e.g., "04:44 pm on 12 Jun 2026" -> "2026-06-12")
  - Transaction Successful Rule: You MUST detect words or messages indicating a successful payment completion (like "Success", "Paid", "Payment Successful", "Transaction Complete", or any other clear success indicator). However, if the screenshot shows "Pending", "Processing", or "Failed", you MUST immediately set status to "failed" and return.
  
  Return ONLY valid JSON:
  {"amount": 10.00, "sender_name": null, "receiver_name": "Boda Mohan Reddy", "transaction_date": "2026-06-12", "status": "success"}'''

# Force credential bypass for local testing if we can't get it from SSM, just print what we need to see.
# I'll just use my own code to debug the LLM's response.
