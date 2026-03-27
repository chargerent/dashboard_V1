import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INPUT = '/Users/georgegazelian/Downloads/dashboardapi.json';
const DEFAULT_OUTPUT = path.join(__dirname, 'dashboardapi-optimized.json');

const ACTIVE_COMMAND_SWITCH_ID = '116b37065d959aa4';
const COMMANDS_GROUP_ID = 'ed38194e9a2f3014';
const WEBSOCKET_OUT_ID = '0381a37e369dc656';
const MQTT_LINK_OUT_ID = '61cfdf9472485877';
const MQTT_BROKER_ID = '8597d2b7.ba618';
const LEGACY_CONFIRMATION_SWITCH_ID = '4e32b616baeacfe8';
const LEGACY_CONFIRMATION_DEBUG_ID = 'b59d741abd1bef05';

const NODE_IDS = {
  vendPrepare: '6d3f4a6b2fd0c101',
  vendIn: '6d3f4a6b2fd0c102',
  vendHydrate: '6d3f4a6b2fd0c103'
};

function loadFlow(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveFlow(filePath, flow) {
  fs.writeFileSync(filePath, JSON.stringify(flow, null, 4) + '\n');
}

function removeExistingNodes(flow, ids) {
  const banned = new Set(ids);
  return flow.filter((node) => !banned.has(node.id));
}

function ensureGroupNodes(group, ids) {
  const existing = new Set(Array.isArray(group.nodes) ? group.nodes : []);
  ids.forEach((id) => existing.add(id));
  group.nodes = Array.from(existing);
}

function buildVendPrepareNode() {
  return {
    id: NODE_IDS.vendPrepare,
    type: 'function',
    z: '09af597d0b44144e',
    g: COMMANDS_GROUP_ID,
    name: 'Prepare vend command',
    func: `const STORE_KEY = 'dashboardPendingVendCommands';
const TTL_MS = 5 * 60 * 1000;

function normalizeStationId(value) {
  return String(value || '').trim();
}

function resolveTimestamp(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function prune(store, now) {
  const next = {};
  Object.entries(store || {}).forEach(([key, queue]) => {
    const items = Array.isArray(queue) ? queue.filter((item) => item && (now - Number(item.createdAt || 0)) < TTL_MS) : [];
    if (items.length > 0) next[key] = items;
  });
  return next;
}

const command = msg.command || {};
if (String(command.action || '').toLowerCase() !== 'vend') {
  return msg;
}

const stationidRaw = normalizeStationId(command.stationid);
const stationid = stationidRaw;
const moduleid = String(command.moduleid || command.moduleId || '').trim();
const chargerid = Number(command.chargerid || command.sn || 0);
const slotValue = command.slotid ?? command.slot;
const slotid = Number(slotValue);
const now = Date.now();
const timerequested = resolveTimestamp(command.timerequested, now);
const sessionId = msg._session?.id || msg._session || command.admin || null;

if (!stationid || !moduleid || !Number.isFinite(chargerid) || chargerid <= 0) {
  node.error('Vend command is missing stationid, moduleid, or chargerid', msg);
  return null;
}

if (sessionId === null || sessionId === undefined || sessionId === '') {
  node.error('Vend command is missing websocket session context', msg);
  return null;
}

const requestId = String(command.requestId || '').trim() || \`vend-\${stationid}-\${moduleid}-\${chargerid}-\${now}\`;
const pendingKey = \`vend:\${stationid}:\${moduleid}:\${chargerid}\`;
const entry = {
  requestId,
  sessionId,
  stationid,
  stationidRaw,
  moduleid,
  chargerid,
  slotid: Number.isFinite(slotid) ? slotid : null,
  timerequested,
  createdAt: now
};

const store = prune(flow.get(STORE_KEY) || {}, now);
const queue = Array.isArray(store[pendingKey]) ? store[pendingKey] : [];
queue.push(entry);
store[pendingKey] = queue.slice(-5);
flow.set(STORE_KEY, store);

msg.requestId = requestId;
msg.timerequested = timerequested;
msg.command = {
  ...command,
  stationid,
  moduleid,
  chargerid,
  slotid: entry.slotid,
  requestId,
  timerequested
};
msg.payload = {
  action: 'vend',
  stationid,
  stationidRaw,
  moduleid,
  slotid: entry.slotid,
  chargerid,
  requestId,
  timerequested,
  admin: sessionId
};
msg.topic = 'CSTA/get';
return msg;`,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 2700,
    y: 1520,
    wires: [[MQTT_LINK_OUT_ID]]
  };
}

function buildVendInNode() {
  return {
    id: NODE_IDS.vendIn,
    type: 'mqtt-json',
    z: '09af597d0b44144e',
    g: COMMANDS_GROUP_ID,
    name: 'New kiosk confirmations',
    topic: 'CSTA/post/+',
    property: '',
    qos: '2',
    broker: MQTT_BROKER_ID,
    x: 3090,
    y: 620,
    wires: [[NODE_IDS.vendHydrate]]
  };
}

function buildVendHydrateNode() {
  return {
    id: NODE_IDS.vendHydrate,
    type: 'function',
    z: '09af597d0b44144e',
    g: COMMANDS_GROUP_ID,
    name: 'Hydrate vend confirmation',
    func: `const STORE_KEY = 'dashboardPendingVendCommands';
const RECENT_KEY = 'dashboardRecentVendConfirmations';
const TTL_MS = 5 * 60 * 1000;
const RECENT_TTL_MS = 60 * 1000;

function normalizeStationId(value) {
  return String(value || '').trim();
}

function normalizeModuleId(value) {
  return String(value || '').trim();
}

function resolveTimestamp(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pruneQueues(store, now) {
  const next = {};
  Object.entries(store || {}).forEach(([key, queue]) => {
    const items = Array.isArray(queue) ? queue.filter((item) => item && (now - Number(item.createdAt || 0)) < TTL_MS) : [];
    if (items.length > 0) next[key] = items;
  });
  return next;
}

function pruneRecent(store, now) {
  const next = {};
  Object.entries(store || {}).forEach(([key, item]) => {
    if (item && (now - Number(item.seenAt || 0)) < RECENT_TTL_MS) {
      next[key] = item;
    }
  });
  return next;
}

function parseStationId(topic) {
  const parts = String(topic || '').split('/').filter(Boolean);
  return String(parts[2] || '').trim();
}

function modulesMatch(left, right) {
  const a = normalizeModuleId(left);
  const b = normalizeModuleId(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.replace(/^m/i, '') === b.replace(/^m/i, '');
}

function dequeue(store, key) {
  const queue = Array.isArray(store[key]) ? store[key] : [];
  const pending = queue.shift();
  if (queue.length > 0) store[key] = queue;
  else delete store[key];
  return pending || null;
}

function findPending(store, stationid, moduleid, chargerid) {
  const exactKey = \`vend:\${stationid}:\${moduleid}:\${chargerid}\`;
  const exactPending = dequeue(store, exactKey);
  if (exactPending) {
    return { pending: exactPending, key: exactKey };
  }

  const matchingKeys = Object.keys(store).filter((key) => {
    const parts = key.split(':');
    if (parts.length !== 4 || parts[0] !== 'vend') return false;
    const keyStationid = normalizeStationId(parts[1]);
    const keyModuleid = normalizeModuleId(parts[2]);
    const keyChargerid = Number(parts[3]);
    return keyStationid === stationid && modulesMatch(keyModuleid, moduleid) && keyChargerid === chargerid;
  });

  for (const key of matchingKeys) {
    const pending = dequeue(store, key);
    if (pending) return { pending, key };
  }

  const relaxedKeys = Object.keys(store).filter((key) => {
    const parts = key.split(':');
    if (parts.length !== 4 || parts[0] !== 'vend') return false;
    const keyModuleid = normalizeModuleId(parts[2]);
    const keyChargerid = Number(parts[3]);
    return modulesMatch(keyModuleid, moduleid) && keyChargerid === chargerid;
  });

  for (const key of relaxedKeys) {
    const pending = dequeue(store, key);
    if (pending) return { pending, key };
  }

  return { pending: null, key: exactKey };
}

const incoming = msg.payload || {};
if (String(incoming.action || '').toLowerCase() !== 'vend') {
  return null;
}

const stationid = normalizeStationId(incoming.stationid || incoming.kiosk || parseStationId(msg.topic));
const moduleid = normalizeModuleId(incoming.moduleid || incoming.module);
const chargerid = Number(incoming.chargerid || incoming.sn || 0);
const now = Date.now();
const incomingKey = \`vend:\${stationid}:\${moduleid}:\${chargerid}\`;

if (!stationid || !moduleid || !Number.isFinite(chargerid) || chargerid <= 0) {
  node.warn('Vend confirmation missing stationid, moduleid, or chargerid');
  return null;
}

const store = pruneQueues(flow.get(STORE_KEY) || {}, now);
const recent = pruneRecent(flow.get(RECENT_KEY) || {}, now);
const match = findPending(store, stationid, moduleid, chargerid);
const pending = match.pending;

flow.set(STORE_KEY, store);

if (!pending || pending.sessionId === null || pending.sessionId === undefined || pending.sessionId === '') {
  if (recent[incomingKey]) {
    flow.set(RECENT_KEY, recent);
    return null;
  }
  node.warn(\`No pending vend context for \${match.key}\`);
  return null;
}

const status = Number(incoming.status);
const isSuccess = status === 1;
const responseStationid = pending.stationid || stationid;
const responseModuleid = pending.moduleid || moduleid;
const responseKey = \`vend:\${responseStationid}:\${responseModuleid}:\${chargerid}\`;
const timeresponded = resolveTimestamp(incoming.timeresponded, now);
recent[incomingKey] = {
  seenAt: now,
  requestId: pending.requestId
};
recent[responseKey] = {
  seenAt: now,
  requestId: pending.requestId
};
flow.set(RECENT_KEY, recent);

msg._session = pending.sessionId;
msg.payload = {
  action: 'vend',
  stationid: responseStationid,
  moduleid: responseModuleid,
  slotid: pending.slotid,
  chargerid,
  status: incoming.status,
  status_en: incoming.status_en || (isSuccess ? 'charger ejected' : 'charger eject failed'),
  timerequested: pending.timerequested,
  timeresponded,
  requestId: pending.requestId
};
return msg;`,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 3340,
    y: 620,
    wires: [[WEBSOCKET_OUT_ID]]
  };
}

function optimizeFlow(flow) {
  const working = removeExistingNodes(flow, Object.values(NODE_IDS));

  const commandsGroup = working.find((node) => node.id === COMMANDS_GROUP_ID);
  if (!commandsGroup) {
    throw new Error(`Missing commands group ${COMMANDS_GROUP_ID}`);
  }

  const actionSwitch = working.find((node) => node.id === ACTIVE_COMMAND_SWITCH_ID);
  if (!actionSwitch) {
    throw new Error(`Missing command action switch ${ACTIVE_COMMAND_SWITCH_ID}`);
  }

  const legacyConfirmationSwitch = working.find((node) => node.id === LEGACY_CONFIRMATION_SWITCH_ID);
  if (legacyConfirmationSwitch && Array.isArray(legacyConfirmationSwitch.wires) && legacyConfirmationSwitch.wires.length >= 3) {
    legacyConfirmationSwitch.wires[2] = [WEBSOCKET_OUT_ID, LEGACY_CONFIRMATION_DEBUG_ID];
  }

  const vendRuleExists = Array.isArray(actionSwitch.rules)
    && actionSwitch.rules.some((rule) => rule && rule.t === 'eq' && rule.v === 'vend');
  if (!vendRuleExists) {
    actionSwitch.rules.push({ t: 'eq', v: 'vend', vt: 'str' });
    actionSwitch.wires.push([NODE_IDS.vendPrepare]);
  } else {
    const vendIndex = actionSwitch.rules.findIndex((rule) => rule && rule.t === 'eq' && rule.v === 'vend');
    actionSwitch.wires[vendIndex] = [NODE_IDS.vendPrepare];
  }
  actionSwitch.outputs = actionSwitch.rules.length;

  ensureGroupNodes(commandsGroup, Object.values(NODE_IDS));

  working.push(buildVendPrepareNode());
  working.push(buildVendInNode());
  working.push(buildVendHydrateNode());

  return working;
}

function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT;
  const outputPath = process.argv[3] || DEFAULT_OUTPUT;
  const flow = loadFlow(inputPath);
  const optimized = optimizeFlow(flow);
  saveFlow(outputPath, optimized);
  console.log(`Wrote optimized dashboard API flow to ${outputPath}`);
}

main();
