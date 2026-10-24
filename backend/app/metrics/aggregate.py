"""Run-level scorecards with bootstrap 95% CIs, root-cause mix, and cascade cost."""
from collections import Counter

import numpy as np

from app.schemas import Diagnosis, RagTrace, TestQuestion


def bootstrap_ci(values: list[float], n: int = 1000, seed: int = 0) -> dict:
    if not values:
        return {"value": None, "lo": None, "hi": None, "n": 0}
    a = np.asarray(values, dtype=float)
    means = np.random.default_rng(seed).choice(a, size=(n, len(a)), replace=True).mean(axis=1)
    return {"value": round(float(a.mean()), 3), "lo": round(float(np.percentile(means, 2.5)), 3),
            "hi": round(float(np.percentile(means, 97.5)), 3), "n": len(a)}


def _faithfulness(d: Diagnosis, trace: RagTrace) -> float | None:
    by = {r.lens: r for r in d.lens_results}
    g = by.get("grounding")
    if g and g.evidence.get("sentences"):
        s = g.evidence["sentences"]
        return sum(x["supported"] for x in s) / len(s)
    sd = by.get("span_detector")
    if sd and sd.verdict != "uncertain" and trace.answer_sentences:
        spans = sd.evidence.get("spans", [])
        bad, pos = 0, 0
        for sent in trace.answer_sentences:  # sentence is unsupported if a hallucinated span overlaps it
            start = trace.answer.find(sent, pos)
            end = start + len(sent)
            pos = max(pos, end)
            bad += any(sp["start"] < end and sp["end"] > start for sp in spans)
        return 1 - bad / len(trace.answer_sentences)
    return None


def scorecards(questions: list[TestQuestion], traces: list[RagTrace], diagnoses: list[Diagnosis]) -> dict:
    qs, ts = {q.qid: q for q in questions}, {t.qid: t for t in traces}
    rel, faith, acc, abst = [], [], [], []
    for d in diagnoses:
        q, t = qs[d.qid], ts[d.qid]
        by = {r.lens: r for r in d.lens_results}
        if q.qtype == "unanswerable":
            if "answer_check" in by:
                abst.append(float(bool(by["answer_check"].evidence.get("correct"))))
            continue
        f = by.get("forensics")
        if f:
            rel.append(float(bool(f.evidence.get("gold_rank")) and f.evidence["gold_rank"] <= f.evidence["k"]))
        c = by.get("answer_check")
        if c and c.evidence.get("correct") is not None:
            acc.append(float(c.evidence["correct"]))
        fv = _faithfulness(d, t)
        if fv is not None:
            faith.append(fv)
    return {
        "context_relevance": bootstrap_ci(rel),
        "faithfulness": bootstrap_ci(faith),
        "accuracy": bootstrap_ci(acc),
        "abstention": bootstrap_ci(abst),
        "root_causes": dict(Counter(d.sub_cause or d.verdict for d in diagnoses)),
        "verdicts": dict(Counter(d.verdict for d in diagnoses)),
    }


def cost(diagnoses: list[Diagnosis], wall_ms: int | None = None) -> dict:
    n = len(diagnoses) or 1
    tiers = Counter(d.max_tier_reached for d in diagnoses)
    calls = sum(d.total_llm_calls for d in diagnoses)
    cached = sum(d.total_cached_calls for d in diagnoses)
    return {
        "questions": len(diagnoses),
        "total_llm_calls": calls,
        "avg_llm_calls": round((calls + cached) / n, 2),  # what the cascade needs per question
        "billed_llm_calls": calls,  # actually sent to the provider (the rest came from cache)
        "cached_llm_calls": cached,
        "resolved_pct": {t: round(100 * tiers.get(t, 0) / n, 1) for t in (1, 2, 3)},
        "total_ms": wall_ms if wall_ms is not None else sum(d.total_latency_ms for d in diagnoses),
    }
