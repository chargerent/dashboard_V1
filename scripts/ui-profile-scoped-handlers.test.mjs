import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as sectionHelpers from '../functions/uiProfileSections.mjs';
import snapshotHelpers from '../functions/uiProfileSnapshot.js';
import {createDefaultKioskUiProfile} from '../src/utils/kioskUiProfiles.js';
import {createApolloScreen, emptyApolloScreenFlow} from '../functions/apolloScreens.mjs';

// Exercise the actual handlers with an isolated transactional document store.
// No Firebase initialization, credentials, network access, or device commands.
const code = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const handlerSource = code.slice(code.indexOf('async function uiProfileUpsertSectionImpl('), code.indexOf('async function uiProfileUpsertImpl('))
  .replaceAll("await import('./uiProfileSections.mjs')", 'sectionHelpers');
const adminAuth = {isAdmin: true, uid: 'test', profile: {username: 'test-admin'}};
const clientAuth = {isAdmin: false, profile: {username: 'client', clientId: 'CLIENT'}};
const clone = (value) => structuredClone(value);
const get = (value, path) => path.split('.').reduce((parent, key) => parent?.[key], value);

function harness() {
  const saved = {...createDefaultKioskUiProfile('CLIENT'), version: 3};
  const records = new Map([
    ['uiProfiles/client', clone(saved)],
    ['kiosks/k1', {stationid: 'K1', info: {client: 'CLIENT'}, hardware: {gateway: 'PAYTERP68', screen: '7in'}, ui: {mode: 'PAYTER', version: '43', created: 'keep', languages: clone(saved.languages)}, admin: {userpassword: '12345'}}],
    ['kiosks/k2', {stationid: 'K2', info: {client: 'OTHER'}, hardware: {gateway: 'PAYTERP68', screen: '7in'}, ui: {mode: 'UI'}}],
    ['kiosks/k3', {stationid: 'K3', info: {client: 'CLIENT'}, hardware: {gateway: 'PAYTERP68', screen: 'no screen'}, screen: {mode: 'UI'}, ui: {mode: 'media'}}],
    ['kiosks/a1', {stationid: 'A1', info: {client: 'CLIENT'}, hardware: {gateway: 'APOLLO', screen: 'no screen'}}],
    ['kiosks/u1', {stationid: 'U1', info: {client: 'CLIENT'}, hardware: {gateway: 'OTHER', screen: '7in'}, ui: {mode: 'UI'}, admin: {userpassword: '12345', adminpassword: '23451'}}],
  ]);
  const ref = (path) => ({path, id: path.split('/').at(-1), get: async () => ({id: path.split('/').at(-1), ref: ref(path), exists: records.has(path), data: () => clone(records.get(path))})});
  const collection = (name, filters = []) => ({
    doc: (id) => ref(`${name}/${id}`),
    where: (field, op, value) => collection(name, [...filters, {field, op, value}]),
    get: async () => {
      const docs = [];
      for (const [path, value] of records) {
        if (!path.startsWith(`${name}/`)) continue;
        if (filters.every((filter) => filter.op === 'in' ? filter.value.includes(get(value, filter.field)) : get(value, filter.field) === filter.value)) docs.push(await ref(path).get());
      }
      return {docs, size: docs.length};
    },
  });
  const db = {collection, runTransaction: async (callback) => {
    const pending = [];
    const result = await callback({get: (target) => target.get(), set: (target, value) => pending.push({target, value}), update: (target, value) => pending.push({target, value, update: true})});
    for (const {target, value, update} of pending) {
      const next = update ? clone(records.get(target.path)) : {};
      for (const [path, child] of Object.entries(value)) {
        const keys = path.split('.'); let parent = next;
        for (const key of keys.slice(0, -1)) {parent[key] ||= {}; parent = parent[key];}
        parent[keys.at(-1)] = clone(child);
      }
      records.set(target.path, next);
    }
    return result;
  }};
  class HttpsError extends Error {constructor(code, message) {super(message); this.code = code;}}
  const deps = {
    sectionHelpers, db, functions: {https: {HttpsError}},
    clonePlain: (value) => value == null ? {} : clone(value),
    normalizeStationId: (value) => String(value || '').trim().toUpperCase(),
    normalizeUsername: (value) => String(value || '').trim().toLowerCase(),
    normalizeUiProfileId: (value) => String(value || '').trim().toLowerCase(),
    normalizeUiProfilePin: (value) => String(value || ''),
    canManageUiProfileClient: (auth, client) => auth.isAdmin || auth.profile.clientId === client,
    canManageUiProfileForKiosk: (auth, kiosk) => auth.isAdmin || auth.profile.clientId === kiosk.info.client,
    UI_PROFILES_COLLECTION: 'uiProfiles',
    selectCanonicalUiProfileDoc: (docs) => docs[0],
    serializeUiProfileDoc: (doc) => ({...doc.data(), id: doc.id}),
    admin: {firestore: {FieldValue: {serverTimestamp: () => 'now'}}},
    chunkArray: (values, size) => Array.from({length: Math.ceil(values.length / size)}, (_, i) => values.slice(i * size, (i + 1) * size)),
    preserveProvisionedUiMode: snapshotHelpers.preserveProvisionedUiMode,
    buildUiProfileSnapshot: (profile) => ({...profile.ui, languages: profile.languages}),
  };
  const handlers = new Function(...Object.keys(deps), `${handlerSource}; return {save: uiProfileUpsertSectionImpl, apply: uiProfileApplySectionImpl};`)(...Object.values(deps));
  return {records, ...handlers, saved};
}

test('scoped save rejects a stale version without changing the profile', async () => {
  const {records, save, saved} = harness();
  await assert.rejects(save({profile: {...saved, version: 2}, section: 'p68'}, adminAuth), {code: 'aborted'});
  assert.equal(records.get('uiProfiles/client').version, 3);
});

test('client and Apollo permissions are enforced on the server', async () => {
  const {save, saved} = harness();
  await assert.rejects(save({profile: {...saved, clientId: 'OTHER'}, section: 'p68'}, clientAuth), {code: 'permission-denied'});
  await assert.rejects(save({profile: saved, section: 'apollo'}, clientAuth), {code: 'permission-denied'});
});

test('Apollo screen drafts are validated and saved without writing to terminals', async () => {
  const {save, saved, records} = harness();
  const before = clone(records.get('kiosks/a1'));
  const screenFlow = {...emptyApolloScreenFlow(), entryScreenId: 'custom_1', screens: [createApolloScreen([])]};
  saved.terminalProfiles = {apollo: {translations: {}, screenFlow}};
  screenFlow.screens[0].buttons[0].next = 'paymentpage';
  await assert.rejects(save({profile: saved, section: 'apollo'}, adminAuth), {code: 'invalid-argument'});
  assert.equal(records.get('uiProfiles/client').version, 3);
  screenFlow.screens[0].buttons[0].next = '$continue';
  const {profile} = await save({profile: saved, section: 'apollo'}, adminAuth);
  assert.deepEqual(profile.terminalProfiles.apollo.screenFlow, screenFlow);
  assert.equal(profile.sectionVersions.apollo, 1);
  assert.deepEqual(records.get('kiosks/a1'), before);
  assert.deepEqual(profile.languages, saved.languages);
});

test('Apollo station-level overrides are rejected because the flow is client-wide', async () => {
  const {save, saved, records} = harness();
  await assert.rejects(save({profile: saved, section: 'apollo', stationid: 'A1'}, adminAuth), {code: 'invalid-argument'});
  assert.equal(records.get('uiProfiles/client').version, 3);
});

test('overrides reject foreign kiosks, incompatible gateways and P68 UI-mode screens', async () => {
  const {save, saved, records} = harness();
  for (const stationid of ['K2', 'K3', 'A1', 'MISSING']) {
    await assert.rejects(save({profile: saved, section: 'p68', stationid}, adminAuth), {code: 'permission-denied'});
  }
  assert.equal(records.get('uiProfiles/client').version, 3);
});

test('a canonical identifier collision cannot replace another client profile', async () => {
  const {save, saved, records} = harness();
  records.set('uiProfiles/client', {...saved, clientId: 'OTHER'});
  await assert.rejects(save({profile: saved, section: 'p68'}, clientAuth), {code: 'permission-denied'});
  assert.equal(records.get('uiProfiles/client').clientId, 'OTHER');
});

test('P68 draft saving writes only the selected profile section, never a kiosk', async () => {
  const {save, saved, records} = harness();
  const kioskBefore = clone(records.get('kiosks/k1'));
  saved.languages.locales.en.terminals.PAYTERP68.start = 'Saved message';
  saved.ui.mode = 'wrong';
  const {profile} = await save({profile: saved, section: 'p68'}, clientAuth);
  assert.equal(profile.version, 4);
  assert.equal(profile.sectionVersions.p68, 1);
  assert.equal(profile.ui.mode, 'UI');
  assert.equal(profile.languages.locales.en.terminals.PAYTERP68.start, 'Saved message');
  assert.deepEqual(records.get('kiosks/k1'), kioskBefore);
});

test('mixed-client or mixed-terminal publication is rejected atomically', async () => {
  const {apply, records} = harness();
  const before = clone(records);
  for (const stationids of [['K1', 'K2'], ['K1', 'K3'], ['K1', 'A1'], ['K1', 'MISSING']]) {
    await assert.rejects(apply({profileId: 'client', expectedVersion: 3, section: 'p68', stationids}, adminAuth), {code: 'failed-precondition'});
    assert.deepEqual(records, before);
  }
});

test('publication requires the reviewed version and keeps Apollo disabled server-side', async () => {
  const {apply} = harness();
  await assert.rejects(apply({profileId: 'client', expectedVersion: 2, section: 'p68', stationids: ['K1']}, adminAuth), {code: 'aborted'});
  await assert.rejects(apply({profileId: 'client', expectedVersion: 3, section: 'apollo', stationids: ['A1']}, adminAuth), {code: 'failed-precondition'});
});

test('P68 publication preserves kiosk identity, hardware, installed UI and PINs', async () => {
  const {apply, records} = harness();
  const before = clone(records.get('kiosks/k1'));
  const result = await apply({profileId: 'client', expectedVersion: 3, section: 'p68', stationids: ['K1']}, adminAuth);
  assert.equal(result.updatedCount, 1);
  const after = records.get('kiosks/k1');
  for (const key of ['stationid', 'hardware', 'admin', 'info']) assert.deepEqual(after[key], before[key]);
  for (const key of ['mode', 'version', 'created']) assert.equal(after.ui[key], before.ui[key]);
  assert.equal(after.ui.profileSections.p68.profileId, 'client');
  assert.equal(result.kiosks[0].ui.profileSections.p68.profileId, 'client');
});

test('Kiosk access publication targets only UI-mode kiosks', async () => {
  const {apply, records} = harness();
  records.get('uiProfiles/client').admin = {userpassword: '54321', adminpassword: '43521'};
  for (const stationid of ['K1', 'K3', 'A1']) {
    await assert.rejects(apply({profileId: 'client', expectedVersion: 3, section: 'admin', stationids: [stationid]}, adminAuth), {code: 'failed-precondition'});
  }
  const result = await apply({profileId: 'client', expectedVersion: 3, section: 'admin', stationids: ['U1']}, adminAuth);
  assert.equal(result.updatedCount, 1);
  assert.equal(records.get('kiosks/u1').admin.userpassword, '54321');
  assert.equal(records.get('kiosks/u1').admin.adminpassword, '43521');
  assert.equal(records.get('kiosks/u1').ui.profileSections.admin.profileId, 'client');
});
