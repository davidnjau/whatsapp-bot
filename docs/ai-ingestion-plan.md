# AI Ingestion & Styling Worker — design & integration plan

Status: **approved plan, not yet built.** This document is the contract/spec the
app side and the RunPod worker are built against. Decisions below reflect the
owner's constraints: **no new per-token API bills**, self-hosted storage, and
commercial-safe models that fit a single 24 GB GPU.

## 0. Guiding decisions

- **All AI runs on the GPU worker we already rent — no Claude/OpenAI key.** The
  text tasks (copywriting, fit advice, styling advice) reuse the worker's
  Qwen2.5-VL backbone, so the only variable cost stays RunPod GPU-seconds.
- **Storage is self-hosted MinIO** added to our Docker stack (S3-compatible). No
  Cloudflare/AWS bill. See §4.
- **Virtual try-on (Task 2) is deferred** — revisit model + licensing later.
- **Task 4 is a styling advisor, not an upsell** — it advises the customer how to
  complete/wear the look; it does not push more products. No accessories
  inventory needed.

## 1. Models — final picks (license + VRAM on RTX A5000 24 GB)

| Task | Model | License | VRAM | Notes |
|---|---|---|---|---|
| 1A Cutout | **BiRefNet** (`ZhengPeng7/BiRefNet`) | MIT ✅ | ~3–4 GB fp16 | Chosen over RMBG-2.0 (non-commercial). SOTA product cutouts → transparent + studio-white |
| 1B Copy + fit profile (VLM) | **Qwen2.5-VL-7B-Instruct**, 4-bit | Apache-2.0 ✅ | ~7 GB | Doubles as the text backbone for Tasks 3 & 4. (3B Apache variant if we want lighter/faster) |
| 1C Embedding | **Marqo/marqo-fashionSigLIP** | Apache-2.0 ✅ | ~2 GB | 512-d normalized vector. Consumer shifts to *similar-items / search* (see §7); not needed for the reframed Task 4 |
| 2 Virtual try-on | — | — | — | **Deferred.** Needs a commercial-licensed, 24 GB-fitting model (IDM-VTON/CatVTON are non-commercial) |
| 3 Fit advisor | reuse **Qwen2.5-VL** text backbone | Apache-2.0 ✅ | shared | Cross-references customer message vs. `fit_profile` |
| 4 Styling advisor | reuse **Qwen2.5-VL** text backbone | Apache-2.0 ✅ | shared | "How to style/complete this look." Advice, not product recommendations |

All chosen models are commercial-safe (MIT/Apache). Weights cache on
`/runpod-volume/models` so workers skip cold-start downloads.

### VRAM manager
One heavy model resident at a time; swap with `torch.cuda.empty_cache()` +
`gc.collect()`:
- Qwen2.5-VL-7B (4-bit) ~7 GB stays warm for all text work.
- BiRefNet ~4 GB loaded only during cutout, then freed.
- FashionSigLIP ~2 GB tiny, load for embedding.

Peak stays well under 24 GB. Try-on (later) loads only on demand.

## 2. Scope by task

- **Task 1 `ingest_product`** — the gap-closer. One uploaded photo →
  transparent cutout + studio-white image, e-commerce copy, WhatsApp/social
  captions, occasions, colour, length, fit profile, and an embedding. Fills the
  catalogue fields and gallery that real OCR uploads currently lack.
- **Task 3 `fit_advisor`** — "will it fit me?" text answer. Serves the shop
  ("Will it fit me?" widget) and the WhatsApp support bot.
- **Task 4 `styling_advisor`** (reframed) — styling guidance to complete the look
  (shoes/jewellery/bag/layering) per occasion, honest boutique-stylist tone. No
  inventory, no upsell.
- **Task 2 `virtual_tryon`** — deferred.

## 3. Integration architecture

```
Admin uploads photo ─► product row (draft) + original image stored (MinIO, §4)
      │
      └─► pg-boss job "ingest_product"
             │  POST RunPod /run  { image_url = our public /shop/media/:id, product_id,
             │                      price, available_sizes, category }
             │  poll /status until done
             ▼
      Worker returns { cutout (bytes/url), studio (bytes/url), title,
                       whatsapp_description, social_caption, occasions,
                       colour, length, fit_profile, embedding, exec_ms }
             │
      App job: persist cutout+studio into media_library/product_media;
               write fields to products; store embedding; needs_review = true
             ▼
      Owner opens /admin → reviews the auto-filled dress → Publish
```

Reuses existing infrastructure:
- **Input needs no upload:** our media is already public, so `/shop/media/:id`
  *is* the worker's `image_url`.
- **No Redis / new queue:** reuse **pg-boss**.
- **Gallery/serving unchanged:** generated images land in `media_library` /
  `product_media`; `/shop/media/:id` and the shop SPA keep working.
- **The gap closes by *review*, not authoring** — the owner approves, not types.
- **Status caption synergy:** `whatsapp_description` can replace the hand-built
  WhatsApp Status caption at publish time.

## 4. Storage — self-hosted MinIO

Add a `minio` service to `docker-compose.yml` (+ prod override), on the internal
Docker network only, same as Postgres/WAHA (never publicly exposed). The app
talks to it over the S3 API (`boto3`/AWS SDK) using internal credentials.

MinIO becomes the durable object store for all media (originals, cutouts,
studio, future try-on results), replacing/augmenting the local `MEDIA_DIR`.
`/shop/media/:id` fetches from MinIO; nothing in the public contract changes.

**Worker ↔ storage pattern (pick at build time):**
- **Pattern A (recommended): worker returns image bytes inline** (base64) in the
  JSON response; the app writes them to MinIO. Keeps MinIO fully internal — no
  public storage surface, no cross-internet storage credentials. Payloads are a
  few hundred KB per image — fine.
- **Pattern B: expose a locked-down MinIO S3 endpoint via Caddy** (e.g.
  `s3.dressnation.legacyhomes.live`) so the worker `boto3`-uploads directly and
  returns URLs. Matches the proposal's original S3 design but adds a public
  surface to secure (scoped keys, bucket policy).

Default to **Pattern A** unless output sizes grow (e.g. try-on batches).

## 5. JSON contracts

### Task 1 — `ingest_product`
Request (`POST /run`):
```json
{ "input": { "task": "ingest_product",
  "image_url": "https://dressnation.legacyhomes.live/shop/media/65",
  "product_id": 30, "price": "Ksh 1,000",
  "available_sizes": ["16"], "category": "dress" } }
```
Response:
```json
{ "cutout_b64": "...", "studio_b64": "...",
  "title": "...", "whatsapp_description": "...", "social_caption": "...",
  "occasions": ["Church","Office","Dinner"],
  "colour": "Red and black", "length": "Midi, mid-calf",
  "fit_profile": { "estimated_fabric": "Cotton knit", "stretch_level": "low",
                   "silhouette": "bodycon", "fit_notes": "..." },
  "embedding": [512 floats], "exec_ms": 1234 }
```
> Contract additions vs. the original proposal: VLM also returns **`colour`** and
> **`length`** (fills our schema from one call); images returned as base64
> (Pattern A). For Pattern B, replace `*_b64` with `cutout_url`/`studio_url`.

### Task 3 — `fit_advisor`
Request: `{ task, customer_message, product_title, available_sizes, size_chart?, fit_profile }`
Response: `{ recommended_size, confidence: "high|medium|low", stylist_reply }`

### Task 4 — `styling_advisor` (reframed)
Request: `{ task, product_title, colour, occasions, fit_profile, occasion? }`
Response: `{ styling_tips: ["..."], by_occasion?: { "Office": "...", "Evening": "..." } }`
No inventory, no embeddings, no product recommendations — advice only.

## 6. Schema changes (migration 012)

Add to `products`: `silhouette`, `stretch_level`, `fit_notes`, `social_caption`,
`occasions` (jsonb), `embedding` (jsonb float[] for now), `ai_ingested_at`.
The Phase-1 columns (`fabric`, `colour`, `length_desc`, `short_desc`,
`long_desc`) and `product_media` already exist and receive the rest.

Embeddings stored as jsonb float[] initially (similarity computed in-app for our
small catalogue). Move to **pgvector** when the catalogue/search grows — our
Postgres image isn't pgvector-enabled yet.

## 7. Embeddings — where they're used now

With Task 4 reframed to advice, embeddings are no longer for purchase bundling.
Keep generating them (the model is tiny) for future **similar-items / visual
search / duplicate detection**. This is optional and can be dropped from the
first worker build if we want to trim scope.

## 8. Build order

- **A — Ingest integration (app side):** migration 012 + pg-boss `ingest_product`
  job + MinIO storage layer + "review auto-filled dress" admin screen, built
  against §5. The gap-closer; testable the moment the worker exists.
- **B — Worker repo (Task 1):** BiRefNet + Qwen2.5-VL-7B-4bit + FashionSigLIP +
  model manager + MinIO/return-bytes output, deployable to the
  `digitization-platform` endpoint. Deliverables: `Dockerfile`,
  `requirements.txt`, `model_manager.py`, `handler.py`, `test_client.py`.
- **C — fit_advisor (Task 3):** reuse the warm Qwen backbone; shop widget + bot.
- **D — styling_advisor (Task 4):** same backbone; shop + bot.
- **E — virtual_tryon (Task 2):** after a commercial-safe model is chosen.

## 9. Open items

1. **MinIO internal vs. exposed** — default Pattern A (worker returns bytes);
   revisit if payloads grow.
2. **Try-on licensing/model** — deferred (Task 2).
3. **RunPod endpoint + secrets** — endpoint id, API key, and network-volume path
   provided as env vars to the app's ingest job.
