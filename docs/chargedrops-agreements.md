# ChargeDrops electronic agreements

## Purpose

ChargeDrops clients sign the existing ChargeRent revenue-share client agreement
inside the branded Client Portal. Regional partners continue using the standard
Chargerent dashboard and cannot prepare or sign a client's agreement.

The canonical server template is
`functions/chargeRentClientAgreementTemplate.js`. It preserves the English
revenue-share agreement content currently used by `src/pages/AgreementPage.jsx`
and is explicitly versioned as `V.10.07.2026`. The generated first page is
filled from the client profile and the administrator's confirmed agreement
details:

- legal business name;
- venue and installation address;
- contact name, phone, and email;
- agreement/start date;
- assets deployed;
- revenue-share percentage and payment schedule; and
- standard ChargeDrops pricing of USD 3 per hour and a non-return fee of up to
  USD 35 if the charger is not returned. There is no 72-hour condition.

The agreement and electronic-signature certificates use the official
ChargeDrops logo. The signer name appears without the legacy `/s/` notation;
the audit certificate and recorded consent continue to identify it as an
electronic signature.

Changing the template requires a new version. Previously generated and signed
PDFs are immutable snapshots and must never be regenerated under a newer
version.

## Workflow

1. An administrator creates the ChargeDrops client and Coming soon venue.
2. From **ChargeDrops Client Setup**, the administrator confirms the legal
   business name, start date, and exact assets deployed.
3. `admin_prepareChargeDropsAgreement` generates the versioned PDF, records its
   SHA-256 hash, stores it privately, and emails the client that it is ready.
4. The authenticated client opens the complete PDF in the ChargeDrops portal,
   supplies their legal name and title, and makes three explicit confirmations:
   document reviewed, electronic-record consent, and intent to sign.
5. `chargedrops_requestAgreementCode` sends a six-digit code to the email on the
   client profile. Only an HMAC hash of the code is stored. Codes expire after
   ten minutes, cannot be resent for one minute, and lock after five failed
   attempts.
6. `chargedrops_signAgreement` verifies the code and source hash, appends the
   client's electronic-signature certificate, records the signed PDF hash and
   audit evidence, and emails the client-signed PDF to the client and assigned
   admin. The agreement moves to `client_signed`; payout setup remains locked.
7. An authenticated administrator reviews the client-signed PDF, enters the
   authorized Ocharge signer name and title, and explicitly confirms review and
   intent to countersign. `admin_countersignChargeDropsAgreement` appends the
   Ocharge countersignature certificate and creates an immutable executed PDF.
8. Only `chargedrops.onboarding.agreementStatus = fully_executed` unlocks Stripe
   Connect payout onboarding. Both the client and regional partner receive a
   status notification after countersignature.

## Client payout controls

- ChargeDrops client revenue is frozen per report as gross rental revenue minus
  completed refunds and sales tax. Processing fees are not deducted.
- Each report stores gross revenue, refunds, taxes, qualifying revenue, client
  share, currency, and the calculation version used.
- Every client payout starts as `pending_approval`. Approving it is an explicit
  administrator action and creates one idempotent Stripe Transfer; an email by
  itself never marks the payout as transferred or paid.
- The live Stripe key must resolve to Ocharge LLC account
  `acct_1BGtrxCUzeellHd0`, the same platform account used by EventCharging.
- A transfer is blocked unless the agreement is fully executed, the client's
  live Stripe recipient account is ready, the report is USD, and the Ocharge
  platform has sufficient available USD balance.
- The Chase account is the external Ocharge bank account. Where Stripe top-ups
  are enabled, Chase can fund the Ocharge Stripe balance; the transfer itself is
  still made from Stripe's available platform balance. No automatic bank debit
  or top-up is performed by this application.
- Regional-partner transfers remain outside this client payout action. This is
  intentional while the Canadian Stripe platform is deferred.

## Protected records

The following Firestore collections are denied to browser clients and are
accessible only through authenticated Cloud Functions:

- `chargeDropsAgreements` and its `events` subcollections;
- `chargeDropsAgreementChallenges`.

Source, client-signed, and fully executed PDFs use private Cloud Storage paths under
`chargedrops/agreements/{uid}/{agreementId}/`. The portal receives a read-only
URL that expires after 15 minutes. No raw verification code, bank account,
routing number, or Stripe secret is stored with the agreement.

The audit trail records the authenticated user, agreement/template version,
source and signed document hashes, server time, signer name/title/email,
authentication method, IP address, browser user agent, and consent state.

Client kiosk, rental, and revenue reads are scoped through immutable Auth claims.
The server-maintained `kioskAccess/{stationId}` projection connects a public
station ID to its owning client and regional partner even when the underlying
kiosk document uses a different provisioning ID. Browser clients cannot read or
write that projection directly. The `kiosks_syncAccessScope` function maintains
it when kiosk ownership changes, and `npm run backfill:kiosk-access -- --apply`
rebuilds it for existing kiosks.

## Production configuration

Before deploying, create a strong random Firebase secret with at least 32
characters:

```sh
npx --yes firebase-tools functions:secrets:set CHARGEDROPS_AGREEMENT_OTP_SECRET --project node-red-alerts
```

The existing `GMAIL_APP_PASSWORD` secret is also required for agreement-ready,
verification-code, and completion emails. Do not place either value in source,
Firestore, browser environment variables, or the Android application.

Deploy the functions, Firestore rules, and web application only after the
agreement wording, template version, consent text, sender identity, retention
requirements, and permitted signing jurisdictions have been reviewed and
approved for production use.
