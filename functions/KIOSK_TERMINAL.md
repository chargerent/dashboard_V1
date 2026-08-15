# Chargerent kiosk Terminal backend

`kioskTerminalApi` is the Firebase HTTPS backend for the Android Tap to Pay
kiosk. The first pilot is restricted to CA8019 through its installation record.

## Secret boundary

The Cloud Function binds `STRIPE_TEST_SECRET_KEY` from Google Secret Manager.
For the pilot this must be a U.S. Stripe account test secret key beginning
`sk_test_`. Never put this value in Firestore, Gradle, an APK, or a device.

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

The CA8019 pilot document has this shape:

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
4. Stripe authorizes with manual capture. The backend then publishes an
   `action: vend` request with that charger serial, module, slot, request ID,
   interaction ID, and PaymentIntent ID.
5. The existing Besiter flow revalidates the candidate, sends `popup_sn`,
   retries eligible alternatives, and writes the physical outcome to
   `rentals/<paymentIntentId>`.
6. The backend captures only when `status: rented`, `vendState: dispensed`, and
   the rental contains popup-response or fresh-status absence proof. A failure
   or missing result cancels the authorization or refunds a captured payment.
7. When Besiter writes `status: returned`, the Stripe return trigger uses
   Besiter's calculated `totalCharged`, keeps that amount from the captured
   deposit, and refunds the remainder with an idempotent Stripe refund.

## Payment safety

PaymentIntents are created server-side with `payment_method_types` set to
`card_present` and `capture_method` set to `manual`. After the Android Terminal
SDK processes the card, the backend verifies the PaymentIntent amount,
currency, metadata, and `requires_capture` state.

The implementation does not treat payment approval, MQTT publish completion,
or a pending rental as success. The customer sees “Take your charger” only
after the physical proof described above.

## Local verification

```bash
cd functions
npm run test:kiosk-terminal
npm run test:phone-control
npx eslint kioskTerminal.js kioskTerminal.test.js besiterGateway.js besiterGateway.test.js index.js
```

Before deployment, set both server secrets and create the CA8019 installation
by re-saving its phone assignment with the terminal option enabled. Do not
deploy while CA8019 is empty: the live Besiter response will correctly be
`sold_out` or `offline`, and Rent will remain disabled.
