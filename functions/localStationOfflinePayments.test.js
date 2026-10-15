/* eslint-env node */
const test = require('node:test');
const assert = require('node:assert/strict');
const {offlinePolicy, enableLocationOffline} = require('./localStationOfflinePayments');
test('offline limits are positive bounded amounts and strict opt-in is separate from free mode', () => {
  assert.equal(offlinePolicy({stripeOfflinePayments: 'true'}).stripeOfflinePayments, false);
  assert.equal(offlinePolicy({stripeOfflinePayments: true, offline: true}).stripeOfflinePayments, false);
  assert.equal(offlinePolicy({stripeOfflinePayments: true, stripeOfflineMaxPayment: '35.25'}).stripeOfflineMaxTransactionCents, 3525);
  for (const value of [0, -1, 'invalid', Infinity, 10001]) assert.throws(() => offlinePolicy({stripeOfflinePayments: true, stripeOfflineMaxPending: value}));
});
test('enabling offline changes only offline capability on an existing configuration', async () => {
  const calls = [], config = {id: 'tmc_location', livemode: false, offline: {enabled: false}, tipping: {usd: {percentages: [10]}}};
  const client = {terminal: {locations: {retrieve: async () => ({id: 'tml_test', livemode: false, address: {country: 'US'}, configuration_overrides: config.id})},
    configurations: {retrieve: async () => config, update: async (...args) => calls.push(args)}}};
  await enableLocationOffline(client, {stripeLocationId: 'tml_test', stripeMode: 'test', stripeAccountCountry: 'US'});
  assert.deepEqual(calls, [['tmc_location', {offline: {enabled: true}}]]);
});
test('a location without an override gets an idempotent location-only offline override', async () => {
  const calls = [];
  const client = {terminal: {locations: {retrieve: async () => ({id: 'tml_test', livemode: false, address: {country: 'US'}}), update: async (...args) => calls.push(['assign', ...args])},
    configurations: {create: async (...args) => {calls.push(['create', ...args]); return {id: 'tmc_new'};}}}};
  await enableLocationOffline(client, {stripeLocationId: 'tml_test', stripeMode: 'test', stripeAccountCountry: 'US'});
  assert.equal(calls[0][2].idempotencyKey, 'local-offline-config-tml_test');
  assert.deepEqual(calls[1], ['assign', 'tml_test', {configuration_overrides: 'tmc_new'}]);
  await assert.rejects(enableLocationOffline(client, {stripeMode: 'live', stripeAccountCountry: 'US'}), /does not match/);
});
