import path from 'node:path'
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { z } from 'zod'

const MenuItemSchema = z.object({
  key: z.string(),
  title: z.string(),
  keywords: z.array(z.string()).default([]),
  reply: z.string().optional(),
  handoff: z.boolean().default(false),
})

export const MenuSchema = z.object({
  greeting: z.string().default(''),
  fallback: z.string().default("Sorry, I didn't understand. Reply with a number:"),
  after_hours: z.string().default('We are currently closed. We will reply during business hours.'),
  media_ack: z.string().default('Thanks! A member of our team will take a look shortly.'),
  menu: z.array(MenuItemSchema).default([]),
})

export type Menu = z.infer<typeof MenuSchema>
export type MenuItem = z.infer<typeof MenuItemSchema>

export function matchMenuItem(menu: Menu, text: string): MenuItem | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  for (const item of menu.menu) {
    if (item.key === t) return item
  }
  for (const item of menu.menu) {
    for (const keyword of item.keywords) {
      if (t.includes(keyword.toLowerCase())) return item
    }
  }
  return null
}

export function menuList(menu: Menu): string {
  return menu.menu.map((item) => `${item.key}. ${item.title}`).join('\n')
}

export function parseMenuYaml(raw: string): Menu {
  return MenuSchema.parse(YAML.parse(raw))
}

const knowledgeDir = () => process.env.KNOWLEDGE_DIR ?? path.resolve('knowledge')

let cache: { menu: Menu; loadedAt: number } | null = null
const CACHE_MS = 30_000

export async function loadMenu(): Promise<Menu> {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.menu
  const raw = await readFile(path.join(knowledgeDir(), 'menu.yaml'), 'utf8')
  const menu = parseMenuYaml(raw)
  cache = { menu, loadedAt: Date.now() }
  return menu
}

export function invalidateMenuCache() {
  cache = null
}
