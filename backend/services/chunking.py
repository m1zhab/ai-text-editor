from dataclasses import dataclass


@dataclass
class Chunk:
    chunk_id: str
    text: str
    start_offset: int
    end_offset: int
    page: int | None = None


def chunk_text(text: str, chunk_size: int = 700, overlap: int = 120) -> list[Chunk]:
    chunks: list[Chunk] = []
    start = 0
    idx = 0
    text_len = len(text)
    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunk_text_value = text[start:end]
        chunks.append(
            Chunk(
                chunk_id=f"chunk-{idx}",
                text=chunk_text_value,
                start_offset=start,
                end_offset=end,
            )
        )
        if end == text_len:
            break
        start = max(0, end - overlap)
        idx += 1
    return chunks
