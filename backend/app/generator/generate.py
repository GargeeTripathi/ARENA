"""Typed test questions, each tied to a gold chunk + exact evidence span.

Questions are generated from small, focused chunks (GEN_CHUNKING). Gold is stored as a char span,
so `gold_chunk_ids_for()` can find the gold chunks again under ANY chunk_size the RAG under test uses.
"""
import asyncio
import hashlib
import json
import logging
import re

from app import config
from app.generator import filters
from app.generator.prompts import ANSWERABLE, GEN_SYSTEM, UNANSWERABLE
from app.ingest import indexer
from app.llm import client
from app.rag.retriever import retrieve
from app.schemas import Chunk, RagConfig, TestQuestion

log = logging.getLogger("generator")
GEN_CHUNKING = (256, 32)
ANSWERABLE_TYPES = ("single_hop", "numeric")


def _items(r, where: str) -> list:
    """Models return either {"questions": [...]} or a bare [...]; accept both, and say so if neither."""
    items = r if isinstance(r, list) else r.get("questions") if isinstance(r, dict) else None
    if not isinstance(items, list):
        log.warning("no question list in model output for %s: %s", where, str(r)[:200])
        return []
    return items


def _qid(text: str) -> str:
    return "q_" + hashlib.sha1(text.strip().lower().encode()).hexdigest()[:8]


def _toks(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s.lower())


def locate(evidence: str, chunk: Chunk) -> tuple[int, int] | None:
    """Char span of `evidence` inside chunk.text: exact, whitespace-flexible, then best line/sentence (>=80% token recall)."""
    ev = evidence.strip().strip('"').strip()
    if not ev:
        return None
    i = chunk.text.find(ev)
    if i >= 0:
        return i, i + len(ev)
    m = re.search(r"\s+".join(map(re.escape, ev.split())), chunk.text)
    if m:
        return m.span()
    want = set(_toks(ev))
    if not want:
        return None
    best, best_score = None, 0.0
    for m in re.finditer(r"[^\n]+", chunk.text):  # lines (table rows) ...
        for s in re.finditer(r"[^.!?]+[.!?]?", m.group()):  # ... and sentences inside them
            score = len(want & set(_toks(s.group()))) / len(want)
            if score > best_score:
                best, best_score = (m.start() + s.start(), m.start() + s.end()), score
        score = len(want & set(_toks(m.group()))) / len(want)
        if score > best_score:  # a sentence wins ties: tighter span
            best, best_score = m.span(), score
    return best if best_score >= 0.8 else None


def gold_chunk_ids_for(q: TestQuestion, chunks: list[Chunk]) -> list[str]:
    """Gold chunks of q in a given chunking = chunks overlapping its evidence span."""
    if not q.gold_span:
        return list(q.gold_chunk_ids)
    g = q.gold_span
    return [c.chunk_id for c in chunks
            if c.doc_id == g["doc_id"] and c.page == g["page"] and c.start >= 0
            and c.start < g["end"] and c.end > g["start"]]


async def _answerable_for_chunk(c: Chunk, n: int, types: list[str]) -> list[TestQuestion]:
    n_single = n if "single_hop" in types else 0
    n_numeric = n if "numeric" in types else 0
    try:
        r = await client.complete_json("gen", [
            {"role": "system", "content": GEN_SYSTEM},
            {"role": "user", "content": ANSWERABLE.format(
                n_single=n_single, n_numeric=n_numeric, doc_name=c.doc_name, text=c.text)},
        ])
    except Exception as e:  # malformed JSON after repair, network etc: skip this chunk
        log.warning("generation failed for %s: %s", c.chunk_id, e)
        return []
    out = []
    for item in _items(r, c.chunk_id):
        if not isinstance(item, dict):
            continue
        qtype, question, answer = item.get("qtype"), str(item.get("question", "")).strip(), str(item.get("answer", "")).strip()
        if qtype not in types or qtype not in ANSWERABLE_TYPES or not question or not answer:
            continue
        span = locate(str(item.get("evidence", "")), c)
        if span is None or c.start < 0:
            log.info("drop (evidence not found): %s", question)
            continue
        if filters.leaks(question, c.text):
            log.info("drop (leakage): %s", question)
            continue
        s, e = span
        out.append(TestQuestion(
            qid=_qid(question), qtype=qtype, question=question, gold_answer=answer,
            gold_chunk_ids=[c.chunk_id], evidence=c.text[s:e],
            gold_span={"doc_id": c.doc_id, "page": c.page, "start": c.start + s, "end": c.start + e},
        ))
    return out


async def _unanswerable_for_doc(chunks: list[Chunk], n: int) -> list[TestQuestion]:
    c = chunks[len(chunks) // 2]
    try:
        r = await client.complete_json("gen", [
            {"role": "system", "content": GEN_SYSTEM},
            {"role": "user", "content": UNANSWERABLE.format(n=n, doc_name=c.doc_name, text=c.text)},
        ])
    except Exception as e:
        log.warning("unanswerable generation failed for %s: %s", c.doc_name, e)
        return []
    qs = [str(x.get("question", "") if isinstance(x, dict) else x).strip() for x in _items(r, c.doc_name)]
    qs = [q for q in qs if q]
    return [TestQuestion(qid=_qid(q), qtype="unanswerable", question=q, gold_answer=None, gold_chunk_ids=[])
            for q in qs[:n]]


async def _keep(q: TestQuestion, corpus_id: str, by_id: dict[str, Chunk]) -> TestQuestion | None:
    try:
        if q.qtype == "unanswerable":
            # must NOT be answerable from what a good retriever would find
            top = [r.text for r in retrieve(q.question, corpus_id, RagConfig())[:5]]
            return None if await filters.answerable(q.question, top) else q
        if not await filters.answerable(q.question, [by_id[q.gold_chunk_ids[0]].text]):
            log.info("drop (judge: not answerable): %s", q.question)
            return None
        q.closed_book_correct = await filters.closed_book_correct(q.question, q.gold_answer or "")
        return q
    except Exception as e:
        log.warning("filter failed for %s: %s", q.qid, e)
        return None


async def generate_questions(corpus_id: str, n_per_type: int = 2,
                             types: list[str] | None = None, merge: bool = False) -> list[TestQuestion]:
    """n_per_type = per chunk for answerable types, per document for unanswerable.
    merge=True adds the new questions to the saved set instead of replacing it."""
    types = types or ["single_hop", "numeric", "unanswerable"]
    chunks = indexer.build_index(corpus_id, *GEN_CHUNKING)
    by_id = {c.chunk_id: c for c in chunks}
    indexer.build_index(corpus_id, RagConfig().chunk_size, RagConfig().chunk_overlap)  # for unanswerable check

    want_answerable = any(t in ANSWERABLE_TYPES for t in types)
    eligible = [c for c in chunks if c.start >= 0] if want_answerable else []
    cap = config.GEN_MAX_CHUNKS
    if cap and len(eligible) > cap:  # spread the sample evenly over the corpus
        eligible = [eligible[round(i * (len(eligible) - 1) / (cap - 1))] for i in range(cap)] if cap > 1 else eligible[:1]
    jobs = [_answerable_for_chunk(c, n_per_type, types) for c in eligible]
    if "unanswerable" in types:
        docs: dict[str, list[Chunk]] = {}
        for c in chunks:
            docs.setdefault(c.doc_id, []).append(c)
        jobs += [_unanswerable_for_doc(cs, n_per_type) for cs in docs.values()]
    candidates = [q for batch in await asyncio.gather(*jobs) for q in batch]

    keep = filters.dedup([q.question for q in candidates])
    candidates = [candidates[i] for i in keep]
    seen: set[str] = set()
    candidates = [q for q in candidates if not (q.qid in seen or seen.add(q.qid))]

    existing = load_questions(corpus_id) if merge else []
    have = {q.qid for q in existing}
    candidates = [q for q in candidates if q.qid not in have]
    kept = [q for q in await asyncio.gather(*(_keep(q, corpus_id, by_id) for q in candidates)) if q]
    log.info("questions: %d candidates -> %d kept", len(candidates), len(kept))
    kept = existing + kept
    save_questions(corpus_id, kept)
    return kept


def _qpath(corpus_id: str):
    return indexer.corpus_dir(corpus_id) / "_questions.json"


def save_questions(corpus_id: str, qs: list[TestQuestion]) -> None:
    _qpath(corpus_id).write_text(json.dumps([q.model_dump() for q in qs], indent=1), encoding="utf-8")


def load_questions(corpus_id: str) -> list[TestQuestion]:
    p = _qpath(corpus_id)
    return [TestQuestion(**q) for q in json.loads(p.read_text(encoding="utf-8"))] if p.exists() else []
