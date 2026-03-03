"""
Core AI Engine — builds context, calls GPT-4o, manages conversation intelligence.
"""
from typing import List, Optional
from openai import OpenAI
from sqlalchemy.orm import Session

from backend.models import Agent, Conversation, Message
from backend.ai.rag import retrieve_relevant_chunks
from backend.config import (
    OPENAI_API_KEY, OPENAI_MODEL,
    DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS,
    CONVERSATION_MEMORY_LIMIT,
)

_client: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=OPENAI_API_KEY)
    return _client


def generate_response(
    db: Session,
    agent: Agent,
    conversation: Conversation,
    user_message: str,
) -> str:
    """
    Generate an AI response given an agent, conversation history, and user message.
    Uses RAG to inject relevant product knowledge.
    """
    client = _get_client()

    # 1. Retrieve relevant product knowledge via RAG
    knowledge_chunks = retrieve_relevant_chunks(db, agent.id, user_message)
    knowledge_context = ""
    if knowledge_chunks:
        knowledge_context = "\n\n--- CONOCIMIENTO DE PRODUCTOS ---\n"
        knowledge_context += "\n---\n".join(knowledge_chunks)
        knowledge_context += "\n--- FIN CONOCIMIENTO ---\n"

    # 2. Build system prompt
    system_prompt = _build_system_prompt(agent, knowledge_context)

    # 3. Build message history
    messages = _build_messages(db, conversation, system_prompt, user_message)

    # 4. Call GPT-4o
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        temperature=agent.temperature or DEFAULT_TEMPERATURE,
        max_tokens=agent.max_tokens or DEFAULT_MAX_TOKENS,
    )

    return response.choices[0].message.content or ""


def _build_system_prompt(agent: Agent, knowledge_context: str) -> str:
    """Build the complete system prompt for this agent."""

    base_prompt = f"""Eres un asistente de ventas AI llamado "{agent.name}".
Tu personalidad es: {agent.personality}.
Idioma principal: {agent.language}.

INSTRUCCIONES BASE:
{agent.system_prompt}

REGLAS DE COMPORTAMIENTO:
1. Sé amable, profesional y orientado a la venta sin ser agresivo.
2. Responde siempre en el idioma del cliente (si te escriben en inglés, responde en inglés).
3. Usa la información de productos que tienes disponible para responder preguntas.
4. Si no tienes información sobre algo, sé honesto y ofrece conectar con un humano.
5. Detecta señales de compra (preguntas sobre precios, disponibilidad, visitas).
6. Usa emojis con moderación para hacer la conversación más cálida.
7. Mantén tus respuestas concisas (máximo 3-4 párrafos en WhatsApp).
8. Cuando un cliente muestre alto interés, sugiere agendar una visita o llamada.
9. Nunca inventes información que no tengas en tu base de conocimiento.
10. Formatea las respuestas de forma clara: usa bullets (•) para listar características.

MENSAJE DE BIENVENIDA: {agent.welcome_message}
"""

    if agent.escalation_rules:
        base_prompt += f"\nREGLAS DE ESCALACIÓN (cuándo transferir a humano):\n{agent.escalation_rules}\n"

    if knowledge_context:
        base_prompt += f"\n{knowledge_context}"

    return base_prompt


def _build_messages(
    db: Session,
    conversation: Conversation,
    system_prompt: str,
    current_message: str,
) -> List[dict]:
    """Build the OpenAI messages array with conversation history."""

    messages = [{"role": "system", "content": system_prompt}]

    # Get recent conversation history
    history = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.timestamp.desc())
        .limit(CONVERSATION_MEMORY_LIMIT)
        .all()
    )
    history.reverse()  # oldest first

    for msg in history:
        role = "user" if msg.role == "user" else "assistant"
        messages.append({"role": role, "content": msg.content})

    # Add current message
    messages.append({"role": "user", "content": current_message})

    return messages


def detect_lead_intent(message: str) -> bool:
    """Simple heuristic to detect purchase intent from a message."""
    intent_keywords = [
        "precio", "costo", "cuánto", "cuanto", "comprar", "adquirir",
        "disponible", "disponibilidad", "visitar", "visita", "agendar",
        "reservar", "interesa", "cotización", "cotizar", "presupuesto",
        "price", "cost", "buy", "purchase", "available", "visit", "schedule",
    ]
    lower = message.lower()
    return any(kw in lower for kw in intent_keywords)
