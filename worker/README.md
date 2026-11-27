# Dress Nation — digitization worker (RunPod Serverless)

Multi-task GPU worker for the boutique commerce engine. Routes on
`event["input"]["task"]`. See `../docs/ai-ingestion-plan.md` for how it ties
into the WhatsApp/shop app.

## Tasks
| task | what it does | models |
|---|---|---|
| `ingest_product` | transparent cutout + studio-white image, e-commerce copy, fit profile, 512-d embedding | **BiRefNet** (MIT), **Qwen2.5-VL-7B** 4-bit (Apache-2.0), **Marqo-FashionSigLIP** (Apache-2.0) |
| `fit_advisor` | size/fit recommendation for a customer question | Qwen2.5-VL text |
| `styling_advisor` | how-to-style advice (advice, not upsell) | Qwen2.5-VL text |
| `virtual_tryon` | **deferred** — needs a commercial-licensed try-on model | — |

All models are commercial-safe and fit one 24 GB GPU (A5000). Peak ≈ 13 GB with
the three ingest models resident; the model manager frees VRAM on demand.

## Deploy
1. Build & push the image (or let RunPod build from this repo):
   `docker build -t <registry>/dressnation-worker:latest . && docker push ...`
2. Create a RunPod Serverless endpoint `digitization-platform` on an RTX A5000,
   attach a **Network Volume mounted at `/runpod-volume`** (caches model weights
   under `/runpod-volume/models`).
3. First request downloads weights to the volume (slow); subsequent cold starts
   are fast.

## Output format (Pattern A — inline bytes)
`ingest_product` returns the generated images as base64 (`cutout_b64`,
`studio_b64`); the backend persists them into its media store. This keeps the
self-hosted object store (SeaweedFS/MinIO) internal — the worker never needs
storage credentials.

To upload to S3/MinIO from the worker instead (Pattern B), add a `boto3` helper
that `put_object`s the PNGs and return `cutout_url`/`studio_url` instead of the
`*_b64` fields; the app's ingest job accepts either.

## Local sanity check
`python test_client.py` (set `RUNPOD_ENDPOINT` + `RUNPOD_API_KEY`) calls all four
tasks against a deployed endpoint.
