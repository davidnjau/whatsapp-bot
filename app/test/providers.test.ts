import { describe, expect, it } from 'vitest'
import {
  createProvider,
  parseAiReply,
  HANDOFF_TOKEN,
  type ProviderSettings,
} from '../src/modules/support/providers.js'

const settings: ProviderSettings = {
  model: '',
  anthropicApiKey: 'test',
  openaiApiKey: 'test',
  geminiApiKey: 'test',
  ollamaUrl: 'http://localhost:11434',
}

describe('createProvider', () => {
  it('returns null for none (menu mode)', () => {
    expect(createProvider('none', settings)).toBeNull()
  })

  it('returns a provider for each supported name', () => {
    for (const name of ['anthropic', 'openai', 'gemini', 'ollama']) {
      const provider = createProvider(name, settings)
      expect(provider?.name).toBe(name)
      expect(typeof provider?.chat).toBe('function')
    }
  })

  it('throws for unknown providers', () => {
    expect(() => createProvider('skynet', settings)).toThrow(/unknown AI_PROVIDER/)
  })
})

describe('parseAiReply', () => {
  it('passes normal replies through', () => {
    expect(parseAiReply('  Our delivery is KES 200. ')).toEqual({
      text: 'Our delivery is KES 200.',
      handoff: false,
    })
  })

  it('detects the handoff token', () => {
    expect(parseAiReply(`${HANDOFF_TOKEN}`)).toEqual({ text: '', handoff: true })
    expect(parseAiReply(`  ${HANDOFF_TOKEN} customer is upset`)).toEqual({
      text: '',
      handoff: true,
    })
  })

  it('does not trigger handoff mid-text', () => {
    expect(parseAiReply(`We never say ${HANDOFF_TOKEN} casually`).handoff).toBe(false)
  })
})
