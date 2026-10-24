"""The RAG under test: retrieve -> prompt -> answer -> split sentences."""
import asyncio
import re

from app.llm import client
from app.rag.retriever import retrieve
from app.schemas import RagConfig, RagTrace

PROMPTS = {
    "basic": (
        "You are a helpful assistant. Answer the question using the context.",
        "Context:\n{context}\n\nQuestion: {question}\nAnswer:",
    ),
    "grounded": (
        "You answer strictly from the provided context, in one or two complete sentences. Cite the passage number "
        "like [1] after each claim. If the context does not contain the answer, reply exactly: I don't know.",
        "Context:\n{context}\n\nQuestion: {question}\nAnswer (with citations, or \"I don't know\"):",
    ),
}

_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT.split(text.strip()) if s.strip()]


async def generate(question: str, contexts: list[str], style: str = "basic") -> str:
    """Generation step alone; counterfactual lenses call this with swapped contexts."""
    system, user = PROMPTS[style]
    ctx = "\n\n".join(f"[{i + 1}] {t}" for i, t in enumerate(contexts)) or "(no context)"
    return (await client.complete("gen", [
        {"role": "system", "content": system},
        {"role": "user", "content": user.format(context=ctx, question=question)},
    ])).strip()


async def answer(qid: str, question: str, corpus_id: str, cfg: RagConfig) -> RagTrace:
    top = await asyncio.to_thread(retrieve, question, corpus_id, cfg)  # model loads must not block the API
    ans = await generate(question, [c.text for c in top if c.in_context], cfg.prompt_style)
    return RagTrace(qid=qid, config=cfg, retrieved_top50=top, answer=ans, answer_sentences=split_sentences(ans))
