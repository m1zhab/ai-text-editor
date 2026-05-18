# AI Text Editor

AI Text Editor is an offline-first writing workspace with local RAG support. It
provides a React/Tiptap editor for Markdown, TXT, and PDF reference workflows,
a FastAPI backend for document storage, chunking, retrieval, and chat endpoints,
and an Ollama-backed local Qwen runtime for generation.

The app is designed for zero-network RHEL 9 deployment: Docker Engine RPMs,
container images, GGUF model weights, MiniLM embedding assets, and setup scripts
can be bundled into a single offline deliverable.

## Project layout

- [`frontend/`](./frontend/): React editor UI, file tree, AI panel, and client build tooling.
- [`backend/`](./backend/): FastAPI APIs, SQLite persistence, ingestion, chunking, retrieval, embeddings, and Ollama inference calls.
- [`deploy/rhel9/`](./deploy/rhel9/): offline RHEL 9 packaging and setup flow.

## Directory docs
- Frontend guide: [`frontend/README.md`](./frontend/README.md)
- Backend guide: [`backend/README.md`](./backend/README.md)
- Deployment guide: [`deploy/rhel9/README.md`](./deploy/rhel9/README.md)
