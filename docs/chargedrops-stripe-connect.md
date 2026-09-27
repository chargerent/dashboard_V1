# ChargeDrops Stripe Connect payout onboarding

## Security boundary

ChargeDrops clients enter bank and identity information only on Stripe-hosted
Connect pages. The Client Dashboard stores the connected-account identifier and
readiness/status metadata, but it never requests or stores a routing number,
account number, bank-login credential, or Stripe secret.

The Android Stripe Terminal integration follows the same server-owned pattern:

- The Android app contains a kiosk-scoped installation bearer token, not a
  Stripe API key.
- The app exchanges that token with `kioskTerminalApi` for a short-lived Stripe
  Terminal connection token and a server-created PaymentIntent client secret.
- `STRIPE_TEST_SECRET_KEY` stays in Firebase Secret Manager and currently
  supports only the Terminal test path.
- Terminal capture occurs only after the backend observes the physical vend.

ChargeDrops payout onboarding intentionally uses a separate Firebase secret,
`STRIPE_CONNECT_SECRET_KEY`. This prevents the test Terminal credential from
silently becoming a production payout credential. The server detects whether
the configured Connect key is test or live mode and stores separate connected
account references for each mode.

## Client flow

1. A ChargeDrops client signs in to the branded portal.
2. `chargedrops_stripeStatus` reads the client's own Stripe Connect readiness.
3. **Set up commission payouts** calls
   `chargedrops_stripeOnboardingLink`.
4. The server creates or reuses an idempotent Accounts v2 recipient with the
   Express Dashboard and requests the `stripe_transfers` capability.
5. The client is redirected to a single-use `connect.stripe.com` Account Link.
6. Stripe collects identity, tax, and external payout-account details.
7. On return, the portal retrieves the recipient transfer/payout capabilities
   and outstanding requirements, then updates the client profile.

An account is marked complete only when the recipient configuration is applied,
both transfers and payouts are active, and Stripe reports no user-action
requirements that are currently due or past due.

## Stripe event destination

Accounts v2 emits thin events rather than embedding a complete account snapshot
in every webhook. The Stripe event destination sends managed-account events to
`chargedrops_stripeWebhook` from `@accounts`. The function verifies the Stripe
signature, retrieves the current versioned Account object with the recipient and
requirements fields included, and then updates Firestore. It also handles the
Account Link return event and safely acknowledges destination pings.

## Production configuration

Before deploying these functions:

1. Enable Stripe Connect for the Chargerent/ChargeDrops Stripe platform.
2. Store the intended platform secret securely as the Firebase secret
   `STRIPE_CONNECT_SECRET_KEY`. Never place it in Android, React source,
   Firestore, a shell transcript, or this repository.
3. Confirm the platform country supports the countries used by ChargeDrops
   venues. Stripe can reject cross-border transfers even when connected-account
   onboarding succeeds.
4. Create a thin-payload Accounts v2 event destination for managed accounts,
   store its signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`, and deploy the
   two callable functions plus the webhook before deploying the portal.
5. Complete one test-mode connected-account lifecycle and confirm that the
   profile contains only provider IDs and readiness metadata.
6. Repeat with the approved live key and a controlled real venue before opening
   onboarding broadly.

The Express configuration sets `fees_collector` and `losses_collector` to the
platform application, as Stripe requires. That makes the platform responsible
for Stripe fees and negative balances on these connected accounts. The sandbox
uses this configuration only for testing; live activation requires an explicit
business and risk approval.

## Deliberate payout boundary

This integration completes secure payout-account collection and readiness. It
does not automatically move commission funds yet. Current payout reports do not
carry a verified per-report currency or source-charge ledger, so creating Stripe
Transfers from those reports could send the wrong currency or exceed the
platform's available balance. Add currency/source reconciliation and an
admin-confirmed, idempotent transfer workflow before enabling money movement.
