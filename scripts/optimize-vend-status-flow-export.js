import fs from 'fs';
import path from 'path';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(process.cwd(), 'scripts', 'flows-11-cache-first.json');

if (!inputPath) {
  console.error('Usage: node scripts/optimize-vend-status-flow-export.js <input-json> [output-json]');
  process.exit(1);
}

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

const requestedStaleAfterMs = Number(originalPayload.staleafterms || msg.staleafterms || 25000);
msg._statusRequest = originalPayload;
msg._statusStationId = stationid;
msg._statusStaleAfterMs = Number.isFinite(requestedStaleAfterMs) && requestedStaleAfterMs > 0
    ? requestedStaleAfterMs
    : 25000;

msg.payload = {
    path: 'kiosks',
    query: [{ fieldPath: 'stationid', opStr: '==', value: stationid }]
};

return msg;
`.trim();

const resolveKioskFunc = `
${normalizeHelpers}

const docs = Array.isArray(msg.payload) ? msg.payload : [];
const stationid = normalizeStationId(msg._statusStationId || '');
const matched = docs.find((doc) => normalizeStationId(doc?.stationid || '') === stationid) || null;

msg.kioskDoc = matched ? JSON.parse(JSON.stringify(matched)) : null;
msg.stationid = (matched && matched.stationid) || stationid;
msg.payload = msg._statusRequest || {};

return msg;
`.trim();

const freshnessGateFunc = `
const station = msg.kioskDoc;
const staleAfterMs = Number(msg._statusStaleAfterMs || 25000);

msg._statusStaleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0
    ? staleAfterMs
    : 25000;
msg._statusWasStale = false;

if (!station) {
    return [msg, null];
}

const allModules = Array.isArray(station.modules) ? station.modules : [];
const activeModules = allModules.filter((mod) => !String(mod?.id || '').startsWith('disabled'));
const modules = activeModules.length > 0 ? activeModules : allModules;

if (modules.length === 0) {
    return [msg, null];
}

const now = Date.now();
let staleCount = 0;
let newestModuleAgeMs = null;
const staleModuleIds = [];

modules.forEach((mod) => {
    const moduleTime = new Date(mod?.lastUpdated).getTime();
    const ageMs = Number.isFinite(moduleTime) ? (now - moduleTime) : Number.POSITIVE_INFINITY;

    if (newestModuleAgeMs === null || ageMs < newestModuleAgeMs) {
        newestModuleAgeMs = ageMs;
    }

    if (!Number.isFinite(moduleTime) || ageMs > msg._statusStaleAfterMs) {
        staleCount++;
        if (mod?.id) {
            staleModuleIds.push(String(mod.id));
        }
    }
});

msg._statusModuleCount = modules.length;
msg._statusStaleModuleCount = staleCount;
msg._statusNewestModuleAgeMs = newestModuleAgeMs;
msg._statusStaleModuleIds = staleModuleIds;

if (staleCount === 0) {
    return [msg, null];
}

msg._statusWasStale = true;
return [null, msg];
`.trim();

const checkModulesFunc = `
const station = msg.kioskDoc || {};
const stationId = station.stationid || msg._statusStationId || '';
const allModules = Array.isArray(station.modules) ? station.modules : [];
const activeModules = allModules.filter((mod) => !String(mod?.id || '').startsWith('disabled'));
const baseModules = activeModules.length > 0 ? activeModules : allModules;
const staleModuleIds = new Set(
    Array.isArray(msg._statusStaleModuleIds) ? msg._statusStaleModuleIds.map((id) => String(id)) : []
);
const modules = staleModuleIds.size > 0
    ? baseModules.filter((mod) => staleModuleIds.has(String(mod?.id || '')))
    : baseModules;
const spacingMs = 250;

if (!stationId) {
    node.error('No stationid available for module polling', msg);
    return null;
}

if (modules.length === 0) {
    node.warn('No modules found for stationid: ' + stationId);
    return [null, msg];
}

modules.forEach((mod, index) => {
    if (!mod || !mod.id) return;

    const pollMsg = {
        topic: '/' + stationId + '/' + mod.id + '/user/get',
        payload: { cmd: 'check_all' }
    };

    setTimeout(() => {
        node.send([pollMsg, null]);
    }, index * spacingMs);
});

msg._statusPollModuleCount = modules.length;
msg._statusPollSpacingMs = spacingMs;

return [null, msg];
`.trim();

const buildStatusFunc = `
if (!msg.payload?.timerequested || !msg._statusStationId) {
    node.error('Missing required fields (timerequested or stationid)', msg);
    return null;
}

function normalizeOptionGroup(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { active: false };
    }

    const normalized = {
        ...value,
        active: value.active === true
    };

    if (!normalized.active) {
        return { active: false };
    }

    return normalized;
}

const stationId = msg._statusStationId;
const station = msg.kioskDoc;
const staleAfterMs = Number(msg._statusStaleAfterMs || 25000);
const freshAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : 25000;
const now = Date.now();

if (!station) {
    msg.payload = {
        stationid: stationId,
        moduleid: null,
        action: 'status',
        status: 'offline',
        formoptions: {
            active: false
        },
        marketingoptions: {
            active: false
        },
        analyticsoptions: {
            active: false
        },
        vendbattery: null,
        timeresponded: now,
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
const formoptions = normalizeOptionGroup(station.formoptions);
const marketingoptions = normalizeOptionGroup(station.marketingoptions);
const analyticsoptions = normalizeOptionGroup(station.analyticsoptions);

const modules = Array.isArray(station.modules) ? station.modules : [];
const freshModuleIndexes = new Set();
let recentModuleFound = false;

modules.forEach((mod, modIndex) => {
    const moduleTime = new Date(mod?.lastUpdated).getTime();
    if (Number.isFinite(moduleTime) && (now - moduleTime) < freshAfterMs) {
        freshModuleIndexes.add(modIndex);
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
const globalIndexBySlot = new Map();

modules.forEach((stationModule, modIndex) => {
    const slots = Array.isArray(stationModule?.slots) ? stationModule.slots : [];
    slots.forEach((slot) => {
        const slotPosition = Number(slot?.position);
        const key = modIndex + ':' + slotPosition;
        globalIndexBySlot.set(key, globalSlots.length);
        globalSlots.push({
            modIndex,
            slotPosition
        });
    });
});

globalSlots.sort((left, right) => {
    if (left.modIndex === right.modIndex) {
        return left.slotPosition - right.slotPosition;
    }
    return left.modIndex - right.modIndex;
});

globalSlots.forEach((slot, index) => {
    globalIndexBySlot.set(slot.modIndex + ':' + slot.slotPosition, index);
});

let vendIndex = globalSlots.findIndex((slot) =>
    slot.modIndex === vendModuleIndex && slot.slotPosition === vendSlotNumber
);
if (vendIndex === -1) vendIndex = 0;

const totalSlots = globalSlots.length;
let qualifyingSlots = [];

modules.forEach((stationModule, modIndex) => {
    if (!freshModuleIndexes.has(modIndex)) {
        return;
    }

    const slots = Array.isArray(stationModule?.slots) ? stationModule.slots : [];
    slots.forEach((slot) => {
        const sn = Number(slot?.sn || 0);
        const batteryLevel = Number(slot?.batteryLevel || 0);
        if (Number(slot?.status) !== 1) return;
        if (batteryLevel < 80) return;
        if (!sn || sn === 0 || String(sn) === '00000000') return;

        const globalIndex = globalIndexBySlot.get(modIndex + ':' + Number(slot?.position));

        qualifyingSlots.push({
            sn,
            batteryLevel,
            globalIndex: Number.isFinite(globalIndex) ? globalIndex : -1,
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
    vendBatteryCandidate = candidateSlot;
    firstModuleId = candidateSlot.moduleid;
    finalSNs.push(candidateSlot.sn);
    qualifyingSlots = qualifyingSlots.filter((slot) => slot !== candidateSlot);
}

qualifyingSlots.forEach((slot) => {
    if (!vendBatteryCandidate) {
        vendBatteryCandidate = slot;
    }
    if (!firstModuleId) {
        firstModuleId = slot.moduleid;
    }
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
    marketingoptions,
    analyticsoptions,
    vendbattery: vendBatteryCandidate ? {
        powerlevel: vendBatteryCandidate.batteryLevel,
        slot: vendBatteryCandidate.position,
        sn: vendBatteryCandidate.sn
    } : null,
    timeresponded: now,
    timerequested: msg.payload.timerequested
};
msg.topic = 'CSTA/post/' + (station.stationid || stationId);

return msg;
`.trim();

const flow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const groupNode = flow.find((node) => node.id === 'ss-import-group');
const pollResolveIndex = flow.findIndex((node) => node.id === 'ss-poll-resolve');

if (!groupNode || pollResolveIndex === -1) {
  console.error('Expected vend/status flow nodes were not found in the input export.');
  process.exit(1);
}

const freshnessNode = {
  id: 'ss-freshness-gate',
  type: 'function',
  z: groupNode.z,
  g: groupNode.id,
  name: 'Route Fresh vs Stale',
  func: freshnessGateFunc,
  outputs: 2,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 2165,
  y: 1940,
  wires: [
    ['ss-build-status'],
    ['ss-check-modules'],
  ],
};

if (!flow.some((node) => node.id === freshnessNode.id)) {
  flow.splice(pollResolveIndex + 1, 0, freshnessNode);
}

flow.forEach((node) => {
  if (node.id === 'ss-import-group') {
    node.name = 'send status to server firebase only (cache-first)';
    node.nodes = [
      'ss-switch',
      'ss-poll-prep',
      'ss-poll-query',
      'ss-poll-resolve',
      'ss-freshness-gate',
      'ss-check-modules',
      'ss-trigger',
      'ss-refresh-prep',
      'ss-refresh-query',
      'ss-refresh-resolve',
      'ss-build-status',
      'ss-debug-request',
      'ss-debug-response',
      'ce73e96d279fd273',
      'd92c93b9a93cec56',
      'f22a39a79e0753e2',
    ];
    node.w = 1892;
  }

  if (node.id === 'ss-switch') {
    node.wires = [['ss-poll-prep', 'ss-debug-request']];
  }

  if (node.id === 'ss-poll-prep') {
    node.name = 'Prepare Initial Query';
    node.func = prepareQueryFunc;
  }

  if (node.id === 'ss-poll-query') {
    node.name = 'Query kiosk';
  }

  if (node.id === 'ss-poll-resolve') {
    node.name = 'Resolve Kiosk';
    node.func = resolveKioskFunc;
    node.wires = [['ss-freshness-gate']];
  }

  if (node.id === 'ss-check-modules') {
    node.name = 'Poll stale modules';
    node.func = checkModulesFunc;
    node.outputs = 2;
    node.x = 2405;
    node.wires = [['d92c93b9a93cec56'], ['ss-trigger']];
  }

  if (node.id === 'ss-trigger') {
    node.name = 'Wait 4s after stale poll';
    node.duration = '4';
    node.x = 2405;
    node.wires = [['ss-refresh-prep']];
  }

  if (node.id === 'ss-refresh-prep') {
    node.func = prepareQueryFunc;
    node.x = 2630;
  }

  if (node.id === 'ss-refresh-query') {
    node.name = 'Query refreshed kiosk';
    node.x = 2850;
  }

  if (node.id === 'ss-refresh-resolve') {
    node.name = 'Resolve Refreshed Kiosk';
    node.func = resolveKioskFunc;
    node.x = 3090;
  }

  if (node.id === 'ss-build-status') {
    node.func = buildStatusFunc;
    node.x = 3320;
  }

  if (node.id === 'ss-debug-response') {
    node.x = 3260;
  }

  if (node.id === 'f22a39a79e0753e2') {
    node.x = 3485;
  }
});

fs.writeFileSync(outputPath, JSON.stringify(flow, null, 4) + '\n');
console.log(`Wrote ${outputPath}`);
