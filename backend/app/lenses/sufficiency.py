"""Tier 2: does the in-context text contain enough to answer? One short judge call."""
from app.lenses.answer_check import is_abstention
from app.lenses.base import LensContext, in_context
from app.llm import client
from app.schemas import LensResult, RagTrace, TestQuestion

NAME, TIER = "sufficiency", 2

PROMPT = """Given ONLY the passages below, is there enough information to answer the question?

Question: {question}

Passages:
{passages}

Return JSON: {{"sufficient": true or false, "reason": "one short sentence"}}"""


async def run(q: TestQuestion, trace: RagTrace, ctx: LensContext) -> LensResult:
    passages = "\n\n".join(f"[{i + 1}] {c.text}" for i, c in enumerate(in_context(trace))) or "(no passages)"
    r = await client.complete_json("judge", [{"role": "user", "content": PROMPT.format(
        question=q.question, passages=passages)}])
    sufficient = bool(r.get("sufficient"))
    ev = {"sufficient": sufficient, "reason": str(r.get("reason", ""))}

    def res(verdict, conf, sub=None):
        return LensResult(lens=NAME, tier=TIER, verdict=verdict, sub_cause=sub, confidence=conf, evidence=ev)

    if q.qtype == "unanswerable":
        if sufficient:  # judge thinks it IS answerable: the test question itself is suspect
            return res("uncertain", 0.0)
        return res("ok", 0.8) if is_abstention(trace.answer) else res("abstention", 0.8, "abstention_failure")
    return res("ok", 0.6) if sufficient else res("retrieval", 0.7)
