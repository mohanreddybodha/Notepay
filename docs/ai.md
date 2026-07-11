---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Artificial Intelligence Integration & Processing Pipelines

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Vision AI Receipt Parser**: [backend/routers/public.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/public.py) (Function: `extract_receipt_data_with_fallback()`)
*   **AI Chat Advisor Worker**: [backend/routers/chat.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/chat.py) (Function: `process_ai_chat()`)
*   **Chat DB Message Capper**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Function: `create_chat_message()`)

---

## 🏗️ AI Pipeline Architecture

Notepay uses a dual-provider architecture (Groq and Google Gemini) to ensure reliability and low latency:

```mermaid
graph TD
    User["Input Action (Upload Receipt / Send Message)"] --> Target{"Feature Route"}
    
    %% Receipt Path
    Target -->|Public Receipt Upload| VisionCheck["Validate Image & Size"]
    VisionCheck --> GroqVision["Groq Vision (Llama 4 Scout)"]
    GroqVision -->|Rate Limit / Timeout| GeminiVision["Gemini Vision (gemini-2.0-flash)"]
    GeminiVision -->|Failure| ManualFallback["Manual Entry Fallback"]
    
    %% Chat Path
    Target -->|@ai Chat Message| Background["FastAPI BackgroundTask"]
    Background --> Context["Build context (DB aggregates + Ledger logs)"]
    Context --> GroqText["Groq Text (Llama-3 models)"]
    GroqText -->|Rate Limit / Timeout| GeminiText["Gemini Text (gemini-2.5-flash)"]
    GeminiText -->|Failure| ErrorResponse["Error: Advisor unavailable"]
```

---

## 📷 UPI Receipt Verification Pipeline

The receipt parsing pipeline extracts transaction details from Indian UPI payment screenshots.

### 1. The Prompt System
The extraction engine passes the following system prompt along with the raw base64-encoded image:
*   **Target Fields**:
    1.  `amount`: Payment amount in INR (numeric).
    2.  `sender_name`: The payer's name. Must be a person's name (not a bank name). It must return `null` unless explicitly prefixed with labels like "From", "Paid by", or "Debited from" to prevent false matches.
    3.  `receiver_name`: The payee's name. Look for labels like "Paid to", "To", or "Transfer to".
    4.  `transaction_date`: Format as `YYYY-MM-DD`.
    5.  `status`: Set to `success`, `failed`, or `unrelated_image`.
*   **UPI App Formatting Rules**:
    *   *PhonePe*: The receiver name is found in the "Transfer to" section under "Banking Name".
    *   *Google Pay*: The receiver name is found in the "Paid to" or "To" sections. The sender name is found in the "From" or "Sender" sections.
    *   *Paytm/BHIM*: Look for "Paid To" or "Merchant" for the receiver, and "From" or "Debited" for the sender.

### 2. Context Building & Failover
*   **Vision Models**: The backend tries the Groq Vision model `meta-llama/llama-4-scout-17b-16e-instruct` first, checking multiple API keys to handle rate limits.
*   **Gemini Fallback**: If Groq fails, the pipeline calls Google's `gemini-2.0-flash` model.
*   **Reconciling Results**: If the extracted `status` is `unrelated_image` or `failed`, the payment is rejected. The extracted `receiver_name` is verified against the event's `upi_owner_name` before adding the transaction.

---

## 💬 AI Chat Advisor Pipeline

The AI Chat Advisor provides event organizers and collectors with financial insights and event planning advice.

### 1. Context Assembly
To prevent memory exhaustion and slow API calls on large events, the backend restricts the amount of transaction data sent to the AI:
*   **Collections**: Restricts to the 200 most recent contributions, sorted by date descending.
*   **Expenses**: Restricts to the 100 most recent expenses, sorted by date descending.
*   **SQL Aggregations**: Accurate financial totals (e.g., total collected, spent, and balance) are calculated using SQL aggregates (which scan the entire history) and sent along with the sample data.
*   **Members**: Injects the list of members and their roles.

### 2. Chat Prompt Constraints
The system prompt enforces strict rules on the AI's behavior:
*   **Simple Language**: Use simple, everyday language. Avoid technical financial jargon (e.g., use "money collected" instead of "fiscal liabilities").
*   **Formatting**: Use clear bullet points and the ₹ symbol for all money values.
*   **Strict Scope**: Only answer questions about the event's finances, members, or general event planning.
*   **Out-of-Scope Rejections**: If a user asks unrelated questions (e.g., coding, history) or asks how to use Notepay's technical features, the AI must reject the question and output *exactly* this message:
    > "I'm your friendly Notepay assistant for the {event_name} event! I can help you with your event's finances, members, and give you general advice for organizing your event."
*   **Length Limit**: Responses must be kept under 250 words.

---

## 🔒 Security & Throttling Guards

*   **HTML Sanitization**: All AI-generated text is run through `bleach` to strip out HTML tags, preventing stored XSS attacks if the model outputs malicious tags.
*   **Rate Limiting**: AI Chat queries are limited to 10 queries per user per event per day. If a user exceeds this limit, they receive a friendly rate limit message:
    > "Hey! You've reached your AI query limit for today. I need to take a nap! 😴"
*   **Idempotency Keys**: To prevent duplicate message submissions from slow client retries, the backend uses idempotency keys to cache and return the existing message ID if the same request is received twice.
