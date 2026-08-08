import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('activity history is lazy-loaded outside kiosk cards', async () => {
    const [app, kioskPanel, dashboard, rentalStats] = await Promise.all([
        readSource('../src/App.jsx'),
        readSource('../src/components/kiosk/kioskPanel.jsx'),
        readSource('../src/pages/DashboardPage.jsx'),
        readSource('../src/components/Dashboard/RentalStats.jsx'),
    ]);

    assert.match(app, /lazy\(\(\) => import\('\.\/pages\/ActivityPage\.jsx'\)\)/);
    assert.doesNotMatch(kioskPanel, /kioskEvents|onSnapshot|KioskEventLog/);
    assert.match(kioskPanel, /KioskStatusAlert/);
    assert.match(kioskPanel, /onNavigateToActivity=\{clientInfo\.isAdmin \? onNavigateToActivity : undefined\}/);
    assert.match(rentalStats, /aria-label=\{`View activity for \$\{stationId\}`\}/);
    assert.match(rentalStats, /data-icon="activity-pulse" className="h-4 w-4 shrink-0"/);
    assert.match(rentalStats, /onNavigateToActivity\(stationId\)/);
    assert.match(rentalStats, /clientInfo\?\.isAdmin === true/);
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
    assert.match(dashboard, /bg-\[#B784A7\]/);
    assert.match(dashboard, /hover:bg-\[#9D6B8F\]/);
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
    assert.match(activityPage, /return `module:\$\{event\.type\}:\$\{String\(event\.moduleId \|\| ''\)\.trim\(\)\}`/);
    assert.match(activityPage, /summary: `Module\$\{moduleId \? ` \$\{moduleId\}` : ''\} \$\{type === 'module_connected' \? 'connected' : 'disconnected'\}`/);
    assert.match(activityPage, /const collapseRelatedModuleStates/);
    assert.match(activityPage, /if \(event\.type === 'module_disconnected_resolved'\) return false/);
    assert.match(activityPage, /event\.kioskGeneration === 'v2' && event\.type === TELEMETRY_OVERDUE_TYPE/);
    assert.match(activityPage, /const hasV2ModuleDisconnect/);
    assert.match(activityPage, /const \[dateRange, setDateRange\] = useState\('today'\)/);
    assert.match(activityPage, /\['3days', '3 days', 3\]/);
    assert.match(activityPage, /\['7days', '7 days', 7\]/);
    assert.match(activityPage, /where\('occurredAt', '>=', new Date\(historyStartMs\)\)/);
    assert.match(activityPage, /isKioskActive\(station, referenceTime\)/);
    assert.match(activityPage, /selectedStation && !allowedStationIds\.has\(selectedStation\)/);
    assert.match(activityPage, /sourceSurface === 'terminal' \? 'Terminal button pressed' : 'Button pressed'/);
    assert.match(activityPage, /startpage: 'Returned to start page'/);
    assert.match(activityPage, /returntypage: 'Return complete page'/);
    assert.match(activityPage, /const interactionSequence/);
    assert.match(activityPage, /event\.type === 'customer_button_state_changed' && state === 'disabled'/);
    assert.match(activityPage, /type === 'customer_button_state_changed'[\s\S]*severity: 'info'/);
    assert.match(activityPage, /interactionSequence\(left\) - interactionSequence\(right\)/);
    assert.match(activityPage, /const selectedStationSurface = useMemo/);
    assert.match(activityPage, /normalizeActivityEvent\(event, selectedStationSurface\)/);
    assert.match(activityPage, /\[allowedStationIds, historyStartMs, selectedStation, selectedStationSurface\]/);
    assert.doesNotMatch(activityPage, /\[allowedStationIds, historyStartMs, selectedStation, stationsById\]/);
    assert.match(activityPage, /startAfter\(after\)/);
    assert.match(activityPage, /Load more/);
    assert.match(activityPage, /aria-label="Home"/);
    assert.match(activityPage, /SEEN_STORAGE_KEY/);
    assert.match(activityPage, /Unseen activity/);
    assert.doesNotMatch(activityPage, /\['errors', 'Errors'\]/);
    assert.doesNotMatch(activityPage, /\['terminal', 'Terminal'\]/);
    assert.match(activityPage, /event\.category === 'terminal'.*category: 'interaction'/s);
    assert.match(activityPage, /const groupInteractionEvents/);
    assert.match(activityPage, /const rentalTimelineKey/);
    assert.match(activityPage, /const TRANSACTION_TIMELINE_EVENT_TYPES = new Set/);
    assert.match(activityPage, /where\('transactionId', 'in', returnTransactionIds\)/);
    assert.doesNotMatch(activityPage, /\.filter\(\(event\) => event\.stationId === selectedStation\)/);
    assert.match(activityPage, /const isTransactionEvent = event\.category === 'interaction'/);
    assert.match(activityPage, /transactionKey && TRANSACTION_TIMELINE_EVENT_TYPES\.has\(event\.type\)/);
    assert.match(activityPage, /const cardKind = event\.type === 'charger_returned' \? 'return' : 'rental'/);
    assert.match(activityPage, /const key = `\$\{cardKind\}:\$\{transactionKey\}`/);
    assert.match(activityPage, /if \(!isTransactionEvent\)[\s\S]*type: 'event'/);
    assert.match(activityPage, /if \(kind === 'return'\) return 'Return interaction'/);
    assert.doesNotMatch(activityPage, /originalKinds\.has\('return'\)/);
    assert.match(activityPage, /groupInteractionEvents\([\s\S]*visibleEvents,[\s\S]*relatedTimelineEvents/);
    assert.match(activityPage, /cardKind=\{item\.cardKind\}/);
    assert.match(activityPage, /cardEvent=\{item\.cardEvent\}/);
    assert.match(activityPage, /if \(cardKind === 'return'\) return 'Charger return'/);
    assert.match(activityPage, /'charger_returned'/);
    assert.match(activityPage, /Rental duration \{formatDuration\(rentalDurationMs\)\}/);
    assert.match(activityPage, /second: '2-digit'/);
    assert.doesNotMatch(activityPage, /const returnedToStart = events\.some/);
    assert.doesNotMatch(activityPage, /event\.category !== 'interaction' \|\| !event\.interactionId/);
    assert.match(activityPage, /<InteractionCard key=\{`interaction:/);
    assert.match(activityPage, /Transaction \{transactionId\}/);
    assert.match(activityPage, /View timeline/);
    assert.match(activityPage, /const RENTAL_INTERACTION_STYLE = 'border-emerald-200 bg-emerald-50 text-emerald-900'/);
    assert.match(activityPage, /severity === 'info' && isRentalInteraction/);
    assert.doesNotMatch(activityPage, /DASHBOARD_VERSION|ArrowLeftIcon/);
});
