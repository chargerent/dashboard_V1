# Apollo U.S. lab

This stack runs a code-based Apollo orchestration service, Caddy HTTPS, Pub/Sub event delivery, a dedicated `apollo-us-lab` Firestore database, and Secret Manager credentials on a dedicated Google Compute Engine instance. It does not run another MQTT broker.

Kiosk availability and physical vending use Chargerent's established V2 broker and `CSTA` flow, the same hardware-control boundary used by Stripe. A private VPC peering route connects the Apollo runtime to the V2 broker on port `1883`; the port is allowed only from the Apollo subnet. The runtime publishes correlated requests to `CSTA/get` and accepts only matching `apollo-uslab-*` responses from `CSTA/post/<station>`. The distinct request prefix prevents U.S. lab messages from entering the older Payter relay bridge.

The `yyz-apollo-us-v1` template copies the established YYZ screen set. Availability and dispensing remain required. The scanner-only lab sequence is Start, live V2 inventory check, QR scan, V2 vend, Take your charger, and then Start again. If no QR is scanned within 45 seconds, the reader stops, the session fails without vending, `No QR scanned` is shown, and the terminal returns to Start. A terminal may explicitly accept any QR only in `us-lab`; production always fails closed unless a credential or future library adapter validates it. Nothing counts as dispensed until the correlated physical V2 vend acknowledgement is received.

The Payter state webhook is account-wide and may already belong to another Chargerent environment. The lab therefore does not overwrite it. Instead, the runtime polls only enabled scanner-only Apollo registrations, reloads the Start screen once at runtime startup, and reloads it again after an observed offline-to-online transition. This restores the callback URL that Apollo firmware does not retain with a rebooted custom screen. A dedicated production Payter API user and webhook should replace polling at scale.

## Provision and deploy

From the repository root:

```bash
infra/gcp/apollo-us-lab/provision.sh
infra/gcp/apollo-us-lab/deploy.sh
```

The temporary `sslip.io` hostname is suitable only for the isolated lab. Replace it with a Chargerent-owned DNS name and managed certificate before production.

## Required before a terminal test

1. Add the U.S. Payter CPS test/dev API key as the first version of `apollo-us-lab-payter-cps-api-key`. Do not put it in source, a command argument, or a ticket.
2. Confirm the Apollo serial is visible to that API user and supports `QR_CODE` in the intended CPS environment.
3. Supply the exact Chargerent client ID, station ID, and terminal serial.
4. Assign the client baseline and register the test terminal. Registration is disabled unless `--enable` is explicit.
5. Confirm that the selected station is a test V2 kiosk and that its normal V2 module status is fresh. No second kiosk MQTT connection or Node-RED adapter is required.
6. For the isolated pilot, register the terminal with `--scanner-only --accept-any-qr`, activate its Start screen, and observe the UI callback, V2 availability, QR callback, V2 vend acknowledgement, physical release, and recorded rental as separate evidence.

Add the CPS test API key from an interactive terminal so it does not enter shell history, then paste the value and press Control-D:

```bash
gcloud secrets versions add apollo-us-lab-payter-cps-api-key --project node-red-alerts --data-file=-
```

## Profile and terminal administration

Run commands inside the runtime container on the VM:

```bash
node src/bootstrap.js seed-template
node src/bootstrap.js assign-client --client 'CLIENT ID'
node src/bootstrap.js publish-profile < saved-client-profile.json
node src/bootstrap.js register-terminal --client 'CLIENT ID' --station USLAB01 --serial P6X00000000000
node src/bootstrap.js register-terminal --client 'CLIENT ID' --station USLAB01 --serial P6X00000000000 --enable --scanner-only --accept-any-qr
node src/bootstrap.js check-inventory --serial P6X00000000000
node src/bootstrap.js verify-payter-terminal --serial P6X00000000000
node src/bootstrap.js activate-terminal --serial P6X00000000000 --language en
```

All Apollo stations registered to the same client resolve the same immutable release through `apolloClientAssignments`. `publish-profile` accepts the saved dashboard profile JSON, validates its Apollo screen graph and QR settings, creates a content-addressed immutable release, and moves the client pointer. It does not write a different screen flow per kiosk. A one-click dashboard publisher remains intentionally disabled until the physical lab pilot proves the runtime contract.

For validation outside the explicit lab-only any-QR mode, pipe the credential to `issue-qr`; never place the raw value in the shell command line. The runtime stores an HMAC hash, not the raw QR credential. `--provider chargerent-issued` is the current provider. `external` and `library` are reserved provider identities that use the same V2 hardware path, but their upstream member validation adapters still require the partner's API contract.

## Shared V2 vending contract

- Stripe, Apollo QR, and future library authorization remain separate payment or identity adapters.
- All of them request live inventory and physical vending through the established V2 `CSTA` flow.
- Apollo sends `gateway: APOLLO`, `authorizationSource: QR_CODE`, and a credential-provider identifier; it never represents a QR authorization as a Stripe payment.
- MQTT delivery is not a successful vend. The Apollo credential is consumed only after the V2 flow returns its correlated physical vend-success acknowledgement.
- The existing Stripe code and topics are unchanged.

The reader command is a real Payter CPS action. Run it only after the test terminal, test credential, kiosk edge adapter, and observer are ready. An HTTP success means CPS accepted the command; it does not prove that the terminal displayed the prompt or that a charger physically vended.

## Production gaps

- Chargerent-owned DNS and certificate, a separate production GCP project, and a production Payter API user.
- At least two runtime instances or a managed container platform; the single VM is a lab availability boundary.
- Alert policies, backup/restore drills, certificate rotation, and an audited operator workflow.
- A confirmed library or other external QR provider API contract, signature/identity mapping, expiry/revocation rules, and customer support process.
- A complete physical pilot covering duplicate callbacks, offline/reconnect behavior, no-stock, jam/failure, return, and recovery.
