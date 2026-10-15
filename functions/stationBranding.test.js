const test = require('node:test');
const assert = require('node:assert/strict');
const {setStationBrand} = require('./stationBranding');

function fixture() {
  const kiosk = {stationid: 'US6000', stationBrand: 'chargerent', info: {client: 'CLIENT'},
    hardware: {screen: '7in', vendor: 'lita', serialPort: '/dev/ttyS1', billingOwner: 'local_station_v1'},
    ui: {mode: 'media', profileId: 'client'}, pricing: {authamount: 30}, paymentTerminal: {installationId: 'keep'}};
  const documents = new Map([['kiosks/provision-id', structuredClone(kiosk)],
    ['kiosks/other', {...structuredClone(kiosk), stationid: 'US6001', stationBrand: 'chargedrops'}],
    ['uiProfiles/client', {clientId: 'CLIENT', version: 9, ui: {colors: {bcolor1: '#000'}}}]]);
  const db = {collection: (name) => ({where: (field, op, value) => ({name, field, value})}),
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: async (query) => ({docs: [...documents.entries()]
          .filter(([path, value]) => path.startsWith(`${query.name}/`) && value[query.field] === query.value)
          .map(([path, value]) => ({ref: {path}, data: () => structuredClone(value)}))}),
        update: (ref, value) => writes.push(() => documents.set(ref.path, {...documents.get(ref.path), ...value})),
      });
      writes.forEach((write) => write());
      return result;
    }};
  class HttpsError extends Error {constructor(code, message) {super(message); this.code = code;}}
  const dependencies = {db, admin: {firestore: {FieldValue: {serverTimestamp: () => 'now'}}}, HttpsError,
    canManageStation: (auth, value) => auth.isAdmin || auth.profile?.clientId === value.info?.client};
  const auth = {profile: {clientId: 'CLIENT', username: 'operator'}};
  const save = (data = {}) => setStationBrand({stationid: 'US6000', stationBrand: 'eventcharging', expectedStationBrand: 'chargerent', ...data}, auth, dependencies);
  return {save, documents, auth};
}

test('station branding preserves profiles, pricing, hardware, payment setup and other stations', async () => {
  const {save, documents} = fixture();
  const before = structuredClone(documents);
  assert.equal((await save()).kiosk.stationBrand, 'eventcharging');
  assert.deepEqual(documents.get('kiosks/provision-id'), {...before.get('kiosks/provision-id'), stationBrand: 'eventcharging', updatedAt: 'now', updatedBy: 'operator'});
  for (const path of ['kiosks/other', 'uiProfiles/client']) assert.deepEqual(documents.get(path), before.get(path));
});

test('unknown, missing and screenless stations cannot get a brand change', async () => {
  for (const screen of [undefined, '', 'NO', 'no screen', '0', '0in']) {
    const {save, documents} = fixture();
    documents.get('kiosks/provision-id').hardware.screen = screen;
    const before = structuredClone(documents);
    await assert.rejects(save(), {code: 'failed-precondition'});
    assert.deepEqual(documents, before);
  }
});

test('client authorization, unsupported brands and stale edits are enforced before writing', async () => {
  const {save, documents, auth} = fixture();
  const before = structuredClone(documents);
  auth.profile.clientId = 'OTHER';
  await assert.rejects(save(), {code: 'permission-denied'});
  auth.profile.clientId = 'CLIENT';
  await assert.rejects(save({expectedStationBrand: 'chargedrops'}), {code: 'aborted'});
  for (const stationBrand of ['lita', '', null, undefined]) await assert.rejects(save({stationBrand}), {code: 'invalid-argument'});
  assert.deepEqual(documents, before);
});

test('old records default to Chargerent and duplicate station assignments are rejected', async () => {
  const {save, documents} = fixture();
  delete documents.get('kiosks/provision-id').stationBrand;
  assert.equal((await save()).kiosk.stationBrand, 'eventcharging');
  documents.set('kiosks/duplicate', {...documents.get('kiosks/provision-id')});
  const before = structuredClone(documents);
  await assert.rejects(save({expectedStationBrand: 'eventcharging', stationBrand: 'chargedrops'}), {code: 'failed-precondition'});
  assert.deepEqual(documents, before);
});
