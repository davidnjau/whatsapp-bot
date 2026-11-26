import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { saveMedia } from '../status/media.js'
import { getProduct } from './index.js'
import { callWorker, ingestConfigured } from './runpod.js'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// Run the AI digitization worker on one product: generate cutout/studio images
// and copy/fit metadata, attach them, and flag the product for owner review.
export async function runIngest(productId: number): Promise<void> {
  const product = await getProduct(productId)
  if (!product) {
    log.warn({ productId }, 'ingest: product no longer exists')
    return
  }
  if (!ingestConfigured()) {
    log.warn({ productId }, 'ingest: RunPod worker not configured — skipping')
    return
  }

  const imageUrl = `${config.appBaseUrl}/shop/media/${product.media_id}`
  const sizes = (product.size ?? '').split('/').map((s) => s.trim()).filter(Boolean)
  const output = await callWorker({
    task: 'ingest_product',
    image_url: imageUrl,
    product_id: product.id,
    price: product.price_ksh ? `Ksh ${product.price_ksh.toLocaleString('en-KE')}` : '',
    available_sizes: sizes,
    // Locked facts — the worker grounds its copy on these and must not change
    // colour/size/fabric (see the UPDATE below, which never overwrites them).
    colour: product.colour ?? '',
    fabric: product.fabric ?? '',
    category: config.ingestCategory,
  })

  // Attach the generated gallery images (base64 in the response).
  let pos = 100
  for (const [field, kind] of [
    ['card_b64', 'poster'],
    ['cutout_b64', 'cutout'],
    ['studio_b64', 'studio'],
  ] as const) {
    const b64 = str(output[field])
    if (!b64) continue
    const media = await saveMedia(`p${product.id}-${kind}.png`, 'image/png', Buffer.from(b64, 'base64'))
    await query(
      'INSERT INTO product_media (product_id, media_id, kind, position) VALUES ($1, $2, $3, $4)',
      [product.id, media.id, kind, pos++],
    )
  }

  const fp = (output.fit_profile ?? {}) as Record<string, unknown>
  await query(
    `UPDATE products SET
       title = COALESCE(NULLIF($2, ''), title),
       -- colour, size and fabric are locked: keep any value already set,
       -- only fill from AI when the admin left them blank. size is never touched.
       fabric = COALESCE(NULLIF(fabric, ''), $3),
       colour = COALESCE(NULLIF(colour, ''), $4),
       length_desc = $5,
       short_desc = $6, long_desc = $7, social_caption = $8,
       occasions = $9::jsonb, silhouette = $10, stretch_level = $11, fit_notes = $12,
       embedding = $13::jsonb, ai_ingested_at = now(), needs_review = true
     WHERE id = $1`,
    [
      product.id,
      str(output.title) ?? '',
      str(fp.estimated_fabric),
      str(output.colour),
      str(output.length),
      str(output.whatsapp_description),
      str(fp.fit_notes),
      str(output.social_caption),
      output.occasions ? JSON.stringify(output.occasions) : null,
      str(fp.silhouette),
      str(fp.stretch_level),
      str(fp.fit_notes),
      output.embedding ? JSON.stringify(output.embedding) : null,
    ],
  )
  log.info({ productId }, 'ingest complete — product flagged for review')
}
