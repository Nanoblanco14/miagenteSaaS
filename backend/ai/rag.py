"""
RAG (Retrieval-Augmented Generation) pipeline.
Indexes product data into knowledge chunks and retrieves relevant ones per query.
"""
from typing import List, Tuple
from sqlalchemy.orm import Session

from backend.models import KnowledgeChunk, Product, ProductFile, Agent
from backend.ai.embeddings import (
    generate_embedding, generate_embeddings_batch,
    cosine_similarity, embedding_to_bytes, bytes_to_embedding,
)
from backend.config import RAG_TOP_K


def index_product_for_agent(db: Session, agent_id: int, product: Product):
    """Create knowledge chunks from a product's data and embed them for an agent."""
    # Remove old chunks for this product+agent
    db.query(KnowledgeChunk).filter(
        KnowledgeChunk.agent_id == agent_id,
        KnowledgeChunk.source_type == "product",
        KnowledgeChunk.source_id == product.id,
    ).delete()

    chunks = _product_to_chunks(product)
    if not chunks:
        db.commit()
        return

    embeddings = generate_embeddings_batch(chunks)

    for text, emb in zip(chunks, embeddings):
        kc = KnowledgeChunk(
            agent_id=agent_id,
            source_type="product",
            source_id=product.id,
            content=text,
            embedding=embedding_to_bytes(emb),
        )
        db.add(kc)

    db.commit()


def index_manual_knowledge(db: Session, agent_id: int, text: str):
    """Add manually written knowledge to an agent's knowledge base."""
    embedding = generate_embedding(text)
    kc = KnowledgeChunk(
        agent_id=agent_id,
        source_type="manual",
        source_id=None,
        content=text,
        embedding=embedding_to_bytes(embedding),
    )
    db.add(kc)
    db.commit()


def rebuild_agent_knowledge(db: Session, agent_id: int):
    """Re-index all products associated with an agent."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        return

    # Keep manual chunks, remove product ones
    db.query(KnowledgeChunk).filter(
        KnowledgeChunk.agent_id == agent_id,
        KnowledgeChunk.source_type == "product",
    ).delete()
    db.commit()

    for product in agent.products:
        index_product_for_agent(db, agent_id, product)


def retrieve_relevant_chunks(
    db: Session, agent_id: int, query: str, top_k: int = RAG_TOP_K
) -> List[str]:
    """Find the top-k most relevant knowledge chunks for a query."""
    query_embedding = generate_embedding(query)

    chunks = db.query(KnowledgeChunk).filter(
        KnowledgeChunk.agent_id == agent_id,
        KnowledgeChunk.embedding.isnot(None),
    ).all()

    if not chunks:
        return []

    scored: List[Tuple[float, str]] = []
    for chunk in chunks:
        chunk_emb = bytes_to_embedding(chunk.embedding)
        score = cosine_similarity(query_embedding, chunk_emb)
        scored.append((score, chunk.content))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [text for _, text in scored[:top_k]]


def _product_to_chunks(product: Product) -> List[str]:
    """Break a product into text chunks suitable for embedding."""
    chunks = []

    # Main product info
    main_info = f"Producto: {product.name}"
    if product.category:
        main_info += f"\nCategoría: {product.category}"
    if product.price:
        main_info += f"\nPrecio: {product.price} {product.currency}"
    if product.description:
        main_info += f"\nDescripción: {product.description}"
    chunks.append(main_info)

    # Split long descriptions into smaller chunks
    if product.description and len(product.description) > 500:
        words = product.description.split()
        current_chunk = []
        current_len = 0
        for word in words:
            current_chunk.append(word)
            current_len += len(word) + 1
            if current_len >= 400:
                chunks.append(f"Detalles de {product.name}: {' '.join(current_chunk)}")
                current_chunk = []
                current_len = 0
        if current_chunk:
            chunks.append(f"Detalles de {product.name}: {' '.join(current_chunk)}")

    # File listing (agent needs to know what media exists)
    files = product.files if hasattr(product, 'files') and product.files else []
    if files:
        file_info = f"Archivos de {product.name}: "
        file_info += ", ".join([f"{f.original_name} ({f.file_type})" for f in files])
        chunks.append(file_info)

    return chunks
