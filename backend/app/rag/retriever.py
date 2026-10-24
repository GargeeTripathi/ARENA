"""dense / hybrid (dense+BM25 via RRF) / optional cross-encoder rerank. Always top-50 with ranks."""
from functools import lru_cache

from app import config
from app.ingest import indexer
from app.schemas import Chunk, RagConfig, RetrievedChunk


@lru_cache(maxsize=1)
def reranker():
    from sentence_transformers import CrossEncoder
    return CrossEncoder(config.RERANK_MODEL, device=config.DEVICE)


def _dense(question: str, corpus_id: str, cfg: RagConfig, n: int) -> list[tuple[str, float]]:
    col = indexer.chroma().get_collection(indexer.collection_name(corpus_id, cfg.chunk_size, cfg.chunk_overlap))
    n = min(n, col.count())
    if n == 0:
        return []
    r = col.query(query_embeddings=indexer.embed([question], query=True), n_results=n)
    return [(cid, 1.0 - d) for cid, d in zip(r["ids"][0], r["distances"][0])]  # cosine sim


def _bm25(question: str, corpus_id: str, cfg: RagConfig, chunks: list[Chunk], n: int) -> list[tuple[str, float]]:
    scores = indexer.bm25(corpus_id, cfg.chunk_size, cfg.chunk_overlap).get_scores(indexer.tokenize(question))
    order = sorted(range(len(chunks)), key=lambda i: -scores[i])[:n]
    return [(chunks[i].chunk_id, float(scores[i])) for i in order]


def _rrf(*lists: list[tuple[str, float]], k: int = 60) -> list[tuple[str, float]]:
    s: dict[str, float] = {}
    for lst in lists:
        for rank, (cid, _) in enumerate(lst):
            s[cid] = s.get(cid, 0.0) + 1.0 / (k + rank + 1)
    return sorted(s.items(), key=lambda x: -x[1])


def retrieve(question: str, corpus_id: str, cfg: RagConfig) -> list[RetrievedChunk]:
    chunks = indexer.build_index(corpus_id, cfg.chunk_size, cfg.chunk_overlap)  # reuses if present
    by_id = {c.chunk_id: c for c in chunks}
    n = config.TOP_N

    ranked = _dense(question, corpus_id, cfg, n)
    if cfg.retrieval == "hybrid":
        ranked = _rrf(ranked, _bm25(question, corpus_id, cfg, chunks, n))[:n]
    if cfg.rerank and ranked:
        scores = reranker().predict([(question, by_id[cid].text) for cid, _ in ranked])
        ranked = sorted(zip([c for c, _ in ranked], map(float, scores)), key=lambda x: -x[1])

    return [
        RetrievedChunk(chunk_id=cid, rank=i + 1, score=round(score, 4), text=by_id[cid].text, in_context=i < cfg.k)
        for i, (cid, score) in enumerate(ranked[:n])
    ]
