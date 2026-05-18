from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Iterator
from urllib.error import URLError
from urllib.request import Request, urlopen

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
    profile_name: str
    ollama_model: str
    ollama_fallback_models: tuple[str, ...] = ()


MODEL_PROFILES = {
    "qwen2.5-3b-instruct-q4_k_m": ModelProfile(
        model_id="qwen2.5-3b-instruct-q4_k_m",
        provider="ollama",
        max_context_tokens=8192,
        profile_name="Qwen2.5-3B",
        ollama_model=os.getenv("OLLAMA_MODEL", "qwen2.5-3b-local"),
        ollama_fallback_models=("qwen2.5:3b", "qwen25-3b-local"),
    ),
}

_ACTIVE_MODEL = "qwen2.5-3b-instruct-q4_k_m"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def sanitize_pii(text: str) -> str:
    out = text
    for pattern in PII_PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    return out


def list_profiles() -> list[dict]:
    return [
        {
            "profileName": profile.profile_name,
            "modelId": profile.model_id,
            "provider": profile.provider,
            "maxContextTokens": profile.max_context_tokens,
            "ollamaModel": profile.ollama_model,
        }
        for profile in MODEL_PROFILES.values()
    ]


def set_active_model(model_id: str) -> dict:
    global _ACTIVE_MODEL
    if model_id not in MODEL_PROFILES:
        raise ValueError(f"Unknown model: {model_id}")
    _ACTIVE_MODEL = model_id
    return {"active_model": _ACTIVE_MODEL}


def _fallback_answer(prompt: str) -> str:
    if "Improve the selected editor text" in prompt or "Improve the writing" in prompt:
        marker = "Selected text:" if "Selected text:" in prompt else "Text:"
        text = prompt.split(marker, 1)[-1].strip()
        return re.sub(r"\s+", " ", text).strip()
    if "Summarize" in prompt or "summary text" in prompt:
        marker = "Selected text:" if "Selected text:" in prompt else "Text:"
        text = prompt.split(marker, 1)[-1].strip()
        words = text.split()
        return " ".join(words[:45]) + ("..." if len(words) > 45 else "")
    if "Reference chunks:" in prompt:
        context = prompt.split("Reference chunks:", 1)[-1].split("Question:", 1)[0].strip()
        excerpt = context[:900].strip()
        return f"Based on the uploaded references, the most relevant information is:\n\n{excerpt}"
    return prompt[:900]


def _ollama_payload(model_name: str, profile: ModelProfile, prompt: str, stream: bool) -> dict:
    return {
        "model": model_name,
        "prompt": prompt,
        "stream": stream,
        "options": {
            "num_ctx": profile.max_context_tokens,
            "num_predict": 768,
            "temperature": 0.4,
        },
    }


def _ollama_generate_model(model_name: str, profile: ModelProfile, prompt: str) -> str:
    payload = {
        **_ollama_payload(model_name, profile, prompt, stream=False),
    }
    request = Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        body = json.loads(response.read().decode("utf-8"))
    return str(body.get("response") or "").strip()


def _ollama_stream_model(model_name: str, profile: ModelProfile, prompt: str) -> Iterator[str]:
    request = Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=json.dumps(_ollama_payload(model_name, profile, prompt, stream=True)).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        for raw_line in response:
            if not raw_line:
                continue
            try:
                payload = json.loads(raw_line.decode("utf-8"))
            except json.JSONDecodeError:
                continue
            token = payload.get("response")
            if token:
                yield str(token)
            if payload.get("done"):
                break


def _ollama_generate(profile: ModelProfile, prompt: str) -> str:
    errors: list[str] = []
    for model_name in dict.fromkeys((profile.ollama_model, *profile.ollama_fallback_models)):
        try:
            return _ollama_generate_model(model_name, profile, prompt)
        except (OSError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
            errors.append(f"{model_name}: {exc}")
    raise RuntimeError("; ".join(errors) or "Ollama generation failed")


def _ollama_stream(profile: ModelProfile, prompt: str) -> Iterator[str]:
    errors: list[str] = []
    for model_name in dict.fromkeys((profile.ollama_model, *profile.ollama_fallback_models)):
        try:
            yielded = False
            for token in _ollama_stream_model(model_name, profile, prompt):
                yielded = True
                yield token
            if yielded:
                return
        except (OSError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
            errors.append(f"{model_name}: {exc}")
    raise RuntimeError("; ".join(errors) or "Ollama streaming failed")


def generate_answer(prompt: str, request_id: str, model_id: str | None = None) -> dict:
    global _ACTIVE_MODEL
    if model_id:
        set_active_model(model_id)
    safe_prompt = sanitize_pii(prompt)
    start = time.perf_counter()
    profile = MODEL_PROFILES[_ACTIVE_MODEL]
    runtime = "fallback"

    try:
        answer = _ollama_generate(profile, safe_prompt)
        runtime = "ollama"
        if not answer:
            raise RuntimeError("Ollama returned an empty response")
    except (OSError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        answer = f"{_fallback_answer(safe_prompt)}\n\n(Ollama fallback used: {exc})"

    elapsed_s = max(time.perf_counter() - start, 1e-3)
    tokens_est = max(1, len(answer.split()))
    speed = tokens_est / elapsed_s

    write_audit(
        "ai_request",
        {
            "request_id": request_id,
            "model": _ACTIVE_MODEL,
            "runtime": runtime,
            "prompt_chars": len(safe_prompt),
            "token_generation_speed": speed,
        },
    )
    return {"answer": answer, "token_generation_speed": speed, "model": _ACTIVE_MODEL, "runtime": runtime}


def stream_answer(prompt: str, request_id: str, model_id: str | None = None) -> Iterator[dict]:
    global _ACTIVE_MODEL
    if model_id:
        set_active_model(model_id)
    safe_prompt = sanitize_pii(prompt)
    profile = MODEL_PROFILES[_ACTIVE_MODEL]
    start = time.perf_counter()
    chunks: list[str] = []
    runtime = "ollama"

    try:
        for token in _ollama_stream(profile, safe_prompt):
            chunks.append(token)
            yield {"type": "delta", "text": token}
    except (OSError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        runtime = "fallback"
        fallback = f"{_fallback_answer(safe_prompt)}\n\n(Ollama fallback used: {exc})"
        chunks.append(fallback)
        yield {"type": "delta", "text": fallback}

    answer = "".join(chunks)
    elapsed_s = max(time.perf_counter() - start, 1e-3)
    tokens_est = max(1, len(answer.split()))
    speed = tokens_est / elapsed_s
    write_audit(
        "ai_request",
        {
            "request_id": request_id,
            "model": _ACTIVE_MODEL,
            "runtime": runtime,
            "prompt_chars": len(safe_prompt),
            "token_generation_speed": speed,
        },
    )
    yield {
        "type": "done",
        "text": answer,
        "metadata": {
            "request_id": request_id,
            "token_generation_speed": speed,
            "model": _ACTIVE_MODEL,
            "runtime": runtime,
        },
    }
