// WhatsApp-style rendering + pagination for /admin/chats and /admin/chats/:id.
// Ported verbatim from the supplied whatsapp-chat-ui.js to ESM/TypeScript
// (module.exports → named exports, Date arithmetic → .getTime()); logic/markup
// unchanged. Adapt mapMessage()/mapChat() in the route, not this file.

export interface UiMessage {
  fromMe: boolean
  body: string
  timestamp: Date | number | string
}
export interface UiChat {
  id: string
  name?: string | null
  number?: string | null
  lastMessage?: string | null
  lastTimestamp?: Date | number | string | null
  paused?: boolean
  unread?: number
}

const TZ = 'Africa/Nairobi'
const PAGE_SIZE_MESSAGES = 40
const PAGE_SIZE_CHATS = 20

// ---------- helpers ----------
const escMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: unknown = ''): string => String(s).replace(/[&<>"']/g, (c) => escMap[c])

function toDate(ts: Date | number | string): Date {
  if (ts instanceof Date) return ts
  if (typeof ts === 'number') return new Date(ts < 1e12 ? ts * 1000 : ts) // seconds or ms
  return new Date(ts)
}

const dayKey = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: TZ }) // 2026-11-25
const fmtTime = (d: Date): string => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })

function dayLabel(d: Date): string {
  const now = new Date()
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getTime() - 864e5))
  const k = dayKey(d)
  if (k === today) return 'Today'
  if (k === yesterday) return 'Yesterday'
  const diffDays = (new Date(today).getTime() - new Date(k).getTime()) / 864e5
  if (diffDays < 7) return d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long' })
  return d.toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Chat-list time: "11:19" today, "Yesterday", weekday, or dd/mm/yyyy
function listTime(d: Date): string {
  const l = dayLabel(d)
  return l === 'Today' ? fmtTime(d) : l
}

// WhatsApp formatting: *bold* _italic_ ~strike~ ```mono``` + links
function waFormat(text: string): string {
  let s = esc(text)
  s = s.replace(/```([\s\S]+?)```/g, '<code class="font-mono">$1</code>')
  s = s.replace(/(^|[\s>])\*(?!\s)([^*\n]+?)\*(?=[\s<.,!?]|$)/g, '$1<strong>$2</strong>')
  s = s.replace(/(^|[\s>])_(?!\s)([^_\n]+?)_(?=[\s<.,!?]|$)/g, '$1<em>$2</em>')
  s = s.replace(/(^|[\s>])~(?!\s)([^~\n]+?)~(?=[\s<.,!?]|$)/g, '$1<del>$2</del>')
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-[#027eb5] underline">$1</a>')
  return s
}

// "254716060198" / "254716060198@c.us" → "+254 716 060 198". @lid ids are not phone numbers → ''.
function fmtPhone(raw: string | null | undefined = ''): string {
  const s = String(raw ?? '')
  if (/@lid$/.test(s)) return ''
  const digits = s.replace(/@.*$/, '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('254') && digits.length === 12)
    return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
  return '+' + digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim()
}

// Name and number for a chat. Name falls back to the number when the contact has no name.
function who(c: UiChat): { name: string; phone: string; title: string } {
  const phone = fmtPhone(c.number || c.id)
  // Drop the name only when it is just the number again (e.g. name "254716060198")
  const isJustNumber = c.name && /^[\d\s+()-]+$/.test(c.name)
  const name = c.name && !isJustNumber ? String(c.name).trim() : ''
  return { name, phone, title: name || phone || String(c.id).replace(/@.*$/, '') }
}

function initials(name = ''): string {
  const parts = String(name)
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length || /^\d+$/.test(parts[0])) return ''
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

function avatar(name: string, size = 40): string {
  const ini = initials(name)
  return `<div class="shrink-0 rounded-full bg-[#dfe5e7] text-[#54656f] flex items-center justify-center font-medium"
    style="width:${size}px;height:${size}px">${
    ini
      ? esc(ini)
      : `<svg viewBox="0 0 212 212" width="${size}" height="${size}"><path fill="#dfe5e7" d="M106 0C47.5 0 0 47.5 0 106s47.5 106 106 106 106-47.5 106-106S164.5 0 106 0z"/><path fill="#fff" d="M106 45c-20 0-36 16-36 36s16 36 36 36 36-16 36-36-16-36-36-36zm0 86c-32 0-60 15-72 39 18 21 44 34 72 34s54-13 72-34c-12-24-40-39-72-39z"/></svg>`
  }</div>`
}

const ticks = `<svg viewBox="0 0 16 11" width="16" height="11" class="inline-block ml-0.5 text-[#53bdeb]"><path fill="currentColor" d="M11.07.65 10.4.13a.37.37 0 0 0-.52.07L4.03 7.7 1.7 5.5a.37.37 0 0 0-.52.01l-.6.62a.37.37 0 0 0 0 .52l3.2 3.06c.15.15.4.13.53-.04l6.8-8.5a.37.37 0 0 0-.04-.52zm4 0-.67-.52a.37.37 0 0 0-.52.07L7.97 7.7l-.6-.57-.97 1.21 1.38 1.32c.15.15.4.13.53-.04l6.8-8.5a.37.37 0 0 0-.04-.52z"/></svg>`

// ---------- pagination ----------
type Dated<T> = T & { _d: Date }

// messages: full array (any order). Returns newest page ending before `before` (ms), oldest→newest.
function pageMessages(
  messages: UiMessage[],
  { before, limit = PAGE_SIZE_MESSAGES }: { before?: string | number; limit?: number } = {},
): { page: Dated<UiMessage>[]; hasOlder: boolean; olderCursor: number | null; total: number } {
  const sorted: Dated<UiMessage>[] = messages
    .map((m) => ({ ...m, _d: toDate(m.timestamp) }))
    .sort((a, b) => a._d.getTime() - b._d.getTime())
  const cutoff = before ? Number(before) : Infinity
  const eligible = sorted.filter((m) => m._d.getTime() < cutoff)
  const page = eligible.slice(-limit)
  const hasOlder = eligible.length > page.length
  const olderCursor = hasOlder && page.length ? page[0]._d.getTime() : null
  return { page, hasOlder, olderCursor, total: sorted.length }
}

function pageChats(
  chats: UiChat[],
  page: string | number = 1,
  limit = PAGE_SIZE_CHATS,
): { items: UiChat[]; page: number; totalPages: number; total: number } {
  const sorted = [...chats].sort((a, b) => toDate(b.lastTimestamp || 0).getTime() - toDate(a.lastTimestamp || 0).getTime())
  const totalPages = Math.max(1, Math.ceil(sorted.length / limit))
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages)
  return { items: sorted.slice((p - 1) * limit, p * limit), page: p, totalPages, total: sorted.length }
}

// ---------- shared styles ----------
const STYLES = `<style>
  .wa-wall{background-color:#efeae2;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%23d9d2c5' fill-opacity='.35'%3E%3Ccircle cx='10' cy='10' r='2'/%3E%3Ccircle cx='50' cy='30' r='1.5'/%3E%3Cpath d='M30 60l4-4 4 4-4 4z'/%3E%3Ccircle cx='70' cy='65' r='2'/%3E%3C/g%3E%3C/svg%3E")}
  .wa-out,.wa-in{position:relative;box-shadow:0 1px .5px rgba(11,20,26,.13)}
  .wa-out{background:#d9fdd3}
  .wa-in{background:#fff}
  .wa-out.wa-tail{border-top-right-radius:0}
  .wa-in.wa-tail{border-top-left-radius:0}
  .wa-out.wa-tail:after,.wa-in.wa-tail:before{content:"";position:absolute;top:0;width:8px;height:13px}
  .wa-out.wa-tail:after{right:-8px;background:linear-gradient(to bottom left,#d9fdd3 50%,transparent 50%)}
  .wa-in.wa-tail:before{left:-8px;background:linear-gradient(to bottom right,#fff 50%,transparent 50%)}
  .wa-meta{float:right;margin:6px 0 -4px 10px;font-size:11px;line-height:15px;color:#667781;white-space:nowrap}
  .wa-scroll::-webkit-scrollbar{width:6px}.wa-scroll::-webkit-scrollbar-thumb{background:rgba(0,0,0,.2);border-radius:3px}
</style>`

// ---------- chat view ----------
export function renderChat({
  chat,
  messages,
  before,
  basePath = '/admin/chats',
}: {
  chat: UiChat
  messages: UiMessage[]
  before?: string | number
  basePath?: string
}): string {
  const { page, hasOlder, olderCursor, total } = pageMessages(messages, { before })
  const idEnc = encodeURIComponent(chat.id)
  const { name, phone, title } = who(chat)

  let html = ''
  let lastDay: string | null = null
  let lastSide: string | null = null

  for (const m of page) {
    const d = m._d
    const k = dayKey(d)
    if (k !== lastDay) {
      html += `<div class="flex justify-center my-3 sticky top-2 z-10">
        <span class="bg-white text-[#54656f] text-[12.5px] px-3 py-1 rounded-lg shadow-sm uppercase tracking-wide">${esc(dayLabel(d))}</span>
      </div>`
      lastDay = k
      lastSide = null
    }
    const side = m.fromMe ? 'out' : 'in'
    const tail = side !== lastSide // first bubble in a run gets the tail
    lastSide = side
    html += `<div class="flex ${side === 'out' ? 'justify-end' : 'justify-start'} ${tail ? 'mt-2' : 'mt-0.5'} px-[6%]">
      <div class="wa-${side} ${tail ? 'wa-tail' : ''} max-w-[65%] rounded-lg px-2 pt-1.5 pb-2 text-[14.2px] leading-[19px] text-[#111b21]"
           title="${esc(d.toLocaleString('en-GB', { timeZone: TZ }))}">
        <span class="whitespace-pre-wrap break-words">${waFormat(m.body || '')}</span>
        <span class="wa-meta">${fmtTime(d)}${side === 'out' ? ticks : ''}</span>
      </div>
    </div>`
  }

  const shown = page.length
  return `${STYLES}
<div class="flex flex-col h-[calc(100vh-2rem)] rounded-xl overflow-hidden border border-[#e9edef]">
  <!-- header -->
  <div class="flex items-center gap-3 bg-[#f0f2f5] px-4 py-2.5 border-b border-[#e9edef]">
    <a href="${basePath}" class="text-[#54656f] hover:text-[#111b21] text-xl leading-none" aria-label="All chats">&larr;</a>
    ${avatar(name, 40)}
    <div class="min-w-0 flex-1">
      <div class="text-[16px] text-[#111b21] truncate">${esc(title)}</div>
      <div class="text-[13px] text-[#667781] truncate">${[
        name && phone ? esc(phone) : '',
        name ? '' : phone ? 'No saved name' : '',
        chat.paused ? '<span class="text-amber-700">bot paused</span>' : '',
      ]
        .filter(Boolean)
        .join(' · ')}</div>
    </div>
    <form method="post" action="${basePath}/${idEnc}/pause">
      <button class="text-sm rounded-full px-4 py-1.5 ${
        chat.paused
          ? 'bg-[#00a884] text-white hover:bg-[#008f72]'
          : 'bg-white border border-[#d1d7db] text-[#111b21] hover:bg-[#f5f6f6]'
      }">
        ${chat.paused ? 'Resume bot' : 'Pause bot'}
      </button>
    </form>
  </div>

  <!-- messages -->
  <div id="wa-scroll" class="wa-wall wa-scroll flex-1 overflow-y-auto py-2">
    ${
      hasOlder
        ? `<div class="flex justify-center my-2">
      <a href="${basePath}/${idEnc}?before=${olderCursor}" class="bg-white/90 text-[#008069] text-[13px] px-4 py-1.5 rounded-full shadow-sm hover:bg-white">
        Load older messages
      </a></div>`
        : `<div class="flex justify-center my-2">
      <span class="bg-[#ffeecd] text-[#54656f] text-[12.5px] px-3 py-1.5 rounded-lg shadow-sm max-w-md text-center">
        Start of conversation · ${total} message${total === 1 ? '' : 's'}
      </span></div>`
    }
    ${shown ? html : '<p class="text-center text-[#667781] text-sm mt-10">No messages yet</p>'}
    ${
      before
        ? `<div class="flex justify-center my-3">
      <a href="${basePath}/${idEnc}" class="bg-white/90 text-[#008069] text-[13px] px-4 py-1.5 rounded-full shadow-sm hover:bg-white">
        Jump to latest &darr;
      </a></div>`
        : ''
    }
  </div>
</div>
<script>
  (function(){var el=document.getElementById('wa-scroll');if(!el)return;
    if(!/[?&]before=/.test(location.search)) el.scrollTop=el.scrollHeight; })();
</script>`
}

// ---------- chat list ----------
export function renderChatList({
  chats,
  page = 1,
  q = '',
  basePath = '/admin/chats',
}: {
  chats: UiChat[]
  page?: string | number
  q?: string
  basePath?: string
}): string {
  const query = String(q || '')
    .trim()
    .toLowerCase()
  const filtered = query
    ? chats.filter(
        (c) =>
          `${c.name || ''} ${c.number || ''} ${String(c.id).replace(/@.*$/, '')} ${c.lastMessage || ''}`
            .toLowerCase()
            .includes(query.replace(/[\s+-]/g, '').replace(/^0(?=[17]\d)/, '254')) ||
          `${c.name || ''} ${c.lastMessage || ''}`.toLowerCase().includes(query),
      )
    : chats
  const { items, page: p, totalPages, total } = pageChats(filtered, page)
  const qs = (n: number): string => `?page=${n}${query ? `&q=${encodeURIComponent(query)}` : ''}`

  const rows = items
    .map((c) => {
      const { name, phone, title } = who(c)
      const d = c.lastTimestamp ? toDate(c.lastTimestamp) : null
      return `<a href="${basePath}/${encodeURIComponent(c.id)}" class="flex items-center gap-3 px-3 hover:bg-[#f5f6f6]">
      ${avatar(name, 49)}
      <div class="min-w-0 flex-1 border-b border-[#e9edef] py-3">
        <div class="flex items-baseline gap-2">
          <span class="flex-1 min-w-0 truncate">
            <span class="text-[17px] text-[#111b21]">${esc(title)}</span>
            ${name && phone ? `<span class="text-[13px] text-[#667781] ml-1.5">${esc(phone)}</span>` : ''}
          </span>
          ${d ? `<span class="text-[12px] ${c.unread ? 'text-[#00a884] font-medium' : 'text-[#667781]'}">${esc(listTime(d))}</span>` : ''}
        </div>
        <div class="flex items-center gap-2 mt-0.5">
          <span class="flex-1 truncate text-[14px] text-[#667781]">${esc(c.lastMessage || '')}</span>
          ${c.paused ? '<span class="text-[11px] bg-amber-100 text-amber-800 rounded-full px-2 py-0.5 whitespace-nowrap">bot paused</span>' : ''}
          ${c.unread ? `<span class="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25d366] text-white text-[12px] flex items-center justify-center">${c.unread}</span>` : ''}
        </div>
      </div>
    </a>`
    })
    .join('')

  const pager =
    totalPages > 1
      ? `<div class="flex items-center justify-between px-4 py-3 bg-[#f0f2f5] text-sm text-[#54656f]">
      ${p > 1 ? `<a href="${qs(p - 1)}" class="px-3 py-1.5 rounded-full bg-white border border-[#d1d7db] hover:bg-[#f5f6f6]">&larr; Newer</a>` : '<span></span>'}
      <span>Page ${p} of ${totalPages} · ${total} chats</span>
      ${p < totalPages ? `<a href="${qs(p + 1)}" class="px-3 py-1.5 rounded-full bg-white border border-[#d1d7db] hover:bg-[#f5f6f6]">Older &rarr;</a>` : '<span></span>'}
    </div>`
      : ''

  return `${STYLES}
<div class="rounded-xl overflow-hidden border border-[#e9edef] bg-white">
  <div class="bg-[#f0f2f5] px-4 pt-3 pb-2">
    <h1 class="text-[20px] font-semibold text-[#111b21] mb-2">Chats</h1>
    <form method="get" class="flex items-center bg-white rounded-lg px-3">
      <svg viewBox="0 0 24 24" width="18" height="18" class="text-[#54656f]"><path fill="currentColor" d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 0 0 1.256-3.386 5.207 5.207 0 1 0-5.207 5.208 5.183 5.183 0 0 0 3.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-4.808 0a3.605 3.605 0 1 1 0-7.21 3.605 3.605 0 0 1 0 7.21z"/></svg>
      <input name="q" value="${esc(q)}" placeholder="Search or start a new chat" class="flex-1 px-3 py-2 text-sm outline-none bg-transparent">
    </form>
  </div>
  ${rows || '<p class="text-center text-[#667781] text-sm py-10">No chats found</p>'}
  ${pager}
</div>`
}

export { fmtPhone, dayLabel, fmtTime, pageMessages, pageChats }
