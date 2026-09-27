import {availabilityRequestId, vendRequestId} from './v2Gateway.js';
import {APOLLO_QR_VEND_GATEWAY, APOLLO_TERMINAL_GATEWAY} from './contracts.js';

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

export function validateQrCredential(credential, {clientId, provider = 'chargerent-issued', now = Date.now()} = {}) {
  if (!credential || credential.enabled !== true) return {ok: false, reason: 'credential_disabled'};
  if (String(credential.clientId || '').trim().toUpperCase() !== String(clientId || '').trim().toUpperCase()) {
    return {ok: false, reason: 'wrong_client'};
  }
  if (String(credential.provider || 'chargerent-issued').trim().toLowerCase() !== String(provider).trim().toLowerCase()) {
    return {ok: false, reason: 'wrong_provider'};
  }
  const expiresAt = toMillis(credential.expiresAt);
  if (expiresAt && expiresAt <= now) return {ok: false, reason: 'credential_expired'};
  const remainingUses = Number(credential.remainingUses);
  if (!Number.isInteger(remainingUses) || remainingUses < 1) return {ok: false, reason: 'credential_consumed'};
  if (credential.pendingSessionId) return {ok: false, reason: 'credential_in_use'};
  return {ok: true};
}

export function buildAvailabilityCommand({sessionId, stationId, terminalSerial, now = Date.now()}) {
  return {
    action: 'status',
    stationid: String(stationId).trim().toUpperCase(),
    terminalsn: String(terminalSerial || '').trim(),
    requestId: availabilityRequestId(sessionId),
    timerequested: now,
  };
}

export function buildVendCommand({chargerId, clientId, credentialProvider, module, sessionId, slot, stationId, terminalSerial, now = Date.now()}) {
  const numericChargerId = Number(chargerId);
  const numericSlot = Number(slot);
  if (!Number.isFinite(numericChargerId) || numericChargerId <= 0) throw new Error('A valid V2 charger serial is required.');
  if (!Number.isFinite(numericSlot) || numericSlot < 0) throw new Error('A valid V2 slot is required.');
  const requestedAt = new Date(now).toISOString();
  const orderId = `apollo-uslab-${sessionId}`;
  return {
    action: 'vend',
    stationid: String(stationId).trim().toUpperCase(),
    requestId: vendRequestId(sessionId),
    orderid: orderId,
    rawid: orderId,
    rentalId: orderId,
    interactionId: sessionId,
    chargerid: numericChargerId,
    moduleid: String(module ?? ''),
    slotid: numericSlot,
    rentalTime: requestedAt,
    timerequested: now,
    gateway: APOLLO_QR_VEND_GATEWAY,
    terminalGateway: APOLLO_TERMINAL_GATEWAY,
    authorizationSource: 'QR_CODE',
    authorizationStatus: 'qr_validated',
    credentialProvider: String(credentialProvider || 'chargerent-issued').trim().toLowerCase(),
    source: 'scanner',
    sourceSystem: 'apollo-us-lab',
    terminalsn: String(terminalSerial || '').trim(),
    clientId: String(clientId || '').trim(),
    paymentStatus: 'not_required',
  };
}
