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

## Walkthrough — Admin (shop owner)

1. **Add photos.** Drop dress photos into the inbox folder (the one `INBOX_DIR`
   points at, e.g. `~/Downloads/dressnation`).
2. **Scan.** Admin → **Catalogue** → **Scan inbox**. Each new photo is OCR'd
   (size + price badge) and added as a draft.
3. **Review.** Use the filter tabs — **Needs review** shows dresses where OCR
   couldn't read the size or price. Click any photo to open it full-size, read
   the badge, and type the correct size/price → **Save**.
4. **Publish.** Click **Publish (status + shop)** on a dress to post it to your
   WhatsApp Status *and* list it in the online shop. Or hit **Publish all** to
   publish every reviewed draft at once (they post to Status spaced a few
   seconds apart so WhatsApp stays happy). Dresses still needing a size/price
   are skipped and reported.
5. **Sell.** When a dress sells (online, in chat, or in person) it shows as
   **Sold** and drops off the shop automatically. Use **Mark sold** /
   **Back to shop** to do it by hand.
6. **Fulfil orders.** Admin → **Orders** lists paid orders (newest/unpaid
   first) with the customer's name, phone, town and delivery choice, and a
   **thumbnail of each dress** (click to view full-size). For each:
   **Mark packed** → drop the parcel at Pickup Mtaani → enter the **package
   code** and hit **Dropped** (this WhatsApps the buyer their tracking code and
   the 3-day collection reminder) → **Mark collected** when done. **Cancel**
   puts the dresses back on sale. If the same single-piece dress ends up in
   more than one live order, each shows a red **⚠ Conflict** note naming the
   other order(s) and their status, so you can spot a double-paid dress.
7. **Watch interest.** Admin → **Carts** shows what shoppers have added in the
   last 7 days, even before they pay.

## Walkthrough — Buyer

**Option A — the website**
1. Open the shop link (your `APP_BASE_URL` + `/shop`).
2. Browse dresses, tap one for the full photo, size and price.
3. **Add to cart**, open the cart, fill in name, phone, town and a Pickup
   Mtaani delivery option (agent / doorstep / upcountry) + location.
4. **Continue to payment** → **Pay (simulated)**. You get an order page; the
   shop is notified and WhatsApps you a confirmation.
5. Later you receive your Pickup Mtaani package code on WhatsApp to track and
   collect (within 3 days).

**Option B — entirely on WhatsApp**
1. Message the shop's WhatsApp number. On first contact the bot sends an
   emoji menu (🛍️ Shop dresses, 🚚 Delivery, 📦 Track, 📋 Policies, 🙋 Talk to a person).
2. Reply **1** (or "catalogue") — the bot lists available dresses, each as
   `#number — SIZE, price`, plus the shop link.
3. Pick one: reply with its **number** — `#21`, a bare `21`, or "buy 21",
   "nataka 21", "mine 21". (If the bot has shown a single dress, "mine" alone
   claims it.) The dress is **held for you for 3 minutes** so no one else can
   grab it while you order.
4. The bot asks your **town**, **delivery option** (reply 1/2/3), and the
   **pickup point / address**, then creates your order and sends a **pay
   link**. Tap it to pay (simulated) — same as Option A from step 4.
5. Send **"cancel"** any time to stop and release the dress.

> **Reservation hold.** Adding a dress to a cart (web) or claiming one in chat
> holds it for `SHOP_RESERVE_MINUTES` (default 3) — it disappears from
> everyone else's shop and catalogue during the hold, and comes back
> automatically if you don't pay in time. Payment is the final lock: the first
> person to pay gets the dress, and single pieces drop out of the shop the
> instant they sell. Picking low numbers that clash with the menu (0–4) needs
> the `#` form (e.g. `#3`); any higher number works bare (`21`).

> **Why a link for payment?** True in-chat M-Pesa (an STK push you approve
> inside WhatsApp) needs the official WhatsApp Business API plus a live M-Pesa
> integration. This build uses WAHA with simulated payment, so the WhatsApp
> flow collects the order in chat and hands off to the pay page for the final
> step. The conversational ordering, availability check, and delivery capture
> all happen in WhatsApp.

## Not yet wired (future)

- Real M-Pesa / Pickup Mtaani STK push + payment verification (the spec's
  `PUT /payment/pay-delivery-stk` + `verify-payment`); today payment is
  simulated.
- Live delivery-fee lookup from the Pickup Mtaani API (fees are confirmed by
  the shop on WhatsApp for now — never guessed).
