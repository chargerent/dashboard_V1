import test from 'node:test';
import assert from 'node:assert/strict';
import {APOLLO_SCREEN_LIMIT, buildApolloScreenRequest, createApolloScreen, duplicateApolloScreen, emptyApolloScreenFlow, getApolloScreenContent, removeApolloEstablishedScreen, removeApolloScreen, resolveApolloEstablishedScreen, resolveApolloScreenAction, restoreApolloEstablishedScreen, validateApolloScreenFlow} from '../functions/apolloScreens.mjs';
import {getTerminalProfileCopy, mergeProfileSection, setTerminalProfileCopy} from '../functions/uiProfileSections.mjs';
import {createProfilePreviewApi} from '../src/utils/profilePreview.js';
import {profileSectionContent} from '../src/utils/profileDevices.js';

const flow = () => ({...emptyApolloScreenFlow(), entryScreenId: 'custom_1', screens: [createApolloScreen([])]});

test('message and selection compile to documented CPS shapes with language fallback', () => {
  const draft = flow();
  const screen = draft.screens[0];
  screen.locales.fr.title = 'Bienvenue';
  screen.buttons[0].labels.es = 'Continuar';
  assert.deepEqual(buildApolloScreenRequest(draft, screen.id, 'fr', 'session-screen-1'), {
    id: 'session-screen-1', type: 'message', properties: {
      title: 'Bienvenue', message: 'Follow the instructions, then continue.',
      'buttons.button_1': '', 'buttons.button_1.label': 'Continue',
    },
  });
  screen.type = 'selection';
  assert.deepEqual(buildApolloScreenRequest(draft, screen.id, 'es'), {
    id: 'custom_1', type: 'selection', properties: {title: 'Before you start', 'items.button_1.label': 'Continuar'},
  });
  assert.equal(getApolloScreenContent(screen, 'de').title, screen.locales.en.title);
});

test('screen buttons route between screens and exit into existing flow without payment commands', () => {
  const draft = flow();
  draft.screens.push(createApolloScreen(draft.screens, 'selection'));
  draft.screens[0].buttons[0].next = 'custom_2';
  assert.deepEqual(resolveApolloScreenAction(draft, 'custom_1', 'button_1'), {action: 'show_screen', screenId: 'custom_2'});
  assert.deepEqual(resolveApolloScreenAction(draft, 'custom_2', 'button_1'), {action: 'continue_existing_flow'});
  draft.screens[1].buttons[0].next = '$home';
  assert.deepEqual(resolveApolloScreenAction(draft, 'custom_2', 'button_1'), {action: 'return_to_start'});
  assert.throws(() => resolveApolloScreenAction(draft, 'custom_2', 'authorize'), /Unknown/);
  assert.throws(() => resolveApolloScreenAction(draft, 'paymentpage', 'button_1'), /Unknown/);
});

test('rejects missing destinations, invalid entry points and closed navigation loops', () => {
  const draft = flow();
  draft.screens[0].buttons[0].next = 'paymentpage';
  assert.throws(() => validateApolloScreenFlow(draft), /missing screen/);
  draft.screens[0].buttons[0].next = 'custom_1';
  assert.throws(() => validateApolloScreenFlow(draft), /customers can leave/);
  draft.screens[0].buttons.push({id: 'button_2', labels: {en: 'Back', fr: '', es: ''}, next: '$home'});
  assert.doesNotThrow(() => validateApolloScreenFlow(draft));
  draft.entryScreenId = 'missing';
  assert.throws(() => validateApolloScreenFlow(draft), /first screen/);
});

test('all branches must have an escape, including disconnected draft screens', () => {
  const draft = flow();
  draft.screens.push(createApolloScreen(draft.screens));
  draft.screens.push(createApolloScreen(draft.screens));
  draft.screens[1].buttons[0].next = 'custom_3';
  draft.screens[2].buttons[0].next = 'custom_2';
  assert.throws(() => validateApolloScreenFlow(draft), /customers can leave/);
  draft.screens[2].buttons[0].next = '$continue';
  assert.doesNotThrow(() => validateApolloScreenFlow(draft));
});

test('deleting a referenced screen is blocked, while deleting the entry restores the existing flow', () => {
  const draft = flow();
  draft.screens.push(createApolloScreen(draft.screens));
  draft.screens[0].buttons[0].next = 'custom_2';
  assert.throws(() => removeApolloScreen(draft, 'custom_2'), /buttons linking/);
  const removed = removeApolloScreen(draft, 'custom_1');
  assert.equal(removed.entryScreenId, '');
  assert.equal(removed.screens.length, 1);
  assert.equal(draft.screens.length, 2);
});

test('removes and restores optional established screens without deleting their business events', () => {
  const original = emptyApolloScreenFlow();
  const withoutLanguage = removeApolloEstablishedScreen(original, 'languagepage');
  const withoutLanguageOrPaymentComplete = removeApolloEstablishedScreen(withoutLanguage, 'thankyoupage');
  assert.deepEqual(withoutLanguageOrPaymentComplete.removedEstablishedScreenIds, ['languagepage', 'thankyoupage']);
  assert.equal(resolveApolloEstablishedScreen(withoutLanguageOrPaymentComplete, 'languagepage'), 'startpage');
  assert.equal(resolveApolloEstablishedScreen(withoutLanguageOrPaymentComplete, 'availabilitypage'), 'availabilitypage');
  assert.equal(resolveApolloEstablishedScreen(withoutLanguageOrPaymentComplete, 'thankyoupage'), 'startpage');
  assert.deepEqual(restoreApolloEstablishedScreen(withoutLanguageOrPaymentComplete, 'languagepage').removedEstablishedScreenIds, ['thankyoupage']);
  assert.deepEqual(original.removedEstablishedScreenIds, []);
});

test('required and unknown established screens cannot be removed and malformed removals are rejected', () => {
  for (const screenId of ['startpage', 'rentpage', 'availabilitypage', 'paymentpage', 'ejectpage', 'returnpage']) {
    assert.throws(() => removeApolloEstablishedScreen(emptyApolloScreenFlow(), screenId), /required/);
  }
  assert.throws(() => removeApolloEstablishedScreen(emptyApolloScreenFlow(), 'missingpage'), /not found/);
  const duplicate = {...emptyApolloScreenFlow(), removedEstablishedScreenIds: ['languagepage', 'languagepage']};
  assert.throws(() => validateApolloScreenFlow(duplicate), /unique/);
  const unknown = {...emptyApolloScreenFlow(), removedEstablishedScreenIds: ['errorpage']};
  assert.throws(() => validateApolloScreenFlow(unknown), /unknown/);
  const legacy = {version: 1, entryScreenId: '', screens: []};
  assert.doesNotThrow(() => validateApolloScreenFlow(legacy));
  assert.equal(resolveApolloEstablishedScreen(legacy, 'languagepage'), 'languagepage');
});

test('duplicates have independent stable IDs, localized content and self links', () => {
  const draft = flow();
  draft.screens[0].buttons.push({id: 'button_2', labels: {en: 'Again', fr: 'Encore', es: ''}, next: 'custom_1'});
  const duplicated = duplicateApolloScreen(draft, 'custom_1');
  assert.equal(duplicated.screens[1].id, 'custom_2');
  assert.equal(duplicated.screens[1].buttons[1].next, 'custom_2');
  duplicated.screens[1].locales.en.title = 'Different';
  assert.notEqual(draft.screens[0].locales.en.title, 'Different');
  assert.equal(duplicated.entryScreenId, 'custom_1');
});

test('rejects malformed, unsupported or oversized screen content', () => {
  const changes = [
    (d) => {d.version = 2;},
    (d) => {d.screens[0].type = 'html';},
    (d) => {d.screens[0].locales.en.title = '';},
    (d) => {d.screens[0].locales.en.message = 'a'.repeat(601);},
    (d) => {d.screens[0].buttons = [];},
    (d) => {d.screens[0].buttons[0].labels.en = '';},
    (d) => {d.screens[0].buttons[0].id = '__proto__';},
    (d) => {d.screens[0].callbackUrl = 'https://example.com';},
    (d) => {d.screens[0].buttons[0].amount = 100;},
    (d) => {d.screens.push(structuredClone(d.screens[0]));},
    (d) => {d.screens[0].buttons.push(structuredClone(d.screens[0].buttons[0]));},
    (d) => {d.screens[0].locales.fr = null;},
  ];
  for (const change of changes) {const draft = flow(); change(draft); assert.throws(() => validateApolloScreenFlow(draft));}
  const screens = [];
  while (screens.length < APOLLO_SCREEN_LIMIT) screens.push(createApolloScreen(screens));
  assert.throws(() => createApolloScreen(screens), /up to/);
  assert.doesNotThrow(() => validateApolloScreenFlow(undefined));
  assert.doesNotThrow(() => validateApolloScreenFlow(emptyApolloScreenFlow()));
});

test('screen flows survive client-wide section saves and text edits in the actual preview store', async () => {
  const request = createProfilePreviewApi();
  const {profiles, capabilities} = await request('uiProfile_list');
  assert.equal(capabilities.apolloScreens, 1);
  assert.equal(capabilities.apolloEstablishedScreenRemoval, 1);
  const original = profiles[0];
  assert.equal(original.terminalProfiles.apollo.template.id, 'yyz-apollo-v1');
  const customizedFlow = removeApolloEstablishedScreen(flow(), 'languagepage');
  let draft = setTerminalProfileCopy(original, 'apollo', '', {translations: {}, screenFlow: customizedFlow});
  assert.notDeepEqual(profileSectionContent(draft, 'apollo'), profileSectionContent(original, 'apollo'));
  let {profile: saved} = await request('uiProfile_upsert', {profile: draft, section: 'apollo'});
  assert.deepEqual(saved.terminalProfiles.apollo.screenFlow, customizedFlow);
  assert.deepEqual(saved.languages, original.languages);
  assert.throws(() => setTerminalProfileCopy(saved, 'apollo', 'DEMO-A01', getTerminalProfileCopy(saved, 'apollo')), /client-wide/);
  const legacyTextEdit = setTerminalProfileCopy({}, 'apollo', '', {translations: {en: {startpage: {title: 'New text'}}}});
  saved = mergeProfileSection(saved, legacyTextEdit, 'apollo');
  assert.deepEqual(getTerminalProfileCopy(saved, 'apollo').screenFlow, customizedFlow);
  assert.deepEqual(getTerminalProfileCopy(saved, 'apollo', 'DEMO-A01'), getTerminalProfileCopy(saved, 'apollo'));
  assert.deepEqual(getTerminalProfileCopy(mergeProfileSection(saved, setTerminalProfileCopy(saved, 'apollo', '', {translations: {}, screenFlow: emptyApolloScreenFlow()}), 'apollo'), 'apollo').screenFlow.screens, []);
  await assert.rejects(request('uiProfile_apply', {section: 'apollo'}), /disabled/);
});
