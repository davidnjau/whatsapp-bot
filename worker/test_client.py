"""Sample client for the Dress Nation digitization worker.

Usage:
  export RUNPOD_ENDPOINT=https://api.runpod.ai/v2/<endpoint-id>
  export RUNPOD_API_KEY=...
  python test_client.py
"""
import json
import os

import requests

ENDPOINT = os.environ["RUNPOD_ENDPOINT"].rstrip("/")
API_KEY = os.environ["RUNPOD_API_KEY"]
HEADERS = {"authorization": f"Bearer {API_KEY}", "content-type": "application/json"}


def run_sync(payload: dict) -> dict:
    """Blocking call; use /run (returns a job id) for long async jobs."""
    resp = requests.post(f"{ENDPOINT}/runsync", headers=HEADERS, json={"input": payload}, timeout=600)
    resp.raise_for_status()
    return resp.json().get("output", resp.json())


def preview(label: str, out: dict) -> None:
    # Trim base64 blobs so the console stays readable.
    slim = {k: (f"<{len(v)} b64 chars>" if isinstance(v, str) and k.endswith("_b64") else v) for k, v in out.items()}
    if isinstance(slim.get("embedding"), list):
        slim["embedding"] = f"<{len(slim['embedding'])}-d vector>"
    print(f"\n=== {label} ===")
    print(json.dumps(slim, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    preview(
        "Task 1 — ingest_product",
        run_sync(
            {
                "task": "ingest_product",
                "image_url": "https://dressnation.legacyhomes.live/shop/media/65",
                "product_id": 30,
                "price": "Ksh 1,000",
                "available_sizes": ["16"],
                "category": "dress",
            }
        ),
    )
    preview(
        "Task 3 — fit_advisor",
        run_sync(
            {
                "task": "fit_advisor",
                "customer_message": "I'm 5'5, curvy hips, usually wear UK 10 — will this fit?",
                "product_title": "Lilac puff-sleeve midi",
                "available_sizes": ["8", "10"],
                "fit_profile": {"silhouette": "bodycon", "stretch_level": "low"},
            }
        ),
    )
    preview(
        "Task 4 — styling_advisor",
        run_sync(
            {
                "task": "styling_advisor",
                "product_title": "Navy & mustard peplum",
                "colour": "Navy and mustard",
                "occasions": ["Corporate Office", "Church", "Dinner Date"],
                "fit_profile": {"silhouette": "structured"},
            }
        ),
    )
    preview("Task 2 — virtual_tryon (deferred)", run_sync({"task": "virtual_tryon"}))
