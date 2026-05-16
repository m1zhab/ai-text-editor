from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.api.routes.documents import DOCUMENT_STORE
from backend.services.inference import generate_answer, list_profiles, set_active_model

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    document_id: str
    message: str
    top_k: int = 4


class SwitchModelRequest(BaseModel):
    model_id: str


@router.get("/models/profiles")
def model_profiles() -> dict:
    return {"profiles": list_profiles()}


@router.post("/models/switch")
def switch_model(req: SwitchModelRequest) -> dict:
    try:
        return set_active_model(req.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/chat")
def chat(req: ChatRequest) -> dict:
    if req.document_id not in DOCUMENT_STORE:
        raise HTTPException(status_code=404, detail="Document not ingested")

    document = DOCUMENT_STORE[req.document_id]
    retriever = document["retriever"]

    request_id = str(uuid.uuid4())
    retrieval_start = time.perf_counter()
    matches = retriever.query(req.message, top_k=req.top_k)
    retrieval_ms = (time.perf_counter() - retrieval_start) * 1000

    context = "\n\n".join(
        f"[{m['chunk']['chunk_id']}] {m['chunk']['text']}" for m in matches
    )
    prompt = f"Question: {req.message}\n\nContext:\n{context}"
    inference_output = generate_answer(prompt, request_id=request_id)

    citations = []
    for item in matches:
        chunk = item["chunk"]
        citations.append(
            {
                "file": document["relative_path"],
                "chunk_id": chunk["chunk_id"],
                "score": item["score"],
                "start_offset": chunk["start_offset"],
                "end_offset": chunk["end_offset"],
                "page": chunk.get("page"),
            }
        )

    return {
        "final_answer": inference_output["answer"],
        "citations": citations,
        "metadata": {
            "request_id": request_id,
            "retrieval_time_ms": retrieval_ms,
            "token_generation_speed": inference_output["token_generation_speed"],
            "model": inference_output["model"],
        },
    }
