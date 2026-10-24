"""Download and load every local model once at image build time (embedder, span detector, grounding checker,
reranker), so the Space answers its first request without fetching ~2 GB."""
from app.ingest import indexer
from app.lenses import grounding, span_detector
from app.rag import retriever

indexer.embedder()
assert span_detector.detector() is not None, "LettuceDetect failed to load"
assert grounding.scorer() is not None, "grounding checker failed to load"
retriever.reranker()
print("models ready")
