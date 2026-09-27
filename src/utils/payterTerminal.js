import {
  YYZ_APOLLO_ESTABLISHED_SCREENS,
  YYZ_APOLLO_PROFILE_TEMPLATE_META,
  YYZ_APOLLO_TRANSLATIONS,
} from '../../functions/apolloProfileTemplate.mjs';

export const PAYTER_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export const PAYTER_UI_PAGES = YYZ_APOLLO_ESTABLISHED_SCREENS;

export const PAYTER_LANGUAGES = [
  {code: 'en', label: 'EN'},
  {code: 'fr', label: 'FR'},
  {code: 'es', label: 'ES'},
];

// Re-export the canonical YYZ seed used by both provisioning and the editor.
export const PAYTER_DEFAULT_TRANSLATIONS_META = YYZ_APOLLO_PROFILE_TEMPLATE_META;
export const PAYTER_DEFAULT_TRANSLATIONS = YYZ_APOLLO_TRANSLATIONS;

const PAGE_FALLBACKS = {
  startpage: {startbutton: 'Start', subtitle: 'Press start', title: 'Welcome'},
  rentpage: {cancel: 'Cancel', infotext: 'Select an option', rentbutton: 'Rent', returnbutton: 'Return'},
  availabilitypage: {subtitle: 'Checking availability...', title: 'Please wait'},
  paymentpage: {subtitle: 'Present Card', title: 'Payment'},
  thankyoupage: {message: 'Success', modulelabel: 'Module', slotlabel: 'Slot', title: 'Thank You'},
  ejectpage: {subtitle: 'Dispensing item...', title: 'Please wait'},
  returnpage: {returntext: 'Please insert item.', returntitle: 'Return Item'},
  returntypage: {message: 'Return Accepted', modulelabel: 'Module', slotlabel: 'Slot', title: 'Thank You'},
  soldoutpage: {subtitle: 'No items available.', title: 'Sold Out'},
  canceledpage: {subtitle: 'Transaction canceled', title: 'Canceled'},
  languagepage: {en: 'English', fr: 'French', es: 'Spanish'},
  nocardpage: {title: 'No Card Detected'},
  offlinemodepage: {message: 'Approved', title: 'Offline Mode'},
  errorpage: {message: 'An unexpected error occurred.', title: 'System Error'},
};

const KNOWN_UI_STATES = new Set(Object.keys(PAGE_FALLBACKS));

function cleanText(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function cleanBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || String(value).toLowerCase() === 'false') return false;
  return fallback;
}

function normalizeLanguage(value) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized.startsWith('fr')) return 'fr';
  if (normalized.startsWith('es')) return 'es';
  return 'en';
}

export function decodePayterText(value) {
  const text = cleanText(value).replace(/\+/g, ' ');
  if (!text.includes('%')) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function normalizePayterUiState(value) {
  const normalized = cleanText(value).toLowerCase().replace(/[\s_-]+/g, '');
  const aliases = {
    start: 'startpage', rent: 'rentpage', availability: 'availabilitypage', payment: 'paymentpage',
    thankyou: 'thankyoupage', eject: 'ejectpage', return: 'returnpage', returnty: 'returntypage',
    returnthankyou: 'returntypage', soldout: 'soldoutpage', canceled: 'canceledpage',
    cancelled: 'canceledpage', language: 'languagepage', nocard: 'nocardpage',
    offlinemode: 'offlinemodepage', offline: 'offlinemodepage', error: 'errorpage',
  };
  const resolved = aliases[normalized] || normalized;
  return KNOWN_UI_STATES.has(resolved) ? resolved : 'startpage';
}

export function payterTimestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
  }
  return 0;
}

export function normalizePayterTerminal(data = {}, documentId = '') {
  const serialNumber = cleanText(data.serialNumber || data.serial || data.terminalSerial || documentId);
  return {
    id: cleanText(data.id || data.terminalId || serialNumber || documentId),
    serialNumber,
    terminalName: cleanText(data.terminalName || data.name || data.locationName) || 'Unknown Name',
    state: cleanText(data.state || data.status) || 'Unknown',
    online: cleanBoolean(data.online, false),
    live: cleanBoolean(data.live, false),
    defaultLanguage: normalizeLanguage(data.defaultLanguage),
    language: normalizeLanguage(data.currentLanguage || data.language || data.defaultLanguage),
    uistate: normalizePayterUiState(data.uistate || data.uiState || data.screen),
    dynamicData: {
      slot: cleanText(data.dynamicData?.slot || data.slot || data.lastSlot),
      module: cleanText(data.dynamicData?.module || data.module || data.lastModule),
    },
    translations: data.translations && typeof data.translations === 'object' ? data.translations : {},
    errorMessage: cleanText(data.errorMessage || data.error),
    updatedAtMs: payterTimestampToMillis(data.updatedAtMs || data.bridgeUpdatedAt || data.updatedAt || data.lastSeenAt || data.timestamp),
  };
}

export function getPayterConnectionState(terminal, now = Date.now()) {
  if (!terminal?.online) return 'offline';
  if (!terminal.updatedAtMs || now - terminal.updatedAtMs > PAYTER_ONLINE_WINDOW_MS) return 'stale';
  return 'online';
}

export function formatPayterRelativeTime(timestampMs, now = Date.now()) {
  if (!timestampMs) return 'No bridge timestamp';
  const elapsedSeconds = Math.max(0, Math.round((now - timestampMs) / 1000));
  if (elapsedSeconds < 10) return 'Just now';
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.round(elapsedHours / 24)}d ago`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function buildPayterTranslations(source = {}) {
  const result = clone(PAYTER_DEFAULT_TRANSLATIONS);
  if (!source || typeof source !== 'object') return result;
  for (const language of PAYTER_LANGUAGES.map(({code}) => code)) {
    const languageData = source[language] || source[language.toUpperCase()];
    if (!languageData || typeof languageData !== 'object') continue;
    for (const [page, fields] of Object.entries(languageData)) {
      if (!fields || typeof fields !== 'object') continue;
      const normalizedPage = normalizePayterUiState(page);
      result[language][normalizedPage] = {
        ...(result[language][normalizedPage] || {}),
        ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodePayterText(value)])),
      };
    }
  }
  return result;
}

export function getPayterPageData(translations, language, page) {
  const normalizedLanguage = normalizeLanguage(language);
  const normalizedPage = normalizePayterUiState(page);
  const fields = buildPayterTranslations(translations)[normalizedLanguage]?.[normalizedPage] || {};
  return {
    ...(PAGE_FALLBACKS[normalizedPage] || {}),
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodePayterText(value)])),
  };
}

export function getPayterScreenModel(terminal = {}, sharedTranslations = {}) {
  const page = normalizePayterUiState(terminal.uistate);
  const language = normalizeLanguage(terminal.language || terminal.defaultLanguage);
  const terminalTranslations = terminal.translations && Object.keys(terminal.translations).length > 0
    ? terminal.translations
    : sharedTranslations;
  const fields = getPayterPageData(terminalTranslations, language, page);
  if (page === 'errorpage' && terminal.errorMessage) fields.message = terminal.errorMessage;
  return {
    page,
    language,
    fields,
    slot: cleanText(terminal.dynamicData?.slot) || 'N/A',
    module: cleanText(terminal.dynamicData?.module) || 'N/A',
  };
}

export function getPayterEditorFields(translations, language, page) {
  return Object.entries(getPayterPageData(translations, language, page))
    .sort(([left], [right]) => left.localeCompare(right));
}

export function payterTerminalMatchesSearch(terminal, searchTerm) {
  const search = cleanText(searchTerm).toLowerCase();
  if (!search) return true;
  return [terminal?.terminalName, terminal?.serialNumber, terminal?.state, terminal?.uistate, terminal?.language]
    .some((value) => cleanText(value).toLowerCase().includes(search));
}
