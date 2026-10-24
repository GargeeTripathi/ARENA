"""Phase 2 check: generate typed questions from demo/, print counts + a sample of each type with gold ids.
Run from backend/:  .venv/Scripts/python scripts/gen_questions.py [n_per_type]
"""
import asyncio
import logging
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config  # noqa: E402
from app.generator.generate import generate_questions  # noqa: E402
from app.ingest import indexer  # noqa: E402
from app.llm import client  # noqa: E402


def demo_corpus() -> str:
    files = [(p.name, p.read_bytes()) for p in sorted(config.DEMO_DIR.iterdir()) if p.suffix in indexer.SUPPORTED]
    return indexer.create_corpus(files)


async def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.WARNING)
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    cid = demo_corpus()
    t = time.time()
    with client.counting() as c:
        qs = await generate_questions(cid, n_per_type=n)
    print(f"corpus={cid}  questions={len(qs)}  types={dict(Counter(q.qtype for q in qs))}  "
          f"llm_calls={c.n}  closed_book_correct={sum(bool(q.closed_book_correct) for q in qs)}  {time.time() - t:.0f}s\n")
    for qtype in ("single_hop", "numeric", "unanswerable"):
        print(f"== {qtype}")
        for q in [q for q in qs if q.qtype == qtype][:3]:
            print(f"  {q.qid}  {q.question}\n     gold={q.gold_answer!r}  chunks={q.gold_chunk_ids}  cb={q.closed_book_correct}")
            if q.evidence:
                print(f"     evidence: {q.evidence[:110]!r}")


if __name__ == "__main__":
    asyncio.run(main())
