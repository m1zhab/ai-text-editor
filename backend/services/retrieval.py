from __future__ import annotations

import math
import re
from dataclasses import asdict

from .chunking import Chunk


class LocalRetriever:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        self._faiss_index = None
        self._embeddings = None
        self.strategy = "keyword"
        self._build_index()

    def _build_index(self) -> None:
        try:
            import faiss  # type: ignore
            import numpy as np
        except Exception:
            return

        vectors = [self._embed_text(c.text) for c in self.chunks]
        if not vectors:
            return
        mat = np.array(vectors).astype("float32")
        index = faiss.IndexFlatL2(mat.shape[1])
        index.add(mat)
        self._faiss_index = index
        self._embeddings = mat
        self.strategy = "faiss"

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return set(re.findall(r"[a-zA-Z0-9_]+", text.lower()))

    @staticmethod
    def _embed_text(text: str, dims: int = 256) -> list[float]:
        vec = [0.0] * dims
        for tok in re.findall(r"[a-zA-Z0-9_]+", text.lower()):
            idx = hash(tok) % dims
            vec[idx] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def query(self, question: str, top_k: int = 4) -> list[dict]:
        if self.strategy == "faiss":
            import numpy as np

            qv = np.array([self._embed_text(question)], dtype="float32")
            distances, indexes = self._faiss_index.search(qv, min(top_k, len(self.chunks)))
            out = []
            for d, i in zip(distances[0], indexes[0]):
                if i < 0:
                    continue
                chunk = self.chunks[int(i)]
                out.append({"score": float(1 / (1 + d)), "chunk": asdict(chunk)})
            return out

        q_tokens = self._tokens(question)
        scored = []
        for chunk in self.chunks:
            c_tokens = self._tokens(chunk.text)
            overlap = len(q_tokens & c_tokens)
            if overlap == 0:
                continue
            scored.append((overlap / max(1, len(q_tokens)), chunk))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"score": score, "chunk": asdict(chunk)} for score, chunk in scored[:top_k]]
