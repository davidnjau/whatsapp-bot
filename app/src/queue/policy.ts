// Send kinds that must go out even to opted-out contacts: opt-out/opt-in
// confirmations (required to confirm the choice) and alerts to staff numbers.
// Everything else — notifications included — is blocked for opted-out contacts.
// 'stylist' is a paid, customer-requested reply, so it always goes out.
export const OPTOUT_EXEMPT_KINDS = new Set(['optout_confirm', 'optin_confirm', 'alert', 'stylist'])
