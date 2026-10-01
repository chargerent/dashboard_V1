# Chargerent chatbot support integration

## Instructions for the chatbot/server partner

Send actionable chatbot support cases to Chargerent using a server-to-server HTTPS request. Do not publish customer conversations to the kiosk MQTT broker, and do not call this endpoint directly from browser JavaScript.

### Endpoint

```text
POST https://us-central1-node-red-alerts.cloudfunctions.net/support_chatbotEvent
Authorization: Bearer <token supplied securely by Chargerent>
Content-Type: application/json
```

The bearer token must be stored as a server-side environment secret. Do not commit it to source control, include it in logs, place it in a URL, or expose it to the chatbot frontend.

The endpoint is live. Chargerent supplies the token separately through a secure password-sharing channel.

### When to send a case

Create or update a Chargerent case when any of these occurs:

- The customer asks for a human.
- The chatbot cannot resolve the question confidently.
- The question concerns a rental charge, refund, return, missing charger, or payment.
- The customer has a sales, event, venue, or partnership request that needs follow-up.

Do not create a case for greetings, successfully answered FAQs, spam, health checks, or internal test traffic unless the test uses an agreed test marker.

After a case is created, send later customer messages from the same conversation using the same `provider` and `conversationId`, with a new `messageId` for every message. Send customer messages only; do not send the chatbot's own routine replies as new support messages.

### Disney chatbot form submitted by Arthur's server

Arthur's current snake_case submission can be posted directly to the same endpoint. Chargerent converts it into a Customer Support case, uses `session_id` as the stable conversation identifier, stores `reason_detail` as the inbound customer message, and deduplicates retries of the same session. If `reason_detail` is empty, the readable reason label becomes the message.

| Field | Type | Rule |
|---|---|---|
| `reason` | string | `no_unit_dispensed`, `faulty_powerbank`, `charged_30_returned`, `double_charge`, `wrong_amount`, or `other` |
| `station_id` | string | One of the station IDs below, or `unknown` |
| `payment_method` | string | `physical_card`, `apple_pay`, or `google_pay` |
| `card_last4` | string | Exactly four digits; never send a full card number |
| `amount_requested` | number | `5`, `10`, or `30`; stored as EUR |
| `guest_email` | string or null | A valid email address when present |
| `reason_detail` | string | Optional explanation; accepted for every reason |
| `language` | string | `en`, `fr`, `es`, `de`, `it`, `pt`, `nl`, `ru`, `zh`, `ja`, `ar`, or `pl` |
| `session_id` | string | Stable for the submission; reuse it when retrying |
| `submitted_at` | string | ISO-8601 timestamp in UTC |
| `rental_date` | string | Optional `YYYY-MM-DD`; when omitted, Chargerent uses the UTC date from `submitted_at` for rental matching |

Accepted station IDs are `S01`, `S02`, `S03`, `S04`, `S05`, `S06`, `S07`, `S08`, `S10`, `S20`, `S21`, `S22`, `S23`, `S24`, `S25`, `S26`, `S27`, `S30`, and `unknown`. The receiver maps these IDs to their agreed Disney location names for display.

Example:

```json
{
  "reason": "faulty_powerbank",
  "station_id": "S07",
  "payment_method": "physical_card",
  "card_last4": "4521",
  "amount_requested": 10,
  "guest_email": "guest@example.com",
  "reason_detail": "The cable was broken",
  "language": "fr",
  "session_id": "sess_1727385600000_x4k2p9a",
  "submitted_at": "2026-09-27T14:32:00.000Z",
  "rental_date": "2026-09-26"
}
```

If `rental_date` is omitted, the dashboard uses the UTC calendar date from `submitted_at` and shows matching rentals within three days on either side of that date.

### JSON contract

Required fields:

| Field | Type | Rule |
|---|---|---|
| `provider` | string | Stable name for the chatbot service. Recommended even though the receiver defaults to `chatbot`. |
| `conversationId` | string | Stable for the full conversation. Maximum 500 characters. |
| `messageId` | string | Globally stable for this message. Never generate a new value when retrying the same message. |
| `message` | string | The customer's question or latest customer message. Maximum 12,000 characters. |

Recommended fields:

| Field | Type | Rule |
|---|---|---|
| `schemaVersion` | number | Send `1`. |
| `eventType` | string | Use `human_handoff_requested` for the initial escalation and `message.created` for later customer messages. |
| `occurredAt` | string | ISO-8601 timestamp in UTC. |
| `intent` | string | See the intent mapping below. |
| `category` | string | Optional override: `customer_support`, `sales`, `partnership`, or `general`. |
| `subject` | string | Optional readable case subject. The receiver creates one when omitted. |
| `customer` | object | Known name, email, phone, company, role, and locale. |
| `rental` | object | Known rental location, date, and card last four. |
| `handoffReason` | string | Short reason the chatbot escalated the conversation. |
| `pageUrl` | string | Page where the conversation started. |
| `confidence` | number | A value from `0` to `1` when available. |

Supported intent mapping:

- `charge_concern`, `refund`, `return`, `rental`, `payment`, `charger`, or `customer_support` → Customer support
- `event`, `venue`, `quote`, `pricing`, `purchase`, or `sales` → Sales
- `partnership`, `partner`, `distributor`, `reseller`, or `vending` → Partnership
- Anything else → Inferred from the subject/message, then General if no match is found

### Example initial escalation

```json
{
  "schemaVersion": 1,
  "provider": "partner-chatbot",
  "conversationId": "conv_01JQABC123",
  "messageId": "msg_01JQABC456",
  "eventType": "human_handoff_requested",
  "occurredAt": "2026-09-24T16:30:00.000Z",
  "intent": "charge_concern",
  "customer": {
    "name": "Camille Client",
    "email": "camille@example.com",
    "phone": "+1 555 0100",
    "locale": "fr"
  },
  "rental": {
    "location": "Paris Gare du Nord",
    "date": "2026-09-23",
    "cardLastFour": "2577"
  },
  "message": "J’ai rendu la batterie, mais je vois toujours un débit.",
  "handoffReason": "Customer requested help with a charge after return.",
  "pageUrl": "https://charge.rent/fr/support",
  "confidence": 0.42
}
```

### Example later customer message

```json
{
  "schemaVersion": 1,
  "provider": "partner-chatbot",
  "conversationId": "conv_01JQABC123",
  "messageId": "msg_01JQABC789",
  "eventType": "message.created",
  "occurredAt": "2026-09-24T16:34:00.000Z",
  "message": "The rental was at approximately 8:30 PM."
}
```

The same `provider` and `conversationId` append this message to the existing case. The new `messageId` prevents duplicate activity entries.

### Card-data requirement

Only send exactly the final four digits in `rental.cardLastFour`. Never send the full card number, expiration date, security code, wallet cryptogram, or payment credentials. The receiver rejects values that are not exactly four digits.

### Responses and retries

Successful new case:

```json
{
  "ok": true,
  "ticketId": "CHAT-...",
  "displayTicketNumber": "CS-...",
  "duplicate": false,
  "created": true
}
```

Successful message appended to an existing case returns `created: false`. A retried message with the same `messageId` returns `duplicate: true` and must be treated as successfully delivered.

Retry behavior:

- `200`: Accepted, including `duplicate: true`. Stop retrying.
- `400`: Invalid payload. Do not retry unchanged data; record the failure for review.
- `401`: Missing or incorrect token. Stop and alert the integration owner.
- `405`: Incorrect HTTP method. Use `POST`.
- `500` or network timeout: Retry with exponential backoff and jitter.

Recommended retry delays are approximately 5 seconds, 30 seconds, 2 minutes, 10 minutes, and 30 minutes. Keep the existing JSON record as an outbox until a `200` response is received.

### Node.js example

```js
const response = await fetch(process.env.CHARGERENT_SUPPORT_WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.CHARGERENT_SUPPORT_WEBHOOK_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(event),
  signal: AbortSignal.timeout(15000),
});

const result = await response.json();
if (!response.ok) {
  throw new Error(`Chargerent support intake failed with HTTP ${response.status}`);
}
```

Log the HTTP status, `ticketId`, `duplicate`, and the partner's own `messageId`. Do not log the bearer token or unredacted payment/customer data.

## Chargerent deployment and token-rotation checklist

These steps are performed by Chargerent, not by the chatbot partner:

1. Create a strong dedicated secret without putting it in chat or source control:

   ```bash
   firebase functions:secrets:set CHATBOT_SUPPORT_WEBHOOK_TOKEN --project node-red-alerts
   ```

2. Deploy only the chatbot receiver:

   ```bash
   firebase deploy --only functions:support_chatbotEvent --project node-red-alerts
   ```

3. Verify the deployed endpoint URL and perform one synthetic test using a non-customer test conversation.
4. Confirm that exactly one Chatbot case appears in Customer Service and that retrying the same `messageId` does not add a second activity entry.
5. Share the endpoint and token with the partner through an approved password manager or another secure secret-sharing channel.
6. After partner validation, backfill existing JSON records in chronological order while preserving their original conversation and message identifiers.
