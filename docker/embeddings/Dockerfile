# Einmal-Job: Vokabular-Embeddings (CPU). Build-Kontext: Repo-Root (.).
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# CPU-only Torch zuerst — vermeidet den mehrere GB großen CUDA-Stack von PyPI.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY scripts/embeddings/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY scripts/embeddings/compute_vocab_embeddings.py .

ENV HF_HOME=/cache/huggingface
ENV TRANSFORMERS_CACHE=/cache/huggingface

ENTRYPOINT ["python", "/app/compute_vocab_embeddings.py"]
