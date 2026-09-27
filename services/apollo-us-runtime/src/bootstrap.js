import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Firestore, FieldValue} from '@google-cloud/firestore';
import mqtt from 'mqtt';
import {createYyzApolloProfileSection, YYZ_APOLLO_PROFILE_TEMPLATE_META} from '../../../functions/apolloProfileTemplate.mjs';
import {validateApolloScreenFlow} from '../../../functions/apolloScreens.mjs';
import {buildCallbackBaseUrl, buildTerminalRequest, buildUiRequest, callPayter} from './payter.js';
import {apolloReleaseSchema, resolveTerminalProfile} from './profile.js';
import {startScreenProperties} from './runtime.js';
import {APOLLO_TERMINAL_GATEWAY, canonicalJson, hashQrCredential, normalizeSerial, sha256} from './contracts.js';
import {loadConfig} from './config.js';
import {buildAvailabilityCommand} from './qr.js';
import {createSecretLoader} from './secrets.js';
import {cstaResponseToKioskEvent, parseBrokerCredentials} from './v2Gateway.js';

const config = loadConfig();
const db = new Firestore({projectId: config.GOOGLE_CLOUD_PROJECT, databaseId: config.FIRESTORE_DATABASE});
const loadSecret = createSecretLoader({projectId: config.GOOGLE_CLOUD_PROJECT});
const args = process.argv.slice(2);
const action = args[0] || 'seed-template';

function option(name, required = true) {
  const index = args.indexOf(`--${name}`);
  const value = index >= 0 ? String(args[index + 1] || '').trim() : '';
  if (required && !value) throw new Error(`--${name} is required.`);
  return value;
}

function normalizeId(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized || normalized.length > 120 || !/^[A-Z0-9._ -]+$/.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function labTemplateContent() {
  const section = createYyzApolloProfileSection();
  return {
    translations: section.translations,
    screenFlow: section.screenFlow,
    template: {...section.template, id: 'yyz-apollo-us-v1', source: `${YYZ_APOLLO_PROFILE_TEMPLATE_META.source}; U.S. isolated QR lab`},
    qr: {...section.qr, enabled: true},
  };
}

async function seedTemplate() {
  const ref = db.collection('apolloProfileTemplates').doc('yyz-apollo-us-v1');
  await ref.set({
    schemaVersion: 1, name: 'YYZ Apollo U.S. QR baseline', environment: config.APOLLO_ENVIRONMENT,
    gateway: APOLLO_TERMINAL_GATEWAY, content: labTemplateContent(), updatedAt: FieldValue.serverTimestamp(),
  }, {merge: false});
  return {ok: true, templateId: ref.id};
}

async function assignClient(clientValue) {
  const clientId = normalizeId(clientValue, 'Client ID');
  const content = labTemplateContent();
  const contentHash = sha256(canonicalJson(content)).slice(0, 16);
  const releaseId = `${clientId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}-v1-${contentHash}`;
  const releaseRef = db.collection('apolloProfileReleases').doc(releaseId);
  const existing = await releaseRef.get();
  if (!existing.exists) {
    await releaseRef.create({
      schemaVersion: 1, profileId: `${clientId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}-apollo`,
      clientId, profileVersion: 1, sectionVersion: 1, environment: config.APOLLO_ENVIRONMENT,
      gateway: APOLLO_TERMINAL_GATEWAY, content, contentHash, createdAt: FieldValue.serverTimestamp(), source: 'yyz-apollo-us-v1',
    });
  }
  await db.collection('apolloClientAssignments').doc(clientId).set({
    schemaVersion: 1, clientId, environment: config.APOLLO_ENVIRONMENT, gateway: APOLLO_TERMINAL_GATEWAY,
    releaseId, enabled: true, updatedAt: FieldValue.serverTimestamp(),
  });
  return {ok: true, clientId, releaseId};
}

async function publishProfile() {
  if (process.stdin.isTTY) throw new Error('Pipe the saved dashboard profile JSON through standard input.');
  const source = JSON.parse(fs.readFileSync(0, 'utf8'));
  const clientId = normalizeId(source.clientId, 'Client ID');
  const section = source.terminalProfiles?.apollo;
  if (!section?.translations) throw new Error('The saved profile has no Apollo section.');
  validateApolloScreenFlow(section.screenFlow);
  const profileId = String(source.id || source.profileId || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  if (!profileId) throw new Error('The saved profile ID is invalid.');
  const content = {
    translations: section.translations,
    screenFlow: section.screenFlow || {version: 1, entryScreenId: '', screens: [], removedEstablishedScreenIds: []},
    ...(section.template ? {template: section.template} : {}),
    qr: section.qr || {enabled: false, provider: 'chargerent-issued', promptTitle: 'Borrow a charger', promptMessage: 'Scan your QR code'},
  };
  const contentHash = sha256(canonicalJson(content)).slice(0, 16);
  const release = apolloReleaseSchema.parse({
    schemaVersion: 1, profileId, clientId, profileVersion: Number(source.version),
    sectionVersion: Number(source.sectionVersions?.apollo), environment: config.APOLLO_ENVIRONMENT, content,
  });
  const releaseId = `${profileId}-apollo-${release.sectionVersion}-${contentHash}`;
  const ref = db.collection('apolloProfileReleases').doc(releaseId);
  const existing = await ref.get();
  if (!existing.exists) await ref.create({...release, contentHash, createdAt: FieldValue.serverTimestamp(), source: 'dashboard'});
  await db.collection('apolloClientAssignments').doc(clientId).set({
    schemaVersion: 1, clientId, environment: config.APOLLO_ENVIRONMENT, gateway: APOLLO_TERMINAL_GATEWAY,
    releaseId, enabled: true, updatedAt: FieldValue.serverTimestamp(),
  });
  return {ok: true, clientId, releaseId, sectionVersion: release.sectionVersion};
}

async function registerTerminal() {
  const clientId = normalizeId(option('client'), 'Client ID');
  const stationId = normalizeId(option('station'), 'Station ID').replace(/ /g, '-');
  const serial = normalizeSerial(option('serial'));
  const assignment = await db.collection('apolloClientAssignments').doc(clientId).get();
  if (!assignment.exists || assignment.data()?.environment !== config.APOLLO_ENVIRONMENT) {
    throw new Error('Assign the U.S. Apollo profile to the client before registering a terminal.');
  }
  const enabled = args.includes('--enable');
  const scannerOnly = args.includes('--scanner-only');
  const acceptAnyQr = args.includes('--accept-any-qr');
  if (acceptAnyQr && (config.APOLLO_ENVIRONMENT !== 'us-lab' || !scannerOnly)) {
    throw new Error('--accept-any-qr is allowed only for a scanner-only terminal in the U.S. lab.');
  }
  await db.collection('apolloTerminalRegistry').doc(serial).set({
    schemaVersion: 1, terminalSerial: serial, stationId, clientId, gateway: APOLLO_TERMINAL_GATEWAY,
    environment: config.APOLLO_ENVIRONMENT, enabled, scannerOnly, acceptAnyQr, updatedAt: FieldValue.serverTimestamp(),
  });
  return {ok: true, acceptAnyQr, clientId, enabled, scannerOnly, serial, stationId};
}

async function issueQr() {
  const clientId = normalizeId(option('client'), 'Client ID');
  const provider = String(option('provider', false) || 'chargerent-issued').trim().toLowerCase();
  if (!['chargerent-issued', 'external', 'library'].includes(provider)) throw new Error('--provider must be chargerent-issued, external, or library.');
  const uses = Number(option('uses', false) || 1);
  if (!Number.isInteger(uses) || uses < 1 || uses > 1000) throw new Error('--uses must be between 1 and 1000.');
  if (process.stdin.isTTY) throw new Error('Pipe the QR credential through standard input; do not put it in command arguments.');
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw || raw.length > 4096) throw new Error('The QR credential is empty or too large.');
  const qrHashKey = await loadSecret(config.QR_HASH_SECRET);
  const credentialHash = hashQrCredential(raw, qrHashKey);
  await db.collection('apolloQrCredentials').doc(credentialHash).set({
    schemaVersion: 1, clientId, provider, enabled: true, remainingUses: uses,
    label: option('label', false).slice(0, 120), createdAt: FieldValue.serverTimestamp(),
  }, {merge: false});
  return {ok: true, clientId, provider, credentialHash: credentialHash.slice(0, 12), uses};
}

async function activateTerminal() {
  const serial = normalizeSerial(option('serial'));
  const language = String(option('language', false) || 'en').trim().toLowerCase();
  if (!['en', 'es', 'fr'].includes(language)) throw new Error('--language must be en, es, or fr.');
  const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, serial);
  if (resolved.release.content.qr?.enabled !== true) throw new Error('QR vending is disabled in the assigned client profile.');
  if (resolved.terminal.scannerOnly !== true) throw new Error('Apollo scanner-only mode is not enabled for this terminal.');
  const apiKey = await loadSecret(config.PAYTER_API_KEY_SECRET);
  const callbackToken = await loadSecret(config.CALLBACK_TOKEN_SECRET);
  const callbackBaseUrl = buildCallbackBaseUrl(config.PUBLIC_BASE_URL, callbackToken);
  const screenId = `start-${randomUUID().replace(/-/g, '')}`;
  const result = await callPayter(buildUiRequest({
    apiKey,
    callbackBaseUrl,
    cpsEnvironment: config.CPS_ENVIRONMENT,
    properties: startScreenProperties(resolved.release, language),
    screenId,
    serialNumber: serial,
    type: 'carousel',
  }));
  await db.collection('apolloTerminalRuntime').doc(serial).set({
    environment: config.APOLLO_ENVIRONMENT,
    terminalSerial: serial,
    stationId: resolved.stationId,
    clientId: resolved.clientId,
    releaseId: resolved.releaseId,
    language,
    state: 'idle',
    activeScreenId: screenId,
    activeSessionId: '',
    readerSessionId: '',
    activatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, serial, stationId: resolved.stationId, state: 'idle', status: result.status};
}

async function checkInventory() {
  const serial = normalizeSerial(option('serial'));
  const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, serial);
  const credentials = parseBrokerCredentials(await loadSecret(config.V2_MQTT_CREDENTIALS_SECRET));
  const client = mqtt.connect(config.V2_MQTT_URL, {
    ...credentials,
    clean: true,
    clientId: `apollo-us-lab-inventory-${randomUUID()}`,
    connectTimeout: 8000,
    reconnectPeriod: 0,
  });
  const sessionId = randomUUID();
  const responseTopic = `CSTA/post/${resolved.stationId}`;
  const command = buildAvailabilityCommand({sessionId, stationId: resolved.stationId, terminalSerial: resolved.serial});
  try {
    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    await client.subscribeAsync(responseTopic, {qos: 2});
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for the V2 inventory response.')), 15000);
      client.on('message', (topicName, payload) => {
        const event = cstaResponseToKioskEvent(topicName, payload);
        if (event?.type !== 'availability_result' || event.sessionId !== sessionId) return;
        clearTimeout(timeout);
        resolve(event);
      });
    });
    await client.publishAsync('CSTA/get', JSON.stringify(command), {qos: 2, retain: false});
    const event = await response;
    return {
      ok: true,
      stationId: resolved.stationId,
      serial,
      available: event.available,
      ...(event.available ? {module: event.module, slot: event.slot, chargerId: event.chargerId} : {}),
    };
  } finally {
    await client.endAsync().catch(() => {});
  }
}

async function verifyPayterTerminal() {
  const serial = normalizeSerial(option('serial'));
  const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, serial);
  const apiKey = await loadSecret(config.PAYTER_API_KEY_SECRET);
  const result = await callPayter(buildTerminalRequest({apiKey, cpsEnvironment: config.CPS_ENVIRONMENT, serialNumber: serial}));
  const terminal = JSON.parse(result.body || '{}');
  if (normalizeSerial(terminal.serialNumber) !== serial) throw new Error('Payter returned a different terminal serial.');
  return {
    ok: true,
    status: result.status,
    serial,
    stationId: resolved.stationId,
    terminalName: String(terminal.terminalName || ''),
    online: terminal.online === true,
    state: String(terminal.state || ''),
  };
}

let result;
if (action === 'seed-template') result = await seedTemplate();
else if (action === 'assign-client') result = await assignClient(option('client'));
else if (action === 'register-terminal') result = await registerTerminal();
else if (action === 'issue-qr') result = await issueQr();
else if (action === 'publish-profile') result = await publishProfile();
else if (action === 'activate-terminal') result = await activateTerminal();
else if (action === 'check-inventory') result = await checkInventory();
else if (action === 'verify-payter-terminal') result = await verifyPayterTerminal();
else throw new Error('Action must be seed-template, assign-client, publish-profile, register-terminal, issue-qr, activate-terminal, check-inventory, or verify-payter-terminal.');
console.info(JSON.stringify(result));
