import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKioskData, isModuleOnline} from '../src/utils/helpers.js';
import {commandChargerId} from '../src/utils/ctf7.js';
test('Lita string serials survive dashboard normalization and remote command selection', () => {
  const [kiosk] = normalizeKioskData([{stationid: 'US8001', hardware: {type: 'CT12', vendor: 'lita', checkoutExecution: 'local'},
    modules: [{id: 'cabinet-001', lastUpdated: new Date().toISOString(), slots: [{position: 1, status: 1, sn: 'LC001ABC', batteryLevel: 90, lock: false}]}]}]);
  assert.equal(kiosk.modules[0].slots[0].sn, 'LC001ABC');
  assert.equal(commandChargerId(kiosk.modules[0].slots[0].sn, kiosk), 'LC001ABC');
});
test('local Besiter IDs remain exact strings while legacy Besiter behavior stays compatible', () => {
  assert.equal(commandChargerId('00001234', {hardware: {checkoutExecution: 'local', vendor: 'besiter'}}), '00001234');
  assert.equal(commandChargerId('1234', {hardware: {vendor: 'besiter'}}), 1234);
});
test('fresh HTTP reporting cannot make a disconnected local controller appear online', () => {
  const now = new Date().toISOString();
  assert.equal(isModuleOnline({online: false, lastUpdated: now}, now), false);
});
test('normalized local inventory retains explicit offline status and ignores stale available counts', () => {
  const [kiosk] = normalizeKioskData([{stationid: 'US8001', count: 12, hardware: {type: 'CT12', checkoutExecution: 'local', vendor: 'lita'},
    modules: [{id: 'cabinet', online: false, lastUpdated: new Date().toISOString(), slots: [{position: 1, status: 1, sn: 'LC001', batteryLevel: 90}]}]}]);
  assert.equal(kiosk.count, 0); assert.equal(isModuleOnline(kiosk.modules[0], new Date().toISOString()), false);
});
