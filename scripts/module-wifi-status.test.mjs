import assert from 'node:assert/strict';

import { normalizeKioskData, resolveModuleWifiStatus } from '../src/utils/helpers.js';

const module1 = '864253060991981';
const module2 = '864253060998853';
const rawKiosk = {
    stationid: 'FR8012',
    provisionid: 'id-9987807859',
    hardware: { type: 'CT12' },
    wifi: { name: 'Freebox-76E30F', password: 'not-inspected-by-this-test' },
    observedWifiByModule: {
        [module1]: {
            ssid: 'Freebox-76E30F',
            signalDbm: -49,
            reportedAt: '2026-08-29T15:56:18.230Z',
            matchesConfiguredSsid: true,
        },
        [`1000${module2}`]: {
            ssid: 'Freebox-76E30F',
            signalDbm: -51,
            reportedAt: '2026-08-29T15:56:13.768Z',
            matchesConfiguredSsid: true,
        },
    },
    modules: [
        { id: module1, slots: [], lastUpdated: '2026-08-29T15:56:18.230Z' },
        { id: module2, slots: [], lastUpdated: '2026-08-29T15:56:13.768Z' },
    ],
};

const [normalized] = normalizeKioskData([rawKiosk]);
assert.deepEqual(normalized.observedWifiByModule, rawKiosk.observedWifiByModule);

assert.deepEqual(resolveModuleWifiStatus(normalized, module1), {
    ssid: 'Freebox-76E30F',
    source: 'reported',
    signalDbm: -49,
    reportedAt: '2026-08-29T15:56:18.230Z',
    matchesConfiguredSsid: true,
});

assert.deepEqual(resolveModuleWifiStatus(normalized, module2), {
    ssid: 'Freebox-76E30F',
    source: 'reported',
    signalDbm: -51,
    reportedAt: '2026-08-29T15:56:13.768Z',
    matchesConfiguredSsid: true,
});

assert.deepEqual(resolveModuleWifiStatus({ wifi: { name: 'SavedNetwork' } }, 'unreported-module'), {
    ssid: 'SavedNetwork',
    source: 'configured',
    signalDbm: null,
    reportedAt: null,
    matchesConfiguredSsid: null,
});

assert.equal(resolveModuleWifiStatus({
    wifi: { name: 'SavedNetwork' },
    observedWifiByModule: {
        module1: { ssid: 'SavedNetwork', signalDbm: null },
    },
}, 'module1').signalDbm, null);

assert.deepEqual(resolveModuleWifiStatus({}, 'unreported-module'), {
    ssid: '',
    source: 'unavailable',
    signalDbm: null,
    reportedAt: null,
    matchesConfiguredSsid: null,
});

console.log('module Wi-Fi status tests passed');
