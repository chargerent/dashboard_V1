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
- `supportCallLogs/{callId}` stores the canonical inbound and outbound call summary, outcome, duration, staff identity, linked ticket, and callback request state.
- Firestore client rules allow administrators to read this data. All writes go through authenticated Cloud Functions or a secret-protected intake endpoint.

The website quote ID is reused as the ticket ID, making repeat delivery idempotent.

## Production configuration

Create these Firebase secrets in the `node-red-alerts` project:

- `CONTACT_FORM_WEBHOOK_TOKEN`: a long random token shared only with the website server.
- `SUPPORT_COMMUNICATIONS_WEBHOOK_TOKEN`: a separate token for an email, SMS, or Quo event bridge.

Support email uses keyless Gmail API domain-wide delegation. No mailbox password or Gmail app password is stored. The delegated mailer has `gmail.send` for reviewed outbound replies and `gmail.readonly` for inbound synchronization. It reads the dedicated `support@charge.rent` inbox and checks George's inbox metadata for messages addressed to `sales@charge.rent`; non-sales message bodies in George's inbox are not fetched or stored.

Configure the charge.rent server with:

```text
SUPPORT_INTAKE_URL=https://us-central1-node-red-alerts.cloudfunctions.net/support_publicIntake
SUPPORT_INTAKE_TOKEN=<same value as CONTACT_FORM_WEBHOOK_TOKEN>
```

Deploy the Cloud Functions and Firestore rules before switching the website to the new intake URL. Then submit one test inquiry for each website request type and verify the category, message, timestamps, and contact details in the dashboard before enabling public traffic.

## Dedicated mailbox

Use `support@charge.rent` as a licensed Google Workspace user mailbox, not an individual's mailbox. Delegate access to approved support staff, require multi-factor authentication, disable catch-all behavior, and preserve retention/audit settings. The dashboard is the operational queue; the mailbox is the delivery identity and fallback record of sent/replied email.

The current implementation sends only after a dashboard administrator confirms the send dialog. Response subjects do not expose the internal case number. Gmail thread IDs attach customer replies to the correct case, while legacy ticket tokens remain supported for older conversations.

Inbound replies arrive through Gmail push notifications and a periodic reconciliation. Matching priority is ticket token, Gmail thread ID, then one unambiguous open case for the sender. Messages that still look like replies but cannot be matched safely become visible email tickets marked `Needs case match`; they are never silently attached to a guessed case.

Free-form messages addressed to `sales@charge.rent` are imported from George's mailbox as Sales cases. The sender, subject, and plain-text email body become the contact, case subject, and first activity. Newsletter/list mail, automated replies, drafts, sent mail, Spam, Trash, and legacy website-form notification emails are excluded. The importer uses recipient headers as a deterministic routing rule; it does not require a form or an AI classification step.

## Inbound email and normalized channel bridge

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

Allowed sources are `email`, `sms`, `phone`, `quo`, `website`, and `manual`. Provider message IDs are deduplicated. The Twilio integration below reuses this ticket and message model rather than creating a second customer database.

## Twilio voice and SMS

The test support number is `+1 917 993 9355`. Its signed Twilio webhooks terminate at:

- `support_twilioSms` for inbound text messages and outbound delivery callbacks.
- `support_twilioVoice` for incoming calls, call screening, hunt-group routing, callback requests, and text-support instructions.

Inbound calls create a call-specific case. Texts create or reopen one customer-support conversation per customer phone number and called support line. Administrators can answer by SMS from the same dashboard reply editor; sending still requires the review dialog.

Every active dashboard account whose role is `admin` or `partner` is automatically eligible to sign in to the Chargerent Support app with the same dashboard username and password. App availability and optional primary/backup overrides are stored in `supportTelephonyStaff`; a separate support-only user account is not required. Enabled, available members in the primary group ring simultaneously, followed by the backup group.

Administrators can see activity for every support line. Partners are restricted server-side to the E.164 numbers in their `users/{uid}.supportPhoneNumbers` subscription, which is edited on the dashboard account card. That scope applies to inbound routing, call logs, call cases, rental matching, text conversation lists, message threads, and outbound replies. A partner with no assigned support number can sign in but sees no customer activity and receives no routed calls. New SMS/RCS conversations are keyed by both customer number and support line so activity for two subscribed businesses cannot be combined into one case.

Administrators manage manual routing overrides and personal-phone fallback from **Customer Service → Call routing** without changing code. Staff can be moved between groups, reordered, or disabled; routing records are not deleted so changes remain auditable.

Every inbound call and staff-app outbound call is written to `supportCallLogs` and linked to the customer's phone conversation. **Customer Service → Call log** shows the latest 100 calls, including direction, outcome, duration, answering staff member, and callback state. Opening a row selects the linked case. Authenticated staff assigned to app calling can also read a sanitized recent-call list from the iPhone app; the shared backend remains canonical.

If neither routing group answers, Twilio asks the caller to press 1 for a callback at the number they called from and explains that they can text the support number to chat with a representative. Pressing 1 reopens the phone conversation as an unread, high-priority callback case and records the choice in the call log. No new phone number is collected by voice. Any other key or no selection repeats the text-support instruction and ends the call; voicemail is not offered or recorded.

Administrators can replace the spoken call prompts from **Customer Service → Call routing → MP3 voice prompts**. The supported slots are staff screening, connecting, callback-or-text options, callback confirmation, and the text-support reminder. Each upload must be an MP3 no larger than 8 MB. The audio is stored privately and exposed to Twilio through the prompt-specific media endpoint; if metadata, storage, or playback is unavailable, the call flow automatically uses its built-in spoken text instead.

Create these Firebase secrets before deploying the telephony functions:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SUPPORT_NUMBER` set to the E.164 support number

After deploying the functions and Firestore rules, add the first primary routing member in the dashboard, then change the Twilio number's incoming-message and incoming-call POST webhooks to the two endpoints above. Do not replace a working legacy webhook until both new endpoints are deployed and the initial routing member is visible.

For the first live test, add George at `+1 818 996 0996` to the primary group. Send a text to the support number and confirm the new case and SMS reply. Then call the support number and separately test an answered call, callback request, text-support instruction, and no-input timeout. A successful webhook or Twilio call status proves provider delivery only; verify the dashboard case, call-log entry, callback phone, and actual handset result as separate checks.

## Local verification

```bash
npm run test:customer-support
npm run build
cd functions && npx eslint supportTickets.js supportTickets.test.js supportTelephony.js supportTelephony.test.js supportVoicePrompts.js supportVoicePrompts.test.js
```

The charge.rent project should also pass `npm run lint` and `npm run build` after the intake environment variables are configured.
