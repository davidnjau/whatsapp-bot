import { query } from '../../db.js'
import { getBool } from '../../lib/settings.js'
import { deleteMedia } from '../status/media.js'
import { productName } from './label.js'
import type { Product } from './index.js'

// One gallery entry in the shape the shop front-end expects.
export interface DressMedia {
  type: 'img' | 'video'
  src: string
  poster?: string
  alt: string
}

// A dress in the exact shape the ported reference app.js consumes.
export interface DressDTO {
  id: number
  name: string
  sizes: number[]
  size: string
  fabric: string
  colour: string
  length: string
  price: number
  short: string
  long: string[]
  care: string[]
  model: string
  mannequin: string
  media: DressMedia[]
  sold: boolean
}

interface MediaRow {
  media_id: number
  kind: string
  poster_media_id: number | null
  position: number
}

const ALT: Record<string, string> = {
  model: 'On a model',
  mannequin: 'On the mannequin',
  close: 'Close-up',
  video: 'Short video',
  photo: 'Photo',
  poster: 'Product card',
}

function toMedia(row: MediaRow, name: string): DressMedia {
  if (row.kind === 'video') {
    return {
      type: 'video',
      src: `/shop/video/${row.media_id}`,
      poster: row.poster_media_id ? `/shop/media/${row.poster_media_id}` : undefined,
      alt: ALT.video,
    }
  }
  return { type: 'img', src: `/shop/media/${row.media_id}`, alt: ALT[row.kind] ?? name }
}

function parseSizes(size: string | null): number[] {
  return (size ?? '')
    .split('/')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function buildDress(p: Product, rows: MediaRow[]): DressDTO {
  const name = productName(p)
  // Gallery media; fall back to the single primary photo if none are attached.
  const media = rows.length ? rows.map((r) => toMedia(r, name)) : [{ type: 'img' as const, src: `/shop/img/${p.id}`, alt: name }]
  const firstOfKind = (kind: string) => rows.find((r) => r.kind === kind)
  const model = firstOfKind('model') ?? firstOfKind('photo') ?? rows[0]
  const mannequin = firstOfKind('mannequin') ?? model
  return {
    // pg returns bigint as a string; the front-end compares ids numerically.
    id: Number(p.id),
    name,
    sizes: parseSizes(p.size),
    size: p.size ?? '',
    fabric: p.fabric ?? '',
    colour: p.colour ?? '',
    length: p.length_desc ?? '',
    price: p.price_ksh ?? 0,
    short: p.short_desc ?? '',
    long: (p.long_desc ?? '').split(/\n\n+/).map((s) => s.trim()).filter(Boolean),
    care: (p.care ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean),
    model: model ? `/shop/media/${model.media_id}` : `/shop/img/${p.id}`,
    mannequin: mannequin ? `/shop/media/${mannequin.media_id}` : `/shop/img/${p.id}`,
    media,
    sold: p.status === 'sold',
  }
}

// Every ordered gallery row for a set of products, grouped by product id.
async function mediaByProduct(ids: number[]): Promise<Map<number, MediaRow[]>> {
  const map = new Map<number, MediaRow[]>()
  if (!ids.length) return map
  const res = await query<MediaRow & { product_id: number }>(
    `SELECT product_id, media_id, kind, poster_media_id, position
     FROM product_media WHERE product_id = ANY($1::bigint[]) ORDER BY product_id, position`,
    [ids],
  )
  for (const row of res.rows) {
    const list = map.get(row.product_id) ?? []
    list.push(row)
    map.set(row.product_id, list)
  }
  return map
}

export async function getProductMedia(productId: number): Promise<MediaRow[]> {
  return (await mediaByProduct([productId])).get(productId) ?? []
}

// --- admin: manage a product's gallery media ---
export interface ProductMediaRow {
  id: number
  media_id: number
  kind: string
  poster_media_id: number | null
  position: number
}

export async function listProductMedia(productId: number): Promise<ProductMediaRow[]> {
  const res = await query<ProductMediaRow>(
    'SELECT id, media_id, kind, poster_media_id, position FROM product_media WHERE product_id = $1 ORDER BY position, id',
    [productId],
  )
  return res.rows
}

// Append a manually-uploaded photo/video to the gallery.
export async function addProductMedia(productId: number, mediaId: number, kind: string): Promise<void> {
  await query(
    `INSERT INTO product_media (product_id, media_id, kind, position)
     VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM product_media WHERE product_id = $1), 100))`,
    [productId, mediaId, kind],
  )
}

// Remove a gallery row; delete the underlying file only if nothing else uses it
// (not the product's primary photo, not another gallery row).
export async function deleteProductMedia(productId: number, rowId: number): Promise<void> {
  const res = await query<{ media_id: number }>(
    'DELETE FROM product_media WHERE id = $1 AND product_id = $2 RETURNING media_id',
    [rowId, productId],
  )
  const mediaId = res.rows[0]?.media_id
  if (mediaId == null) return
  const primary = await query('SELECT 1 FROM products WHERE media_id = $1', [mediaId])
  const other = await query('SELECT 1 FROM product_media WHERE media_id = $1', [mediaId])
  if (!primary.rowCount && !other.rowCount) await deleteMedia(mediaId)
}

// The public catalogue for the shop SPA: published + sold dresses (sold ones
// keep the vintage look), newest first, each with its gallery.
export async function getCatalogue(): Promise<DressDTO[]> {
  const hideSold = await getBool('hide_sold')
  const res = await query<Product>(
    `SELECT * FROM products
     WHERE status = 'published' OR ($1 = false AND status = 'sold')
     ORDER BY (status = 'sold'), id DESC`,
    [hideSold],
  )
  const media = await mediaByProduct(res.rows.map((p) => p.id))
  return res.rows.map((p) => buildDress(p, media.get(p.id) ?? []))
}

// A single dress for the detail view (any published/sold product).
export async function getDress(id: number): Promise<DressDTO | null> {
  const res = await query<Product>(
    `SELECT * FROM products WHERE id = $1 AND status IN ('published','sold')`,
    [id],
  )
  const p = res.rows[0]
  if (!p) return null
  return buildDress(p, await getProductMedia(id))
}
