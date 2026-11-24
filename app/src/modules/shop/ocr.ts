import Anthropic from '@anthropic-ai/sdk'
import { createWorker, type Worker } from 'tesseract.js'
import { config } from '../../config.js'
import { log } from '../../logger.js'
import { parseDressLabel, type DressLabel } from './label.js'

export interface DressInfo extends DressLabel {
  source: 'tesseract' | 'claude' | 'none'
  raw: string
}

let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng')
  return workerPromise
}

async function tesseractText(image: Buffer): Promise<string> {
  const worker = await getWorker()
  const { data } = await worker.recognize(image)
  return data.text
}

async function claudeExtract(
  image: Buffer,
  mimetype: string,
): Promise<DressLabel & { raw: string }> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey })
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimetype as 'image/jpeg' | 'image/png' | 'image/webp',
              data: image.toString('base64'),
            },
          },
          {
            type: 'text',
            text:
              'This product photo has a label badge showing a dress size and a price in Kenyan shillings. ' +
              'Reply with ONLY a JSON object, no other text: {"size": "<size as shown, e.g. 14 or 14/16>", "price": <number>}. ' +
              'Use null for anything you cannot read.',
          },
        ],
      },
    ],
  })
  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
  const price = typeof parsed.price === 'number' ? parsed.price : Number(parsed.price) || null
  return {
    size: typeof parsed.size === 'string' && parsed.size ? parsed.size : null,
    price: price && price >= 50 && price <= 100_000 ? price : null,
    raw,
  }
}

// Tiered extraction, mirroring the AutomatedScripts assign flow:
// local OCR first (free), Claude Vision as fallback when the label isn't read.
export async function extractDressInfo(image: Buffer, mimetype: string): Promise<DressInfo> {
  let text = ''
  try {
    text = await tesseractText(image)
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'tesseract OCR failed')
  }
  const local = parseDressLabel(text)
  if (local.size && local.price) return { ...local, source: 'tesseract', raw: text }

  if (config.anthropicApiKey) {
    try {
      const vision = await claudeExtract(image, mimetype)
      if (vision.size || vision.price) {
        return {
          size: vision.size ?? local.size,
          price: vision.price ?? local.price,
          source: 'claude',
          raw: vision.raw,
        }
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'Claude Vision fallback failed')
    }
  }

  return { ...local, source: local.size || local.price ? 'tesseract' : 'none', raw: text }
}
