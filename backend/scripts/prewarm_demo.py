"""Phase 6: drive the API like the demo does (demo corpus -> seeded bad config -> prescribed fix -> diff).
Every LLM call and checker-model result is disk-cached, so after one full pass this replays in about a minute.
Run with the API up:  .venv/Scripts/python scripts/prewarm_demo.py
"""
import json
import sys
import time
import urllib.request

API = "http://localhost:8000/api"
BAD = {"chunk_size": 1024, "chunk_overlap": 64, "k": 3, "retrieval": "dense", "rerank": False, "prompt_style": "basic"}


def call(path: str, body: dict | None = None):
    req = urllib.request.Request(API + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def wait(run_id: str) -> dict:
    while True:
        r = call(f"/runs/{run_id}")
        print(f"\r  {run_id}: {r['progress']['done']}/{r['progress']['total']}", end="", flush=True)
        if r["status"] != "running":
            print()
            if r["status"] != "done":
                sys.exit(f"run failed: {r['error']}")
            return r
        time.sleep(2)


def main() -> None:
    t = time.time()
    corpus = call("/corpus/demo", {})
    print(f"corpus {corpus['corpus_id']}: {corpus['n_docs']} docs, {corpus['n_questions']} questions")
    bad = wait(call("/runs", {"corpus_id": corpus["corpus_id"], "config": BAD})["run_id"])
    print(f"bad config -> causes {bad['scorecards']['root_causes']}")
    fix = call(f"/runs/{bad['run_id']}/fix", {})
    print(f"prescribed patch {fix['patch']}")
    wait(fix["run_id"])
    d = call(f"/runs/{bad['run_id']}/diff/{fix['run_id']}")
    print(f"diff {d['counts']}")
    for k in ("context_relevance", "faithfulness", "accuracy", "abstention"):
        print(f"  {k:18} {d['before'][k]['value']} -> {d['after'][k]['value']}")
    print(f"done in {time.time() - t:.0f}s (bad run {bad['run_id']}, fix run {fix['run_id']})")


if __name__ == "__main__":
    main()
