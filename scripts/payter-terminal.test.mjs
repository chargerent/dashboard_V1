import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {
  buildPayterTranslations,
  decodePayterText,
  formatPayterRelativeTime,
  getPayterConnectionState,
  getPayterPageData,
  getPayterScreenModel,
  normalizePayterTerminal,
  normalizePayterUiState,
  PAYTER_DEFAULT_TRANSLATIONS_META,
  PAYTER_UI_PAGES,
  payterTerminalMatchesSearch,
  payterTimestampToMillis,
} from '../src/utils/payterTerminal.js';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/pages/PayterPage.jsx', import.meta.url), 'utf8');
const pageStyles = readFileSync(new URL('../src/pages/PayterPage.css', import.meta.url), 'utf8');
const profileEditorSource = readFileSync(new URL('../src/components/profiles/ApolloProfileEditor.jsx', import.meta.url), 'utf8');
const rulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('exposes the complete verified Apollo screen inventory in the profile editor', () => {
  assert.equal(PAYTER_UI_PAGES.length, 13);
  assert.ok(PAYTER_UI_PAGES.every(({key, displayLabel}) => key.endsWith('page') && displayLabel));
  assert.deepEqual(PAYTER_UI_PAGES.filter(({removable}) => !removable).map(({key}) => key), ['startpage', 'rentpage', 'availabilitypage', 'paymentpage', 'ejectpage', 'returnpage']);
  assert.deepEqual(PAYTER_DEFAULT_TRANSLATIONS_META, {
    id: 'yyz-apollo-v1',
    source: 'YYZ Apollo flow (Canada Node-RED shared runtime)',
    verifiedAt: '2026-09-07',
  });
  assert.match(profileEditorSource, /aria-label="Established Apollo screens"/);
  assert.match(profileEditorSource, />Established screens</);
  assert.match(profileEditorSource, />Added screens</);
  assert.match(profileEditorSource, />Remove from flow</);
  assert.match(profileEditorSource, />Removed screens</);
  assert.match(profileEditorSource, /Verified legacy baseline loaded/);
  assert.doesNotMatch(profileEditorSource, /aria-label="Apollo screen"/);
});

test('normalizes the terminal state contract produced by the Node-RED bridge', () => {
  const terminal = normalizePayterTerminal({
    terminalId: 'terminal-one',
    serial: 'SERIAL-1',
    name: 'Lobby',
    status: 'ready',
    online: 'true',
    live: 1,
    defaultLanguage: 'EN',
    currentLanguage: 'fr-CA',
    uiState: 'ThankYouPage',
    slot: 4,
    updatedAt: {seconds: 1_000, nanoseconds: 500_000_000},
  });

  assert.equal(terminal.id, 'terminal-one');
  assert.equal(terminal.serialNumber, 'SERIAL-1');
  assert.equal(terminal.terminalName, 'Lobby');
  assert.equal(terminal.online, true);
  assert.equal(terminal.live, true);
  assert.equal(terminal.language, 'fr');
  assert.equal(terminal.uistate, 'thankyoupage');
  assert.equal(terminal.dynamicData.slot, '4');
  assert.equal(terminal.updatedAtMs, 1_000_500);
});

test('normalizes every legacy page suffix and safe fallback', () => {
  assert.equal(normalizePayterUiState('Startpage'), 'startpage');
  assert.equal(normalizePayterUiState('Offline_Mode_Page'), 'offlinemodepage');
  assert.equal(normalizePayterUiState('ReturnThankYou'), 'returntypage');
  assert.equal(normalizePayterUiState('unexpected-state'), 'startpage');
});

test('marks stale state separately from an explicitly offline terminal', () => {
  const now = 1_000_000;
  assert.equal(getPayterConnectionState({online: false, updatedAtMs: now}, now), 'offline');
  assert.equal(getPayterConnectionState({online: true, updatedAtMs: 0}, now), 'stale');
  assert.equal(getPayterConnectionState({online: true, updatedAtMs: now - 10_000}, now), 'online');
  assert.equal(getPayterConnectionState({online: true, updatedAtMs: now - 300_000}, now), 'stale');
  assert.equal(formatPayterRelativeTime(now - 65_000, now), '1m ago');
});

test('uses bridged translations, decodes Node-RED text, and preserves missing defaults', () => {
  const translations = buildPayterTranslations({
    FR: {PaymentPage: {title: 'Présentez%20votre%20carte'}},
  });
  const fields = getPayterPageData(translations, 'fr-CA', 'payment');
  assert.equal(fields.title, 'Présentez votre carte');
  assert.equal(fields.subtitle, 'Autorisation uniquement');
  assert.equal(decodePayterText('Tap%20your%20card'), 'Tap your card');
});

test('adds dynamic slot information without injecting HTML', () => {
  const model = getPayterScreenModel({
    uistate: 'returntypage',
    dynamicData: {slot: '<img src=x onerror=alert(1)>', module: '1'},
  });
  assert.equal(model.slot, '<img src=x onerror=alert(1)>');
  assert.doesNotMatch(pageSource, /dangerouslySetInnerHTML|ng-bind-html|iframe/i);
});

test('recreates both exact Payter terminal display sizes from the live UI', () => {
  assert.match(pageStyles, /\.payter-device\s*\{[\s\S]*?width:\s*450px;[\s\S]*?height:\s*600px;/);
  assert.match(pageStyles, /\.payter-device\.compact\s*\{[\s\S]*?width:\s*225px;[\s\S]*?height:\s*300px;/);
  assert.match(pageStyles, /\.payter-screen\s*\{[\s\S]*?width:\s*320px;[\s\S]*?height:\s*480px;/);
  assert.match(pageStyles, /\.compact \.payter-screen\s*\{[\s\S]*?width:\s*160px;[\s\S]*?height:\s*240px;/);
});

test('searches terminal metadata and converts timestamps', () => {
  const terminal = normalizePayterTerminal({serialNumber: 'ABC-123', terminalName: 'Main Lobby'});
  assert.equal(payterTerminalMatchesSearch(terminal, 'lobby'), true);
  assert.equal(payterTerminalMatchesSearch(terminal, 'abc'), true);
  assert.equal(payterTerminalMatchesSearch(terminal, 'missing'), false);
  assert.equal(payterTimestampToMillis('2026-01-01T00:00:00.000Z'), 1_767_225_600_000);
});

test('keeps Payter access behind existing Firebase admin authorization', () => {
  assert.match(appSource, /case 'payter':/);
  assert.match(appSource, /if \(!clientInfo\.isAdmin\)/);
  assert.match(pageSource, /onSnapshot\(collection\(db, 'payterTerminals'\)/);
  assert.match(rulesSource, /match \/payterTerminals\/\{docId\}/);
  assert.match(rulesSource, /allow read: if isAdmin\(\)/);
  assert.match(rulesSource, /allow write: if false/);
});
