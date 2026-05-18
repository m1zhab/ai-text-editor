FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend

ENV AI_EDITOR_DATA_ROOT=/app/backend/data
ENV AI_EDITOR_UPLOAD_ROOT=/app/mnt/uploads
ENV OLLAMA_BASE_URL=http://ollama:11434
ENV OLLAMA_MODEL=qwen2.5-3b-local
ENV AI_EDITOR_EMBEDDING_PROVIDER=minilm
ENV AI_EDITOR_MINILM_MODEL=/app/backend/model/all-MiniLM-L6-v2
ENV AI_EDITOR_MINILM_LOCAL_ONLY=true
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
