# FR8011 Amazon rental export

The Firebase backend forwards new, physically confirmed FR8011 live Stripe
rentals through Amazon's existing MQTT interfaces. It does not deploy or change
Amazon software, restart Node-RED, or require an Android APK update.

`kioskTerminalApi` freezes the complete kiosk pricing on each new interaction
as `pricingSnapshot`. The exporter uses that snapshot and the actual dispensed
charger/module/slot; it never looks up today's kiosk prices to reconstruct an
older transaction.

## Delivery

- `rentals_exportAmazon` handles rental writes. It requires FR8011, live Stripe,
  a matching PaymentIntent/interaction, and physical vend proof. Pending,
  failed, test-mode, other-station and pre-activation rentals are excluded.
- It creates one immutable outbox document per PaymentIntent and phase under
  `accounting/amazonRentalExport/outbox`. This existing accounting namespace
  is server-only; broker credentials remain in Secret Manager as
  `AMAZON_RENTAL_MQTT_CREDENTIALS`.
- A worker subscribes to `kiosk/ack` before publishing `kiosk/rental` at QoS 2.
  Only an ACK with the matching station and transaction ID and status `logged`
  or `duplicate` confirms Amazon's RENTALS insert. A broker publish callback
  alone is insufficient. Transaction IDs stay stable on retries.
- A 90-second lease prevents overlapping trigger/scheduler workers. The
  minute scheduler `rentals_retryAmazonExports` retries due work. Rental ACK
  progress is saved separately so an event retry does not republish a rental
  whose insert was already acknowledged.
- Initial imports more than 120 seconds after the original start are blocked
  with `legacy-timestamp-window`. This avoids turning an outage recovery or
  historical replay into a falsely recent rental. The Firebase record and
  outbox remain available for reconciliation.

## Accurate payment and event history

The existing Amazon main service accepts `tl/ck/<station>/rental-event` and
stores the event timestamp, payment status and JSON payload in RENTAL_EVENTS.
The bridge sends deterministic event IDs and the original start time, original
pricing, authorization amount, captured amount and final settlement details.
After `stripeReturnSettlement.status` becomes `completed`, it sends a separate
settlement event. It never invokes Stripe capture/cancel/refund or Amazon's
legacy charge/close/refund commands.

Event publication is confirmed at the MQTT broker, **not** by a database ACK;
the existing event consumer has no database acknowledgement interface. Its
deterministic event ID makes duplicate audit deliveries idempotent.

Amazon's legacy RENTALS importer still sets TOTALPAID/TOTALCHARGE to the hold
amount and RENTALTIME to receipt time. The accurate values are preserved in
RENTAL_EVENTS and Firebase; this bridge does not overwrite those legacy columns
or synchronize legacy return/close columns. A supported update interface for
those columns was not identified in the inspected rental services. Historical
backfill remains disabled rather than inventing dates/prices or running direct
SQL updates.

## Configuration and verification

The server-only configuration is `accounting/amazonRentalExport`:

- `enabled`: immediate pause/resume of forwarding and retry delivery.
- `stationIds`: initially `["FR8011"]`; the code also restricts its pilot to
  FR8011, so another station cannot be enabled by config alone.
- `enabledAt`: fixed forward-only cutoff. Do not move it backward to replay
  old rentals; do not reset it on a routine redeploy.
- `connectionCheckRequested`: one-time broker connection/subscription probe,
  usable with forwarding disabled. It publishes no business messages and
  records `lastBrokerCheck`.

Local meaningful checks:

```sh
cd /Users/georgegazelian/Projects/client-dashboard/functions
node --test amazonRentalExport.test.js kioskTerminal.test.js besiterGateway.test.js
```

Deployment uses a bundle based on the currently deployed source, with only
the snapshot/export changes added. It targets `kioskTerminalApi`,
`rentals_exportAmazon` and `rentals_retryAmazonExports`; unrelated local
dashboard/support/CTF7 changes and Firestore rules are excluded. Verify ACTIVE
state, published source hashes and a broker probe from the deployed function
before enabling the pilot. A successful real rental must still be correlated
with its outbox ACK and the named Amazon RENTALS/RENTAL_EVENTS records; unit
tests and connectivity alone do not prove a physical rental export.
