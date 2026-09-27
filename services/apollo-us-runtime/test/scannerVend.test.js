import test from 'node:test';
import assert from 'node:assert/strict';
import {hashQrCredential} from '../src/contracts.js';
import {advanceToQrScan, authorizeQrForVend, beginQrVendSession, finalizeVend} from '../src/store.js';

class MemoryDb {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  collection(name) {
    return {doc: (id) => ({id, path: `${name}/${id}`})};
  }

  async runTransaction(handler) {
    const snapshot = (ref) => ({exists: this.values.has(ref.path), data: () => this.values.get(ref.path)});
    return handler({
      get: async (ref) => snapshot(ref),
      create: (ref, value) => {
        if (this.values.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
        this.values.set(ref.path, {...value});
      },
      set: (ref, value, options = {}) => {
        this.values.set(ref.path, options.merge ? {...(this.values.get(ref.path) || {}), ...value} : {...value});
      },
      update: (ref, value) => {
        if (!this.values.has(ref.path)) throw new Error(`Document does not exist: ${ref.path}`);
        this.values.set(ref.path, {...this.values.get(ref.path), ...value});
      },
    });
  }
}

test('Apollo QR sessions and completed rentals retain Scanner gateway semantics', async () => {
  const qrHashKey = 'scanner-test-key';
  const rawCredential = 'member-qr-value';
  const credentialHash = hashQrCredential(rawCredential, qrHashKey);
  const db = new MemoryDb({
    'apolloTerminalRuntime/APO20242802258': {state: 'idle', activeScreenId: 'start-1'},
    [`apolloQrCredentials/${credentialHash}`]: {
      enabled: true,
      clientId: 'BESITER',
      provider: 'chargerent-issued',
      remainingUses: 1,
    },
  });

  const started = await beginQrVendSession({
    clientId: 'BESITER',
    db,
    environment: 'us-lab',
    language: 'en',
    releaseId: 'besiter-apollo-v1',
    screenId: 'start-1',
    serial: 'APO20242802258',
    sessionId: 'event-1',
    stationId: 'US8004',
  });

  assert.equal(started.created, true);
  assert.equal(started.session.gateway, 'SCANNER');
  assert.equal(started.session.terminalGateway, 'APOLLO');
  assert.equal(started.session.authorizationSource, 'QR_CODE');
  assert.equal(started.session.paymentStatus, 'not_required');

  const available = await advanceToQrScan(db, {
    sessionId: 'event-1',
    commandId: 'availability:event-1',
    available: true,
    module: '868998088454331',
    slot: 1,
    chargerId: '41807101',
  });
  assert.equal(available.ok, true);

  const authorized = await authorizeQrForVend({
    clientId: 'BESITER',
    credentialProvider: 'chargerent-issued',
    db,
    environment: 'us-lab',
    qrHashKey,
    rawCredential,
    sessionId: 'event-1',
  });
  assert.equal(authorized.ok, true);

  const completed = await finalizeVend(db, {
    sessionId: 'event-1',
    commandId: 'vend:event-1',
    success: true,
    chargerId: '41807101',
  });
  assert.equal(completed.ok, true);

  const rental = db.values.get('apolloLabRentals/event-1');
  assert.equal(rental.gateway, 'SCANNER');
  assert.equal(rental.terminalGateway, 'APOLLO');
  assert.equal(rental.authorizationSource, 'QR_CODE');
  assert.equal(rental.source, 'scanner');
  assert.equal(rental.paymentStatus, 'not_required');
  assert.equal(rental.status, 'dispensed');
});

test('any QR is accepted only by the explicit U.S. lab test mode and is never stored raw', async () => {
  const db = new MemoryDb({'apolloTerminalRuntime/APO20242802258': {state: 'idle', activeScreenId: 'start-2'}});
  await beginQrVendSession({
    clientId: 'SMPL', db, environment: 'us-lab', language: 'en', releaseId: 'smpl-v1',
    screenId: 'start-2', serial: 'APO20242802258', sessionId: 'event-2', stationId: 'US8004',
  });
  await advanceToQrScan(db, {
    sessionId: 'event-2', commandId: 'availability:event-2', available: true,
    module: '868998088454331', slot: 1, chargerId: '41807101',
  });
  const rawCredential = 'any-test-qr-value';
  const authorized = await authorizeQrForVend({
    acceptAnyQr: true, clientId: 'SMPL', credentialProvider: 'chargerent-issued', db,
    environment: 'us-lab', qrHashKey: 'scanner-test-key', rawCredential, sessionId: 'event-2',
  });
  assert.equal(authorized.ok, true);
  assert.equal(authorized.session.authorizationMode, 'test_any');
  assert.equal(authorized.session.credentialProvider, 'test-any');
  assert.equal(JSON.stringify([...db.values.values()]).includes(rawCredential), false);

  const completed = await finalizeVend(db, {
    sessionId: 'event-2', commandId: 'vend:event-2', success: true, chargerId: '41807101',
  });
  assert.equal(completed.ok, true);
  assert.equal(db.values.get('apolloLabRentals/event-2').authorizationMode, 'test_any');

  await assert.rejects(() => authorizeQrForVend({
    acceptAnyQr: true, clientId: 'SMPL', credentialProvider: 'chargerent-issued', db,
    environment: 'us-prod', qrHashKey: 'scanner-test-key', rawCredential, sessionId: 'event-2',
  }), /restricted to the U.S. lab/);
});
