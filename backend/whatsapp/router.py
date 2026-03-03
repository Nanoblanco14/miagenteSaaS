"""
WhatsApp webhook endpoint — receives messages and orchestrates AI responses.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import PhoneNumber, Conversation, Message
from backend.whatsapp.service import parse_incoming_message, send_text_message
from backend.ai.engine import generate_response, detect_lead_intent
from backend.config import WHATSAPP_VERIFY_TOKEN

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/whatsapp", tags=["WhatsApp"])


@router.get("/webhook")
def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
):
    """Meta webhook verification (GET)."""
    if hub_mode == "subscribe" and hub_verify_token == WHATSAPP_VERIFY_TOKEN:
        return int(hub_challenge) if hub_challenge else ""
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/webhook")
async def handle_webhook(request: Request, db: Session = Depends(get_db)):
    """Handle incoming WhatsApp messages (POST)."""
    body = await request.json()

    parsed = parse_incoming_message(body)
    if not parsed:
        return {"status": "no_message"}

    from_number = parsed["from_number"]
    message_text = parsed["message_text"]
    contact_name = parsed["contact_name"]

    if not from_number or not message_text:
        return {"status": "empty_message"}

    # Find which phone number (and thus which agent) should handle this
    # We look at all active phone numbers to find the matching agent
    phone_numbers = db.query(PhoneNumber).filter(PhoneNumber.is_active == True).all()
    if not phone_numbers:
        logger.warning("No active phone numbers configured")
        return {"status": "no_agent"}

    # Use the first active phone number's agent (in production, route by the 'to' number)
    phone_entry = phone_numbers[0]
    agent = phone_entry.agent

    if not agent or not agent.is_active:
        logger.warning(f"No active agent for phone {phone_entry.phone_number}")
        return {"status": "no_agent"}

    # Find or create conversation
    conversation = db.query(Conversation).filter(
        Conversation.phone_number_id == phone_entry.id,
        Conversation.client_phone == from_number,
        Conversation.status != "closed",
    ).first()

    if not conversation:
        conversation = Conversation(
            phone_number_id=phone_entry.id,
            client_phone=from_number,
            client_name=contact_name,
            status="active",
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    # Store incoming message
    user_msg = Message(
        conversation_id=conversation.id,
        role="user",
        content=message_text,
    )
    db.add(user_msg)
    db.commit()

    # Detect lead intent and update conversation status
    if detect_lead_intent(message_text) and conversation.status == "active":
        conversation.status = "lead"

    conversation.last_message_at = datetime.now(timezone.utc)
    if contact_name and not conversation.client_name:
        conversation.client_name = contact_name

    # Generate AI response
    try:
        ai_response = generate_response(db, agent, conversation, message_text)
    except Exception as e:
        logger.error(f"AI engine error: {e}")
        ai_response = agent.welcome_message or "Lo siento, hubo un error. Por favor intenta de nuevo."

    # Store AI response
    assistant_msg = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=ai_response,
    )
    db.add(assistant_msg)
    db.commit()

    # Send reply via WhatsApp
    try:
        await send_text_message(from_number, ai_response)
    except Exception as e:
        logger.error(f"WhatsApp send error: {e}")

    return {"status": "ok"}
