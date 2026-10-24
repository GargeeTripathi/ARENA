"""Root cause -> a concrete RagConfig change."""
from collections import Counter

from app.schemas import Diagnosis, RagConfig

RULES: dict[str, tuple[str, dict]] = {
    "ranking_miss": ("The right chunk was retrieved but ranked below the cut-off. Add a reranker and widen k to 10.",
                     {"rerank": True, "k": 10}),
    "recall_miss": ("The right chunk was never retrieved. Switch to hybrid (dense + BM25 keyword) search.",
                    {"retrieval": "hybrid"}),
    "chunking_miss": ("The answer was cut across chunk boundaries. Use smaller chunks with more overlap (256 / 96).",
                      {"chunk_size": 256, "chunk_overlap": 96}),
    "hallucination": ("The model added claims not in the context. Use a grounded prompt that requires citations "
                      "and allows \"I don't know\".", {"prompt_style": "grounded"}),
    "misread_incomplete": ("The answer was in the context but the model misread or dropped it. Use a grounded, "
                           "cite-the-passage prompt.", {"prompt_style": "grounded"}),
    "abstention_failure": ("The model answered a question the documents can't answer. Use a grounded prompt that "
                           "allows \"I don't know\".", {"prompt_style": "grounded"}),
    "lucky_guess": ("The answer came from the model's memory, not the documents. Use a grounded prompt.",
                    {"prompt_style": "grounded"}),
}
_BY_VERDICT = {"retrieval": "recall_miss", "generation": "hallucination", "abstention": "abstention_failure"}


def prescribe(d: Diagnosis) -> tuple[str, dict] | None:
    if d.verdict in ("ok", "uncertain"):
        return None
    return RULES.get(d.sub_cause or "") or RULES[_BY_VERDICT[d.verdict]]


def run_patch(diagnoses: list[Diagnosis], base: RagConfig) -> tuple[list[str], dict]:
    """Merge the fixes for every failure in a run, most common cause first."""
    causes = Counter((d.sub_cause or _BY_VERDICT.get(d.verdict)) for d in diagnoses if prescribe(d))
    sentences, patch = [], {}
    for cause, n in causes.most_common():
        text, p = RULES[cause]
        sentences.append(f"{cause} ({n}): {text}")
        patch.update(p)
    return sentences, {k: v for k, v in patch.items() if getattr(base, k) != v}
