"""
Agents API — CRUD, product association, phone number management.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from backend.database import get_db
from backend.models import Agent, Product, PhoneNumber, agent_products
from backend.auth.dependencies import get_current_user, require_admin

router = APIRouter(prefix="/api/agents", tags=["Agents"])


# ── Schemas ───────────────────────────────────────────
class AgentCreate(BaseModel):
    name: str
    system_prompt: str = ""
    personality: str = "professional"
    language: str = "es"
    temperature: float = 0.7
    max_tokens: int = 1024
    welcome_message: str = "¡Hola! ¿En qué puedo ayudarte?"
    escalation_rules: str = ""


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    personality: Optional[str] = None
    language: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    welcome_message: Optional[str] = None
    escalation_rules: Optional[str] = None
    is_active: Optional[bool] = None


class PhoneNumberSchema(BaseModel):
    id: int
    phone_number: str
    label: str
    is_active: bool

    class Config:
        from_attributes = True


class ProductMinimal(BaseModel):
    id: int
    name: str
    category: str

    class Config:
        from_attributes = True


class AgentResponse(BaseModel):
    id: int
    name: str
    system_prompt: str
    personality: str
    language: str
    temperature: float
    max_tokens: int
    welcome_message: str
    escalation_rules: str
    is_active: bool
    created_at: str
    products: List[ProductMinimal] = []
    phone_numbers: List[PhoneNumberSchema] = []

    class Config:
        from_attributes = True


class AssociateProductsRequest(BaseModel):
    product_ids: List[int]


class AddPhoneRequest(BaseModel):
    phone_number: str
    label: str = ""


# ── Routes ────────────────────────────────────────────
@router.get("/", response_model=List[AgentResponse])
def list_agents(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    agents = db.query(Agent).options(
        joinedload(Agent.products), joinedload(Agent.phone_numbers)
    ).all()
    return _serialize_agents(agents)


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    agent = db.query(Agent).options(
        joinedload(Agent.products), joinedload(Agent.phone_numbers)
    ).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return _serialize_agent(agent)


@router.post("/", response_model=AgentResponse, status_code=201)
def create_agent(body: AgentCreate, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    agent = Agent(**body.model_dump())
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return _serialize_agent(agent)


@router.put("/{agent_id}", response_model=AgentResponse)
def update_agent(agent_id: int, body: AgentUpdate, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(agent, field, value)
    db.commit()
    db.refresh(agent)
    return _serialize_agent(agent)


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    db.delete(agent)
    db.commit()


# ── Product Association ───────────────────────────────
@router.post("/{agent_id}/products", response_model=AgentResponse)
def associate_products(
    agent_id: int,
    body: AssociateProductsRequest,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    agent = db.query(Agent).options(joinedload(Agent.products)).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    products = db.query(Product).filter(Product.id.in_(body.product_ids)).all()
    agent.products = products
    db.commit()
    db.refresh(agent)
    return _serialize_agent(agent)


# ── Phone Number Management ──────────────────────────
@router.post("/{agent_id}/phones", response_model=PhoneNumberSchema, status_code=201)
def add_phone_number(
    agent_id: int,
    body: AddPhoneRequest,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    existing = db.query(PhoneNumber).filter(PhoneNumber.phone_number == body.phone_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already registered")

    phone = PhoneNumber(phone_number=body.phone_number, agent_id=agent_id, label=body.label)
    db.add(phone)
    db.commit()
    db.refresh(phone)
    return phone


@router.delete("/phones/{phone_id}", status_code=204)
def remove_phone_number(phone_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    phone = db.query(PhoneNumber).filter(PhoneNumber.id == phone_id).first()
    if not phone:
        raise HTTPException(status_code=404, detail="Phone number not found")
    db.delete(phone)
    db.commit()


# ── Serialization Helpers ─────────────────────────────
def _serialize_agent(agent: Agent) -> dict:
    return {
        "id": agent.id, "name": agent.name, "system_prompt": agent.system_prompt,
        "personality": agent.personality, "language": agent.language,
        "temperature": agent.temperature, "max_tokens": agent.max_tokens,
        "welcome_message": agent.welcome_message, "escalation_rules": agent.escalation_rules,
        "is_active": agent.is_active,
        "created_at": agent.created_at.isoformat() if agent.created_at else "",
        "products": [{"id": p.id, "name": p.name, "category": p.category} for p in agent.products],
        "phone_numbers": [{"id": pn.id, "phone_number": pn.phone_number,
                           "label": pn.label, "is_active": pn.is_active} for pn in agent.phone_numbers],
    }


def _serialize_agents(agents: list) -> list:
    return [_serialize_agent(a) for a in agents]
