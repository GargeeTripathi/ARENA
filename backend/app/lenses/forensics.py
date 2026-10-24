"""Tier 1: where did the gold chunk land in the ranked list? Zero LLM calls."""
from app.lenses.base import LensContext
from app.schemas import LensResult, RagTrace, TestQuestion

NAME, TIER = "forensics", 1
K_SWEEP = (3, 5, 10, 20)


def _split_evidence(q: TestQuestion, ctx: LensContext) -> bool:
    """Evidence span cut across chunks (no single chunk holds all of it), or gold is a table fragment."""
    gold = [ctx.chunks[g] for g in ctx.gold_ids if g in ctx.chunks]
    if q.gold_span and len(gold) >= 2:
        s, e = q.gold_span["start"], q.gold_span["end"]
        if not any(c.start <= s and c.end >= e for c in gold):
            return True
    order = list(ctx.chunks.values())  # chunks are stored in document order
    pos = {c.chunk_id: i for i, c in enumerate(order)}
    for c in gold:  # table fragment: a neighbouring chunk of the same doc is also table
        if c.is_table:
            i = pos[c.chunk_id]
            if any(0 <= j < len(order) and order[j].doc_id == c.doc_id and order[j].is_table for j in (i - 1, i + 1)):
                return True
    return False


async def run(q: TestQuestion, trace: RagTrace, ctx: LensContext) -> LensResult:
    k = trace.config.k
    if not ctx.gold_ids:  # unanswerable: no opinion
        return LensResult(lens=NAME, tier=TIER, verdict="ok", confidence=0.0, evidence={"gold_rank": None, "k": k})

    ranks = {r.chunk_id: r.rank for r in trace.retrieved_top50}
    gold_ranks = sorted(ranks[g] for g in ctx.gold_ids if g in ranks)
    best = gold_ranks[0] if gold_ranks else None
    evidence = {
        "gold_rank": best, "k": k, "gold_chunk_ids": ctx.gold_ids,
        "k_sweep": {kk: best is not None and best <= kk for kk in K_SWEEP},
    }
    all_in = len(gold_ranks) == len(ctx.gold_ids) and all(r <= k for r in gold_ranks)
    if _split_evidence(q, ctx) and not all_in:
        evidence["split"] = True
        return LensResult(lens=NAME, tier=TIER, verdict="retrieval", sub_cause="chunking_miss",
                          confidence=0.85, evidence=evidence)
    if best is not None and best <= k:
        return LensResult(lens=NAME, tier=TIER, verdict="ok", confidence=0.8, evidence=evidence)
    if best is not None and best <= 20:
        return LensResult(lens=NAME, tier=TIER, verdict="retrieval", sub_cause="ranking_miss",
                          confidence=0.85, evidence=evidence)
    return LensResult(lens=NAME, tier=TIER, verdict="retrieval", sub_cause="recall_miss",
                      confidence=0.9, evidence=evidence)
