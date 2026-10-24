import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
for noisy in ("httpx", "chromadb", "sentence_transformers"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

app = FastAPI(title="RAG Autopsy")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
