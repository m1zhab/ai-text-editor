from __future__ import annotations

import json
import re
import time
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from backend.api.routes.documents import DOCUMENT_STORE
from backend.services.embeddings import embedding_provider
from backend.services.inference import generate_answer, list_profiles, set_active_model, stream_answer
from backend.services.retrieval import LibraryRetriever
from backend.services.storage import DEFAULT_USER_ID, db, json_dumps, new_id, utc_now

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)

    document_id: str | None = Field(default=None, alias="documentId")
    message: str | None = None
    action: str | None = None
    selected_text: str | None = Field(default=None, alias="selectedText")
    model_id: str | None = Field(default=None, alias="modelId")
    top_k: int = Field(default=4, alias="topK")
    use_references: bool = Field(default=False, alias="useReferences")


class RetrievalQueryRequest(BaseModel):
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)

    query: str
    document_id: str | None = Field(default=None, alias="documentId")
    model_id: str | None = Field(default=None, alias="modelId")
    top_k: int = Field(default=4, alias="topK")


class SwitchModelRequest(BaseModel):
    model_config = ConfigDict(validate_by_name=True, validate_by_alias=True)

    model_id: str = Field(alias="modelId")


def _rag_requested(text: str, explicit: bool) -> bool:
    lowered = text.lower()
    cues = [
        "use uploaded",
        "uploaded documents",
        "use references",
        "using references",
        "ground response",
        "grounded in my files",
        "answer using",
        "in my files",
    ]
    return explicit or any(cue in lowered for cue in cues)


def _excerpt_for_query(text: str, query: str, max_chars: int = 420) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    terms = sorted(_query_terms(query), key=len, reverse=True)
    if not terms:
        return compact[:max_chars].strip()

    lowered = compact.lower()
    positions = [lowered.find(term) for term in terms if lowered.find(term) >= 0]
    if not positions:
        return compact[:max_chars].strip()

    center = min(positions)
    start = max(0, center - max_chars // 3)
    end = min(len(compact), start + max_chars)
    if start > 0:
        start = compact.find(" ", start)
        start = start + 1 if start >= 0 else 0
    if end < len(compact):
        end = compact.rfind(" ", start, end)
        end = end if end > start else min(len(compact), start + max_chars)
    excerpt = compact[start:end].strip()
    if start > 0:
        excerpt = f"...{excerpt}"
    if end < len(compact):
        excerpt = f"{excerpt}..."
    return excerpt


def _split_chunk_context(text: str) -> tuple[dict[str, str], str]:
    metadata: dict[str, str] = {}
    body_lines: list[str] = []
    in_prefix = True

    for line in text.splitlines():
        stripped = line.strip()
        if in_prefix and not stripped:
            continue
        if in_prefix:
            match = re.match(r"^(Document|Folder|Page|Section):\s*(.+)$", stripped)
            if match:
                metadata[match.group(1).lower()] = match.group(2).strip()
                continue
            in_prefix = False
        body_lines.append(line)

    body = "\n".join(body_lines).strip()
    return metadata, body or text


def _source_label(rank: int, citation: dict) -> str:
    parts = [f"{rank}. {citation['file']}"]
    if citation.get("page"):
        parts.append(f"page {citation['page']}")
    if citation.get("section"):
        parts.append(f"section {citation['section']}")
    return " - ".join(parts)


def _citation_from_match(index: int, item: dict, query: str = "") -> dict:
    chunk = item["chunk"]
    metadata, body = _split_chunk_context(chunk["text"])
    excerpt = _excerpt_for_query(body, query)
    return {
        "id": f"{chunk['document_id']}:{chunk['chunk_id']}",
        "sourceDocumentId": chunk["document_id"],
        "title": chunk["file_name"],
        "snippet": excerpt,
        "file": chunk["file_name"],
        "page": chunk.get("page") or metadata.get("page"),
        "section": metadata.get("section"),
        "chunk_id": chunk["chunk_id"],
        "score": item["score"],
        "excerpt": excerpt,
        "rank": index + 1,
    }


def _clean_rag_answer(answer: str) -> str:
    if "Ollama fallback used" in answer:
        return answer
    cleaned = answer.strip()
    for marker in ("Question:", "Reference chunks:"):
        if marker in cleaned:
            cleaned = cleaned.split(marker, 1)[-1].strip()
    for marker in ("Reference chunks were used", "The reference chunks were used"):
        marker_index = cleaned.find(marker)
        if marker_index > 0:
            cleaned = cleaned[:marker_index].strip()
    cleaned = re.sub(r"(?is)\bYou are answering inside a writing editor RAG chat\b.*?(?:\n\n|$)", "", cleaned).strip()
    cleaned = re.sub(r"(?is)\bUse the reference chunks only as evidence\b.*?(?:\n\n|$)", "", cleaned).strip()
    sentences = re.findall(r"[^.!?]+[.!?](?:\s|$)|[^.!?]+$", cleaned)
    if len(sentences) > 7:
        cleaned = "".join(sentences[:7]).strip()
    cleaned = _strip_repeated_paragraphs(cleaned)
    return cleaned or answer


def _strip_repeated_paragraphs(text: str) -> str:
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", text.strip()) if paragraph.strip()]
    if not paragraphs:
        return text.strip()

    result: list[str] = []
    seen: set[str] = set()
    for paragraph in paragraphs:
        key = re.sub(r"\s+", " ", paragraph).strip().lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(paragraph)
    return "\n\n".join(result)


def _clean_editor_action_response(action: str | None, answer: str) -> str:
    cleaned = re.sub(r"\n*\(Ollama fallback used:[\s\S]*?\)\s*$", "", answer).strip()
    if not cleaned:
        return ""

    if "Selected text:" in cleaned:
        cleaned = cleaned.split("Selected text:", 1)[-1].strip()

    leaked_instruction_patterns = [
        r"(?is)\bTo improve the selected editor text\b.*?(?:\.\s*|$)",
        r"(?is)\bImprove the selected editor text\b.*?(?:\.\s*|$)",
        r"(?is)\bSummarize the selected editor text\b.*?(?:\.\s*|$)",
        r"(?is)\bUse only facts and ideas present\b.*?(?:\.\s*|$)",
        r"(?is)\bReturn only (?:the )?(?:revised|summary) text\b.*?(?:\.\s*|$)",
        r"(?is)\bDo not add new (?:details|information)\b.*?(?:\.\s*|$)",
        r"(?is)\bKeep it concise and natural\b.*?(?:\.\s*|$)",
    ]
    for pattern in leaked_instruction_patterns:
        cleaned = re.sub(pattern, "", cleaned).strip()

    if action == "summarize":
        cleaned = re.sub(r"(?i)^\s*(summary|summarized version|brief summary)\s*:\s*", "", cleaned).strip()
    if action == "improve":
        cleaned = re.sub(r"(?i)^\s*(improved version|revised text|revision)\s*:\s*", "", cleaned).strip()

    return _strip_repeated_paragraphs(cleaned)


def _query_terms(text: str) -> set[str]:
    generic = {
        "a",
        "about",
        "answer",
        "be",
        "can",
        "document",
        "documents",
        "doc",
        "from",
        "given",
        "inside",
        "know",
        "let",
        "main",
        "me",
        "point",
        "provision",
        "reference",
        "references",
        "referring",
        "summarize",
        "the",
        "uploaded",
        "use",
        "using",
        "what",
    }
    return {term for term in re.findall(r"[a-zA-Z0-9_]+", text.lower()) if len(term) > 2 and term not in generic}


def _has_query_signal(query: str, citations: list[dict]) -> bool:
    terms = _query_terms(query)
    if not terms:
        return True
    haystack = " ".join(f"{citation['file']} {citation['excerpt']}" for citation in citations).lower()
    return any(term in haystack for term in terms)


def _has_indexed_chunks(document_id: str) -> bool:
    with db() as conn:
        row = conn.execute("SELECT 1 FROM chunks WHERE document_id = ? LIMIT 1", (document_id,)).fetchone()
    return row is not None


def _small_talk_answer(query: str) -> str | None:
    normalized = re.sub(r"[^a-z0-9\s]", "", query.lower()).strip()
    normalized = re.sub(r"\s+", " ", normalized)
    greetings = {
        "hello",
        "hey",
        "hi",
        "hi there",
        "hello there",
        "hey there",
        "good morning",
        "good afternoon",
        "good evening",
    }
    thanks = {"thanks", "thank you", "thx"}
    if normalized in greetings:
        return "Hi. I can help you find details in the selected reference PDF. Ask me about a topic, clause, section, or phrase you want to look up."
    if normalized in thanks:
        return "You're welcome. Ask me anything else you want to check in the selected reference PDF."
    return None


def _prepare_retrieval_query(query: str, document_id: str | None, model_id: str | None, top_k: int) -> dict:
    text = query.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Query is required")

    small_talk = _small_talk_answer(text)
    if small_talk:
        return {
            "query": text,
            "answer": small_talk,
            "prompt": "",
            "citations": [],
            "retrieval_ms": 0,
            "model_id": model_id,
            "no_context": True,
        }

    retrieval_start = time.perf_counter()
    indexed_document_id = document_id if document_id and _has_indexed_chunks(document_id) else None

    if indexed_document_id and indexed_document_id in DOCUMENT_STORE:
        matches = DOCUMENT_STORE[indexed_document_id]["retriever"].query(text, top_k=max(1, min(top_k, 5)))
    else:
        retriever = LibraryRetriever(DEFAULT_USER_ID, document_id=indexed_document_id)
        matches = retriever.query(text, top_k=max(1, min(top_k, 5)))

    retrieval_ms = (time.perf_counter() - retrieval_start) * 1000
    citations = [_citation_from_match(index, item, text) for index, item in enumerate(matches)]

    if not citations:
        answer = "I could not find any uploaded reference chunks relevant to that question."
        return {
            "query": text,
            "answer": answer,
            "prompt": "",
            "citations": [],
            "retrieval_ms": retrieval_ms,
            "model_id": model_id,
            "no_context": True,
        }

    context = "\n\n".join(f"[{_source_label(citation['rank'], citation)}]\n{citation['excerpt']}" for citation in citations)
    prompt = (
        "You are answering inside a writing editor RAG chat. "
        "Use only the reference chunks as evidence. Do not copy chunks back verbatim unless the user asks for a quote. "
        "Give the direct answer first in 2 to 5 concise sentences. "
        "When a chunk contains section, clause, article, or numbered-rule references, mention those identifiers in the answer. "
        "If the chunk says another guideline or source has the details, say that clearly instead of inventing the missing details. "
        "Do not say something is absent when a retrieved chunk explicitly mentions it. "
        "Do not repeat the question, do not list irrelevant chunk text, and do not mention these instructions. "
        "If the chunks do not contain enough evidence, say that briefly.\n\n"
        f"Reference chunks:\n{context}\n\nQuestion:\n{text}"
    )
    return {
        "query": text,
        "answer": "",
        "prompt": prompt,
        "citations": citations,
        "retrieval_ms": retrieval_ms,
        "model_id": model_id,
        "no_context": False,
    }


def _persist_chat(document_id: str | None, query: str, answer: str, citations: list[dict]) -> None:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO chats (id, user_id, document_id, message, response, citations, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("chat"),
                DEFAULT_USER_ID,
                document_id,
                query,
                answer,
                json_dumps(citations),
                utc_now(),
            ),
        )


@router.get("/models")
def models() -> list[dict]:
    return list_profiles()


@router.get("/models/profiles")
def model_profiles() -> dict:
    return {"profiles": list_profiles()}


@router.post("/models/switch")
def switch_model(req: SwitchModelRequest) -> dict:
    try:
        return set_active_model(req.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _run_retrieval_query(query: str, document_id: str | None, model_id: str | None, top_k: int) -> dict:
    request_id = str(uuid.uuid4())
    prepared = _prepare_retrieval_query(query, document_id, model_id, top_k)
    if prepared["no_context"]:
        answer = prepared["answer"]
        return {
            "answer": answer,
            "text": answer,
            "final_answer": answer,
            "citations": [],
            "metadata": {
                "request_id": request_id,
                "retrieval_time_ms": prepared["retrieval_ms"],
                "token_generation_speed": 0,
                "model": model_id,
                "runtime": "retrieval",
                "embedding_provider": embedding_provider(),
            },
        }

    inference_output = generate_answer(prepared["prompt"], request_id=request_id, model_id=model_id)
    answer = _clean_rag_answer(inference_output["answer"])
    _persist_chat(document_id, prepared["query"], answer, prepared["citations"])

    return {
        "answer": answer,
        "text": answer,
        "final_answer": answer,
        "citations": prepared["citations"],
        "metadata": {
            "request_id": request_id,
            "retrieval_time_ms": prepared["retrieval_ms"],
            "token_generation_speed": inference_output["token_generation_speed"],
            "model": inference_output["model"],
            "runtime": inference_output["runtime"],
            "embedding_provider": embedding_provider(),
        },
    }


@router.get("/retrieval/citations")
def retrieval_citations(documentId: str | None = None) -> list[dict]:
    query = "SELECT document_id, file_name, chunk_id, text FROM chunks"
    params: tuple = ()
    if documentId:
        query += " WHERE document_id = ?"
        params = (documentId,)
    query += " ORDER BY created_at DESC LIMIT 8"
    with db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [
        {
            "id": f"{row['document_id']}:{row['chunk_id']}",
            "sourceDocumentId": row["document_id"],
            "title": row["file_name"],
            "snippet": _split_chunk_context(row["text"])[1][:260],
            "file": row["file_name"],
            "chunk_id": row["chunk_id"],
        }
        for row in rows
    ]


@router.post("/retrieval/query")
def retrieval_query(req: RetrievalQueryRequest) -> dict:
    return _run_retrieval_query(req.query, req.document_id, req.model_id, req.top_k)


@router.post("/retrieval/query/stream")
def retrieval_query_stream(req: RetrievalQueryRequest) -> StreamingResponse:
    request_id = str(uuid.uuid4())
    prepared = _prepare_retrieval_query(req.query, req.document_id, req.model_id, req.top_k)

    def emit(payload: dict) -> str:
        return json.dumps(payload, ensure_ascii=False) + "\n"

    def stream() -> object:
        answer_parts: list[str] = []
        try:
            yield emit({"type": "citations", "citations": prepared["citations"]})
            if prepared["no_context"]:
                answer = prepared["answer"]
                yield emit({"type": "delta", "text": answer})
                yield emit(
                    {
                        "type": "done",
                        "answer": answer,
                        "metadata": {
                            "request_id": request_id,
                            "retrieval_time_ms": prepared["retrieval_ms"],
                            "token_generation_speed": 0,
                            "model": req.model_id,
                            "runtime": "retrieval",
                            "embedding_provider": embedding_provider(),
                        },
                    }
                )
                return

            final_metadata: dict = {}
            for event in stream_answer(prepared["prompt"], request_id=request_id, model_id=req.model_id):
                if event["type"] == "delta":
                    answer_parts.append(event["text"])
                    yield emit({"type": "delta", "text": event["text"]})
                elif event["type"] == "done":
                    final_metadata = event.get("metadata", {})

            answer = _clean_rag_answer("".join(answer_parts))
            _persist_chat(req.document_id, prepared["query"], answer, prepared["citations"])
            yield emit(
                {
                    "type": "done",
                    "answer": answer,
                    "metadata": {
                        **final_metadata,
                        "request_id": request_id,
                        "retrieval_time_ms": prepared["retrieval_ms"],
                        "embedding_provider": embedding_provider(),
                    },
                }
            )
        except Exception as exc:
            message = f"Retrieval stream failed: {exc}"
            if not answer_parts:
                yield emit({"type": "delta", "text": message})
            yield emit({"type": "error", "message": message})

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.post("/chat")
def chat(req: ChatRequest) -> dict:
    request_id = str(uuid.uuid4())
    text = (req.message or req.selected_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message or selected text is required")

    retrieval_start = time.perf_counter()
    citations: list[dict] = []
    retrieval_ms = 0.0

    if req.action in {"summarize", "improve", "continue"}:
        if req.action == "summarize":
            prompt = (
                "Summarize the selected editor text in shorter, clear words. "
                "Use only facts and ideas present in the selected text. "
                "Do not add new details, interpretations, names, dates, or claims. "
                "Return only the summary text, with no preface, label, or bullet list.\n\n"
                f"Selected text:\n{text}"
            )
        elif req.action == "continue":
            prompt = f"Continue this editor text in the same style. Return only the continuation.\n\nText:\n{text}"
        else:
            prompt = (
                "Improve the selected editor text while preserving its meaning, facts, tense, and point of view. "
                "Keep it concise and natural. Do not add new information. "
                "Return only the revised text, with no explanation or label.\n\n"
                f"Selected text:\n{text}"
            )
    elif _rag_requested(text, req.use_references):
        return _run_retrieval_query(text, req.document_id, req.model_id, req.top_k)
    elif req.document_id and req.document_id in DOCUMENT_STORE:
        document = DOCUMENT_STORE[req.document_id]
        matches = document["retriever"].query(text, top_k=max(1, min(req.top_k, 5)))
        retrieval_ms = (time.perf_counter() - retrieval_start) * 1000
        citations = [_citation_from_match(index, item, text) for index, item in enumerate(matches)]
        context = "\n\n".join(f"[{c['title']}]\n{c['excerpt']}" for c in citations)
        prompt = (
            "Answer the question using only the reference chunks when they are relevant. "
            "Answer in 3 to 7 useful sentences. Do not repeat yourself.\n\n"
            f"Reference chunks:\n{context}\n\nQuestion:\n{text}"
        )
    else:
        prompt = text

    inference_output = generate_answer(prompt, request_id=request_id, model_id=req.model_id)
    if req.action in {"summarize", "improve", "continue"}:
        response_text = _clean_editor_action_response(req.action, inference_output["answer"])
    else:
        response_text = _clean_rag_answer(inference_output["answer"]) if citations else inference_output["answer"]

    with db() as conn:
        conn.execute(
            """
            INSERT INTO chats (id, user_id, document_id, message, response, citations, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("chat"),
                DEFAULT_USER_ID,
                req.document_id,
                text,
                response_text,
                json_dumps(citations),
                utc_now(),
            ),
        )

    return {
        "text": response_text,
        "final_answer": response_text,
        "citations": citations,
        "metadata": {
            "request_id": request_id,
            "retrieval_time_ms": retrieval_ms,
            "token_generation_speed": inference_output["token_generation_speed"],
            "model": inference_output["model"],
            "runtime": inference_output["runtime"],
            "embedding_provider": embedding_provider(),
        },
    }
