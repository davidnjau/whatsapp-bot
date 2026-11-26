# Promotional banner campaigns

Scheduled banners that show over the shop (`/` and `/shop`) between a start and
end time. Admin only — **Admin → Campaigns**.

## Create a campaign
1. **Admin → Campaigns → + New campaign**.
2. Pick **Text banner** (headline + subtext + button) or **Photo only** (the
   photo fills the banner; only the photo, dates and an optional link matter).
3. Set **Start** and **End** (entered and shown in Nairobi time, stored as UTC).
   Saving is blocked if the end is before the start; an overlap with another
   active campaign is warned (the later-starting one shows).
4. Optional: background/text colours, **Show countdown**, **WhatsApp share
   message**, **Active** toggle.
5. **Create campaign**, then add its photo (see below).

## Status
Worked out from the dates: **Draft** (turned off), **Scheduled** (future),
**Live** (now), **Ended** (past). Ended campaigns are never deleted — reuse a
sale like Christmas every year.

## Photos
- On a saved campaign, **Change photo** uploads a **desktop** (required) and
  optional **mobile** photo. JPG / PNG / WebP, up to 5 MB. Recommended:
  desktop **1600×900**, mobile **800×1000** (a smaller upload is warned, not
  blocked). A preview shows immediately.
- Changing the photo — even on a **live** campaign — leaves the text, dates and
  settings untouched; customers see the new photo on their next page load.
- **Previous photos** are kept per campaign; click **Use this** to switch back.

## Reuse / duplicate
- **Duplicate** copies everything into a new draft to edit.
- **Reuse** (the two date boxes + "Copy with dates") copies a past campaign and
  only asks for new start/end dates.

## Preview
**Preview** opens the banner exactly as customers see it, at desktop and phone
widths, before it goes live.

## Customer side
- `GET /api/campaign/live` returns the one live campaign (the server checks the
  dates, so future campaigns never leak early).
- The banner shows once per visitor per campaign (dismissal remembered in
  `localStorage`); a new campaign shows again. X / Escape / tapping the dim area
  closes it. Optional live countdown hides the banner when time runs out.

## WhatsApp sharing
- **Share** opens `navigator.share` (phones) or `https://wa.me/?text=…` with the
  campaign message + a link `https://dressnation.legacyhomes.live/?promo=<id>`.
- Opening that link re-shows the banner (even if previously closed) while the
  campaign is still live, and Open Graph tags (title/description/image) give
  WhatsApp a preview using the campaign photo.

## Note
Server-side image resizing (to 1600/800) is not yet applied — uploads are served
as-is (each gets a unique media URL, so caches never show an old photo). This is
a planned enhancement.
