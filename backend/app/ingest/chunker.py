"""Fixed-size word chunks with overlap, per page. Tables become their own chunks.

ponytail: size is counted in whitespace words, not model tokens (~0.75 words/token).
Good enough to make chunk_size an honest knob; swap in the embedder tokenizer if needed.
"""
import re

from app.ingest.parser import Page
from app.schemas import Chunk

_WORD = re.compile(r"\S+")


def _is_table_text(text: str) -> bool:
    lines = [l for l in text.splitlines() if l.strip()]
    return bool(lines) and sum(l.lstrip().startswith("|") for l in lines) / len(lines) >= 0.5


def _windows(text: str, size: int, overlap: int) -> list[tuple[int, int]]:
    """Char spans of word windows."""
    words = [(m.start(), m.end()) for m in _WORD.finditer(text)]
    if not words:
        return []
    step = max(1, size - overlap)
    out = []
    for i in range(0, len(words), step):
        w = words[i : i + size]
        out.append((w[0][0], w[-1][1]))
        if i + size >= len(words):
            break
    return out


def chunk_pages(pages: list[Page], doc_id: str, doc_name: str, size: int, overlap: int) -> list[Chunk]:
    chunks: list[Chunk] = []

    def add(page: int, text: str, start: int, end: int, is_table: bool) -> None:
        chunks.append(Chunk(
            chunk_id=f"{doc_id}-p{page}-c{len(chunks)}", doc_id=doc_id, doc_name=doc_name,
            page=page, text=text, is_table=is_table or _is_table_text(text), start=start, end=end,
        ))

    for p in pages:
        for s, e in _windows(p.text, size, overlap):
            add(p.page, p.text[s:e], s, e, False)
        for t in p.tables:
            for s, e in _windows_lines(t, size):
                add(p.page, t[s:e], -1, -1, True)  # -1: table text is not in page text
    return chunks


def _windows_lines(table_md: str, size: int) -> list[tuple[int, int]]:
    """Split a markdown table on row boundaries so no row is cut in half."""
    spans, start, words = [], 0, 0
    pos = 0
    for line in table_md.splitlines(keepends=True):
        n = len(line.split())
        if words and words + n > size:
            spans.append((start, pos))
            start, words = pos, 0
        words += n
        pos += len(line)
    if pos > start:
        spans.append((start, pos))
    return spans
