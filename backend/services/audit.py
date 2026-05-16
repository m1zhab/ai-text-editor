import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

AUDIT_LOG_PATH = Path("/tmp/ai_text_editor_audit.log")
_LOCK = Lock()


def write_audit(event_type: str, payload: dict[str, Any]) -> None:
    event = {
        "event_type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    line = json.dumps(event, ensure_ascii=False)
    with _LOCK:
        AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
