from __future__ import annotations

import hashlib
import math
import os
import re
from functools import lru_cache
from typing import Any


EMBEDDING_DIMENSIONS = 384
HASH_PROVIDER = "hash-384"
MINILM_PROVIDER = "minilm"
DEFAULT_MINILM_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vec)) or 1.0
    return [value / norm for value in vec]


def _bucket(token: str, dimensions: int) -> int:
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "little") % dimensions


@lru_cache(maxsize=1)
def _minilm_model() -> Any | None:
    provider = os.getenv("AI_EDITOR_EMBEDDING_PROVIDER", "auto").lower()
    if provider == "hash":
        return None

    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except Exception:
        if provider == "minilm":
            raise
        return None

    model_name = os.getenv("AI_EDITOR_MINILM_MODEL", DEFAULT_MINILM_MODEL)
    local_only = os.getenv("AI_EDITOR_MINILM_LOCAL_ONLY", "true").lower() not in {"0", "false", "no"}
    try:
        return SentenceTransformer(model_name, local_files_only=local_only)
    except Exception:
        if provider == "minilm":
            raise
        return None


def embedding_provider() -> str:
    return MINILM_PROVIDER if _minilm_model() is not None else HASH_PROVIDER


def _hash_embed_text(text: str, dimensions: int = EMBEDDING_DIMENSIONS) -> list[float]:
    vec = [0.0] * dimensions
    tokens = re.findall(r"[a-zA-Z0-9_]+", text.lower())
    for token in tokens:
        vec[_bucket(token, dimensions)] += 1.0
    return _normalize(vec)


def embed_text(text: str, dimensions: int = EMBEDDING_DIMENSIONS) -> list[float]:
    """Return a normalized embedding vector.

    This keeps the MVP air-gap friendly without requiring a large embedding model
    download. If sentence-transformers + MiniLM are available, that model is used;
    otherwise the hashing vectorizer remains the fallback.
    """

    model = _minilm_model()
    if model is not None:
        vector = model.encode(text, normalize_embeddings=True)
        return [float(value) for value in vector.tolist()]
    return _hash_embed_text(text, dimensions)


def embed_record(text: str) -> dict[str, Any]:
    return {"provider": embedding_provider(), "vector": embed_text(text)}


def parse_embedding_record(value: Any) -> tuple[str, list[float]]:
    if isinstance(value, dict):
        provider = str(value.get("provider") or HASH_PROVIDER)
        vector = value.get("vector") or []
        return provider, [float(item) for item in vector]
    if isinstance(value, list):
        return HASH_PROVIDER, [float(item) for item in value]
    return HASH_PROVIDER, []
