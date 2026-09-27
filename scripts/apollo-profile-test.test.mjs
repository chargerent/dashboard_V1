import test from 'node:test';
import assert from 'node:assert/strict';
import {createApolloScreen, emptyApolloScreenFlow} from '../functions/apolloScreens.mjs';
import {handleApolloProfileTestCallback, readApolloProfileTest, startApolloProfileTest} from '../functions/apolloProfileTest.mjs';

const clone = (value) => structuredClone(value);

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class MemorySnapshot {
  constructor(ref, value) {
    this.id = ref.id;
    this.ref = ref;
    this.exists = value !== undefined;
    this.value = value;
  }

  data() {
    return clone(this.value);
  }
}

class MemoryDocumentRef {
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
    this.id = id;
  }

  async get() {
    return new MemorySnapshot(this, this.db.values.get(`${this.collectionName}/${this.id}`));
  }

  async set(value) {
    this.db.values.set(`${this.collectionName}/${this.id}`, clone(value));
  }

  async update(patch) {
    const key = `${this.collectionName}/${this.id}`;
    this.db.values.set(key, {...clone(this.db.values.get(key)), ...clone(patch)});
  }

  async delete() {
    this.db.values.delete(`${this.collectionName}/${this.id}`);
  }
}

class MemoryCollection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  doc(id = '') {
    const resolvedId = id || `test-${++this.db.sequence}`;
    return new MemoryDocumentRef(this.db, this.name, resolvedId);
  }

  where(field, operation, expected) {
    assert.equal(operation, '==');
    return {
      get: async () => {
        const prefix = `${this.name}/`;
        const docs = [...this.db.values.entries()]
          .filter(([key, value]) => key.startsWith(prefix) && value?.[field] === expected)
          .map(([key, value]) => new MemorySnapshot(this.doc(key.slice(prefix.length)), value));
        return {docs, size: docs.length};
      },
    };
  }
}

class MemoryDb {
  constructor(seed) {
    this.values = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
    this.sequence = 0;
  }

  collection(name) {
    return new MemoryCollection(this, name);
  }

  async runTransaction(handler) {
    return handler({
      get: (target) => target.get(),
      set: (target, value) => target.set(value),
      update: (target, patch) => target.update(patch),
      delete: (target) => target.delete(),
    });
  }
}

function testFlow() {
  const first = createApolloScreen([]);
  const second = createApolloScreen([first], 'selection');
  first.name = 'Welcome';
  first.buttons[0].next = second.id;
  second.name = 'Confirm';
  return {...emptyApolloScreenFlow(), entryScreenId: first.id, screens: [first, second]};
}

function setup(overrides = {}) {
  const flow = testFlow();
  const seed = {
    'payterRuntime/current': {
      apolloProfileTestsEnabled: true,
      apolloTestStationIds: ['CA0007'],
      apolloCpsEnvironment: 'test',
    },
    'uiProfiles/test': {
      clientId: 'TEST',
      version: 4,
      terminalProfiles: {apollo: {translations: {en: {}}, screenFlow: flow}},
    },
    'kiosks/kiosk-1': {
      stationid: 'CA0007',
      info: {client: 'TEST'},
      hardware: {gateway: 'APOLLO', sn: 'SERIAL-7'},
    },
    ...overrides,
  };
  const db = new MemoryDb(seed);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({url: String(url), options: clone({...options, signal: undefined})});
    return {ok: true, status: 200};
  };
  const deps = {
    HttpsError: TestHttpsError,
    apiKey: 'test-api-key',
    callbackUrl: 'https://example.test/apolloProfile_testCallback',
    db,
    fetchImpl,
    isApolloAdmin: (auth) => auth.isAdmin === true,
    loadScreenHelpers: () => import('../functions/apolloScreens.mjs'),
    now: () => Date.parse('2026-09-08T00:00:00.000Z'),
    randomBytes: () => Buffer.alloc(32, 7),
  };
  return {db, deps, flow, requests};
}

const adminAuth = {uid: 'admin-1', isAdmin: true, profile: {username: 'george'}};
const startData = {profileId: 'test', expectedVersion: 4, stationid: 'CA0007', language: 'en'};

test('starts an allowlisted client-wide Apollo screen test and follows callbacks without payment or vend actions', async () => {
  const {db, deps, requests} = setup();
  const started = await startApolloProfileTest(startData, adminAuth, deps);
  assert.deepEqual(started, {
    id: 'test-1', stationid: 'CA0007', profileId: 'test', profileVersion: 4,
    status: 'waiting', currentScreenId: 'custom_1', completionAction: '', error: '',
    createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    expiresAt: '2026-09-08T00:15:00.000Z',
  });
  assert.equal('serialNumber' in started, false);
  assert.equal(requests.length, 1);
  const initialUrl = new URL(requests[0].url);
  assert.equal(initialUrl.origin, 'https://cps-test.mypayter.com');
  assert.equal(initialUrl.pathname, '/terminals/SERIAL-7/ui');
  assert.equal(requests[0].options.headers.Authorization, 'CPS apikey="test-api-key"');
  const initialPayload = JSON.parse(requests[0].options.body);
  assert.equal(initialPayload.type, 'message');
  assert.equal(initialPayload.properties['buttons.button_1.label'], 'Continue');
  assert.equal(JSON.stringify(initialPayload).includes('payment'), false);
  assert.equal(JSON.stringify(initialPayload).includes('vend'), false);
  await assert.rejects(startApolloProfileTest(startData, adminAuth, deps), /active Apollo screen test/);
  assert.equal(requests.length, 1);

  const callbackUrl = new URL(initialUrl.searchParams.get('callbackUrl'));
  const query = Object.fromEntries(callbackUrl.searchParams);
  await handleApolloProfileTestCallback(query, {
    serialNumber: 'SERIAL-7', screenId: initialPayload.id, response: 'button_1',
  }, deps);
  assert.equal(requests.length, 2);
  const nextPayload = JSON.parse(requests[1].options.body);
  assert.equal(nextPayload.type, 'selection');
  assert.equal(nextPayload.id.includes('custom_2'), true);

  const completed = await handleApolloProfileTestCallback(query, {
    serialNumber: 'SERIAL-7', screenId: nextPayload.id, response: 'button_1',
  }, deps);
  assert.deepEqual(completed, {ok: true, status: 'complete', action: 'continue_existing_flow'});
  assert.equal(requests.length, 2);
  const stored = (await db.collection('apolloProfileTests').doc(started.id).get()).data();
  assert.equal(stored.status, 'complete');
  assert.equal(stored.completionAction, 'continue_existing_flow');
  assert.equal((await db.collection('apolloProfileTestLocks').doc('CA0007').get()).exists, false);

  const duplicate = await handleApolloProfileTestCallback(query, {
    serialNumber: 'SERIAL-7', screenId: nextPayload.id, response: 'button_1',
  }, deps);
  assert.deepEqual(duplicate, {ok: true, duplicate: true, status: 'complete'});
  assert.equal(requests.length, 2);
});

test('rejects disabled, non-allowlisted, wrong-gateway, cross-client and stale profile tests', async () => {
  const cases = [
    {
      name: 'locked runtime',
      overrides: {'payterRuntime/current': {apolloProfileTestsEnabled: false, apolloTestStationIds: ['CA0007']}},
      message: /locked/,
    },
    {
      name: 'not allowlisted',
      overrides: {'payterRuntime/current': {apolloProfileTestsEnabled: true, apolloTestStationIds: []}},
      message: /allowlisted/,
    },
    {
      name: 'APO is not APOLLO',
      overrides: {'kiosks/kiosk-1': {stationid: 'CA0007', info: {client: 'TEST'}, hardware: {gateway: 'APO', sn: 'SERIAL-7'}}},
      message: /not an APOLLO/,
    },
    {
      name: 'different client',
      overrides: {'kiosks/kiosk-1': {stationid: 'CA0007', info: {client: 'YYZ'}, hardware: {gateway: 'APOLLO', sn: 'SERIAL-7'}}},
      message: /not assigned/,
    },
  ];
  for (const scenario of cases) {
    const {deps, requests} = setup(scenario.overrides);
    await assert.rejects(startApolloProfileTest(startData, adminAuth, deps), scenario.message, scenario.name);
    assert.equal(requests.length, 0, scenario.name);
  }
  const {deps, requests} = setup();
  await assert.rejects(startApolloProfileTest({...startData, expectedVersion: 3}, adminAuth, deps), /changed/);
  assert.equal(requests.length, 0);
  await assert.rejects(startApolloProfileTest(startData, {isAdmin: false, profile: {}}, deps), /administrator/);
});

test('requires a saved entry screen and expires abandoned sessions', async () => {
  const profile = {
    clientId: 'TEST', version: 4,
    terminalProfiles: {apollo: {translations: {en: {}}, screenFlow: emptyApolloScreenFlow()}},
  };
  const {deps, requests} = setup({'uiProfiles/test': profile});
  await assert.rejects(startApolloProfileTest(startData, adminAuth, deps), /Choose an added screen/);
  assert.equal(requests.length, 0);

  const active = setup();
  const started = await startApolloProfileTest(startData, adminAuth, active.deps);
  const expired = await readApolloProfileTest({testId: started.id}, adminAuth, {
    ...active.deps,
    now: () => Date.parse('2026-09-08T00:16:00.000Z'),
  });
  assert.equal(expired.status, 'expired');
});
