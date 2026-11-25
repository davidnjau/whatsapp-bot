// Customer-facing brand strings for the storefront. DressNation defaults, each
// overridable by an env var, so the shop's wording is fully configurable.
const env = process.env

export const brand = {
  name: env.SHOP_NAME ?? 'DRESS NATION',
  suffix: env.SHOP_SUFFIX ?? '~254',
  tagline: env.SHOP_TAGLINE ?? 'Quality mtumba dresses, picked one by one for the Kenyan woman.',
  announcement: env.SHOP_ANNOUNCEMENT ?? 'Countrywide delivery across Kenya · New drops every week',
  heroEyebrow: env.SHOP_HERO_EYEBROW ?? 'The fitting room · Quality mtumba dresses',
  heroLead: env.SHOP_HERO_LEAD ?? 'Boutique looks,',
  heroAccent: env.SHOP_HERO_ACCENT ?? 'thrift prices.',
  manifesto:
    env.SHOP_MANIFESTO ??
    'Every dress is picked by hand, one by one, for work, church, weddings and weekends.',
  manifestoAccent:
    env.SHOP_MANIFESTO_ACCENT ?? "There is only one of each, so when it's gone, it's gone.",
  whatsapp: (env.SHOP_WHATSAPP ?? '254725571239').replace(/[^\d]/g, ''),
  phoneDisplay: env.SHOP_PHONE_DISPLAY ?? '0725 571 239',
  tiktok: env.SHOP_TIKTOK ?? '@dressnation',
  tiktokUrl: env.SHOP_TIKTOK_URL ?? 'https://www.tiktok.com/@dressnation',
  deliveryNote:
    env.SHOP_DELIVERY_NOTE ??
    'We deliver countrywide via Pickup Mtaani. Nairobi CBD pick-up on request.',
  policyNote:
    env.SHOP_POLICY_NOTE ??
    'No refunds. No exchanges. Check your size and ask us for measurements before you pay.',
  stats: [
    { n: env.SHOP_STAT1_N ?? '20K+', l: env.SHOP_STAT1_L ?? 'Followers on TikTok' },
    { n: env.SHOP_STAT2_N ?? '8–16', l: env.SHOP_STAT2_L ?? 'Sizes in every drop' },
    { n: env.SHOP_STAT3_N ?? '1,000', l: env.SHOP_STAT3_L ?? 'Shillings for most pieces' },
  ],
}

export type Brand = typeof brand
