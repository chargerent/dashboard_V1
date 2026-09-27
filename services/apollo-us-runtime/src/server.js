import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {FieldValue, Firestore} from '@google-cloud/firestore';
import {PubSub} from '@google-cloud/pubsub';
import mqtt from 'mqtt';
import {cardSchema, normalizeSerial, terminalStateSchema, uiNotificationSchema, verifySignedRequest} from './contracts.js';
import {loadConfig} from './config.js';
import {processWithFallback} from './dispatch.js';
import {parseEnvelope} from './events.js';
import {buildTerminalRequest, callPayter} from './payter.js';
import {resolveTerminalProfile} from './profile.js';
import {createTerminalRecoveryMonitor} from './recovery.js';
import {createRuntime} from './runtime.js';
import {createSecretLoader} from './secrets.js';
import {cstaResponseToKioskEvent, parseBrokerCredentials} from './v2Gateway.js';

const config = loadConfig();
const db = new Firestore({projectId: config.GOOGLE_CLOUD_PROJECT, databaseId: config.FIRESTORE_DATABASE});
const pubsub = new PubSub({projectId: config.GOOGLE_CLOUD_PROJECT});
const topic = pubsub.topic(config.PUBSUB_TOPIC, {messageOrdering: true});
const subscription = pubsub.subscription(config.PUBSUB_SUBSCRIPTION, {flowControl: {maxMessages: 8}});
const loadSecret = createSecretLoader({projectId: config.GOOGLE_CLOUD_PROJECT});
const brokerCredentials = parseBrokerCredentials(await loadSecret(config.V2_MQTT_CREDENTIALS_SECRET));
const mqttClient = mqtt.connect(config.V2_MQTT_URL, {
  ...brokerCredentials,
  clientId: `apollo-us-lab-${randomUUID()}`,
  clean: true,
  reconnectPeriod: 3000,
  connectTimeout: 8000,
});
const runtime = createRuntime({config, db, loadSecret, mqttClient});
const app = Fastify({logger: false, bodyLimit: 64 * 1024, trustProxy: true});

async function loadPayterTerminal(serialNumber) {
  const apiKey = await loadSecret(config.PAYTER_API_KEY_SECRET);
  const result = await callPayter(buildTerminalRequest({
    apiKey,
    cpsEnvironment: config.CPS_ENVIRONMENT,
    serialNumber,
  }));
  const terminal = JSON.parse(result.body || '{}');
  if (normalizeSerial(terminal.serialNumber) !== normalizeSerial(serialNumber)) {
    throw new Error('Payter returned a different terminal serial.');
  }
  return terminal;
}

const recoveryMonitor = createTerminalRecoveryMonitor({
  config,
  db,
  loadTerminal: loadPayterTerminal,
  recoverTerminal: (serialNumber, trigger) => runtime.recoverIdleTerminal(serialNumber, trigger),
  retryFailedStart: (serialNumber) => runtime.retryFailedStart(serialNumber),
});

app.addHook('onRequest', async (request) => {
  if (!request.url.startsWith('/callbacks/')) return;
  const pathOnly = request.url.split('?')[0];
  console.info(JSON.stringify({
    event: 'payter_callback_http_received',
    method: request.method,
    pathSegments: pathOnly.split('/').filter(Boolean).length,
  }));
});

async function enqueueEnvelope(envelope, orderingKey) {
  await topic.publishMessage({data: Buffer.from(JSON.stringify(envelope)), orderingKey});
}

async function dispatchRuntimeEvent(type, payload, orderingKey, deliveryKey = '') {
  const result = await processWithFallback({
    deliveryKey,
    enqueueEnvelope,
    orderingKey,
    payload,
    processEnvelope: (envelope) => runtime.process(envelope),
    type,
  });
  if (result.delivery === 'queued') {
    console.warn(JSON.stringify({event: 'runtime_event_queued_after_direct_failure', message: result.directError, type}));
  }
  return result.eventId;
}

function requireInternalSignature(request, reply) {
  return loadSecret(config.INTERNAL_HMAC_SECRET).then((secret) => {
    const valid = verifySignedRequest({
      body: request.body, secret, signature: request.headers['x-chargerent-signature'], timestamp: request.headers['x-chargerent-timestamp'],
    });
    if (!valid) reply.code(401).send({ok: false, error: 'invalid_signature'});
  });
}

app.get('/healthz', async (_request, reply) => {
  if (!mqttClient.connected) return reply.code(503).send({ok: false, environment: config.APOLLO_ENVIRONMENT, service: 'apollo-us-runtime', v2Broker: 'disconnected'});
  return {ok: true, environment: config.APOLLO_ENVIRONMENT, service: 'apollo-us-runtime', v2Broker: 'connected'};
});

app.post('/callbacks/:token/readers/:readerSessionId/card', async (request, reply) => {
  if (request.params.token !== await loadSecret(config.CALLBACK_TOKEN_SECRET)) return reply.code(404).send();
  const payload = cardSchema.parse(request.body);
  const serial = normalizeSerial(payload.serialNumber);
  const runtimeSnap = await db.collection('apolloTerminalRuntime').doc(serial).get();
  const reader = runtimeSnap.exists ? runtimeSnap.data() || {} : {};
  if (reader.readerSessionId !== request.params.readerSessionId || !['starting_reader', 'reading', 'callback_received'].includes(reader.state)) {
    return reply.code(409).send({ok: false, error: 'stale_reader_session'});
  }
  const callbackPayload = {...payload, language: reader.language || 'en', readerSessionId: reader.readerSessionId};
  if (reader.state === 'reading') {
    await runtimeSnap.ref.set({state: 'callback_received', callbackReceivedAt: FieldValue.serverTimestamp()}, {merge: true});
  }
  const eventId = await dispatchRuntimeEvent('payter_card', callbackPayload, serial, reader.readerSessionId);
  return reply.code(202).send({ok: true, eventId});
});

app.post('/callbacks/:token/ui', async (request, reply) => {
  if (request.params.token !== await loadSecret(config.CALLBACK_TOKEN_SECRET)) return reply.code(404).send();
  const payload = uiNotificationSchema.parse(request.body);
  // Payter UI callbacks have no delivery identifier. Give each physical button
  // press its own key; the terminal runtime state rejects stale/replayed screens.
  const eventId = await dispatchRuntimeEvent('payter_ui', payload, normalizeSerial(payload.serialNumber), randomUUID());
  return reply.code(202).send({ok: true, eventId});
});

app.post('/callbacks/:token/apollo_states', async (request, reply) => {
  if (request.params.token !== await loadSecret(config.CALLBACK_TOKEN_SECRET)) return reply.code(404).send();
  const payload = terminalStateSchema.parse(request.body);
  const eventId = await dispatchRuntimeEvent('payter_state', payload, normalizeSerial(payload.serialNumber));
  return reply.code(202).send({ok: true, eventId});
});

app.post('/internal/v1/terminals/activate', {preHandler: requireInternalSignature}, async (request) => {
  const serialNumber = normalizeSerial(request.body?.serialNumber);
  const language = String(request.body?.language || 'en').trim().toLowerCase();
  return runtime.activateTerminal(serialNumber, language);
});

app.post('/internal/v1/profiles/resolve', {preHandler: requireInternalSignature}, async (request) => {
  const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, request.body?.serialNumber);
  return {ok: true, clientId: resolved.clientId, releaseId: resolved.releaseId, stationId: resolved.stationId, release: resolved.release};
});

mqttClient.on('connect', async () => {
  const topicNames = ['CSTA/post/+', 'CSTA/post'];
  await mqttClient.subscribeAsync(topicNames, {qos: 2});
  console.info(JSON.stringify({event: 'v2_mqtt_connected', topics: topicNames}));
});

mqttClient.on('message', async (topicName, payload) => {
  try {
    const event = cstaResponseToKioskEvent(topicName, payload);
    if (!event) return;
    const station = event.stationId || topicName.split('/')[2];
    await dispatchRuntimeEvent('kiosk_event', event, station, event.commandId || '');
  } catch (error) {
    console.error(JSON.stringify({event: 'v2_mqtt_event_rejected', message: error.message, topic: topicName}));
  }
});
mqttClient.on('error', (error) => console.error(JSON.stringify({event: 'v2_mqtt_error', message: error.message})));

subscription.on('message', async (message) => {
  try {
    await runtime.process(parseEnvelope(message));
    message.ack();
  } catch (error) {
    console.error(JSON.stringify({event: 'runtime_event_failed', message: error.message, messageId: message.id}));
    message.nack();
  }
});
subscription.on('error', (error) => console.error(JSON.stringify({event: 'pubsub_error', message: error.message})));

await app.listen({host: '0.0.0.0', port: config.PORT});
console.info(JSON.stringify({event: 'runtime_started', environment: config.APOLLO_ENVIRONMENT, port: config.PORT}));
await recoveryMonitor.start();

async function shutdown(signal) {
  console.info(JSON.stringify({event: 'runtime_stopping', signal}));
  recoveryMonitor.stop();
  await app.close();
  await mqttClient.endAsync();
  subscription.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
