import {validateApolloScreenFlow} from './apolloScreens.mjs';

// Shared by the dashboard and Functions so device targeting cannot disagree.
export const PROFILE_SECTIONS = [
  {key: 'kiosk', label: 'Kiosk screen'},
  {key: 'apollo', label: 'Apollo'},
  {key: 'p68', label: 'P68'},
  {key: 'chargerentApp', label: 'Chargerent app'},
  {key: 'admin', label: 'Kiosk access'},
];
export const P68_FIELDS = [
  {key: 'start', label: 'Start'},
  {key: 'wait', label: 'Please wait'},
  {key: 'takeCharger', label: 'Take charger'},
  {key: 'returned', label: 'Returned'},
  {key: 'soldOut', label: 'Sold out'},
];
const locales = ['en', 'fr', 'es'];
const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));
const clean = (value) => String(value ?? '').trim().toUpperCase();
const legacyKeys = {takeCharger: 'takecharger', soldOut: 'soldout'};
const APOLLO_QR_DEFAULT = {enabled: false, provider: 'chargerent-issued', promptTitle: 'Borrow a charger', promptMessage: 'Scan your QR code'};

export function getProfileDeviceTypes(kiosk = {}) {
  const gateway = clean(kiosk.hardware?.gateway);
  const screen = clean(kiosk.hardware?.screen);
  const screenMode = clean(kiosk.screen?.mode);
  // Missing hardware data is unknown, not permission to publish a screen.
  const hasScreen = /^(?:E)?\d+(?:\.\d+)?(?:IN|INCH|INCHES|")?$/.test(screen);
  const hasChargerentApp = kiosk?.profileCapabilities?.chargerentApp === true;
  const hasApolloGateway = gateway === 'APOLLO';
  const hasP68Gateway = gateway === 'PAYTERP68' && screenMode !== 'UI';
  return [
    ...(hasScreen ? ['kiosk'] : []),
    ...(hasChargerentApp ? ['chargerentApp'] : []),
    ...(hasApolloGateway ? ['apollo'] : []),
    ...(hasP68Gateway ? ['p68'] : []),
  ];
}

export function isProfileSectionTarget(kiosk, section) {
  if (section === 'admin') return clean(kiosk?.ui?.mode) === 'UI';
  return getProfileDeviceTypes(kiosk).includes(section);
}

export function readP68Locales(languages = {}) {
  return Object.fromEntries(locales.map((locale) => [locale, Object.fromEntries(P68_FIELDS.map(({key}) => [
    key, languages.locales?.[locale]?.terminals?.PAYTERP68?.[key]
      ?? languages[locale]?.payter?.[legacyKeys[key] || key] ?? '',
  ]))]));
}

export function writeP68Locales(languages, copy) {
  const next = clone(languages);
  const modern = Boolean(next.locales) || !locales.some((locale) => next[locale]);
  if (modern) next.locales ||= {};
  for (const locale of locales) {
    if (modern) {
      next.locales[locale] ||= {};
      next.locales[locale].terminals ||= {};
      next.locales[locale].terminals.PAYTERP68 = clone(copy[locale]);
    }
    // Older runtimes still consume languages.en/fr/es.payter.
    if (!modern || next[locale]) {
      next[locale] ||= {};
      next[locale].payter = Object.fromEntries(P68_FIELDS.map(({key}) => [legacyKeys[key] || key, copy[locale]?.[key] ?? '']));
    }
  }
  return next;
}

export function getTerminalProfileCopy(profile, section) {
  return section === 'p68' ? {locales: readP68Locales(profile?.languages)}
    : {translations: clone(profile?.terminalProfiles?.apollo?.translations),
      ...(profile?.terminalProfiles?.apollo?.template !== undefined ? {template: clone(profile.terminalProfiles.apollo.template)} : {}),
      ...(profile?.terminalProfiles?.apollo?.screenFlow !== undefined ? {screenFlow: clone(profile.terminalProfiles.apollo.screenFlow)} : {}),
      qr: clone(profile?.terminalProfiles?.apollo?.qr || APOLLO_QR_DEFAULT)};
}

export function getChargerentAppProfile(profile) {
  return clone(profile?.applicationProfiles?.chargerentMedia);
}

function validateChargerentAppProfile(copy) {
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error('Chargerent app settings are required.');
  if (JSON.stringify(copy).length > 500000) throw new Error('Chargerent app settings are too large.');
  if (Object.keys(copy).some((key) => !['checkout', 'stripeUi'].includes(key))) throw new Error('Chargerent app settings contain an unsupported field.');
  const checkout = copy.checkout;
  if (!checkout || typeof checkout !== 'object' || Array.isArray(checkout) ||
      Object.keys(checkout).some((key) => !['enabled', 'height'].includes(key)) ||
      typeof checkout.enabled !== 'boolean' || !Number.isFinite(Number(checkout.height)) ||
      Number(checkout.height) < 0.10 || Number(checkout.height) > 0.50) {
    throw new Error('The Chargerent checkout panel must be enabled or disabled and use 10% to 50% of the screen.');
  }
  const stripeUi = copy.stripeUi;
  if (!stripeUi || typeof stripeUi !== 'object' || Array.isArray(stripeUi) || stripeUi.schemaVersion !== 1) {
    throw new Error('A supported Chargerent checkout UI is required.');
  }
  const visit = (node, depth = 0) => {
    if (typeof node === 'string') {
      const hasControlCharacter = [...node].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 && ![9, 10, 13].includes(code);
      });
      if (node.length > 4000 || hasControlCharacter) throw new Error('A Chargerent app text field is invalid.');
      return;
    }
    if (typeof node === 'number' || typeof node === 'boolean' || node === null) return;
    if (!node || typeof node !== 'object' || depth > 7) throw new Error('Chargerent app settings are invalid.');
    for (const [key, child] of Object.entries(node)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Chargerent app settings are invalid.');
      visit(child, depth + 1);
    }
  };
  visit(copy);
}

export function setTerminalProfileCopy(profile, section, stationId, copy) {
  if (stationId) throw new Error(`${section === 'p68' ? 'P68' : 'Apollo'} profiles are client-wide and do not support kiosk overrides.`);
  const next = clone(profile);
  if (section === 'p68') {
    next.languages = writeP68Locales(next.languages, copy.locales);
  } else {
    next.terminalProfiles ||= {};
    next.terminalProfiles[section] ||= {};
    next.terminalProfiles[section].translations = clone(copy.translations);
    if (section === 'apollo' && copy.template !== undefined) next.terminalProfiles[section].template = clone(copy.template);
    if (copy.screenFlow !== undefined) next.terminalProfiles[section].screenFlow = clone(copy.screenFlow);
    if (section === 'apollo') next.terminalProfiles[section].qr = clone(copy.qr || next.terminalProfiles[section].qr || APOLLO_QR_DEFAULT);
  }
  return next;
}

function validateCopy(copy, section) {
  const value = section === 'p68' ? copy?.locales : copy?.translations;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Terminal text is required.');
  if (JSON.stringify(value).length > 100000) throw new Error('Terminal text is too large.');
  const visit = (node, depth = 0) => {
    if (typeof node === 'string') {
      if (node.length > 4000) throw new Error('A terminal text field is too long.');
      return;
    }
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 3) throw new Error('Invalid terminal text.');
    for (const [key, child] of Object.entries(node)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid text field.');
      visit(child, depth + 1);
    }
  };
  visit(value);
  if (section === 'apollo') validateApolloScreenFlow(copy.screenFlow);
  if (section === 'apollo') {
    const qr = copy.qr || {};
    if (typeof qr.enabled !== 'boolean' || !['chargerent-issued', 'external', 'library'].includes(qr.provider)
      || typeof qr.promptTitle !== 'string' || !qr.promptTitle.trim() || qr.promptTitle.length > 120
      || typeof qr.promptMessage !== 'string' || !qr.promptMessage.trim() || qr.promptMessage.length > 240) {
      throw new Error('Apollo QR settings are invalid.');
    }
  }
  if (section === 'p68' && locales.some((locale) => P68_FIELDS.some(({key}) => typeof value[locale]?.[key] !== 'string'))) {
    throw new Error('P68 messages are required in each language.');
  }
}

// A section save never replaces another display's content. Terminal sections
// are client-wide and discard any stale station-level override data.
export function mergeProfileSection(existing, source, section, stationId = '') {
  if (!PROFILE_SECTIONS.some(({key}) => key === section)) throw new Error('Unknown profile section.');
  if (['apollo', 'p68', 'chargerentApp'].includes(section) && stationId) throw new Error(`${section === 'p68' ? 'P68' : section === 'apollo' ? 'Apollo' : 'Chargerent app'} profiles are client-wide and do not support kiosk overrides.`);
  let next = clone(existing);
  if (section === 'chargerentApp') {
    const copy = getChargerentAppProfile(source);
    validateChargerentAppProfile(copy);
    next.applicationProfiles ||= {};
    next.applicationProfiles.chargerentMedia = copy;
  } else if (section === 'apollo' || section === 'p68') {
    const copy = getTerminalProfileCopy(source, section);
    // Older editors may save only text. Removing all screens is represented
    // explicitly by an empty flow, never by an omitted field.
    if (section === 'apollo' && copy.screenFlow === undefined) {
      const previous = getTerminalProfileCopy(existing, section).screenFlow;
      if (previous !== undefined) copy.screenFlow = previous;
    }
    validateCopy(copy, section);
    next = setTerminalProfileCopy(next, section, '', copy);
    // Terminal content is client-wide. Remove stale station-level data left by
    // earlier draft implementations when either terminal section is saved.
    if (next.terminalProfiles?.[section]?.overrides) delete next.terminalProfiles[section].overrides;
  } else if (section === 'admin') {
    next.admin = clone(source.admin);
  } else {
    const p68 = readP68Locales(existing.languages || source.languages);
    next.ui = clone(source.ui);
    next.languages = writeP68Locales(source.languages, p68);
  }
  return next;
}

// Only the selected section reaches a kiosk; terminal copy cannot change its
// touchscreen, provisioning mode, installed version, pricing, or access PINs.
export function buildSectionUiSnapshot(kiosk, profile, section, kioskSnapshot, appliedAt) {
  if (!isProfileSectionTarget(kiosk, section)) throw new Error('Device does not support this profile section.');
  if (section === 'apollo') throw new Error('Apollo publishing is not enabled.');
  if (section === 'chargerentApp') throw new Error('Chargerent app profiles publish through the integrated media service.');
  let ui = clone(kiosk.ui);
  if (section === 'kiosk') {
    ui = clone(kioskSnapshot);
    ui.languages = writeP68Locales(ui.languages, readP68Locales(kiosk.ui?.languages));
  } else if (section === 'p68') {
    ui.languages = writeP68Locales(ui.languages, getTerminalProfileCopy(profile, section).locales);
  }
  ui.profileSections = {
    ...clone(kiosk.ui?.profileSections),
    [section]: {
      profileId: profile.id,
      profileVersion: Number(profile.sectionVersions?.[section] || profile.version || 1),
      appliedAt,
      source: 'client',
    },
  };
  return ui;
}
