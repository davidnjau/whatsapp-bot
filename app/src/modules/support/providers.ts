import Anthropic from '@anthropic-ai/sdk'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiProvider {
  name: string
  chat(system: string, messages: ChatMessage[]): Promise<string>
}

export interface ProviderSettings {
  model: string
  anthropicApiKey: string
  openaiApiKey: string
  geminiApiKey: string
  ollamaUrl: string
}

const MAX_TOKENS = 1024

// The AI signals "I can't help, hand off to a human" by starting its reply with this token.
export const HANDOFF_TOKEN = '[HANDOFF]'

export function parseAiReply(raw: string): { text: string; handoff: boolean } {
  const text = raw.trim()
  if (text.startsWith(HANDOFF_TOKEN)) return { text: '', handoff: true }
  return { text, handoff: false }
}

function anthropicProvider(s: ProviderSettings): AiProvider {
  return {
    name: 'anthropic',
    async chat(system, messages) {
      const client = new Anthropic({ apiKey: s.anthropicApiKey })
      const response = await client.messages.create({
        model: s.model || 'claude-opus-4-8',
        max_tokens: MAX_TOKENS,
        system,
        messages,
      })
      return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
    },
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${url} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<Record<string, any>>
}

function openaiProvider(s: ProviderSettings): AiProvider {
  return {
    name: 'openai',
    async chat(system, messages) {
      const json = await postJson(
        'https://api.openai.com/v1/chat/completions',
        { Authorization: `Bearer ${s.openaiApiKey}` },
        {
          model: s.model || 'gpt-4o-mini',
          messages: [{ role: 'system', content: system }, ...messages],
        },
      )
      return json.choices?.[0]?.message?.content ?? ''
    },
  }
}

function geminiProvider(s: ProviderSettings): AiProvider {
  return {
    name: 'gemini',
    async chat(system, messages) {
      const model = s.model || 'gemini-2.0-flash'
      const json = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${s.geminiApiKey}`,
        {},
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        },
      )
      const parts = json.candidates?.[0]?.content?.parts ?? []
      return parts.map((p: { text?: string }) => p.text ?? '').join('')
    },
  }
}

function ollamaProvider(s: ProviderSettings): AiProvider {
  return {
    name: 'ollama',
    async chat(system, messages) {
      const json = await postJson(`${s.ollamaUrl}/api/chat`, {}, {
        model: s.model || 'llama3.1',
        messages: [{ role: 'system', content: system }, ...messages],
        stream: false,
      })
      return json.message?.content ?? ''
    },
  }
}

export function createProvider(name: string, settings: ProviderSettings): AiProvider | null {
  switch (name) {
    case 'none':
      return null
    case 'anthropic':
      return anthropicProvider(settings)
    case 'openai':
      return openaiProvider(settings)
    case 'gemini':
      return geminiProvider(settings)
    case 'ollama':
      return ollamaProvider(settings)
    default:
      throw new Error(`unknown AI_PROVIDER: ${name}`)
  }
}
