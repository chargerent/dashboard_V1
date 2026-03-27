import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPath = path.join(__dirname, 'watchdog-all-import.json');
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
const roster = {};
let moduleCount = 0;

for (const doc of docs) {
    const stationid = normalizeStationId(doc?.stationid);
    if (!stationid) continue;

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
        modules: selectedModules.map((mod) => ({ id: mod.id }))
    };

    moduleCount += selectedModules.length;
}

flow.set('watchdogRoster', roster);

msg.payload = {
    stations: Object.keys(roster).length,
    modules: moduleCount,
    refreshedAt: new Date().toISOString()
};

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
const stations = Object.values(roster);

if (stations.length === 0) {
    node.status({ fill: 'grey', shape: 'ring', text: 'No stations in roster' });
    return [null, {
        payload: {
            stations: 0,
            checks: 0,
            cycleMs: CYCLE_MS
        }
    }];
}

const checks = [];

stations.forEach((station) => {
    const modules = Array.isArray(station?.modules) ? station.modules : [];
    modules.forEach((mod) => {
        if (!mod || !mod.id) return;

        checks.push({
            stationid: station.stationid,
            moduleid: mod.id
        });
    });
});

if (checks.length === 0) {
    node.status({ fill: 'grey', shape: 'ring', text: 'No modules in roster' });
    return [null, {
        payload: {
            stations: stations.length,
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
                cycleStartedAt: now,
                cycleMs: CYCLE_MS,
                delayMs,
                checkIndex: index + 1,
                totalChecks: checks.length
            }
        }, null]);
    }, delayMs);
});

node.status({
    fill: 'green',
    shape: 'dot',
    text: checks.length + ' checks across ' + stations.length + ' stations'
});

return [null, {
    payload: {
        stations: stations.length,
        checks: checks.length,
        cycleMs: CYCLE_MS
    }
}];
`.trim();

const flow = [
    {
        id: 'allwdg_group',
        type: 'group',
        z: tabId,
        name: 'All-station 20s watchdog',
        style: {
            stroke: '#1d4ed8',
            fill: '#dbeafe',
            label: true,
            color: '#000000'
        },
        nodes: [
            'allwdg_refresh_inject',
            'allwdg_prepare_roster_query',
            'allwdg_roster_query',
            'allwdg_cache_roster',
            'allwdg_debug_roster',
            'allwdg_tick_inject',
            'allwdg_poll_all',
            'allwdg_debug_summary',
            'allwdg_debug_send',
            'allwdg_link_out'
        ],
        x: 2054,
        y: 3199,
        w: 1672,
        h: 202
    },
    {
        id: 'allwdg_refresh_inject',
        type: 'inject',
        z: tabId,
        g: 'allwdg_group',
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
        y: 3260,
        wires: [['allwdg_prepare_roster_query']]
    },
    {
        id: 'allwdg_prepare_roster_query',
        type: 'function',
        z: tabId,
        g: 'allwdg_group',
        name: 'Prepare roster query',
        func: prepareRosterQueryFunc,
        outputs: 1,
        timeout: 0,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: 2480,
        y: 3260,
        wires: [['allwdg_roster_query']]
    },
    {
        id: 'allwdg_roster_query',
        type: 'google-cloud-firestore',
        z: tabId,
        g: 'allwdg_group',
        account: '',
        keyFilename: '/home/george/firestore/firestore-key.json',
        name: 'Query kiosks for roster',
        projectId: 'node-red-alerts',
        mode: 'query',
        x: 2710,
        y: 3260,
        wires: [['allwdg_cache_roster']]
    },
    {
        id: 'allwdg_cache_roster',
        type: 'function',
        z: tabId,
        g: 'allwdg_group',
        name: 'Cache station roster',
        func: cacheRosterFunc,
        outputs: 1,
        timeout: 0,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: 2940,
        y: 3260,
        wires: [['allwdg_debug_roster']]
    },
    {
        id: 'allwdg_debug_roster',
        type: 'debug',
        z: tabId,
        g: 'allwdg_group',
        name: 'Watchdog roster refreshed',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'payload',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 3170,
        y: 3300,
        wires: []
    },
    {
        id: 'allwdg_tick_inject',
        type: 'inject',
        z: tabId,
        g: 'allwdg_group',
        name: 'Poll all stations every 20 sec',
        props: [{ p: 'payload' }],
        repeat: '20',
        crontab: '',
        once: true,
        onceDelay: 5,
        topic: '',
        payload: '',
        payloadType: 'date',
        x: 2250,
        y: 3340,
        wires: [['allwdg_poll_all']]
    },
    {
        id: 'allwdg_poll_all',
        type: 'function',
        z: tabId,
        g: 'allwdg_group',
        name: 'Send scheduled checks for all modules',
        func: sendScheduledChecksFunc,
        outputs: 2,
        timeout: 0,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: 2550,
        y: 3340,
        wires: [
            ['allwdg_debug_send', 'allwdg_link_out'],
            ['allwdg_debug_summary']
        ]
    },
    {
        id: 'allwdg_debug_summary',
        type: 'debug',
        z: tabId,
        g: 'allwdg_group',
        name: 'All watchdog summary',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'payload',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 2850,
        y: 3380,
        wires: []
    },
    {
        id: 'allwdg_debug_send',
        type: 'debug',
        z: tabId,
        g: 'allwdg_group',
        name: 'All watchdog sends check_all',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'watchdog',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: 2850,
        y: 3300,
        wires: []
    },
    {
        id: 'allwdg_link_out',
        type: 'link out',
        z: tabId,
        g: 'allwdg_group',
        name: 'link out 76',
        mode: 'link',
        links: [mqttLinkId],
        x: 3075,
        y: 3340,
        wires: []
    }
];

fs.writeFileSync(outputPath, JSON.stringify(flow, null, 4) + '\n');
console.log(`Wrote ${outputPath}`);
