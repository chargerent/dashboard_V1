import {FieldValue, Timestamp} from '@google-cloud/firestore';
import {APOLLO_QR_VEND_GATEWAY, APOLLO_TERMINAL_GATEWAY, hashQrCredential} from './contracts.js';
import {validateQrCredential} from './qr.js';

function eventRef(db, eventId) {
  return db.collection('apolloRuntimeEvents').doc(eventId);
}

export async function claimEvent(db, envelope) {
  return db.runTransaction(async (transaction) => {
    const ref = eventRef(db, envelope.eventId);
    const snap = await transaction.get(ref);
    if (snap.exists && snap.data()?.status !== 'failed') return false;
    const value = {
      eventId: envelope.eventId,
      type: envelope.type,
      receivedAt: envelope.receivedAt,
      status: 'processing',
      detail: '',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    if (snap.exists) transaction.set(ref, value, {merge: true});
    else transaction.create(ref, value);
    return true;
  });
}

export async function completeEvent(db, eventId, status = 'complete', detail = '') {
  await eventRef(db, eventId).set({status, detail: String(detail).slice(0, 500), completedAt: FieldValue.serverTimestamp()}, {merge: true});
}

export async function beginQrVendSession({clientId, db, environment, language, releaseId, screenId, serial, sessionId, stationId}) {
  const sessionRef = db.collection('apolloVendSessions').doc(sessionId);
  const runtimeRef = db.collection('apolloTerminalRuntime').doc(serial);
  return db.runTransaction(async (transaction) => {
    const [sessionSnap, runtimeSnap] = await Promise.all([transaction.get(sessionRef), transaction.get(runtimeRef)]);
    if (sessionSnap.exists) return {created: false, reason: 'duplicate_session', session: sessionSnap.data()};
    const terminalRuntime = runtimeSnap.exists ? runtimeSnap.data() || {} : {};
    if (terminalRuntime.state !== 'idle' || terminalRuntime.activeScreenId !== screenId) {
      return {created: false, reason: 'stale_start_screen'};
    }
    const session = {
      schemaVersion: 1,
      sessionId,
      environment,
      clientId,
      stationId,
      terminalSerial: serial,
      gateway: APOLLO_QR_VEND_GATEWAY,
      terminalGateway: APOLLO_TERMINAL_GATEWAY,
      authorizationSource: 'QR_CODE',
      source: 'scanner',
      paymentStatus: 'not_required',
      releaseId,
      language,
      state: 'awaiting_availability',
      availabilityCommandId: `availability:${sessionId}`,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(sessionRef, session);
    transaction.set(runtimeRef, {
      activeSessionId: sessionId,
      state: 'checking_inventory',
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return {created: true, session};
  });
}

export async function readSession(db, sessionId) {
  const snap = await db.collection('apolloVendSessions').doc(sessionId).get();
  return snap.exists ? snap.data() : null;
}

export async function advanceToQrScan(db, event) {
  const sessionRef = db.collection('apolloVendSessions').doc(event.sessionId);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(sessionRef);
    if (!snap.exists) return {ok: false, reason: 'unknown_session'};
    const session = snap.data();
    if (session.state === 'awaiting_qr' || session.state === 'awaiting_vend' || session.state === 'completed') {
      return {ok: false, reason: 'already_advanced', session};
    }
    if (session.state !== 'awaiting_availability' || session.availabilityCommandId !== event.commandId) {
      return {ok: false, reason: 'unexpected_state', session};
    }
    if (!event.available || event.module === undefined || event.slot === undefined || !event.chargerId) {
      const failed = {...session, state: 'failed', failureReason: 'unavailable'};
      transaction.update(sessionRef, {state: 'failed', failureReason: 'unavailable', updatedAt: FieldValue.serverTimestamp()});
      return {ok: false, reason: 'unavailable', session: failed};
    }
    const next = {
      ...session,
      state: 'awaiting_qr',
      module: String(event.module),
      slot: String(event.slot),
      chargerId: String(event.chargerId),
    };
    transaction.update(sessionRef, {
      state: next.state,
      module: next.module,
      slot: next.slot,
      chargerId: next.chargerId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {ok: true, session: next};
  });
}

export async function authorizeQrForVend({acceptAnyQr = false, clientId, credentialProvider, db, environment, qrHashKey, rawCredential, sessionId}) {
  if (acceptAnyQr && environment !== 'us-lab') throw new Error('Test QR bypass is restricted to the U.S. lab.');
  const credentialHash = hashQrCredential(rawCredential, qrHashKey);
  const sessionRef = db.collection('apolloVendSessions').doc(sessionId);
  const credentialRef = db.collection('apolloQrCredentials').doc(credentialHash);
  return db.runTransaction(async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists) return {ok: false, reason: 'unknown_session'};
    const session = sessionSnap.data();
    if (session.state === 'awaiting_vend' || session.state === 'completed') return {ok: false, reason: 'already_authorized', session};
    if (session.state !== 'awaiting_qr') return {ok: false, reason: 'unexpected_state', session};
    if (session.clientId !== clientId || session.environment !== environment) return {ok: false, reason: 'session_scope_mismatch', session};

    let provider = credentialProvider;
    let authorizationMode = 'issued';
    if (acceptAnyQr) {
      provider = 'test-any';
      authorizationMode = 'test_any';
    } else {
      const credentialSnap = await transaction.get(credentialRef);
      const validation = validateQrCredential(credentialSnap.exists ? credentialSnap.data() : null, {clientId, provider: credentialProvider});
      if (!validation.ok) return {ok: false, credentialHash, reason: validation.reason, session};
      transaction.update(credentialRef, {pendingSessionId: sessionId, pendingAt: FieldValue.serverTimestamp()});
    }

    const vendCommandId = `vend:${sessionId}`;
    const next = {
      ...session,
      state: 'awaiting_vend',
      vendCommandId,
      credentialHash,
      credentialProvider: provider,
      authorizationMode,
    };
    transaction.update(sessionRef, {
      state: next.state,
      vendCommandId,
      credentialHash,
      credentialProvider: provider,
      authorizationMode,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {ok: true, credentialHash, session: next};
  });
}

export async function finalizeVend(db, event) {
  const sessionRef = db.collection('apolloVendSessions').doc(event.sessionId);
  return db.runTransaction(async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists) return {ok: false, reason: 'unknown_session'};
    const session = sessionSnap.data();
    if (session.state === 'completed') return {ok: true, duplicate: true, session};
    if (session.state !== 'awaiting_vend' || session.vendCommandId !== event.commandId) return {ok: false, reason: 'unexpected_state'};

    const usesIssuedCredential = session.authorizationMode !== 'test_any';
    let credentialRef;
    let credentialSnap;
    if (usesIssuedCredential) {
      credentialRef = db.collection('apolloQrCredentials').doc(session.credentialHash);
      credentialSnap = await transaction.get(credentialRef);
      if (!credentialSnap.exists || credentialSnap.data()?.pendingSessionId !== event.sessionId) {
        transaction.update(sessionRef, {state: 'failed', failureReason: 'credential_reservation_lost', updatedAt: FieldValue.serverTimestamp()});
        return {ok: false, reason: 'credential_reservation_lost', session};
      }
    }

    if (!event.success) {
      if (usesIssuedCredential) transaction.update(credentialRef, {pendingSessionId: FieldValue.delete(), pendingAt: FieldValue.delete()});
      transaction.update(sessionRef, {state: 'failed', failureReason: event.reason || 'vend_failed', updatedAt: FieldValue.serverTimestamp()});
      return {ok: false, reason: 'vend_failed', session};
    }

    if (usesIssuedCredential) {
      const remainingUses = Number(credentialSnap.data().remainingUses);
      if (!Number.isInteger(remainingUses) || remainingUses < 1) return {ok: false, reason: 'credential_consumed', session};
      transaction.update(credentialRef, {
        remainingUses: remainingUses - 1,
        pendingSessionId: FieldValue.delete(),
        pendingAt: FieldValue.delete(),
        lastUsedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.update(sessionRef, {
      state: 'completed', chargerId: event.chargerId || session.chargerId || '', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(db.collection('apolloLabRentals').doc(event.sessionId), {
      schemaVersion: 1,
      sessionId: event.sessionId,
      clientId: session.clientId,
      stationId: session.stationId,
      terminalSerial: session.terminalSerial,
      releaseId: session.releaseId,
      chargerId: event.chargerId || session.chargerId || '',
      module: session.module,
      slot: session.slot,
      credentialHash: session.credentialHash,
      credentialProvider: session.credentialProvider || 'chargerent-issued',
      authorizationMode: session.authorizationMode || 'issued',
      gateway: APOLLO_QR_VEND_GATEWAY,
      terminalGateway: APOLLO_TERMINAL_GATEWAY,
      authorizationSource: 'QR_CODE',
      source: 'scanner',
      paymentStatus: 'not_required',
      status: 'dispensed',
      createdAt: FieldValue.serverTimestamp(),
    });
    return {ok: true, session};
  });
}

export async function failSession(db, session, reason) {
  if (!session?.sessionId) return;
  const credentialRef = session.credentialHash ? db.collection('apolloQrCredentials').doc(session.credentialHash) : null;
  const sessionRef = db.collection('apolloVendSessions').doc(session.sessionId);
  await db.runTransaction(async (transaction) => {
    if (credentialRef && session.authorizationMode !== 'test_any') {
      const credentialSnap = await transaction.get(credentialRef);
      if (credentialSnap.exists && credentialSnap.data()?.pendingSessionId === session.sessionId) {
        transaction.update(credentialRef, {pendingSessionId: FieldValue.delete(), pendingAt: FieldValue.delete()});
      }
    }
    transaction.set(sessionRef, {state: 'failed', failureReason: reason, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
  });
}

// Compatibility alias for earlier lab scripts.
export const releaseCredentialReservation = failSession;
