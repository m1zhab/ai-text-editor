from __future__ import annotations

import shutil
from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException

from .audit import write_audit
from .chunking import Chunk, chunk_text
from .embeddings import embed_record, embedding_provider
from .storage import DEFAULT_USER_ID, json_dumps, new_id, user_upload_root, utc_now, db

ALLOWED_EXTENSIONS = {".pdf", ".md", ".txt"}


def _safe_name(filename: str) -> str:
    candidate = Path(filename).name.strip().replace("\\", "-").replace("/", "-")
    if not candidate:
        raise HTTPException(status_code=400, detail="Missing file name")
    if Path(candidate).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF, MD, and TXT uploads are supported")
    return candidate


def resolve_user_file(user_id: str, relative_path: str) -> Path:
    user_root = user_upload_root(user_id)
    candidate = (user_root / relative_path).resolve()
    if user_root not in candidate.parents and candidate != user_root:
        raise HTTPException(status_code=403, detail="Path traversal attempt blocked")
    return candidate


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".md", ".txt"}:
        return path.read_text(encoding="utf-8", errors="ignore")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore
        except Exception:
            try:
                from PyPDF2 import PdfReader  # type: ignore
            except Exception as exc:
                raise HTTPException(
                    status_code=500,
                    detail="PDF extraction requires pypdf or PyPDF2 in the backend environment",
                ) from exc

        reader = PdfReader(str(path))
        pages = []
        for page_number, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text() or ""
            if page_text.strip():
                pages.append(f"\n\n[Page {page_number}]\n{page_text}")
        return "\n".join(pages).strip()
    raise HTTPException(status_code=400, detail="Unsupported file type")


def _persist_chunks(user_id: str, document_id: str, chunks: list[Chunk]) -> None:
    now = utc_now()
    with db() as conn:
        conn.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
        for chunk in chunks:
            conn.execute(
                """
                INSERT INTO chunks (
                    id, document_id, user_id, file_name, folder, chunk_id, text,
                    start_offset, end_offset, page, embedding, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id("chunk"),
                    document_id,
                    user_id,
                    chunk.file_name,
                    chunk.folder,
                    chunk.chunk_id,
                    chunk.text,
                    chunk.start_offset,
                    chunk.end_offset,
                    chunk.page,
                    json_dumps(embed_record(chunk.text)),
                    now,
                ),
            )


def ingest_file(user_id: str, document_id: str, file_name: str, folder: str, path: Path) -> list[Chunk]:
    text = extract_text(path)
    chunks = chunk_text(text, document_id=document_id, file_name=file_name, folder=folder)
    _persist_chunks(user_id, document_id, chunks)
    write_audit(
        "file_ingested",
        {
            "user_id": user_id,
            "document_id": document_id,
            "file": str(path),
            "chunk_count": len(chunks),
        },
    )
    return chunks


def store_upload(file: BinaryIO, filename: str, content_type: str | None, user_id: str = DEFAULT_USER_ID) -> dict:
    safe_name = _safe_name(filename)
    root = user_upload_root(user_id)
    target = root / safe_name
    if target.exists():
        with db() as conn:
            referenced = conn.execute(
                "SELECT 1 FROM documents WHERE file_path = ? UNION SELECT 1 FROM uploaded_assets WHERE file_path = ? LIMIT 1",
                (str(target), str(target)),
            ).fetchone()
        if not referenced:
            target.unlink()

    if target.exists():
        stem = target.stem
        suffix = target.suffix
        index = 2
        while True:
            candidate = root / f"{stem} ({index}){suffix}"
            if not candidate.exists():
                target = candidate
                break
            index += 1
        safe_name = target.name

    with target.open("wb") as fh:
        shutil.copyfileobj(file, fh)

    document_id = new_id("doc")
    now = utc_now()
    extension = target.suffix.lower()
    name = target.stem
    folder = "mnt/uploads"
    extracted_text = extract_text(target)
    content = extracted_text if extension != ".pdf" else f"# {safe_name}\n\nPDF uploaded and indexed for retrieval."

    with db() as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, name, extension, kind, folder, content, file_path, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document_id,
                user_id,
                name,
                extension,
                "asset" if extension == ".pdf" else "document",
                folder,
                content,
                str(target),
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO uploaded_assets (id, document_id, user_id, file_name, folder, file_path, content_type, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("asset"),
                document_id,
                user_id,
                safe_name,
                folder,
                str(target),
                content_type,
                target.stat().st_size,
                now,
            ),
        )

    chunks = chunk_text(extracted_text, document_id=document_id, file_name=safe_name, folder=folder)
    _persist_chunks(user_id, document_id, chunks)
    return {
        "id": document_id,
        "name": name,
        "updatedAt": now,
        "kind": "asset" if extension == ".pdf" else "document",
        "extension": extension,
        "content": content,
        "folder": folder,
        "chunksIndexed": len(chunks),
        "embeddingProvider": embedding_provider(),
    }


def ingest_document(user_id: str, relative_path: str) -> tuple[str, list[Chunk]]:
    target = resolve_user_file(user_id, relative_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    document_id = f"{user_id}:{relative_path}"
    chunks = ingest_file(user_id, document_id, target.name, "mnt/uploads", target)
    write_audit(
        "file_access",
        {
            "user_id": user_id,
            "file": str(target),
            "chunk_count": len(chunks),
        },
    )
    return str(target), chunks
