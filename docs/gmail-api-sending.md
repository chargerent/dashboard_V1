# Gmail API email for Customer Support

Customer Support replies use the Gmail API with keyless Google Workspace domain-wide delegation. They do not use mailbox passwords or Gmail app passwords.

## Google Cloud resources

- Project: `node-red-alerts`
- Gmail API: enabled
- Delegated service account: `chargerent-dashboard-mailer@node-red-alerts.iam.gserviceaccount.com`
- OAuth client ID: `103678059456185721425`
- Authorized scopes:
  - `https://www.googleapis.com/auth/gmail.send`
  - `https://www.googleapis.com/auth/gmail.readonly`
- Functions runtime identity: `176963151151-compute@developer.gserviceaccount.com`
- Signing role: `projects/node-red-alerts/roles/workspaceMailboxJwtSigner`

The signing role is granted on the mailer service account, not at project level. No service-account key is downloaded. The function obtains its normal Cloud access token, calls IAM `signJwt`, exchanges the signed assertion for a one-hour delegated Gmail token, and calls `users.messages.send` as the selected mailbox.

Inbox access is hard-coded to `support@charge.rent`. Gmail publishes inbox changes to the `chargerent-support-gmail` Pub/Sub topic. The backend reads changes using Gmail history, imports customer messages into the matching ticket, and keeps a Firestore history cursor in `supportMailboxSync/support-at-charge-rent`. A 15-minute scheduled reconciliation covers delayed or dropped notifications, and a daily job renews the Gmail watch.

## Sender boundary

The Customer Support backend accepts only these sender keys:

- Customer support: `support@charge.rent`
- Sales and partnership: `george@charge.rent` or `arthur@charge.rent`

The Workspace delegation scope is domain-wide, so the application whitelist is a required second boundary. Do not accept an arbitrary sender email from a browser request.

George and Arthur remain available as visible senders for sales and partnership replies, but their messages use `support@charge.rent` as Reply-To. This keeps inbound synchronization confined to the dedicated support mailbox.

## Deployment

Deploy both callable and HTTP variants retained by the dashboard:

```bash
firebase deploy --project node-red-alerts --only \
functions:support_addNote,functions:support_httpAddNote,\
functions:support_saveDraft,functions:support_httpSaveDraft,\
functions:support_sendReply,functions:support_httpSendReply,\
functions:support_publicMessageEvent,functions:support_gmailInboxChanged,\
functions:support_gmailWatchRenewal,functions:support_gmailInboxReconcile,\
functions:support_syncGmailInbox,functions:support_renewGmailWatch
```

The send functions do not bind `SUPPORT_GMAIL_APP_PASSWORD`, `GEORGE_GMAIL_APP_PASSWORD`, or `ARTHUR_GMAIL_APP_PASSWORD`.

## Verification

1. Run `node --test gmailApiSender.test.js gmailSupportInbox.test.js supportTickets.test.js` from `functions/`.
2. Send one clearly labeled internal test through a temporary support ticket addressed to an approved internal recipient.
3. Confirm Gmail accepted the message and returned a message ID.
4. Confirm the ticket activity changes from `sending` to `sent` and the ticket becomes `waiting_customer`.
5. Remove the exact temporary test ticket after verification.
6. Reply to the test message and confirm the inbound reply appears once in the same ticket activity.

Do not use a customer ticket for delivery testing and do not automatically retry an uncertain send.
