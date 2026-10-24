"""Weighted vote of lens results -> one Diagnosis."""
from app import config
from app.lenses.base import RETRIEVAL_SCOPE
from app.schemas import Diagnosis, LensResult, TestQuestion


def answer_correct(results: list[LensResult]) -> bool | None:
    for r in results:
        if r.lens == "answer_check":
            return r.evidence.get("correct")
    return None


def contradicts(a: LensResult, b: LensResult) -> bool:
    if "uncertain" in (a.verdict, b.verdict) or a.verdict == b.verdict:
        return False
    # retrieval-scope "ok" only says retrieval was fine: compatible with a generation/abstention fault
    for x, y in ((a, b), (b, a)):
        if x.verdict == "ok" and x.lens in RETRIEVAL_SCOPE and y.verdict in ("generation", "abstention"):
            return False
    return True


def resolved(results: list[LensResult], tier: int) -> bool:
    """A confident (>=0.8) verdict that no other fairly confident (>=0.6) lens contradicts.
    After Tier 1, any answer not known to be correct escalates to Tier 2 regardless."""
    correct = answer_correct(results)
    if tier == 1 and correct is not True:
        return False
    for s in results:
        if s.confidence >= 0.8 and s.verdict != "uncertain" and not (s.verdict == "ok" and correct is False):
            if not any(o is not s and o.confidence >= 0.6 and contradicts(s, o) for o in results):
                return True
    return False


def consensus(q: TestQuestion, results: list[LensResult], weights: dict[str, float] | None = None) -> Diagnosis:
    weights = weights or config.LENS_WEIGHTS
    correct = answer_correct(results)
    by = {r.lens: r for r in results}

    scores: dict[str, float] = {}
    for r in results:
        if r.verdict == "uncertain" or r.confidence <= 0:
            continue
        if r.verdict == "ok" and correct is False:  # a wrong answer can't be "ok"
            continue
        scores[r.verdict] = scores.get(r.verdict, 0.0) + weights.get(r.lens, 1.0) * r.confidence

    if scores:
        verdict = max(scores, key=scores.get)
        confidence = scores[verdict] / sum(scores.values())
    else:
        verdict, confidence = "uncertain", 0.0

    voters = sorted((r for r in results if r.verdict == verdict and r.sub_cause),
                    key=lambda r: -weights.get(r.lens, 1.0) * r.confidence)
    sub_cause = voters[0].sub_cause if voters else None

    # Correct but not grounded: if the model also knew it closed-book, it's a lucky/parametric answer.
    grounded = all(by[n].verdict == "ok" for n in ("grounding", "span_detector") if n in by)
    if correct and not grounded and q.closed_book_correct:
        verdict, sub_cause = "generation", "lucky_guess"
    elif correct and grounded and verdict != "abstention":
        verdict, sub_cause = "ok", None

    # Answering an unanswerable question is the root failure; any made-up content is its symptom.
    if q.qtype == "unanswerable" and correct is False:
        verdict, sub_cause = "abstention", "abstention_failure"

    if verdict == "generation" and not sub_cause:
        sub_cause = "misread_incomplete" if correct is False and grounded else "hallucination"

    g, s = by.get("grounding"), by.get("span_detector")
    disagree = bool(g and s and g.confidence >= 0.7 and s.confidence >= 0.7 and g.verdict != s.verdict
                    and "uncertain" not in (g.verdict, s.verdict))
    # An "unanswerable" test question whose answer is fully grounded may be mislabelled: ask a human.
    suspect_label = q.qtype == "unanswerable" and bool(g) and g.verdict == "ok" and g.confidence >= 0.8
    return Diagnosis(
        qid=q.qid, verdict=verdict, sub_cause=sub_cause, confidence=round(confidence, 3),
        needs_review=confidence < 0.6 or disagree or suspect_label, lens_results=results,
        max_tier_reached=max((r.tier for r in results), default=1), prescription=None,
        total_llm_calls=sum(r.llm_calls for r in results), total_cached_calls=sum(r.cached_calls for r in results),
        total_latency_ms=sum(r.latency_ms for r in results),
    )
