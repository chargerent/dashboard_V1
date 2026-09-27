# ChargeDrops regional-partner onboarding updates

ChargeDrops venue clients use the branded Client Portal. Regional partners keep
using the standard Chargerent dashboard. This workflow sends a separate,
status-only email to the assigned regional partner as the client progresses.

## Lifecycle

| Event | Trigger | Partner message |
| --- | --- | --- |
| Client onboarding started | Administrator creates the ChargeDrops client | Client and venue profile created |
| Client portal invitation sent | Client credential email is accepted by SMTP | Client invitation sent |
| Coming Soon location published | Venue write succeeds in `chargedrops-dev` | Venue is visible as Coming Soon |
| Agreement sent | Administrator prepares the ChargeRent agreement | Agreement ready for client review |
| Agreement signed | Client signs with email verification | Agreement signing complete |
| Payout setup started | Client opens Stripe-hosted Connect onboarding | Secure payout onboarding started |
| Payout action required | Stripe account status changes | Client needs to return to Stripe |
| Payout verification pending | Stripe account status changes | Stripe review is pending |
| Payout account complete | Stripe reports the account payout-ready | Payout setup complete |
| Installation scheduled | Administrator saves the installation date | Installation schedule saved |
| Kiosk installed | Administrator confirms installation | Kiosk installed |
| Location live | Administrator launches the location | Venue is live and no longer Coming Soon |

Partner messages include only the client ID, venue, city, current stage, and next
step. They never contain client credentials, agreement files, verification codes,
Stripe account details, or bank information.

## Delivery controls

Every event uses a deterministic audit ID in the private
`chargeDropsPartnerNotifications` collection. A sent, sending, skipped, or
uncertain event is not sent again automatically. The admin page permits retry
only when the prior attempt is known to have failed before sending. Uncertain
delivery must be checked manually before any resend.

The ChargeDrops client card shows the most recent partner delivery result and
stage. The installation and launch panel creates the last three operational
events. Launch also changes the public ChargeDrops venue from `comingSoon: true`
to `comingSoon: false` with `status: live`.

## Production configuration

The `chargedrops_stripeWebhook` HTTPS function must be deployed and registered
as a Stripe Connect webhook endpoint for `account.updated`. Store that endpoint's
signing secret as the Firebase secret `STRIPE_CONNECT_WEBHOOK_SECRET`. Keep the
Stripe platform key in `STRIPE_CONNECT_SECRET_KEY` and the Gmail application
password as managed Firebase secrets; do not add their values to source control.

After deployment, run a test-mode end-to-end client through account creation,
agreement signing, Stripe onboarding, installation, and launch. Confirm each
audit record and recipient before enabling live-mode onboarding.
