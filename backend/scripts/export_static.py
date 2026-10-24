"""Export a finished demo (bad run + its fix run) as static JSON, so the dashboard can be hosted without the
Python backend (e.g. on Vercel). Uses the running API, so the files are exactly what the live app serves.

Run from backend/ with the API up:
    .venv/Scripts/python scripts/export_static.py <bad_run_id> <fix_run_id> [out_dir]
"""
import json
import sys
import urllib.request
from pathlib import Path

API = "http://localhost:8000/api"


def get(path: str):
    with urllib.request.urlopen(API + path, timeout=120) as r:
        return json.load(r)


def main() -> None:
    bad, fix = sys.argv[1], sys.argv[2]
    out = Path(sys.argv[3] if len(sys.argv) > 3 else Path(__file__).resolve().parents[2] / "web" / "public" / "demo")
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()

    def save(name: str, data) -> None:
        (out / name).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")

    rb, rf = get(f"/runs/{bad}"), get(f"/runs/{fix}")
    cid = rb["corpus_id"]
    save("corpus.json", get(f"/corpus/{cid}"))
    save("questions.json", get(f"/corpus/{cid}/questions"))
    keep = ("run_id", "corpus_id", "config", "status", "scorecards", "cost", "parent_run_id")
    save("runs.json", [{k: r[k] for k in keep} for r in (rb, rf)])
    save("manifest.json", {"bad_run": bad, "fix_run": fix, "corpus_id": cid})
    save(f"diff_{bad}_{fix}.json", get(f"/runs/{bad}/diff/{fix}"))
    n = 0
    for r in (rb, rf):
        save(f"run_{r['run_id']}.json", r)
        for d in r["diagnoses"]:
            save(f"autopsy_{r['run_id']}_{d['qid']}.json", get(f"/runs/{r['run_id']}/questions/{d['qid']}"))
            n += 1
    size = sum(p.stat().st_size for p in out.glob("*.json"))
    print(f"exported {n} autopsies + runs to {out} ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
