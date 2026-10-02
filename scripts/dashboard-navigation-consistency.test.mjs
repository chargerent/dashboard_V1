import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const pageContracts = [
  ['AccountingPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['ActivityPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['AdminPage.jsx', ['onNavigateToDashboard', 'onLogout']],
  ['AgreementPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['AiBoothsPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['AnalyticsPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['BindingPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['ChargeDropsClientPortalPage.jsx', ['onLogout']],
  ['ChargeDropsClientSetupPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['ChargersPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['ChargerentMediaPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['CustomerSupportPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['DashboardPage.jsx', ['onNavigateToAdmin', 'onLogout']],
  ['KioskEditorPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['MediaPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['PayoutsPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['PayterPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['PhoneControlPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['ProvisionPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['RentalsPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['ReportingPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['TemplatesPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['TestingPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
  ['UiProfilesPage.jsx', ['onNavigateToDashboard', 'onNavigateToAdmin', 'onLogout']],
];

test('every authenticated dashboard page uses the shared page-action controls', () => {
  for (const [fileName, requiredProps] of pageContracts) {
    const source = read(`src/pages/${fileName}`);
    assert.match(source, /import DashboardPageActions(?:,| from)/, `${fileName} imports DashboardPageActions`);
    assert.match(source, /<DashboardPageActions\b/, `${fileName} renders DashboardPageActions`);
    for (const prop of requiredProps) {
      assert.match(source, new RegExp(`${prop}\\s*=`), `${fileName} supplies ${prop} to the shared controls`);
    }
  }
});

test('shared page actions keep one size, order, and semantic identity', () => {
  const source = read('src/components/UI/DashboardPageActions.jsx');
  assert.match(source, /h-10 w-10/);
  assert.match(source, /gap-2/);

  const homePosition = source.indexOf('data-page-action="home"');
  const adminPosition = source.indexOf('data-page-action="admin"');
  const logoutPosition = source.indexOf('data-page-action="logout"');
  assert.ok(homePosition >= 0 && homePosition < adminPosition && adminPosition < logoutPosition);
});

test('App wires a return destination into every routed tool page', () => {
  const source = read('src/App.jsx');
  const routedComponents = [
    'ActivityPage',
    'PhoneControlPage',
    'CustomerSupportPage',
    'AdminPage',
    'ChargeDropsClientSetupPage',
    'PayterPage',
    'PayoutsPage',
    'AccountingPage',
    'UiProfilesPage',
    'AiBoothsPage',
    'ChargerentMediaPage',
    'BindingPage',
    'ProfessionalAgreementPDF',
    'TemplatesPage',
    'RentalsPage',
    'ChargersPage',
    'ReportingPage',
    'AnalyticsPage',
    'TestingPage',
    'KioskEditorPage',
    'ProvisionPage',
  ];

  for (const componentName of routedComponents) {
    const instances = [...source.matchAll(new RegExp(`<${componentName}\\b[\\s\\S]*?\\/>`, 'g'))];
    assert.ok(instances.length > 0, `${componentName} is rendered by App`);
    assert.ok(
      instances.some(({ 0: instance }) => /onNavigateTo(?:Dashboard|Admin)=/.test(instance)),
      `${componentName} receives a dashboard or admin return handler`,
    );
  }
});

test('dashboard navigation distinguishes device management from media control', () => {
  const dashboard = read('src/pages/DashboardPage.jsx');
  const admin = read('src/pages/AdminPage.jsx');
  const deviceIcon = read('src/components/UI/DeviceManagementIcon.jsx');

  assert.match(dashboard, /title="Device Management"/);
  assert.match(dashboard, /<DeviceManagementIcon/);
  assert.match(deviceIcon, /<rect x="1\.5" y="4" width="10" height="12"/);
  assert.match(deviceIcon, /<path d="M14\.25 2\.5v19"/);
  assert.match(deviceIcon, /<rect x="17" y="2\.5" width="9\.5" height="19"/);
  assert.match(admin, /title="Media Control"[\s\S]*?<PhotoIcon/);
});

test('Admin Tools keeps Client profiles visible below the desktop breakpoint', () => {
  const admin = read('src/pages/AdminPage.jsx');
  assert.match(admin, /onClick=\{onNavigateToUiProfiles\} className="inline-flex[^"]*" title="Client profiles"/);
  assert.doesNotMatch(admin, /onClick=\{onNavigateToUiProfiles\} className="[^"]*\bhidden\b/);
});
