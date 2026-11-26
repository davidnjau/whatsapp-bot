import sharp from 'sharp'

// Resize to a max width (never upscaled), auto-orient, and compress to WebP.
export async function resizeWebp(buf: Buffer, maxWidth: number): Promise<Buffer> {
  return sharp(buf)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
}
