import { describe, expect, it } from 'vitest'
import { OPTOUT_EXEMPT_KINDS } from '../src/queue/policy.js'

// The send worker is the single enforcement point for opt-outs: any kind not
// in the exempt set is skipped for opted-out contacts. Notifications must
// never be exempt.
describe('opt-out enforcement (send layer)', () => {
  it('notifications are NOT exempt from opt-out checks', () => {
    expect(OPTOUT_EXEMPT_KINDS.has('notification')).toBe(false)
  })

  it('opt-out/opt-in confirmations and staff alerts are exempt', () => {
    expect(OPTOUT_EXEMPT_KINDS.has('optout_confirm')).toBe(true)
    expect(OPTOUT_EXEMPT_KINDS.has('optin_confirm')).toBe(true)
    expect(OPTOUT_EXEMPT_KINDS.has('alert')).toBe(true)
  })
})
