# Backend Notes

This backend is a lightweight offline-first FastAPI service for the AI text editor.
It is optimized for MVP stability, local files, local inference, SQLite persistence,
and uploaded-reference RAG.

## Stack

- Python + FastAPI
- SQLite database under `backend/data/app.sqlite3` by default
- Filesystem uploads under `mnt/uploads/user_1`
- FAISS if installed, keyword fallback otherwise
- MiniLM retrieval embeddings when `sentence-transformers` is installed, with a
  hashing-based local fallback in `backend/services/embeddings.py`
- Local model runtime abstraction in `backend/services/inference.py`

## Run Locally

From repo root:

```bash
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

Frontend dev server proxies `/api` to `http://127.0.0.1:8000` from
`frontend/vite.config.ts`, so start the backend before testing from React.

## Main Files

- `main.py`: FastAPI app, CORS, route registration, DB init.
- `api/routes/documents.py`: document CRUD, file upload, legacy ingest route.
- `api/routes/chat.py`: model list, chat, retrieval query, citation endpoints.
- `services/storage.py`: SQLite setup, paths, helpers.
- `services/ingestion.py`: upload storage, PDF/TXT/MD extraction, chunk persistence.
- `services/chunking.py`: simple overlapping chunks with metadata.
- `services/embeddings.py`: MiniLM embeddings with offline hash-vector fallback.
- `services/retrieval.py`: FAISS retrieval when available, keyword fallback.
- `services/inference.py`: model profiles and local generation abstraction.

## API Shape Used By Frontend

Frontend calls are under `/api`.

Documents:

```text
GET    /api/documents
GET    /api/documents/{document_id}
POST   /api/documents
PATCH  /api/documents/{document_id}
DELETE /api/documents/{document_id}
POST   /api/documents/upload
POST   /api/documents/{document_id}/reindex
```

Models:

```text
GET  /api/models
GET  /api/models/profiles
POST /api/models/switch
```

Chat and retrieval:

```text
POST /api/chat
GET  /api/retrieval/citations?documentId=...
POST /api/retrieval/query
```

The backend also registers the same routers under `/api/v1` for compatibility.

## RAG Behavior

Active editor content is not RAG. Editor actions like summarize/improve use the
selected text directly:

```text
selected text -> prompt -> model -> returned text
```

Uploaded reference files are RAG. Uploading `.pdf`, `.md`, or `.txt`:

1. Stores the original file.
2. Extracts text.
3. Chunks text.
4. Embeds chunks.
5. Persists chunks and embeddings in SQLite.

Embedding behavior:

- `services/embeddings.py` uses `sentence-transformers/all-MiniLM-L6-v2` when
  `sentence-transformers` is installed and `AI_EDITOR_EMBEDDING_PROVIDER` is
  `auto` or `minilm`.
- Set `AI_EDITOR_MINILM_MODEL` to a local model directory for fully offline
  MiniLM usage.
- `AI_EDITOR_MINILM_LOCAL_ONLY` defaults to `true`, so after the first download
  the backend loads MiniLM from the local Hugging Face cache instead of reaching
  out during normal startup/reindexing.
- Set `AI_EDITOR_EMBEDDING_PROVIDER=hash` to force the old hash embedding
  fallback.
- Existing uploaded files should be reindexed after enabling MiniLM:
  `POST /api/documents/{document_id}/reindex`.

RAG is triggered by:

- `POST /api/retrieval/query`
- `/api/chat` messages with explicit reference wording, e.g.:
  - `Use uploaded documents...`
  - `Answer using references...`
  - `Ground response in my files...`
- `/api/chat` with `useReferences: true`

Retrieval returns citations with file name, chunk id, score, and excerpt.

## Model Setup

Current local GGUF in repo:

```text
backend/model/qwen2.5-3b-instruct-q4_k_m.gguf
backend/model/Modelfile
backend/model/all-MiniLM-L6-v2/
```

Ollama model name used by scripts and backend config:

```text
qwen2.5-3b-local
```

Create it from the bundled Modelfile:

```bash
ollama create qwen2.5-3b-local -f backend/model/Modelfile
```

Run a quick generation check:

```bash
ollama run qwen2.5-3b-local "Write one sentence about local AI."
```

`services/inference.py` calls the Ollama HTTP API at `OLLAMA_BASE_URL`
(`http://127.0.0.1:11434` locally, `http://ollama:11434` in Docker) and sends
requests to `OLLAMA_MODEL`, defaulting to `qwen2.5-3b-local`.

For compatibility with common model aliases, the backend also falls back to
`qwen2.5:3b` and `qwen25-3b-local` if the configured Ollama model name is
missing.

## Inference Details

`services/inference.py` has:

- model profile list
- active model switching
- PII sanitization
- `_ollama_generate(...)`
- `generate_answer(...)`

`generate_answer(...)` currently:

1. Selects the active model profile.
2. Sanitizes obvious PII from the prompt.
3. Calls Ollama `/api/generate` with the configured local model.
4. Uses fallback text generation if Ollama is unavailable/fails.

The Ollama request includes:

```text
num_ctx: 8192
num_predict: 768
temperature: 0.4
```

## Known Issues / Next Best Fix

- Ensure the Ollama model has been created before expecting real model output:
  `ollama list` should include `qwen2.5-3b-local`.
- If `/api/chat` or `/api/retrieval/query` returns fallback text with an
  "Ollama fallback used" note, check that Ollama is running and that
  `OLLAMA_BASE_URL` / `OLLAMA_MODEL` match the local setup.
- Docker Compose starts the Ollama service, but model creation still needs the
  setup step (`deploy/rhel9/setup.sh` for RHEL/offline deployment).

## Direct RAG Smoke Test

After uploading at least one reference file:

```bash
curl -X POST http://127.0.0.1:8000/api/retrieval/query \
  -H "Content-Type: application/json" \
  -d '{"query":"Use uploaded documents. Summarize the main point.","topK":4}'
```

Expected response includes:

- `answer`
- `citations`
- `metadata.retrieval_time_ms`
- `metadata.model`
- `metadata.runtime`
