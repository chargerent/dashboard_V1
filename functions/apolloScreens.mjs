// Shared draft model, CPS payload builder and navigation resolver. No network or
// payment commands. Runtime activation still requires the Apollo bridge.
import {YYZ_APOLLO_ESTABLISHED_SCREENS} from './apolloProfileTemplate.mjs';

export const APOLLO_SCREEN_LAYOUTS = [
  {key: 'message', label: 'Message', description: 'Instructions with up to three buttons.'},
  {key: 'selection', label: 'Selection', description: 'A question with up to three choices.'},
];
export const APOLLO_SCREEN_EXITS = [
  {key: '$continue', label: 'Continue to rent / return'},
  {key: '$home', label: 'Return to Start'},
];
// Editor limits, not advertised Payter hardware limits.
export const APOLLO_SCREEN_LIMIT = 24;
export const APOLLO_BUTTON_LIMIT = 3;
const languages = ['en', 'fr', 'es'];
const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isExit = (id) => APOLLO_SCREEN_EXITS.some(({key}) => key === id);
const establishedScreens = new Map(YYZ_APOLLO_ESTABLISHED_SCREENS.map((screen) => [screen.key, screen]));
export const emptyApolloScreenFlow = () => ({version: 1, entryScreenId: '', screens: [], removedEstablishedScreenIds: []});

export function getRemovedApolloEstablishedScreenIds(flow) {
  return Array.isArray(flow?.removedEstablishedScreenIds) ? flow.removedEstablishedScreenIds : [];
}

export function removeApolloEstablishedScreen(flow, screenId) {
  const screen = establishedScreens.get(screenId);
  if (!screen) throw new Error('Established screen not found.');
  if (!screen.removable) throw new Error(`${screen.displayLabel} is required for the Apollo customer flow.`);
  const removed = new Set(getRemovedApolloEstablishedScreenIds(flow));
  removed.add(screenId);
  const next = {...clone(flow), removedEstablishedScreenIds: [...removed]};
  validateApolloScreenFlow(next);
  return next;
}

export function restoreApolloEstablishedScreen(flow, screenId) {
  if (!establishedScreens.has(screenId)) throw new Error('Established screen not found.');
  return {...clone(flow), removedEstablishedScreenIds: getRemovedApolloEstablishedScreenIds(flow).filter((id) => id !== screenId)};
}

// Runtime-facing resolver for presentation states. Removing a screen never
// removes its payment, inventory, dispense or return event; it only selects the
// next safe display state. Fallback chains are resolved defensively.
export function resolveApolloEstablishedScreen(flow, screenId) {
  const removed = new Set(getRemovedApolloEstablishedScreenIds(flow));
  let current = screenId;
  const visited = new Set();
  while (removed.has(current)) {
    if (visited.has(current)) throw new Error('Removed established screens contain a fallback loop.');
    visited.add(current);
    const fallback = establishedScreens.get(current)?.removeFallback;
    if (!fallback) throw new Error('Removed established screen has no safe fallback.');
    current = fallback;
  }
  return current;
}

export function createApolloScreen(screens, type = 'message') {
  if (!APOLLO_SCREEN_LAYOUTS.some(({key}) => key === type)) throw new Error('Choose a supported screen layout.');
  if (screens.length >= APOLLO_SCREEN_LIMIT) throw new Error(`A profile can contain up to ${APOLLO_SCREEN_LIMIT} added screens.`);
  let number = 1;
  while (screens.some(({id}) => id === `custom_${number}`)) number++;
  return {
    id: `custom_${number}`, name: `New ${type} screen`, type,
    locales: {en: {title: type === 'message' ? 'Before you start' : 'Choose an option', message: type === 'message' ? 'Follow the instructions, then continue.' : ''}, fr: {title: '', message: ''}, es: {title: '', message: ''}},
    buttons: [{id: 'button_1', labels: {en: 'Continue', fr: '', es: ''}, next: '$continue'}],
  };
}

export function duplicateApolloScreen(flow, screenId) {
  const source = flow.screens.find(({id}) => id === screenId);
  if (!source) throw new Error('Screen not found.');
  const {id} = createApolloScreen(flow.screens, source.type);
  const duplicate = {...clone(source), id, name: `${source.name.slice(0, 73)} (copy)`};
  duplicate.buttons = duplicate.buttons.map((button) => ({...button, next: button.next === screenId ? id : button.next}));
  return {...clone(flow), screens: [...flow.screens, duplicate]};
}

export function removeApolloScreen(flow, screenId) {
  const incoming = flow.screens.filter((screen) => screen.id !== screenId && screen.buttons.some(({next}) => next === screenId));
  if (incoming.length) throw new Error(`Change the buttons linking from ${incoming.map(({name}) => name).join(', ')} before deleting this screen.`);
  return {...clone(flow), entryScreenId: flow.entryScreenId === screenId ? '' : flow.entryScreenId, screens: flow.screens.filter(({id}) => id !== screenId)};
}

export function validateApolloScreenFlow(flow) {
  if (flow === undefined) return; // Existing profiles have no added screens.
  const object = (value, keys, label) => {
    if (!isObject(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`Invalid ${label}.`);
  };
  const text = (value, max, label, required = false) => {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label} ${required ? 'is required and ' : ''}must be at most ${max} characters.`);
  };
  object(flow, ['version', 'entryScreenId', 'screens', 'removedEstablishedScreenIds'], 'screen flow');
  if (flow.version !== 1) throw new Error('Unsupported screen flow version.');
  if (!Array.isArray(flow.screens) || flow.screens.length > APOLLO_SCREEN_LIMIT) throw new Error(`Use up to ${APOLLO_SCREEN_LIMIT} added screens.`);
  if (JSON.stringify(flow).length > 100000) throw new Error('Added screen content is too large.');
  text(flow.entryScreenId, 64, 'First screen');
  const removedEstablishedScreenIds = getRemovedApolloEstablishedScreenIds(flow);
  if (flow.removedEstablishedScreenIds !== undefined && !Array.isArray(flow.removedEstablishedScreenIds)) throw new Error('Removed established screens must be a list.');
  if (new Set(removedEstablishedScreenIds).size !== removedEstablishedScreenIds.length) throw new Error('Removed established screens must be unique.');
  for (const screenId of removedEstablishedScreenIds) {
    text(screenId, 64, 'Removed established screen', true);
    const screen = establishedScreens.get(screenId);
    if (!screen) throw new Error('Removed established screen is unknown.');
    if (!screen.removable) throw new Error(`${screen.displayLabel} is required for the Apollo customer flow.`);
    resolveApolloEstablishedScreen(flow, screenId);
  }
  const ids = new Set();
  for (const screen of flow.screens) {
    object(screen, ['id', 'name', 'type', 'locales', 'buttons'], 'screen');
    if (typeof screen.id !== 'string' || !/^custom_[a-z0-9_]{1,48}$/.test(screen.id) || ids.has(screen.id)) throw new Error('Screen identifiers must be unique.');
    ids.add(screen.id);
    text(screen.name, 80, 'Screen name', true);
    if (!APOLLO_SCREEN_LAYOUTS.some(({key}) => key === screen.type)) throw new Error(`${screen.name}: choose Message or Selection.`);
    object(screen.locales, languages, 'screen languages');
    for (const language of languages) {
      const locale = screen.locales[language];
      object(locale, ['title', 'message'], 'screen text');
      text(locale.title, 120, `${screen.name}: ${language.toUpperCase()} title`, language === 'en');
      text(locale.message, 600, `${screen.name}: ${language.toUpperCase()} message`);
    }
    if (!Array.isArray(screen.buttons) || !screen.buttons.length || screen.buttons.length > APOLLO_BUTTON_LIMIT) throw new Error(`${screen.name}: add between one and three buttons.`);
    const buttonIds = new Set();
    for (const button of screen.buttons) {
      object(button, ['id', 'labels', 'next'], 'screen button');
      if (typeof button.id !== 'string' || !/^button_[a-z0-9_]{1,32}$/.test(button.id) || buttonIds.has(button.id)) throw new Error(`${screen.name}: button identifiers must be unique.`);
      buttonIds.add(button.id);
      object(button.labels, languages, 'button languages');
      for (const language of languages) text(button.labels[language], 60, `${screen.name}: ${language.toUpperCase()} button label`, language === 'en');
      text(button.next, 64, `${screen.name}: button destination`, true);
    }
  }
  if (flow.entryScreenId && !ids.has(flow.entryScreenId)) throw new Error('Choose an existing first screen.');
  for (const screen of flow.screens) {
    if (screen.buttons.some(({next}) => !isExit(next) && !ids.has(next))) throw new Error(`${screen.name}: a button links to a missing screen.`);
  }
  // Every screen must have a way back to the established flow. Cycles with an
  // exit are allowed; closed loops and stranded branches cannot be saved.
  const escapable = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const screen of flow.screens) {
      if (!escapable.has(screen.id) && screen.buttons.some(({next}) => isExit(next) || escapable.has(next))) {
        escapable.add(screen.id);
        changed = true;
      }
    }
  }
  const trapped = flow.screens.find(({id}) => !escapable.has(id));
  if (trapped) throw new Error(`${trapped.name}: add a route to rent / return or Start so customers can leave this screen.`);
}

export function getApolloScreenFlowError(flow) {
  try {validateApolloScreenFlow(flow); return '';}
  catch (error) {return error.message;}
}

export function getApolloScreenContent(screen, language = 'en') {
  const localized = screen.locales[language] || {};
  const fallback = screen.locales.en;
  return {
    title: localized.title?.trim() ? localized.title : fallback.title,
    message: localized.message?.trim() ? localized.message : fallback.message,
    buttons: screen.buttons.map((button) => ({...button, label: button.labels[language]?.trim() ? button.labels[language] : button.labels.en})),
  };
}

// Matches POST /terminals/{serialNumber}/ui. `id` may be a session-specific
// correlation ID supplied by the eventual adapter; screen IDs remain stable.
export function buildApolloScreenRequest(flow, screenId, language = 'en', requestId = screenId) {
  validateApolloScreenFlow(flow);
  const screen = flow.screens.find(({id}) => id === screenId);
  if (!screen) throw new Error('Screen not found.');
  const content = getApolloScreenContent(screen, language);
  const properties = {title: content.title};
  if (screen.type === 'message') properties.message = content.message;
  for (const button of content.buttons) {
    const key = `${screen.type === 'message' ? 'buttons' : 'items'}.${button.id}`;
    if (screen.type === 'message') properties[key] = '';
    properties[`${key}.label`] = button.label;
  }
  return {id: requestId, type: screen.type, properties};
}

// These are navigation intents, never authorization, payment or dispense calls.
// The runtime must correlate/deduplicate callbacks and pin a validated profile
// version to the active session before invoking this resolver.
export function resolveApolloScreenAction(flow, screenId, response) {
  validateApolloScreenFlow(flow);
  const screen = flow.screens.find(({id}) => id === screenId);
  const button = screen?.buttons.find(({id}) => id === response);
  if (!button) throw new Error('Unknown screen or button response.');
  if (button.next === '$continue') return {action: 'continue_existing_flow'};
  if (button.next === '$home') return {action: 'return_to_start'};
  return {action: 'show_screen', screenId: button.next};
}
