from __future__ import annotations

import re
import time
from dataclasses import dataclass

from .audit import write_audit


PII_PATTERNS = [
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
]


@dataclass
class ModelProfile:
    model_id: str
    provider: str
    max_context_tokens: int


MODEL_PROFILES = {
    "llama3.1-local": ModelProfile("llama3.1-local", "ollama", 8192),
    "mistral-7b-local": ModelProfile("mistral-7b-local", "ollama", 8192),
    "mock-local": ModelProfile("mock-local", "mock", 4096),
}

_ACTIVE_MODEL = "mock-local"


def sanitize_pii(text: str) -> str:
    out = text
    for pattern in PII_PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    return out


def list_profiles() -> list[dict]:
    return [vars(profile) for profile in MODEL_PROFILES.values()]


def set_active_model(model_id: str) -> dict:
    global _ACTIVE_MODEL
    if model_id not in MODEL_PROFILES:
        raise ValueError(f"Unknown model: {model_id}")
    _ACTIVE_MODEL = model_id
    return {"active_model": _ACTIVE_MODEL}


def generate_answer(prompt: str, request_id: str) -> dict:
    safe_prompt = sanitize_pii(prompt)
    start = time.perf_counter()

    answer = (
        "Local runtime response from "
        f"{_ACTIVE_MODEL}: based on retrieved context, {safe_prompt[:400]}"
    )

    elapsed_s = max(time.perf_counter() - start, 1e-3)
    tokens_est = max(1, len(answer.split()))
    speed = tokens_est / elapsed_s

    write_audit(
        "ai_request",
        {
            "request_id": request_id,
            "model": _ACTIVE_MODEL,
            "prompt_chars": len(safe_prompt),
            "token_generation_speed": speed,
        },
    )
    return {"answer": answer, "token_generation_speed": speed, "model": _ACTIVE_MODEL}
