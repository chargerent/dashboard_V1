import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INPUT = '/Users/georgegazelian/Downloads/dashboard_API.json';
const DEFAULT_OUTPUT = path.join(__dirname, 'dashboard_API-optimized.json');

const IDS = {
  tab: 'c31dd5c4cac7132c',
  commandsGroup: 'f0e8b40fe39e16cd',
  stationSwitch: 'dd8b1d4dd8f8cc14',
  actionSwitch: '08f2faa3d424414e',
  newKioskLink: '8b75f414f68e819a',
  newKioskDebug: '2bfbfc5de8e02c99',
  vendContext: '26a1de0bb3832ea8',
  vendConfirmIn: 'dfae0d3038faee9c',
  vendConfirmHydrate: '7eb16388136e334e',
  vendConfirmDebug: '47281f1476f4db4d',
  websocketOut: 'caabd143eb9e469a',
  legacyConfirmationSwitch: '2a17f9c9e2abc48d',
  legacyConfirmationDebug: '5df98f0cd4bf857c',
  commandResponseForward: '205e021a024239e6',
  kioskCommandsComment: 'ce6e96309fb44528',
  kioskResponsesComment: '694b2a0d05bf0844'
};

const NEW_IDS = {
  vendRouteSwitch: '91f0f3db6ab3c201',
  vendRouteComment: '91f0f3db6ab3c202',
  vendConfirmComment: '91f0f3db6ab3c203'
};

function loadFlow(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveFlow(filePath, flow) {
  fs.writeFileSync(filePath, JSON.stringify(flow, null, 4) + '\n');
}

function byId(flow, id) {
  const node = flow.find((entry) => entry.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return node;
}

function upsertNode(flow, node) {
  const index = flow.findIndex((entry) => entry.id === node.id);
  if (index === -1) flow.push(node);
  else flow[index] = node;
}

function ensureGroupNodes(group, ids) {
  const next = new Set(Array.isArray(group.nodes) ? group.nodes : []);
  ids.forEach((id) => next.add(id));
  group.nodes = Array.from(next);
}

function buildVendContextFunction() {
  return `const STORE_KEY = 'dashboardPendingVendCommands';
const TTL_MS = 5 * 60 * 1000;
const ID_MAP = {
  'CS0001': 'USB0001',
  'CS0002': 'CAB0001',
  'CS0003': 'CAB0002',
  'CS0004': 'CAB0003',
  'CS0005': 'CAB0004',
  'CS0006': 'CAB0005',
  'CS0007': 'CAB0006',
  'CS0008': 'CAB0007',
  'CS0009': 'CAB0008',
  'CS0010': 'CAB0009',
  'CS0011': 'CAB0010'
};

function normalizeStationId(value) {
  const stationid = String(value || '').trim();
  return ID_MAP[stationid] || stationid;
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

const stationidRaw = String(command.stationid || '').trim();
const stationid = normalizeStationId(stationidRaw);
const moduleid = String(command.moduleid || command.moduleId || '').trim();
const chargerid = Number(command.chargerid || command.sn || 0);
const slotValue = command.slotid ?? command.slot;
const slotid = Number(slotValue);
const now = Date.now();
const timerequested = Number(command.timerequested || now);
const sessionId = msg._session?.id || msg._session || command.admin || null;

if (!stationid || !moduleid || !Number.isFinite(chargerid) || chargerid <= 0) {
  node.error('Vend command is missing stationid, moduleid, or chargerid', msg);
  return null;
}

if (sessionId === null || sessionId === undefined || sessionId === '') {
  node.error('Vend command is missing websocket session context', msg);
  return null;
}

const requestId = String(command.requestId || \`vend-\${stationid}-\${moduleid}-\${chargerid}-\${now}\`).trim();
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
  requestId,
  timerequested
};

return msg;`;
}

function buildVendRouteSwitch() {
  return {
    id: NEW_IDS.vendRouteSwitch,
    type: 'switch',
    z: IDS.tab,
    g: IDS.commandsGroup,
    name: 'Route new kiosk vend',
    property: 'command.action',
    propertyType: 'msg',
    rules: [
      { t: 'eq', v: 'vend', vt: 'str' },
      { t: 'else' }
    ],
    checkall: 'true',
    repair: false,
    outputs: 2,
    x: 2210,
    y: 1500,
    wires: [
      [IDS.vendContext],
      [IDS.newKioskLink]
    ]
  };
}

function buildComment(id, name, x, y) {
  return {
    id,
    type: 'comment',
    z: IDS.tab,
    g: IDS.commandsGroup,
    name,
    info: '',
    x,
    y,
    wires: []
  };
}

function optimizeFlow(flow) {
  const commandsGroup = byId(flow, IDS.commandsGroup);
  const stationSwitch = byId(flow, IDS.stationSwitch);
  const actionSwitch = byId(flow, IDS.actionSwitch);
  const newKioskLink = byId(flow, IDS.newKioskLink);
  const vendContext = byId(flow, IDS.vendContext);
  const vendConfirmIn = byId(flow, IDS.vendConfirmIn);
  const vendConfirmHydrate = byId(flow, IDS.vendConfirmHydrate);
  const legacyConfirmationSwitch = byId(flow, IDS.legacyConfirmationSwitch);
  const commandResponseForward = byId(flow, IDS.commandResponseForward);
  const kioskCommandsComment = byId(flow, IDS.kioskCommandsComment);
  const kioskResponsesComment = byId(flow, IDS.kioskResponsesComment);

  stationSwitch.name = 'Route kiosk families';
  stationSwitch.x = 1950;
  stationSwitch.y = 1260;
  stationSwitch.wires = [
    [NEW_IDS.vendRouteSwitch, IDS.newKioskDebug],
    [NEW_IDS.vendRouteSwitch, IDS.newKioskDebug],
    [NEW_IDS.vendRouteSwitch, IDS.newKioskDebug],
    [IDS.actionSwitch]
  ];

  actionSwitch.name = 'Route legacy kiosk actions';
  actionSwitch.x = 2150;
  actionSwitch.y = 1240;
  if (!Array.isArray(actionSwitch.wires) || actionSwitch.wires.length < actionSwitch.outputs) {
    throw new Error('Legacy action switch wiring is malformed');
  }
  const vendRuleIndex = actionSwitch.rules.findIndex((rule) => rule && rule.t === 'eq' && rule.v === 'vend');
  if (vendRuleIndex === -1) {
    throw new Error('Legacy action switch is missing vend output');
  }
  actionSwitch.wires[vendRuleIndex] = [IDS.vendContext];

  newKioskLink.name = 'Forward to Besiter flow';
  newKioskLink.x = 2670;
  newKioskLink.y = 1500;

  vendContext.name = 'Store vend context';
  vendContext.func = buildVendContextFunction();
  vendContext.x = 2440;
  vendContext.y = 1500;
  vendContext.wires = [[IDS.newKioskLink]];

  vendConfirmIn.name = 'New kiosk confirmations';
  vendConfirmIn.x = 3030;
  vendConfirmIn.y = 620;

  vendConfirmHydrate.name = 'Hydrate vend confirmation';
  vendConfirmHydrate.x = 3320;
  vendConfirmHydrate.y = 620;
  vendConfirmHydrate.wires = [[IDS.websocketOut, IDS.vendConfirmDebug]];

  legacyConfirmationSwitch.name = 'Route confirmation session';
  legacyConfirmationSwitch.wires[2] = [IDS.websocketOut, IDS.legacyConfirmationDebug];

  commandResponseForward.name = 'Forward command response';

  kioskCommandsComment.x = 2270;
  kioskCommandsComment.y = 640;
  kioskResponsesComment.x = 3070;
  kioskResponsesComment.y = 780;

  upsertNode(flow, buildVendRouteSwitch());
  upsertNode(flow, buildComment(NEW_IDS.vendRouteComment, '--- NEW KIOSK VEND ROUTING ---', 2350, 1420));
  upsertNode(flow, buildComment(NEW_IDS.vendConfirmComment, '--- NEW KIOSK VEND CONFIRMATIONS ---', 3260, 540));

  ensureGroupNodes(commandsGroup, Object.values(NEW_IDS));
  commandsGroup.x = 1804;
  commandsGroup.y = 439;
  commandsGroup.w = 2452;
  commandsGroup.h = 1542;

  return flow;
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
