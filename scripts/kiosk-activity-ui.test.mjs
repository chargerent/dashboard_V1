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
    assert.doesNotMatch(statusAlert, /Offline since/);
});

test('dashboard activity navigation uses a distinct purple activity control', async () => {
    const [app, dashboard, rules] = await Promise.all([
        readSource('../src/App.jsx'),
        readSource('../src/pages/DashboardPage.jsx'),
        readSource('../firestore.rules'),
    ]);

    assert.match(dashboard, /data-icon="activity-pulse"/);
    assert.match(dashboard, /bg-purple-500/);
    assert.match(dashboard, /aria-label="Kiosk activity"/);
    assert.match(app, /operationalActivityEnabled=\{clientInfo\?\.isAdmin === true\}/);
    assert.match(app, /case 'activity':[\s\S]*if \(clientInfo\?\.isAdmin !== true\)[\s\S]*return dashboard/);
    assert.match(rules, /function isAdmin\(\)/);
    assert.match(rules, /match \/kioskEvents\/\{docId\}[\s\S]*allow read: if isAdmin\(\)/);
    assert.match(rules, /match \/kioskIncidents\/\{docId\}[\s\S]*allow read: if isAdmin\(\)/);
    assert.match(rules, /collection != 'kioskEvents'/);
    assert.match(rules, /collection != 'kioskIncidents'/);
});

test('activity page paginates history and supports station deep links', async () => {
    const [app, activityPage] = await Promise.all([
        readSource('../src/App.jsx'),
        readSource('../src/pages/ActivityPage.jsx'),
    ]);

    assert.match(app, /searchParams\.set\('page', 'activity'\)/);
    assert.match(app, /searchParams\.set\('station', stationId\)/);
    assert.match(activityPage, /const PAGE_SIZE = 30/);
    assert.match(activityPage, /if \(!selectedStation\)/);
    assert.match(activityPage, /\{selectedStation && <section>/);
    assert.match(activityPage, /aria-label=\{`View activity for/);
    assert.match(activityPage, /onClick=\{\(\) => onSelectStation\(incident\.stationId\)\}/);
    assert.match(activityPage, /onClick=\{\(\) => onNavigateToDashboard\(incident\.stationId\)\}/);
    assert.match(activityPage, /onClick=\{\(\) => onNavigateToDashboard\(event\.stationId\)\}/);
    assert.match(activityPage, /onClick=\{\(\) => onNavigateToDashboard\(\)\}/);
    assert.match(app, /setDashboardSearchTerm\(normalized\)/);
    assert.doesNotMatch(app, /window\.history\.state\?\.dashboardActivityNavigation[\s\S]*window\.history\.back\(\)/);
    assert.match(activityPage, /type: 'kiosk_offline'/);
    assert.match(activityPage, /isKioskOnline\(kiosk, referenceTime\)/);
    assert.match(activityPage, /incident\.type !== MQTT_DISCONNECTED_TYPE/);
    assert.match(activityPage, /summary: isResolvedHeartbeat \? 'Heartbeat restored' : 'Overdue heartbeat'/);
    assert.match(activityPage, /category: 'module'/);
    assert.match(activityPage, /const collapseRepeatedStates/);
    assert.match(activityPage, /activityStateKey\(previous\) === activityStateKey\(event\)/);
    assert.match(activityPage, /const collapseRelatedModuleStates/);
    assert.match(activityPage, /event\.kioskGeneration === 'v2' && event\.type === TELEMETRY_OVERDUE_TYPE/);
    assert.match(activityPage, /const hasV2ModuleDisconnect/);
    assert.match(activityPage, /const \[dateRange, setDateRange\] = useState\('today'\)/);
    assert.match(activityPage, /\['3days', '3 days', 3\]/);
    assert.match(activityPage, /\['7days', '7 days', 7\]/);
    assert.match(activityPage, /where\('occurredAt', '>=', new Date\(historyStartMs\)\)/);
    assert.match(activityPage, /isKioskActive\(station, referenceTime\)/);
    assert.match(activityPage, /selectedStation && !allowedStationIds\.has\(selectedStation\)/);
    assert.match(activityPage, /summary: pageVisitSummary\(event\.page \|\| event\.currentValue\)/);
    assert.match(activityPage, /startAfter\(after\)/);
    assert.match(activityPage, /Load more/);
    assert.match(activityPage, /aria-label="Home"/);
    assert.match(activityPage, /SEEN_STORAGE_KEY/);
    assert.match(activityPage, /Unseen activity/);
    assert.doesNotMatch(activityPage, /\['errors', 'Errors'\]/);
    assert.doesNotMatch(activityPage, /\['terminal', 'Terminal'\]/);
    assert.match(activityPage, /event\.category === 'terminal'.*category: 'interaction'/s);
    assert.match(activityPage, /const groupInteractionEvents/);
    assert.match(activityPage, /event\.category !== 'interaction' \|\| !event\.interactionId/);
    assert.match(activityPage, /<InteractionCard key=\{`interaction:/);
    assert.match(activityPage, /Transaction \{transactionId\}/);
    assert.match(activityPage, /View timeline/);
    assert.doesNotMatch(activityPage, /DASHBOARD_VERSION|ArrowLeftIcon/);
});
