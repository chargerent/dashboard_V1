/* eslint-env node */
// The pricing flag authorizes deferred card approval, never payment-free vending.
function offlinePolicy(pricing) {
  const enabled = pricing?.stripeOfflinePayments === true && pricing?.offline !== true;
  const cents = (value, fallback) => {
    const amount = value == null || value === '' ? fallback : Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) throw new Error('Invalid offline payment limit.');
    return Math.round(amount * 100);
  };
  return {stripeOfflinePayments: enabled,
    stripeOfflineMaxTransactionCents: enabled ? cents(pricing.stripeOfflineMaxPayment, 100) : 0,
    stripeOfflineMaxPendingCents: enabled ? cents(pricing.stripeOfflineMaxPending, 500) : 0,
    stripeOfflineMaxCount: 100};
}
async function enableLocationOffline(client, installation) {
  // Keep existing reader appearance/network settings. Disabling new rentals is
  // enforced by REQUIRE_ONLINE in the app, so shared locations can drain payments.
  const location = await client.terminal.locations.retrieve(installation.stripeLocationId);
  if (location.livemode !== (installation.stripeMode === 'live') || location.address?.country !== installation.stripeAccountCountry) {
    throw new Error('Stripe offline location does not match this installation.');
  }
  if (location.configuration_overrides) {
    const config = await client.terminal.configurations.retrieve(location.configuration_overrides);
    if (config.deleted || config.livemode !== location.livemode) throw new Error('Invalid Terminal configuration.');
    if (config.offline?.enabled !== true) await client.terminal.configurations.update(config.id, {offline: {enabled: true}});
  } else {
    const config = await client.terminal.configurations.create({name: `Chargerent offline ${location.id}`, offline: {enabled: true}},
      {idempotencyKey: `local-offline-config-${location.id}`});
    await client.terminal.locations.update(location.id, {configuration_overrides: config.id});
  }
}
module.exports = {offlinePolicy, enableLocationOffline};
