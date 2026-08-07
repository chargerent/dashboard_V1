import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('activity history is lazy-loaded outside kiosk cards', async () => {
    const [app, kioskPanel, dashboard] = await Promise.all([
        readSource('../src/App.jsx'),
        readSource('../src/components/kiosk/kioskPanel.jsx'),
        readSource('../src/pages/DashboardPage.jsx'),
    ]);

    assert.match(app, /lazy\(\(\) => import\('\.\/pages\/ActivityPage\.jsx'\)\)/);
    assert.doesNotMatch(kioskPanel, /kioskEvents|onSnapshot|KioskEventLog/);
    assert.match(kioskPanel, /KioskStatusAlert/);
    assert.match(dashboard, /where\('state', '==', 'open'\)/);
});

test('offline kiosk cards consolidate status and suppress telemetry overdue duplication', async () => {
    const [kioskPanel, statusAlert] = await Promise.all([
        readSource('../src/components/kiosk/kioskPanel.jsx'),
        readSource('../src/components/kiosk/KioskStatusAlert.jsx'),
    ]);

    assert.doesNotMatch(kioskPanel, /Offline since:/);
    assert.match(statusAlert, /kiosk_telemetry_overdue/);
    assert.match(statusAlert, /incidents\.filter/);
    assert.match(statusAlert, /Kiosk offline/);
});

test('activity page paginates history and supports station deep links', async () => {
    const [app, activityPage] = await Promise.all([
        readSource('../src/App.jsx'),
        readSource('../src/pages/ActivityPage.jsx'),
    ]);

    assert.match(app, /searchParams\.set\('page', 'activity'\)/);
    assert.match(app, /searchParams\.set\('station', stationId\)/);
    assert.match(activityPage, /const PAGE_SIZE = 30/);
    assert.match(activityPage, /startAfter\(after\)/);
    assert.match(activityPage, /Load more/);
    assert.match(activityPage, /aria-label="Home"/);
    assert.match(activityPage, /SEEN_STORAGE_KEY/);
    assert.match(activityPage, /Unseen activity/);
    assert.doesNotMatch(activityPage, /DASHBOARD_VERSION|ArrowLeftIcon/);
});
