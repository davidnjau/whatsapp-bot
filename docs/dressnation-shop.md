# DressNation shop (OCR catalogue + e-commerce)

An add-on to the WhatsApp bot for Dress Nation ~254: turn dropped product
photos into a browsable shop with cart, simulated payment, and an orders
dashboard, and auto-post each dress to WhatsApp Status.

## The flow

```
photo in inbox ──scan──▶ OCR (tesseract → Claude Vision) ──▶ product (draft, needs review)
      │                                                           │
      │                                              admin reviews size + price
      │                                                           ▼
      └───────────────────────────────── Publish ──▶ WhatsApp Status posted
                                                     + listed in /shop
                                                           │
   customer browses /shop ─▶ add to cart ─▶ checkout (name/phone/delivery) ─▶ simulated M-Pesa pay
                                                           │
                               dress marked SOLD (atomic, single piece) · order = paid
                               · customer gets WhatsApp confirmation · owner gets order alert
                                                           │
                        owner: Admin → Orders ─▶ Mark packed ─▶ enter Pickup Mtaani package
                        code (Dropped) ─▶ customer auto-messaged tracking + 3-day reminder
```

## Setup

1. Point `INBOX_DIR` in `.env` at the folder where photos land, e.g.
   `INBOX_DIR=/Users/davidmainanjau/Downloads/dressnation`. (Inside the
   container the app always reads `/app/inbox` — compose maps the host folder
   there; don't change that.)
2. For reliable OCR on the stylized price/size badges, set `ANTHROPIC_API_KEY`
   in `.env`. Without it, only local tesseract runs — it reads the clean
   badges but flags many for manual review. With it, Claude Vision fills the
   gaps (this mirrors the tiered OCR in the AutomatedScripts assign flow).
3. `docker compose up -d --build`.

## Daily use (owner)

- **Admin → Catalogue → Scan inbox** — imports new photos, runs OCR, extracts
  size + price. Correct anything flagged "needs review", then **Publish**
  (posts the WhatsApp Status *and* lists it in the shop). "Mark sold" /
  "Back to shop" / "Archive" manage availability.
- **Admin → Carts** — what shoppers have added in the last 7 days.
- **Admin → Orders** — paid orders with delivery details. **Mark packed**,
  then **Dropped at Pickup Mtaani** with the package code (auto-WhatsApps the
  customer their tracking code + 3-day collection reminder), then **Mark
  collected**. **Cancel** returns the dresses to the shop.

## Customer side

Public `/shop` (no login): grid of available dresses, product pages, cookie
cart, checkout (name, phone, town, Pickup Mtaani option + location), and a
**simulated** M-Pesa payment ("Pay now" marks it paid — no real money moves
yet; swap in the Pickup Mtaani STK push later). Each dress is a single piece,
so a sold dress disappears instantly and a race on the last piece fails the
second payer cleanly.

## Not yet wired (future)

- Real M-Pesa / Pickup Mtaani STK push + payment verification (the spec's
  `PUT /payment/pay-delivery-stk` + `verify-payment`); today payment is
  simulated.
- Live delivery-fee lookup from the Pickup Mtaani API (fees are confirmed by
  the shop on WhatsApp for now — never guessed).
