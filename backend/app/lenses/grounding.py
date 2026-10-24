"""Tier 2: per-sentence support check with MiniCheck (Flan-T5-Large); HHEM-2.1-Open as fallback. No LLM.

Each answer sentence is scored against every in-context chunk separately (to find the chunk that supports it)
and against all of them concatenated (for claims that need two chunks). Supported = best score > 0.5."""
import asyncio
import logging
import threading
from functools import lru_cache

from app import config
from app.lenses.answer_check import is_abstention
from app.lenses.base import LensContext, in_context
from app.llm import client
from app.schemas import LensResult, RagTrace, TestQuestion

NAME, TIER = "grounding", 2
log = logging.getLogger("grounding")
_lock = threading.Lock()  # ponytail: one inference at a time; fine on CPU


@lru_cache(maxsize=1)
def scorer():
    """-> (name, fn(pairs: list[(doc, claim)]) -> list[float]) or None."""
    try:
        if config.GROUNDING_MODEL != "minicheck":
            raise RuntimeError(f"GROUNDING_MODEL={config.GROUNDING_MODEL}")
        import minicheck.inference as mi
        from minicheck.minicheck import MiniCheck
        from transformers import AutoModelForSeq2SeqLM

        class _InRam:  # MiniCheck asks for device_map="auto", which offloads to disk (and fails) when RAM is tight
            @staticmethod
            def from_pretrained(*a, **k):
                k.pop("device_map", None)
                return AutoModelForSeq2SeqLM.from_pretrained(*a, **k)

        mi.AutoModelForSeq2SeqLM = _InRam
        mc = MiniCheck(model_name="flan-t5-large")

        def score_mc(pairs):
            _, probs, _, _ = mc.score(docs=[d for d, _ in pairs], claims=[c for _, c in pairs])
            return [float(p) for p in probs]
        return "minicheck-flan-t5-large", score_mc
    except Exception as e:
        log.warning("MiniCheck not used (%s); using HHEM", e)
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
    def infer():
        with _lock:  # also guards the one-time model load (lru_cache isn't thread-safe)
            s = scorer()
            return None if s is None else (s[0], s[1](pairs))
    return client.memo("grounding", pairs, infer) or (None, None)


def _windows(text: str, size: int = 300, stride: int = 250) -> list[str]:
    words = text.split()
    return [" ".join(words[i:i + size]) for i in range(0, max(len(words) - size, 0) + stride, stride)
            if words[i:i + size]] or [text]


async def run(q: TestQuestion, trace: RagTrace, ctx: LensContext) -> LensResult:
    chunks = in_context(trace)
    claims = [(i, s) for i, s in enumerate(trace.answer_sentences) if not is_abstention(s)]
    if not chunks or not claims:
        note = "no context" if not chunks else "answer makes no claims (abstained)"
        sentences = [{"text": s, "supported": True, "score": None, "best_chunk_id": None} for s in trace.answer_sentences]
        return LensResult(lens=NAME, tier=TIER, verdict="uncertain" if not chunks else "ok",
                          confidence=0.0 if not chunks else 0.6, evidence={"sentences": sentences, "note": note})

    # Checkers read ~512 tokens, so score each sentence against short windows of every chunk; best window wins.
    windows = [(c.chunk_id, w) for c in chunks for w in _windows(c.text)]
    pairs = [(w, s) for _, s in claims for _, w in windows]
    model, scores = await asyncio.to_thread(_score, pairs)
    if scores is None:
        return LensResult(lens=NAME, tier=TIER, verdict="uncertain", confidence=0.0, evidence={"error": "no checker loaded"})

    n = len(windows)
    out = {i: {"text": s, "supported": True, "score": None, "best_chunk_id": None}
           for i, s in enumerate(trace.answer_sentences)}  # abstention sentences stay "supported"
    for j, (i, s) in enumerate(claims):
        row = scores[j * n:(j + 1) * n]
        best = max(range(n), key=lambda x: row[x])
        out[i] = {"text": s, "supported": row[best] > 0.5, "score": round(row[best], 3), "best_chunk_id": windows[best][0]}

    sentences = [out[i] for i in range(len(trace.answer_sentences))]
    frac_bad = sum(not x["supported"] for x in sentences) / len(sentences)
    ev = {"sentences": sentences, "model": model, "unsupported_fraction": round(frac_bad, 3)}
    if frac_bad > 0:
        return LensResult(lens=NAME, tier=TIER, verdict="generation", sub_cause="hallucination",
                          confidence=round(min(0.95, 0.75 + 0.2 * frac_bad), 3), evidence=ev)
    return LensResult(lens=NAME, tier=TIER, verdict="ok", confidence=0.8, evidence=ev)
