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

function inferTowerType(slotCount) {
    const normalizedCount = Number(slotCount || 0);
    if (normalizedCount === 3) return 'CT3';
    if (normalizedCount === 4) return 'CT4';
    if (normalizedCount === 8) return 'CT8';
    if (normalizedCount === 12) return 'CT12';
    if (normalizedCount === 48) return 'CK48';
    return '';
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
const data = bytes.slice(4, -1);
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

const inferredType = inferTowerType(slotCount);
if (inferredType) {
    targetStation.hardware = targetStation.hardware && typeof targetStation.hardware === 'object'
        ? targetStation.hardware
        : {};
    if (!targetStation.hardware.type) {
        targetStation.hardware.type = inferredType;
    }
}

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

function inferHoleCount(bytes, data) {
    const payloadSize = bytes.length - 5;
    if (payloadSize === 192 && data[1] === 255 && data[2] === 255) {
        return data[66] === 5 ? 8 : 4;
    }

    const candidates = [2, 5, 6, 8, 4, 3, 1];
    for (const holeCount of candidates) {
        const blockSize = 6 + (15 * holeCount);
        if (payloadSize > 0 && payloadSize % blockSize === 0) {
            return holeCount;
        }
    }

    return 0;
}

function parsePinboards(bytes) {
    const data = bytes.slice(4, -1);
    const pinboards = [];

    if (data.length < 6) {
        return pinboards;
    }

    const useHeaderHoleCount = data[1] !== 0 && data[1] !== 255 && data[2] !== 11;

    if (useHeaderHoleCount) {
        for (let offset = 0; offset + 6 <= data.length;) {
            const header = data.slice(offset, offset + 6);
            const holeCount = Number(header[1] || 0);
            const blockSize = 6 + (holeCount * 15);

            if (holeCount <= 0) {
                node.warn('Pinboard at offset ' + offset + ' reported invalid hole count');
                break;
            }

            if (offset + blockSize > data.length) {
                node.warn('Pinboard at offset ' + offset + ' is incomplete');
                break;
            }

            const slots = [];
            for (let index = 0; index < holeCount; index++) {
                const segmentOffset = offset + 6 + (index * 15);
                const segment = data.slice(segmentOffset, segmentOffset + 15);
                if (segment.length < 15) {
                    node.warn('Pinboard ' + header[0] + ' slot ' + (index + 1) + ' is incomplete');
                    continue;
                }
                slots.push({
                    segment,
                    relativePosition: index + 1
                });
            }

            pinboards.push({
                index: Number(header[0] || (pinboards.length + 1)),
                holeCount,
                temperature: Number(header[3] || 0),
                softwareVersion: Number(header[4] || 0),
                hardwareVersion: Number(header[5] || 0),
                header,
                slots
            });

            offset += blockSize;
        }

        return pinboards;
    }

    const holeCount = inferHoleCount(bytes, data);
    if (holeCount <= 0) {
        return pinboards;
    }

    const blockSize = 6 + (holeCount * 15);
    for (let offset = 0; offset + blockSize <= data.length; offset += blockSize) {
        const header = data.slice(offset, offset + 6);
        const slots = [];

        for (let index = 0; index < holeCount; index++) {
            const segmentOffset = offset + 6 + (index * 15);
            const segment = data.slice(segmentOffset, segmentOffset + 15);
            if (segment.length < 15) {
                node.warn('Pinboard ' + header[0] + ' slot ' + (index + 1) + ' is incomplete');
                continue;
            }
            slots.push({
                segment,
                relativePosition: index + 1
            });
        }

        pinboards.push({
            index: Number(header[0] || (pinboards.length + 1)),
            holeCount,
            temperature: Number(header[3] || 0),
            softwareVersion: Number(header[4] || 0),
            hardwareVersion: Number(header[5] || 0),
            header,
            slots
        });
    }

    return pinboards;
}

function orderModulesForPinboards(modules) {
    return modules
        .slice()
        .map((module, fallbackIndex) => {
            const id = String(module?.id || '');
            const match = id.match(/m(\\d+)$/i);
            return {
                module,
                fallbackIndex,
                order: match ? Number(match[1]) : (fallbackIndex + 1)
            };
        })
        .sort((left, right) => left.order - right.order || left.fallbackIndex - right.fallbackIndex)
        .map((entry) => entry.module);
}

function shouldUseRelativePositions(module, holeCount, splitModules) {
    if (!splitModules) {
        return false;
    }

    const slots = Array.isArray(module?.slots) ? module.slots : [];
    if (slots.length === 0) {
        return true;
    }

    const positions = slots
        .map((slot) => Number(slot?.position || 0))
        .filter((value) => value > 0);

    if (positions.length === 0) {
        return true;
    }

    return Math.max(...positions) <= holeCount;
}

function buildSlot(segment, existing, relativePosition, useRelativePositions) {
    const absolutePosition = Number(segment[0] || 0);
    const chargingVoltage = segment[11];
    const chargingCurrent = segment[12];

    return {
        position: useRelativePositions ? relativePosition : absolutePosition,
        absolutePosition,
        status: segment[1],
        dischargeCurrent: segment[2],
        cellVoltage: segment[3],
        areaCode: segment[4],
        sn: getChargerSN(segment.slice(5, 9)),
        batteryLevel: segment[9],
        temperature: segment[10],
        chargingVoltage,
        chargingCurrent,
        softwareVersion: segment[13],
        holeDetection: segment[14],
        lock: Boolean(existing?.lock),
        lockReason: existing?.lockReason || '',
        rented: false,
        cycle: Number(existing?.cycle || 0)
    };
}

function applyModuleStatus(module, slots, timestamp) {
    module.slots = slots;
    module.lastUpdated = timestamp;
    module.total = 0;
    module.full = 0;
    module.empty = 0;
    module.slot = 0;
    module.charging = 0;
    module.lock = 0;

    slots.forEach((slot) => {
        if (slot.status === 1) {
            module.total++;
            if (slot.batteryLevel >= 80) module.full++;
            else module.empty++;
        } else if (slot.status === 0) {
            module.slot++;
        }

        if (getChargingCurrent(slot) > 0) {
            module.charging++;
        }

        if (slot.lock) {
            module.lock++;
        }
    });
}

function applyModuleHeader(module, pinboard) {
    const nextTemperature = Number(pinboard?.temperature);
    if (Number.isFinite(nextTemperature)) {
        module.temperature = nextTemperature;
    }

    const nextSoftwareVersion = Number(pinboard?.softwareVersion);
    if (
        Number.isFinite(nextSoftwareVersion) &&
        nextSoftwareVersion > 0 &&
        nextSoftwareVersion !== Number(module?.softwareVersion || 0)
    ) {
        module.softwareVersion = nextSoftwareVersion;
    }

    const nextHardwareVersion = Number(pinboard?.hardwareVersion);
    if (
        Number.isFinite(nextHardwareVersion) &&
        nextHardwareVersion > 0 &&
        nextHardwareVersion !== Number(module?.hardwareVersion || 0)
    ) {
        module.hardwareVersion = nextHardwareVersion;
    }
}

function recalculateStationTotals(targetStation, modules) {
    ['total', 'full', 'empty', 'slot', 'charging'].forEach((prop) => {
        targetStation[prop] = modules.reduce((sum, mod) => sum + Number(mod?.[prop] || 0), 0);
    });
}

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
const pinboards = parsePinboards(bytes);
if (pinboards.length === 0) {
    node.error('Unable to parse pinboard data from status payload', msg);
    return null;
}

const totalSlots = pinboards.reduce((sum, pinboard) => sum + pinboard.slots.length, 0);
const inferredType = inferTowerType(totalSlots);
targetStation.hardware = targetStation.hardware && typeof targetStation.hardware === 'object'
    ? targetStation.hardware
    : {};
if (inferredType && !targetStation.hardware.type) {
    targetStation.hardware.type = inferredType;
}

const activeModules = modules.filter((module) => !String(module?.id || '').startsWith('disabled'));
const orderedModules = orderModulesForPinboards(activeModules);
const splitModules = pinboards.length > 1 &&
    orderedModules.length === pinboards.length &&
    (inferredType === 'CT4' || inferredType === 'CT8' || inferredType === 'CT12');

if (splitModules) {
    pinboards.forEach((pinboard, moduleIndex) => {
        const currentModule = orderedModules[moduleIndex];
        const existingSlots = Array.isArray(currentModule?.slots) ? currentModule.slots : [];
        const useRelativePositions = shouldUseRelativePositions(currentModule, pinboard.holeCount, splitModules);
        const parsedSlots = pinboard.slots.map(({ segment, relativePosition }) => {
            const position = useRelativePositions ? relativePosition : Number(segment[0] || 0);
            const existing = existingSlots.find((slot) => Number(slot?.position) === position);
            return buildSlot(segment, existing, relativePosition, useRelativePositions);
        });
        applyModuleHeader(currentModule, pinboard);
        applyModuleStatus(currentModule, parsedSlots, timestamp);
    });
} else {
    const existingSlots = Array.isArray(moduleObj.slots) ? moduleObj.slots : [];
    const parsedSlots = [];

    pinboards.forEach((pinboard) => {
        pinboard.slots.forEach(({ segment, relativePosition }) => {
            const existing = existingSlots.find((slot) => Number(slot?.position) === Number(segment[0] || 0));
            parsedSlots.push(buildSlot(segment, existing, relativePosition, false));
        });
    });

    if (pinboards[0]) {
        applyModuleHeader(moduleObj, pinboards[0]);
    }
    applyModuleStatus(moduleObj, parsedSlots, timestamp);
}

recalculateStationTotals(targetStation, activeModules.length > 0 ? activeModules : modules);

let updatedSlotCount = 0;
if (splitModules) {
    orderedModules.forEach((currentModule) => {
        updatedSlotCount += Array.isArray(currentModule?.slots) ? currentModule.slots.length : 0;
    });
} else {
    updatedSlotCount = Array.isArray(moduleObj?.slots) ? moduleObj.slots.length : 0;
}

msg._updatedStation = targetStation;

if (!kioskDoc?.provisionid) {
    node.error('No provisionid on msg.kioskDoc', msg);
    return null;
}

const configuredPower = Number(targetStation.hardware?.power);
const fullThreshold = Number.isFinite(configuredPower) ? configuredPower : 80;
const chargerCapacityMah = 8000;
const currentUnitToMilliamps = 100;

let count = 0;
let slotscount = 0;
let lockcount = 0;

modules.forEach((mod) => {
    const slots = Array.isArray(mod?.slots) ? mod.slots : [];
    mod.lock = slots.reduce((sum, slot) => sum + (slot?.lock ? 1 : 0), 0);
    slotscount += slots.length;

    const chargingSlots = slots.filter((slot) => (
        slot &&
        slot.status === 1 &&
        slot.sn &&
        slot.sn !== 0 &&
        Number(slot.chargingCurrent ?? slot.chargeCurrent ?? 0) > 0
    ));
    const rawChargingCurrentTotal = chargingSlots.reduce(
        (sum, slot) => sum + Number(slot.chargingCurrent ?? slot.chargeCurrent ?? 0),
        0
    );
    const avgChargingCurrent = chargingSlots.length > 0 ?
        rawChargingCurrentTotal / chargingSlots.length :
        0;
    const avgChargingCurrentmA = avgChargingCurrent * currentUnitToMilliamps;
    const estimatedPctPerMinute = avgChargingCurrentmA > 0 ?
        avgChargingCurrentmA / (chargerCapacityMah * 0.6) :
        null;

    mod.chargeMetrics = {
        method: 'current_estimate',
        batteryCapacityMah: chargerCapacityMah,
        currentUnitToMilliamps,
        chargingSlots: chargingSlots.length,
        avgChargingCurrent: Number(avgChargingCurrent.toFixed(2)),
        avgChargingCurrentmA: Number(avgChargingCurrentmA.toFixed(0)),
        estimatedPctPerMinute: estimatedPctPerMinute === null ?
            null :
            Number(estimatedPctPerMinute.toFixed(3)),
        updatedAt: timestamp
    };

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

msg.payload = {
    path: 'kiosks/' + kioskDoc.provisionid,
    content: {
        modules,
        hardware: targetStation.hardware || kioskDoc.hardware || {},
        total: Number(targetStation.total || 0),
        full: Number(targetStation.full || 0),
        empty: Number(targetStation.empty || 0),
        slot: Number(targetStation.slot || 0),
        charging: Number(targetStation.charging || 0),
        count,
        slotscount,
        lockcount,
        zerocount: Number(kioskDoc.zerocount || 0),
        chargers: count === 0 ? 'soldout' : count,
        lastUpdate: timestamp,
        timestamp
    }
};

node.warn(
    'Firebase-only status update for station ' +
    (targetStation.stationid || '(unknown)') +
    ' | source module ' +
    targetModuleId +
    ' | pinboards: ' +
    pinboards.length +
    ' | slots: ' +
    updatedSlotCount +
    ' | type: ' +
    (inferredType || 'unknown') +
    ' | available: ' +
    count
);
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
const chargerCapacityMah = 8000;
const currentUnitToMilliamps = 100;
const timestamp = new Date().toISOString();

let count = 0;
let slotscount = 0;
let lockcount = 0;

modules.forEach((mod) => {
    const slots = Array.isArray(mod.slots) ? mod.slots : [];
    mod.lock = slots.reduce((sum, slot) => sum + (slot?.lock ? 1 : 0), 0);
    slotscount += slots.length;

    const chargingSlots = slots.filter((slot) => (
        slot &&
        slot.status === 1 &&
        slot.sn &&
        slot.sn !== 0 &&
        Number(slot.chargingCurrent ?? slot.chargeCurrent ?? 0) > 0
    ));
    const rawChargingCurrentTotal = chargingSlots.reduce(
        (sum, slot) => sum + Number(slot.chargingCurrent ?? slot.chargeCurrent ?? 0),
        0
    );
    const avgChargingCurrent = chargingSlots.length > 0 ?
        rawChargingCurrentTotal / chargingSlots.length :
        0;
    const avgChargingCurrentmA = avgChargingCurrent * currentUnitToMilliamps;
    const estimatedPctPerMinute = avgChargingCurrentmA > 0 ?
        avgChargingCurrentmA / (chargerCapacityMah * 0.6) :
        null;

    mod.chargeMetrics = {
        method: 'current_estimate',
        batteryCapacityMah: chargerCapacityMah,
        currentUnitToMilliamps,
        chargingSlots: chargingSlots.length,
        avgChargingCurrent: Number(avgChargingCurrent.toFixed(2)),
        avgChargingCurrentmA: Number(avgChargingCurrentmA.toFixed(0)),
        estimatedPctPerMinute: estimatedPctPerMinute === null ?
            null :
            Number(estimatedPctPerMinute.toFixed(3)),
        updatedAt: timestamp
    };

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

msg.payload = {
    path: 'kiosks/' + kioskDoc.provisionid,
    content: {
        modules,
        hardware: station.hardware || kioskDoc.hardware || {},
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
  const removeNodeIds = new Set();

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
    const queryPrep = inGroup.find((node) => (
      node.type === 'function' &&
      (node.name === 'Prepare Firebase Query' || node.name === 'Prepare Kiosk Lookup')
    ));
    const queryNode = inGroup.find((node) => node.type === 'google-cloud-firestore' && node.name === 'Query kiosk doc');
    const resolveNode = inGroup.find((node) => (
      node.type === 'function' &&
      (node.name === 'Resolve Kiosk Doc' || node.name === 'Prepare Firebase Update')
    ));
    const updateNode = inGroup.find((node) => node.type === 'google-cloud-firestore' && node.name === 'Update kiosk in Firebase');
    const debugWrite = inGroup.find((node) => node.type === 'debug' && node.name === 'Firebase write result');
    const legacyHq = inGroup.find((node) => (
      (node.type === 'change' && node.name === 'update hq') ||
      (node.type === 'function' && node.name === 'Prepare Firebase Update')
    ));
    const linkOut = byName.get('link out 33');
    const hqDebug = byName.get('hq update');

    if (!linkIn || !statusSwitch || !parser || !queryPrep || !queryNode || !resolveNode || !updateNode || !debugWrite) {
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
    resolveNode.wires = [[parser.id]];

    parser.func = parseStatusFunc;
    parser.x = 2190;
    parser.y = 960;
    parser.wires = [[updateNode.id, debug288 ? debug288.id : undefined].filter(Boolean)];

    updateNode.x = 2410;
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
    if (debug288) {
      debug288.x = 2330;
      debug288.y = 900;
    }

    [
      lengthSwitch,
      ct3Parser,
      legacyHq,
      debug284,
      debug285,
      linkOut,
      hqDebug,
    ].filter(Boolean).forEach((node) => {
      removeNodeIds.add(node.id);
    });

    if (Array.isArray(group.nodes)) {
      group.nodes = group.nodes.filter((id) => !removeNodeIds.has(id));
    }

    group.x = 1030;
    group.y = 860;
    group.w = 1700;
    group.h = 180;
  });

  const filteredNodes = nodes.filter((node) => !removeNodeIds.has(node.id));
  fs.writeFileSync(filePath, JSON.stringify(filteredNodes, null, 4) + '\n');
  console.log(`Updated ${filePath}`);
}

targets.forEach(updateFile);
