# RunPod Serverless — Dress Nation digitization worker.
# Base ships PyTorch 2.8 / CUDA 12.8 / Ubuntu 24.04, so we only add Python deps.
FROM runpod/pytorch:2.8.0-py3.11-cuda12.8.1-ubuntu24.04

WORKDIR /app

# All model weights cache on the persistent network volume to avoid cold-start
# downloads. The volume is mounted at /runpod-volume at run time.
ENV HF_HOME=/runpod-volume/models \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    TRANSFORMERS_VERBOSITY=error \
    PYTHONUNBUFFERED=1 \
    TOKENIZERS_PARALLELISM=false

COPY requirements.txt .
RUN pip install --no-cache-dir -U pip && \
    pip install --no-cache-dir hf_transfer && \
    pip install --no-cache-dir -r requirements.txt

COPY model_manager.py handler.py ./

CMD ["python", "-u", "handler.py"]
