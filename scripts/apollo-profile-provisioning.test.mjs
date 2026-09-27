import test from 'node:test';
import assert from 'node:assert/strict';
import {seedApolloClientProfileOnProvision} from '../functions/apolloProfileProvisioning.mjs';
import {YYZ_APOLLO_PROFILE_TEMPLATE_META, YYZ_APOLLO_TRANSLATIONS} from '../functions/apolloProfileTemplate.mjs';

const clone = (value) => structuredClone(value);

class Snapshot {
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

class DocumentRef {
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
    this.id = id;
  }

  async get() {
    return new Snapshot(this, this.db.values.get(`${this.collectionName}/${this.id}`));
  }

  async set(value, options = {}) {
    const key = `${this.collectionName}/${this.id}`;
    const previous = this.db.values.get(key) || {};
    this.db.values.set(key, options.merge ? {...clone(previous), ...clone(value)} : clone(value));
  }
}

class CollectionRef {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  doc(id) {
    return new DocumentRef(this.db, this.name, id);
  }

  where(field, operation, expected) {
    assert.equal(operation, '==');
    return {
      get: async () => {
        const prefix = `${this.name}/`;
        const docs = [...this.db.values.entries()]
          .filter(([key, value]) => key.startsWith(prefix) && value?.[field] === expected)
          .map(([key, value]) => new Snapshot(this.doc(key.slice(prefix.length)), value));
        return {docs, size: docs.length};
      },
    };
  }
}

class Db {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
  }

  collection(name) {
    return new CollectionRef(this, name);
  }

  async runTransaction(handler) {
    return handler({
      get: (ref) => ref.get(),
      set: (ref, value, options) => ref.set(value, options),
    });
  }
}

const timestamp = {seconds: 1, nanoseconds: 0};
const apolloKiosk = {
  stationid: 'CA1234',
  status: 'PENDING',
  info: {client: 'NEW CLIENT'},
  hardware: {gateway: 'APOLLO', sn: 'SERIAL-1234'},
};

test('new Apollo kiosk provisioning creates one saved client profile from the YYZ default', async () => {
  const db = new Db();
  const result = await seedApolloClientProfileOnProvision({
    before: {status: 'pending-provision', hardware: {gateway: 'APOLLO'}},
    after: apolloKiosk,
    db,
    serverTimestamp: () => timestamp,
  });
  assert.deepEqual(result, {created: true, updated: false, profileId: 'new-client', clientId: 'NEW CLIENT'});
  const saved = (await db.collection('uiProfiles').doc('new-client').get()).data();
  assert.equal(saved.clientId, 'NEW CLIENT');
  assert.equal(saved.version, 1);
  assert.equal(saved.sectionVersions.apollo, 1);
  assert.deepEqual(saved.terminalProfiles.apollo.template, YYZ_APOLLO_PROFILE_TEMPLATE_META);
  assert.deepEqual(saved.terminalProfiles.apollo.translations, YYZ_APOLLO_TRANSLATIONS);
  assert.deepEqual(saved.terminalProfiles.apollo.screenFlow, {version: 1, entryScreenId: '', screens: [], removedEstablishedScreenIds: []});
});

test('first Apollo kiosk adds only the missing section to an existing client profile', async () => {
  const existing = {
    clientId: 'NEW CLIENT', version: 8,
    admin: {userpassword: '12345'},
    ui: {colors: {bcolor1: '#123456'}},
    terminalProfiles: {p68: {overrides: {CA0001: {locales: {}}}}},
    sectionVersions: {kiosk: 3, p68: 2},
  };
  const db = new Db({'uiProfiles/legacy-profile': existing});
  const result = await seedApolloClientProfileOnProvision({
    before: null, after: apolloKiosk, db, serverTimestamp: () => timestamp,
  });
  assert.equal(result.updated, true);
  assert.equal(result.profileId, 'legacy-profile');
  const saved = (await db.collection('uiProfiles').doc('legacy-profile').get()).data();
  assert.deepEqual(saved.admin, existing.admin);
  assert.deepEqual(saved.ui, existing.ui);
  assert.deepEqual(saved.terminalProfiles.p68, existing.terminalProfiles.p68);
  assert.equal(saved.terminalProfiles.apollo.template.id, 'yyz-apollo-v1');
  assert.deepEqual(saved.sectionVersions, {kiosk: 3, p68: 2, apollo: 1});
  assert.equal(saved.version, 9);
});

test('provisioning is idempotent and never overwrites an edited client Apollo profile', async () => {
  const edited = {
    clientId: 'NEW CLIENT', version: 4,
    terminalProfiles: {apollo: {translations: {en: {startpage: {title: 'Client title'}}}}},
  };
  const db = new Db({'uiProfiles/new-client': edited});
  const result = await seedApolloClientProfileOnProvision({
    before: null, after: apolloKiosk, db, serverTimestamp: () => timestamp,
  });
  assert.equal(result.reason, 'already-seeded');
  assert.deepEqual((await db.collection('uiProfiles').doc('new-client').get()).data(), edited);

  const unchanged = await seedApolloClientProfileOnProvision({
    before: apolloKiosk, after: {...apolloKiosk, timestamp: 'new telemetry'}, db, serverTimestamp: () => timestamp,
  });
  assert.equal(unchanged.reason, 'unchanged');
});

test('fails closed for APO, pending provisioning and missing terminal identity', async () => {
  const cases = [
    {...apolloKiosk, hardware: {...apolloKiosk.hardware, gateway: 'APO'}},
    {...apolloKiosk, status: 'pending-provision'},
    {...apolloKiosk, stationid: ''},
    {...apolloKiosk, hardware: {...apolloKiosk.hardware, sn: ''}},
    {...apolloKiosk, info: {client: ''}},
  ];
  for (const after of cases) {
    const db = new Db();
    const result = await seedApolloClientProfileOnProvision({before: null, after, db, serverTimestamp: () => timestamp});
    assert.equal(result.reason, 'not-apollo');
    assert.equal(db.values.size, 0);
  }
});
