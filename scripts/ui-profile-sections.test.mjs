import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSectionUiSnapshot, getProfileDeviceTypes, getTerminalProfileCopy, hasTerminalOverride, isProfileSectionTarget, mergeProfileSection, readP68Locales, setTerminalProfileCopy, writeP68Locales} from '../functions/uiProfileSections.mjs';
import {createDefaultKioskUiProfile} from '../src/utils/kioskUiProfiles.js';
import {normalizeKioskData} from '../src/utils/helpers.js';
import {profileDeviceStatus} from '../src/utils/profileDevices.js';
import {createProfilePreviewApi} from '../src/utils/profilePreview.js';

const profile = () => ({...createDefaultKioskUiProfile('CLIENT'), terminalProfiles: {apollo: {translations: {en: {startpage: {title: 'Welcome'}}}}}});
const kiosk = () => ({stationid: 'K1', hardware: {screen: '7in', gateway: 'PAYTERP68'}, ui: {
  mode: 'PAYTER', version: '43', created: 'installation-date', colors: {bcolor1: 'red'},
  languages: {en: {startpage: {startbutton: 'Existing kiosk'}, payter: {start: 'Existing P68'}}},
}, admin: {userpassword: '12345'}});

test('device types enforce Apollo, P68 and Kiosk access eligibility', () => {
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'APOLLO', screen: 'no screen'}}), ['apollo']);
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'APO', screen: 'no screen'}}), []);
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'PAYTERAPOLLO', screen: 'no screen'}}), []);
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'PAYTERP68', screen: 'NO'}, screen: {mode: 'picture'}}), ['p68']);
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'P68', screen: 'NO'}, screen: {mode: 'picture'}}), []);
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'PAYTERP68', screen: '7in'}, screen: {mode: 'UI'}}), ['kiosk']);
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'PAYTERP68', screen: 'no screen'}, screen: {mode: 'ui'}}), []);
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'PAYTERP68', screen: '7in'}, screen: {mode: 'picture'}, ui: {mode: 'UI'}}), ['kiosk', 'p68']);
  const [normalizedP68Ui] = normalizeKioskData([{stationid: 'P68-UI', hardware: {gateway: 'PAYTERP68', screen: 'no screen'}, screen: {mode: 'UI'}}]);
  assert.equal(normalizedP68Ui.screen.mode, 'UI');
  assert.deepEqual(getProfileDeviceTypes(normalizedP68Ui), []);
  assert.deepEqual(getProfileDeviceTypes(kiosk()), ['kiosk', 'p68']);
  assert.deepEqual(getProfileDeviceTypes({hardware: {gateway: 'APOLLO', screen: 'E32in'}}), ['kiosk', 'apollo']);
  assert.deepEqual(getProfileDeviceTypes({hardware: {screen: '49'}}), ['kiosk']);
  assert.deepEqual(getProfileDeviceTypes({hardware: {}, ui: {mode: 'UI'}}), []);
  assert.equal(isProfileSectionTarget(kiosk(), 'apollo'), false);
  assert.equal(isProfileSectionTarget(kiosk(), 'admin'), false);
  assert.equal(isProfileSectionTarget({ui: {mode: 'UI'}}, 'admin'), true);
  assert.equal(isProfileSectionTarget({ui: {mode: 'ui'}}, 'admin'), true);
  assert.equal(isProfileSectionTarget({ui: {mode: 'media'}}, 'admin'), false);
  assert.equal(isProfileSectionTarget({}, 'admin'), false);
});

test('saving P68 text preserves touchscreen, Apollo, PINs and other overrides', () => {
  const original = profile();
  const originalJson = JSON.stringify(original);
  let source = structuredClone(original);
  source.languages.locales.en.terminals.PAYTERP68.start = 'New P68';
  source.ui.mode = 'wrong';
  source.languages.locales.en.screens.start.startButton = 'Wrong screen';
  source.admin.userpassword = '55555';
  source.terminalProfiles.apollo.translations.en.startpage.title = 'Wrong Apollo';
  const result = mergeProfileSection(original, source, 'p68');
  assert.equal(readP68Locales(result.languages).en.start, 'New P68');
  assert.deepEqual(result.ui, original.ui);
  assert.deepEqual(result.admin, original.admin);
  assert.deepEqual(result.terminalProfiles, original.terminalProfiles);
  assert.deepEqual(result.languages.locales.en.screens, original.languages.locales.en.screens);
  assert.equal(JSON.stringify(original), originalJson);
});

test('saving touchscreen copy preserves P68 text and terminal overrides', () => {
  const original = profile();
  const source = structuredClone(original);
  source.languages.locales.en.screens.start.startButton = 'New kiosk';
  source.languages.locales.en.terminals.PAYTERP68.start = 'Wrong P68';
  const result = mergeProfileSection(original, source, 'kiosk');
  assert.equal(result.languages.locales.en.screens.start.startButton, 'New kiosk');
  assert.deepEqual(readP68Locales(result.languages), readP68Locales(original.languages));
  assert.deepEqual(result.terminalProfiles, original.terminalProfiles);
});

test('Apollo flows are client-wide and kiosk overrides are rejected', () => {
  const original = profile();
  const custom = {translations: {en: {startpage: {title: 'K1 only'}}}};
  assert.throws(() => setTerminalProfileCopy(original, 'apollo', 'K1', custom), /client-wide/);
  assert.throws(() => mergeProfileSection(original, original, 'apollo', 'K1'), /client-wide/);
  const legacy = structuredClone(original);
  legacy.terminalProfiles.apollo.overrides = {K1: custom};
  const result = mergeProfileSection(legacy, original, 'apollo');
  assert.equal(result.terminalProfiles.apollo.overrides, undefined);
  assert.equal(hasTerminalOverride(legacy, 'apollo', 'K1'), false);
  assert.deepEqual(getTerminalProfileCopy(legacy, 'apollo', 'K1'), getTerminalProfileCopy(original, 'apollo'));
});

test('client default edits retain saved kiosk overrides', () => {
  const original = profile();
  const custom = getTerminalProfileCopy(original, 'p68');
  custom.locales.en.start = 'Custom K1';
  const existing = setTerminalProfileCopy(original, 'p68', 'K1', custom);
  const source = structuredClone(existing);
  source.languages.locales.en.terminals.PAYTERP68.start = 'New default';
  const result = mergeProfileSection(existing, source, 'p68');
  assert.equal(getTerminalProfileCopy(result, 'p68', 'K1').locales.en.start, 'Custom K1');
  assert.equal(getTerminalProfileCopy(result, 'p68', 'K2').locales.en.start, 'New default');
});

test('P68 publication preserves installed UI and legacy language representation', () => {
  const target = kiosk();
  const original = structuredClone(target);
  const result = buildSectionUiSnapshot(target, profile(), 'p68', {mode: 'wrong', colors: {}}, 'now');
  assert.equal(result.mode, 'PAYTER');
  assert.equal(result.version, '43');
  assert.equal(result.created, 'installation-date');
  assert.deepEqual(result.colors, target.ui.colors);
  assert.deepEqual(result.languages.en.startpage, target.ui.languages.en.startpage);
  assert.equal(result.languages.en.payter.start, readP68Locales(profile().languages).en.start);
  assert.equal('locales' in result.languages, false);
  assert.equal(result.profileSections.p68.profileId, 'client');
  assert.deepEqual(target, original);
});

test('P68 publication resolves the requested kiosk override', () => {
  const original = profile();
  const copy = getTerminalProfileCopy(original, 'p68');
  copy.locales.en.start = 'K1 custom';
  const saved = setTerminalProfileCopy(original, 'p68', 'K1', copy);
  const result = buildSectionUiSnapshot(kiosk(), saved, 'p68', {}, 'now');
  assert.equal(result.languages.en.payter.start, 'K1 custom');
  assert.equal(result.profileSections.p68.source, 'custom');
});

test('touchscreen publication retains previously applied P68 text and section metadata', () => {
  const target = kiosk();
  target.ui.profileSections = {p68: {profileId: 'old', profileVersion: 7}};
  const snapshot = {mode: target.ui.mode, languages: profile().languages};
  const result = buildSectionUiSnapshot(target, profile(), 'kiosk', snapshot, 'now');
  assert.equal(result.languages.locales.en.terminals.PAYTERP68.start, 'Existing P68');
  assert.deepEqual(result.profileSections.p68, target.ui.profileSections.p68);
});

test('Apollo cannot be published through kiosk commands and incompatible hardware fails closed', () => {
  const apollo = {hardware: {gateway: 'APOLLO', screen: 'no screen'}};
  assert.throws(() => buildSectionUiSnapshot(apollo, profile(), 'apollo', {}, 'now'), /not enabled/);
  assert.throws(() => buildSectionUiSnapshot(apollo, profile(), 'p68', {}, 'now'), /does not support/);
  assert.throws(() => buildSectionUiSnapshot(apollo, profile(), 'kiosk', {}, 'now'), /does not support/);
});

test('Kiosk access publishing is limited to UI-mode kiosks', () => {
  const uiKiosk = kiosk();
  uiKiosk.ui.mode = 'UI';
  const result = buildSectionUiSnapshot(uiKiosk, profile(), 'admin', {}, 'now');
  assert.equal(result.mode, 'UI');
  assert.equal(result.profileSections.admin.profileId, 'client');
  assert.throws(() => buildSectionUiSnapshot(kiosk(), profile(), 'admin', {}, 'now'), /does not support/);
});

test('section validation rejects invalid text and unknown sections', () => {
  const source = profile();
  source.terminalProfiles.apollo.translations.en.startpage.title = {bad: {deeper: 'bad'}};
  assert.throws(() => mergeProfileSection(profile(), source, 'apollo'), /Invalid terminal/);
  assert.throws(() => mergeProfileSection(profile(), profile(), 'unknown'), /Unknown profile section/);
  source.languages.locales.en.terminals.PAYTERP68.start = 42;
  assert.throws(() => mergeProfileSection(profile(), source, 'p68'), /Invalid terminal text/);
});

test('P68 modern language updates preserve unrelated terminal and kiosk content', () => {
  const languages = profile().languages;
  languages.locales.en.terminals.OTHER = {message: 'keep'};
  const result = writeP68Locales(languages, readP68Locales(languages));
  assert.deepEqual(result, languages);
});

test('membership or publish acknowledgement alone is never confirmed device adoption', () => {
  const target = kiosk();
  assert.match(profileDeviceStatus(target, 'p68', profile()), /not published/);
  target.ui.profileSections = {p68: {profileId: 'client', profileVersion: 2}};
  assert.match(profileDeviceStatus(target, 'p68', profile()), /awaiting confirmation/);
  target.reportedUiProfile = {sections: {p68: {status: 'applied', profileId: 'client', profileVersion: 1}}};
  assert.match(profileDeviceStatus(target, 'p68', profile()), /awaiting confirmation/);
  target.reportedUiProfile.sections.p68.profileVersion = 2;
  assert.equal(profileDeviceStatus(target, 'p68', profile()), 'Confirmed loaded');
});

test('the local preview saves only the selected section and cannot publish', async () => {
  const request = createProfilePreviewApi();
  const {profiles} = await request('uiProfile_list', {});
  const source = profiles[1];
  source.languages.locales.en.terminals.PAYTERP68.start = 'Preview only';
  source.ui.mode = 'do not save';
  const saved = await request('uiProfile_upsert', {profile: source, section: 'p68'});
  assert.equal(saved.profile.ui.mode, 'UI');
  assert.equal(saved.profile.languages.locales.en.terminals.PAYTERP68.start, 'Preview only');
  await assert.rejects(request('uiProfile_apply', {}), /disabled/);
});
