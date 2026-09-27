import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {canonicalJson, classifyCardMethod, createEventId, hashQrCredential, safeCardSummary, verifySignedRequest} from '../src/contracts.js';
import {buildCallbackBaseUrl, buildQrStartRequest, buildStopRequest, buildTerminalRequest, buildUiRequest} from '../src/payter.js';
import {buildAvailabilityCommand, buildVendCommand, validateQrCredential} from '../src/qr.js';
import {cstaResponseToKioskEvent, parseBrokerCredentials} from '../src/v2Gateway.js';

test('canonical JSON and event IDs are stable across key order', () => {
  assert.equal(canonicalJson({b: 2, a: {d: 4, c: 3}}), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(createEventId('card', {b: 2, a: 1}), createEventId('card', {a: 1, b: 2}));
});

test('Apollo QR cards are classified without retaining the credential', () => {
  const card = {serialNumber: 'p6x1', ifd: 'qr_code', aid: '', cardId: 'member-secret'};
  assert.equal(classifyCardMethod(card), 'QR_CODE');
  assert.equal(classifyCardMethod({...card, ifd: 'UNKNOWN'}), 'UNKNOWN');
  assert.equal(classifyCardMethod({...card, ifd: 'CONTACTLESS', maskedPan: '411111******1111'}), 'EMV');
  const summary = safeCardSummary(card);
  assert.equal(summary.serialNumber, 'P6X1');
  assert.equal(Object.hasOwn(summary, 'credentialFingerprint'), false);
  assert.equal(JSON.stringify(summary).includes('member-secret'), false);
  assert.equal(hashQrCredential(card.cardId, 'hashing-key').length, 64);
});

test('signed internal requests enforce body integrity and a five-minute clock window', () => {
  const body = {serialNumber: 'P6X1', language: 'en'};
  const timestamp = 1000000;
  const secret = 'runtime-secret';
  const signature = createHmac('sha256', secret).update(`${timestamp}.${canonicalJson(body)}`).digest('hex');
  assert.equal(verifySignedRequest({body, now: timestamp, secret, signature, timestamp}), true);
  assert.equal(verifySignedRequest({body: {...body, language: 'fr'}, now: timestamp, secret, signature, timestamp}), false);
  assert.equal(verifySignedRequest({body, now: timestamp + 300001, secret, signature, timestamp}), false);
});

test('Payter QR start request selects only QR_CODE with no authorized amount', () => {
  const request = buildQrStartRequest({apiKey: 'secret', callbackUrl: 'https://apollo.example/callbacks/token/readers/id/card', cpsEnvironment: 'test', serialNumber: 'P6X1'});
  assert.equal(request.url.origin, 'https://cps-test.mypayter.com');
  assert.equal(request.url.searchParams.get('authorizedAmount'), '0');
  assert.deepEqual(request.url.searchParams.getAll('supportedPaymentMethods'), ['QR_CODE']);
  assert.equal(request.url.searchParams.has('customIdleScreen'), false);
  assert.equal(request.url.searchParams.get('callbackUrl'), 'https://apollo.example/callbacks/token/readers/id/card');
  assert.equal(request.options.headers.Authorization.includes('secret'), true);
});

test('Payter UI and stop requests match the CPS Apollo contract', () => {
  const callbackBaseUrl = buildCallbackBaseUrl('https://apollo.example/', 'unsafe/token+=');
  assert.equal(callbackBaseUrl, 'https://apollo.example/callbacks/unsafe%2Ftoken%2B%3D');
  const ui = buildUiRequest({
    apiKey: 'secret', callbackBaseUrl, cpsEnvironment: 'test',
    properties: {title: 'Welcome', message: 'Press Start', 'buttons.ok': '', 'buttons.ok.label': 'Start'},
    screenId: 'start-1', serialNumber: 'P6X1',
  });
  assert.equal(ui.url.pathname, '/terminals/P6X1/ui');
  assert.equal(ui.url.searchParams.get('callbackUrl'), 'https://apollo.example/callbacks/unsafe%2Ftoken%2B%3D/ui');
  assert.deepEqual(JSON.parse(ui.options.body), {
    id: 'start-1', type: 'message',
    properties: {title: 'Welcome', message: 'Press Start', 'buttons.ok': '', 'buttons.ok.label': 'Start'},
  });
  const stop = buildStopRequest({apiKey: 'secret', cpsEnvironment: 'test', serialNumber: 'P6X1'});
  assert.equal(stop.url.pathname, '/terminals/P6X1/stop');
  assert.equal(stop.options.method, 'POST');
  const terminal = buildTerminalRequest({apiKey: 'secret', cpsEnvironment: 'test', serialNumber: 'P6X1'});
  assert.equal(terminal.url.pathname, '/terminals/P6X1');
  assert.equal(terminal.options.method, 'GET');
});

test('QR credentials fail closed and commands use the established V2 CSTA contract', () => {
  const base = {enabled: true, clientId: 'CLIENT', remainingUses: 1, expiresAt: '2030-01-01T00:00:00Z'};
  assert.deepEqual(validateQrCredential(base, {clientId: 'CLIENT', now: Date.parse('2029-01-01')}), {ok: true});
  assert.equal(validateQrCredential({...base, remainingUses: 0}, {clientId: 'CLIENT'}).reason, 'credential_consumed');
  assert.equal(validateQrCredential({...base, pendingSessionId: 'other'}, {clientId: 'CLIENT'}).reason, 'credential_in_use');
  assert.equal(validateQrCredential({...base, provider: 'library'}, {clientId: 'CLIENT'}).reason, 'wrong_provider');
  assert.deepEqual(buildAvailabilityCommand({sessionId: 'session123', stationId: 'us8001', terminalSerial: 'P6X1', now: 123}), {
    action: 'status', stationid: 'US8001', terminalsn: 'P6X1', requestId: 'apollo-uslab-status-session123', timerequested: 123,
  });
  const vend = buildVendCommand({chargerId: '41807101', clientId: 'CLIENT', credentialProvider: 'library', sessionId: 'session123', stationId: 'US8001', terminalSerial: 'P6X1', module: 'M1', slot: 2, now: 123});
  assert.equal(vend.action, 'vend');
  assert.equal(vend.requestId, 'apollo-uslab-vend-session123');
  assert.equal(vend.gateway, 'SCANNER');
  assert.equal(vend.terminalGateway, 'APOLLO');
  assert.equal(vend.authorizationSource, 'QR_CODE');
  assert.equal(vend.authorizationStatus, 'qr_validated');
  assert.equal(vend.paymentStatus, 'not_required');
  assert.equal(vend.source, 'scanner');
  assert.equal(vend.credentialProvider, 'library');
  assert.equal(vend.chargerid, 41807101);
});

test('V2 responses are correlated and converted only for Apollo U.S. lab requests', () => {
  const available = cstaResponseToKioskEvent('CSTA/post/US8001', {
    action: 'status', stationid: 'US8001', requestId: 'apollo-uslab-status-session123',
    status: [41807101], moduleid: 'M1', vendbattery: {sn: 41807101, slot: 2},
  });
  assert.deepEqual(available, {
    schemaVersion: 1, type: 'availability_result', sessionId: 'session123', commandId: 'availability:session123',
    available: true, module: 'M1', slot: 2, chargerId: '41807101',
  });
  const success = cstaResponseToKioskEvent('CSTA/post/US8001', {
    action: 'vend', stationid: 'US8001', requestId: 'apollo-uslab-vend-session123',
    status: 1, status_en: 'charger ejected', moduleid: 'M1', slotid: 2, chargerid: 41807101,
  });
  assert.equal(success.success, true);
  assert.equal(cstaResponseToKioskEvent('CSTA/post/US8001', {...success, requestId: 'payter-vend-session123'}), null);
  assert.equal(cstaResponseToKioskEvent('CSTA/post/US8002', {action: 'vend', stationid: 'US8001', requestId: 'apollo-uslab-vend-session123'}), null);
});

test('successful physical returns are accepted only from the established V2 return topic', () => {
  const returned = cstaResponseToKioskEvent('CSTA/post', {
    action: 'return', stationid: 'us8004', status: 1, moduleid: 'M1', slotid: 3, chargerid: 41807101, timeresponded: 123,
  });
  assert.deepEqual(returned, {
    schemaVersion: 1, type: 'return_result', stationId: 'US8004', success: true,
    module: 'M1', slot: 3, chargerId: '41807101', returnedAt: 123,
  });
  assert.equal(cstaResponseToKioskEvent('CSTA/post', {...returned, action: 'return', stationid: 'US8004', status: 0}), null);
  assert.equal(cstaResponseToKioskEvent('CSTA/post/US8004', {action: 'return', stationid: 'US8004', status: 1, moduleid: 'M1', slotid: 3, chargerid: 41807101}), null);
});

test('V2 broker credentials are parsed without accepting incomplete secrets', () => {
  assert.deepEqual(parseBrokerCredentials('{"username":"service","password":"secret"}'), {username: 'service', password: 'secret'});
  assert.throws(() => parseBrokerCredentials('{"username":"service"}'), /incomplete/);
});
