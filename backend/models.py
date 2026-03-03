"""
SQLAlchemy ORM models for the entire platform.
"""
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Text, Float, Boolean, DateTime,
    ForeignKey, LargeBinary, Table
)
from sqlalchemy.orm import relationship
from backend.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


# ── Many-to-Many: Agents ↔ Products ──────────────────────────────────────
agent_products = Table(
    "agent_products",
    Base.metadata,
    Column("agent_id", Integer, ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True),
    Column("product_id", Integer, ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
)


# ── Users ─────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), default="")
    role = Column(String(20), default="admin")  # admin | user
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)


# ── Products ──────────────────────────────────────────────────────────────
class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    category = Column(String(100), default="General")
    price = Column(Float, nullable=True)
    currency = Column(String(10), default="USD")
    status = Column(String(20), default="active")   # active | inactive
    metadata_json = Column(Text, default="{}")       # flexible extra fields
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    files = relationship("ProductFile", back_populates="product", cascade="all, delete-orphan")
    agents = relationship("Agent", secondary=agent_products, back_populates="products")


# ── Product Files (images, PDFs, docs) ────────────────────────────────────
class ProductFile(Base):
    __tablename__ = "product_files"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    file_type = Column(String(20), default="image")  # image | pdf | document
    file_path = Column(String(500), nullable=False)
    original_name = Column(String(255), default="")
    display_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=_utcnow)

    product = relationship("Product", back_populates="files")


# ── Agents ────────────────────────────────────────────────────────────────
class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    system_prompt = Column(Text, default="")
    personality = Column(String(50), default="professional")  # professional | casual | friendly
    language = Column(String(10), default="es")
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, default=1024)
    welcome_message = Column(Text, default="¡Hola! ¿En qué puedo ayudarte?")
    escalation_rules = Column(Text, default="")  # when to hand off to human
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    products = relationship("Product", secondary=agent_products, back_populates="agents")
    phone_numbers = relationship("PhoneNumber", back_populates="agent")


# ── Phone Numbers ─────────────────────────────────────────────────────────
class PhoneNumber(Base):
    __tablename__ = "phone_numbers"

    id = Column(Integer, primary_key=True, index=True)
    phone_number = Column(String(20), unique=True, nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    label = Column(String(100), default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)

    agent = relationship("Agent", back_populates="phone_numbers")
    conversations = relationship("Conversation", back_populates="phone_number")


# ── Conversations ─────────────────────────────────────────────────────────
class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    phone_number_id = Column(Integer, ForeignKey("phone_numbers.id", ondelete="CASCADE"), nullable=False)
    client_phone = Column(String(20), nullable=False, index=True)
    client_name = Column(String(255), default="")
    status = Column(String(20), default="active")  # active | lead | closed
    started_at = Column(DateTime, default=_utcnow)
    last_message_at = Column(DateTime, default=_utcnow)

    phone_number = relationship("PhoneNumber", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")


# ── Messages ──────────────────────────────────────────────────────────────
class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)  # user | assistant | system
    content = Column(Text, default="")
    media_url = Column(String(500), nullable=True)
    timestamp = Column(DateTime, default=_utcnow)

    conversation = relationship("Conversation", back_populates="messages")


# ── Knowledge Chunks (for RAG) ────────────────────────────────────────────
class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    source_type = Column(String(20), default="product")  # product | manual
    source_id = Column(Integer, nullable=True)  # product_id if source_type == product
    content = Column(Text, nullable=False)
    embedding = Column(LargeBinary, nullable=True)  # numpy array as bytes
    created_at = Column(DateTime, default=_utcnow)
