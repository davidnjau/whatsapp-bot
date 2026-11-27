import path from 'node:path'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { parseMenuYaml, invalidateMenuCache } from './menu.js'

export const knowledgeDir = () => process.env.KNOWLEDGE_DIR ?? path.resolve('knowledge')

const SAFE_NAME = /^[\w][\w.-]*\.(md|yaml|yml)$/

// The three files the friendly editor manages.
export const KNOWN_KNOWLEDGE_FILES = ['business.md', 'delivery.md', 'menu.yaml'] as const

export function isValidKnowledgeFileName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.includes('..')
}

export async function listKnowledgeFiles(): Promise<string[]> {
  const files = await readdir(knowledgeDir())
  return files.filter((f) => isValidKnowledgeFileName(f)).sort()
}

export async function readKnowledgeFile(name: string): Promise<string> {
  if (!isValidKnowledgeFileName(name)) throw new Error('invalid knowledge file name')
  return readFile(path.join(knowledgeDir(), name), 'utf8')
}

export async function writeKnowledgeFile(name: string, content: string): Promise<void> {
  if (!isValidKnowledgeFileName(name)) throw new Error('invalid knowledge file name')
  if (name === 'menu.yaml') {
    parseMenuYaml(content) // throws with a useful message if the YAML is broken
  }
  const dir = knowledgeDir()
  const target = path.join(dir, name)
  // Keep a timestamped backup of the previous version before overwriting.
  try {
    const prev = await readFile(target, 'utf8')
    const backupsDir = path.join(dir, '.backups')
    await mkdir(backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await writeFile(path.join(backupsDir, `${name}.${stamp}.bak`), prev, 'utf8')
  } catch {
    // no previous file (first write) — nothing to back up
  }
  // Write atomically: temp file + rename, so a crash never leaves a half file.
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`)
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, target)
  invalidateMenuCache()
  kbCache = null
}

let kbCache: { text: string; loadedAt: number } | null = null
const CACHE_MS = 30_000

// All *.md files concatenated — the AI assistant's only source of truth.
export async function loadKnowledgeBase(): Promise<string> {
  if (kbCache && Date.now() - kbCache.loadedAt < CACHE_MS) return kbCache.text
  const files = (await listKnowledgeFiles()).filter((f) => f.endsWith('.md'))
  const parts = await Promise.all(
    files.map(async (f) => `--- ${f} ---\n${await readFile(path.join(knowledgeDir(), f), 'utf8')}`),
  )
  kbCache = { text: parts.join('\n\n'), loadedAt: Date.now() }
  return kbCache.text
}
