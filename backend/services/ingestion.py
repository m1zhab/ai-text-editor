from pathlib import Path

from fastapi import HTTPException

from .audit import write_audit
from .chunking import Chunk, chunk_text

UPLOAD_ROOT = Path("/mnt/uploads")


def _resolved_user_root(user_id: str) -> Path:
    root = (UPLOAD_ROOT / user_id).resolve()
    allowed_parent = UPLOAD_ROOT.resolve()
    if allowed_parent not in root.parents and root != allowed_parent:
        raise HTTPException(status_code=400, detail="Invalid user path")
    return root


def resolve_user_file(user_id: str, relative_path: str) -> Path:
    user_root = _resolved_user_root(user_id)
    candidate = (user_root / relative_path).resolve()
    if user_root not in candidate.parents and candidate != user_root:
        raise HTTPException(status_code=403, detail="Path traversal attempt blocked")
    return candidate


def ingest_document(user_id: str, relative_path: str) -> tuple[str, list[Chunk]]:
    target = resolve_user_file(user_id, relative_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    text = target.read_text(encoding="utf-8", errors="ignore")
    chunks = chunk_text(text)
    write_audit(
        "file_access",
        {
            "user_id": user_id,
            "file": str(target),
            "chunk_count": len(chunks),
        },
    )
    return str(target), chunks
