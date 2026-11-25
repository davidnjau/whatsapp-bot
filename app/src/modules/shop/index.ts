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
  status: 'draft' | 'published' | 'sold' | 'archived'
  reserved_until: Date | null
  reserved_by: string | null
  created_at: Date
  published_at: Date | null
  sold_at: Date | null
}

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

export async function scanInbox(): Promise<ScanResult> {
  const dir = inboxDir()
  const files = (await readdir(dir)).filter((f) => IMAGE_EXT.test(f)).sort()
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
      const media = await saveMedia(file, mimetype, buffer)
      const info = await extractDressInfo(buffer, mimetype)
      const inserted = await query<Product>(
        `INSERT INTO products (size, price_ksh, media_id, source_file, ocr_source, ocr_raw, needs_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          info.size,
          info.price,
          media.id,
          file,
          info.source,
          info.raw.slice(0, 2000),
          !(info.size && info.price),
        ],
      )
      result.imported.push(inserted.rows[0])
      log.info(
        { file, size: info.size, price: info.price, source: info.source },
        'product imported from inbox',
      )
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

export async function listCatalogue(filter: CatalogueFilter): Promise<Product[]> {
  const where =
    filter === 'needs_review'
      ? `needs_review = true AND status != 'archived'`
      : filter === 'all'
        ? `status != 'archived'`
        : `status = '${filter}'`
  const res = await query<Product>(`SELECT * FROM products WHERE ${where} ORDER BY id DESC`)
  return res.rows
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
  await query(
    `UPDATE products
     SET title = $2, size = $3, price_ksh = $4,
         needs_review = ($3 IS NULL OR $4 IS NULL)
     WHERE id = $1`,
    [id, fields.title, fields.size, fields.price_ksh],
  )
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
