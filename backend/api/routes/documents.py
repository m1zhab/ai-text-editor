from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.ingestion import ingest_document
from backend.services.retrieval import LocalRetriever

router = APIRouter(tags=["documents"])

DOCUMENT_STORE: dict[str, dict] = {}


class IngestRequest(BaseModel):
    user_id: str
    relative_path: str


@router.post("/documents/ingest")
def ingest(req: IngestRequest) -> dict:
    file_path, chunks = ingest_document(req.user_id, req.relative_path)
    doc_id = f"{req.user_id}:{req.relative_path}"
    retriever = LocalRetriever(chunks)
    DOCUMENT_STORE[doc_id] = {
        "user_id": req.user_id,
        "relative_path": req.relative_path,
        "file_path": file_path,
        "chunks": chunks,
        "retriever": retriever,
    }
    return {
        "document_id": doc_id,
        "file": file_path,
        "chunks_indexed": len(chunks),
        "retrieval_strategy": retriever.strategy,
    }
