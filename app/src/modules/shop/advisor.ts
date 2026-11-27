import { productName } from './label.js'
import { callWorker, ingestConfigured } from './runpod.js'
import type { Product } from './index.js'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function fitProfile(p: Product) {
  return {
    estimated_fabric: p.fabric ?? '',
    stretch_level: p.stretch_level ?? '',
    silhouette: p.silhouette ?? '',
    fit_notes: p.fit_notes ?? '',
  }
}

export interface FitAdvice {
  recommended_size: string
  confidence: string
  stylist_reply: string
}

// "Will it fit me?" — returns null if the worker isn't configured or fails, so
// callers degrade gracefully (shop shows a WhatsApp fallback; bot falls through).
export async function fitAdvice(product: Product, message: string): Promise<FitAdvice | null> {
  if (!ingestConfigured()) return null
  const out = await callWorker(
    {
      task: 'fit_advisor',
      customer_message: message,
      product_title: productName(product),
      available_sizes: (product.size ?? '').split('/').map((s) => s.trim()).filter(Boolean),
      fit_profile: fitProfile(product),
    },
    60_000,
  ).catch(() => null)
  if (!out || !str(out.stylist_reply)) return null
  return {
    recommended_size: str(out.recommended_size),
    confidence: str(out.confidence),
    stylist_reply: str(out.stylist_reply),
  }
}

export interface StylingAdvice {
  styling_tips: string[]
  by_occasion: Record<string, string>
}

// "How to style it" — advice on completing the look (not an upsell).
export async function stylingAdvice(product: Product): Promise<StylingAdvice | null> {
  if (!ingestConfigured()) return null
  const out = await callWorker(
    {
      task: 'styling_advisor',
      product_title: productName(product),
      colour: product.colour ?? '',
      occasions: product.occasions ?? [],
      fit_profile: fitProfile(product),
    },
    60_000,
  ).catch(() => null)
  if (!out) return null
  const tips = Array.isArray(out.styling_tips) ? (out.styling_tips as unknown[]).map(String) : []
  const by =
    out.by_occasion && typeof out.by_occasion === 'object'
      ? (out.by_occasion as Record<string, string>)
      : {}
  if (!tips.length && !Object.keys(by).length) return null
  return { styling_tips: tips, by_occasion: by }
}
