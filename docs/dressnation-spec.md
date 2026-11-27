# DressNation ~254 — Full business spec (internal reference)

> ⚠️ INTERNAL. This file is NOT loaded by the bot (only knowledge/*.md is).
> It preserves the complete spec, including internal-only details the
> assistant must never share:
> - Pickup Mtaani's till 5684653 is for the SHOP paying delivery fees —
>   never given to customers as a way to pay for a dress.
> - Pickup Mtaani API: base https://api.pickupmtaani.com/api/v1, apiKey
>   header (server-side only), sandbox/production keys separate, fee lookup
>   endpoints, STK push PUT /payment/pay-delivery-stk, verify payment,
>   webhooks register. Package states: request → assigned → on-transit →
>   dropped → recieved-warehouse (sic) → assigned-warehouse →
>   warehouse-transit → delivered → collected; return_* and rejected*
>   variants. Never hard-code delivery prices; check payment_status ==
>   "paid" before dispatch; re-fetch package after webhook events.
> - Store configuration still unset: DRESS_PAYMENT_METHOD,
>   PAY_ON_DELIVERY_ENABLED, SHOP_DROP_OFF_AGENT, USUAL_DROP_OFF_TIME,
>   BUSINESS_HOURS, CURRENT_STOCK_SOURCE. Until the payment method is set,
>   the bot says "the shop will confirm payment details" and hands off.
>
> Customer-facing content is distilled into knowledge/business.md,
> knowledge/delivery.md, and knowledge/menu.yaml.

Business: DRESS NATION ~254 — quality mtumba women's dresses via TikTok
(@dressnation, ~20.2K followers). Contact 0725571239. Countrywide delivery
via Pickup Mtaani. No refunds, no exchanges. Usual price Ksh 1,000/dress,
single pieces, each TikTok video shows one dress labelled with size + price.

Pickup Mtaani: agent network (150–190+ agents), Doorstep, Errands (SACCO/
courier for upcountry), Rent-a-shelf (shop-side storage). Rider shifts
10am–3pm and 3pm–7pm; drop before 10am → same day 3pm–7pm; agent drop
10am–4pm → next day 10am–3pm; after 2pm → next day; agent drop after 5pm →
following day 3pm–7pm (2–5pm window ambiguous — give ranges). Collection:
3 days at agent → returned to office (7 days) → final 3 days → disposal.
Damage claims: report at pickup point with photo; needs both M-Pesa
statements + listing screenshot. Offices: Star Mall 3rd flr C1/C2 and
Philadelphia House 3rd flr Wing A (Nairobi), Greenland Plaza 4th flr F404B
(Mombasa). Mon–Fri 8:30–7, Sat 9:30–6, holidays 9:30–4, closed Sun.
Carries clothing/shoes/cosmetics; no electronics, food, money, bulky items.

Assistant rules: confirm availability+size+price before payment; state
no-refund/no-exchange and get agreement before payment; delivery fees only
from Pickup Mtaani; share package code after drop-off; remind 3-day
collection + check parcel at agent; escalate to 0725571239 for lost/
rejected/damage/disputes/angry customers. Never invent prices, sizes,
stock, fees, times or payment numbers.
