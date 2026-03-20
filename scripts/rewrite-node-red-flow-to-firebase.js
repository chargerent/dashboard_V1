import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = process.argv[2] || '/Users/georgegazelian/Downloads/flows (9).json';
const OUTPUT_PATH = process.argv[3] || path.join(__dirname, 'flows-firebase-rewritten.json');

const FIREBASE_NODE = {
  account: '',
  keyFilename: '/home/george/firestore/firestore-key.json',
  projectId: 'node-red-alerts',
};

const flow = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
const byId = new Map(flow.map((node) => [node.id, node]));

function block(fn) {
  const src = fn.toString();
  return src.slice(src.indexOf('/*') + 2, src.lastIndexOf('*/')).replace(/^\n/, '').replace(/\n\s*$/, '');
}

function requireNode(id) {
  const node = byId.get(id);
  if (!node) {
    throw new Error(`Missing node: ${id}`);
  }
  return node;
}

function patchNode(id, patch) {
  Object.assign(requireNode(id), patch);
}

function addNode(node) {
  if (byId.has(node.id)) {
    throw new Error(`Duplicate node id: ${node.id}`);
  }

  flow.push(node);
  byId.set(node.id, node);

  if (node.g) {
    const group = requireNode(node.g);
    group.nodes = Array.isArray(group.nodes) ? group.nodes : [];
    if (!group.nodes.includes(node.id)) {
      group.nodes.push(node.id);
    }
  }
}

function expandGroup(id, patch) {
  const group = requireNode(id);
  Object.assign(group, patch);
}

const MAP_SNIPPET = `
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
`.trim();

const statusCt3Func = block(function () { /*
let stations = global.get("stations") || [];
let chargers = global.get("chargers") || [];

const buffer = msg.payload;
if (!Buffer.isBuffer(buffer)) {
    node.error("Payload must be a Buffer", msg);
    return null;
}

const timestamp = new Date().toISOString();
const data = Array.from(buffer.slice(4));
const slotData = data.slice(6);

function getChargerSN(bytes) {
    return (
        ((bytes[0] & 0xFF) << 24) |
        ((bytes[1] & 0xFF) << 16) |
        ((bytes[2] & 0xFF) << 8)  |
        (bytes[3] & 0xFF)
    ) >>> 0;
}

let allSlots = [];
const segmentLength = 15;
const slotCount = Math.floor(slotData.length / segmentLength);

for (let i = 0; i < slotCount; i++) {
    const offset = i * segmentLength;
    const bytes  = slotData.slice(offset, offset + segmentLength);
    const sn     = getChargerSN(bytes.slice(5, 9));
    allSlots.push({
        position:         bytes[0],
        status:           bytes[1],
        dischargeCurrent: bytes[2],
        cellVoltage:      bytes[3],
        areaCode:         bytes[4],
        sn,
        batteryLevel:     bytes[9],
        temperature:      bytes[10],
        chargeVoltage:    bytes[11],
        chargeCurrent:    bytes[12],
        softwareVersion:  bytes[13],
        holeDetection:    bytes[14],
        lock:             false,
        lockReason:       '',
        rented:           false,
        cycle:            0
    });
}

const targetModuleId = msg.module;
if (!targetModuleId) { node.error("No module ID (msg.module) provided"); return null; }

let targetStation = stations.find(st => st.modules?.some(m => m.id === targetModuleId));
if (!targetStation) { node.error(`No station contains module ID ${targetModuleId}`); return null; }

let moduleObj = targetStation.modules.find(m => m.id === targetModuleId);
if (!moduleObj) { node.error(`Module ${targetModuleId} not found in station`); return null; }

allSlots.forEach(slot => {
    const existing = moduleObj.slots.find(s => String(s.position) === String(slot.position));
    slot.lock       = existing?.lock ?? false;
    slot.lockReason = existing?.lockReason ?? '';
    slot.cycle      = existing?.cycle ?? 0;
    slot.rented     = false;
});
moduleObj.slots       = allSlots;
moduleObj.lastUpdated = timestamp;

let totalCount = 0, fullCount = 0, emptyCount = 0, slotCountFree = 0, chargingCount = 0;
moduleObj.slots.forEach(s => {
    if (s.status === 1) {
        totalCount++;
        s.batteryLevel >= 80 ? fullCount++ : emptyCount++;
    } else if (s.status === 0) {
        slotCountFree++;
    }
    if (s.chargeCurrent > 0) chargingCount++;
});
moduleObj.total    = totalCount;
moduleObj.full     = fullCount;
moduleObj.empty    = emptyCount;
moduleObj.slot     = slotCountFree;
moduleObj.charging = chargingCount;

["total", "full", "empty", "slot", "charging"].forEach(prop => {
    targetStation[prop] = targetStation.modules.reduce((sum, m) => sum + (m[prop] || 0), 0);
});

let added = 0;
allSlots.forEach(slot => {
    if (!slot.sn) return;
    const state = slot.batteryLevel >= 80 ? "available" : "pending";
    const idx   = chargers.findIndex(c => c.sn === slot.sn);
    const chargerData = {
        sn: slot.sn, position: slot.position, state,
        dischargeCurrent: slot.dischargeCurrent, cellVoltage: slot.cellVoltage,
        areaCode: slot.areaCode, batteryLevel: slot.batteryLevel,
        temperature: slot.temperature, chargeVoltage: slot.chargeVoltage,
        chargeCurrent: slot.chargeCurrent, softwareVersion: slot.softwareVersion,
        holeDetection: slot.holeDetection, moduleId: moduleObj.id,
        stationId: targetStation.stationid, rented: false, cycle: slot.cycle,
        lastUpdated: timestamp, location: targetStation.info?.location || "",
        place: targetStation.info?.place || "", lock: slot.lock,
        isCharging: slot.chargeCurrent > 0
    };
    if (idx !== -1) { chargers[idx] = { ...chargers[idx], ...chargerData }; }
    else { chargers.push(chargerData); added++; }
});

global.set("stations", stations);
global.set("chargers", chargers);

msg.stations = stations;
msg.chargers = chargers;
msg._updatedStation = targetStation;
node.warn(`CT3: Updated ${allSlots.length} slots in module ${targetModuleId} (added ${added})`);
return msg;
*/});

const statusLegacyFunc = block(function () { /*
let stations = global.get("stations") || [];
let chargers = global.get("chargers") || [];

const buffer = msg.payload;
if (!Buffer.isBuffer(buffer)) {
    node.error("Payload must be a Buffer", msg);
    return null;
}

const timestamp = new Date().toISOString();
const data = Array.from(buffer.slice(4));

function getChargerSN(bytes) {
    return (
        ((bytes[0] & 0xFF) << 24) |
        ((bytes[1] & 0xFF) << 16) |
        ((bytes[2] & 0xFF) << 8) |
        (bytes[3] & 0xFF)
    ) >>> 0;
}

let allSlots = [];
for (let i = 0; i < 12; i++) {
    const moduleOffset = i * 66;
    const moduleBlock  = data.slice(moduleOffset, moduleOffset + 66);
    if (moduleBlock.length < 66) { node.warn(`Module ${i + 1} is incomplete`); continue; }
    const chargersBytes = moduleBlock.slice(6);
    for (let j = 0; j < 4; j++) {
        const offset = j * 15;
        const bytes  = chargersBytes.slice(offset, offset + 15);
        if (bytes.length < 15) { node.warn(`Module ${i + 1} Slot ${j + 1} is incomplete`); continue; }
        const sn = getChargerSN(bytes.slice(5, 9));
        allSlots.push({
            position:         bytes[0],
            status:           bytes[1],
            dischargeCurrent: bytes[2],
            cellVoltage:      bytes[3],
            areaCode:         bytes[4],
            sn,
            batteryLevel:     bytes[9],
            temperature:      bytes[10],
            chargingVoltage:  bytes[11],
            chargingCurrent:  bytes[12],
            softwareVersion:  bytes[13],
            holeDetection:    bytes[14],
            lock:             false,
            lockReason:       ''
        });
    }
}

const targetModuleId = msg.module;
if (!targetModuleId) { node.error("No module ID (msg.module) provided"); return null; }

let targetStation = stations.find(st => st.modules?.some(m => m.id === targetModuleId));
if (!targetStation) { node.error(`No station found containing module id ${targetModuleId}`); return null; }

let module = targetStation.modules.find(m => m.id === targetModuleId);
if (!module) { node.error(`Station found, but no module with id ${targetModuleId}`); return null; }

allSlots.forEach(slot => {
    const existing = module.slots.find(s => String(s.position) === String(slot.position));
    slot.lock       = existing?.lock ?? false;
    slot.lockReason = existing?.lockReason ?? '';
    slot.rented     = false;
    slot.cycle      = existing?.cycle ?? 0;
});
module.slots       = allSlots;
module.lastUpdated = timestamp;

let total = 0, full = 0, empty = 0, slotCount = 0, chargingCount = 0;
module.slots.forEach(s => {
    if (s.status === 1) {
        total++;
        s.batteryLevel >= 80 ? full++ : empty++;
    } else if (s.status === 0) {
        slotCount++;
    }
    if (s.chargingCurrent > 0) chargingCount++;
});
module.total    = total;
module.full     = full;
module.empty    = empty;
module.slot     = slotCount;
module.charging = chargingCount;

targetStation.total    = targetStation.modules.reduce((sum, m) => sum + (m.total    || 0), 0);
targetStation.full     = targetStation.modules.reduce((sum, m) => sum + (m.full     || 0), 0);
targetStation.empty    = targetStation.modules.reduce((sum, m) => sum + (m.empty    || 0), 0);
targetStation.slot     = targetStation.modules.reduce((sum, m) => sum + (m.slot     || 0), 0);
targetStation.charging = targetStation.modules.reduce((sum, m) => sum + (m.charging || 0), 0);

let addedCount = 0;
allSlots.forEach(slot => {
    if (!slot.sn || slot.sn === 0) return;
    const chargerState  = slot.batteryLevel >= 80 ? "available" : "pending";
    const existingIndex = chargers.findIndex(c => c.sn === slot.sn);
    const chargerData = {
        sn: slot.sn, position: slot.position, state: chargerState,
        dischargeCurrent: slot.dischargeCurrent, cellVoltage: slot.cellVoltage,
        areaCode: slot.areaCode, batteryLevel: slot.batteryLevel,
        temperature: slot.temperature, chargeVoltage: slot.chargingVoltage,
        chargeCurrent: slot.chargingCurrent, softwareVersion: slot.softwareVersion,
        holeDetection: slot.holeDetection, moduleId: module.id,
        stationId: targetStation.stationid, rented: false, cycle: slot.cycle,
        lastUpdated: timestamp, location: targetStation.info?.location || "",
        place: targetStation.info?.place || "", lock: slot.lock,
        isCharging: slot.chargingCurrent > 0
    };
    if (existingIndex !== -1) { chargers[existingIndex] = { ...chargers[existingIndex], ...chargerData }; }
    else { chargers.push(chargerData); addedCount++; }
});

global.set("stations", stations);
global.set("chargers", chargers);

msg.stations = stations;
msg.chargers = chargers;
msg._updatedStation = targetStation;
node.warn(`Updated ${allSlots.length} slots for module ${targetModuleId} | Charging: ${module.charging} | Added: ${addedCount} | Total: ${module.total} | Full: ${module.full} | Empty: ${module.empty}`);
return msg;
*/});

const statusPrepareFunc = block(function () { /*
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

const station = msg._updatedStation;
if (!station) {
    node.error('No _updatedStation on msg');
    return null;
}

const newStationId = ID_MAP[station.stationid] || station.stationid;
const modules = Array.isArray(station.modules) ? station.modules : [];
const configuredPower = Number(station.hardware?.power);
const fullThreshold = Number.isFinite(configuredPower) ? configuredPower : 80;

let count = 0;
let slotscount = 0;
let lockcount = 0;

modules.forEach(mod => {
    const slots = Array.isArray(mod.slots) ? mod.slots : [];
    slotscount += slots.length;
    slots.forEach(slot => {
        if (slot?.lock) lockcount++;
        if (
            slot &&
            slot.status === 1 &&
            slot.sn &&
            slot.sn !== 0 &&
            typeof slot.batteryLevel === 'number' &&
            slot.batteryLevel >= fullThreshold &&
            !slot.lock
        ) {
            count++;
        }
    });
});

const timestamp = new Date().toISOString();

msg._newStationId  = newStationId;
msg._stationUpdate = {
    modules:    station.modules,
    total:      station.total,
    full:       station.full,
    empty:      station.empty,
    slot:       station.slot,
    charging:   station.charging,
    count,
    slotscount,
    lockcount,
    zerocount: 0,
    chargers:   count === 0 ? 'soldout' : count,
    lastUpdate: timestamp,
    timestamp
};

msg.payload = {
    path:  'kiosks',
    query: [{ fieldPath: 'stationid', opStr: '==', value: newStationId }]
};

return msg;
*/});

const prepareProvisionQueryFunc = `${MAP_SNIPPET}\n\n${block(function () { /*
const asArray = (value) => Array.isArray(value) ? value : Object.values(value || {});
const input = msg.payload || {};
const kiosk = input.kiosk || input;
const timestamp = new Date().toISOString();

function normalizeModules(rawModules, fallbackId) {
    const modules = asArray(rawModules)
        .map((mod, index) => {
            const id = String(mod?.id || fallbackId || `module-${index + 1}`).trim();
            if (!id) return null;
            return {
                ...mod,
                id,
                slots: Array.isArray(mod?.slots) ? mod.slots : [],
                lastUpdated: mod?.lastUpdated || timestamp,
                output: mod?.output !== false
            };
        })
        .filter(Boolean);

    if (modules.length === 0 && fallbackId) {
        modules.push({
            id: String(fallbackId).trim(),
            slots: [],
            lastUpdated: timestamp,
            output: true
        });
    }

    return modules;
}

const moduleSeed = kiosk.hardware?.sn || msg.module || input.module || '';
const modules = normalizeModules(kiosk.modules, moduleSeed);

msg.admin = input.admin || kiosk.provisionid || msg.provisionid || '';
msg.sender = input.sender || 'nodered';
msg.modules = modules;
msg._provisionDraft = {
    stationid: normalizeStationId(kiosk.stationid || input.stationid || msg.stationid || ''),
    provisionid: String(kiosk.provisionid || input.provisionid || msg.provisionid || '').trim(),
    hardware: { ...(kiosk.hardware || {}) },
    pricing: kiosk.pricing || {},
    ui: kiosk.ui || {},
    info: kiosk.info || {},
    modules,
    total: Number(kiosk.total || 0),
    full: Number(kiosk.full || 0),
    empty: Number(kiosk.empty || 0),
    slot: Number(kiosk.slot || 0),
    charging: Number(kiosk.charging || 0),
    active: kiosk.active !== false,
    enabled: kiosk.enabled !== false,
    vendslot: kiosk.vendslot || '',
    status: kiosk.status || 'provisioned',
    timestamp
};

if (!msg._provisionDraft.provisionid) {
    node.error('Provision payload is missing provisionid', msg);
    return null;
}

msg.payload = {
    path: 'kiosks',
    query: []
};

return msg;
*/})}`;

const prepareProvisionWriteFunc = block(function () { /*
const docs = Array.isArray(msg.payload) ? msg.payload : [];
const draft = msg._provisionDraft;

if (!draft) {
    node.error('Missing msg._provisionDraft', msg);
    return null;
}

function prefixForCountry(country) {
    const value = String(country || '').toUpperCase();
    if (value === 'CA' || value === 'CAN') return 'CAB';
    if (value === 'FR' || value === 'EUR') return 'FRB';
    return 'USB';
}

function allocateStationId(existingDocs, country) {
    const prefix = prefixForCountry(country);
    let next = 1;

    existingDocs.forEach((doc) => {
        const stationid = String(doc.stationid || '');
        const match = stationid.match(new RegExp(`^${prefix}(\\d{4})$`));
        if (match) {
            next = Math.max(next, Number(match[1]) + 1);
        }
    });

    return `${prefix}${String(next).padStart(4, '0')}`;
}

if (!draft.stationid) {
    draft.stationid = allocateStationId(docs, draft.info?.country);
}

const duplicate = docs.some((doc) => (
    String(doc.provisionid || '') === draft.provisionid ||
    String(doc.stationid || '') === draft.stationid
));

if (duplicate) {
    msg.payload = { status: 'duplicate error', action: 'Provision' };
    return [msg, null];
}

const configuredPower = Number(draft.hardware?.power);
const fullThreshold = Number.isFinite(configuredPower) ? configuredPower : 80;
let count = 0;
let slotscount = 0;
let lockcount = 0;

draft.modules.forEach((mod) => {
    const slots = Array.isArray(mod.slots) ? mod.slots : [];
    slotscount += slots.length;
    slots.forEach((slot) => {
        if (slot?.lock) lockcount++;
        if (
            slot &&
            slot.status === 1 &&
            slot.sn &&
            slot.sn !== 0 &&
            typeof slot.batteryLevel === 'number' &&
            slot.batteryLevel >= fullThreshold &&
            !slot.lock
        ) {
            count++;
        }
    });
});

const kioskDoc = {
    ...draft,
    count,
    slotscount,
    lockcount,
    zerocount: 0,
    chargers: count === 0 ? 'soldout' : count,
    lastUpdate: draft.timestamp
};

msg._provisionDoc = kioskDoc;
msg.payload = {
    path: 'kiosks/' + kioskDoc.provisionid,
    content: kioskDoc
};

return [null, msg];
*/});

const finalizeProvisionResultFunc = block(function () { /*
msg.payload = { status: 'ok', action: 'Provision' };
return msg;
*/});

const prepareLockQueryFunc = `${MAP_SNIPPET}\n\n${block(function () { /*
const payload = msg.payload || {};
const slotValue = payload.slot ?? payload.slotid;
const slot = Number(slotValue);
const moduleId = String(payload.moduleId || payload.moduleid || msg.moduleId || msg.moduleid || msg.id || '').trim();
const stationid = normalizeStationId(payload.stationid || msg.stationid || msg.station || '');
const action = String(payload.action || '').toLowerCase();
const explicitLock = typeof payload.lock === 'boolean'
    ? payload.lock
    : (action.includes('unlock') ? false : (action.includes('lock') ? true : null));

if (!stationid || !moduleId || !Number.isFinite(slot)) {
    node.error('Lock slot payload is missing stationid, moduleId/moduleid, or slot', msg);
    return null;
}

msg._lockContext = {
    stationid,
    moduleId,
    slot,
    explicitLock,
    lockReason: typeof payload.info === 'string' ? payload.info : (payload.lockReason || '')
};

msg.payload = {
    path: 'kiosks',
    query: [{ fieldPath: 'stationid', opStr: '==', value: stationid }]
};

return msg;
*/})}`;

const applyLockFunc = block(function () { /*
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

const doc = docs[0];
const provisionid = doc.provisionid;
if (!provisionid) {
    node.error('Kiosk document is missing provisionid', msg);
    return null;
}

const modules = Array.isArray(doc.modules) ? doc.modules : [];
const targetModule = modules.find((mod) => {
    const modId = String(mod?.id || '').trim();
    return modId === ctx.moduleId || ('1000' + modId) === ctx.moduleId || modId === ctx.moduleId.replace(/^1000/, '');
});

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

targetModule.lock = slots.reduce((sum, slot) => sum + (slot?.lock ? 1 : 0), 0);

const configuredPower = Number(doc.hardware?.power);
const fullThreshold = Number.isFinite(configuredPower) ? configuredPower : 80;
let count = 0;
let slotscount = 0;
let lockcount = 0;

modules.forEach((mod) => {
    const modSlots = Array.isArray(mod.slots) ? mod.slots : [];
    slotscount += modSlots.length;
    mod.lock = modSlots.reduce((sum, slot) => sum + (slot?.lock ? 1 : 0), 0);
    modSlots.forEach((slot) => {
        if (slot?.lock) lockcount++;
        if (
            slot &&
            slot.status === 1 &&
            slot.sn &&
            slot.sn !== 0 &&
            typeof slot.batteryLevel === 'number' &&
            slot.batteryLevel >= fullThreshold &&
            !slot.lock
        ) {
            count++;
        }
    });
});

msg._lockResult = {
    stationid: ctx.stationid,
    moduleId: ctx.moduleId
};

msg.payload = {
    path: 'kiosks/' + provisionid,
    content: {
        modules,
        count,
        slotscount,
        lockcount,
        zerocount: Number(doc.zerocount || 0),
        chargers: count === 0 ? 'soldout' : count,
        vendslot: doc.vendslot || '',
        total: Number(doc.total || 0),
        full: Number(doc.full || 0),
        empty: Number(doc.empty || 0),
        slot: Number(doc.slot || 0),
        charging: Number(doc.charging || 0),
        lastUpdate: doc.lastUpdate || doc.timestamp || new Date().toISOString(),
        timestamp: doc.timestamp || doc.lastUpdate || new Date().toISOString()
    }
};

return msg;
*/});

const finalizeLockFunc = block(function () { /*
const result = msg._lockResult || {};
msg.payload = {
    stationid: result.stationid || '',
    moduleId: result.moduleId || '',
    moduleid: result.moduleId || ''
};
return msg;
*/});

const prepareVendslotQueryFunc = `${MAP_SNIPPET}\n\n${block(function () { /*
function parseTopic(topic) {
    const parts = String(topic || '').split('/').filter(Boolean);
    return {
        stationid: normalizeStationId(parts[0] || ''),
        moduleid: String(parts[1] || '').trim()
    };
}

const payload = msg.payload || {};
const parsed = parseTopic(msg.topic);
const stationid = normalizeStationId(msg.stationid || payload.stationid || parsed.stationid || '');
const batterySN = Number(payload.batterySN || payload.sn || payload.chargerid || 0);

if (!batterySN) {
    node.warn('Cannot update vendslot without batterySN');
    return null;
}

msg._vendslotContext = {
    stationid,
    batterySN
};

msg.payload = stationid
    ? {
        path: 'kiosks',
        query: [{ fieldPath: 'stationid', opStr: '==', value: stationid }]
    }
    : {
        path: 'kiosks',
        query: []
    };

return msg;
*/})}`;

const applyVendslotFunc = block(function () { /*
const docs = Array.isArray(msg.payload) ? msg.payload : [];
const ctx = msg._vendslotContext;

if (!ctx) {
    node.error('Missing msg._vendslotContext', msg);
    return null;
}

let matchedDoc = null;
let matchedModuleIndex = -1;
let matchedSlot = null;

docs.forEach((doc) => {
    if (matchedDoc) return;
    const modules = Array.isArray(doc.modules) ? doc.modules : [];
    modules.forEach((mod, moduleIndex) => {
        if (matchedDoc) return;
        const slots = Array.isArray(mod.slots) ? mod.slots : [];
        slots.forEach((slot) => {
            if (matchedDoc) return;
            if (Number(slot?.sn) === ctx.batterySN) {
                matchedDoc = doc;
                matchedModuleIndex = moduleIndex;
                matchedSlot = slot;
            }
        });
    });
});

if (!matchedDoc || !matchedDoc.provisionid || !matchedSlot) {
    node.warn('No kiosk slot matched vend SN ' + ctx.batterySN);
    return null;
}

msg.payload = {
    path: 'kiosks/' + matchedDoc.provisionid,
    content: {
        vendslot: matchedModuleIndex + '.' + matchedSlot.position
    }
};

return msg;
*/});

const preparePendingRentalWriteFunc = `${MAP_SNIPPET}\n\n${block(function () { /*
function toIso(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
        const millis = String(Math.trunc(num)).length <= 10 ? num * 1000 : num;
        return new Date(millis).toISOString();
    }
    return new Date().toISOString();
}

const payload = msg.payload || {};
if (String(payload.action || '').toLowerCase() !== 'vend') {
    return null;
}

const sn = Number(payload.chargerid || payload.sn || 0);
if (!sn) {
    node.warn('Skipping pending rental write without charger SN');
    return null;
}

const rentalTime = toIso(payload.timerequested);
const rawid = String(payload.rawid || payload.orderid || `rent-${sn}-${Date.parse(rentalTime)}`).trim();
const stationid = normalizeStationId(payload.stationid || msg.stationid || '');
const moduleid = String(payload.moduleid || payload.moduleId || msg.moduleid || '').trim();
const slotValue = payload.slotid ?? payload.slot ?? payload.requestedSlotid;
const slotid = Number(slotValue);

const rentalDoc = {
    rawid,
    rentalId: rawid,
    status: 'pending',
    sn,
    rentalStationid: stationid,
    rentalModuleid: moduleid,
    rentalTime,
    requestedAt: rentalTime,
    rentalSlotid: Number.isFinite(slotid) ? slotid : null,
    requestedSlotid: Number.isFinite(slotid) ? slotid : null,
    rentalLocation: String(payload.rentalLocation || msg.rentalLocation || '').trim(),
    rentalPlace: String(payload.rentalPlace || msg.rentalPlace || '').trim(),
    currency: String(payload.currency || '').trim(),
    symbol: String(payload.symbol || '').trim(),
    buyprice: Number(payload.buyprice || 0),
    initialCharge: Number(payload.initialCharge || 0)
};

msg.payload = {
    path: 'rentals/' + rawid,
    content: rentalDoc
};

return msg;
*/})}`;

const prepareVendRentalQueryFunc = `${MAP_SNIPPET}\n\n${block(function () { /*
function parseTopic(topic) {
    const parts = String(topic || '').split('/').filter(Boolean);
    return {
        stationid: normalizeStationId(parts[0] || ''),
        moduleid: String(parts[1] || '').trim()
    };
}

const payload = msg.payload || {};
const parsed = parseTopic(msg.topic);
const sn = Number(payload.batterySN || payload.sn || 0);
const stationid = normalizeStationId(msg.stationid || payload.stationid || parsed.stationid || '');
const moduleid = String(msg.moduleid || payload.moduleid || payload.moduleId || parsed.moduleid || '').trim();

if (!sn) {
    node.warn('Vend confirmation missing battery SN');
    return null;
}

if (Number(payload.exitStatus) !== 1) {
    msg.payload = {
        ok: false,
        error: 'POPUP_EXIT_FAILED',
        sn,
        exitStatus: payload.exitStatus
    };
    return [msg, null];
}

msg._vendRentalContext = {
    sn,
    stationid,
    moduleid,
    solenoidStatus: payload.solenoidStatus,
    exitStatus: payload.exitStatus
};

msg.payload = {
    path: 'rentals',
    query: [{ fieldPath: 'sn', opStr: '==', value: sn }]
};

return [null, msg];
*/})}`;

const buildVendRentalWritesFunc = block(function () { /*
const docs = Array.isArray(msg.payload) ? msg.payload : [];
const ctx = msg._vendRentalContext;

if (!ctx) {
    node.error('Missing msg._vendRentalContext', msg);
    return null;
}

const nowIso = new Date().toISOString();
let promoted = null;

docs.forEach((doc) => {
    if (Number(doc?.sn) !== ctx.sn || String(doc?.status || '') !== 'pending') {
        return;
    }

    if (!promoted || Date.parse(String(doc.rentalTime || '')) > Date.parse(String(promoted.rentalTime || ''))) {
        promoted = doc;
    }
});

const writes = [];
let promotedId = null;

if (promoted) {
    promotedId = String(promoted.rawid || promoted.rentalId || promoted.orderid || '').trim();
    if (promotedId) {
        writes.push({
            path: 'rentals/' + promotedId,
            content: {
                ...promoted,
                rawid: promoted.rawid || promotedId,
                status: 'rented',
                popupConfirmedAt: nowIso,
                rentedAt: promoted.rentedAt || nowIso,
                vendTime: promoted.vendTime || nowIso,
                vendStationid: promoted.vendStationid || ctx.stationid,
                vendModuleid: promoted.vendModuleid || ctx.moduleid,
                rentalStationid: promoted.rentalStationid || ctx.stationid,
                rentalModuleid: promoted.rentalModuleid || ctx.moduleid,
                exitStatus: 1,
                solenoidStatus: ctx.solenoidStatus
            }
        });
    }
}

docs.forEach((doc) => {
    const rawid = String(doc?.rawid || doc?.rentalId || doc?.orderid || '').trim();
    if (!rawid || rawid === promotedId || Number(doc?.sn) !== ctx.sn) {
        return;
    }

    if (String(doc.status || '') !== 'returned' && String(doc.status || '') !== 'refunded') {
        const returnDoc = {
            ...doc,
            rawid: doc.rawid || rawid,
            status: 'returned',
            returnTime: nowIso,
            returnStationid: ctx.stationid,
            returnModuleid: ctx.moduleid,
            returnType: doc.returnType || 'vend-reset'
        };

        if (doc.rentalTime) {
            returnDoc.rentalPeriod = Date.parse(nowIso) - Date.parse(doc.rentalTime);
        }

        writes.push({
            path: 'rentals/' + rawid,
            content: returnDoc
        });
    }
});

if (writes.length === 0) {
    msg.payload = {
        ok: true,
        sn: ctx.sn,
        stationid: ctx.stationid,
        moduleid: ctx.moduleid,
        updatedRental: promotedId
    };
    return [msg, null];
}

msg.payload = writes;
return [null, msg];
*/});

const prepareReturnRentalQueryFunc = `${MAP_SNIPPET}\n\n${block(function () { /*
const payload = msg.payload || {};
if (String(payload.action || '').toLowerCase() !== 'return') {
    return null;
}

const sn = Number(payload.chargerid || payload.sn || 0);
if (!sn) {
    node.warn('Return flow missing charger SN');
    return null;
}

const slot = Number(payload.slotid ?? payload.slot ?? payload.hole);
const millis = Number(payload.timeresponded || Date.now());

msg._returnRentalContext = {
    sn,
    stationid: normalizeStationId(payload.stationid || msg.stationid || ''),
    moduleid: String(payload.moduleid || payload.moduleId || msg.moduleid || '').trim(),
    slotid: Number.isFinite(slot) ? slot : null,
    returnTime: new Date(millis).toISOString()
};

msg.payload = {
    path: 'rentals',
    query: [{ fieldPath: 'sn', opStr: '==', value: sn }]
};

return msg;
*/})}`;

const buildReturnRentalWritesFunc = block(function () { /*
const docs = Array.isArray(msg.payload) ? msg.payload : [];
const ctx = msg._returnRentalContext;

if (!ctx) {
    node.error('Missing msg._returnRentalContext', msg);
    return null;
}

const writes = [];

docs.forEach((doc) => {
    const rawid = String(doc?.rawid || doc?.rentalId || doc?.orderid || '').trim();
    if (!rawid || Number(doc?.sn) !== ctx.sn || String(doc?.status || '') !== 'rented') {
        return;
    }

    const content = {
        ...doc,
        rawid: doc.rawid || rawid,
        status: 'returned',
        returnTime: ctx.returnTime,
        returnStationid: ctx.stationid,
        returnModuleid: ctx.moduleid,
        returnType: doc.returnType || 'kiosk'
    };

    if (ctx.slotid !== null) {
        content.returnSlotid = ctx.slotid;
    }

    if (doc.rentalTime) {
        content.rentalPeriod = Date.parse(ctx.returnTime) - Date.parse(doc.rentalTime);
    }

    writes.push({
        path: 'rentals/' + rawid,
        content
    });
});

if (writes.length === 0) {
    return null;
}

msg.payload = writes;
return msg;
*/});

patchNode('dafc8fd7b46a0b10', { func: statusCt3Func });
patchNode('efc4fdd0961f4dee', { func: statusLegacyFunc });
patchNode('06d5f7d1f8c13dd5', { func: statusPrepareFunc });

patchNode('80695f6e4db9c0c4', {
  name: 'Prepare Firebase Provision Query',
  func: prepareProvisionQueryFunc,
  outputs: 1,
  wires: [['fb-provision-query']],
});

addNode({
  id: 'fb-provision-query',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: 'a48dc9f87ec5ef72',
  name: 'Query kiosks for provision',
  ...FIREBASE_NODE,
  mode: 'query',
  x: 2300,
  y: 160,
  wires: [['fb-provision-build']],
});

addNode({
  id: 'fb-provision-build',
  type: 'function',
  z: '940482972d2ca412',
  g: 'a48dc9f87ec5ef72',
  name: 'Prepare Firebase Provision Write',
  func: prepareProvisionWriteFunc,
  outputs: 2,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 2550,
  y: 160,
  wires: [['5a54d5ab73315ef0'], ['fb-provision-set']],
});

addNode({
  id: 'fb-provision-set',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: 'a48dc9f87ec5ef72',
  name: 'Write provisioned kiosk',
  ...FIREBASE_NODE,
  mode: 'set',
  x: 2780,
  y: 160,
  wires: [['fb-provision-result']],
});

addNode({
  id: 'fb-provision-result',
  type: 'function',
  z: '940482972d2ca412',
  g: 'a48dc9f87ec5ef72',
  name: 'Finalize Provision Result',
  func: finalizeProvisionResultFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 3020,
  y: 160,
  wires: [['5a54d5ab73315ef0']],
});

patchNode('d3fec2c020b7cfe3', {
  name: 'Prepare Firebase Lock Query',
  func: prepareLockQueryFunc,
  outputs: 1,
  wires: [['fb-lock-query']],
});

addNode({
  id: 'fb-lock-query',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: 'c6a18cd86054de17',
  name: 'Query kiosk for lock update',
  ...FIREBASE_NODE,
  mode: 'query',
  x: 2270,
  y: 40,
  wires: [['fb-lock-build']],
});

addNode({
  id: 'fb-lock-build',
  type: 'function',
  z: '940482972d2ca412',
  g: 'c6a18cd86054de17',
  name: 'Apply Lock in Firebase',
  func: applyLockFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 2500,
  y: 40,
  wires: [['fb-lock-set']],
});

addNode({
  id: 'fb-lock-set',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: 'c6a18cd86054de17',
  name: 'Update lock in Firebase',
  ...FIREBASE_NODE,
  mode: 'update',
  x: 2730,
  y: 40,
  wires: [['fb-lock-result']],
});

addNode({
  id: 'fb-lock-result',
  type: 'function',
  z: '940482972d2ca412',
  g: 'c6a18cd86054de17',
  name: 'Restore lock command payload',
  func: finalizeLockFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 2960,
  y: 40,
  wires: [['d31b4e5f96982313']],
});

patchNode('28be4af10d2ac5d7', {
  name: 'Prepare Firebase vendslot Query',
  func: prepareVendslotQueryFunc,
  outputs: 1,
  wires: [['fb-vendslot-query']],
});

addNode({
  id: 'fb-vendslot-query',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: '4e344e6f8f4ba077',
  name: 'Query kiosk for vendslot',
  ...FIREBASE_NODE,
  mode: 'query',
  x: 1930,
  y: 1620,
  wires: [['fb-vendslot-build']],
});

addNode({
  id: 'fb-vendslot-build',
  type: 'function',
  z: '940482972d2ca412',
  g: '4e344e6f8f4ba077',
  name: 'Apply vendslot in Firebase',
  func: applyVendslotFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 2170,
  y: 1620,
  wires: [['fb-vendslot-set']],
});

addNode({
  id: 'fb-vendslot-set',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: '4e344e6f8f4ba077',
  name: 'Update vendslot in Firebase',
  ...FIREBASE_NODE,
  mode: 'update',
  x: 2410,
  y: 1620,
  wires: [[]],
});

patchNode('36941added09436e', {
  name: 'Prepare Pending Rental Write',
  func: preparePendingRentalWriteFunc,
  outputs: 1,
  wires: [['fb-rental-pending-set']],
});

addNode({
  id: 'fb-rental-pending-set',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: 'bca5daf366a00579',
  name: 'Upsert pending rental',
  ...FIREBASE_NODE,
  mode: 'set',
  x: 1710,
  y: 2040,
  wires: [[]],
});

patchNode('b8e79a133ceb3aff', {
  name: 'Prepare Vend Rental Query',
  func: prepareVendRentalQueryFunc,
  outputs: 2,
  wires: [['383672c96bf86735'], ['fb-vend-rentals-query']],
});

addNode({
  id: 'fb-vend-rentals-query',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: '4e344e6f8f4ba077',
  name: 'Query rentals for vend confirmation',
  ...FIREBASE_NODE,
  mode: 'query',
  x: 2080,
  y: 1540,
  wires: [['fb-vend-rentals-build']],
});

addNode({
  id: 'fb-vend-rentals-build',
  type: 'function',
  z: '940482972d2ca412',
  g: '4e344e6f8f4ba077',
  name: 'Prepare Vend Rental Writes',
  func: buildVendRentalWritesFunc,
  outputs: 2,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 2360,
  y: 1540,
  wires: [['383672c96bf86735'], ['fb-vend-rentals-split']],
});

addNode({
  id: 'fb-vend-rentals-split',
  type: 'split',
  z: '940482972d2ca412',
  g: '4e344e6f8f4ba077',
  name: 'One rental write per message',
  splt: '\\n',
  spltType: 'str',
  arraySplt: 1,
  arraySpltType: 'len',
  stream: false,
  addname: '',
  x: 2620,
  y: 1540,
  wires: [['fb-vend-rentals-set']],
});

addNode({
  id: 'fb-vend-rentals-set',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: '4e344e6f8f4ba077',
  name: 'Write vend rental updates',
  ...FIREBASE_NODE,
  mode: 'set',
  x: 2870,
  y: 1540,
  wires: [['383672c96bf86735']],
});

patchNode('c606d9f333eb1dc0', {
  name: 'Prepare Return Rental Query',
  func: prepareReturnRentalQueryFunc,
  outputs: 1,
  wires: [['fb-return-rentals-query']],
});

addNode({
  id: 'fb-return-rentals-query',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: '8d5a889538af327c',
  name: 'Query rentals for return',
  ...FIREBASE_NODE,
  mode: 'query',
  x: 2340,
  y: 1240,
  wires: [['fb-return-rentals-build']],
});

addNode({
  id: 'fb-return-rentals-build',
  type: 'function',
  z: '940482972d2ca412',
  g: '8d5a889538af327c',
  name: 'Prepare Return Rental Writes',
  func: buildReturnRentalWritesFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 2580,
  y: 1240,
  wires: [['fb-return-rentals-split']],
});

addNode({
  id: 'fb-return-rentals-split',
  type: 'split',
  z: '940482972d2ca412',
  g: '8d5a889538af327c',
  name: 'One returned rental per message',
  splt: '\\n',
  spltType: 'str',
  arraySplt: 1,
  arraySpltType: 'len',
  stream: false,
  addname: '',
  x: 2820,
  y: 1240,
  wires: [['fb-return-rentals-set']],
});

addNode({
  id: 'fb-return-rentals-set',
  type: 'google-cloud-firestore',
  z: '940482972d2ca412',
  g: '8d5a889538af327c',
  name: 'Write return rental updates',
  ...FIREBASE_NODE,
  mode: 'set',
  x: 3060,
  y: 1240,
  wires: [[]],
});

expandGroup('a48dc9f87ec5ef72', { w: 1700 });
expandGroup('c6a18cd86054de17', { w: 1500 });
expandGroup('4e344e6f8f4ba077', { w: 2300 });
expandGroup('8d5a889538af327c', { w: 2200 });

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(flow, null, 4) + '\n');
console.log(`Wrote ${OUTPUT_PATH}`);
