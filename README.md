# RAG Autopsy

**Find out *why* a RAG system gets answers wrong, not just *that* it does.**

Upload documents → RAG Autopsy builds a baseline RAG over them, generates typed test questions (each tied to a known
*gold* chunk), runs every question through the RAG under test, and diagnoses each answer with a three-tier cascade of
"lenses". Every failure gets a **root cause** (retrieval / generation / abstention + sub-cause), a **confidence**, and a
**prescription** (a concrete config change). One click re-tests the failures with the fix and shows before/after.

**The core trick:** because every question has a gold chunk, we can re-run the generator with the gold chunk swapped
in. If the answer becomes correct, that *proves* the retriever was at fault; if it stays wrong, the generator is.

![dashboard](docs/screenshot.png)

## Quick start

Requirements: Python 3.11, Node 18+, an OpenAI-compatible LLM endpoint (Groq's free tier works).

```bash
# backend
cd backend
py -3.11 -m venv .venv
.venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pip install lettucedetect "minicheck @ git+https://github.com/Liyan06/MiniCheck.git@main" accelerate
cp ../.env.example ../.env      # fill in LLM_BASE_URL, LLM_API_KEY, GEN_MODEL, JUDGE_MODEL (judge != generator)
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000

# web (second terminal)
cd web
npm install
npm run dev                      # http://localhost:5173
```

In the browser: **Demo corpus** → **Generate questions** → pick **Seeded bad config** → **Run evaluation** → click a
failure to see its autopsy → **Apply & re-test**.

Example `.env` (Groq):
```
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
GEN_MODEL=openai/gpt-oss-20b
JUDGE_MODEL=qwen/qwen3.8-27b
LLM_MAX_CONCURRENCY=4
DEVICE=cpu
```

CLI checks (from `backend/`): `pytest`, `scripts/smoke_rag.py`, `scripts/gen_questions.py`, `scripts/run_eval.py [--bad]`.

## How it works

```
documents ─► parse (PyMuPDF / pdfplumber / python-docx) ─► chunk (words, overlap; tables split on rows)
          ─► embed (bge-small) ─► Chroma, one collection per (corpus, chunk_size, overlap)

question generator ─► 1 JSON call per chunk: single_hop + numeric (+ unanswerable per doc)
                   ─► filters: exact evidence span found · no >8-word copying · dedup (cos > 0.9)
                               · judge says answerable · closed-book flag (can the model answer with no context?)

RAG under test ─► retrieve top-50 with ranks (dense | hybrid BM25+RRF | + cross-encoder rerank) ─► top-k ─► answer

cascade per question
  Tier 1 (0 LLM calls, every question)   forensics (gold rank, k-sweep, split evidence)
                                          span_detector (LettuceDetect hallucinated spans)
                                          answer_check (abstention rule / lexical match)
  Tier 2 (only if Tier 1 is unsure,       grounding (MiniCheck per sentence, best supporting chunk)
          or the answer may be wrong)     sufficiency (LLM: is the context enough?)
                                          answer_check (LLM judge, only if the lexical check was inconclusive)
  Tier 3 (only if still contested)        counterfactual (gold-only rerun; then no-context + shuffled)

consensus ─► weighted vote (counterfactual 3, grounding 2, forensics 1.5, span 1.5, sufficiency 1, answer 1)
          ─► verdict + sub-cause + confidence + needs_review ─► prescription
```

| Sub-cause | Meaning | Prescription |
|---|---|---|
| `ranking_miss` | gold retrieved at rank k+1…20 | reranker + k = 10 |
| `recall_miss` | gold not in top 20 | hybrid (dense + BM25) |
| `chunking_miss` | evidence cut across chunks / table fragment | chunk 256, overlap 96 |
| `hallucination` | unsupported claims | grounded prompt |
| `misread_incomplete` | gold in hand, still wrong | grounded prompt |
| `abstention_failure` | answered an unanswerable question | grounded prompt |
| `lucky_guess` / `parametric_answer` | right answer from memory, not documents | grounded prompt |

**Why gold remaps across chunk sizes:** questions store the exact character span of their evidence, so the fix loop can
re-chunk at 256 words and still know which new chunks are gold.

**Cost control:** every LLM call goes through one cached client (`app/llm/client.py`, diskcache keyed by model + messages).
Re-running anything is free, and the dashboard's cost counter shows LLM calls per question and % resolved at each tier.

## Layout

```
backend/app/
  ingest/      parser, chunker, indexer (Chroma + BM25)
  rag/         retriever (top-50 with ranks), pipeline (the RAG under test)
  generator/   prompts, typed question generation, filters
  lenses/      forensics, span_detector, grounding, sufficiency, answer_check, counterfactual
  cascade/     runner (tiers + escalation), consensus, prescriptions
  metrics/     scorecards + bootstrap 95% CIs
  api/         FastAPI routes
web/src/       React + Tailwind dashboard (HealthStrip, FailureList, AutopsyView, PrescriptionRail …)
demo/          8 fictional documents (fees/tariff/warranty tables, look-alike facts as distractors)
```
