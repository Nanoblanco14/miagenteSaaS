"""
Conversations API — view and manage chat conversations.
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from backend.database import get_db
from backend.models import Conversation, Message, PhoneNumber
from backend.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/conversations", tags=["Conversations"])


# ── Schemas ───────────────────────────────────────────
class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    media_url: Optional[str] = None
    timestamp: str

    class Config:
        from_attributes = True


class ConversationResponse(BaseModel):
    id: int
    client_phone: str
    client_name: str
    status: str
    started_at: str
    last_message_at: str
    phone_label: str = ""
    agent_name: str = ""
    last_message: str = ""
    message_count: int = 0

    class Config:
        from_attributes = True


class ConversationDetail(BaseModel):
    id: int
    client_phone: str
    client_name: str
    status: str
    started_at: str
    last_message_at: str
    phone_label: str = ""
    agent_name: str = ""
    messages: List[MessageResponse] = []

    class Config:
        from_attributes = True


class UpdateConversationStatus(BaseModel):
    status: str  # active | lead | closed


# ── Routes ────────────────────────────────────────────
@router.get("/", response_model=List[ConversationResponse])
def list_conversations(
    status: Optional[str] = Query(None),
    agent_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    q = db.query(Conversation).options(
        joinedload(Conversation.phone_number).joinedload(PhoneNumber.agent),
        joinedload(Conversation.messages),
    )
    if status:
        q = q.filter(Conversation.status == status)
    if agent_id:
        q = q.join(PhoneNumber).filter(PhoneNumber.agent_id == agent_id)

    conversations = q.order_by(Conversation.last_message_at.desc()).all()

    results = []
    for conv in conversations:
        last_msg = ""
        if conv.messages:
            sorted_msgs = sorted(conv.messages, key=lambda m: m.timestamp or datetime.min)
            last_msg = sorted_msgs[-1].content if sorted_msgs else ""

        results.append({
            "id": conv.id,
            "client_phone": conv.client_phone,
            "client_name": conv.client_name,
            "status": conv.status,
            "started_at": conv.started_at.isoformat() if conv.started_at else "",
            "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else "",
            "phone_label": conv.phone_number.label if conv.phone_number else "",
            "agent_name": conv.phone_number.agent.name if conv.phone_number and conv.phone_number.agent else "",
            "last_message": last_msg[:100],
            "message_count": len(conv.messages),
        })

    return results


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    conv = db.query(Conversation).options(
        joinedload(Conversation.messages),
        joinedload(Conversation.phone_number).joinedload(PhoneNumber.agent),
    ).filter(Conversation.id == conversation_id).first()

    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    sorted_msgs = sorted(conv.messages, key=lambda m: m.timestamp or datetime.min)

    return {
        "id": conv.id,
        "client_phone": conv.client_phone,
        "client_name": conv.client_name,
        "status": conv.status,
        "started_at": conv.started_at.isoformat() if conv.started_at else "",
        "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else "",
        "phone_label": conv.phone_number.label if conv.phone_number else "",
        "agent_name": conv.phone_number.agent.name if conv.phone_number and conv.phone_number.agent else "",
        "messages": [
            {
                "id": m.id, "role": m.role, "content": m.content,
                "media_url": m.media_url,
                "timestamp": m.timestamp.isoformat() if m.timestamp else "",
            }
            for m in sorted_msgs
        ],
    }


@router.patch("/{conversation_id}/status", response_model=ConversationResponse)
def update_conversation_status(
    conversation_id: int,
    body: UpdateConversationStatus,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if body.status not in ("active", "lead", "closed"):
        raise HTTPException(status_code=400, detail="Invalid status")

    conv.status = body.status
    db.commit()
    db.refresh(conv)

    return {
        "id": conv.id,
        "client_phone": conv.client_phone,
        "client_name": conv.client_name,
        "status": conv.status,
        "started_at": conv.started_at.isoformat() if conv.started_at else "",
        "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else "",
        "phone_label": "", "agent_name": "",
        "last_message": "", "message_count": 0,
    }


@router.get("/stats/summary")
def conversation_stats(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Return quick stats for the dashboard."""
    total = db.query(Conversation).count()
    active = db.query(Conversation).filter(Conversation.status == "active").count()
    leads = db.query(Conversation).filter(Conversation.status == "lead").count()
    closed = db.query(Conversation).filter(Conversation.status == "closed").count()
    total_messages = db.query(Message).count()

    return {
        "total_conversations": total,
        "active": active,
        "leads": leads,
        "closed": closed,
        "total_messages": total_messages,
    }
