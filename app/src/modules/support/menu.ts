import path from 'node:path'
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { z } from 'zod'

const LangStrings = z.object({ en: z.string().optional(), sw: z.string().optional() })

const MenuItemSchema = z.object({
  key: z.string(),
  title: z.string(),
  titles: LangStrings.optional(),
  keywords: z.array(z.string()).default([]),
  reply: z.string().optional(),
  handoff: z.boolean().default(false),
  action: z.enum(['catalogue']).optional(),
})

export const MenuSchema = z.object({
  language_prompt: z
    .string()
    .default('Choose a language / Chagua lugha:\n1. English\n2. Kiswahili\n3. Mix'),
  greeting: z.string().default(''),
  greetings: LangStrings.optional(),
  menu_footer: z.string().default(''),
  menu_footers: LangStrings.optional(),
  fallback: z.string().default("Sorry, I didn't understand. Reply with a number:"),
  after_hours: z.string().default('We are currently closed. We will reply during business hours.'),
  media_ack: z.string().default('Thanks! A member of our team will take a look shortly.'),
  menu: z.array(MenuItemSchema).default([]),
})

export type Menu = z.infer<typeof MenuSchema>
export type MenuItem = z.infer<typeof MenuItemSchema>
export type Lang = 'en' | 'sw' | 'mix'

export function parseLanguageChoice(text: string): Lang | null {
  const t = text.trim().toLowerCase()
  if (t === '1' || /\beng(lish)?\b/.test(t)) return 'en'
  if (t === '2' || /\b(swahili|kiswahili|kisw)\b/.test(t)) return 'sw'
  if (t === '3' || /\b(mix|mchanganyiko|mixture|both|sheng)\b/.test(t)) return 'mix'
  return null
}

export function greetingFor(menu: Menu, lang: Lang): string {
  if (lang === 'en') return menu.greetings?.en ?? menu.greeting
  if (lang === 'sw') return menu.greetings?.sw ?? menu.greeting
  return menu.greeting
}

function titleFor(item: MenuItem, lang: Lang): string {
  if (lang === 'en') return item.titles?.en ?? item.title
  if (lang === 'sw') return item.titles?.sw ?? item.title
  return item.title
}

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

export function menuList(menu: Menu, lang: Lang = 'mix'): string {
  return menu.menu.map((item) => `${item.key}. ${titleFor(item, lang)}`).join('\n')
}

function footerFor(menu: Menu, lang: Lang): string {
  if (lang === 'en') return menu.menu_footers?.en ?? menu.menu_footer
  if (lang === 'sw') return menu.menu_footers?.sw ?? menu.menu_footer
  return menu.menu_footer
}

// A full menu message: optional header + numbered options + policy footer.
export function menuMessage(menu: Menu, lang: Lang, header = ''): string {
  return [header.trim(), menuList(menu, lang), footerFor(menu, lang).trim()]
    .filter(Boolean)
    .join('\n\n')
}

// "menu" / "back" etc. — re-open the menu (and abandon any active order).
export function isMenuCommand(text: string): boolean {
  return /^\s*(menu|menyu|back|home|rudi|orodha|options?)\s*$/i.test(text)
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
