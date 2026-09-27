# Chargerent customer service hub

The customer service hub is the database-first workflow for inquiries submitted on charge.rent. The public website does not email form submissions. It sends each validated submission to a protected Cloud Function, which stores the inquiry and its first message in Firestore. Chargerent administrators review, investigate, draft, and deliberately send replies from the dashboard.

## Inquiry routing

| Website request | Dashboard category |
| --- | --- |
| Customer service / rental charge | Customer support |
| Venue or event | Sales |
| Vending operator | Partnerships |
| Other connected channels | General, or the category supplied by the trusted integration |

The dashboard can filter by category, status, and source, and search names, companies, emails, locations, ticket references, and payment last four. An administrator can also correct a category, set priority and status, assign the inquiry, add internal notes, save a reply draft, or send a reviewed email.

## Charge-concern workflow

1. The public form accepts exactly four card digits. It never accepts or stores a full card number.
2. The dashboard searches rental records for that exact last four and ranks results using the submitted rental date and location.
3. The rental payment/refund state and current kiosk slot state are displayed separately.
4. If no rental matches, the suggested reply asks for the Apple Pay Device Account Number or Google Wallet virtual-card last four and explicitly says not to send full card data.
5. If the charger appears in a kiosk but a refund is not confirmed in the rental record, the reply says the payment is still being reviewed.
6. The reply says a refund was processed only when the rental record has a successful refund state.

Nothing in this workflow initiates a refund. A refund remains a separate payment operation and requires its own approval and confirmation.

## Data model

- `supportTickets/{ticketId}` stores contact information, category, status, source, sanitized form details, assignment, and a compact linked-rental snapshot.
- `supportTickets/{ticketId}/messages/{messageId}` stores the original form message, internal notes, saved drafts, sent replies, imported customer replies, and system activity.
- Firestore client rules allow administrators to read this data. All writes go through authenticated Cloud Functions or a secret-protected intake endpoint.

The website quote ID is reused as the ticket ID, making repeat delivery idempotent.

## Production configuration

Create these Firebase secrets in the `node-red-alerts` project:

- `CONTACT_FORM_WEBHOOK_TOKEN`: a long random token shared only with the website server.
- `SUPPORT_COMMUNICATIONS_WEBHOOK_TOKEN`: a separate token for an email, SMS, or Quo event bridge.

Support email uses keyless Gmail API domain-wide delegation. No support mailbox password or Gmail app password is stored. The delegated mailer has `gmail.send` for reviewed outbound replies and `gmail.readonly` for the dedicated `support@charge.rent` inbox only.

Configure the charge.rent server with:

```text
SUPPORT_INTAKE_URL=https://us-central1-node-red-alerts.cloudfunctions.net/support_publicIntake
SUPPORT_INTAKE_TOKEN=<same value as CONTACT_FORM_WEBHOOK_TOKEN>
```

Deploy the Cloud Functions and Firestore rules before switching the website to the new intake URL. Then submit one test inquiry for each website request type and verify the category, message, timestamps, and contact details in the dashboard before enabling public traffic.

## Dedicated mailbox

Use `support@charge.rent` as a licensed Google Workspace user mailbox, not an individual's mailbox. Delegate access to approved support staff, require multi-factor authentication, disable catch-all behavior, and preserve retention/audit settings. The dashboard is the operational queue; the mailbox is the delivery identity and fallback record of sent/replied email.

The current implementation sends only after a dashboard administrator confirms the send dialog. It includes the ticket token in the subject so customer replies can be attached to the correct ticket.

Inbound replies arrive through Gmail push notifications and a periodic reconciliation. Matching priority is ticket token, Gmail thread ID, then one unambiguous open case for the sender. Messages that still look like replies but cannot be matched safely become visible email tickets marked `Needs case match`; they are never silently attached to a guessed case.

## Inbound email, SMS, and Quo bridge

`support_publicMessageEvent` is the normalized inbound endpoint. A trusted bridge can POST an event with the bearer token from `SUPPORT_COMMUNICATIONS_WEBHOOK_TOKEN`:

```json
{
  "ticketId": "Q-example",
  "source": "email",
  "messageId": "provider-message-id",
  "from": "customer@example.com",
  "to": "support@charge.rent",
  "subject": "Re: Rental question [Q-example]",
  "body": "Customer reply text",
  "receivedAt": "2026-09-23T12:00:00.000Z"
}
```

Allowed sources are `email`, `sms`, `phone`, `quo`, `website`, and `manual`. Provider message IDs are deduplicated. A future Quo replacement should reuse this ticket and message model rather than creating a second customer database. Call recordings, consent, number porting, and telephony routing are intentionally outside this first release.

## Local verification

```bash
npm run test:customer-support
npm run build
cd functions && npx eslint supportTickets.js supportTickets.test.js
```

The charge.rent project should also pass `npm run lint` and `npm run build` after the intake environment variables are configured.
