import asyncio
import logging

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app import config, store
from app.cascade.prescriptions import run_patch
from app.cascade.runner import evaluate
from app.generator.generate import generate_questions, load_questions
from app.ingest import indexer
from app.ingest.parser import ParseError
from app.metrics import aggregate
from app.schemas import Diagnosis, RagConfig, RagTrace, TestQuestion

log = logging.getLogger("api")
router = APIRouter(prefix="/api")
_tasks: set[asyncio.Task] = set()  # keep references so background runs aren't garbage-collected


# ---- corpus ------------------------------------------------------------------
@router.post("/corpus")
async def upload_corpus(files: list[UploadFile] = File(...)) -> dict:
    if config.UPLOAD_MAX_FILES and len(files) > config.UPLOAD_MAX_FILES:
        raise HTTPException(400, f"Upload at most {config.UPLOAD_MAX_FILES} files at a time.")
    data = [(f.filename or "file", await f.read()) for f in files]
    total_mb = sum(len(b) for _, b in data) / 1e6
    if config.UPLOAD_MAX_MB and total_mb > config.UPLOAD_MAX_MB:
        raise HTTPException(400, f"Files total {total_mb:.1f} MB; the limit is {config.UPLOAD_MAX_MB:g} MB.")
    bad = [n for n, _ in data if not n.lower().endswith(tuple(indexer.SUPPORTED))]
    if bad:
        raise HTTPException(400, f"unsupported file type: {', '.join(bad)} (use pdf, docx, txt, md)")
    cid = indexer.create_corpus(data)
    cfg = RagConfig()
    try:
        chunks = await asyncio.to_thread(indexer.build_index, cid, cfg.chunk_size, cfg.chunk_overlap)
    except ParseError as e:
        raise HTTPException(400, str(e))
    return _corpus_info(cid, chunks)


def _corpus_info(cid: str, chunks) -> dict:
    files = sorted(p.name for p in indexer.corpus_dir(cid).iterdir() if p.suffix.lower() in indexer.SUPPORTED and not p.name.startswith("_"))
    return {"corpus_id": cid, "n_docs": len({c.doc_id for c in chunks}), "n_chunks": len(chunks),
            "n_questions": len(load_questions(cid)), "files": files}


@router.post("/corpus/demo")
async def demo_corpus() -> dict:
    """One-click demo: load the bundled demo/ corpus."""
    data = [(p.name, p.read_bytes()) for p in sorted(config.DEMO_DIR.iterdir()) if p.suffix in indexer.SUPPORTED]
    cid = indexer.create_corpus(data)
    cfg = RagConfig()
    chunks = await asyncio.to_thread(indexer.build_index, cid, cfg.chunk_size, cfg.chunk_overlap)
    return {"corpus_id": cid, "n_docs": len(data), "n_chunks": len(chunks), "n_questions": len(load_questions(cid))}


class QuestionsReq(BaseModel):
    n_per_type: int = 2
    types: list[str] = ["single_hop", "numeric", "unanswerable"]


_gen: dict[str, dict] = {}  # corpus_id -> {"state": running|done|error, "error": str|None}


@router.post("/corpus/{corpus_id}/questions", status_code=202)
async def make_questions(corpus_id: str, req: QuestionsReq) -> dict:
    """Starts question generation in the background (it takes minutes); poll .../questions/status."""
    if not indexer.corpus_dir(corpus_id).exists():
        raise HTTPException(404, "unknown corpus")
    if _gen.get(corpus_id, {}).get("state") == "running":
        return _gen[corpus_id]
    job = _gen[corpus_id] = {"state": "running", "error": None}

    async def go() -> None:
        try:
            await generate_questions(corpus_id, req.n_per_type, req.types)
            job["state"] = "done"
        except Exception as e:
            log.exception("question generation failed for %s", corpus_id)
            job.update(state="error", error=str(e)[:300])

    task = asyncio.create_task(go())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return job


@router.get("/corpus/{corpus_id}/questions/status")
def questions_status(corpus_id: str) -> dict:
    return _gen.get(corpus_id) or {"state": "done" if load_questions(corpus_id) else "idle", "error": None}


@router.get("/corpus/{corpus_id}")
def corpus_info(corpus_id: str) -> dict:
    d = indexer.corpus_dir(corpus_id)
    if not d.exists():
        raise HTTPException(404, "unknown corpus")
    cfg = RagConfig()
    chunks = indexer.build_index(corpus_id, cfg.chunk_size, cfg.chunk_overlap)
    return _corpus_info(corpus_id, chunks)


@router.get("/corpus/{corpus_id}/questions")
def get_questions(corpus_id: str) -> list[TestQuestion]:
    return load_questions(corpus_id)


# ---- runs --------------------------------------------------------------------
class RunReq(BaseModel):
    corpus_id: str
    config: RagConfig = RagConfig()
    qids: list[str] | None = None


def _start(corpus_id: str, cfg: RagConfig, questions: list[TestQuestion], parent: str | None = None) -> str:
    run = store.new_run(corpus_id, cfg.model_dump(), [q.qid for q in questions], parent)

    def on_done(tr: RagTrace, d: Diagnosis) -> None:  # partial results while running
        run["traces"].append(tr.model_dump())
        run["diagnoses"].append(d.model_dump())
        run["progress"]["done"] += 1

    async def go() -> None:
        try:
            r = await evaluate(corpus_id, questions, cfg, on_done)
            run["traces"] = [t.model_dump() for t in r["traces"]]
            run["diagnoses"] = [d.model_dump() for d in r["diagnoses"]]
            run["scorecards"], run["cost"] = r["scorecards"], r["cost"]
            sentences, patch = run_patch(r["diagnoses"], cfg)
            run["prescription"] = {"sentences": sentences, "patch": patch}
            run["status"] = "done"
        except Exception as e:
            log.exception("run %s failed", run["run_id"])
            run["status"], run["error"] = "error", str(e)[:500]
        store.save(run)

    task = asyncio.create_task(go())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return run["run_id"]


@router.post("/runs")
async def start_run(req: RunReq) -> dict:
    qs = load_questions(req.corpus_id)
    if req.qids:
        qs = [q for q in qs if q.qid in set(req.qids)]
    if not qs:
        raise HTTPException(400, "no questions for this corpus: generate them first")
    return {"run_id": _start(req.corpus_id, req.config, qs)}


def _run_or_404(run_id: str) -> dict:
    run = store.get(run_id)
    if not run:
        raise HTTPException(404, "unknown run")
    return run


@router.get("/runs")
def list_runs(corpus_id: str | None = None) -> list[dict]:
    return store.latest(corpus_id)


_SUMMARY = ("qid", "verdict", "sub_cause", "confidence", "needs_review", "max_tier_reached", "prescription",
            "total_llm_calls", "total_cached_calls", "total_latency_ms")


@router.get("/runs/{run_id}")
def get_run(run_id: str, full: bool = False) -> dict:
    """Run overview. Per-question detail (traces, lens evidence) lives in /questions/{qid} unless full=true."""
    run = _run_or_404(run_id)
    qs = {q.qid: q for q in load_questions(run["corpus_id"])}
    out = {**run, "questions": [qs[q].model_dump() for q in run["qids"] if q in qs]}
    if not full:
        out["traces"] = []
        out["diagnoses"] = [{k: d.get(k) for k in _SUMMARY} | {"lenses_run": [l["lens"] for l in d["lens_results"]]}
                            for d in run["diagnoses"]]
    return out


@router.get("/runs/{run_id}/questions/{qid}")
def get_autopsy(run_id: str, qid: str) -> dict:
    run = _run_or_404(run_id)
    tr = next((t for t in run["traces"] if t["qid"] == qid), None)
    d = next((d for d in run["diagnoses"] if d["qid"] == qid), None)
    q = next((q for q in load_questions(run["corpus_id"]) if q.qid == qid), None)
    if not (tr and d and q):
        raise HTTPException(404, "question not in this run (yet)")
    cfg = RagConfig(**run["config"])
    chunks = indexer.load_chunks(run["corpus_id"], cfg.chunk_size, cfg.chunk_overlap)
    from app.generator.generate import gold_chunk_ids_for
    return {"question": q.model_dump(), "trace": tr, "diagnosis": d, "gold_chunk_ids": gold_chunk_ids_for(q, chunks)}


class FixReq(BaseModel):
    qids: list[str] | None = None
    config_patch: dict | None = None


@router.post("/runs/{run_id}/fix")
async def fix(run_id: str, req: FixReq) -> dict:
    run = _run_or_404(run_id)
    if run["status"] != "done":
        raise HTTPException(409, "run not finished")
    failed = [d["qid"] for d in run["diagnoses"] if d["verdict"] != "ok"]
    qids = set(req.qids or failed)
    patch = req.config_patch if req.config_patch is not None else (run.get("prescription") or {}).get("patch", {})
    cfg = RagConfig(**{**run["config"], **patch})
    qs = [q for q in load_questions(run["corpus_id"]) if q.qid in qids]
    if not qs:
        raise HTTPException(400, "nothing to fix: no failed questions")
    return {"run_id": _start(run["corpus_id"], cfg, qs, parent=run_id), "config": cfg.model_dump(), "patch": patch}


@router.get("/runs/{a}/diff/{b}")
def diff(a: str, b: str) -> dict:
    ra, rb = _run_or_404(a), _run_or_404(b)
    da = {d["qid"]: d for d in ra["diagnoses"]}
    db = {d["qid"]: d for d in rb["diagnoses"]}
    common = [q for q in rb["qids"] if q in da and q in db]
    rows = []
    for qid in common:
        before, after = da[qid]["verdict"] == "ok", db[qid]["verdict"] == "ok"
        status = "fixed" if after and not before else "broken" if before and not after else "unchanged"
        rows.append({"qid": qid, "status": status, "before": da[qid]["verdict"], "after": db[qid]["verdict"],
                     "before_sub": da[qid]["sub_cause"], "after_sub": db[qid]["sub_cause"]})

    qs = load_questions(ra["corpus_id"])

    def sc(run: dict) -> dict:  # scorecards over the common questions only, so it's apples to apples
        keep = set(common)
        return aggregate.scorecards(
            qs, [RagTrace(**t) for t in run["traces"] if t["qid"] in keep],
            [Diagnosis(**d) for d in run["diagnoses"] if d["qid"] in keep])

    sa, sb = sc(ra), sc(rb)
    deltas = {k: (None if sa[k]["value"] is None or sb[k]["value"] is None else round(sb[k]["value"] - sa[k]["value"], 3))
              for k in ("context_relevance", "faithfulness", "accuracy", "abstention")}
    counts = {s: sum(r["status"] == s for r in rows) for s in ("fixed", "broken", "unchanged")}
    return {"before": sa, "after": sb, "deltas": deltas, "rows": rows, "counts": counts,
            "config_before": ra["config"], "config_after": rb["config"]}


@router.get("/runs/{run_id}/report.md", response_class=PlainTextResponse)
def report(run_id: str) -> str:
    run = _run_or_404(run_id)
    qs = {q.qid: q for q in load_questions(run["corpus_id"])}
    sc, cost = run["scorecards"], run["cost"]
    lines = [f"# ARENA report: run `{run_id}`", "", f"Config: `{run['config']}`", "", "## Scorecards", "",
             "| Metric | Value | 95% CI | n |", "|---|---|---|---|"]
    for k in ("context_relevance", "faithfulness", "accuracy", "abstention"):
        s = sc.get(k) or {}
        lines.append(f"| {k} | {s.get('value')} | {s.get('lo')}–{s.get('hi')} | {s.get('n')} |")
    lines += ["", f"Root causes: {sc.get('root_causes')}", "",
              f"Cost: {cost.get('total_llm_calls')} LLM calls ({cost.get('avg_llm_calls')}/question); "
              f"resolved at tier 1/2/3: {cost.get('resolved_pct')}%", "", "## Prescription", ""]
    p = run.get("prescription") or {}
    lines += [f"- {s}" for s in p.get("sentences", [])] or ["- none"]
    lines += ["", f"Config patch: `{p.get('patch')}`", "", "## Failures", ""]
    for d in run["diagnoses"]:
        if d["verdict"] == "ok":
            continue
        q = qs.get(d["qid"])
        lines += [f"### {d['qid']}: {d['verdict']} / {d['sub_cause']} (confidence {d['confidence']}, tier {d['max_tier_reached']})",
                  "", f"**Q:** {q.question if q else '?'}  ", f"**Gold:** {q.gold_answer if q else '?'}  ",
                  f"**Prescription:** {d['prescription']}", ""]
    return "\n".join(lines)
