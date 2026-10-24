"""One hand-made fixture per lens; the LLM is always mocked."""
import asyncio

from app.cascade.consensus import consensus, resolved
from app.cascade.prescriptions import run_patch
from app.lenses import answer_check, forensics, sufficiency
from app.lenses.base import LensContext
from app.schemas import Chunk, LensResult, RagConfig, RagTrace, RetrievedChunk, TestQuestion


def chunk(i, text="text", is_table=False, start=0, end=10):
    return Chunk(chunk_id=f"c{i}", doc_id="d", doc_name="d.md", page=1, text=text, is_table=is_table, start=start, end=end)


def trace(order: list[int], k=3, answer="The fee is 2,500 rupees."):
    return RagTrace(qid="q", config=RagConfig(k=k), answer=answer, answer_sentences=[answer],
                    retrieved_top50=[RetrievedChunk(chunk_id=f"c{i}", rank=r + 1, score=1.0, text="t", in_context=r < k)
                                     for r, i in enumerate(order)])


Q = TestQuestion(qid="q", qtype="numeric", question="What is the late fee?", gold_answer="INR 2,500", gold_chunk_ids=["c7"])
U = TestQuestion(qid="u", qtype="unanswerable", question="Who is the CFO?", gold_answer=None, gold_chunk_ids=[])


def ctx(gold, chunks=None, tier=1):
    chunks = chunks or [chunk(i) for i in range(30)]
    return LensContext(corpus_id="x", chunks={c.chunk_id: c for c in chunks}, gold_ids=gold, tier=tier)


def run(lens, q, t, c):
    return asyncio.run(lens.run(q, t, c))


def test_forensics_ranks_and_k_sweep():
    order = [1, 2, 3, 4, 5, 6, 7] + list(range(8, 30))
    r = run(forensics, Q, trace(order, k=3), ctx(["c7"]))
    assert (r.verdict, r.sub_cause, r.evidence["gold_rank"]) == ("retrieval", "ranking_miss", 7)
    assert r.evidence["k_sweep"] == {3: False, 5: False, 10: True, 20: True}
    assert run(forensics, Q, trace([7, 1, 2]), ctx(["c7"])).verdict == "ok"
    assert run(forensics, Q, trace([1, 2, 3]), ctx(["c7"])).sub_cause == "recall_miss"
    assert run(forensics, U, trace([1, 2, 3]), ctx([])).confidence == 0.0


def test_forensics_chunking_miss_when_evidence_split():
    q = Q.model_copy(update={"gold_span": {"doc_id": "d", "page": 1, "start": 8, "end": 14}})
    chunks = [chunk(i, start=i * 10, end=i * 10 + 10) for i in range(5)]  # span 8..14 straddles c0 and c1
    r = run(forensics, q, trace([0, 3, 4, 1, 2], k=3), ctx(["c0", "c1"], chunks))
    assert (r.verdict, r.sub_cause) == ("retrieval", "chunking_miss")


def test_answer_check_rules_and_lexical():
    assert run(answer_check, U, trace([1], answer="I don't know."), ctx([])).evidence["correct"] is True
    r = run(answer_check, U, trace([1], answer="The CFO is Ravi Menon."), ctx([]))
    assert (r.verdict, r.sub_cause) == ("abstention", "abstention_failure")
    assert run(answer_check, Q, trace([7]), ctx(["c7"])).evidence["correct"] is True  # 2,500 + fee
    assert run(answer_check, Q, trace([7], answer="It is 3,000."), ctx(["c7"])).evidence["correct"] is None


def test_answer_check_tier2_uses_judge(monkeypatch):
    async def fake(role, messages, temperature=0.0):
        return {"correct": False, "reason": "wrong amount"}
    monkeypatch.setattr(answer_check.client, "complete_json", fake)
    r = run(answer_check, Q, trace([7], answer="It is 3,000."), ctx(["c7"], tier=2))
    assert r.evidence == {"correct": False, "method": "llm", "reason": "wrong amount"}


def test_sufficiency(monkeypatch):
    async def insufficient(role, messages, temperature=0.0):
        return {"sufficient": False, "reason": "no fee table"}
    monkeypatch.setattr(sufficiency.client, "complete_json", insufficient)
    assert run(sufficiency, Q, trace([1]), ctx(["c7"], tier=2)).verdict == "retrieval"
    r = run(sufficiency, U, trace([1], answer="The CFO is Ravi."), ctx([], tier=2))
    assert (r.verdict, r.sub_cause) == ("abstention", "abstention_failure")


def lr(lens, verdict, conf, sub=None, tier=1, **ev):
    return LensResult(lens=lens, tier=tier, verdict=verdict, sub_cause=sub, confidence=conf, evidence=ev)


def test_consensus_and_escalation():
    # wrong answer, gold ranked 7th: retrieval wins, ok votes are ignored
    rs = [lr("forensics", "retrieval", 0.85, "ranking_miss"), lr("span_detector", "ok", 0.7),
          lr("answer_check", "uncertain", 0.0, correct=False, tier=2)]
    d = consensus(Q, rs)
    assert (d.verdict, d.sub_cause) == ("retrieval", "ranking_miss")
    assert not resolved(rs, 1)  # wrong answers always reach tier 2
    # correct + grounded -> ok, resolved at tier 1
    ok = [lr("forensics", "ok", 0.8), lr("span_detector", "ok", 0.7), lr("answer_check", "ok", 0.7, correct=True)]
    assert consensus(Q, ok).verdict == "ok" and resolved(ok, 1)
    # retrieval fine, span detector + grounding say hallucination
    h = [lr("forensics", "ok", 0.8), lr("span_detector", "generation", 0.9, "hallucination"),
         lr("grounding", "generation", 0.9, "hallucination", tier=2), lr("answer_check", "uncertain", 0.0, correct=False)]
    assert (consensus(Q, h).verdict, consensus(Q, h).sub_cause) == ("generation", "hallucination")
    assert resolved(h, 2)  # forensics' retrieval-ok doesn't contradict a generation fault
    # correct but ungrounded + known closed-book -> lucky guess
    lg = [lr("span_detector", "generation", 0.8, "hallucination"), lr("answer_check", "ok", 0.7, correct=True)]
    assert consensus(Q.model_copy(update={"closed_book_correct": True}), lg).sub_cause == "lucky_guess"


def test_run_patch_merges_fixes():
    ds = [consensus(Q, [lr("forensics", "retrieval", 0.85, "ranking_miss"), lr("answer_check", "uncertain", 0, correct=False)]),
          consensus(Q, [lr("span_detector", "generation", 0.9, "hallucination"), lr("answer_check", "uncertain", 0, correct=False)])]
    _, patch = run_patch(ds, RagConfig())
    assert patch == {"rerank": True, "k": 10, "prompt_style": "grounded"}


def test_counterfactual_proves_retrieval_failure(monkeypatch):
    from app.lenses import counterfactual

    async def fake_generate(question, contexts, style="basic"):
        return "The late fee is INR 2,500." if contexts == ["GOLD"] else "It is INR 3,000."

    async def fake_judge(question, gold, answer):
        return ("2,500" in answer), "compared"

    monkeypatch.setattr(counterfactual, "generate", fake_generate)
    monkeypatch.setattr(counterfactual, "judge_correct", fake_judge)
    c = ctx(["c7"], [chunk(7, "GOLD")] + [chunk(i) for i in range(5)], tier=3)
    c.results = {"answer_check": lr("answer_check", "uncertain", 0.0, correct=False),
                 "forensics": lr("forensics", "retrieval", 0.9, "recall_miss")}
    r = run(counterfactual, Q, trace([1, 2, 3], answer="It is INR 3,000."), c)
    assert (r.verdict, r.sub_cause, r.confidence) == ("retrieval", "recall_miss", 0.95)
    assert [x["condition"] for x in r.evidence["runs"]] == ["original", "gold_only"]
    assert r.evidence["runs"][1]["correct"] is True

    # gold in hand and still wrong -> generator's fault
    async def always_wrong(question, contexts, style="basic"):
        return "It is INR 3,000."
    monkeypatch.setattr(counterfactual, "generate", always_wrong)
    r = run(counterfactual, Q, trace([1, 2, 3], answer="It is INR 3,000."), c)
    assert (r.verdict, r.sub_cause) == ("generation", "misread_incomplete")


def test_span_detector_flags_high_prob_span(monkeypatch):
    from app.lenses import span_detector
    monkeypatch.setattr(span_detector, "_predict",
                        lambda c, q, a: [{"start": 11, "end": 16, "text": "2,500", "confidence": 0.91}])
    r = run(span_detector, Q, trace([7, 1, 2]), ctx(["c7"]))
    assert (r.verdict, r.sub_cause, r.confidence) == ("generation", "hallucination", 0.91)
    assert r.evidence["spans"][0] == {"start": 11, "end": 16, "text": "2,500", "prob": 0.91}
    monkeypatch.setattr(span_detector, "_predict", lambda c, q, a: [])
    assert run(span_detector, Q, trace([7, 1, 2]), ctx(["c7"])).verdict == "ok"
    monkeypatch.setattr(span_detector, "_predict", lambda c, q, a: None)  # model failed to load
    assert run(span_detector, Q, trace([7, 1, 2]), ctx(["c7"])).verdict == "uncertain"


def test_grounding_marks_sentences_and_best_chunk(monkeypatch):
    from app.lenses import grounding
    t = trace([7, 1, 2], k=2, answer="The fee is 2,500. It is waived on Sundays.")
    t.answer_sentences = ["The fee is 2,500.", "It is waived on Sundays."]
    # pairs: 2 claims x 2 chunks (c7, c1), then 2 claims x joined
    monkeypatch.setattr(grounding, "_score", lambda pairs: ("fake", [0.9, 0.2, 0.1, 0.3, 0.85, 0.2]))
    r = run(grounding, Q, t, ctx(["c7"], tier=2))
    s = r.evidence["sentences"]
    assert [x["supported"] for x in s] == [True, False]
    assert s[0]["best_chunk_id"] == "c7"
    assert (r.verdict, r.sub_cause) == ("generation", "hallucination")
