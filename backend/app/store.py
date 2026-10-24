"""Runs live in memory while running and as JSON under data/runs/ once finished."""
import json
import uuid

from app import config

_live: dict[str, dict] = {}


def new_run(corpus_id: str, cfg: dict, qids: list[str], parent: str | None = None) -> dict:
    run_id = uuid.uuid4().hex[:10]
    run = {"run_id": run_id, "corpus_id": corpus_id, "config": cfg, "qids": qids, "parent_run_id": parent,
           "status": "running", "progress": {"done": 0, "total": len(qids)},
           "traces": [], "diagnoses": [], "scorecards": {}, "cost": {}, "prescription": None, "error": None}
    _live[run_id] = run
    return run


def save(run: dict) -> None:
    (config.RUNS_DIR / f"{run['run_id']}.json").write_text(json.dumps(run), encoding="utf-8")
    if run["status"] != "running":
        _live.pop(run["run_id"], None)


def get(run_id: str) -> dict | None:
    if run_id in _live:
        return _live[run_id]
    p = config.RUNS_DIR / f"{run_id}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def latest(corpus_id: str | None = None) -> list[dict]:
    """Finished runs, newest first (id, config, scorecards only)."""
    out = []
    for p in sorted(config.RUNS_DIR.glob("*.json"), key=lambda p: -p.stat().st_mtime):
        r = json.loads(p.read_text(encoding="utf-8"))
        if corpus_id is None or r["corpus_id"] == corpus_id:
            out.append({k: r[k] for k in ("run_id", "corpus_id", "config", "status", "scorecards", "cost", "parent_run_id")})
    return out
