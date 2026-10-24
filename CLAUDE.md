# Build Prompt for Claude Code — "RAG Autopsy"

> Paste everything below into Claude Code from an empty project folder. Keep this file in the repo as `CLAUDE.md` so every session has the spec.

---

## 0. Role and working rules

You are building **RAG Autopsy**, a hackathon prototype (HYPNEXIS, problem AI-04). The prototype is due at **3:00 AM IST**, so ship a working end-to-end slice first, then deepen.

Rules:
1. Work **phase by phase** (Section 9). After each phase, run its acceptance check, show me the result, and commit with git (`feat: phase N …`).
2. **The app must run end to end at every checkpoint.** Never leave the main path broken for a half-built feature.
3. Prefer simple, readable Python. No LangChain or LlamaIndex. Write the thin RAG and eval logic ourselves so we can explain every line to judges.
4. Every LLM call goes through **one client wrapper** with disk caching (Section 6). No direct SDK calls anywhere else.
5. When a third-party model API is uncertain (MiniCheck, LettuceDetect, HHEM), **read its README or source in the installed package first**, then write a small smoke test. If a model fails to install or load, use the fallback listed in Section 5 and log a warning. Don't block the pipeline.
6. Keep secrets in `.env` (never commit it). Provide `.env.example`.
7. Ask me before adding any dependency not listed here.

---

## 1. What the product does (one paragraph)

The user uploads documents. The system builds a baseline RAG pipeline over them and **generates typed test questions, each from a known "gold" chunk**. It then runs every question through the RAG under test and diagnoses each answer with a **three-tier cascade of "lenses"**. Cheap local models run on every question; LLM calls are spent only on uncertain or contested cases. A weighted consensus gives each failure a **root cause** (retrieval vs. hallucination vs. abstention, plus sub-causes), a **confidence** and a **prescription**. A single-screen React dashboard shows scorecards, the failure list, and an "autopsy" view: retrieved chunks beside the answer, sentences colour-coded green (supported) or red (unsupported), and per-lens verdicts. A fix loop re-runs failed questions with a changed config and shows before/after.

**Core novelty to protect:** because each question has a gold chunk, we can **re-run the generator with the gold chunk swapped in**. If the answer becomes correct, that proves a retrieval failure; if it stays wrong, the generator is at fault.

---

## 2. Tech stack (fixed)

- **Backend:** Python 3.11, FastAPI, Uvicorn, Pydantic v2, asyncio
- **Parsing:** PyMuPDF (`pymupdf`); `pdfplumber` for tables; `python-docx` for DOCX; plain `.txt`/`.md`
- **Vector store:** ChromaDB (persistent, local folder `data/chroma`)
- **Embeddings:** `BAAI/bge-small-en-v1.5` via `sentence-transformers`
- **Keyword search (fix loop):** `rank_bm25`
- **Reranker (fix loop):** `BAAI/bge-reranker-base` via `sentence-transformers` CrossEncoder
- **Hallucination spans (Tier 1):** `lettucedetect`, model `KRLabsOrg/lettucedect-base-modernbert-en-v1`
- **Grounding checker (Tier 2):** MiniCheck (install from `git+https://github.com/Liyan06/MiniCheck.git`); prefer the Flan-T5-Large variant
- **Fallback checker:** `vectara/hallucination_evaluation_model` (HHEM-2.1-Open, `trust_remote_code=True`, use `model.predict(pairs)`)
- **LLM:** any **OpenAI-compatible** endpoint via the `openai` Python SDK with `base_url` from env. Separate `GEN_MODEL` (RAG answers and question generation) and `JUDGE_MODEL` (Tier 2/3 prompts). The judge must differ from the generator to avoid self-preference bias.
- **Cache:** SQLite via `diskcache`
- **Frontend:** React + Vite + TypeScript + Tailwind CSS; `lucide-react` icons; `recharts` for the small charts
- **Tests:** `pytest` for backend units

`.env.example`:
```
LLM_BASE_URL=
LLM_API_KEY=
GEN_MODEL=
JUDGE_MODEL=
LLM_MAX_CONCURRENCY=6
DEVICE=cpu
```

---

## 3. Repository layout

```
rag-autopsy/
├── CLAUDE.md                     # this spec
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI app, CORS, routers
│   │   ├── config.py             # env + RagConfig defaults
│   │   ├── schemas.py            # all Pydantic models (Section 4)
│   │   ├── store.py              # run/corpus persistence (JSON files under data/runs/)
│   │   ├── llm/client.py         # cached async LLM wrapper, call counter
│   │   ├── ingest/
│   │   │   ├── parser.py         # pdf/docx/txt → pages with text + tables
│   │   │   ├── chunker.py        # fixed-size + overlap; table-aware option
│   │   │   └── indexer.py        # embed + Chroma upsert; BM25 index build
│   │   ├── generator/
│   │   │   ├── prompts.py
│   │   │   ├── generate.py       # typed questions, batched per chunk
│   │   │   └── filters.py        # answerability, closed-book, leakage, dedup
│   │   ├── rag/
│   │   │   ├── retriever.py      # dense / hybrid / rerank; ALWAYS returns top-50 with ranks
│   │   │   └── pipeline.py       # answer(question, config) → RagTrace
│   │   ├── lenses/
│   │   │   ├── base.py           # Lens protocol + LensResult
│   │   │   ├── forensics.py      # Tier 1
│   │   │   ├── span_detector.py  # Tier 1 (LettuceDetect)
│   │   │   ├── grounding.py      # Tier 2 (MiniCheck / HHEM fallback)
│   │   │   ├── sufficiency.py    # Tier 2 (LLM prompt)
│   │   │   ├── counterfactual.py # Tier 3 (gold rerun, then none/shuffled)
│   │   │   ├── leave_one_out.py  # Tier 3 (stretch)
│   │   │   └── answer_check.py   # correctness vs gold answer (LLM judge, short prompt)
│   │   ├── cascade/
│   │   │   ├── runner.py         # tiered execution + escalation
│   │   │   ├── consensus.py      # weighted vote → Diagnosis
│   │   │   └── prescriptions.py  # cause → RagConfig change
│   │   ├── metrics/aggregate.py  # scorecards + bootstrap CIs
│   │   └── api/routes.py
│   └── tests/
├── web/                          # React + Vite + Tailwind
│   └── src/
│       ├── api.ts
│       ├── App.tsx
│       └── components/ (HealthStrip, CostCounter, FailureList, AutopsyView,
│                        ChunkPanel, AnswerPanel, LensTabs, ConsensusPanel,
│                        CounterfactualStrip, PrescriptionRail)
├── data/                         # gitignored: uploads, chroma, runs, cache
├── demo/                         # demo corpus + seeded failure configs
└── README.md
```

---

## 4. Data contracts (Pydantic, in `schemas.py`)

```python
class Chunk(BaseModel):
    chunk_id: str; doc_id: str; doc_name: str; page: int
    text: str; is_table: bool = False

class TestQuestion(BaseModel):
    qid: str
    qtype: Literal["single_hop","numeric","unanswerable","multi_hop","paraphrase","distractor"]
    question: str
    gold_answer: str | None            # None for unanswerable
    gold_chunk_ids: list[str]          # empty for unanswerable
    closed_book_correct: bool | None   # parametric-risk flag from filters

class RagConfig(BaseModel):
    chunk_size: int = 512; chunk_overlap: int = 64
    k: int = 5; retrieval: Literal["dense","hybrid"] = "dense"
    rerank: bool = False
    prompt_style: Literal["basic","grounded"] = "basic"   # grounded = cite + allow "I don't know"

class RetrievedChunk(BaseModel):
    chunk_id: str; rank: int; score: float; text: str; in_context: bool  # in_context = rank <= k

class RagTrace(BaseModel):
    qid: str; config: RagConfig
    retrieved_top50: list[RetrievedChunk]
    answer: str; answer_sentences: list[str]

Verdict = Literal["ok","retrieval","generation","abstention","uncertain"]

class LensResult(BaseModel):
    lens: str; tier: int
    verdict: Verdict; sub_cause: str | None = None
    confidence: float                  # 0..1
    evidence: dict                     # lens-specific, rendered by the UI
    llm_calls: int = 0; latency_ms: int = 0

class Diagnosis(BaseModel):
    qid: str
    verdict: Verdict; sub_cause: str | None
    confidence: float
    needs_review: bool
    lens_results: list[LensResult]
    max_tier_reached: int
    prescription: str | None
    total_llm_calls: int; total_latency_ms: int

class RunResult(BaseModel):
    run_id: str; corpus_id: str; config: RagConfig
    traces: list[RagTrace]; diagnoses: list[Diagnosis]
    scorecards: dict                   # see metrics/aggregate.py
    cost: dict                         # calls per question, % resolved per tier, totals
```

**Sub-causes:** `recall_miss`, `ranking_miss`, `chunking_miss`, `hallucination`, `misread_incomplete`, `abstention_failure`, `lucky_guess`, `wrong_chunk_reliance`, `parametric_answer`.

---

## 5. Lenses (each implements `async def run(q, trace, ctx) -> LensResult`)

### Tier 1 — every question, zero LLM calls

**`forensics`**
- Find the best rank of any gold chunk in `retrieved_top50`.
- No gold chunk (unanswerable) → `verdict="ok"`, `confidence=0.0` (no opinion).
- Gold rank ≤ k → `ok` for retrieval, confidence 0.8.
- Rank k+1…20 → `retrieval/ranking_miss`, confidence 0.85.
- Rank > 20 or absent → `retrieval/recall_miss`, confidence 0.9.
- **Chunking miss:** gold answer string split across two adjacent chunks, or gold chunk is a table fragment → `retrieval/chunking_miss`.
- `evidence`: `{gold_rank, k, k_sweep: {3: hit, 5: hit, 10: hit, 20: hit}}`. Compute the k-sweep from the single top-50 list; never re-retrieve.

**`span_detector`** (LettuceDetect)
- Input: retrieved chunks with `in_context=True`, the question, the answer.
- Output spans with probabilities. Any span > 0.5 → `generation/hallucination`, with confidence = max span prob; else `ok`, confidence 0.7.
- `evidence`: `{spans: [{start, end, text, prob}]}` (character offsets into the answer, used by the UI for red highlighting).
- Fallback: if load fails, return `uncertain` with confidence 0 and log a warning.

### Tier 2 — only if Tier 1 is uncertain or lenses disagree

**`grounding`** (MiniCheck; HHEM fallback)
- For each answer sentence, score support against the concatenated in-context chunks; also record **which chunk** gives the highest support (score each chunk separately; take the max).
- Fraction unsupported > 0 → `generation/hallucination`; else `ok`.
- `evidence`: `{sentences: [{text, supported: bool, score, best_chunk_id}]}`. This drives the green/red sentence colouring and the lines linking sentences to chunks.

**`sufficiency`** (one short LLM judge call)
- Prompt: given the question and the in-context chunks, answer JSON `{"sufficient": true|false, "reason": "..."}`.
- Insufficient + answerable question → supports `retrieval`; insufficient + the RAG answered confidently on an unanswerable question → `abstention/abstention_failure`.

**`answer_check`** (one short LLM judge call; runs in Tier 2 for answerable questions)
- Compares the RAG answer to `gold_answer` → `{"correct": bool, "reason"}`. Used by consensus and the "accuracy" scorecard.
- For unanswerable questions, a rule check is enough: did the answer abstain ("I don't know"-style)? No LLM call.

### Tier 3 — only if still unresolved or contested

**`counterfactual`**
1. Re-run generation with **only the gold chunk(s)** as context, then run `answer_check` on the result.
   - Gold run correct and original wrong → `retrieval` (proven), confidence 0.95.
   - Gold run still wrong → `generation`, confidence 0.9; sub-cause from `grounding` (hallucination vs misread_incomplete).
2. Only if still ambiguous: a **no-context** run (correct with no context + ungrounded original → `lucky_guess`/`parametric_answer`) and a **shuffled-order** run (correct only when gold is first → position sensitivity, recorded in evidence).
- `evidence`: `{runs: [{condition, answer, correct}]}`. The UI shows these as the counterfactual strip.

**`leave_one_out`** (stretch, only if time remains)
- For each in-context chunk, regenerate without it; if removing the gold chunk doesn't change the answer but removing a non-gold chunk does → `wrong_chunk_reliance`; if no removal changes it → `parametric_answer`.

---

## 6. LLM client (`llm/client.py`)

- `async def complete(role: Literal["gen","judge"], messages, json_mode=False, temperature=0.0) -> str`
- Cache key = sha256 of (model, messages, temperature, json_mode). Store in `diskcache` under `data/cache`.
- Global `asyncio.Semaphore(LLM_MAX_CONCURRENCY)`; retry with exponential backoff on 429/5xx (max 4 tries).
- **Call counter** per request context (use `contextvars`) so each lens reports `llm_calls`. Cache hits count as 0 calls but are logged as `cached`.
- JSON mode: if the provider lacks it, instruct "Return only JSON", then parse with a tolerant extractor (first `{` to last `}`), plus one repair retry.

---

## 7. Cascade and consensus

**Runner (`cascade/runner.py`)**
```
results = run Tier 1 lenses concurrently
if not resolved(results): results += run Tier 2 lenses concurrently
if not resolved(results): results += run Tier 3 lenses
diagnosis = consensus(results)
```
`resolved()` = at least one lens with confidence ≥ 0.8 has a non-`ok` or `ok` verdict, **and** no other lens with confidence ≥ 0.6 contradicts it. Also escalate **any** answer judged incorrect to at least Tier 2. Tier 3 runs at most once per question.

**Consensus (`cascade/consensus.py`)**
- Fixed weights for v1: `counterfactual 3.0, grounding 2.0, forensics 1.5, span_detector 1.5, sufficiency 1.0, answer_check 1.0` (keep weights in config so they can later be learned from hand labels).
- Score each verdict as the sum of weight × confidence; top verdict wins. Diagnosis confidence = top score / total score.
- `needs_review = True` if confidence < 0.6 **or** grounding and span_detector disagree with both ≥ 0.7 confidence.
- Correct + grounded answers → `ok`. Correct but ungrounded + closed-book correct → `lucky_guess`.

**Prescriptions (`cascade/prescriptions.py`)**: `ranking_miss → rerank=True, k=10` · `recall_miss → retrieval="hybrid"` · `chunking_miss → chunk_size=256, overlap=96` · `hallucination` or `misread_incomplete → prompt_style="grounded"` · `abstention_failure → prompt_style="grounded"`. Return both a human sentence and a `RagConfig` patch.

---

## 8. API (`api/routes.py`)

| Method | Path | Body / result |
| --- | --- | --- |
| POST | `/api/corpus` | multipart files → `{corpus_id, n_docs, n_chunks}` (parse, chunk, index) |
| POST | `/api/corpus/{id}/questions` | `{n_per_type, types}` → list of `TestQuestion` |
| POST | `/api/runs` | `{corpus_id, config}` → `{run_id}`; runs RAG + cascade as a background task |
| GET | `/api/runs/{run_id}` | `RunResult` (partial while running, with `progress`) |
| GET | `/api/runs/{run_id}/questions/{qid}` | trace + diagnosis for the autopsy view |
| POST | `/api/runs/{run_id}/fix` | `{qids?: list, config_patch?}` → new `run_id` over the failed questions with the prescribed config |
| GET | `/api/runs/{a}/diff/{b}` | per-question `fixed / broken / unchanged` + scorecard deltas |
| GET | `/api/runs/{run_id}/report.md` | markdown root-cause report |

Re-indexing for a new `chunk_size` must create a separate Chroma collection keyed by `(corpus_id, chunk_size, overlap)`, and reuse it if it exists.

---

## 9. Build phases (with acceptance checks)

**Phase 1 — Skeleton + RAG (target 7:00 PM)**
FastAPI app, config, schemas, LLM client with cache, parser, chunker, indexer, retriever (dense, top-50 with ranks), pipeline.
✅ `pytest` passes; a script `scripts/smoke_rag.py` ingests `demo/` and answers 3 questions, printing ranks and answers.

**Phase 2 — Question generator (target 8:30 PM)**
Types: `single_hop`, `numeric`, `unanswerable`. One JSON call per chunk returning several questions. Filters: answerability (judge), closed-book flag, leakage (reject if more than 8 consecutive words are copied from the chunk), dedup (embedding cosine > 0.9).
✅ 30+ questions are generated from the demo corpus; print a sample of each type with gold chunk ids.

**Phase 3 — Tier 1 + Tier 2 lenses + cascade + consensus (target 11:00 PM)**
forensics, span_detector, grounding, sufficiency, answer_check, runner, consensus, prescriptions, aggregate scorecards (context relevance = gold hit@k; faithfulness = supported-sentence ratio; accuracy = answer_check; abstention correctness), plus bootstrap 95% CIs (1,000 resamples).
✅ `scripts/run_eval.py` prints a table: qid, verdict, sub_cause, confidence, tier reached, LLM calls; plus the % resolved at each tier.

**Phase 4 — Tier 3 counterfactual + API (target 12:30 AM)**
Gold rerun first, then none/shuffled only if ambiguous. All routes from Section 8, except diff, which can wait until Phase 6.
✅ `curl` run → poll → a retrieval failure shows `counterfactual` evidence where the gold run is correct.

**Phase 5 — Dashboard (target 2:00 AM)** — one screen, no routing:
- **HealthStrip:** 4 scorecards (value ± CI, green ≥ 0.8, amber 0.6–0.8, red < 0.6, each with an icon), a stacked root-cause bar, and a **CostCounter** (avg LLM calls per question, % resolved in Tier 1/2/3, total time).
- **FailureList (left):** rows with a coloured dot by verdict; filters by qtype and verdict; sorted failures first.
- **AutopsyView (centre):** ChunkPanel (ranked chunks, gold outlined, in-context vs not) beside AnswerPanel (sentences green/red from `grounding`, red spans from `span_detector`; hover a sentence to highlight its `best_chunk_id`). Below: LensTabs (one tab per lens that ran, showing its evidence; lenses that didn't run greyed out with "not needed — resolved at Tier N"), ConsensusPanel (each lens's vote bar plus the final verdict sentence), CounterfactualStrip (mini cards per condition, ✓/✗).
- **PrescriptionRail (right):** prescription text + **Apply & re-test** → POST `/fix`, poll, then show before/after scorecards.
- Upload area + "Generate questions" + "Run evaluation" buttons in a compact top bar. A clean, professional look: neutral background, one accent colour, Inter font.
✅ Full flow works in the browser on the demo corpus.

**Phase 6 — Demo hardening (target 2:30 AM, freeze)**
- `demo/` contains a corpus with one fee/number table, and a **seeded bad config** (`chunk_size=1024, k=3, dense, no rerank, basic prompt`) that reliably produces retrieval failures and at least one hallucination.
- Pre-run the bad config and the prescribed fix so the cache makes the demo instant; the `/diff` endpoint is wired to the before/after view.
- README: setup, `.env`, how to run backend (`uvicorn app.main:app --reload`) and web (`npm run dev`), architecture summary, one screenshot.
✅ Cold restart → full demo runs in under 60 s from cache.

**Stretch, only after Phase 6 is green:** leave_one_out lens, multi-hop/paraphrase/distractor question types, learned consensus weights from a hand-labelled CSV (`demo/labels.csv` → logistic regression), black-box endpoint adapter (`POST {question} → {answer, contexts}`), document failure heatmap.

---

## 10. Quality bar

- Type hints everywhere; Pydantic for all I/O.
- Every lens has one unit test with a hand-made fixture (no network; mock the LLM client).
- No crashes on: empty PDF, scanned PDF with no text (show a clear error), a question with zero retrieved chunks, malformed LLM JSON.
- Log one line per question: `qid | tiers | calls | verdict | ms`.
- Never print API keys. Never commit `data/` or `.env`.

Start with Phase 1. Before writing code, show me the planned file list for Phase 1 and the exact install commands, then proceed.
