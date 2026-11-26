// Send kinds that must go out even to opted-out contacts: opt-out/opt-in
// confirmations (required to confirm the choice) and alerts to staff numbers.
// Everything else — notifications included — is blocked for opted-out contacts.
// 'stylist' is a paid reply; 'login' codes and 'loyalty' rewards are requested
// transactional messages — all always go out.
export const OPTOUT_EXEMPT_KINDS = new Set([
  'optout_confirm',
  'optin_confirm',
  'alert',
  'stylist',
  'login',
  'loyalty',
  // Admin deliberately messaging a customer about their own order — transactional.
  'order_message',
])
