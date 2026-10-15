/* eslint-env node */
const test = require('node:test');
const assert = require('node:assert/strict');
const {FakeDb} = require('./testsupport/ctf7FakeDb');
const {createLocalStationProvisioner} = require('./localStationProvisioning');
const {terminalConfigForKiosk, terminalCommandArguments} = require('./phoneControl');
function fixture() {
  const db = new FakeDb(); db.rows.set('kiosks/id-pending', {status: 'pending-provision', deviceId: 'android-device'});
  const input = {provisionid: 'id-pending', stationid: 'US8001', kiosk: {info: {country: 'US', address: '1 Main St', city: 'Orlando', state: 'FL', zip: '32801'},
    hardware: {vendor: 'lita', checkoutExecution: 'local', billingOwner: 'local_station_v1', boardCount: 1, slotsPerBoard: 12, gateway: 'STRIPE', gatewayoptions: 'FULLPRICE'},
    pricing: {text: 'PURCHASE - SIMPLE DAILY', currency: 'US', initialperiod: 24, authamount: 2, dailyprice: 2, buyprice: 30, overdue: 7, rate: [{time: 1440, price: 2}]}}};
  return {db, input, provision: createLocalStationProvisioner({db}), auth: {uid: 'admin', isAdmin: true}};
}
test('pending Lita station provisions directly into Firebase and encrypted assignment receives its hardware selection', async () => {
  const f = fixture(); await f.provision(f.input, f.auth);
  const kiosk = f.db.rows.get('kiosks/id-pending');
  assert.equal(kiosk.deviceId, 'android-device'); assert.equal(kiosk.modules.length, 1); assert.equal(kiosk.modules[0].slots.length, 12);
  const config = terminalConfigForKiosk('US8001', {id: 'id-pending', data: () => kiosk});
  const restrictions = terminalCommandArguments(config, {}).restrictions;
  assert.equal(restrictions.hardware_vendor, 'lita'); assert.equal(restrictions.checkout_execution, 'local');
  assert.equal(restrictions.serial_port, '/dev/ttyS1'); assert.equal(restrictions.slots_per_board, 12);
  assert.equal(restrictions.board_count, 1);
  kiosk.modules[0].slots[0].sn = 'LC001';
  await f.provision(f.input, f.auth); assert.equal(f.db.rows.get('kiosks/id-pending').modules[0].slots[0].sn, 'LC001');
});
test('local Besiter station retains four-hole boards and aggregate dashboard slot numbering', async () => {
  const f = fixture(); Object.assign(f.input.kiosk.hardware, {vendor: 'besiter', boardCount: 3, slotsPerBoard: 4});
  await f.provision(f.input, f.auth);
  const kiosk = f.db.rows.get('kiosks/id-pending');
  assert.equal(kiosk.modules[0].slots.at(-1).position, 12);
  const config = terminalConfigForKiosk('US8001', {id: 'id-pending', data: () => kiosk});
  assert.equal(config.serialPort, '/dev/ttySMT7'); assert.equal(config.boardCount, 3);
});
test('provisioning rejects non-admin, conflicting assignment, reserved ID and invalid vendor topology', async () => {
  for (const change of [f => {f.auth.isAdmin = false;}, f => {f.db.rows.set('kiosks/id-other', {stationid: 'US8001'});},
    f => {f.db.rows.set('stationIdReservations/US8001', {active: true});}, f => {f.input.kiosk.hardware.vendor = 'besiter';}]) {
    const f = fixture(); change(f); await assert.rejects(f.provision(f.input, f.auth));
    assert.equal(f.db.rows.get('kiosks/id-pending').status, 'pending-provision');
  }
});
test('an existing working station cannot be overwritten by the provisioning path', async () => {
  const f = fixture(); f.db.rows.get('kiosks/id-pending').status = 'provisioned';
  await assert.rejects(f.provision(f.input, f.auth), /no longer pending/);
});

test('all station brands persist through Firebase provisioning and terminal configuration', async () => {
  for (const brand of ['chargerent', 'eventcharging', 'chargedrops']) {
    const f = fixture(); f.input.kiosk.stationBrand = brand;
    await f.provision(f.input, f.auth);
    const kiosk = f.db.rows.get('kiosks/id-pending');
    assert.equal(kiosk.stationBrand, brand);
    const config = terminalConfigForKiosk('US8001', {id: 'id-pending', data: () => kiosk});
    assert.equal(terminalCommandArguments(config, {}).restrictions.station_brand, brand);
  }
  const legacy = fixture(); await legacy.provision(legacy.input, legacy.auth);
  assert.equal(legacy.db.rows.get('kiosks/id-pending').stationBrand, 'chargerent');
  const invalid = fixture(); invalid.input.kiosk.stationBrand = 'lita';
  await assert.rejects(invalid.provision(invalid.input, invalid.auth), /station brand/);
  assert.equal(invalid.db.rows.get('kiosks/id-pending').status, 'pending-provision');
});
