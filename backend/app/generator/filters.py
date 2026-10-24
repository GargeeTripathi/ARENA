"""Question filters: leakage, dedup (no LLM), answerability + closed-book (LLM)."""
import re

import numpy as np

from app.generator.prompts import ANSWERABILITY
from app.ingest import indexer
from app.lenses.answer_check import judge_correct
from app.llm import client
from app.rag.pipeline import generate

_W = re.compile(r"[a-z0-9]+")


def leaks(question: str, source: str, n: int = 8) -> bool:
    """True if the question copies more than `n` consecutive words from the source."""
    q, s = _W.findall(question.lower()), " " + " ".join(_W.findall(source.lower())) + " "
    return any(" " + " ".join(q[i : i + n + 1]) + " " in s for i in range(len(q) - n))


def dedup(questions: list[str], threshold: float = 0.9) -> list[int]:
    """Indices to keep: drop any question with cosine > threshold to an earlier kept one."""
    if not questions:
        return []
    v = np.array(indexer.embed(questions))
    keep: list[int] = []
    for i in range(len(questions)):
        if not keep or float(np.max(v[keep] @ v[i])) <= threshold:
            keep.append(i)
    return keep


async def answerable(question: str, passages: list[str]) -> bool:
    text = "\n\n".join(f"[{i + 1}] {p}" for i, p in enumerate(passages)) or "(none)"
    r = await client.complete_obj("judge", [{"role": "user", "content": ANSWERABILITY.format(
        question=question, passages=text)}])
    return bool(r.get("answerable"))


async def closed_book_correct(question: str, gold: str) -> bool:
    """Parametric-risk flag: can the generator answer with NO context?"""
    return (await judge_correct(question, gold, await generate(question, [], "basic")))[0]
