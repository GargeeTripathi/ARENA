"""A lens = a module with NAME, TIER and `async def run(q, trace, ctx) -> LensResult`.
`execute()` wraps every lens with timing, LLM-call counting and crash safety."""
import logging
import time
from dataclasses import dataclass, field
from types import ModuleType

from app.llm import client
from app.schemas import Chunk, LensResult, RagTrace, TestQuestion

log = logging.getLogger("lens")

# "ok" from these lenses means "retrieval was fine", not "the answer is fine",
# so it does not contradict a generation/abstention verdict.
RETRIEVAL_SCOPE = {"forensics", "sufficiency"}


@dataclass
class LensContext:
    corpus_id: str
    chunks: dict[str, Chunk]  # chunk_id -> Chunk, in the chunking of the RAG under test
    gold_ids: list[str]  # gold chunk ids in that chunking
    tier: int = 1  # tier currently being run
    results: dict[str, LensResult] = field(default_factory=dict)  # earlier lens results by name


def in_context(trace: RagTrace) -> list:
    return [c for c in trace.retrieved_top50 if c.in_context]


async def execute(lens: ModuleType, q: TestQuestion, trace: RagTrace, ctx: LensContext) -> LensResult:
    t = time.perf_counter()
    with client.counting() as c:
        try:
            r = await lens.run(q, trace, ctx)
        except Exception as e:  # a broken lens must never break the cascade
            log.warning("lens %s failed on %s: %s", lens.NAME, q.qid, e)
            r = LensResult(lens=lens.NAME, tier=ctx.tier, verdict="uncertain", confidence=0.0,
                           evidence={"error": str(e)[:300]})
    r.llm_calls = c.n
    r.cached_calls = c.cached
    r.latency_ms = int((time.perf_counter() - t) * 1000)
    return r
