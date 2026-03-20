import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPath = path.join(__dirname, 'admin-get-firebase-import.json');

const prepareLockQueryFunc = `
const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
const stationid = String(payload.stationid || '').trim();
const moduleId = String(payload.moduleId || payload.moduleid || '').trim();
const slot = Number(payload.slot);
const cmd = String(payload.cmd || '').trim().toLowerCase();

if (!stationid || !moduleId || !Number.isFinite(slot)) {
    node.error('Lock/unlock payload must include stationid, moduleId, and slot', msg);
    return null;
}

msg._adminPayload = JSON.parse(JSON.stringify(payload));
msg._lockContext = {
    stationid,
    moduleId,
    slot,
    explicitLock: cmd === 'lock' ? true : (cmd === 'unlock' ? false : null),
    lockReason: typeof payload.info === 'string' ? payload.info : (payload.lockReason || '')
};

msg.payload = {
    path: 'kiosks',
    query: [{ fieldPath: 'stationid', opStr: '==', value: stationid }]
};

return msg;
`.trim();

const applyLockUpdateFunc = `
const docs = Array.isArray(msg.payload) ? msg.payload : [];
const ctx = msg._lockContext;

if (!ctx) {
    node.error('Missing msg._lockContext', msg);
    return null;
}

if (docs.length === 0) {
    node.error('No kiosk found for stationid: ' + ctx.stationid, msg);
    return null;
}

function moduleMatches(left, right) {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    return ('1000' + a) === b || a === b.replace(/^1000/, '');
}

function chargingCurrent(slot) {
    return Number(slot?.chargingCurrent ?? slot?.chargeCurrent ?? 0);
}

const doc = JSON.parse(JSON.stringify(docs[0]));
const provisionid = String(doc.provisionid || '').trim();
if (!provisionid) {
    node.error('Kiosk document is missing provisionid', msg);
    return null;
}

const modules = Array.isArray(doc.modules) ? doc.modules : [];
const targetModule = modules.find((mod) => moduleMatches(mod?.id, ctx.moduleId));
if (!targetModule) {
    node.error('Module not found for moduleId: ' + ctx.moduleId, msg);
    return null;
}

const slots = Array.isArray(targetModule.slots) ? targetModule.slots : [];
const targetSlot = slots.find((slot) => Number(slot?.position) === ctx.slot);
if (!targetSlot) {
    node.error('Slot not found for moduleId ' + ctx.moduleId + ' slot ' + ctx.slot, msg);
    return null;
}

const nextLock = ctx.explicitLock === null ? !Boolean(targetSlot.lock) : ctx.explicitLock;
targetSlot.lock = nextLock;
if (nextLock) {
    targetSlot.lockReason = ctx.lockReason || targetSlot.lockReason || '';
} else {
    delete targetSlot.lockReason;
}

const configuredPower = Number(doc.hardware?.power);
const fullThreshold = Number.isFinite(configuredPower) ? configuredPower : 80;
let count = 0;
let slotscount = 0;
let lockcount = 0;
let total = 0;
let full = 0;
let empty = 0;
let slotCount = 0;
let charging = 0;

modules.forEach((mod) => {
    const modSlots = Array.isArray(mod?.slots) ? mod.slots : [];
    mod.lock = modSlots.reduce((sum, entry) => sum + (entry?.lock ? 1 : 0), 0);
    slotscount += modSlots.length;
    lockcount += mod.lock;

    mod.total = 0;
    mod.full = 0;
    mod.empty = 0;
    mod.slot = 0;
    mod.charging = 0;

    modSlots.forEach((entry) => {
        const status = Number(entry?.status);
        const batteryLevel = Number(entry?.batteryLevel || 0);
        const sn = Number(entry?.sn || 0);
        const isCharging = chargingCurrent(entry) > 0;

        if (status === 1) {
            total += 1;
            mod.total += 1;
            if (batteryLevel >= fullThreshold) {
                full += 1;
                mod.full += 1;
                if (!entry?.lock && sn !== 0) count += 1;
            } else {
                empty += 1;
                mod.empty += 1;
            }
        } else if (status === 0) {
            slotCount += 1;
            mod.slot += 1;
        }

        if (isCharging) {
            charging += 1;
            mod.charging += 1;
        }
    });
});

const nowIso = new Date().toISOString();
msg._adminPayload = msg._adminPayload || {};
msg.payload = {
    path: 'kiosks/' + provisionid,
    content: {
        modules,
        count,
        slotscount,
        lockcount,
        zerocount: Number(doc.zerocount || 0),
        chargers: count === 0 ? 'soldout' : count,
        total,
        full,
        empty,
        slot: slotCount,
        charging,
        lastUpdate: nowIso,
        timestamp: nowIso
    }
};

return msg;
`.trim();

const prepareDownstreamLockFunc = `
msg.payload = msg._adminPayload || msg.payload || {};
msg.id = msg.payload.stationid;
msg.module = msg.payload.moduleId || msg.payload.moduleid;
return msg;
`.trim();

const prepareKioskListQueryFunc = `
msg._adminPayload = (msg.payload && typeof msg.payload === 'object')
    ? JSON.parse(JSON.stringify(msg.payload))
    : {};

msg.payload = {
    path: 'kiosks',
    query: []
};

return msg;
`.trim();

const preparePendingQueryFunc = `
msg._hqKiosks = Array.isArray(msg.payload) ? JSON.parse(JSON.stringify(msg.payload)) : [];
msg.payload = {
    path: 'pending',
    query: []
};
return msg;
`.trim();

const buildInfoResponseFunc = `
function chargingCurrent(slot) {
    return Number(slot?.chargingCurrent ?? slot?.chargeCurrent ?? 0);
}

const kiosks = Array.isArray(msg._hqKiosks) ? msg._hqKiosks : [];
const pendingModules = Array.isArray(msg.payload) ? msg.payload : [];
const adminPayload = msg._adminPayload || {};
const chargers = [];

kiosks.forEach((kiosk) => {
    const stationId = String(kiosk?.stationid || '').trim();
    const modules = Array.isArray(kiosk?.modules) ? kiosk.modules : [];
    const location = kiosk?.info?.location || '';
    const place = kiosk?.info?.place || '';

    modules.forEach((module) => {
        const moduleId = String(module?.id || '').trim();
        const slots = Array.isArray(module?.slots) ? module.slots : [];
        const lastUpdated = module?.lastUpdated || kiosk?.lastUpdate || kiosk?.timestamp || null;

        slots.forEach((slot) => {
            const sn = Number(slot?.sn || 0);
            if (!sn) return;

            const batteryLevel = Number(slot?.batteryLevel || 0);
            const current = chargingCurrent(slot);
            chargers.push({
                sn,
                position: Number(slot?.position || 0),
                state: batteryLevel >= 80 ? 'available' : 'pending',
                dischargeCurrent: Number(slot?.dischargeCurrent || 0),
                cellVoltage: Number(slot?.cellVoltage || 0),
                areaCode: Number(slot?.areaCode || 0),
                batteryLevel,
                temperature: Number(slot?.temperature || 0),
                chargeVoltage: Number(slot?.chargeVoltage ?? slot?.chargingVoltage ?? 0),
                chargeCurrent: current,
                chargingVoltage: Number(slot?.chargingVoltage ?? slot?.chargeVoltage ?? 0),
                chargingCurrent: current,
                softwareVersion: Number(slot?.softwareVersion || 0),
                holeDetection: Number(slot?.holeDetection || 0),
                moduleId,
                stationId,
                rented: Boolean(slot?.rented),
                cycle: Number(slot?.cycle || 0),
                lastUpdated,
                location,
                place,
                lock: Boolean(slot?.lock),
                isCharging: current > 0
            });
        });
    });
});

msg.topic = 'admin/receive';
msg.payload = {
    action: 'get_info',
    admin: adminPayload.admin,
    hq_info: {
        stations: kiosks,
        pending_modules: pendingModules,
        chargers
    }
};

return msg;
`.trim();

const flow = [
  {
    id: 'agfb-tab',
    type: 'tab',
    label: 'Admin Get Firebase Only',
    disabled: false,
    info: 'Firebase-only rewrite of admin/get control and get_info snapshot flow.',
    env: [],
  },
  {
    id: 'agfb-group',
    type: 'group',
    z: 'agfb-tab',
    name: 'admin/get firebase only',
    style: {
      stroke: '#1d4ed8',
      fill: '#dbeafe',
      label: true,
      color: '#000000',
    },
    nodes: [
      'agfb-in',
      'agfb-debug-in',
      'agfb-switch',
      'agfb-lock-prep',
      'agfb-lock-query',
      'agfb-lock-build',
      'agfb-lock-set',
      'agfb-lock-debug',
      'agfb-lock-downstream',
      'agfb-lock-out',
      'agfb-hq-prep',
      'agfb-kiosk-query',
      'agfb-pending-prep',
      'agfb-pending-query',
      'agfb-hq-build',
      'agfb-hq-debug',
      'agfb-out',
    ],
    x: 44,
    y: 79,
    w: 1942,
    h: 302,
  },
  {
    id: 'agfb-comment-1',
    type: 'comment',
    z: 'agfb-tab',
    name: 'MQTT admin/get in, Firebase kiosk snapshot out',
    info: '',
    x: 220,
    y: 60,
    wires: [],
  },
  {
    id: 'agfb-comment-2',
    type: 'comment',
    z: 'agfb-tab',
    name: 'Connect Downstream lock command out to your existing kiosk lock/unlock flow',
    info: '',
    x: 840,
    y: 60,
    wires: [],
  },
  {
    id: 'agfb-broker',
    type: 'mqtt-broker',
    name: '',
    broker: 'http://34.56.244.66/',
    port: '1883',
    clientid: '',
    autoConnect: true,
    usetls: false,
    protocolVersion: '4',
    keepalive: '60',
    cleansession: true,
    autoUnsubscribe: true,
    birthTopic: '',
    birthQos: '0',
    birthRetain: 'false',
    birthPayload: '',
    birthMsg: {},
    closeTopic: '',
    closeQos: '0',
    closeRetain: 'false',
    closePayload: '',
    closeMsg: {},
    willTopic: '',
    willQos: '0',
    willRetain: 'false',
    willPayload: '',
    willMsg: {},
    userProps: '',
    sessionExpiry: '',
  },
  {
    id: 'agfb-in',
    type: 'mqtt-json',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'admin/get',
    topic: 'admin/get',
    property: '',
    qos: '2',
    broker: 'agfb-broker',
    x: 150,
    y: 220,
    wires: [['agfb-switch', 'agfb-debug-in']],
  },
  {
    id: 'agfb-debug-in',
    type: 'debug',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'admin/get in',
    active: false,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: 'true',
    targetType: 'full',
    x: 330,
    y: 300,
    wires: [],
  },
  {
    id: 'agfb-switch',
    type: 'switch',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'cmd switch',
    property: 'payload.cmd',
    propertyType: 'msg',
    rules: [
      { t: 'eq', v: 'lock', vt: 'str' },
      { t: 'eq', v: 'unlock', vt: 'str' },
      { t: 'else' },
    ],
    checkall: 'true',
    repair: false,
    outputs: 3,
    x: 340,
    y: 220,
    wires: [
      ['agfb-lock-prep'],
      ['agfb-lock-prep'],
      ['agfb-hq-prep'],
    ],
  },
  {
    id: 'agfb-lock-prep',
    type: 'function',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Prepare lock query',
    func: prepareLockQueryFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 560,
    y: 160,
    wires: [['agfb-lock-query']],
  },
  {
    id: 'agfb-lock-query',
    type: 'google-cloud-firestore',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Query kiosk for lock',
    account: '',
    keyFilename: '/home/george/firestore/firestore-key.json',
    projectId: 'node-red-alerts',
    mode: 'query',
    x: 770,
    y: 160,
    wires: [['agfb-lock-build']],
  },
  {
    id: 'agfb-lock-build',
    type: 'function',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Apply lock in Firebase',
    func: applyLockUpdateFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 990,
    y: 160,
    wires: [['agfb-lock-set']],
  },
  {
    id: 'agfb-lock-set',
    type: 'google-cloud-firestore',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Update lock in Firebase',
    account: '',
    keyFilename: '/home/george/firestore/firestore-key.json',
    projectId: 'node-red-alerts',
    mode: 'update',
    x: 1210,
    y: 160,
    wires: [['agfb-lock-downstream', 'agfb-lock-debug']],
  },
  {
    id: 'agfb-lock-debug',
    type: 'debug',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'lock Firebase write',
    active: false,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: 'true',
    targetType: 'full',
    x: 1240,
    y: 100,
    wires: [],
  },
  {
    id: 'agfb-lock-downstream',
    type: 'function',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Prepare downstream lock command',
    func: prepareDownstreamLockFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 1450,
    y: 160,
    wires: [['agfb-lock-out']],
  },
  {
    id: 'agfb-lock-out',
    type: 'link out',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Downstream lock command out',
    mode: 'link',
    links: [],
    x: 1685,
    y: 160,
    wires: [],
  },
  {
    id: 'agfb-hq-prep',
    type: 'function',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Prepare kiosk list query',
    func: prepareKioskListQueryFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 560,
    y: 260,
    wires: [['agfb-kiosk-query']],
  },
  {
    id: 'agfb-kiosk-query',
    type: 'google-cloud-firestore',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Query kiosks',
    account: '',
    keyFilename: '/home/george/firestore/firestore-key.json',
    projectId: 'node-red-alerts',
    mode: 'query',
    x: 770,
    y: 260,
    wires: [['agfb-pending-prep']],
  },
  {
    id: 'agfb-pending-prep',
    type: 'function',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Prepare pending query',
    func: preparePendingQueryFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 980,
    y: 260,
    wires: [['agfb-pending-query']],
  },
  {
    id: 'agfb-pending-query',
    type: 'google-cloud-firestore',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Query pending modules',
    account: '',
    keyFilename: '/home/george/firestore/firestore-key.json',
    projectId: 'node-red-alerts',
    mode: 'query',
    x: 1210,
    y: 260,
    wires: [['agfb-hq-build']],
  },
  {
    id: 'agfb-hq-build',
    type: 'function',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'Build HQ info from Firebase',
    func: buildInfoResponseFunc,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 1450,
    y: 260,
    wires: [['agfb-out', 'agfb-hq-debug']],
  },
  {
    id: 'agfb-hq-debug',
    type: 'debug',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'admin/receive out',
    active: false,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: 'true',
    targetType: 'full',
    x: 1460,
    y: 320,
    wires: [],
  },
  {
    id: 'agfb-out',
    type: 'mqtt out',
    z: 'agfb-tab',
    g: 'agfb-group',
    name: 'admin/receive',
    topic: '',
    qos: '2',
    retain: 'false',
    respTopic: '',
    contentType: '',
    userProps: '',
    correl: '',
    expiry: '',
    broker: 'agfb-broker',
    x: 1680,
    y: 260,
    wires: [],
  },
];

fs.writeFileSync(outputPath, JSON.stringify(flow, null, 4) + '\n');
console.log(`Wrote ${outputPath}`);
