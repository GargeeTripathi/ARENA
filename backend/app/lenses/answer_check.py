"""Correctness vs gold. The judge helpers are shared with the generator filters and counterfactual lens."""
import re

from app.generator.prompts import CORRECTNESS
from app.lenses.base import LensContext
from app.llm import client
from app.schemas import LensResult, RagTrace, TestQuestion

_ABSTAIN = re.compile(
    r"\b(i don'?t know|i do not know|not (?:mentioned|specified|stated|provided|available|given|included)|"
    r"no (?:information|mention)|cannot (?:be )?(?:determine|answer|find)|can'?t (?:determine|answer|find)|"
    r"does not (?:say|specify|mention|contain|provide|state)|doesn'?t (?:say|specify|mention|contain|provide|state)|"
    r"unable to (?:determine|answer|find)|insufficient information)\b",
    re.I,
)


def is_abstention(answer: str) -> bool:
    return bool(_ABSTAIN.search(answer or "")) or not (answer or "").strip()


async def judge_correct(question: str, gold: str, answer: str) -> tuple[bool, str]:
    if is_abstention(answer):
        return False, "answer abstained"
    r = await client.complete_obj("judge", [{"role": "user", "content": CORRECTNESS.format(
        question=question, gold=gold, answer=answer)}])
    return bool(r.get("correct")), str(r.get("reason", ""))


# ---- lens -------------------------------------------------------------------
# Tier 1: free checks (abstention rule for unanswerable, lexical match for answerable).
# Tier 2: LLM judge, only when the free check was inconclusive.

NAME, TIER = "answer_check", 1
_STOP = set("the a an of to in for on at by is are was be with and or as it its this that from per".split())


def _nums(s: str) -> set[str]:
    return {n.replace(",", "").rstrip(".") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", s)}


def lexical_correct(gold: str, answer: str) -> bool | None:
    """True if the answer clearly contains the gold facts; None if we can't tell cheaply."""
    gn, an = _nums(gold), _nums(answer)
    gt = {t for t in re.findall(r"[a-z0-9]+", gold.lower()) if t not in _STOP}
    at = set(re.findall(r"[a-z0-9]+", answer.lower()))
    recall = len(gt & at) / len(gt) if gt else 0.0
    if gn and gn <= an and recall >= 0.5:
        return True
    if not gn and recall >= 0.8:
        return True
    return None


async def run(q: TestQuestion, trace: RagTrace, ctx: LensContext) -> LensResult:
    def res(verdict, conf, correct, method, sub=None, reason=""):
        return LensResult(lens=NAME, tier=ctx.tier, verdict=verdict, sub_cause=sub, confidence=conf,
                          evidence={"correct": correct, "method": method, "reason": reason})

    if q.qtype == "unanswerable":
        if is_abstention(trace.answer):
            return res("ok", 0.9, True, "rule", reason="correctly abstained")
        return res("abstention", 0.85, False, "rule", "abstention_failure", "answered an unanswerable question")
    if is_abstention(trace.answer):
        return res("uncertain", 0.0, False, "rule", reason="abstained on an answerable question")
    if ctx.tier == 1:
        if lexical_correct(q.gold_answer or "", trace.answer):
            return res("ok", 0.7, True, "lexical", reason="answer contains the gold facts")
        return res("uncertain", 0.0, None, "lexical", reason="inconclusive; needs judge")
    ok, reason = await judge_correct(q.question, q.gold_answer or "", trace.answer)
    # correctness says nothing about *why* it failed, so a wrong answer votes "uncertain"
    return res("ok", 0.7, True, "llm", reason=reason) if ok else res("uncertain", 0.0, False, "llm", reason=reason)
