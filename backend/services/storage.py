from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


APP_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = Path(os.getenv("AI_EDITOR_DATA_ROOT", APP_ROOT / "backend" / "data"))
UPLOAD_ROOT = Path(os.getenv("AI_EDITOR_UPLOAD_ROOT", APP_ROOT / "mnt" / "uploads"))
DB_PATH = Path(os.getenv("AI_EDITOR_DB_PATH", DATA_ROOT / "app.sqlite3"))
DEFAULT_USER_ID = "user_1"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def ensure_dirs() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    ensure_dirs()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                extension TEXT NOT NULL,
                kind TEXT NOT NULL,
                folder TEXT NOT NULL,
                content TEXT,
                file_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS document_versions (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS uploaded_assets (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                folder TEXT NOT NULL,
                file_path TEXT NOT NULL,
                content_type TEXT,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                folder TEXT NOT NULL,
                chunk_id TEXT NOT NULL,
                text TEXT NOT NULL,
                start_offset INTEGER NOT NULL,
                end_offset INTEGER NOT NULL,
                page INTEGER,
                embedding TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                document_id TEXT,
                message TEXT NOT NULL,
                response TEXT NOT NULL,
                citations TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
            """
        )


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def user_upload_root(user_id: str = DEFAULT_USER_ID) -> Path:
    safe_user = "".join(ch for ch in user_id if ch.isalnum() or ch in ("_", "-")) or DEFAULT_USER_ID
    root = (UPLOAD_ROOT / safe_user).resolve()
    upload_root = UPLOAD_ROOT.resolve()
    if upload_root != root and upload_root not in root.parents:
        raise ValueError("Invalid user upload path")
    root.mkdir(parents=True, exist_ok=True)
    return root


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
