import path from 'node:path'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { parseMenuYaml, invalidateMenuCache } from './menu.js'

export const knowledgeDir = () => process.env.KNOWLEDGE_DIR ?? path.resolve('knowledge')

const SAFE_NAME = /^[\w][\w.-]*\.(md|yaml|yml)$/

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
  await writeFile(path.join(knowledgeDir(), name), content, 'utf8')
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
