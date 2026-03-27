import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPath = path.join(__dirname, 'watchdog-hot-import.json');
const tabId = 'ebbebe04a01eca8f';
const mqttLinkId = '187805de07036155';

const normalizeHelpers = `
function normalizeStationId(value) {
    return String(value || '').trim();
}

function normalizeModuleId(value) {
    return String(value || '').trim();
}
`.trim();

const prepareRosterQueryFunc = `
msg.payload = {
    path: 'kiosks',
    query: []
};

return msg;
`.trim();

const cacheRosterFunc = `
${normalizeHelpers}

const docs = Array.isArray(msg.payload) ? msg.payload : [];
const prefixes = ['CA8', 'FR8', 'US8'];
const roster = {};

for (const doc of docs) {
    const stationid = normalizeStationId(doc?.stationid);
    if (!stationid) continue;
    if (!prefixes.some((prefix) => stationid.startsWith(prefix))) continue;

    const modules = (Array.isArray(doc?.modules) ? doc.modules : [])
        .map((mod) => ({
            id: normalizeModuleId(mod?.id),
            output: mod?.output !== false
        }))
        .filter((mod) => mod.id);

    const activeModules = modules.filter((mod) => mod.output !== false);
    const selectedModules = activeModules.length > 0 ? activeModules : modules;
    if (selectedModules.length === 0) continue;

    roster[stationid] = {
        stationid,
        provisionid: normalizeStationId(doc?.provisionid),
        lastUpdate: doc?.lastUpdate || doc?.timestamp || doc?.lastUpdated || null,
        hardwareType: normalizeStationId(doc?.hardware?.type),
        formActive: doc?.formoptions?.active === true,
        modules: selectedModules.map((mod) => ({ id: mod.id }))
    };
}

flow.set('watchdogRoster', roster);

msg.payload = {
    rosterStations: Object.keys(roster).length,
    refreshedAt: new Date().toISOString()
};

return msg;
`.trim();

const markHotStationFunc = `
${normalizeHelpers}

const HOT_WINDOW_MS = 10 * 60 * 1000;
const payload = msg.payload;

const stationid = normalizeStationId(
    (payload && typeof payload === 'object' ? payload.stationid : payload) ||
    msg.stationid ||
    msg._statusStationId ||
    msg.id
);

if (!stationid) {
    node.warn('Hot kiosk registration missing stationid');
    return null;
}

const hotStations = flow.get('watchdogHotStations') || {};
const reason = String(
    (payload && typeof payload === 'object' ? payload.action : '') ||
    msg.action ||
    hotStations[stationid]?.reason ||
    'status'
).trim() || 'status';

hotStations[stationid] = {
    stationid,
    reason,
    hotUntil: Date.now() + HOT_WINDOW_MS,
    markedAt: Date.now()
};

flow.set('watchdogHotStations', hotStations);

msg.payload = hotStations[stationid];
return msg;
`.trim();

const sendScheduledChecksFunc = `
const CYCLE_MS = 20 * 1000;
const now = Date.now();
const cycleUntil = Number(flow.get('watchdogCycleUntil') || 0);

if (cycleUntil > now) {
    node.status({ fill: 'yellow', shape: 'ring', text: 'Previous cycle still running' });
    return [null, {
        payload: {
            skipped: true,
            reason: 'previous cycle still running',
            cycleUntil
        }
    }];
}

const roster = flow.get('watchdogRoster') || {};
const hotStations = flow.get('watchdogHotStations') || {};
const retainedHotStations = {};
const checks = [];

for (const [stationid, state] of Object.entries(hotStations)) {
    const hotUntil = Number(state?.hotUntil || 0);
    if (hotUntil <= now) continue;

    const station = roster[stationid];
    if (!station || !Array.isArray(station.modules) || station.modules.length === 0) continue;

    retainedHotStations[stationid] = state;

    station.modules.forEach((mod) => {
        if (!mod || !mod.id) return;

        checks.push({
            stationid,
            moduleid: mod.id,
            reason: state.reason || 'status'
        });
    });
}

flow.set('watchdogHotStations', retainedHotStations);

if (checks.length === 0) {
    node.status({ fill: 'grey', shape: 'ring', text: 'No hot kiosks' });
    return [null, {
        payload: {
            activeStations: 0,
            checks: 0,
            cycleMs: CYCLE_MS
        }
    }];
}

flow.set('watchdogCycleUntil', now + CYCLE_MS + 1000);

checks.forEach((item, index) => {
    const delayMs = Math.floor((index * CYCLE_MS) / checks.length);

    setTimeout(() => {
        node.send([{
            topic: '/' + item.stationid + '/' + item.moduleid + '/user/get',
            payload: { cmd: 'check_all' },
            watchdog: {
                stationid: item.stationid,
                moduleid: item.moduleid,
                reason: item.reason,
                cycleStartedAt: now,
                cycleMs: CYCLE_MS,
                delayMs,
                totalChecks: checks.length
            }
        }, null]);
    }, delayMs);
});

node.status({
    fill: 'green',
    shape: 'dot',
    text: checks.length + ' checks for ' + Object.keys(retainedHotStations).length + ' hot kiosks'
});

return [null, {
    payload: {
        activeStations: Object.keys(retainedHotStations).length,
        checks: checks.length,
        cycleMs: CYCLE_MS
    }
}];
`.trim();

const flow = [
    {
        id: 'hotwdg_group',
        type: 'group',
        z: tabId,
        name: 'Hot kiosk refresher',
        style: {
            stroke: '#0f766e',
            fill: '#ccfbf1',
            label: true,
            color: '#000000'
        },
        nodes: [
            'hotwdg_refresh_inject',
            'hotwdg_prepare_roster_query',
            'hotwdg_roster_query',
            'hotwdg_cache_roster',
            'hotwdg_debug_roster',
            'hotwdg_mark_in',
            'hotwdg_mark_hot',
            'hotwdg_debug_mark',
            'hotwdg_tick_inject',
            'hotwdg_poll_hot',
            'hotwdg_debug_summary',
            'hotwdg_debug_send',
            'hotwdg_link_out'
        ],
        x: 2054,
        y: 2879,
        w: 1752,
        h: 242
    },
    {
        id: 'hotwdg_refresh_inject',
        type: 'inject',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Refresh roster every 5 min',
        props: [{ p: 'payload' }],
        repeat: '300',
        crontab: '',
        once: true,
        onceDelay: 1,
        topic: '',
        payload: '',
        payloadType: 'date',
        x: 2250,
        y: 2940,
        wires: [['hotwdg_prepare_roster_query']]
    },
    {
        id: 'hotwdg_prepare_roster_query',
        type: 'function',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Prepare roster query',
        func: prepareRosterQueryFunc,
        outputs: 1,
        timeout: 0,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: 2490,
        y: 2940,
        wires: [['hotwdg_roster_query']]
    },
    {
        id: 'hotwdg_roster_query',
        type: 'google-cloud-firestore',
        z: tabId,
        g: 'hotwdg_group',
        account: '',
        keyFilename: '/home/george/firestore/firestore-key.json',
        name: 'Query kiosks for roster',
        projectId: 'node-red-alerts',
        mode: 'query',
        x: 2720,
        y: 2940,
        wires: [['hotwdg_cache_roster']]
    },
    {
        id: 'hotwdg_cache_roster',
        type: 'function',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Cache kiosk roster',
        func: cacheRosterFunc,
        outputs: 1,
        timeout: 0,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: 2950,
        y: 2940,
        wires: [['hotwdg_debug_roster']]
    },
    {
        id: 'hotwdg_debug_roster',
        type: 'debug',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Roster refreshed',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'payload',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 3160,
        y: 2980,
        wires: []
    },
    {
        id: 'hotwdg_mark_in',
        type: 'link in',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Register hot kiosk',
        links: [],
        x: 2235,
        y: 3020,
        wires: [['hotwdg_mark_hot']]
    },
    {
        id: 'hotwdg_mark_hot',
        type: 'function',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Mark station hot for 10 min',
        func: markHotStationFunc,
        outputs: 1,
        timeout: 0,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: 2490,
        y: 3020,
        wires: [['hotwdg_debug_mark']]
    },
    {
        id: 'hotwdg_debug_mark',
        type: 'debug',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Hot kiosk marked',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'payload',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 2720,
        y: 3060,
        wires: []
    },
    {
        id: 'hotwdg_tick_inject',
        type: 'inject',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Poll hot kiosks every 20 sec',
        props: [{ p: 'payload' }],
        repeat: '20',
        crontab: '',
        once: true,
        onceDelay: 5,
        topic: '',
        payload: '',
        payloadType: 'date',
        x: 2260,
        y: 3100,
        wires: [['hotwdg_poll_hot']]
    },
    {
        id: 'hotwdg_poll_hot',
        type: 'function',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Send scheduled module checks',
        func: sendScheduledChecksFunc,
        outputs: 2,
        timeout: 0,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: 2530,
        y: 3100,
        wires: [
            ['hotwdg_debug_send', 'hotwdg_link_out'],
            ['hotwdg_debug_summary']
        ]
    },
    {
        id: 'hotwdg_debug_summary',
        type: 'debug',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Hot watchdog summary',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'payload',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 2800,
        y: 3140,
        wires: []
    },
    {
        id: 'hotwdg_debug_send',
        type: 'debug',
        z: tabId,
        g: 'hotwdg_group',
        name: 'Hot watchdog sends check_all',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'watchdog',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 2820,
        y: 3060,
        wires: []
    },
    {
        id: 'hotwdg_link_out',
        type: 'link out',
        z: tabId,
        g: 'hotwdg_group',
        name: 'link out 76',
        mode: 'link',
        links: [mqttLinkId],
        x: 3045,
        y: 3100,
        wires: []
    }
];

fs.writeFileSync(outputPath, JSON.stringify(flow, null, 4) + '\n');
console.log(`Wrote ${outputPath}`);
