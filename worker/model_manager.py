"""Loads models once (cached on the RunPod network volume), keeps them on the
GPU, and frees VRAM on demand.

BiRefNet (~4 GB) + Qwen2.5-VL-7B 4-bit (~7 GB) + FashionSigLIP (~2 GB) ≈ 13 GB,
which fits the A5000's 24 GB, so the three ingest models can stay resident.
`release()` / `free_all()` exist for when the heavier try-on model is added:
load it, run it, then free it to stay under budget.
"""
import gc
import os
import threading

import torch

# Weights cache on the persistent volume so workers skip cold-start downloads.
os.environ.setdefault("HF_HOME", "/runpod-volume/models")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def cuda_cleanup() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


class ModelManager:
    def __init__(self) -> None:
        self._cache: dict[str, dict] = {}
        self._lock = threading.Lock()

    # ---- loaders (called once per model) ----
    def _load_birefnet(self) -> dict:
        from transformers import AutoModelForImageSegmentation

        model = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet", trust_remote_code=True
        )
        model.to(DEVICE).eval()
        return {"model": model}

    def _load_qwen(self) -> dict:
        from transformers import (
            AutoProcessor,
            BitsAndBytesConfig,
            Qwen2_5_VLForConditionalGeneration,
        )

        quant = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_use_double_quant=True,
        )
        model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            "Qwen/Qwen2.5-VL-7B-Instruct",
            quantization_config=quant,
            torch_dtype=torch.float16,
            device_map={"": 0} if DEVICE == "cuda" else None,
        ).eval()
        processor = AutoProcessor.from_pretrained("Qwen/Qwen2.5-VL-7B-Instruct")
        return {"model": model, "processor": processor}

    def _load_siglip(self) -> dict:
        # Marqo's documented path is open_clip (hf-hub), which avoids the
        # transformers meta-tensor issue with this custom model.
        import open_clip

        model, preprocess = open_clip.create_model_from_pretrained(
            "hf-hub:Marqo/marqo-fashionSigLIP"
        )
        model.to(DEVICE).eval()
        return {"model": model, "preprocess": preprocess}

    _LOADERS = {"birefnet": "_load_birefnet", "qwen": "_load_qwen", "siglip": "_load_siglip"}

    def get(self, name: str) -> dict:
        with self._lock:
            if name not in self._cache:
                self._cache[name] = getattr(self, self._LOADERS[name])()
            return self._cache[name]

    def release(self, name: str) -> None:
        with self._lock:
            obj = self._cache.pop(name, None)
        if obj is not None:
            del obj
            cuda_cleanup()

    def free_all(self) -> None:
        with self._lock:
            self._cache.clear()
        cuda_cleanup()


MANAGER = ModelManager()
