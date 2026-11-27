import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { saveMedia } from '../status/media.js'
import { getProduct } from './index.js'
import { callWorker, ingestConfigured } from './runpod.js'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// What the admin chose to (re)generate: the gallery images, the copy/metadata, or both.
export type IngestMode = 'both' | 'images' | 'text'

// Run the AI digitization worker on one product. `mode` lets the admin enrich
// just the images (cutout/studio/card), just the text (copy + colour/length/fit),
// or both — the worker skips the other half to save GPU.
export async function runIngest(productId: number, mode: IngestMode = 'both'): Promise<void> {
  const product = await getProduct(productId)
  if (!product) {
    log.warn({ productId }, 'ingest: product no longer exists')
    return
  }
  if (!ingestConfigured()) {
    log.warn({ productId }, 'ingest: RunPod worker not configured — skipping')
    return
  }
  const wantImages = mode !== 'text'
  const wantText = mode !== 'images'

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
    want_images: wantImages,
    want_text: wantText,
    category: config.ingestCategory,
  })

  if (wantImages) {
    // Replace any prior AI-generated gallery images so re-running enrichment
    // doesn't pile up duplicate cutout/studio/poster sets (keeps real photos).
    await query(`DELETE FROM product_media WHERE product_id = $1 AND kind IN ('cutout', 'studio', 'poster')`, [
      product.id,
    ])
    let pos = 100
    for (const [field, kind] of [
      ['card_b64', 'poster'],
      ['cutout_b64', 'cutout'],
      ['studio_b64', 'studio'],
    ] as const) {
      const b64 = str(output[field])
      if (!b64) continue
      const media = await saveMedia(`p${product.id}-${kind}.png`, 'image/png', Buffer.from(b64, 'base64'))
      await query('INSERT INTO product_media (product_id, media_id, kind, position) VALUES ($1, $2, $3, $4)', [
        product.id,
        media.id,
        kind,
        pos++,
      ])
    }
  }

  const embedding = output.embedding ? JSON.stringify(output.embedding) : null
  if (wantText) {
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
         embedding = COALESCE($13::jsonb, embedding),
         ai_ingested_at = now(), ai_enqueued_at = NULL, needs_review = true
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
        embedding,
      ],
    )
  } else {
    // Images-only: just keep any new embedding and mark the run complete.
    await query(
      `UPDATE products SET embedding = COALESCE($2::jsonb, embedding),
         ai_ingested_at = now(), ai_enqueued_at = NULL, needs_review = true WHERE id = $1`,
      [product.id, embedding],
    )
  }
  log.info({ productId, mode }, 'ingest complete — product flagged for review')
}
