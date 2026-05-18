from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.services.embeddings import embedding_provider
from backend.services.ingestion import ingest_document, ingest_file, store_upload
from backend.services.retrieval import LocalRetriever
from backend.services.storage import DEFAULT_USER_ID, db, new_id, row_to_dict, utc_now

router = APIRouter(tags=["documents"])

DOCUMENT_STORE: dict[str, dict] = {}


class DocumentCreate(BaseModel):
    name: str
    extension: str
    content: str = ""
    folder: str = "mnt"


class DocumentUpdate(BaseModel):
    name: str | None = None
    content: str | None = None
    folder: str | None = None


class IngestRequest(BaseModel):
    user_id: str = DEFAULT_USER_ID
    relative_path: str


def _to_frontend(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "updatedAt": row["updated_at"],
        "kind": row["kind"],
        "extension": row["extension"],
        "content": row.get("content"),
        "folder": row["folder"],
    }


@router.get("/documents")
def list_documents() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM documents WHERE user_id = ? ORDER BY updated_at DESC",
            (DEFAULT_USER_ID,),
        ).fetchall()
    return [_to_frontend(row_to_dict(row)) for row in rows]


@router.get("/documents/{document_id}")
def get_document(document_id: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return _to_frontend(row_to_dict(row))


@router.post("/documents")
def create_document(req: DocumentCreate) -> dict:
    if req.extension not in {".md", ".txt"}:
        raise HTTPException(status_code=400, detail="Only .md and .txt documents can be created")
    document_id = new_id("doc")
    now = utc_now()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, name, extension, kind, folder, content, file_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            """,
            (document_id, DEFAULT_USER_ID, req.name, req.extension, "document", req.folder, req.content, now, now),
        )
    return {
        "id": document_id,
        "name": req.name,
        "updatedAt": now,
        "kind": "document",
        "extension": req.extension,
        "content": req.content,
        "folder": req.folder,
    }


@router.patch("/documents/{document_id}")
def update_document(document_id: str, req: DocumentUpdate) -> dict:
    with db() as conn:
        current = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Document not found")
        row = row_to_dict(current)
        now = utc_now()
        next_name = req.name if req.name is not None else row["name"]
        next_content = req.content if req.content is not None else row["content"]
        next_folder = req.folder if req.folder is not None else row["folder"]
        if req.content is not None:
            conn.execute(
                "INSERT INTO document_versions (id, document_id, content, created_at) VALUES (?, ?, ?, ?)",
                (new_id("ver"), document_id, req.content, now),
            )
        conn.execute(
            "UPDATE documents SET name = ?, content = ?, folder = ?, updated_at = ? WHERE id = ?",
            (next_name, next_content, next_folder, now, document_id),
        )
        updated = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    return _to_frontend(row_to_dict(updated))


@router.delete("/documents/{document_id}")
def delete_document(document_id: str) -> dict:
    file_paths: list[str] = []
    with db() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not row:
            return {"ok": True}
        document = row_to_dict(row)
        if document.get("file_path"):
            file_paths.append(document["file_path"])
        asset_rows = conn.execute("SELECT file_path FROM uploaded_assets WHERE document_id = ?", (document_id,)).fetchall()
        file_paths.extend(row["file_path"] for row in asset_rows if row["file_path"])
        conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        conn.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM uploaded_assets WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM document_versions WHERE document_id = ?", (document_id,))

    for file_path in set(file_paths):
        path = Path(file_path)
        try:
            if path.exists() and path.is_file():
                path.unlink()
        except OSError:
            pass
    return {"ok": True}


@router.post("/documents/upload")
def upload_document(file: UploadFile = File(...)) -> dict:
    return store_upload(file.file, file.filename or "upload.txt", file.content_type, DEFAULT_USER_ID)


@router.post("/documents/{document_id}/reindex")
def reindex_document(document_id: str) -> dict:
    with db() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (document_id, DEFAULT_USER_ID)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    document = row_to_dict(row)
    file_path = document.get("file_path")
    if not file_path:
        raise HTTPException(status_code=400, detail="Document has no uploaded file to reindex")

    path = Path(file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Uploaded file is missing")

    chunks = ingest_file(DEFAULT_USER_ID, document_id, path.name, document["folder"], path)
    now = utc_now()
    with db() as conn:
        conn.execute("UPDATE documents SET updated_at = ? WHERE id = ?", (now, document_id))
    return {"id": document_id, "chunksIndexed": len(chunks), "updatedAt": now, "embeddingProvider": embedding_provider()}


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
