const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeStationBrand} = require('./stationBrand');
const {terminalCommandArguments, terminalCommandResultMatches} = require('./phoneControl');

test('brand defaults preserve existing stations and reject unsupported owners', () => {
  for (const value of [undefined, null, '']) assert.equal(normalizeStationBrand(value), 'chargerent');
  assert.equal(normalizeStationBrand(' EVENTCHARGING '), 'eventcharging');
  assert.throws(() => normalizeStationBrand('lita'), /station brand/);
});

test('each brand reaches signed restrictions independently of the serial vendor', () => {
  for (const brand of ['chargerent', 'eventcharging', 'chargedrops']) {
    for (const vendor of ['lita', 'besiter']) {
      const args = terminalCommandArguments({stationBrand: brand, hardwareVendor: vendor, slotNumbers: [1]}, {});
      assert.equal(args.restrictions.station_brand, brand);
      assert.equal(args.restrictions.hardware_vendor, vendor);
    }
  }
  assert.equal('station_brand' in terminalCommandArguments({slotNumbers: [1]}, {}, {supportsStationBrand: false}).restrictions, false);
  assert.throws(() => terminalCommandArguments({stationBrand: 'eventcharging'}, {}, {supportsStationBrand: false}), /Update/);
});

test('a successful terminal ACK must confirm the requested logo brand', () => {
  const terminal = {packageName: 'com.chargerent.media.lab', installationId: 'a'.repeat(64), stationId: 'US6000',
    provisionId: 'id-lita', moduleId: 'local-id-lita', stripeLocationId: 'tml_example'};
  const restrictions = {provision_id: terminal.provisionId, module_id: terminal.moduleId, slot_count: 12,
    currency: 'usd', stripe_mode: 'test', stripe_account_country: 'US', stripe_reader_type: 'stripe_m2',
    stripe_location_id: terminal.stripeLocationId, station_brand: 'chargedrops'};
  const command = {stationId: terminal.stationId, arguments: {restrictions}};
  const result = {applied: true, packageName: terminal.packageName, terminal: {...terminal, configured: true,
    slotCount: 12, currency: 'usd', stripeMode: 'test', stripeAccountCountry: 'US', readerType: 'stripe_m2'}};
  assert.equal(terminalCommandResultMatches(terminal, command, result), false);
  result.terminal.stationBrand = 'chargerent';
  assert.equal(terminalCommandResultMatches(terminal, command, result), false);
  result.terminal.stationBrand = 'chargedrops';
  assert.equal(terminalCommandResultMatches(terminal, command, result), true);
});
