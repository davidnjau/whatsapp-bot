# RunPod Serverless — Dress Nation digitization worker.
# Base ships PyTorch 2.8.0 / CUDA 12.8.1 / Ubuntu 24.04, so we only add Python
# deps. RunPod's real tag scheme is <template>-cu<cuda>-torch<torch>-ubuntu<ver>:
# cu1281 = CUDA 12.8.1, torch280 = PyTorch 2.8.0. The plain
# "2.8.0-py3.11-cuda12.8.1-ubuntu24.04" form does NOT exist on Docker Hub.
FROM runpod/pytorch:2.2.0-cu1281-torch280-ubuntu2404

WORKDIR /app

# Font for the baked-in product-card text (colour/size/fabric overlay).
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# All model weights cache on the persistent network volume to avoid cold-start
# downloads. The volume is mounted at /runpod-volume at run time.
ENV HF_HOME=/runpod-volume/models \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    TRANSFORMERS_VERBOSITY=error \
    PYTHONUNBUFFERED=1 \
    TOKENIZERS_PARALLELISM=false

COPY requirements.txt .
# The base image's cryptography is distutils-installed (no RECORD), so pip can't
# uninstall it when a dep wants a newer one. Install it fresh first with
# --ignore-installed so the later resolve doesn't try (and fail) to remove it.
RUN pip install --no-cache-dir -U pip && \
    pip install --no-cache-dir hf_transfer && \
    pip install --no-cache-dir --ignore-installed cryptography && \
    pip install --no-cache-dir -r requirements.txt

COPY model_manager.py handler.py ./

CMD ["python", "-u", "handler.py"]
