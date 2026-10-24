"""Tier 3: re-run the generator with the context swapped. Gold-only first; no-context + shuffled only if still ambiguous.

The proof: if the answer becomes correct when we hand the generator the gold chunk, retrieval was the problem.
If it stays wrong with the gold chunk in hand, the generator is at fault."""
from app.lenses.answer_check import judge_correct
from app.lenses.base import LensContext, in_context
from app.rag.pipeline import generate
from app.schemas import LensResult, RagTrace, TestQuestion

NAME, TIER = "counterfactual", 3


async def _try(condition: str, q: TestQuestion, contexts: list[str], style: str) -> dict:
    ans = await generate(q.question, contexts, style)
    correct, reason = await judge_correct(q.question, q.gold_answer or "", ans)
    return {"condition": condition, "answer": ans, "correct": correct, "reason": reason, "n_chunks": len(contexts)}


async def run(q: TestQuestion, trace: RagTrace, ctx: LensContext) -> LensResult:
    def res(verdict, conf, sub=None):
        return LensResult(lens=NAME, tier=TIER, verdict=verdict, sub_cause=sub, confidence=conf, evidence={"runs": runs})

    if q.qtype == "unanswerable" or not ctx.gold_ids:
        runs: list[dict] = []
        return res("uncertain", 0.0)

    style = trace.config.prompt_style
    prev = ctx.results.get("answer_check")
    original_correct = prev.evidence.get("correct") if prev else None
    runs = [{"condition": "original", "answer": trace.answer, "correct": original_correct,
             "n_chunks": len(in_context(trace))}]

    gold_texts = [ctx.chunks[g].text for g in ctx.gold_ids if g in ctx.chunks]
    gold = await _try("gold_only", q, gold_texts, style)
    runs.append(gold)

    fx, gr = ctx.results.get("forensics"), ctx.results.get("grounding")
    if original_correct is False and gold["correct"]:
        sub = fx.sub_cause if fx and fx.verdict == "retrieval" else "wrong_chunk_reliance"
        return res("retrieval", 0.95, sub)  # proven: same generator, right chunk -> right answer
    if original_correct is False and not gold["correct"]:
        sub = "hallucination" if gr and gr.verdict == "generation" else "misread_incomplete"
        return res("generation", 0.9, sub)

    # Ambiguous (original was right, or we couldn't tell): probe memory and position sensitivity.
    nc = await _try("no_context", q, [], style)
    runs.append(nc)
    ctx_texts = [c.text for c in in_context(trace)]
    if len(ctx_texts) > 1:
        runs.append(await _try("shuffled", q, ctx_texts[::-1], style))
    ungrounded = any(r.verdict == "generation" for n, r in ctx.results.items() if n in ("grounding", "span_detector"))
    if nc["correct"] and ungrounded:
        return res("generation", 0.85, "lucky_guess" if original_correct else "parametric_answer")
    if original_correct:
        return res("ok", 0.8)
    return res("uncertain", 0.0)
