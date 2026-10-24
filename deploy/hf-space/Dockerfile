# ARENA backend for a Hugging Face Docker Space (CPU, 16 GB free tier).
FROM python:3.11-slim

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/user/.cache/huggingface \
    RAG_DATA_DIR=/home/user/data \
    DEVICE=cpu \
    GROUNDING_MODEL=hhem \
    LLM_MAX_CONCURRENCY=3 \
    UPLOAD_MAX_FILES=3 \
    UPLOAD_MAX_MB=2 \
    GEN_MAX_CHUNKS=12

RUN useradd -m -u 1000 user
WORKDIR /home/user/app

COPY requirements.txt constraints.txt ./
RUN pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt lettucedetect accelerate -c constraints.txt

USER user
COPY --chown=user . .
# Bake the local models into the image so a cold start doesn't download ~2 GB.
RUN python preload.py

EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
