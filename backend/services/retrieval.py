from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import asdict

from .chunking import Chunk
from .embeddings import embed_text, embedding_provider, parse_embedding_record
from .storage import DEFAULT_USER_ID, db, row_to_dict


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

        vectors = [embed_text(c.text) for c in self.chunks]
        if not vectors:
            return
        mat = np.array(vectors).astype("float32")
        index = faiss.IndexFlatL2(mat.shape[1])
        index.add(mat)
        self._faiss_index = index
        self._embeddings = mat
        self.strategy = "faiss"

    @staticmethod
    def _token_list(text: str) -> list[str]:
        stopwords = {
            "about",
            "after",
            "also",
            "and",
            "are",
            "for",
            "from",
            "have",
            "how",
            "into",
            "that",
            "the",
            "their",
            "this",
            "was",
            "what",
            "when",
            "where",
            "with",
            "you",
            "your",
        }
        return [
            token
            for token in re.findall(r"[a-zA-Z0-9_]+", text.lower())
            if len(token) > 2 and token not in stopwords
        ]

    @staticmethod
    def _tokens(text: str) -> set[str]:
        return set(LocalRetriever._token_list(text))

    @staticmethod
    def _keyword_score(question: str, text: str) -> float:
        q_tokens = LocalRetriever._tokens(question)
        if not q_tokens:
            return 0.0
        c_tokens = LocalRetriever._tokens(text)
        overlap = q_tokens & c_tokens
        if not overlap:
            return 0.0
        density = len(overlap) / max(1, len(q_tokens))
        coverage = len(overlap) / max(1, len(c_tokens) ** 0.5)
        return density + min(coverage, 0.4)

    @staticmethod
    def _bm25_scores(question: str, texts: list[str]) -> list[float]:
        query_terms = LocalRetriever._token_list(question)
        if not query_terms or not texts:
            return [0.0 for _ in texts]

        tokenized_docs = [LocalRetriever._token_list(text) for text in texts]
        doc_count = len(tokenized_docs)
        avg_doc_len = sum(len(doc) for doc in tokenized_docs) / max(1, doc_count)
        document_frequency: Counter[str] = Counter()

        for doc_terms in tokenized_docs:
            document_frequency.update(set(doc_terms))

        k1 = 1.4
        b = 0.75
        scores: list[float] = []
        for doc_terms in tokenized_docs:
            if not doc_terms:
                scores.append(0.0)
                continue

            term_frequency = Counter(doc_terms)
            doc_len = len(doc_terms)
            score = 0.0
            for term in set(query_terms):
                tf = term_frequency.get(term, 0)
                if not tf:
                    continue
                idf = math.log(1 + (doc_count - document_frequency[term] + 0.5) / (document_frequency[term] + 0.5))
                denominator = tf + k1 * (1 - b + b * doc_len / max(1, avg_doc_len))
                score += idf * (tf * (k1 + 1) / denominator)
            scores.append(score)
        return scores

    @staticmethod
    def _structural_score(question: str, text: str) -> float:
        lowered_text = text.lower()
        query_tokens = LocalRetriever._tokens(question)
        metadata_lines = [
            line.lower()
            for line in text.splitlines()[:8]
            if line.startswith(("Document:", "Folder:", "Page:", "Section:"))
        ]
        metadata = " ".join(metadata_lines)
        score = 0.0

        if query_tokens and metadata and query_tokens & LocalRetriever._tokens(metadata):
            score += 0.3

        exact_phrases = re.findall(r"[a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){1,4}", question.lower())
        for phrase in exact_phrases:
            if len(phrase) >= 8 and phrase in lowered_text:
                score += 0.2

        for number in re.findall(r"\b\d+(?:\.\d+)*\b", question):
            if number in text:
                score += 0.25

        return min(score, 1.0)

    @staticmethod
    def _hybrid_results(
        question: str,
        chunks: list[Chunk | dict],
        dense_scores: dict[int, float] | None = None,
        top_k: int = 4,
    ) -> list[dict]:
        dense_scores = dense_scores or {}
        texts = [chunk.text if isinstance(chunk, Chunk) else chunk["text"] for chunk in chunks]
        sparse_scores = LocalRetriever._bm25_scores(question, texts)
        max_dense = max(dense_scores.values(), default=0.0)
        max_sparse = max(sparse_scores, default=0.0)

        scored: list[tuple[float, int]] = []
        for index, chunk in enumerate(chunks):
            text = chunk.text if isinstance(chunk, Chunk) else chunk["text"]
            dense = dense_scores.get(index, 0.0)
            sparse = sparse_scores[index]
            lexical = LocalRetriever._keyword_score(question, text)
            structural = LocalRetriever._structural_score(question, text)
            dense_norm = dense / max_dense if max_dense else 0.0
            sparse_norm = sparse / max_sparse if max_sparse else 0.0
            score = (0.4 * dense_norm) + (0.35 * sparse_norm) + (0.15 * lexical) + (0.1 * structural)
            if score > 0:
                scored.append((score, index))

        scored.sort(key=lambda item: item[0], reverse=True)
        results: list[dict] = []
        for score, index in scored[:top_k]:
            chunk = chunks[index]
            if isinstance(chunk, Chunk):
                chunk_out = asdict(chunk)
            else:
                chunk_out = dict(chunk)
                chunk_out.pop("embedding", None)
            results.append({"score": score, "chunk": chunk_out})
        return results

    def query(self, question: str, top_k: int = 4) -> list[dict]:
        if self.strategy == "faiss":
            import numpy as np

            qv = np.array([embed_text(question)], dtype="float32")
            candidate_k = min(max(top_k * 6, 20), len(self.chunks))
            distances, indexes = self._faiss_index.search(qv, candidate_k)
            dense_scores = {}
            for d, i in zip(distances[0], indexes[0]):
                if i < 0:
                    continue
                dense_scores[int(i)] = float(1 / (1 + d))
            return self._hybrid_results(question, self.chunks, dense_scores, top_k)

        return self._hybrid_results(question, self.chunks, top_k=top_k)


class LibraryRetriever:
    def __init__(self, user_id: str = DEFAULT_USER_ID, document_id: str | None = None):
        self.user_id = user_id
        self.document_id = document_id
        self.strategy = "keyword"

    def _load_chunks(self) -> list[dict]:
        params: tuple[str, ...]
        where = "WHERE user_id = ?"
        params = (self.user_id,)
        if self.document_id:
            where += " AND document_id = ?"
            params = (self.user_id, self.document_id)

        with db() as conn:
            rows = conn.execute(
                f"""
                SELECT document_id, file_name, folder, chunk_id, text, start_offset, end_offset, page, embedding
                FROM chunks
                {where}
                ORDER BY created_at ASC
                """,
                params,
            ).fetchall()
        return [row_to_dict(row) for row in rows]

    def query(self, question: str, top_k: int = 4) -> list[dict]:
        chunks = self._load_chunks()
        if not chunks:
            return []

        try:
            import faiss  # type: ignore
            import numpy as np

            active_provider = embedding_provider()
            indexed_chunks = []
            vectors = []
            for chunk in chunks:
                provider, vector = parse_embedding_record(json.loads(chunk["embedding"]))
                if provider != active_provider or not vector:
                    continue
                indexed_chunks.append(chunk)
                vectors.append(vector)
            if not vectors:
                raise RuntimeError(f"No chunks indexed with active embedding provider: {active_provider}")

            matrix = np.array(vectors, dtype="float32")
            index = faiss.IndexFlatL2(matrix.shape[1])
            index.add(matrix)
            qv = np.array([embed_text(question)], dtype="float32")
            candidate_k = min(max(top_k * 6, 20), len(indexed_chunks))
            distances, indexes = index.search(qv, candidate_k)
            self.strategy = "faiss"
            dense_scores = {}
            for distance, idx in zip(distances[0], indexes[0]):
                if idx < 0:
                    continue
                dense_scores[int(idx)] = float(1 / (1 + distance))
            return LocalRetriever._hybrid_results(question, indexed_chunks, dense_scores, top_k)
        except Exception:
            return LocalRetriever._hybrid_results(question, chunks, top_k=top_k)
