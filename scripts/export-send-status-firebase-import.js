import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPath = path.join(__dirname, 'send-status-firebase-import.json');

const normalizeHelpers = `
function normalizeStationId(value) {
    return String(value || '').trim();
}
`.trim();

const prepareQueryFunc = `
${normalizeHelpers}

const originalPayload = (msg.payload && typeof msg.payload === 'object')
    ? JSON.parse(JSON.stringify(msg.payload))
    : {};

const stationid = normalizeStationId(originalPayload.stationid || msg.stationid || msg.id || '');
if (!stationid) {
    node.error('No stationid provided in payload', msg);
    return null;
}

msg._statusRequest = originalPayload;
msg._statusStationId = stationid;
msg.payload = {
    path: 'kiosks',
    query: [{ fieldPath: 'stationid', opStr: '==', value: stationid }]
};

return msg;
`.trim();

const resolvePollFunc = `
${normalizeHelpers}

const docs = Array.isArray(msg.payload) ? msg.payload : [];
const stationid = normalizeStationId(msg._statusStationId || '');
const matched = docs.find((doc) => normalizeStationId(doc?.stationid || '') === stationid) || null;

if (!matched) {
    node.warn('No station found with stationid: ' + stationid);
    return null;
}

msg.kioskDoc = JSON.parse(JSON.stringify(matched));
msg.stationid = matched.stationid || stationid;
msg.payload = msg._statusRequest || {};
return msg;
`.trim();

const resolveResponseFunc = `
${normalizeHelpers}

const docs = Array.isArray(msg.payload) ? msg.payload : [];
const stationid = normalizeStationId(msg._statusStationId || '');
const matched = docs.find((doc) => normalizeStationId(doc?.stationid || '') === stationid) || null;

msg.kioskDoc = matched ? JSON.parse(JSON.stringify(matched)) : null;
msg.stationid = (matched && matched.stationid) || stationid;
msg.payload = msg._statusRequest || {};
return msg;
`.trim();

const checkModulesFunc = `
const station = msg.kioskDoc || {};
const stationId = station.stationid || msg._statusStationId || '';
const modules = Array.isArray(station.modules) ? station.modules : [];

if (!stationId) {
    node.error('No stationid available for module polling', msg);
    return null;
}

if (modules.length === 0) {
    node.warn('No modules found for stationid: ' + stationId);
    return null;
}

modules.forEach((mod, index) => {
    if (!mod || !mod.id) return;

    const pollMsg = {
        topic: '/' + stationId + '/' + mod.id + '/user/get',
        payload: { cmd: 'check_all' }
    };

    setTimeout(() => {
        node.send(pollMsg);
    }, index * 2000);
});

return null;
`.trim();

const buildStatusFunc = `
if (!msg.payload?.timerequested || !msg._statusStationId) {
    node.error('Missing required fields (timerequested or stationid)', msg);
    return null;
}

const stationId = msg._statusStationId;
const station = msg.kioskDoc;

if (!station) {
    msg.payload = {
        stationid: stationId,
        moduleid: null,
        action: 'status',
        status: 'offline',
        formoptions: {
            active: false
        },
        vendbattery: null,
        timeresponded: Date.now(),
        timerequested: msg.payload.timerequested
    };
    msg.topic = 'CSTA/post/' + stationId;
    return msg;
}

const pricing = station.pricing && typeof station.pricing === 'object'
    ? station.pricing
    : {};
const hardware = {
    gateway: station?.hardware?.gateway ?? null,
    gatewayoptions: station?.hardware?.gatewayoptions ?? null
};
const formoptions = station.formoptions && typeof station.formoptions === 'object'
    ? {
        active: station.formoptions?.active === true
    }
    : {
        active: false
    };

let latestModuleTime = 0;
const modules = Array.isArray(station.modules) ? station.modules : [];
modules.forEach((mod) => {
    const moduleTime = new Date(mod?.lastUpdated).getTime();
    if (!isNaN(moduleTime) && moduleTime > latestModuleTime) {
        latestModuleTime = moduleTime;
    }
});

let recentModuleFound = false;
modules.forEach((mod) => {
    const moduleTime = new Date(mod?.lastUpdated).getTime();
    if (!isNaN(moduleTime) && (Date.now() - moduleTime) < 10000) {
        recentModuleFound = true;
    }
});

let finalSNs = [];
let firstModuleId = null;
let vendBatteryCandidate = null;

const vendSlotStr = String(station.vendslot || '0.1');
const vendParts = vendSlotStr.split('.');
const vendModuleIndex = parseInt(vendParts[0], 10);
const vendSlotNumber = parseInt(vendParts[1], 10);

const globalSlots = [];
modules.forEach((stationModule, modIndex) => {
    const slots = Array.isArray(stationModule?.slots) ? stationModule.slots : [];
    slots.forEach((slot) => {
        globalSlots.push({
            modIndex,
            slotPosition: Number(slot?.position)
        });
    });
});

globalSlots.sort((left, right) => {
    if (left.modIndex === right.modIndex) {
        return left.slotPosition - right.slotPosition;
    }
    return left.modIndex - right.modIndex;
});

let vendIndex = globalSlots.findIndex((slot) =>
    slot.modIndex === vendModuleIndex && slot.slotPosition === vendSlotNumber
);
if (vendIndex === -1) vendIndex = 0;

const totalSlots = globalSlots.length;
let qualifyingSlots = [];

modules.forEach((stationModule, modIndex) => {
    const moduleTime = new Date(stationModule?.lastUpdated).getTime();
    const slots = Array.isArray(stationModule?.slots) ? stationModule.slots : [];

    if (isNaN(moduleTime) || (Date.now() - moduleTime) >= 10000) {
        return;
    }

    slots.forEach((slot) => {
        const sn = Number(slot?.sn || 0);
        const batteryLevel = Number(slot?.batteryLevel || 0);
        if (Number(slot?.status) !== 1) return;
        if (batteryLevel < 80) return;
        if (!sn || sn === 0 || String(sn) === '00000000') return;

        const globalIndex = globalSlots.findIndex((entry) =>
            entry.modIndex === modIndex && entry.slotPosition === Number(slot?.position)
        );

        qualifyingSlots.push({
            sn,
            batteryLevel,
            globalIndex,
            modIndex,
            moduleid: stationModule.id || modIndex,
            position: Number(slot?.position)
        });
    });
});

let candidateSlot = null;
let maxBattery = -1;
qualifyingSlots.forEach((slot) => {
    const distance = totalSlots > 0
        ? ((slot.globalIndex - vendIndex) + totalSlots) % totalSlots
        : 0;

    if (distance > 0 && slot.batteryLevel > maxBattery) {
        maxBattery = slot.batteryLevel;
        candidateSlot = slot;
    }
});

if (candidateSlot) {
    vendBatteryCandidate = vendBatteryCandidate || candidateSlot;
    firstModuleId = firstModuleId || candidateSlot.moduleid;
    finalSNs.push(candidateSlot.sn);
    qualifyingSlots = qualifyingSlots.filter((slot) => slot !== candidateSlot);
}

qualifyingSlots.forEach((slot) => {
    vendBatteryCandidate = vendBatteryCandidate || slot;
    firstModuleId = firstModuleId || slot.moduleid;
    finalSNs.push(slot.sn);
});

const statusValue = finalSNs.length === 0
    ? (recentModuleFound ? 'soldout' : 'offline')
    : finalSNs;

msg.payload = {
    stationid: station.stationid || stationId,
    moduleid: firstModuleId,
    action: 'status',
    status: statusValue,
    pricing,
    hardware,
    formoptions,
    vendbattery: vendBatteryCandidate ? {
        powerlevel: vendBatteryCandidate.batteryLevel,
        slot: vendBatteryCandidate.position,
        sn: vendBatteryCandidate.sn
    } : null,
    timeresponded: Date.now(),
    timerequested: msg.payload.timerequested
};
msg.topic = 'CSTA/post/' + (station.stationid || stationId);

return msg;
`.trim();

const flow = [
  {
    id: 'ss-import-tab',
    type: 'tab',
    label: 'Send Status Firebase Only',
    disabled: false,
    info: 'Importable Firebase-only status request flow for Besiter kiosks.',
    env: [],
  },
  {
    id: 'ss-import-group',
    type: 'group',
    z: 'ss-import-tab',
    name: 'send status to server firebase only',
    style: {
      stroke: '#1d4ed8',
      fill: '#dbeafe',
      label: true,
      color: '#000000',
    },
    nodes: [
      'ss-link-in',
      'ss-switch',
      'ss-poll-prep',
      'ss-poll-query',
      'ss-poll-resolve',
      'ss-check-modules',
      'ss-poll-out',
      'ss-trigger',
      'ss-refresh-prep',
      'ss-refresh-query',
      'ss-refresh-resolve',
      'ss-build-status',
      'ss-response-out',
      'ss-debug-request',
      'ss-debug-response',
    ],
    x: 54,
    y: 99,
    w: 1692,
    h: 302,
  },
  {
    id: 'ss-comment-1',
    type: 'comment',
    z: 'ss-import-tab',
    name: 'Connect Status request input from your command flow',
    info: '',
    x: 230,
    y: 80,
    wires: [],
  },
  {
    id: 'ss-comment-2',
    type: 'comment',
    z: 'ss-import-tab',
    name: 'Connect Module poll out to MQTT publish and Status response out to your server publish path',
    info: '',
    x: 740,
    y: 80,
    wires: [],
  },
  {
    id: 'ss-link-in',
    type: 'link in',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Status request input',
    links: [],
    x: 130,
    y: 240,
    wires: [['ss-switch']],
  },
  {
    id: 'ss-switch',
    type: 'switch',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'chk status',
    property: 'payload.action',
    propertyType: 'msg',
    rules: [{ t: 'eq', v: 'status', vt: 'str' }],
    checkall: 'true',
    repair: false,
    outputs: 1,
    x: 290,
    y: 240,
    wires: [['ss-poll-prep', 'ss-trigger', 'ss-debug-request']],
  },
  {
    id: 'ss-debug-request',
    type: 'debug',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'status request',
    active: false,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: 'true',
    targetType: 'full',
    x: 500,
    y: 320,
    wires: [],
  },
  {
    id: 'ss-poll-prep',
    type: 'function',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Prepare Poll Query',
    func: prepareQueryFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 500,
    y: 180,
    wires: [['ss-poll-query']],
  },
  {
    id: 'ss-poll-query',
    type: 'google-cloud-firestore',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    account: '',
    keyFilename: '/home/george/firestore/firestore-key.json',
    name: 'Query kiosk for poll',
    projectId: 'node-red-alerts',
    mode: 'query',
    x: 720,
    y: 180,
    wires: [['ss-poll-resolve']],
  },
  {
    id: 'ss-poll-resolve',
    type: 'function',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Resolve Kiosk For Poll',
    func: resolvePollFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 950,
    y: 180,
    wires: [['ss-check-modules']],
  },
  {
    id: 'ss-check-modules',
    type: 'function',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'check modules (Firebase)',
    func: checkModulesFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 1190,
    y: 180,
    wires: [['ss-poll-out']],
  },
  {
    id: 'ss-poll-out',
    type: 'link out',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Module poll out',
    mode: 'link',
    links: [],
    x: 1385,
    y: 180,
    wires: [],
  },
  {
    id: 'ss-trigger',
    type: 'trigger',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Wait 8s',
    op1: '',
    op2: '',
    op1type: 'nul',
    op2type: 'pay',
    duration: '8',
    extend: false,
    overrideDelay: false,
    units: 's',
    reset: '',
    bytopic: 'topic',
    topic: 'payload.stationid',
    outputs: 1,
    x: 500,
    y: 260,
    wires: [['ss-refresh-prep']],
  },
  {
    id: 'ss-refresh-prep',
    type: 'function',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Prepare Refresh Query',
    func: prepareQueryFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 720,
    y: 260,
    wires: [['ss-refresh-query']],
  },
  {
    id: 'ss-refresh-query',
    type: 'google-cloud-firestore',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    account: '',
    keyFilename: '/home/george/firestore/firestore-key.json',
    name: 'Query refreshed kiosk',
    projectId: 'node-red-alerts',
    mode: 'query',
    x: 950,
    y: 260,
    wires: [['ss-refresh-resolve']],
  },
  {
    id: 'ss-refresh-resolve',
    type: 'function',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Resolve Kiosk For Response',
    func: resolveResponseFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 1190,
    y: 260,
    wires: [['ss-build-status']],
  },
  {
    id: 'ss-build-status',
    type: 'function',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Build status from Firebase',
    func: buildStatusFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 1430,
    y: 260,
    wires: [['ss-response-out', 'ss-debug-response']],
  },
  {
    id: 'ss-response-out',
    type: 'link out',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'Status response out',
    mode: 'link',
    links: [],
    x: 1645,
    y: 260,
    wires: [],
  },
  {
    id: 'ss-debug-response',
    type: 'debug',
    z: 'ss-import-tab',
    g: 'ss-import-group',
    name: 'status response',
    active: false,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: 'true',
    targetType: 'full',
    x: 1440,
    y: 320,
    wires: [],
  },
];

fs.writeFileSync(outputPath, JSON.stringify(flow, null, 4) + '\n');
console.log(`Wrote ${outputPath}`);
