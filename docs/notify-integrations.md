# Sending notifications from other systems

Every integration is the same HTTP call: `POST /notify` with your `ADMIN_API_TOKEN`
as a Bearer token. Replace `https://bot.example.com` with your `APP_BASE_URL`
(or `http://localhost:8080` while testing locally).

Messages go through the shared send queue (rate-limited, opt-out enforced).
Contacts who sent STOP are skipped automatically and logged as `skipped_optout`.

## curl

```bash
# Send now
curl -X POST https://bot.example.com/notify \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "0712345678",
    "template": "order_confirmed",
    "variables": { "name": "Alice", "order_id": "A-1042", "total": "KES 2,500" }
  }'

# Schedule for later (ISO timestamp)
curl -X POST https://bot.example.com/notify \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "0712345678",
    "template": "out_for_delivery",
    "variables": { "name": "Alice", "order_id": "A-1042", "eta": "today by 5pm" },
    "sendAt": "2026-11-26T09:00:00+03:00"
  }'

# With an attachment (e.g. a receipt PDF)
curl -X POST https://bot.example.com/notify \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "0712345678",
    "template": "payment_received",
    "variables": { "name": "Alice", "amount": "KES 2,500", "reference": "A-1042" },
    "attachment": { "url": "https://example.com/receipts/A-1042.pdf", "mimetype": "application/pdf", "filename": "receipt.pdf" }
  }'

# Appointment: automatically schedules reminders 24h and 1h before
curl -X POST https://bot.example.com/notify/appointment \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "0712345678",
    "variables": { "name": "Alice", "date": "Fri 28 Nov", "time": "10:00" },
    "appointmentAt": "2026-11-28T10:00:00+03:00"
  }'
```

## From a website backend (Node.js example)

```js
await fetch("https://bot.example.com/notify", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    phone: order.customerPhone,
    template: "order_confirmed",
    variables: { name: order.customerName, order_id: order.id, total: order.total },
  }),
});
```

Call it from your order-created / payment-received handler. Never expose
`ADMIN_API_TOKEN` in frontend code — the call must come from your server.

## Google Sheets (Apps Script)

Sheet columns: `A=phone, B=name, C=order_id, D=total, E=status`. In the Sheet:
Extensions → Apps Script, paste this, set the two constants, then run
`sendConfirmations` (or add a trigger/menu):

```javascript
const BOT_URL = "https://bot.example.com";
const API_TOKEN = "your-admin-api-token"; // store in Script Properties for real use

function sendConfirmations() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [phone, name, orderId, total, status] = rows[i];
    if (!phone || status === "sent") continue;
    const response = UrlFetchApp.fetch(`${BOT_URL}/notify`, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      payload: JSON.stringify({
        phone: String(phone),
        template: "order_confirmed",
        variables: { name, order_id: orderId, total },
      }),
      muteHttpExceptions: true,
    });
    sheet.getRange(i + 1, 5).setValue(response.getResponseCode() === 200 ? "sent" : "error");
  }
}
```

## n8n

1. Add an **HTTP Request** node where you want to send the message.
2. Method `POST`, URL `https://bot.example.com/notify`.
3. Authentication → Generic → **Header Auth**: name `Authorization`,
   value `Bearer <ADMIN_API_TOKEN>` (store it as an n8n credential).
4. Body content type JSON:

```json
{
  "phone": "={{ $json.phone }}",
  "template": "order_confirmed",
  "variables": {
    "name": "={{ $json.name }}",
    "order_id": "={{ $json.orderId }}",
    "total": "={{ $json.total }}"
  }
}
```

A non-200 response has `{ "error": "..." }` in the body — route it to your
error branch.
