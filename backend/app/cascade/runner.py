"""Tiered cascade: cheap lenses on everything, LLM lenses only where Tier 1 can't decide."""
import asyncio
import logging
import time

from app.cascade.consensus import consensus, resolved
from app.cascade.prescriptions import prescribe
from app.generator.generate import gold_chunk_ids_for
from app.ingest import indexer
from app.lenses import answer_check, counterfactual, forensics, grounding, span_detector, sufficiency
from app.lenses.base import LensContext, execute
from app.schemas import Diagnosis, RagTrace, TestQuestion

log = logging.getLogger("cascade")

TIERS = {
    1: [forensics, span_detector, answer_check],
    2: [grounding, sufficiency, answer_check],  # answer_check re-runs with the LLM judge only if Tier 1 was inconclusive
    3: [counterfactual],
}


def _wants(lens, tier: int, ctx: LensContext) -> bool:
    if lens is answer_check and tier > 1:
        prev = ctx.results.get("answer_check")
        return prev is None or prev.evidence.get("correct") is None
    return True


async def diagnose(q: TestQuestion, trace: RagTrace, corpus_id: str) -> Diagnosis:
    t = time.perf_counter()
    cfg = trace.config
    chunks = {c.chunk_id: c for c in indexer.load_chunks(corpus_id, cfg.chunk_size, cfg.chunk_overlap)}
    ctx = LensContext(corpus_id=corpus_id, chunks=chunks, gold_ids=gold_chunk_ids_for(q, list(chunks.values())))

    tiers_run = []
    for tier, lenses in TIERS.items():
        todo = [l for l in lenses if _wants(l, tier, ctx)]
        if not todo:
            continue
        ctx.tier = tier
        for r in await asyncio.gather(*(execute(l, q, trace, ctx) for l in todo)):
            ctx.results[r.lens] = r  # a later run of the same lens replaces the earlier one
        tiers_run.append(tier)
        if resolved(list(ctx.results.values()), tier):
            break

    d = consensus(q, list(ctx.results.values()))
    d.max_tier_reached = max(tiers_run)
    p = prescribe(d)
    d.prescription = p[0] if p else None
    log.info("%s | tiers %s | calls %d | %s/%s | %dms", q.qid, ",".join(map(str, tiers_run)), d.total_llm_calls,
             d.verdict, d.sub_cause, int((time.perf_counter() - t) * 1000))
    return d


async def evaluate(corpus_id: str, questions: list[TestQuestion], cfg, on_done=None) -> dict:
    """RAG + cascade over every question. `on_done(trace, diagnosis)` fires as each finishes."""
    from app.metrics import aggregate
    from app.rag.pipeline import answer

    indexer.build_index(corpus_id, cfg.chunk_size, cfg.chunk_overlap)
    t = time.perf_counter()
    traces, diagnoses = [], []

    async def one(q: TestQuestion):
        tr = await answer(q.qid, q.question, corpus_id, cfg)
        d = await diagnose(q, tr, corpus_id)
        traces.append(tr)
        diagnoses.append(d)
        if on_done:
            on_done(tr, d)

    await asyncio.gather(*(one(q) for q in questions))
    order = {q.qid: i for i, q in enumerate(questions)}
    traces.sort(key=lambda x: order[x.qid])
    diagnoses.sort(key=lambda x: order[x.qid])
    return {
        "traces": traces, "diagnoses": diagnoses,
        "scorecards": aggregate.scorecards(questions, traces, diagnoses),
        "cost": aggregate.cost(diagnoses, int((time.perf_counter() - t) * 1000)),
    }
