# Canadian regional partner onboarding

## Implemented flow

1. A Chargerent administrator opens **Regional Partner Onboarding** and creates
   an invitation for a Canadian territory, selecting **Company or organization**
   or **Individual** as the partner type.
2. The backend creates a disabled partner Auth account and inactive dashboard
   profile. No password or login credentials are sent at this stage.
3. The contact receives a 30-day one-time onboarding link. Firestore stores only
   its SHA-256 hash.
4. A company enters its legal business and authorized-signer information. An
   individual enters their legal name, address, and telephone and signs for
   themselves.
5. The backend freezes those values into the Chargerent Inc Canadian Regional
   Representative Agreement. The English agreement uses CAD, Ontario law, and a
   40% partner-controlled revenue-share pool.
6. The partner reviews the complete PDF and signs with an emailed six-digit code.
   The agreement snapshot and signature evidence preserve the selected partner
   type.
7. An administrator reviews the signed agreement and approves activation. The
   account is enabled and a Firebase password-setup link is sent.

Quebec invitations are deliberately blocked until the French agreement and
Quebec-specific legal review are approved.

The administrator form defaults to **Test invitation**. Production invitations
are enabled in the deployed service and require the administrator to clear the
test checkbox deliberately. Test invitations are identified in the portal and
notification emails, but the agreement PDF does not contain a draft watermark
or first-page legal-review disclaimer. Signed agreements receive a
Chargerent-branded Canadian electronic-signature certificate.

## Required secrets

The existing `GMAIL_APP_PASSWORD` and
`CHARGEDROPS_AGREEMENT_OTP_SECRET` secrets are used for notification and
signature verification. No Canadian Stripe secrets or account are required for
the current onboarding flow.

## Production invitation control

The administrator form defaults to a visibly marked test invitation. Clear the
test checkbox only for a real partner. Production invitations are enabled in
the deployed onboarding service; Quebec remains blocked until an approved
French agreement is available.

## Deferred payout setup

Canadian payout collection is intentionally outside this version because the
Chargerent Inc Canadian Stripe account has not been created. The partner can be
invited, sign the agreement, receive dashboard access, and begin operating
without a Stripe dependency. Do not collect Canadian bank information in
Firestore or email. Add a separate Stripe-hosted payout step after the Canadian
platform account and payout process are ready.

## Collections

- `regionalPartnerOnboardingInvites`
- `regionalPartnerAgreements`
- `regionalPartnerAgreementChallenges`
- `users`

All onboarding collections are server-only in Firestore rules. The public page
uses token-validated Cloud Functions.

## Release gate

Before sending a real invitation:

- confirm the approved Canadian agreement version is still current;
- deploy Functions and Firestore rules together;
- complete one test flow through agreement signature, administrator approval,
  password setup, and scoped partner dashboard access.

No Canadian payout method is configured by this onboarding feature. Before
automating partner payments, create the Canadian platform account and prove a
test bank payout, refund handling, and monthly-statement reconciliation.
