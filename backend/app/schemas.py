from typing import Literal

from pydantic import BaseModel, Field


class Chunk(BaseModel):
    chunk_id: str
    doc_id: str
    doc_name: str
    page: int
    text: str
    is_table: bool = False
    start: int = 0  # char offsets in page text; lets gold chunks be remapped across chunk sizes
    end: int = 0


QType = Literal["single_hop", "numeric", "unanswerable", "multi_hop", "paraphrase", "distractor"]


class TestQuestion(BaseModel):
    __test__ = False  # stop pytest collecting this as a test class
    qid: str
    qtype: QType
    question: str
    gold_answer: str | None  # None for unanswerable
    gold_chunk_ids: list[str]  # empty for unanswerable
    closed_book_correct: bool | None = None
    evidence: str | None = None  # exact supporting quote from the gold chunk
    gold_span: dict | None = None  # {doc_id, page, start, end}: re-finds gold chunks under any chunk_size


class RagConfig(BaseModel):
    chunk_size: int = 512
    chunk_overlap: int = 64
    k: int = 5
    retrieval: Literal["dense", "hybrid"] = "dense"
    rerank: bool = False
    prompt_style: Literal["basic", "grounded"] = "basic"


class RetrievedChunk(BaseModel):
    chunk_id: str
    rank: int  # 1-based
    score: float
    text: str
    in_context: bool  # rank <= k


class RagTrace(BaseModel):
    qid: str
    config: RagConfig
    retrieved_top50: list[RetrievedChunk]
    answer: str
    answer_sentences: list[str]


Verdict = Literal["ok", "retrieval", "generation", "abstention", "uncertain"]

SUB_CAUSES = (
    "recall_miss", "ranking_miss", "chunking_miss", "hallucination", "misread_incomplete",
    "abstention_failure", "lucky_guess", "wrong_chunk_reliance", "parametric_answer",
)


class LensResult(BaseModel):
    lens: str
    tier: int
    verdict: Verdict
    sub_cause: str | None = None
    confidence: float  # 0..1
    evidence: dict = Field(default_factory=dict)
    llm_calls: int = 0  # real (billed) calls; cache hits count 0
    cached_calls: int = 0  # calls answered from the disk cache
    latency_ms: int = 0


class Diagnosis(BaseModel):
    qid: str
    verdict: Verdict
    sub_cause: str | None
    confidence: float
    needs_review: bool
    lens_results: list[LensResult]
    max_tier_reached: int
    prescription: str | None
    total_llm_calls: int
    total_cached_calls: int = 0
    total_latency_ms: int


class RunResult(BaseModel):
    run_id: str
    corpus_id: str
    config: RagConfig
    traces: list[RagTrace] = Field(default_factory=list)
    diagnoses: list[Diagnosis] = Field(default_factory=list)
    scorecards: dict = Field(default_factory=dict)
    cost: dict = Field(default_factory=dict)
