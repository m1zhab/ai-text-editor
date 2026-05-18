from dataclasses import dataclass
import re


@dataclass
class Chunk:
    chunk_id: str
    text: str
    start_offset: int
    end_offset: int
    document_id: str = ""
    file_name: str = ""
    folder: str = ""
    page: int | None = None


def chunk_text(
    text: str,
    chunk_size: int = 1200,
    overlap: int = 180,
    document_id: str = "",
    file_name: str = "",
    folder: str = "",
) -> list[Chunk]:
    clean_text = text.replace("\r\n", "\n").replace("\r", "\n")
    page_pattern = re.compile(r"^\[Page\s+(\d+)\]\s*$", re.IGNORECASE)
    heading_pattern = re.compile(
        r"^(?:#{1,6}\s+)?((?:\d+(?:\.\d+)*|[A-Z][A-Z\s]{3,})\s+[A-Za-z][^\n]{2,90})$"
    )

    blocks: list[dict] = []
    active_page: int | None = None
    active_section = ""
    paragraph_lines: list[str] = []
    paragraph_start = 0

    def context_prefix(section: str, page: int | None) -> str:
        parts = [f"Document: {file_name}"] if file_name else []
        if folder:
            parts.append(f"Folder: {folder}")
        if page is not None:
            parts.append(f"Page: {page}")
        if section:
            parts.append(f"Section: {section}")
        return "\n".join(parts)

    def add_block(body: str, start: int, end: int, section: str, page: int | None) -> None:
        value = body.strip()
        if not value:
            return
        prefix = context_prefix(section, page)
        blocks.append(
            {
                "text": f"{prefix}\n\n{value}" if prefix else value,
                "body": value,
                "start": start,
                "end": end,
                "section": section,
                "page": page,
            }
        )

    def flush_paragraph(end: int) -> None:
        nonlocal paragraph_lines, paragraph_start
        if paragraph_lines:
            add_block("\n".join(paragraph_lines), paragraph_start, end, active_section, active_page)
            paragraph_lines = []

    for line_match in re.finditer(r".*(?:\n|$)", clean_text):
        raw_line = line_match.group(0)
        if raw_line == "":
            continue
        line = raw_line.strip()
        line_start = line_match.start()
        line_end = line_match.end()

        page_match = page_pattern.match(line)
        if page_match:
            flush_paragraph(line_start)
            active_page = int(page_match.group(1))
            continue

        heading_match = heading_pattern.match(line)
        if heading_match and len(line.split()) <= 12:
            flush_paragraph(line_start)
            active_section = re.sub(r"\s+", " ", heading_match.group(1)).strip()
            add_block(line, line_start, line_end, active_section, active_page)
            continue

        if not line:
            flush_paragraph(line_start)
            continue

        if not paragraph_lines:
            paragraph_start = line_start
        paragraph_lines.append(line)

    flush_paragraph(len(clean_text))

    chunks: list[Chunk] = []
    current_parts: list[str] = []
    current_start = 0
    current_end = 0

    def split_oversized_block(value: str) -> list[str]:
        if len(value) <= chunk_size:
            return [value]
        sentences = re.split(r"(?<=[.!?])\s+", value)
        parts: list[str] = []
        current = ""
        for sentence in sentences:
            candidate = f"{current} {sentence}".strip()
            if current and len(candidate) > chunk_size:
                parts.append(current)
                current = sentence
            else:
                current = candidate
        if current:
            parts.append(current)
        return parts

    def flush(page: int | None = None) -> None:
        nonlocal current_parts, current_start, current_end
        chunk_value = "\n\n".join(part.strip() for part in current_parts if part.strip()).strip()
        if not chunk_value:
            current_parts = []
            return

        chunks.append(
            Chunk(
                chunk_id=f"chunk-{len(chunks)}",
                text=chunk_value,
                start_offset=current_start,
                end_offset=current_end,
                document_id=document_id,
                file_name=file_name,
                folder=folder,
                page=page,
            )
        )

        if overlap and len(chunk_value) > overlap:
            overlap_text = chunk_value[-overlap:].split("\n\n", 1)[-1].strip()
            current_parts = [overlap_text] if overlap_text else []
            current_start = max(current_start, current_end - len(overlap_text))
        else:
            current_parts = []

    current_page: int | None = None
    for block_item in blocks:
        block = block_item["text"].strip()
        if not block:
            continue
        if len(block) > chunk_size:
            flush(current_page)
            for piece in split_oversized_block(block):
                current_parts = [piece]
                current_start = block_item["start"]
                current_end = block_item["end"]
                current_page = block_item["page"]
                flush(current_page)
            continue

        next_length = len("\n\n".join([*current_parts, block]))
        if current_parts and next_length > chunk_size:
            flush(current_page)

        if not current_parts:
            current_start = block_item["start"]
            current_page = block_item["page"]
        current_parts.append(block)
        current_end = block_item["end"]

    flush(current_page)
    return chunks
