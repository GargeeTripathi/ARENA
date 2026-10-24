"""Phase 1 check: ingest demo/, retrieve + answer 3 questions, print ranks and answers.
Run from backend/:  .venv/Scripts/python scripts/smoke_rag.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config  # noqa: E402
from app.ingest import indexer  # noqa: E402
from app.rag.pipeline import answer  # noqa: E402
from app.rag.retriever import retrieve  # noqa: E402
from app.schemas import RagConfig  # noqa: E402

QUESTIONS = [
    "What is the minimum attendance required to sit the end-semester exam at Northbridge?",
    "How much does the Aquila X2 RO membrane cost and how often must it be replaced?",
    "What are the core hours at Helios Analytics?",
]


async def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    files = [(p.name, p.read_bytes()) for p in sorted(config.DEMO_DIR.iterdir()) if p.suffix in indexer.SUPPORTED]
    cid = indexer.create_corpus(files)
    cfg = RagConfig()
    chunks = indexer.build_index(cid, cfg.chunk_size, cfg.chunk_overlap)
    print(f"corpus={cid} docs={len(files)} chunks={len(chunks)} config={cfg.model_dump()}\n")
    has_llm = bool(config.LLM_API_KEY and config.GEN_MODEL)
    for i, q in enumerate(QUESTIONS):
        print(f"Q{i + 1}: {q}")
        top = retrieve(q, cid, cfg)
        for r in top[:3]:
            print(f"  #{r.rank} {r.score:.3f} {r.chunk_id} | {r.text[:80].replace(chr(10), ' ')}...")
        if has_llm:
            t = await answer(f"q{i + 1}", q, cid, cfg)
            print(f"  ANSWER ({len(t.answer_sentences)} sentences): {t.answer}")
        print()
    if not has_llm:
        print("(LLM_API_KEY / GEN_MODEL not set: retrieval only. Fill .env to see answers.)")


if __name__ == "__main__":
    asyncio.run(main())
