import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { enqueueSend } from '../../queue/index.js'
import { saveMedia } from '../status/media.js'
import { buildStatusCaption, productName } from './label.js'
import { extractDressInfo } from './ocr.js'

export interface Product {
  id: number
  title: string | null
  size: string | null
  price_ksh: number | null
  media_id: number
  source_file: string | null
  ocr_source: string | null
  needs_review: boolean
  featured: boolean
  fabric: string | null
  colour: string | null
  length_desc: string | null
  short_desc: string | null
  long_desc: string | null
  care: string | null
  silhouette: string | null
  stretch_level: string | null
  fit_notes: string | null
  social_caption: string | null
  occasions: string[] | null
  ai_ingested_at: Date | null
  status: 'draft' | 'published' | 'sold' | 'archived'
  reserved_until: Date | null
  reserved_by: string | null
  created_at: Date
  published_at: Date | null
  sold_at: Date | null
}

export const DEFAULT_PRICE_KSH = 1000

const inboxDir = () => process.env.INBOX_DIR ?? path.resolve('inbox')
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export interface ScanResult {
  imported: Product[]
  skipped: number
  failed: Array<{ file: string; error: string }>
}

// OCR one image and create a product (draft, flagged for review when the
// size/price couldn't be read). `sourceFile` is the filename for inbox scans
// (used to dedupe re-scans) or null for browser uploads.
export async function importProductImage(
  filename: string,
  mimetype: string,
  buffer: Buffer,
  sourceFile: string | null,
): Promise<Product> {
  const media = await saveMedia(filename, mimetype, buffer)
  const info = await extractDressInfo(buffer, mimetype)
  // DressNation's usual price is Ksh 1,000 — default it when OCR can't read the
  // price, but still flag for review so the owner confirms.
  const price = info.price ?? DEFAULT_PRICE_KSH
  const needsReview = !info.size || info.price == null
  const inserted = await query<Product>(
    `INSERT INTO products (size, price_ksh, media_id, source_file, ocr_source, ocr_raw, needs_review)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [info.size, price, media.id, sourceFile, info.source, info.raw.slice(0, 2000), needsReview],
  )
  log.info({ filename, size: info.size, price, source: info.source }, 'product imported')
  return inserted.rows[0]
}

export async function scanInbox(): Promise<ScanResult> {
  const dir = inboxDir()
  const files = (await readdir(dir)).filter((f) => IMAGE_EXT.test(f) && !f.startsWith('.')).sort()
  const result: ScanResult = { imported: [], skipped: 0, failed: [] }

  for (const file of files) {
    const seen = await query('SELECT 1 FROM products WHERE source_file = $1', [file])
    if (seen.rowCount) {
      result.skipped++
      continue
    }
    try {
      const buffer = await readFile(path.join(dir, file))
      const mimetype = MIME[path.extname(file).toLowerCase()] ?? 'image/jpeg'
      result.imported.push(await importProductImage(file, mimetype, buffer, file))
    } catch (err) {
      result.failed.push({ file, error: (err as Error).message })
      log.error({ file, err: (err as Error).message }, 'inbox import failed')
    }
  }
  return result
}

export async function listProducts(status?: string): Promise<Product[]> {
  if (status) {
    const res = await query<Product>(
      'SELECT * FROM products WHERE status = $1 ORDER BY id DESC',
      [status],
    )
    return res.rows
  }
  const res = await query<Product>(
    `SELECT * FROM products WHERE status != 'archived' ORDER BY id DESC`,
  )
  return res.rows
}

export type CatalogueFilter = 'all' | 'needs_review' | 'draft' | 'published' | 'sold'

// Upload-time windows for the catalogue list.
export type CatalogueSince = 'all' | '1w' | '2w' | '3w' | '4w' | '1mo' | 'older'
const SINCE_SQL: Record<CatalogueSince, string | null> = {
  all: null,
  '1w': `created_at >= now() - interval '7 days'`,
  '2w': `created_at >= now() - interval '14 days'`,
  '3w': `created_at >= now() - interval '21 days'`,
  '4w': `created_at >= now() - interval '28 days'`,
  '1mo': `created_at >= now() - interval '1 month'`,
  older: `created_at < now() - interval '1 month'`,
}

export interface CatalogueQuery {
  filter: CatalogueFilter
  search?: string
  since?: CatalogueSince
  page?: number
  pageSize?: number
}

export async function listCatalogue(q: CatalogueQuery): Promise<{ rows: Product[]; total: number }> {
  const clauses: string[] = []
  const params: unknown[] = []
  clauses.push(
    q.filter === 'needs_review'
      ? `needs_review = true AND status != 'archived'`
      : q.filter === 'all'
        ? `status != 'archived'`
        : `status = $${params.push(q.filter)}`,
  )
  const sinceSql = SINCE_SQL[q.since ?? 'all']
  if (sinceSql) clauses.push(sinceSql)
  const term = (q.search ?? '').trim()
  if (term) {
    const like = `%${term}%`
    clauses.push(`(title ILIKE $${params.push(like)} OR CAST(id AS text) = $${params.push(term)})`)
  }
  const where = clauses.join(' AND ')
  const pageSize = q.pageSize ?? 12
  const page = Math.max(1, q.page ?? 1)

  const totalRes = await query<{ count: string }>(`SELECT count(*) FROM products WHERE ${where}`, params)
  const total = Number(totalRes.rows[0].count)
  const res = await query<Product>(
    `SELECT * FROM products WHERE ${where} ORDER BY id DESC LIMIT $${params.push(pageSize)} OFFSET $${params.push((page - 1) * pageSize)}`,
    params,
  )
  return { rows: res.rows, total }
}

export async function catalogueCounts(): Promise<Record<string, number>> {
  const res = await query<{ metric: string; count: string }>(
    `SELECT status AS metric, count(*) FROM products WHERE status != 'archived' GROUP BY status
     UNION ALL SELECT 'needs_review', count(*) FROM products WHERE needs_review = true AND status != 'archived'
     UNION ALL SELECT 'all', count(*) FROM products WHERE status != 'archived'`,
  )
  const counts: Record<string, number> = {}
  for (const row of res.rows) counts[row.metric] = Number(row.count)
  return counts
}

// Publish every draft that has a size and price. Drafts still needing review
// (missing size/price) are skipped and reported.
export async function publishAllDrafts(): Promise<{ published: number; skipped: number }> {
  const drafts = await query<{ id: number }>(
    `SELECT id FROM products WHERE status = 'draft' AND size IS NOT NULL AND price_ksh IS NOT NULL`,
  )
  for (const row of drafts.rows) {
    await publishProduct(row.id)
  }
  const skipped = await query<{ count: string }>(
    `SELECT count(*) FROM products WHERE status = 'draft' AND (size IS NULL OR price_ksh IS NULL)`,
  )
  return { published: drafts.rows.length, skipped: Number(skipped.rows[0].count) }
}

export async function getProduct(id: number): Promise<Product | null> {
  const res = await query<Product>('SELECT * FROM products WHERE id = $1', [id])
  return res.rows[0] ?? null
}

export async function updateProduct(
  id: number,
  fields: { title: string | null; size: string | null; price_ksh: number | null },
): Promise<void> {
  const needsReview = fields.size === null || fields.price_ksh === null
  await query(
    `UPDATE products
     SET title = $2::text, size = $3::text, price_ksh = $4::int, needs_review = $5::boolean
     WHERE id = $1`,
    [id, fields.title, fields.size, fields.price_ksh, needsReview],
  )
}

// Uploads not yet AI-enriched and not excluded — the "awaiting enrichment" queue.
export async function listAwaitingEnrichment(): Promise<
  Array<{ id: number; title: string | null; size: string | null }>
> {
  const res = await query<{ id: number; title: string | null; size: string | null }>(
    `SELECT id, title, size FROM products
     WHERE ai_ingested_at IS NULL AND NOT ai_skipped AND status NOT IN ('archived', 'sold')
     ORDER BY created_at DESC LIMIT 60`,
  )
  return res.rows.map((r) => ({ ...r, id: Number(r.id) }))
}

export async function setAiSkipped(id: number, skipped: boolean): Promise<void> {
  await query('UPDATE products SET ai_skipped = $2 WHERE id = $1', [id, skipped])
}

// Full detail edit (owner review of AI-filled or hand-typed content).
export async function updateProductDetails(
  id: number,
  f: {
    title: string | null
    size: string | null
    price_ksh: number | null
    fabric: string | null
    colour: string | null
    length_desc: string | null
    short_desc: string | null
    long_desc: string | null
    social_caption: string | null
    occasions: string[] | null
    silhouette: string | null
    stretch_level: string | null
    fit_notes: string | null
  },
): Promise<void> {
  const needsReview = f.size === null || f.price_ksh === null
  await query(
    `UPDATE products SET
       title = $2::text, size = $3::text, price_ksh = $4::int,
       fabric = $5::text, colour = $6::text, length_desc = $7::text,
       short_desc = $8::text, long_desc = $9::text, social_caption = $10::text,
       occasions = $11::jsonb, silhouette = $12::text, stretch_level = $13::text, fit_notes = $14::text,
       needs_review = $15::boolean
     WHERE id = $1`,
    [
      id, f.title, f.size, f.price_ksh, f.fabric, f.colour, f.length_desc,
      f.short_desc, f.long_desc, f.social_caption,
      f.occasions ? JSON.stringify(f.occasions) : null,
      f.silhouette, f.stretch_level, f.fit_notes, needsReview,
    ],
  )
}

// Spin this dress in the shop's "fitting room" hero (or stop).
export async function setFeatured(id: number, featured: boolean): Promise<void> {
  await query('UPDATE products SET featured = $2::boolean WHERE id = $1', [id, featured])
}

// Publish = list in the catalogue + post a WhatsApp Status with the image,
// label and a link to the product page.
export async function publishProduct(id: number): Promise<void> {
  const product = await getProduct(id)
  if (!product) throw new Error('product not found')
  if (!product.size || !product.price_ksh) {
    throw new Error('set size and price before publishing')
  }
  const caption = buildStatusCaption(product, config.appBaseUrl)
  const sendId = await enqueueSend({
    chatId: 'status@broadcast',
    module: 'status',
    kind: 'status',
    payload: {
      type: 'status',
      input: { type: 'image', media_id: product.media_id, caption },
      contacts: null,
    },
  })
  await query(
    `UPDATE products
     SET status = 'published', published_at = now(), needs_review = false, status_send_id = $2
     WHERE id = $1`,
    [id, sendId],
  )
  log.info({ productId: id, sendId, name: productName(product) }, 'product published')
}

export async function setProductStatus(id: number, status: Product['status']): Promise<void> {
  await query(
    `UPDATE products
     SET status = $2,
         sold_at = CASE WHEN $2 = 'sold' THEN now() ELSE sold_at END,
         reserved_until = NULL, reserved_by = NULL
     WHERE id = $1`,
    [id, status],
  )
}
