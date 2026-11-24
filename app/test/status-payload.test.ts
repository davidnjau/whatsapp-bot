import { describe, expect, it } from 'vitest'
import { buildStatusBody, cronForDailyTime } from '../src/modules/status/payload.js'

describe('buildStatusBody', () => {
  it('builds text statuses with color and font', () => {
    expect(
      buildStatusBody({ type: 'text', text: 'Promo!', backgroundColor: '#38b48e', font: 2 }, null),
    ).toEqual({ text: 'Promo!', backgroundColor: '#38b48e', font: 2 })
  })

  it('omits empty optional fields', () => {
    expect(buildStatusBody({ type: 'text', text: 'Hi' }, null)).toEqual({ text: 'Hi' })
  })

  it('builds image statuses with caption', () => {
    const file = { url: 'https://x/pic.jpg', mimetype: 'image/jpeg' }
    expect(buildStatusBody({ type: 'image', file, caption: 'New stock' }, null)).toEqual({
      file,
      caption: 'New stock',
    })
  })

  it('defaults convert to true for video and voice', () => {
    const file = { url: 'https://x/clip.mov' }
    expect(buildStatusBody({ type: 'video', file }, null)).toEqual({ file, convert: true })
    expect(buildStatusBody({ type: 'voice', file }, null)).toEqual({ file, convert: true })
  })

  it('respects an explicit convert: false', () => {
    const file = { url: 'https://x/clip.mp4', mimetype: 'video/mp4' }
    expect(buildStatusBody({ type: 'video', file, convert: false }, null)).toEqual({
      file,
      convert: false,
    })
  })

  it('includes contacts only when an audience is given', () => {
    const contacts = ['254700000001@c.us', '254700000002@c.us']
    expect(buildStatusBody({ type: 'text', text: 'VIP only' }, contacts)).toEqual({
      text: 'VIP only',
      contacts,
    })
    expect(buildStatusBody({ type: 'text', text: 'Everyone' }, [])).toEqual({ text: 'Everyone' })
    expect(buildStatusBody({ type: 'text', text: 'Everyone' }, null)).toEqual({ text: 'Everyone' })
  })
})

describe('cronForDailyTime', () => {
  it('converts HH:MM to a daily cron', () => {
    expect(cronForDailyTime('09:00')).toBe('0 9 * * *')
    expect(cronForDailyTime('18:30')).toBe('30 18 * * *')
    expect(cronForDailyTime('7:05')).toBe('5 7 * * *')
  })

  it('rejects invalid times', () => {
    expect(cronForDailyTime('25:00')).toBeNull()
    expect(cronForDailyTime('09:65')).toBeNull()
    expect(cronForDailyTime('soonish')).toBeNull()
  })
})
