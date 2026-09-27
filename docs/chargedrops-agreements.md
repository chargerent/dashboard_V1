# ChargeDrops electronic agreements

## Purpose

ChargeDrops clients sign the existing ChargeRent revenue-share client agreement
inside the branded Client Portal. Regional partners continue using the standard
Chargerent dashboard and cannot prepare or sign a client's agreement.

The canonical server template is
`functions/chargeRentClientAgreementTemplate.js`. It preserves the English
revenue-share agreement content currently used by `src/pages/AgreementPage.jsx`
and is explicitly versioned as `V.11.01.2024`. The generated first page is
filled from the client profile and the administrator's confirmed agreement
details:

- legal business name;
- venue and installation address;
- contact name, phone, and email;
- agreement/start date;
- assets deployed;
- revenue-share percentage and payment schedule; and
- standard ChargeDrops pricing of USD 3 per hour and USD 35 after 72 hours.

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
   admin. The existing Ocharge LLC signature line remains available for the
   company's authorized countersignature process.
7. Stripe Connect payout onboarding remains locked until
   `chargedrops.onboarding.agreementStatus` is `signed`.

## Protected records

The following Firestore collections are denied to browser clients and are
accessible only through authenticated Cloud Functions:

- `chargeDropsAgreements` and its `events` subcollections;
- `chargeDropsAgreementChallenges`.

Source and signed PDFs use private Cloud Storage paths under
`chargedrops/agreements/{uid}/{agreementId}/`. The portal receives a read-only
URL that expires after 15 minutes. No raw verification code, bank account,
routing number, or Stripe secret is stored with the agreement.

The audit trail records the authenticated user, agreement/template version,
source and signed document hashes, server time, signer name/title/email,
authentication method, IP address, browser user agent, and consent state.

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
