import path from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { query } from '../../db.js'
import { getObject, putObject, storageEnabled } from '../../lib/storage.js'
import type { StatusFile } from './payload.js'

const mediaDir = () => process.env.MEDIA_DIR ?? path.resolve('media')

export interface MediaItem {
  id: number
  name: string
  path: string
  mimetype: string | null
  size_bytes: number
  storage: string
  created_at: Date
}

export async function saveMedia(
  filename: string,
  mimetype: string,
  content: Buffer,
): Promise<MediaItem> {
  const safeName = path.basename(filename).replace(/[^\w.-]/g, '_') || 'file'
  const inserted = await query<{ id: number }>(
    `INSERT INTO media_library (name, path, mimetype, size_bytes)
     VALUES ($1, '', $2, $3) RETURNING id`,
    [safeName, mimetype, content.length],
  )
  const id = inserted.rows[0].id
  if (storageEnabled()) {
    const key = `media/${id}-${safeName}`
    await putObject(key, content, mimetype)
    await query('UPDATE media_library SET path = $2, storage = $3 WHERE id = $1', [id, key, 'minio'])
  } else {
    await mkdir(mediaDir(), { recursive: true })
    const filePath = path.join(mediaDir(), `${id}-${safeName}`)
    await writeFile(filePath, content)
    await query('UPDATE media_library SET path = $2 WHERE id = $1', [id, filePath])
  }
  const res = await query<MediaItem>('SELECT * FROM media_library WHERE id = $1', [id])
  return res.rows[0]
}

export async function listMedia(): Promise<MediaItem[]> {
  const res = await query<MediaItem>('SELECT * FROM media_library ORDER BY created_at DESC')
  return res.rows
}

export async function getMedia(id: number): Promise<MediaItem | null> {
  const res = await query<MediaItem>('SELECT * FROM media_library WHERE id = $1', [id])
  return res.rows[0] ?? null
}

export async function deleteMedia(id: number): Promise<void> {
  const item = await getMedia(id)
  if (!item) return
  await query('DELETE FROM media_library WHERE id = $1', [id])
  // MinIO objects are left in the bucket (cheap, and product_media may share);
  // only local-disk files are removed here.
  if (item.storage !== 'minio') await rm(item.path, { force: true })
}

export async function readMediaContent(id: number): Promise<{ item: MediaItem; content: Buffer } | null> {
  const item = await getMedia(id)
  if (!item) return null
  const content = item.storage === 'minio' ? await getObject(item.path) : await readFile(item.path)
  return { item, content }
}

// WAHA accepts files as base64 `data` — no public URL needed.
export async function mediaAsWahaFile(id: number): Promise<StatusFile> {
  const loaded = await readMediaContent(id)
  if (!loaded) throw new Error(`media item ${id} not found`)
  return {
    mimetype: loaded.item.mimetype ?? undefined,
    filename: loaded.item.name,
    data: loaded.content.toString('base64'),
  }
}
