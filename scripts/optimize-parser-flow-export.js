import fs from 'fs';
import path from 'path';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(process.cwd(), 'scripts', 'flows-10-optimized.json');

if (!inputPath) {
  console.error('Usage: node scripts/optimize-parser-flow-export.js <input-json> [output-json]');
  process.exit(1);
}

const prepareLookupFunc = `
function normalizeStationId(value) {
    return String(value || '').trim();
}

function parseTopic(topic) {
    const parts = String(topic || '').split('/').filter(Boolean);
    return {
        stationid: normalizeStationId(parts[0] || ''),
        moduleid: String(parts[1] || '').trim()
    };
}

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

const resolveLookupFunc = `
function normalizeStationId(value) {
    return String(value || '').trim();
}

function moduleMatches(left, right) {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    return ('1000' + a) === b || a === b.replace(/^1000/, '');
}

const docs = Array.isArray(msg.payload) ? msg.payload : [];
const stationid = normalizeStationId(msg._statusStationId || '');
const moduleid = String(msg._statusModuleId || '').trim();

let matched = stationid
    ? docs.find((doc) => normalizeStationId(doc?.stationid || '') === stationid) || null
    : null;

if (!matched && moduleid) {
    matched = docs.find((doc) => {
        const modules = Array.isArray(doc?.modules) ? doc.modules : [];
        return modules.some((mod) => moduleMatches(mod?.id, moduleid));
    }) || null;
}

if (!matched) {
    node.error(
        'No Firestore kiosk doc found for stationid ' +
        (stationid || '(none)') +
        ' module ' +
        (moduleid || '(none)'),
        msg
    );
    return null;
}

msg.kioskDoc = JSON.parse(JSON.stringify(matched));
msg.stationid = matched.stationid || stationid;
msg.payload = msg._statusRawPayload;

return msg;
`.trim();

const parseStatusFunc = `
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
        ((bytes[2] & 0xFF) << 8) |
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
    const fallbackHoleCount = useHeaderHoleCount ? 0 : inferHoleCount(bytes, data);

    for (let offset = 0; offset + 6 <= data.length;) {
        const header = data.slice(offset, offset + 6);
        const holeCount = useHeaderHoleCount ? Number(header[1] || 0) : fallbackHoleCount;

        if (holeCount <= 0) {
            if (useHeaderHoleCount) {
                node.warn('Pinboard at offset ' + offset + ' reported invalid hole count');
            }
            break;
        }

        const blockSize = 6 + (holeCount * 15);
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
            slots
        });

        offset += blockSize;
        if (!useHeaderHoleCount && fallbackHoleCount <= 0) {
            break;
        }
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

    let maxPosition = 0;
    for (const slot of slots) {
        const position = Number(slot?.position || 0);
        if (position > maxPosition) {
            maxPosition = position;
        }
    }

    return maxPosition === 0 || maxPosition <= holeCount;
}

function buildSlotLookup(slots, useAbsolutePosition) {
    const lookup = new Map();
    slots.forEach((slot) => {
        const key = useAbsolutePosition
            ? Number(slot?.absolutePosition ?? slot?.position ?? 0)
            : Number(slot?.position ?? 0);
        if (key > 0) {
            lookup.set(key, slot);
        }
    });
    return lookup;
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
    let total = 0;
    let full = 0;
    let empty = 0;
    let slotCount = 0;
    let charging = 0;
    let lock = 0;

    slots.forEach((slot) => {
        if (slot.status === 1) {
            total++;
            if (slot.batteryLevel >= 80) {
                full++;
            } else {
                empty++;
            }
        } else if (slot.status === 0) {
            slotCount++;
        }

        if (getChargingCurrent(slot) > 0) {
            charging++;
        }

        if (slot.lock) {
            lock++;
        }
    });

    module.slots = slots;
    module.lastUpdated = timestamp;
    module.total = total;
    module.full = full;
    module.empty = empty;
    module.slot = slotCount;
    module.charging = charging;
    module.lock = lock;
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
    let total = 0;
    let full = 0;
    let empty = 0;
    let slot = 0;
    let charging = 0;

    modules.forEach((mod) => {
        total += Number(mod?.total || 0);
        full += Number(mod?.full || 0);
        empty += Number(mod?.empty || 0);
        slot += Number(mod?.slot || 0);
        charging += Number(mod?.charging || 0);
    });

    targetStation.total = total;
    targetStation.full = full;
    targetStation.empty = empty;
    targetStation.slot = slot;
    targetStation.charging = charging;
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
const stationModules = activeModules.length > 0 ? activeModules : modules;
const orderedModules = orderModulesForPinboards(stationModules);
const splitModules = pinboards.length > 1 &&
    orderedModules.length === pinboards.length &&
    (inferredType === 'CT4' || inferredType === 'CT8' || inferredType === 'CT12');

if (splitModules) {
    pinboards.forEach((pinboard, moduleIndex) => {
        const currentModule = orderedModules[moduleIndex];
        const existingSlots = Array.isArray(currentModule?.slots) ? currentModule.slots : [];
        const useRelativePositions = shouldUseRelativePositions(currentModule, pinboard.holeCount, splitModules);
        const existingSlotLookup = buildSlotLookup(existingSlots, !useRelativePositions);
        const parsedSlots = pinboard.slots.map(({ segment, relativePosition }) => {
            const lookupKey = useRelativePositions ? relativePosition : Number(segment[0] || 0);
            return buildSlot(
                segment,
                existingSlotLookup.get(lookupKey),
                relativePosition,
                useRelativePositions
            );
        });
        applyModuleHeader(currentModule, pinboard);
        applyModuleStatus(currentModule, parsedSlots, timestamp);
    });
} else {
    const existingSlots = Array.isArray(moduleObj.slots) ? moduleObj.slots : [];
    const existingSlotLookup = buildSlotLookup(existingSlots, false);
    const parsedSlots = [];

    pinboards.forEach((pinboard) => {
        pinboard.slots.forEach(({ segment, relativePosition }) => {
            const absolutePosition = Number(segment[0] || 0);
            parsedSlots.push(
                buildSlot(
                    segment,
                    existingSlotLookup.get(absolutePosition),
                    relativePosition,
                    false
                )
            );
        });
    });

    if (pinboards[0]) {
        applyModuleHeader(moduleObj, pinboards[0]);
    }
    applyModuleStatus(moduleObj, parsedSlots, timestamp);
}

recalculateStationTotals(targetStation, stationModules);

const updatedSlotCount = splitModules
    ? orderedModules.reduce((sum, currentModule) => sum + (Array.isArray(currentModule?.slots) ? currentModule.slots.length : 0), 0)
    : (Array.isArray(moduleObj?.slots) ? moduleObj.slots.length : 0);

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
    let moduleLockCount = 0;
    let chargingSlots = 0;
    let rawChargingCurrentTotal = 0;

    slotscount += slots.length;

    slots.forEach((slot) => {
        const chargingCurrent = Number(slot?.chargingCurrent ?? slot?.chargeCurrent ?? 0);

        if (slot?.lock) {
            moduleLockCount++;
            lockcount++;
        }

        if (
            slot &&
            slot.status === 1 &&
            slot.sn &&
            slot.sn !== 0
        ) {
            if (chargingCurrent > 0) {
                chargingSlots++;
                rawChargingCurrentTotal += chargingCurrent;
            }

            if (
                typeof slot.batteryLevel === 'number' &&
                slot.batteryLevel >= fullThreshold &&
                !slot.lock
            ) {
                count++;
            }
        }
    });

    mod.lock = moduleLockCount;

    const avgChargingCurrent = chargingSlots > 0
        ? rawChargingCurrentTotal / chargingSlots
        : 0;
    const avgChargingCurrentmA = avgChargingCurrent * currentUnitToMilliamps;
    const estimatedPctPerMinute = avgChargingCurrentmA > 0
        ? avgChargingCurrentmA / (chargerCapacityMah * 0.6)
        : null;

    mod.chargeMetrics = {
        method: 'current_estimate',
        batteryCapacityMah: chargerCapacityMah,
        currentUnitToMilliamps,
        chargingSlots,
        avgChargingCurrent: Number(avgChargingCurrent.toFixed(2)),
        avgChargingCurrentmA: Number(avgChargingCurrentmA.toFixed(0)),
        estimatedPctPerMinute: estimatedPctPerMinute === null
            ? null
            : Number(estimatedPctPerMinute.toFixed(3)),
        updatedAt: timestamp
    };
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

const flow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

flow.forEach((node) => {
  if (node.type === 'group' && node.name === 'parse status firebase only') {
    node.name = 'parse status firebase only (optimized)';
  }
  if (node.type === 'function' && node.name === 'Prepare Kiosk Lookup') {
    node.func = prepareLookupFunc;
  }
  if (node.type === 'function' && node.name === 'Resolve Kiosk Doc') {
    node.func = resolveLookupFunc;
  }
  if (node.type === 'function' && node.name === 'parse status') {
    node.func = parseStatusFunc;
  }
});

fs.writeFileSync(outputPath, JSON.stringify(flow, null, 4) + '\n');
console.log(`Wrote ${outputPath}`);
