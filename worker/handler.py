"""Dress Nation digitization worker — RunPod serverless handler.

Routes on event["input"]["task"]:
  - ingest_product   : cutout + studio images, e-commerce copy, fit profile, embedding
  - fit_advisor      : size/fit recommendation for a customer question
  - styling_advisor  : how-to-style advice (advice, not product upsell)
  - virtual_tryon    : deferred in this build

Images are returned inline as base64 (cutout_b64 / studio_b64); the backend
persists them. (To upload to S3/MinIO instead, add a boto3 helper and return
URLs — see README.)
"""
import base64
import io
import json
import re
import time
import traceback

import requests
import runpod
import torch
from PIL import Image, ImageDraw, ImageFont
from torchvision import transforms

from model_manager import DEVICE, MANAGER

# ---------- helpers ----------

def download_image(url: str) -> Image.Image:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")


def pil_to_b64(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode()


BRAND = "DRESS NATION ~254"
_IVORY, _OLIVE, _INK = (247, 243, 235), (92, 101, 52), (43, 39, 36)


def _font(size: int, bold: bool = False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    for p in (f"/usr/share/fonts/truetype/dejavu/{name}",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _center(draw, text, font, y, w, fill):
    tw = draw.textlength(text, font=font)
    draw.text(((w - tw) / 2, y), text, font=font, fill=fill)


def product_card(cutout: Image.Image, colour: str, sizes: str, fabric: str) -> Image.Image:
    """A ready-to-post branded card: shop name on top, the dress centred, and the
    confirmed Colour / Size / Fabric captioned below — baked into the file."""
    W, H = 1080, 1350
    card = Image.new("RGB", (W, H), _IVORY)
    draw = ImageDraw.Draw(card)
    _center(draw, BRAND, _font(46, bold=True), 64, W, _OLIVE)
    top, bottom_reserve, pad = 170, 210, 90
    area_w, area_h = W - 2 * pad, H - top - bottom_reserve
    dress = cutout.convert("RGBA").copy()
    dress.thumbnail((area_w, area_h))
    dx = (W - dress.width) // 2
    dy = top + (area_h - dress.height) // 2
    card.paste(dress, (dx, dy), dress)
    parts = []
    if colour.strip():
        parts.append(colour.strip().title())
    if sizes.strip() and sizes.strip().lower() != "unspecified":
        parts.append(sizes.strip())
    if fabric.strip():
        parts.append(fabric.strip().title())
    if parts:
        _center(draw, "  ·  ".join(parts), _font(42), H - 150, W, _INK)
    return card


def parse_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return {}
    blob = match.group(0)
    try:
        return json.loads(blob)
    except Exception:
        try:
            return json.loads(re.sub(r",\s*([}\]])", r"\1", blob))  # drop trailing commas
        except Exception:
            return {}


# ---------- BiRefNet cutout ----------
_BIREFNET_TF = transforms.Compose(
    [
        transforms.Resize((1024, 1024)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)


def run_birefnet(img: Image.Image) -> tuple[Image.Image, Image.Image]:
    model = MANAGER.get("birefnet")["model"]
    # BiRefNet's checkpoint may be fp16; match the input tensor to the model dtype.
    dtype = next(model.parameters()).dtype
    x = _BIREFNET_TF(img).unsqueeze(0).to(DEVICE).to(dtype)
    with torch.no_grad():
        pred = model(x)[-1].sigmoid().cpu().float()[0].squeeze()
    mask = transforms.ToPILImage()(pred).resize(img.size)
    cutout = img.convert("RGBA")
    cutout.putalpha(mask)
    studio = Image.new("RGB", img.size, (255, 255, 255))
    studio.paste(cutout, mask=mask)
    return cutout, studio


# ---------- Qwen2.5-VL (vision + text) ----------

def run_qwen(system: str, user: str, img: Image.Image | None = None, max_new_tokens: int = 768) -> str:
    bundle = MANAGER.get("qwen")
    model, processor = bundle["model"], bundle["processor"]
    content: list[dict] = []
    if img is not None:
        content.append({"type": "image", "image": img})
    content.append({"type": "text", "text": user})
    messages = [{"role": "system", "content": system}, {"role": "user", "content": content}]

    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    from qwen_vl_utils import process_vision_info

    image_inputs, video_inputs = process_vision_info(messages)
    inputs = processor(
        text=[text], images=image_inputs, videos=video_inputs, padding=True, return_tensors="pt"
    ).to(model.device)
    with torch.no_grad():
        generated = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    trimmed = [out[len(inp):] for inp, out in zip(inputs.input_ids, generated)]
    return processor.batch_decode(trimmed, skip_special_tokens=True)[0].strip()


# ---------- FashionSigLIP embedding ----------

def run_siglip(img: Image.Image) -> list[float]:
    bundle = MANAGER.get("siglip")
    model, preprocess = bundle["model"], bundle["preprocess"]
    x = preprocess(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        feats = model.encode_image(x)
    feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats[0].cpu().float().tolist()


# ---------- tasks ----------

def ingest_product(inp: dict) -> dict:
    t0 = time.time()
    # Admin can enrich just the images, just the text, or both — skip the other
    # half to save GPU. Defaults keep older callers getting everything.
    want_images = inp.get("want_images", True)
    want_text = inp.get("want_text", True)
    img = download_image(inp["image_url"])
    sizes = ", ".join(inp.get("available_sizes") or []) or "unspecified"
    result: dict = {}

    meta: dict = {}
    if want_text:
        # Shop-confirmed facts the model must respect exactly (colour / size /
        # fabric are locked by the admin — never re-guess or contradict them).
        locked = []
        if (inp.get("colour") or "").strip():
            locked.append(f'colour is "{inp["colour"].strip()}"')
        if (inp.get("fabric") or "").strip():
            locked.append(f'fabric is "{inp["fabric"].strip()}"')
        if sizes != "unspecified":
            locked.append(f"available sizes are {sizes}")
        facts = (
            "The shop has CONFIRMED the following and they are AUTHORITATIVE — use them "
            "exactly in every field and do NOT describe a different colour, pattern, "
            "fabric, material or size: " + "; ".join(locked) + ".\n"
            if locked else ""
        )
        system = (
            "You are a senior fashion e-commerce merchandiser and copywriter for a "
            "Kenyan women's boutique. You write warm, honest, persuasive catalogue copy. "
            "When the shop confirms a colour, fabric or size, you treat it as ground "
            "truth and never contradict it, even if the photo looks different."
        )
        user = (
            f"Analyse this {inp.get('category', 'dress')} photo. "
            f"Price: {inp.get('price', 'unknown')}. Available sizes: {sizes}.\n"
            + facts +
            "Respond with ONLY a JSON object, no prose, with exactly these keys "
            "(echo the confirmed colour/fabric above when provided):\n"
            "{\n"
            '  "title": "catchy e-commerce product title",\n'
            '  "whatsapp_description": "clean persuasive bulleted copy for WhatsApp Business '
            "(include price, sizes, neckline, sleeve style, length)\",\n"
            '  "social_caption": "engaging Instagram/TikTok caption with styling tips and hashtags",\n'
            '  "occasions": ["3-5 occasions"],\n'
            '  "colour": "main colour(s)",\n'
            '  "length": "e.g. Midi, below the knee",\n'
            '  "fit_profile": { "estimated_fabric": "", "stretch_level": "none|low|medium|high", '
            '"silhouette": "bodycon|a-line|flowy|structured", "fit_notes": "" }\n'
            "}"
        )
        meta = parse_json(run_qwen(system, user, img))
        result.update({
            "title": meta.get("title"),
            "whatsapp_description": meta.get("whatsapp_description"),
            "social_caption": meta.get("social_caption"),
            "occasions": meta.get("occasions"),
            "colour": meta.get("colour"),
            "length": meta.get("length"),
            "fit_profile": meta.get("fit_profile", {}),
        })

    if want_images:
        cutout, studio = run_birefnet(img)
        # Ready-to-post card with the confirmed colour/size/fabric baked in; falls
        # back to the model's colour when the shop hasn't set one yet.
        card = product_card(
            cutout,
            (inp.get("colour") or meta.get("colour") or "").strip(),
            sizes,
            (inp.get("fabric") or (meta.get("fit_profile") or {}).get("estimated_fabric") or "").strip(),
        )
        result["cutout_b64"] = pil_to_b64(cutout, "PNG")
        result["studio_b64"] = pil_to_b64(studio, "PNG")
        result["card_b64"] = pil_to_b64(card, "PNG")
        result["embedding"] = run_siglip(img)

    result["exec_ms"] = int((time.time() - t0) * 1000)
    return result


def fit_advisor(inp: dict) -> dict:
    t0 = time.time()
    system = (
        "You are a warm, honest boutique stylist helping a customer pick the right "
        "size. Be concise and friendly, ready to send on WhatsApp. Never oversell — "
        "if a dress may not fit, say so kindly."
    )
    user = (
        f"Customer says: {inp.get('customer_message', '')}\n"
        f"Product: {inp.get('product_title', '')}\n"
        f"Available sizes: {inp.get('available_sizes', [])}\n"
        f"Size chart: {json.dumps(inp.get('size_chart') or {})}\n"
        f"Fit profile: {json.dumps(inp.get('fit_profile') or {})}\n"
        "Respond with ONLY JSON: "
        '{"recommended_size": "", "confidence": "high|medium|low", "stylist_reply": ""}'
    )
    meta = parse_json(run_qwen(system, user))
    meta["exec_ms"] = int((time.time() - t0) * 1000)
    return meta


def styling_advisor(inp: dict) -> dict:
    t0 = time.time()
    system = (
        "You are a boutique stylist giving friendly advice on how to wear and "
        "complete a look (shoes, jewellery, bag, layering). Give genuine styling "
        "guidance — do NOT push the customer to buy more items."
    )
    user = (
        f"Dress: {inp.get('product_title', '')}\n"
        f"Colour: {inp.get('colour', '')}\n"
        f"Occasions: {inp.get('occasions', [])}\n"
        f"Fit profile: {json.dumps(inp.get('fit_profile') or {})}\n"
        f"Occasion of interest: {inp.get('occasion', 'any')}\n"
        "Respond with ONLY JSON: "
        '{"styling_tips": ["..."], "by_occasion": {"Office": "...", "Evening": "..."}}'
    )
    meta = parse_json(run_qwen(system, user))
    meta["exec_ms"] = int((time.time() - t0) * 1000)
    return meta


def handler(event: dict) -> dict:
    inp = event.get("input") or {}
    task = inp.get("task")
    try:
        if task == "ingest_product":
            return ingest_product(inp)
        if task == "fit_advisor":
            return fit_advisor(inp)
        if task == "styling_advisor":
            return styling_advisor(inp)
        if task == "virtual_tryon":
            return {"error": "virtual_tryon is not enabled in this worker build"}
        return {"error": f"unknown task: {task!r}"}
    except Exception as exc:  # surface a clean error to the caller
        return {"error": str(exc), "trace": traceback.format_exc()[-1500:]}


runpod.serverless.start({"handler": handler})
