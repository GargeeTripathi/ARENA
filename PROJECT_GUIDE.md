# RAG Autopsy: Project Guide

How the project works, file by file, plus the numbers to quote and answers to the questions judges are likely to ask.

---

## 1. The idea in one paragraph

Most RAG evaluation tools give you a score: "accuracy 0.71". They tell you **that** answers are wrong, not **why**.
RAG Autopsy diagnoses every wrong answer and names the root cause:

- **Retrieval failure**: the right text never reached the model (ranked too low, not found, or cut in half by chunking).
- **Generation failure**: the right text was there, but the model invented things or misread it.
- **Abstention failure**: the model answered a question the documents cannot answer, when it should have said "I don't know".

It then prescribes a concrete configuration fix, re-runs only the failed questions with that fix, and shows
before/after.

### The core trick: the gold chunk counterfactual

Every test question is generated **from a known passage** (the *gold chunk*). So when an answer is wrong we can run
an experiment instead of guessing:

> Re-ask the **same model** the same question, but give it **only the gold chunk**.
>
> - If it now answers correctly → the generator was fine; **retrieval failed** (proven).
> - If it is still wrong with the right text in hand → **the generator failed**.

That is the project's main novelty.

---

## 2. End-to-end flow

```
 ┌────────────┐   ┌──────────────┐   ┌───────────────────┐   ┌────────────────┐   ┌──────────────┐
 │ 1 Ingest   │──►│ 2 Test set   │──►│ 3 RAG under test   │──►│ 4 Diagnose      │──►│ 5 Prescribe   │
 │ parse,     │   │ LLM writes   │   │ retrieve top-50,   │   │ 3-tier cascade  │   │ + re-test     │
 │ chunk,     │   │ questions w/ │   │ send top-k to the  │   │ of "lenses",    │   │ before/after  │
 │ embed      │   │ gold evidence│   │ generator, answer  │   │ weighted vote   │   │ diff          │
 └────────────┘   └──────────────┘   └───────────────────┘   └────────────────┘   └──────────────┘
```

1. **Ingest:** documents (PDF / DOCX / TXT / MD) are parsed into text, split into chunks, embedded, and stored in a
   vector database (ChromaDB).
2. **Generate a test set:** an LLM writes typed questions from each chunk. Each question keeps the **exact sentence**
   that answers it.
3. **Run the RAG under test:** for each question, retrieve the top-50 chunks (with ranks), send the top *k* to the
   generator model, and record the answer.
4. **Diagnose** each answer with a cascade of checks called **lenses**. Cheap local checks run on every question;
   LLM-based checks run only when the cheap ones can't decide.
5. **Consensus:** the lenses' votes are weighted into one verdict + sub-cause + confidence.
6. **Prescribe and re-test:** each root cause maps to a config change. One click re-runs only the failed questions
   with the change and shows which were fixed, broken, or unchanged.

---

## 3. Folder and file map

```
rag-autopsy/
├── CLAUDE.md              original build specification
├── README.md              setup + how to run
├── PROJECT_GUIDE.md       this file
├── .env / .env.example    API keys + model names (.env is never committed)
├── demo/                  8 fictional documents used for the demo
├── data/                  (generated, not committed) uploads, vector DB, cache, saved runs
├── backend/               Python, FastAPI
│   ├── app/
│   │   ├── main.py            starts the API server
│   │   ├── config.py          reads .env, paths, consensus weights
│   │   ├── schemas.py         all data shapes (see section 4)
│   │   ├── store.py           saves runs as JSON in data/runs/
│   │   ├── llm/client.py      the ONLY place that talks to an LLM
│   │   ├── ingest/            parser.py, chunker.py, indexer.py
│   │   ├── rag/               retriever.py, pipeline.py   (the RAG being tested)
│   │   ├── generator/         prompts.py, generate.py, filters.py   (test questions)
│   │   ├── lenses/            one file per diagnostic check
│   │   ├── cascade/           runner.py, consensus.py, prescriptions.py
│   │   ├── metrics/           aggregate.py  (scorecards + confidence intervals + cost)
│   │   └── api/routes.py      HTTP endpoints for the dashboard
│   ├── scripts/               smoke_rag.py, gen_questions.py, run_eval.py, prewarm_demo.py
│   └── tests/                 24 unit tests (LLM always mocked)
└── web/                   React + Vite + Tailwind dashboard
    └── src/
        ├── api.ts             types + API calls
        ├── ui.tsx             shared design pieces + colour code
        ├── App.tsx            page layout
        └── components/        HealthStrip, CostCounter, FailureList, AutopsyView, ChunkPanel,
                               AnswerPanel, LensTabs, ConsensusPanel, CounterfactualStrip,
                               PrescriptionRail, Setup
```

---

## 4. Core data shapes (`backend/app/schemas.py`)

| Shape | What it holds |
|---|---|
| `Chunk` | `chunk_id`, document, page, text, `is_table`, and **start/end character offsets** in the page |
| `TestQuestion` | `qid`, type (`single_hop` / `numeric` / `unanswerable`), question, gold answer, gold chunk ids, the exact `evidence` sentence, `gold_span` (character range), `closed_book_correct` |
| `RagConfig` | the knobs being tested: `chunk_size`, `chunk_overlap`, `k`, `retrieval` (dense / hybrid), `rerank`, `prompt_style` (basic / grounded) |
| `RetrievedChunk` | chunk id, **rank**, score, text, `in_context` (rank ≤ k) |
| `RagTrace` | for one question: config, the top-50 ranked chunks, the answer, the answer split into sentences |
| `LensResult` | one lens's opinion: verdict, sub-cause, confidence 0–1, evidence (for the UI), LLM calls, latency |
| `Diagnosis` | the final call for one question: verdict, sub-cause, confidence, `needs_review`, all lens results, highest tier reached, prescription, cost |

**Verdicts:** `ok`, `retrieval`, `generation`, `abstention`, `uncertain`.
**Sub-causes:** `recall_miss`, `ranking_miss`, `chunking_miss`, `hallucination`, `misread_incomplete`,
`abstention_failure`, `lucky_guess`, `parametric_answer`, `wrong_chunk_reliance`.

---

## 5. Step by step

### 5.1 Ingest (`backend/app/ingest/`)

- **`parser.py`:** PyMuPDF reads PDF text; pdfplumber extracts tables and turns them into Markdown tables;
  python-docx reads Word files; `.txt` / `.md` are read directly. An empty or scanned (image-only) document raises
  a clear error instead of crashing.
- **`chunker.py`:** cuts each page into windows of N **words** with an overlap (for example 512 words, 64 overlap).
  Every chunk records its start/end character position. Tables are split on row boundaries, never mid-row, and flagged
  `is_table`.
- **`indexer.py`:** embeds chunks with **`BAAI/bge-small-en-v1.5`** and stores them in **ChromaDB**. There is one
  collection per *(corpus, chunk size, overlap)*, reused if it already exists. Changing the chunk size in a fix run
  builds a new index automatically. It also builds a **BM25** keyword index for hybrid search. The same uploaded
  files always get the same `corpus_id`, which keeps caches valid.

### 5.2 The RAG under test (`backend/app/rag/`)

- **`retriever.py`:** always returns the **top 50 with ranks**, even though only the top *k* go to the model.
  That is what lets forensics see that the right chunk was "just below the cut-off at rank 5".
  - `dense`: vector similarity in Chroma.
  - `hybrid`: dense + BM25 merged with **Reciprocal Rank Fusion**.
  - `rerank`: a cross-encoder (`BAAI/bge-reranker-base`) re-scores the candidates.
- **`pipeline.py`:** builds the prompt and calls the generator.
  - *basic* prompt: "Answer the question using the context."
  - *grounded* prompt: answer in 1–2 full sentences, cite passages like `[1]`, and reply exactly "I don't know" if
    the context lacks the answer.

  It then splits the answer into sentences, which the grounding lens checks one by one.

### 5.3 Test question generator (`backend/app/generator/`)

- **`generate.py`:** one JSON LLM call per chunk returns several questions, each with `qtype`, question, answer, and
  **evidence**: the exact sentence or table row from the chunk. Unanswerable questions are generated per document:
  on-topic, but not answered anywhere.
- **`filters.py`:** each candidate must pass these checks:
  1. **Evidence found.** The quoted evidence must be located in the chunk (exact, then whitespace-tolerant, then a
     best-matching line or sentence with ≥ 80% word overlap). If it can't be found, the question is dropped, so
     invented evidence never gets in.
  2. **Leakage.** The question must not copy more than 8 consecutive words from the chunk; otherwise it's too easy.
  3. **Dedup.** Questions with embedding cosine similarity > 0.9 to an earlier one are removed.
  4. **Answerability.** A judge LLM confirms the question can be answered from its chunk. For *unanswerable*
     questions, the judge must confirm the top-retrieved chunks do **not** answer it.
  5. **Closed-book flag.** We ask the generator with **no documents**. If it still gets the answer right, we record
     `closed_book_correct = true` (a parametric-memory risk).
- **Gold remapping:** the gold is stored as a **character range** in the document, so in *any* chunking the gold chunks
  are "the chunks that overlap that range". This is how a fix run with a different chunk size still knows which chunks
  are gold.

### 5.4 The LLM client (`backend/app/llm/client.py`)

Every LLM call in the project goes through this file:

- **Two roles:** `gen` (the RAG's answering model and question writing) and `judge` (correctness / sufficiency).
  They can even be on different providers (`GEN_BASE_URL` / `JUDGE_BASE_URL`).
- **Disk cache:** the key is a hash of (model, messages, temperature, json mode). The same call is never paid for twice.
  Re-running a whole evaluation is free and fast.
- **Concurrency limit**, **rate-limit handling** (waits exactly as long as the provider's "try again in X s" says),
  and **retries** on server errors.
- **JSON mode:** asks for JSON, parses tolerantly (first `{` to last `}`), and does one "repair" retry if the reply is
  not valid JSON.
- **Call counter** per lens: real (billed) calls vs cache hits, which feeds the cost display.
- **`memo()`:** the same disk cache is reused for local model outputs (span detector, grounding checker, reranker), so
  a cached demo doesn't even need to load those models.

### 5.5 The lenses (`backend/app/lenses/`)

Each lens is a small module with `NAME`, `TIER`, and `async run(question, trace, ctx) -> LensResult`.
`base.py` wraps every lens with timing, call counting, and crash safety: a failing lens returns "uncertain" and never
breaks the run.

| Tier | Lens | LLM? | What it decides |
|---|---|---|---|
| 1 | **forensics** | no | Best rank of the gold chunk. Rank ≤ k → retrieval OK (0.8). Rank k+1…20 → **ranking miss** (0.85). Deeper or absent → **recall miss** (0.9). Evidence split across chunks, or a table fragment → **chunking miss**. Also a "k-sweep": would k = 3 / 5 / 10 / 20 have caught it? |
| 1 | **span_detector** | no | **LettuceDetect** (ModernBERT token classifier) marks answer words not supported by the context. Any span with p > 0.5 → **hallucination**. Long contexts are split into groups, and a word only counts as unsupported if **every** group flags it. |
| 1 | **answer_check** | only if unsure | Unanswerable question: did it say "I don't know"? (a rule). Answerable: cheap word/number match against the gold answer; if inconclusive, an LLM judge decides at Tier 2. |
| 2 | **grounding** | no | **HHEM-2.1-Open** (or MiniCheck on a GPU) scores every answer sentence against ~300-word windows of each in-context chunk. Best score > 0.5 = supported. Records **which chunk** supports each sentence (powers hover-highlighting in the UI). |
| 2 | **sufficiency** | 1 call | Judge LLM: "is the retrieved context enough to answer?" Not enough + answerable → retrieval. Unanswerable + the model answered anyway → abstention failure. |
| 3 | **counterfactual** | 2–6 calls | Re-generate with **only the gold chunk**, then judge it. Gold run correct + original wrong → **retrieval, proven** (0.95). Still wrong → **generation** (0.9). If still ambiguous: a no-context run (does it know it from memory?) and a shuffled-order run (position sensitivity). |

### 5.6 The cascade (`backend/app/cascade/runner.py`)

```
run Tier 1 lenses (all together)
if not resolved → run Tier 2 lenses
if not resolved → run Tier 3 (counterfactual), at most once
consensus → diagnosis → prescription
```

**Resolved** means at least one lens is ≥ 80% confident and no other lens ≥ 60% confident contradicts it.
A retrieval-OK vote from forensics doesn't contradict a generation fault, because both can be true.
**Any answer that is not known to be correct always goes to at least Tier 2.**

Every question logs one line, for example: `q_d142cc2b | tiers 1,2,3 | calls 4 | retrieval/ranking_miss | 4958ms`.

### 5.7 Consensus (`backend/app/cascade/consensus.py`)

- Weights: **counterfactual 3.0, grounding 2.0, forensics 1.5, span_detector 1.5, sufficiency 1.0, answer_check 1.0**.
  They live in `config.py` so they can later be learned from hand-labelled data.
- Each verdict's score = Σ (weight × confidence) of the lenses voting for it. The highest score wins.
  **Confidence = winning score ÷ total score.**
- If the answer is known to be wrong, an "ok" verdict cannot win.
- Correct and grounded → `ok`. Correct but not grounded, and the model knew it closed-book → `lucky_guess`.
- An unanswerable question that was answered → `abstention_failure` (the made-up content is a symptom).
- **Needs human review** if any of these hold:
  - confidence < 0.6
  - the two grounding checkers strongly disagree
  - an "unanswerable" question's answer turns out fully supported (the test question itself may be mislabelled)

### 5.8 Prescriptions (`backend/app/cascade/prescriptions.py`)

| Root cause | Fix (config patch) |
|---|---|
| ranking_miss | `rerank = true`, `k = 10` |
| recall_miss | `retrieval = hybrid` |
| chunking_miss | `chunk_size = 256`, `chunk_overlap = 96` |
| hallucination / misread_incomplete / lucky_guess | `prompt_style = grounded` |
| abstention_failure | `prompt_style = grounded` |

For a whole run, the patches of all failure causes are merged, most common first. **Apply & re-test** re-runs only the
failed questions with the merged config.

### 5.9 Metrics (`backend/app/metrics/aggregate.py`)

| Scorecard | Meaning | Computed over |
|---|---|---|
| Context relevance | gold chunk is within the top-k | answerable questions |
| Faithfulness | share of answer sentences that are supported | answerable questions |
| Accuracy | answer matches the gold answer | answerable questions |
| Abstention | said "I don't know" when it should | unanswerable questions |

Each scorecard has a **95% bootstrap confidence interval** (1,000 resamples), which keeps small samples honest.
**Cost:** average LLM calls per question, % of questions settled at Tier 1 / 2 / 3, billed vs cached calls, total time.

### 5.10 API (`backend/app/api/routes.py`)

| Method + path | Purpose |
|---|---|
| `POST /api/corpus` | upload files → parse, chunk, index |
| `POST /api/corpus/demo` | load the bundled demo documents |
| `POST /api/corpus/{id}/questions` | generate the test set |
| `GET /api/corpus/{id}/questions` | the saved test set |
| `POST /api/runs` | start an evaluation (runs in the background) |
| `GET /api/runs/{id}` | run overview + progress (lightweight; `?full=true` for everything) |
| `GET /api/runs/{id}/questions/{qid}` | everything for one question's autopsy |
| `POST /api/runs/{id}/fix` | re-test failed questions with the prescribed (or a custom) config |
| `GET /api/runs/{a}/diff/{b}` | fixed / broken / unchanged + scorecard changes |
| `GET /api/runs/{id}/report.md` | Markdown root-cause report |

### 5.11 Dashboard (`web/`)

- **Header:** run picker, "New evaluation", light/dark theme toggle.
- **Setup (3 steps):** add documents → generate questions → choose a config and run.
- **Overview:** 4 scorecards (with status), a Diagnosis card (failing vs healthy by cause), and a cost card.
- **Recommended fix banner:** what to change, then **Apply & re-test**, then before/after.
- **Question list:** Failures / Review / All, search, filter by type.
- **Autopsy view:** the question, expected answer, verdict and confidence, a "proven by counterfactual" callout, and
  three tabs:
  - **Answer & evidence:** sentences coloured green/red, flagged words underlined, the ranked chunks with gold outlined
    and the k cut-off marked.
  - **How we diagnosed it:** consensus vote bars and one card per lens (skipped lenses greyed out).
  - **Counterfactual:** original vs gold-only (vs no-context / shuffled) answers with ✓ / ✗.

**Colour code (used everywhere):**
- green = healthy
- amber = retrieval
- rose = generation
- violet = abstention
- grey = uncertain
- indigo = actions

---

## 6. Technology choices

| Part | Choice | Why |
|---|---|---|
| Backend | Python 3.11, FastAPI, Pydantic v2 | typed I/O, async, fast to build |
| Vector DB | ChromaDB (local, persistent) | no server to run |
| Embeddings | bge-small-en-v1.5 | small, strong, runs on CPU |
| Keyword search | rank_bm25 | for hybrid retrieval |
| Reranker | bge-reranker-base | the "ranking miss" fix |
| Hallucination spans | LettuceDetect (ModernBERT) | word-level, no LLM |
| Grounding | HHEM-2.1-Open (MiniCheck Flan-T5-Large on GPU) | sentence-level support, no LLM |
| LLMs | any OpenAI-compatible API; demo uses **Gemini 3.5 Flash-Lite** (generator) + **Groq gpt-oss-120b** (judge) | free tiers; different families, so the judge doesn't favour the model it grades |
| Cache | diskcache (SQLite) | every LLM / model result is paid for once |
| Frontend | React, Vite, TypeScript, Tailwind, lucide icons | fast, clean UI |
| No LangChain / LlamaIndex | on purpose | every line is ours and explainable |

---

## 7. Demo numbers to quote

- **Corpus:** 8 fictional documents (university handbook + scholarships, water purifier manual + warranty terms, HR
  remote work / leave / travel policies, a water tariff). The facts are invented so the model **can't answer from memory**.
  Look-alike numbers across documents act as distractors.
- **Test set:** 83 questions: 31 single-hop, 30 numeric, 22 unanswerable.
- **Seeded bad config** (1024-word chunks, k = 3, dense only, basic prompt):
  - context relevance 0.92, faithfulness 0.94, accuracy 0.93, **abstention 0.64**
  - **12 failures: 4 ranking misses + 8 abstention failures**
- **Prescribed fix:** reranker + k = 10 + grounded prompt → **fixes 10 of 12, breaks 0**.
  On the failed set: context relevance 0 → 1.0, accuracy 0 → 1.0, abstention 0 → 0.75, faithfulness 0.92 → 1.0.
- **Cost:** **0.36 LLM calls per question** on average; **81%** of questions settled at Tier 1 with zero LLM calls.
- **Speed:** cold restart → whole demo replayed from cache in **51 s** (17 s when warm).
- **Example to show:** *"What is the fee for transferring a CarePlus plan?"* The original answer says "no mention of
  a CarePlus plan" (the right chunk ranked just below k = 3). Given only the gold chunk, the same model says
  "INR 500" → **retrieval failure, proven**.

---

## 8. Honest trade-offs and limitations

- **Chunk size is counted in words, not tokens** (~0.75 words per token). It's simpler and still an honest knob.
- **HHEM instead of MiniCheck on CPU.** MiniCheck took ~3 min per question on this laptop; `GROUNDING_MODEL=minicheck`
  switches back on a GPU.
- **Free-tier LLMs** have per-minute and per-day caps. The client waits them out, and the cache means each call is paid
  once. The sufficiency judge's context is capped at ~4,000 words to fit Groq's per-request limit.
- **Generated questions can be wrong.** One "unanswerable" question was actually answerable; the system flags such
  cases for human review instead of hiding them.
- **Consensus weights are hand-set** for v1; the design is ready to learn them from labelled data.
- **It evaluates its own configurable RAG pipeline.** Plugging in an external RAG endpoint is the next step.
- **Not built (stretch goals):** leave-one-out lens, multi-hop / paraphrase / distractor questions, learned weights,
  external RAG adapter, per-document failure heatmap.

---

## 9. Likely judge questions, with answers

**How is this different from RAGAS / TruLens / DeepEval?**
Those mostly give aggregate scores. We give a **root cause per failed question**, **prove** retrieval failures with a
counterfactual experiment, and close the loop with a **tested fix** and a before/after diff.

**Isn't it circular to use an LLM to judge an LLM?**
Most verdicts come from non-LLM evidence: rank positions, a token classifier (LettuceDetect), and an entailment model
(HHEM). The LLM judge is a **different model family** from the generator. And the counterfactual is an experiment
(swap the context, observe the answer), not an opinion.

**Why do you need a gold chunk?**
It turns "is retrieval bad?" into a measurable fact: where did the right chunk rank? It also enables the
counterfactual swap. We get gold for free because we generate questions *from* chunks and keep the exact evidence.

**What if your generated questions are bad?**
Every question must quote its evidence exactly (verified in the text), must not copy the chunk verbatim, must be
confirmed answerable by a judge, and is deduplicated. Suspicious ones are flagged for human review.

**Why a cascade instead of running every check?**
Cost. LLM checks are slow and paid. Cheap local checks settle ~81% of questions; LLM calls go only to the uncertain
or contested ones. That's ~0.36 calls per question.

**How do you combine conflicting lenses?**
A weighted vote (weight × confidence). The counterfactual has the highest weight because it is an experiment.
Confidence is the winner's share of the total vote; low confidence or strong disagreement → "needs review".

**How confident are your scores with only ~80 questions?**
Every scorecard has a 95% bootstrap confidence interval, shown on the dashboard (e.g. abstention 0.64 ± 0.18).

**Does the fix ever make things worse?**
The diff reports **broken** questions explicitly. In the demo, 0 broke.

**Would this work on my RAG system?**
The pipeline is configurable (chunking, k, dense/hybrid, reranker, prompt). The planned extension is a black-box
adapter: any endpoint that takes a question and returns answer + contexts.

**What does it cost to run?**
On free tiers, $0. Every LLM call and model result is cached, so re-runs are instant and free.

---

## 10. How to run

```bash
# backend (terminal 1)
cd backend
.venv\Scripts\python -m uvicorn app.main:app --port 8000

# frontend (terminal 2)
cd web
npm run dev          # open http://localhost:5173

# before a demo (terminal 3, backend running)
cd backend
.venv\Scripts\python scripts\prewarm_demo.py

# tests
cd backend
.venv\Scripts\python -m pytest
```

In the browser: **New evaluation → Use demo corpus → (questions already generated) → Seeded bad config → Run
evaluation**, or just pick the saved run from the dropdown. Then click a failure → read its autopsy → **Apply & re-test**.
