"""
Embedding generation and cosine similarity for RAG.
"""
import numpy as np
from typing import List, Optional
from openai import OpenAI

from backend.config import OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL

_client: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=OPENAI_API_KEY)
    return _client


def generate_embedding(text: str) -> np.ndarray:
    """Generate an embedding vector for a text string."""
    client = _get_client()
    response = client.embeddings.create(
        model=OPENAI_EMBEDDING_MODEL,
        input=text.strip()[:8000],  # limit input size
    )
    return np.array(response.data[0].embedding, dtype=np.float32)


def generate_embeddings_batch(texts: List[str]) -> List[np.ndarray]:
    """Generate embeddings for multiple texts in one API call."""
    client = _get_client()
    cleaned = [t.strip()[:8000] for t in texts]
    response = client.embeddings.create(
        model=OPENAI_EMBEDDING_MODEL,
        input=cleaned,
    )
    return [np.array(d.embedding, dtype=np.float32) for d in response.data]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


def embedding_to_bytes(embedding: np.ndarray) -> bytes:
    """Convert numpy array to bytes for DB storage."""
    return embedding.tobytes()


def bytes_to_embedding(data: bytes) -> np.ndarray:
    """Convert bytes back to numpy array."""
    return np.frombuffer(data, dtype=np.float32)
