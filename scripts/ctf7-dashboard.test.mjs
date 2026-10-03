import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCtf7ModuleId } from '../src/utils/ctf7.js';
import { normalizeKioskData, isNewSchemaKiosk } from '../src/utils/helpers.js';
import model from '../functions/ctf7Model.js';
import terminal from '../functions/kioskTerminal.js';

test('label serial retains all 11 characters and remains independent from station assignment', () => {
  const module = model.createModule('ZDHW0726090');
  assert.equal(module.id, 'LM-ZDHW0726090'); assert.equal(module.manufacturerSerial, 'ZDHW0726090');
  assert.equal(module.machineSN, ''); assert.equal(module.slots.length, 7);
  assert.equal(parseCtf7ModuleId(module.id), module.id);
  assert.equal(parseCtf7ModuleId('../escape'), '');
  const first = model.boundRegistry({module, stationid: 'US8999', provisionid: 'a', actorUid: 'staff', timestamp: 'now'});
  const second = model.boundRegistry({module, previous: first, stationid: 'FR8999', provisionid: 'b', actorUid: 'staff', timestamp: 'later'});
  assert.equal(second.moduleId, first.moduleId); assert.equal(second.generation, 2); assert.equal(second.controlEnabled, false);
});
test('seven-slot map requires unique verified transport addresses', () => {
  const map = Array.from({length: 7}, (_, i) => ({position: i + 1, cabin: i < 4 ? 1 : 2, channel: i % 4 + 1}));
  assert.equal(model.validateSlotMap(map).length, 7);
  assert.throws(() => model.validateSlotMap(map.slice(0, 6)));
  assert.throws(() => model.validateSlotMap([...map.slice(0, 6), {...map[6], cabin: 1, channel: 1}]));
});
test('dashboard preserves fan ASCII asset serials and version strings', () => {
  const module = model.createModule('ZDHW0726090');
  module.slots[0] = {...module.slots[0], status: 1, sn: '000ABC000001', batteryLevel: 80,
    softwareVersion: 'S12', hardwareVersion: 'H01', observed: true};
  const [kiosk] = normalizeKioskData([{stationid: 'US8999', hardware: {type: 'CTF7'}, modules: [module]}]);
  assert.equal(isNewSchemaKiosk(kiosk), true);
  assert.equal(kiosk.modules[0].protocol, 'lm-tcp-v1');
  assert.equal(kiosk.modules[0].slots[0].sn, '000ABC000001');
  assert.equal(kiosk.modules[0].slots[0].softwareVersion, 'S12');
  assert.equal(kiosk.modules[0].slots.length, 7);
});
test('existing Besiter normalization stays numeric', () => {
  const [kiosk] = normalizeKioskData([{hardware: {type: 'CT4'}, modules: [{id: '867652077000000',
    slots: [{position: 1, status: 1, sn: '12345678', batteryLevel: 90}]}]}]);
  assert.equal(kiosk.modules[0].slots[0].sn, 12345678);
});
test('CTF7 cannot enter the Besiter payment or installation path', () => {
  assert.throws(() => terminal.resolveKioskOffer({}, {hardware: {type: 'CTF7'}}), error => error.code === 'ctf7-commissioning');
  assert.throws(() => terminal.validateInstallation({moduleId: 'LM-ZDHW0726090', active: true}), error => error.code === 'ctf7-commissioning');
});
