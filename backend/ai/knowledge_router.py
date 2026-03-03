"""
Knowledge management API — rebuild indexes and add manual knowledge.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Agent
from backend.auth.dependencies import require_admin
from backend.ai.rag import rebuild_agent_knowledge, index_manual_knowledge

router = APIRouter(prefix="/api/knowledge", tags=["Knowledge"])


class ManualKnowledgeRequest(BaseModel):
    text: str


@router.post("/{agent_id}/rebuild", status_code=200)
def rebuild_knowledge(agent_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    """Re-index all products for an agent. Call after product changes."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    try:
        rebuild_agent_knowledge(db, agent_id)
        return {"status": "ok", "message": f"Knowledge rebuilt for agent '{agent.name}'"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rebuild failed: {str(e)}")


@router.post("/{agent_id}/manual", status_code=201)
def add_manual_knowledge(
    agent_id: int,
    body: ManualKnowledgeRequest,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Add custom knowledge text to an agent."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    try:
        index_manual_knowledge(db, agent_id, body.text)
        return {"status": "ok", "message": "Manual knowledge added"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")
