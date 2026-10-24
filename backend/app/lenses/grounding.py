"""Tier 2: per-sentence support check with MiniCheck (Flan-T5-Large); HHEM-2.1-Open as fallback. No LLM.

Each answer sentence is scored against every in-context chunk separately (to find the chunk that supports it)
and against all of them concatenated (for claims that need two chunks). Supported = best score > 0.5."""
import asyncio
import logging
import threading
from functools import lru_cache

from app.lenses.answer_check import is_abstention
from app.lenses.base import LensContext, in_context
from app.schemas import LensResult, RagTrace, TestQuestion

NAME, TIER = "grounding", 2
log = logging.getLogger("grounding")
_lock = threading.Lock()  # ponytail: one inference at a time; fine on CPU


@lru_cache(maxsize=1)
def scorer():
    """-> (name, fn(pairs: list[(doc, claim)]) -> list[float]) or None."""
    try:
        from minicheck.minicheck import MiniCheck
        mc = MiniCheck(model_name="flan-t5-large")

        def score_mc(pairs):
            _, probs, _, _ = mc.score(docs=[d for d, _ in pairs], claims=[c for _, c in pairs])
            return [float(p) for p in probs]
        return "minicheck-flan-t5-large", score_mc
    except Exception as e:
        log.warning("MiniCheck failed to load (%s); falling back to HHEM", e)
    try:
        from transformers import AutoModelForSequenceClassification
        hhem = AutoModelForSequenceClassification.from_pretrained(
            "vectara/hallucination_evaluation_model", trust_remote_code=True)
        hhem.eval()

        def score_hhem(pairs):
            return [float(x) for x in hhem.predict(pairs)]
        return "hhem-2.1-open", score_hhem
    except Exception as e:
        log.warning("HHEM failed to load too (%s); grounding will abstain", e)
        return None


def _score(pairs: list[tuple[str, str]]):
    s = scorer()
    if s is None:
        return None, None
    with _lock:
        return s[0], s[1](pairs)


async def run(q: TestQuestion, trace: RagTrace, ctx: LensContext) -> LensResult:
    chunks = in_context(trace)
    claims = [(i, s) for i, s in enumerate(trace.answer_sentences) if not is_abstention(s)]
    if not chunks or not claims:
        note = "no context" if not chunks else "answer makes no claims (abstained)"
        sentences = [{"text": s, "supported": True, "score": None, "best_chunk_id": None} for s in trace.answer_sentences]
        return LensResult(lens=NAME, tier=TIER, verdict="uncertain" if not chunks else "ok",
                          confidence=0.0 if not chunks else 0.6, evidence={"sentences": sentences, "note": note})

    joined = "\n\n".join(c.text for c in chunks)
    pairs = [(c.text, s) for _, s in claims for c in chunks] + [(joined, s) for _, s in claims]
    model, scores = await asyncio.to_thread(_score, pairs)
    if scores is None:
        return LensResult(lens=NAME, tier=TIER, verdict="uncertain", confidence=0.0, evidence={"error": "no checker loaded"})

    n = len(chunks)
    out = {i: {"text": s, "supported": True, "score": None, "best_chunk_id": None}
           for i, s in enumerate(trace.answer_sentences)}  # abstention sentences stay "supported"
    for j, (i, s) in enumerate(claims):
        per_chunk = scores[j * n:(j + 1) * n]
        best = max(range(n), key=lambda x: per_chunk[x])
        top = max(per_chunk[best], scores[len(claims) * n + j])
        out[i] = {"text": s, "supported": top > 0.5, "score": round(top, 3), "best_chunk_id": chunks[best].chunk_id}

    sentences = [out[i] for i in range(len(trace.answer_sentences))]
    frac_bad = sum(not x["supported"] for x in sentences) / len(sentences)
    ev = {"sentences": sentences, "model": model, "unsupported_fraction": round(frac_bad, 3)}
    if frac_bad > 0:
        return LensResult(lens=NAME, tier=TIER, verdict="generation", sub_cause="hallucination",
                          confidence=round(min(0.95, 0.75 + 0.2 * frac_bad), 3), evidence=ev)
    return LensResult(lens=NAME, tier=TIER, verdict="ok", confidence=0.8, evidence=ev)
