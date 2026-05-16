from fastapi import FastAPI

from backend.api.routes import chat, documents

app = FastAPI(title="AI Text Editor Backend", version="0.1.0")

app.include_router(documents.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
