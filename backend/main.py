"""
FastAPI application entry point.
"""
import os
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.database import engine, Base
from backend.config import UPLOAD_DIR

# Import routers
from backend.auth.router import router as auth_router
from backend.products.router import router as products_router
from backend.agents.router import router as agents_router
from backend.whatsapp.router import router as whatsapp_router
from backend.conversations.router import router as conversations_router
from backend.ai.knowledge_router import router as knowledge_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

# Create tables
Base.metadata.create_all(bind=engine)

# Create upload directories
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Initialize app
app = FastAPI(
    title="Multi-Agent AI Platform",
    description="Dashboard for managing AI sales agents connected to WhatsApp",
    version="1.0.0",
)

# CORS — allow frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving for uploads
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Mount routers
app.include_router(auth_router)
app.include_router(products_router)
app.include_router(agents_router)
app.include_router(whatsapp_router)
app.include_router(conversations_router)
app.include_router(knowledge_router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "Multi-Agent AI Platform"}
