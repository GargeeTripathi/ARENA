"""Env loading + paths. RagConfig defaults live in schemas.RagConfig."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # rag-autopsy/
DATA = ROOT / "data"
CHROMA_DIR = DATA / "chroma"
CACHE_DIR = DATA / "cache"
RUNS_DIR = DATA / "runs"
UPLOADS_DIR = DATA / "uploads"
DEMO_DIR = ROOT / "demo"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv(ROOT / ".env")

LLM_BASE_URL = os.getenv("LLM_BASE_URL") or None
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
GEN_MODEL = os.getenv("GEN_MODEL", "")
JUDGE_MODEL = os.getenv("JUDGE_MODEL", "")
LLM_MAX_CONCURRENCY = int(os.getenv("LLM_MAX_CONCURRENCY", "6"))
DEVICE = os.getenv("DEVICE", "cpu")

EMBED_MODEL = "BAAI/bge-small-en-v1.5"
RERANK_MODEL = "BAAI/bge-reranker-base"
TOP_N = 50  # retriever always returns this many, with ranks

# Consensus weights (v1 fixed; later learned from labels)
LENS_WEIGHTS = {
    "counterfactual": 3.0, "grounding": 2.0, "forensics": 1.5,
    "span_detector": 1.5, "sufficiency": 1.0, "answer_check": 1.0,
}

for d in (DATA, CHROMA_DIR, CACHE_DIR, RUNS_DIR, UPLOADS_DIR):
    d.mkdir(parents=True, exist_ok=True)
