# Chargerent kiosk Terminal backend

`kioskTerminalApi` is the Firebase HTTPS backend for the integrated Chargerent
Android kiosk app and its external Stripe Terminal reader.

## Secret boundary

The Cloud Function binds `STRIPE_TEST_SECRET_KEY` and
`STRIPE_FR_LIVE_SECRET_KEY` from Google Secret Manager. The latter must belong
to a French Stripe account and begin `sk_live_`. It is accepted only for an FR
installation using `bbpos_wisepad3` and package `com.chargerent.media.lab`.
Never put either value in Firestore, Gradle, an APK, or a device.

The Android app receives short-lived Stripe Terminal connection tokens and
PaymentIntent client secrets from this API. It never receives the Stripe secret
key.

The Function also binds `BESITER_MQTT_CREDENTIALS`. This is one JSON Secret
Manager value containing the existing backend broker username and password:

```json
{"username":"...","password":"..."}
```

It is a server-to-server Besiter credential, not a second Stripe key. It must
never be placed in Firestore, the APK, or the phone restrictions.

## Installation record

Phone Control generates a unique random token when an administrator enables
**Run Stripe terminal on this phone** during kiosk assignment. It uses the
lowercase SHA-256 hex digest as the document ID in `kioskInstallations`, stores
only the hash, and encrypts the one-time raw token to that enrolled phone's
Android Keystore command key. Do not create or paste raw installation tokens in
the dashboard or Firestore.

An installation document has this shape:

```json
{
  "active": true,
  "stationId": "CA8019",
  "provisionId": "id-9987807816",
  "moduleId": "100049231111490591",
  "slotNumbers": [1, 2, 3],
  "stripeMode": "test",
  "stripeLocationId": "tml_GnzzwCooebUUQo",
  "amountCents": 100,
  "currency": "usd",
  "pricingSource": "kiosk"
}
```

The same signed Agent command supplies the token, Location, station, provision,
V2 module, slot count, currency, and pilot amount as managed app restrictions.
Agent 1.2.14 then launches the app in Device Owner lock-task mode. Disabling the
terminal assignment revokes the installation record, clears the managed token,
and exits payment-app lockdown.

The amount, currency, module, and slot values in the installation/restrictions
are bootstrap information only. Every customer screen and PaymentIntent uses a
fresh kiosk pricing snapshot. Every availability and charger selection uses the
live Besiter status response.

## Besiter V2 contract

1. `GET /v1/config` and `POST /v1/interactions` publish a correlated
   `action: status` request to `CSTA/get`.
2. The live Besiter flow refreshes stale modules and returns
   `CSTA/post/<station>`. Its existing eligibility filter owns slot status,
   module freshness, the configured battery threshold, locks, rental holds,
   disabled modules, and candidate ordering.
3. The backend temporarily reserves Besiter's selected charger serial to stop
   the same phone flow from double-paying for it.
4. Stripe authorizes with manual capture. For an explicitly enabled Amazon V2
   station, the backend registers the original PaymentIntent and frozen pricing
   through the existing QR service, then calls its original vend endpoint once.
   That service publishes the existing `CSTA/get` vend request with the
   PaymentIntent as `transactionid`. Other installations retain their existing
   transport until configured for that handoff.
5. The existing Besiter flow revalidates the candidate, sends `popup_sn`,
   retries eligible alternatives, and writes the physical outcome to
   `rentals/<paymentIntentId>`.
6. The backend confirms dispense only when `status: rented`, `vendState: dispensed`, and
   the rental contains popup-response or fresh-status absence proof. A failure
   before Amazon registration is attempted can cancel an unvended authorization
   or refund an unvended captured payment. An uncertain Amazon handoff remains
   pending and is not retried
   or canceled while the physical outcome is unknown.
   A `FULLPRICE` authorization remains uncaptured after successful dispense.
7. The existing hardware return flow publishes `action: return` to `CSTA/post`.
   Amazon's existing V2 service owns rental closure and return billing. Firebase
   observes the physical return for the UI; it does not capture, cancel, or refund
   a successfully vended rental on return. Enabling the handoff requires the app
   and Amazon to use the same Stripe account and the same Stripe payment mode.

FR8012 requires the Amazon V2 route. Missing, disabled, or unverified route
configuration must stop a new payment before authorization; it must not fall
back to a direct vend or the legacy rental exporter. The server-owned route
configuration identifies the verified Amazon payment profile, account ID and
live mode. A profile name containing `TEST` or a station `MODE` value is not
proof of the Stripe key's mode.

After rental registration has been attempted, uncertain responses do not
transfer financial ownership back to Google. The backend observes payment and
physical dispense results and waits for Amazon. It never repeats an uncertain
vend. Safe cleanup of an unvended authorization remains possible before the
registration handoff.

## Payment safety

PaymentIntents are created server-side with `payment_method_types` set to
`card_present`. A kiosk whose `hardware.gatewayoptions` is `FULLPRICE` uses
manual capture: the buy price is authorized at the reader, stays uncaptured
after a verified vend. Amazon's existing billing rules settle the authorization
on return or purchase. The app's local return calculation is not proof of payment
settlement. A kiosk whose
option is `INITIALPRICE` uses automatic capture: the configured authorization
amount is charged at the reader. Amazon owns subsequent rental billing and
refunds. The backend verifies the PaymentIntent amount, currency, metadata, and
the gateway-specific Stripe status before vending.

Card display metadata is read from the original Stripe PaymentMethod:
`card_present` for reader payments and `card` for online card payments. The
backend preserves a four digit `card_last4` and the brand in `card_type`, sends
the last four through the existing V2 vend field, and merges these display
fields once the matching station's existing rental is available.
This metadata does not change the payment IDs or make a billing decision.
Amazon's registration handler must also read `card_present` to populate its
own `CARDNUMBER` and `CARDTYPE` columns. Replaying rental registration is not a
metadata repair method.

The implementation does not treat payment approval, MQTT publish completion,
or a pending rental as success. The customer sees “Take your charger” only
after the physical proof described above.

Receipt reads verify the creating Stripe account and mode and read the actual
processor state. A physical return or Google's calculated rental fee cannot
confirm a charge, release, or refund. Unknown or unfinished billing stays
pending. The hosted media service delegates signed receipt reads to
`rentalReceiptApi`; it does not receive Stripe credentials.

## Local verification

The legacy rental export, delivery tracking and accounting limitations are
documented in [AMAZON_RENTAL_EXPORT.md](AMAZON_RENTAL_EXPORT.md). Rentals registered
through the normal Amazon V2 handoff must skip that legacy export to prevent a
second SQL insertion.

```bash
cd functions
npm run test:kiosk-terminal
npm run test:phone-control
npx eslint kioskTerminal.js kioskTerminal.test.js besiterGateway.js besiterGateway.test.js index.js
```

Before enabling live mode, confirm that the secret belongs to the French Stripe
account, Stripe reports `details_submitted` and `charges_enabled`, the station
resolves to country `FR`, the assigned device is the integrated kiosk app, and
the reader type is WisePad 3. Re-saving the FR8011 assignment creates a new
installation token and a French live Terminal Location. Reader readiness, a
successful card authorization, and a successful physical vend remain separate
checks.
