---
title: RAG Autopsy API
emoji: 🩺
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
short_description: Backend for rag-autopsy.vercel.app
---

# RAG Autopsy: backend API

This Space runs the Python backend for **[RAG Autopsy](https://rag-autopsy.vercel.app)**: document ingest,
test-question generation, the RAG under test and the 3-tier diagnostic cascade.
The dashboard at rag-autopsy.vercel.app calls it when visitors upload their own documents.

- Code: https://github.com/GargeeTripathi/rag-autopsy
- Health check: `/api/health`
- Limits for public use: up to 3 files and 2 MB per upload; questions are written from at most 12 chunks.
