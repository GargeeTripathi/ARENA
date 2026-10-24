"""Tier 1: LettuceDetect token classifier marks answer spans not supported by the in-context chunks. No LLM."""
import asyncio
import logging
import threading
from functools import lru_cache

from app import config
from app.lenses.base import LensContext, in_context
from app.llm import client
from app.schemas import LensResult, RagTrace, TestQuestion

NAME, TIER = "span_detector", 1
MODEL = "KRLabsOrg/lettucedect-base-modernbert-en-v1"
log = logging.getLogger("span_detector")
_lock = threading.Lock()  # ponytail: one inference at a time; fine on CPU, per-worker models if on GPU


@lru_cache(maxsize=1)
def detector():
    try:
        from lettucedetect.models.inference import HallucinationDetector
        return HallucinationDetector(method="transformer", model_path=MODEL, device=config.DEVICE)
    except Exception as e:
        log.warning("LettuceDetect failed to load (%s); span_detector will abstain", e)
        return None


GROUP_WORDS = 2400  # ~3.3k tokens: a group plus prompt fits the detector's 4k window


def _groups(contexts: list[str]) -> list[list[str]]:
    groups, cur, n = [], [], 0
    for c in contexts:
        w = len(c.split())
        if cur and n + w > GROUP_WORDS:
            groups.append(cur)
            cur, n = [], 0
        cur.append(c)
        n += w
    return groups + [cur] if cur else groups


def _min_merge(answer: str, per_group: list[list[dict]]) -> list[dict]:
    """A character is hallucinated only if EVERY context group flags it (support from any chunk is enough).
    LettuceDetect's own long-context mode does the opposite (max), flagging answers one group can't see."""
    prob = [min(max((s["confidence"] for s in spans if s["start"] <= i < s["end"]), default=0.0) for spans in per_group)
            for i in range(len(answer))]
    out, i = [], 0
    while i < len(answer):
        if prob[i] > 0:
            j = i
            while j < len(answer) and prob[j] > 0:
                j += 1
            out.append({"start": i, "end": j, "text": answer[i:j], "confidence": max(prob[i:j])})
            i = j
        else:
            i += 1
    return out


def _predict(contexts: list[str], question: str, answer: str) -> list[dict] | None:
    def infer():
        with _lock:  # also guards the one-time model load (lru_cache isn't thread-safe)
            det = detector()
            if det is None:
                return None
            groups = _groups(contexts)
            if len(groups) == 1:
                return det.predict(context=contexts, question=question, answer=answer, output_format="spans")
            per = [det.predict(context=g, question=question, answer=answer, output_format="spans") for g in groups]
            return _min_merge(answer, per)
    return client.memo(MODEL + ":v2", [contexts, question, answer], infer)


async def run(q: TestQuestion, trace: RagTrace, ctx: LensContext) -> LensResult:
    contexts = [c.text for c in in_context(trace)]
    if not contexts or not trace.answer.strip():
        return LensResult(lens=NAME, tier=TIER, verdict="uncertain", confidence=0.0, evidence={"spans": [], "note": "no context"})
    raw = await asyncio.to_thread(_predict, contexts, q.question, trace.answer)
    if raw is None:
        return LensResult(lens=NAME, tier=TIER, verdict="uncertain", confidence=0.0, evidence={"spans": [], "error": "model not loaded"})
    spans = [{"start": s["start"], "end": s["end"], "text": s.get("text", trace.answer[s["start"]:s["end"]]),
              "prob": round(float(s.get("confidence", 0.0)), 3)} for s in raw]
    bad = [s for s in spans if s["prob"] > 0.5]
    if bad:
        return LensResult(lens=NAME, tier=TIER, verdict="generation", sub_cause="hallucination",
                          confidence=max(s["prob"] for s in bad), evidence={"spans": spans})
    return LensResult(lens=NAME, tier=TIER, verdict="ok", confidence=0.7, evidence={"spans": spans})
