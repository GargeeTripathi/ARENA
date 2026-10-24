"""Corpus = folder of uploaded files. Index = (corpus_id, chunk_size, overlap) -> chunks + Chroma collection."""
import hashlib
import json
import logging
import re
from functools import lru_cache
from pathlib import Path

from app import config
from app.ingest.chunker import chunk_pages
from app.ingest.parser import ParseError, parse
from app.schemas import Chunk

log = logging.getLogger("indexer")
SUPPORTED = {".pdf", ".docx", ".txt", ".md"}
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@lru_cache(maxsize=1)
def embedder():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(config.EMBED_MODEL, device=config.DEVICE)


def embed(texts: list[str], query: bool = False) -> list[list[float]]:
    if query:
        texts = [BGE_QUERY_PREFIX + t for t in texts]
    return embedder().encode(texts, normalize_embeddings=True, batch_size=32).tolist()


@lru_cache(maxsize=1)
def chroma():
    import chromadb
    return chromadb.PersistentClient(path=str(config.CHROMA_DIR))


def corpus_dir(corpus_id: str) -> Path:
    return config.UPLOADS_DIR / corpus_id


def create_corpus(files: list[tuple[str, bytes]]) -> str:
    """Save uploaded (name, bytes) into a corpus folder. Same files -> same id (keeps caches warm)."""
    corpus_id = hashlib.sha1(b"".join(sorted(hashlib.sha1(b).digest() for _, b in files))).hexdigest()[:12]
    d = corpus_dir(corpus_id)
    d.mkdir(parents=True, exist_ok=True)
    for name, data in files:
        (d / Path(name).name).write_bytes(data)
    return corpus_id


def _chunks_path(corpus_id: str, size: int, overlap: int) -> Path:
    return corpus_dir(corpus_id) / f"_chunks_{size}_{overlap}.json"


def collection_name(corpus_id: str, size: int, overlap: int) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", f"c_{corpus_id}_{size}_{overlap}")[:63]


def build_index(corpus_id: str, size: int, overlap: int) -> list[Chunk]:
    """Parse + chunk + embed + upsert. Reuses an existing index for the same key."""
    path = _chunks_path(corpus_id, size, overlap)
    if path.exists():
        return load_chunks(corpus_id, size, overlap)

    chunks: list[Chunk] = []
    errors = []
    for f in sorted(corpus_dir(corpus_id).iterdir()):
        if f.suffix.lower() not in SUPPORTED or f.name.startswith("_"):
            continue
        doc_id = hashlib.sha1(f.read_bytes()).hexdigest()[:10]
        try:
            pages = parse(f)
        except ParseError as e:
            log.warning("%s", e)
            errors.append(str(e))
            continue
        chunks += chunk_pages(pages, doc_id, f.name, size, overlap)
    if not chunks:
        raise ParseError("no usable text in corpus. " + "; ".join(errors))

    col = chroma().get_or_create_collection(collection_name(corpus_id, size, overlap),
                                            metadata={"hnsw:space": "cosine"})
    vecs = embed([c.text for c in chunks])
    for i in range(0, len(chunks), 500):
        b = chunks[i : i + 500]
        col.upsert(ids=[c.chunk_id for c in b], embeddings=vecs[i : i + 500], documents=[c.text for c in b])
    path.write_text(json.dumps([c.model_dump() for c in chunks]), encoding="utf-8")
    log.info("indexed %s: %d chunks (size=%d overlap=%d)", corpus_id, len(chunks), size, overlap)
    return chunks


@lru_cache(maxsize=32)
def _load(corpus_id: str, size: int, overlap: int) -> tuple[Chunk, ...]:
    raw = json.loads(_chunks_path(corpus_id, size, overlap).read_text(encoding="utf-8"))
    return tuple(Chunk(**c) for c in raw)


def load_chunks(corpus_id: str, size: int, overlap: int) -> list[Chunk]:
    return list(_load(corpus_id, size, overlap))


@lru_cache(maxsize=32)
def bm25(corpus_id: str, size: int, overlap: int):
    from rank_bm25 import BM25Okapi
    return BM25Okapi([tokenize(c.text) for c in _load(corpus_id, size, overlap)])


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", text.lower())
