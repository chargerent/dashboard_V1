import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targets = [
  path.join(__dirname, 'parse-status-firebase-flow.json'),
  path.join(__dirname, 'flows-firebase-rewritten.json'),
];

const normalizeHelpers = `
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

function parseTopic(topic) {
    const parts = String(topic || '').split('/').filter(Boolean);
    return {
        stationid: normalizeStationId(parts[0] || ''),
        moduleid: String(parts[1] || '').trim()
    };
}

function moduleMatches(left, right) {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    return ('1000' + a) === b || a === b.replace(/^1000/, '');
}
`.trim();

const prepareKioskLookupFunc = `
${normalizeHelpers}

const parsed = parseTopic(msg.topic);
const stationid = normalizeStationId(msg.id || msg.stationid || parsed.stationid || '');
const moduleid = String(msg.module || msg.moduleid || parsed.moduleid || '').trim();

if (!stationid && !moduleid) {
    node.error('Status update is missing stationid/id and module', msg);
    return null;
}

msg._statusRawPayload = msg.payload;
msg._statusStationId = stationid;
msg._statusModuleId = moduleid;

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
`.trim();

const resolveKioskDocFunc = `
${normalizeHelpers}

const docs = Array.isArray(msg.payload) ? msg.payload : [];
const stationid = normalizeStationId(msg._statusStationId || '');
const moduleid = String(msg._statusModuleId || '').trim();

let matched = null;

if (stationid) {
    matched = docs.find((doc) => normalizeStationId(doc?.stationid || '') === stationid) || null;
}

if (!matched && moduleid) {
    matched = docs.find((doc) => {
        const modules = Array.isArray(doc?.modules) ? doc.modules : [];
        return modules.some((mod) => moduleMatches(mod?.id, moduleid));
    }) || null;
}

if (!matched) {
    node.error('No Firestore kiosk doc found for stationid ' + (stationid || '(none)') + ' module ' + (moduleid || '(none)'), msg);
    return null;
}

msg.kioskDoc = JSON.parse(JSON.stringify(matched));
msg.stationid = matched.stationid || stationid;
msg.payload = msg._statusRawPayload;

return msg;
`.trim();

const parseCommonHelpers = `
function toByteArray(value) {
    if (Buffer.isBuffer(value)) {
        return Array.from(value);
    }
    if (Array.isArray(value)) {
        return value.slice();
    }
    return null;
}

function moduleMatches(left, right) {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    return ('1000' + a) === b || a === b.replace(/^1000/, '');
}

function getChargerSN(bytes) {
    return (
        ((bytes[0] & 0xFF) << 24) |
        ((bytes[1] & 0xFF) << 16) |
        ((bytes[2] & 0xFF) << 8)  |
        (bytes[3] & 0xFF)
    ) >>> 0;
}

function getChargingCurrent(slot) {
    return Number(slot?.chargingCurrent ?? slot?.chargeCurrent ?? 0);
}
`.trim();

const ct3ParseFunc = `
${parseCommonHelpers}

const bytes = toByteArray(msg.payload);
if (!bytes) {
    node.error('Payload must be a Buffer or byte array', msg);
    return null;
}

const kioskDoc = msg.kioskDoc;
if (!kioskDoc) {
    node.error('Missing msg.kioskDoc for CT3 status parse', msg);
    return null;
}

const targetStation = JSON.parse(JSON.stringify(kioskDoc));
const targetModuleId = String(msg._statusModuleId || msg.module || '').trim();
if (!targetModuleId) {
    node.error('No module ID (msg.module) provided', msg);
    return null;
}

const modules = Array.isArray(targetStation.modules) ? targetStation.modules : [];
const moduleObj = modules.find((mod) => moduleMatches(mod?.id, targetModuleId));
if (!moduleObj) {
    node.error('Module ' + targetModuleId + ' not found in kiosk ' + (targetStation.stationid || '(unknown)'), msg);
    return null;
}

const timestamp = new Date().toISOString();
const data = bytes.slice(4);
const slotData = data.slice(6);
const segmentLength = 15;
const slotCount = Math.floor(slotData.length / segmentLength);
const existingSlots = Array.isArray(moduleObj.slots) ? moduleObj.slots : [];
const allSlots = [];

for (let i = 0; i < slotCount; i++) {
    const offset = i * segmentLength;
    const segment = slotData.slice(offset, offset + segmentLength);
    if (segment.length < segmentLength) {
        node.warn('CT3 slot ' + (i + 1) + ' is incomplete');
        continue;
    }

    const existing = existingSlots.find((slot) => Number(slot?.position) === Number(segment[0]));
    const chargingVoltage = segment[11];
    const chargingCurrent = segment[12];

    allSlots.push({
        position: segment[0],
        status: segment[1],
        dischargeCurrent: segment[2],
        cellVoltage: segment[3],
        areaCode: segment[4],
        sn: getChargerSN(segment.slice(5, 9)),
        batteryLevel: segment[9],
        temperature: segment[10],
        chargingVoltage,
        chargingCurrent,
        chargeVoltage: chargingVoltage,
        chargeCurrent: chargingCurrent,
        softwareVersion: segment[13],
        holeDetection: segment[14],
        lock: Boolean(existing?.lock),
        lockReason: existing?.lockReason || '',
        rented: false,
        cycle: Number(existing?.cycle || 0)
    });
}

moduleObj.slots = allSlots;
moduleObj.lastUpdated = timestamp;
moduleObj.total = 0;
moduleObj.full = 0;
moduleObj.empty = 0;
moduleObj.slot = 0;
moduleObj.charging = 0;
moduleObj.lock = 0;

allSlots.forEach((slot) => {
    if (slot.status === 1) {
        moduleObj.total++;
        if (slot.batteryLevel >= 80) moduleObj.full++;
        else moduleObj.empty++;
    } else if (slot.status === 0) {
        moduleObj.slot++;
    }
    if (getChargingCurrent(slot) > 0) {
        moduleObj.charging++;
    }
    if (slot.lock) {
        moduleObj.lock++;
    }
});

['total', 'full', 'empty', 'slot', 'charging'].forEach((prop) => {
    targetStation[prop] = modules.reduce((sum, mod) => sum + Number(mod?.[prop] || 0), 0);
});

msg._updatedStation = targetStation;
node.warn('CT3 Firebase-only status update for module ' + targetModuleId + ' | slots: ' + allSlots.length + ' | full: ' + moduleObj.full + ' | empty: ' + moduleObj.empty);
return msg;
`.trim();

const parseStatusFunc = `
${parseCommonHelpers}

const bytes = toByteArray(msg.payload);
if (!bytes) {
    node.error('Payload must be a Buffer or byte array', msg);
    return null;
}

const kioskDoc = msg.kioskDoc;
if (!kioskDoc) {
    node.error('Missing msg.kioskDoc for status parse', msg);
    return null;
}

const targetStation = JSON.parse(JSON.stringify(kioskDoc));
const targetModuleId = String(msg._statusModuleId || msg.module || '').trim();
if (!targetModuleId) {
    node.error('No module ID (msg.module) provided', msg);
    return null;
}

const modules = Array.isArray(targetStation.modules) ? targetStation.modules : [];
const moduleObj = modules.find((mod) => moduleMatches(mod?.id, targetModuleId));
if (!moduleObj) {
    node.error('Module ' + targetModuleId + ' not found in kiosk ' + (targetStation.stationid || '(unknown)'), msg);
    return null;
}

const timestamp = new Date().toISOString();
const data = bytes.slice(4);
const existingSlots = Array.isArray(moduleObj.slots) ? moduleObj.slots : [];
const allSlots = [];

for (let i = 0; i < 12; i++) {
    const moduleOffset = i * 66;
    const moduleBlock = data.slice(moduleOffset, moduleOffset + 66);
    if (moduleBlock.length < 66) {
        node.warn('Module block ' + (i + 1) + ' is incomplete');
        continue;
    }

    const chargersBytes = moduleBlock.slice(6);
    for (let j = 0; j < 4; j++) {
        const offset = j * 15;
        const segment = chargersBytes.slice(offset, offset + 15);
        if (segment.length < 15) {
            node.warn('Module block ' + (i + 1) + ' slot ' + (j + 1) + ' is incomplete');
            continue;
        }

        const existing = existingSlots.find((slot) => Number(slot?.position) === Number(segment[0]));
        const chargingVoltage = segment[11];
        const chargingCurrent = segment[12];

        allSlots.push({
            position: segment[0],
            status: segment[1],
            dischargeCurrent: segment[2],
            cellVoltage: segment[3],
            areaCode: segment[4],
            sn: getChargerSN(segment.slice(5, 9)),
            batteryLevel: segment[9],
            temperature: segment[10],
            chargingVoltage,
            chargingCurrent,
            chargeVoltage: chargingVoltage,
            chargeCurrent: chargingCurrent,
            softwareVersion: segment[13],
            holeDetection: segment[14],
            lock: Boolean(existing?.lock),
            lockReason: existing?.lockReason || '',
            rented: false,
            cycle: Number(existing?.cycle || 0)
        });
    }
}

moduleObj.slots = allSlots;
moduleObj.lastUpdated = timestamp;
moduleObj.total = 0;
moduleObj.full = 0;
moduleObj.empty = 0;
moduleObj.slot = 0;
moduleObj.charging = 0;
moduleObj.lock = 0;

allSlots.forEach((slot) => {
    if (slot.status === 1) {
        moduleObj.total++;
        if (slot.batteryLevel >= 80) moduleObj.full++;
        else moduleObj.empty++;
    } else if (slot.status === 0) {
        moduleObj.slot++;
    }
    if (getChargingCurrent(slot) > 0) {
        moduleObj.charging++;
    }
    if (slot.lock) {
        moduleObj.lock++;
    }
});

['total', 'full', 'empty', 'slot', 'charging'].forEach((prop) => {
    targetStation[prop] = modules.reduce((sum, mod) => sum + Number(mod?.[prop] || 0), 0);
});

msg._updatedStation = targetStation;
node.warn('Firebase-only status update for module ' + targetModuleId + ' | slots: ' + allSlots.length + ' | full: ' + moduleObj.full + ' | empty: ' + moduleObj.empty);
return msg;
`.trim();

const prepareFirebaseUpdateFunc = `
const station = msg._updatedStation;
const kioskDoc = msg.kioskDoc;

if (!station) {
    node.error('No _updatedStation on msg', msg);
    return null;
}

if (!kioskDoc?.provisionid) {
    node.error('No provisionid on msg.kioskDoc', msg);
    return null;
}

const modules = Array.isArray(station.modules) ? station.modules : [];
const configuredPower = Number(station.hardware?.power);
const fullThreshold = Number.isFinite(configuredPower) ? configuredPower : 80;

let count = 0;
let slotscount = 0;
let lockcount = 0;

modules.forEach((mod) => {
    const slots = Array.isArray(mod.slots) ? mod.slots : [];
    mod.lock = slots.reduce((sum, slot) => sum + (slot?.lock ? 1 : 0), 0);
    slotscount += slots.length;

    slots.forEach((slot) => {
        if (slot?.lock) {
            lockcount++;
        }

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

msg.payload = {
    path: 'kiosks/' + kioskDoc.provisionid,
    content: {
        modules,
        total: Number(station.total || 0),
        full: Number(station.full || 0),
        empty: Number(station.empty || 0),
        slot: Number(station.slot || 0),
        charging: Number(station.charging || 0),
        count,
        slotscount,
        lockcount,
        zerocount: Number(kioskDoc.zerocount || 0),
        chargers: count === 0 ? 'soldout' : count,
        lastUpdate: timestamp,
        timestamp
    }
};

return msg;
`.trim();

function updateFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const nodes = JSON.parse(raw);

  const groups = nodes.filter((node) => node.type === 'group' && node.name === 'parse status');
  if (groups.length === 0) {
    throw new Error(`No parse status group found in ${filePath}`);
  }

  groups.forEach((group) => {
    const inGroup = nodes.filter((node) => node.g === group.id);
    const byName = new Map(inGroup.map((node) => [node.name, node]));

    const linkIn = byName.get('link in 19');
    const statusSwitch = byName.get('chk status [16]');
    const lengthSwitch = inGroup.find((node) => node.type === 'switch' && node !== statusSwitch);
    const ct3Parser = byName.get('CT3 parse status');
    const parser = byName.get('parse status');
    const debug273 = byName.get('debug 273');
    const debug284 = byName.get('debug 284');
    const debug285 = byName.get('debug 285');
    const debug288 = byName.get('debug 288');
    const queryPrep = inGroup.find((node) => node.type === 'function' && node.name === 'Prepare Firebase Query');
    const queryNode = inGroup.find((node) => node.type === 'google-cloud-firestore' && node.name === 'Query kiosk doc');
    const resolveNode = inGroup.find((node) => node.type === 'function' && node.name === 'Prepare Firebase Update');
    const updateNode = inGroup.find((node) => node.type === 'google-cloud-firestore' && node.name === 'Update kiosk in Firebase');
    const debugWrite = inGroup.find((node) => node.type === 'debug' && node.name === 'Firebase write result');
    const legacyHq = byName.get('update hq');
    const linkOut = byName.get('link out 33');
    const hqDebug = byName.get('hq update');

    if (!linkIn || !statusSwitch || !lengthSwitch || !ct3Parser || !parser || !queryPrep || !queryNode || !resolveNode || !updateNode || !debugWrite || !legacyHq) {
      console.warn(`Skipping incomplete parse-status group ${group.id} in ${filePath}`);
      return;
    }

    queryPrep.name = 'Prepare Kiosk Lookup';
    queryPrep.func = prepareKioskLookupFunc;
    queryPrep.x = 1450;
    queryPrep.y = 960;
    queryPrep.wires = [[queryNode.id]];

    queryNode.x = 1635;
    queryNode.y = 960;
    queryNode.wires = [[resolveNode.id]];

    resolveNode.name = 'Resolve Kiosk Doc';
    resolveNode.func = resolveKioskDocFunc;
    resolveNode.x = 1825;
    resolveNode.y = 960;
    resolveNode.wires = [[lengthSwitch.id]];

    lengthSwitch.rules[0].vt = 'num';
    lengthSwitch.rules[0].v = '56';
    lengthSwitch.x = 2000;
    lengthSwitch.y = 960;
    lengthSwitch.wires = [
      [ct3Parser.id, debug285 ? debug285.id : undefined].filter(Boolean),
      [debug284 ? debug284.id : undefined, parser.id].filter(Boolean),
    ];

    ct3Parser.func = ct3ParseFunc;
    ct3Parser.x = 2190;
    ct3Parser.y = 920;
    ct3Parser.wires = [[legacyHq.id]];

    parser.func = parseStatusFunc;
    parser.x = 2190;
    parser.y = 1000;
    parser.wires = [[legacyHq.id, debug288 ? debug288.id : undefined].filter(Boolean)];

    legacyHq.name = 'Prepare Firebase Update';
    legacyHq.type = 'function';
    legacyHq.func = prepareFirebaseUpdateFunc;
    delete legacyHq.rules;
    delete legacyHq.action;
    delete legacyHq.property;
    delete legacyHq.from;
    delete legacyHq.to;
    delete legacyHq.reg;
    legacyHq.outputs = 1;
    legacyHq.noerr = 0;
    legacyHq.initialize = '';
    legacyHq.finalize = '';
    legacyHq.libs = [];
    legacyHq.x = 2410;
    legacyHq.y = 960;
    legacyHq.wires = [[updateNode.id]];

    updateNode.x = 2610;
    updateNode.y = 960;
    updateNode.wires = [[debugWrite.id]];

    debugWrite.x = 2590;
    debugWrite.y = 920;

    statusSwitch.x = 1260;
    statusSwitch.y = 960;
    statusSwitch.wires = [[queryPrep.id]];

    if (linkIn) {
      linkIn.x = 1090;
      linkIn.y = 960;
      linkIn.wires = [[statusSwitch.id, debug273 ? debug273.id : undefined].filter(Boolean)];
    }

    if (debug273) {
      debug273.x = 1170;
      debug273.y = 920;
    }
    if (debug285) {
      debug285.x = 2100;
      debug285.y = 900;
    }
    if (debug284) {
      debug284.x = 2100;
      debug284.y = 1040;
    }
    if (debug288) {
      debug288.x = 2380;
      debug288.y = 1035;
    }

    if (linkOut) {
      linkOut.wires = [];
      linkOut.x = 2810;
      linkOut.y = 960;
    }
    if (hqDebug) {
      hqDebug.x = 2800;
      hqDebug.y = 920;
      hqDebug.wires = [];
    }

    group.x = 1030;
    group.y = 860;
    group.w = 1860;
    group.h = 220;
  });

  fs.writeFileSync(filePath, JSON.stringify(nodes, null, 4) + '\n');
  console.log(`Updated ${filePath}`);
}

targets.forEach(updateFile);
