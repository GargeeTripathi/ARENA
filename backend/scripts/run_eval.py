"""Phase 3 check: run RAG + cascade on the demo questions and print the diagnosis table.
Run from backend/:  .venv/Scripts/python scripts/run_eval.py [--bad]
  --bad  use the seeded bad config (chunk_size=1024, k=3, dense, no rerank, basic prompt)
"""
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cascade.prescriptions import run_patch  # noqa: E402
from app.cascade.runner import evaluate  # noqa: E402
from app.generator.generate import generate_questions, load_questions  # noqa: E402
from app.schemas import RagConfig  # noqa: E402
from gen_questions import demo_corpus  # noqa: E402

BAD = RagConfig(chunk_size=1024, chunk_overlap=64, k=3, retrieval="dense", rerank=False, prompt_style="basic")


def fmt(sc: dict) -> str:
    return "n/a" if sc["value"] is None else f"{sc['value']:.2f} [{sc['lo']:.2f}-{sc['hi']:.2f}] n={sc['n']}"


async def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.WARNING)
    cid = demo_corpus()
    qs = load_questions(cid) or await generate_questions(cid)
    cfg = BAD if "--bad" in sys.argv else RagConfig()
    print(f"corpus={cid} questions={len(qs)} config={cfg.model_dump()}\n")
    r = await evaluate(cid, qs, cfg)

    qtype = {q.qid: q.qtype for q in qs}
    print(f"{'qid':<12}{'type':<14}{'verdict':<12}{'sub_cause':<20}{'conf':>6}{'tier':>6}{'calls':>7}  review")
    for d in r["diagnoses"]:
        print(f"{d.qid:<12}{qtype[d.qid]:<14}{d.verdict:<12}{(d.sub_cause or '-'):<20}{d.confidence:>6.2f}"
              f"{d.max_tier_reached:>6}{d.total_llm_calls:>7}  {'!' if d.needs_review else ''}")
    sc, c = r["scorecards"], r["cost"]
    print("\nscorecards:")
    for k in ("context_relevance", "faithfulness", "accuracy", "abstention"):
        print(f"  {k:<18} {fmt(sc[k])}")
    print(f"  root causes: {sc['root_causes']}")
    print(f"\ncost: {c['total_llm_calls']} LLM calls, {c['avg_llm_calls']}/question, "
          f"resolved at tier 1/2/3: {c['resolved_pct']}%, {c['total_ms'] / 1000:.0f}s")
    sentences, patch = run_patch(r["diagnoses"], cfg)
    print("\nprescription:", patch)
    for s in sentences:
        print("  -", s)


if __name__ == "__main__":
    asyncio.run(main())
