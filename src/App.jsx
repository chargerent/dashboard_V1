// src/App.jsx
import { Suspense, lazy, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useIdleTimer } from './hooks/useIdleTimer';
import InactivityModal from './components/InactivityModal';
import { subscribeUserToPush } from './push';

import { translations } from './utils/translations';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage.jsx';
import { isKioskOnline, isNewSchemaKiosk, isV2Kiosk, normalizeKioskData, normalizeKioskInfoForSchema } from './utils/helpers.js';
import { callFunctionWithAuth } from './utils/callableRequest.js';
import {
  applyRefundConfirmationToRental,
  isPendingRefundStatus,
  isSuccessfulRefundStatus,
  rentalMatchesRefundConfirmation,
} from './utils/rentals.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// 🔥 firebase-config must export BOTH db and auth
import { db, auth } from './firebase-config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, query, where } from 'firebase/firestore';

const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const KioskEditorPage = lazy(() => import('./pages/KioskEditorPage.jsx'));
const RentalsPage = lazy(() => import('./pages/RentalsPage.jsx'));
const ChargersPage = lazy(() => import('./pages/ChargersPage.jsx'));
const ProvisionPage = lazy(() => import('./pages/ProvisionPage.jsx'));
const ProfessionalAgreementPDF = lazy(() => import('./pages/AgreementPage.jsx'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx'));
const ReportingPage = lazy(() => import('./pages/ReportingPage.jsx'));
const BindingPage = lazy(() => import('./pages/BindingPage.jsx'));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage.jsx'));
const TestingPage = lazy(() => import('./pages/TestingPage.jsx'));
const MediaPage = lazy(() => import('./pages/MediaPage.jsx'));
const UiProfilesPage = lazy(() => import('./pages/UiProfilesPage.jsx'));
const AiBoothsPage = lazy(() => import('./pages/AiBoothsPage.jsx'));
const PayoutsPage = lazy(() => import('./pages/PayoutsPage.jsx'));

function moduleMatchesResponse(module, moduleRef) {
  const moduleId = String(module?.id || '').trim();
  const responseId = String(moduleRef || '').trim();

  if (!moduleId || !responseId) return false;
  if (moduleId === responseId) return true;

  return moduleId.split('m').pop() === responseId.split('m').pop();
}

function findMatchingModule(modules, moduleRef, chargerId) {
  const moduleList = Array.isArray(modules) ? modules : [];
  const numericChargerId = Number(chargerId);

  const directMatch = moduleList.find((module) => moduleMatchesResponse(module, moduleRef));
  if (directMatch) return directMatch;

  if (!Number.isFinite(numericChargerId)) return null;

  return moduleList.find((module) =>
    Array.isArray(module?.slots) &&
    module.slots.some((slot) => Number(slot?.sn) === numericChargerId)
  ) || null;
}

function findMatchingSlot(module, slotRef, chargerId) {
  const slots = Array.isArray(module?.slots) ? module.slots : [];
  const numericSlotId = Number(slotRef);
  const numericChargerId = Number(chargerId);

  if (Number.isFinite(numericSlotId)) {
    const directSlot = slots.find((slot) => Number(slot?.position) === numericSlotId);
    if (directSlot) return directSlot;
  }

  if (!Number.isFinite(numericChargerId)) return null;

  return slots.find((slot) => Number(slot?.sn) === numericChargerId) || null;
}

function slotStateMatchesResponse(slotState, stationId, moduleRef, slotRef, chargerId = null) {
  if (!slotState || slotState.stationid !== stationId) return false;

  const normalizedModuleRef = String(moduleRef || '').trim();
  const numericSlotId = Number(slotRef);
  const numericChargerId = Number(chargerId);
  const hasModuleRef = normalizedModuleRef !== '';
  const hasSlotRef = Number.isFinite(numericSlotId);
  const hasChargerRef = Number.isFinite(numericChargerId) && numericChargerId > 0;

  if (hasModuleRef) {
    if (!moduleMatchesResponse({ id: slotState.moduleid }, normalizedModuleRef)) return false;
    if (hasSlotRef && Number(slotState.slotid) !== numericSlotId) return false;
    if (hasChargerRef) {
      const trackedChargerId = Number(slotState.chargerid);
      if (Number.isFinite(trackedChargerId) && trackedChargerId > 0) {
        return trackedChargerId === numericChargerId;
      }
    }
    return true;
  }

  if (!hasChargerRef) return false;

  const trackedChargerId = Number(slotState.chargerid);
  return Number.isFinite(trackedChargerId) && trackedChargerId > 0 && trackedChargerId === numericChargerId;
}

function getTrackedSlotKey(slotState) {
  return `${slotState.stationid}-${slotState.moduleid}-${Number(slotState.slotid)}`;
}

function slotLooksEmpty(slot) {
  if (!slot) return true;

  const numericSn = Number(slot?.sn ?? 0);
  const numericStatus = Number(slot?.status);
  return !slot.isSstatError && (
    slot.sstat === '0C' ||
    numericSn === 0 ||
    (Number.isFinite(numericStatus) && numericStatus === 0)
  );
}

function getSlotDedupQuality(slot) {
  if (!slot) return 0;

  const chargerSn = String(slot?.sn ?? '').trim();
  if (!chargerSn || /^0+$/.test(chargerSn)) return 0;

  const batteryLevel = Number(slot?.batteryLevel);
  const sstat = String(slot?.sstat || '').trim().toUpperCase();
  let quality = 10;

  if (sstat === '0F') quality += 20;
  if (sstat === '0E') quality -= 10;
  if (slotLooksEmpty(slot)) quality -= 20;
  if (Number.isFinite(batteryLevel) && batteryLevel > 0) quality += 10;
  if (slot?.isSstatError) quality -= 5;

  return quality;
}

function createCommandRequestId(action, stationid, moduleid) {
  const prefix = String(action || 'command').replace(/\s+/g, '-').toLowerCase();
  const targetStation = String(stationid || 'unknown').trim() || 'unknown';
  const targetModule = String(moduleid || 'na').trim() || 'na';
  const randomSegment = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${targetStation}-${targetModule}-${Date.now()}-${randomSegment}`;
}

function normalizeCommandScopeId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return normalizeCommandScopeId(value.id || value.socketId || value.socketid || value.sessionId || value.sessionid);
  }
  return String(value).trim();
}

function collectCommandScopeIds(source, fields) {
  if (!source || typeof source !== 'object') return [];

  return fields
    .map((field) => normalizeCommandScopeId(source[field]))
    .filter(Boolean);
}

function getCommandResponseRequestIds(data) {
  const requestIdFields = ['requestId', 'requestid', 'commandRequestId', 'bulkRequestId', 'parentRequestId'];
  const sources = [data, data?.payload, data?.data, data?.command].filter(Boolean);
  return [...new Set(sources.flatMap((source) => collectCommandScopeIds(source, requestIdFields)))];
}

function getCommandResponseAdminId(data) {
  const adminFields = ['admin', '_session', 'socketId', 'socketid', 'sessionId', 'sessionid', 'clientSocketId'];
  const sources = [data, data?.payload, data?.data, data?.command].filter(Boolean);
  const [adminId = ''] = sources.flatMap((source) => collectCommandScopeIds(source, adminFields));
  return adminId;
}

function getMatchingOutgoingCommandScope(scopes, requestIds) {
  for (const requestId of requestIds) {
    if (scopes.has(requestId)) {
      return scopes.get(requestId);
    }

    for (const [outgoingRequestId, scope] of scopes.entries()) {
      if (requestId.startsWith(`${outgoingRequestId}-`)) {
        return scope;
      }
    }
  }

  return null;
}

function getKioskRecencyTimestamp(kiosk) {
  const rawTimestamp = kiosk?.lastUpdated || kiosk?.lastUpdate || kiosk?.timestamp || '';
  if (!rawTimestamp) return 0;

  if (rawTimestamp instanceof Date) {
    return Number.isNaN(rawTimestamp.getTime()) ? 0 : rawTimestamp.getTime();
  }

  const normalizedTimestamp = typeof rawTimestamp === 'string' && !/(Z|[+-]\d{2}:?\d{2})$/i.test(rawTimestamp)
    ? `${rawTimestamp}Z`
    : rawTimestamp;
  const parsedTimestamp = Date.parse(normalizedTimestamp);
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
}

function clearDerivedSlot(slot) {
  return {
    ...slot,
    sn: 0,
    batteryLevel: null,
    chargingCurrent: 0,
    chargingVoltage: 0,
    chargeVoltage: 0,
    chargeCurrent: 0,
    sstat: '0C',
    status: 0,
    isLocked: false,
    lockReason: '',
  };
}

function normalizeAudioVolume(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function withAudioHardwareState(station, volume) {
  const normalizedVolume = normalizeAudioVolume(volume);

  return {
    ...station,
    hardware: {
      ...(station.hardware || {}),
      volume: normalizedVolume,
      audio: normalizedVolume === 0 ? 'off' : 'on',
    },
  };
}

function normalizeKioskPayloadForSave(action, kioskPayload, usesNewSchemaInfo) {
  if (!kioskPayload || typeof kioskPayload !== 'object') return kioskPayload;
  if (action !== 'infochange' || !kioskPayload.info || typeof kioskPayload.info !== 'object') {
    return kioskPayload;
  }

  return {
    ...kioskPayload,
    info: normalizeKioskInfoForSchema(kioskPayload.info, usesNewSchemaInfo),
  };
}

function normalizeWifiCommandPayload(kioskPayload) {
  const wifi = kioskPayload?.wifi && typeof kioskPayload.wifi === 'object'
    ? kioskPayload.wifi
    : {};
  const ssid = String(wifi.ssid || wifi.name || '').trim();
  const password = String(wifi.password || '').trim();

  return {
    wifi: {
      ...wifi,
      name: ssid,
      password,
    },
    ssid,
    password,
  };
}

const FIREBASE_SAVE_ACTIONS = {
  infochange: 'info',
  formoptionschange: 'formoptions',
  marketingoptionschange: 'marketingoptions',
  analyticsoptionschange: 'analyticsoptions',
  hardwarechange: 'hardware',
  pricechange: 'pricing',
  uichange: 'ui',
};

const COMMAND_SOCKET_OPEN_TIMEOUT_MS = 3000;
const COMMAND_RESPONSE_SCOPE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_EJECT_SLOT_TIMEOUT_MS = 90 * 1000;
const EJECT_SLOT_TIMEOUT_MS_CONFIG = Number(import.meta.env.VITE_EJECT_SLOT_TIMEOUT_MS);
const EJECT_SLOT_TIMEOUT_MS = Number.isFinite(EJECT_SLOT_TIMEOUT_MS_CONFIG) && EJECT_SLOT_TIMEOUT_MS_CONFIG > 0
  ? EJECT_SLOT_TIMEOUT_MS_CONFIG
  : DEFAULT_EJECT_SLOT_TIMEOUT_MS;
const EJECT_TIMEOUT_CHECK_INTERVAL_MS = 1000;
const FIRESTORE_IN_QUERY_LIMIT = 30;
const ADMIN_RENTAL_SCOPE = Object.freeze({
  ready: true,
  scopeType: 'all',
  stationIds: [],
});

function arraysEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}

function uniqueSortedValues(values) {
  return [...new Set(
    values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function chunkValues(values, size = FIRESTORE_IN_QUERY_LIMIT) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function getScopeValueVariants(value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return [];

  return uniqueSortedValues([
    normalizedValue,
    normalizedValue.toUpperCase(),
    normalizedValue.toLowerCase(),
  ]);
}

function isPartnerClient(clientInfo) {
  return clientInfo?.partner === true || String(clientInfo?.role || '').toLowerCase() === 'partner';
}

function buildScopedKioskQuery(kiosksCollectionRef, clientInfo) {
  if (!clientInfo) {
    return {
      queryRef: null,
      scopeType: 'none',
      scopeField: null,
      scopeValues: [],
    };
  }

  if (clientInfo.isAdmin) {
    return {
      queryRef: kiosksCollectionRef,
      scopeType: 'all',
      scopeField: null,
      scopeValues: [],
    };
  }

  const scopeValues = getScopeValueVariants(clientInfo.clientId);
  if (scopeValues.length === 0) {
    return {
      queryRef: null,
      scopeType: 'empty',
      scopeField: null,
      scopeValues: [],
    };
  }

  const scopeField = isPartnerClient(clientInfo) ? 'info.rep' : 'info.client';
  return {
    queryRef: scopeValues.length === 1
      ? query(kiosksCollectionRef, where(scopeField, '==', scopeValues[0]))
      : query(kiosksCollectionRef, where(scopeField, 'in', scopeValues)),
    scopeType: isPartnerClient(clientInfo) ? 'partner' : 'client',
    scopeField,
    scopeValues,
  };
}

function buildScopedRentalQueries(rentalsCollectionRef, stationIds, dateThreshold) {
  return chunkValues(stationIds).flatMap((stationIdChunk) => {
    const stationScope = stationIdChunk.length === 1
      ? where('rentalStationid', '==', stationIdChunk[0])
      : where('rentalStationid', 'in', stationIdChunk);
    const scopeKey = stationIdChunk.join('|');

    return [
      {
        key: `rental-time:${scopeKey}`,
        stationIds: stationIdChunk,
        queryRef: query(
          rentalsCollectionRef,
          stationScope,
          where('rentalTime', '>=', dateThreshold)
        ),
      },
      {
        // Compatibility path for vend failures created by legacy/backend writers
        // before they have a canonical rentalTime. This is also server-bounded.
        key: `vend-failed:${scopeKey}`,
        stationIds: stationIdChunk,
        queryRef: query(
          rentalsCollectionRef,
          stationScope,
          where('status', '==', 'vend_failed'),
          where('failedAt', '>=', dateThreshold)
        ),
      },
    ];
  });
}

function getRentalWindowTimestampMs(rental) {
  const rawTimestamp = (
    rental?.rentalTime ||
    rental?.failedAt ||
    rental?.lastUpdate ||
    rental?.returnTime ||
    rental?.purchaseTime ||
    rental?.purchasedAt ||
    rental?.refundDate ||
    ''
  );
  const timestampMs = Date.parse(String(rawTimestamp));
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function rentalIsWithinWindow(rental, dateThresholdMs) {
  const timestampMs = getRentalWindowTimestampMs(rental);
  return timestampMs !== null && timestampMs >= dateThresholdMs;
}

function waitForOpenWebSocket(socket, timeoutMs = COMMAND_SOCKET_OPEN_TIMEOUT_MS) {
  if (!socket) return Promise.resolve(null);
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (socket.readyState !== WebSocket.CONNECTING) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleClose);
      if (timer) clearTimeout(timer);
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const handleOpen = () => finish(socket);
    const handleClose = () => finish(null);

    timer = setTimeout(() => {
      finish(socket.readyState === WebSocket.OPEN ? socket : null);
    }, timeoutMs);

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('close', handleClose);
    socket.addEventListener('error', handleClose);
  });
}

function buildClientInfoFromProfile(profile, uid) {
  if (!profile) return null;

  const username = profile.username || '';
  const clientId = profile.clientId || '';
  const partner = !!profile.partner;
  const role = String(profile.role || (username === 'chargerent' ? 'admin' : 'user')).toLowerCase();
  const isAdmin = role === 'admin' || username === 'chargerent';
  const rawCommission = profile.revShare ?? profile.commission;
  const commission = Number.isFinite(Number(rawCommission)) ? Number(rawCommission) : 0;

  const defaultFeatures = {
    rentals: false,
    details: false,
    stationid: true,
    address: true,
    country: 'all',
    status: false,
    pricing: false,
    reporting: false,
    testing: false,
    media: false,
    ui_editor: false,
  };

  const defaultCommands = {
    edit: false,
    lock: false,
    eject: false,
    eject_multiple: false,
    binding: false,
    updates: false,
    connectivity: false,
    reboot: false,
    reload: false,
    audio: false,
    disable: false,
    "client edit": false
  };

  let features = { ...defaultFeatures, ...(profile.features || {}) };
  const payloadCommands = profile.commands || profile.Commands;
  let commands = { ...defaultCommands, ...(payloadCommands || {}) };
  const hasBindingAccess = username === 'chargerent' || features.binding === true || commands.binding === true;
  const hasTestingAccess = username === 'chargerent' || features.testing === true;
  const hasMediaAccess = username === 'chargerent' || isAdmin || features.media === true;

  // Admin override
  if (isAdmin) {
    features = {
      ...(profile.features || {}),
      rentals: true,
      details: true,
      stationid: true,
      address: true,
      country: 'all',
      status: true,
      pricing: true,
      reporting: true,
      lease_revenue: true,
      rental_counts: true,
      rental_revenue: true,
      client_commission: true,
      rep_commission: true,
      search: true,
      media: true,
      ui_editor: true,
      binding: false,
      testing: false,
    };
    commands = {
      ...(payloadCommands || {}),
      edit: true,
      lock: true,
      eject: true,
      eject_multiple: true,
      updates: true,
      connectivity: true,
      reboot: true,
      reload: true,
      audio: true,
      disable: true,
      "client edit": true,
    };
  }

  // Normalize language
  features.country = features.country || features.Country || 'all';
  features.defaultlanguage = (features.defaultlanguage || features.defaultLanguage || 'en').toString().toLowerCase();
  features.binding = hasBindingAccess;
  features.testing = hasTestingAccess;
  features.media = hasMediaAccess;

  return {
    uid,
    username,
    clientId,
    features,
    commands,
    partner,
    commission,
    revShare: commission,
    isAdmin,
    role,
    serverFlowVersion: profile.serverFlowVersion,
    serverUiVersion: profile.serverUiVersion
  };
}

function decodeTokenPayload(token) {
  if (!token) return null;

  try {
    const encodedPayload = String(token).split('.')[1] || '';
    const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    return JSON.parse(atob(paddedPayload));
  } catch {
    return null;
  }
}

function normalizeClaimCommands(commands) {
  if (!commands || typeof commands !== 'object') return {};

  return Object.fromEntries(
    Object.entries(commands).map(([key, value]) => [key, value === true])
  );
}

function tokenClaimsMatchProfile(token, profile) {
  const claims = decodeTokenPayload(token);
  if (!claims || !profile) return false;

  const username = String(profile.username || '').trim().toLowerCase();
  const clientId = String(profile.clientId || '').trim().toUpperCase();
  const role = String(profile.role || (username === 'chargerent' ? 'admin' : 'user')).trim().toLowerCase();
  const profileCommands = normalizeClaimCommands(profile.commands || profile.Commands);
  const claimCommands = normalizeClaimCommands(claims.commands);
  const commandKeys = new Set([...Object.keys(profileCommands), ...Object.keys(claimCommands)]);

  const commandsMatch = [...commandKeys].every((key) => Boolean(profileCommands[key]) === Boolean(claimCommands[key]));

  return (
    String(claims.username || '').trim().toLowerCase() === username &&
    String(claims.clientId || '').trim().toUpperCase() === clientId &&
    String(claims.role || '').trim().toLowerCase() === role &&
    commandsMatch
  );
}

function isTokenExpired(token) {
  const expiresAtMs = getTokenExpiresAtMs(token);
  return !expiresAtMs || Date.now() >= expiresAtMs;
}

function getTokenExpiresAtMs(token) {
  const payload = decodeTokenPayload(token);
  const expiresAtSeconds = Number(payload?.exp);

  return Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
    ? expiresAtSeconds * 1000
    : 0;
}

function shouldRefreshAuthToken(token, refreshWindowMs = 5 * 60 * 1000) {
  const expiresAtMs = getTokenExpiresAtMs(token);
  return !expiresAtMs || Date.now() + refreshWindowMs >= expiresAtMs;
}

function isTransientAuthRefreshError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  return (
    code.includes('network') ||
    code.includes('timeout') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('failed to fetch') ||
    message.includes('offline')
  );
}

function RouteLoadingState() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="text-xl font-semibold text-gray-700">Loading page...</div>
    </div>
  );
}

function normalizeNavigationSearch(value = '') {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function App() {
  // ✅ Gate rendering until Firebase Auth has initialized
  const [authReady, setAuthReady] = useState(false);

  // Firebase ID token
  const [token, setToken] = useState(localStorage.getItem('dashboardToken'));
  const hasAuthToken = Boolean(token);
  const [clientInfo, setClientInfo] = useState(null);
  const [language, setLanguage] = useState('en');
  const [page, setPage] = useState('dashboard'); // 'dashboard', 'admin', 'media', 'binding', 'templates', 'kiosk-editor', 'rentals', 'chargers', 'provision', 'reporting', 'analytics', 'testing'
  const [dashboardSearchTerm, setDashboardSearchTerm] = useState('');
  const [chargerSearchTerm, setChargerSearchTerm] = useState('');
  const [rentalsInitialPeriod, setRentalsInitialPeriod] = useState('today');
  const [rentalsInitialStationIds, setRentalsInitialStationIds] = useState([]);
  const [rentalsInitialSearch, setRentalsInitialSearch] = useState('');
  const [rentalData, setRentalData] = useState([]);
  const [commandStatus, setCommandStatus] = useState(null);
  const [firestoreError, setFirestoreError] = useState(null);
  const [initialStatusCheck, setInitialStatusCheck] = useState(false);

  // Centralized state for optimistic UI
  const [pendingSlots, setPendingSlots] = useState([]);
  const [ejectingSlots, setEjectingSlots] = useState([]);
  const [failedEjectSlots, setFailedEjectSlots] = useState([]);
  const [ngrokModalOpen, setNgrokModalOpen] = useState(false);
  const [lastProvisionedId, setLastProvisionedId] = useState(null);
  const [analyticsInitialData, setAnalyticsInitialData] = useState(null);

  const ws = useRef(null);
  const ignoredKiosksRef = useRef({});
  const failedEjectTimersRef = useRef(new Map());
  const ejectingSlotsRef = useRef([]);
  const outgoingCommandScopesRef = useRef(new Map());
  const currentSocketSessionIdRef = useRef('');
  const startupListenerRef = useRef({ kiosksLogged: false, rentalsLogged: false });
  const adminRentalLoadHandleRef = useRef(null);

  const [lockingSlots, setLockingSlots] = useState([]);
  const [allStationsData, setAllStationsData] = useState([]);
  const [ngrokInfo, setNgrokInfo] = useState(null);
  const [kiosksReady, setKiosksReady] = useState(false);
  const [adminRentalsReady, setAdminRentalsReady] = useState(false);
  const [rentalScope, setRentalScope] = useState({
    ready: false,
    scopeType: 'pending',
    stationIds: [],
  });
  const debugEjectUi = useCallback((message, payload) => {
    if (typeof window === 'undefined') return;

    try {
      if (window.localStorage.getItem('debugEjectSlots') !== '1') {
        return;
      }
    } catch {
      return;
    }

    console.info(`[EjectUI] ${message}`, payload);
  }, []);

  const cancelDeferredAdminRentalLoad = useCallback(() => {
    const handle = adminRentalLoadHandleRef.current;
    if (!handle) return;

    if (
      handle.type === 'idle' &&
      typeof window !== 'undefined' &&
      typeof window.cancelIdleCallback === 'function'
    ) {
      window.cancelIdleCallback(handle.id);
    } else {
      clearTimeout(handle.id);
    }

    adminRentalLoadHandleRef.current = null;
  }, []);

  const scheduleDeferredAdminRentalLoad = useCallback(() => {
    cancelDeferredAdminRentalLoad();

    const run = () => {
      adminRentalLoadHandleRef.current = null;
      setAdminRentalsReady(true);
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      adminRentalLoadHandleRef.current = {
        type: 'idle',
        id: window.requestIdleCallback(run, { timeout: 1500 }),
      };
      return;
    }

    adminRentalLoadHandleRef.current = {
      type: 'timeout',
      id: setTimeout(run, 250),
    };
  }, [cancelDeferredAdminRentalLoad]);

  const clearFailedEjectSlot = useCallback((slotKey) => {
    const timer = failedEjectTimersRef.current.get(slotKey);
    if (timer) {
      clearTimeout(timer);
      failedEjectTimersRef.current.delete(slotKey);
    }
    setFailedEjectSlots(prev => prev.filter(slot => `${slot.stationid}-${slot.moduleid}-${slot.slotid}` !== slotKey));
  }, []);

  const flashFailedEjectSlot = useCallback((stationid, moduleid, slotid) => {
    if (!stationid || !moduleid || !Number.isFinite(Number(slotid))) return;

    const normalizedSlotId = Number(slotid);
    const slotKey = `${stationid}-${moduleid}-${normalizedSlotId}`;

    setFailedEjectSlots(prev => [
      ...prev.filter(slot => `${slot.stationid}-${slot.moduleid}-${slot.slotid}` !== slotKey),
      { stationid, moduleid, slotid: normalizedSlotId }
    ]);

    const existingTimer = failedEjectTimersRef.current.get(slotKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      clearFailedEjectSlot(slotKey);
    }, 3500);
    failedEjectTimersRef.current.set(slotKey, timer);
  }, [clearFailedEjectSlot]);

  const clearEjectCommandState = useCallback((stationId, moduleRef, slotRef, chargerId = null) => {
    if (!stationId) return;

    setEjectingSlots(prev =>
      prev.filter(slot => !slotStateMatchesResponse(slot, stationId, moduleRef, slotRef, chargerId))
    );
    setPendingSlots(prev =>
      prev.filter(slot => !slotStateMatchesResponse(slot, stationId, moduleRef, slotRef, chargerId))
    );
  }, []);

  const handleLogout = useCallback(async () => {
    cancelDeferredAdminRentalLoad();
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    localStorage.removeItem('dashboardToken');
    setToken(null);
    setClientInfo(null);
    setLanguage('en');
    setPage('dashboard');
    setInitialStatusCheck(false);
    setAdminRentalsReady(false);
    setRentalScope({ ready: false, scopeType: 'pending', stationIds: [] });
  }, [cancelDeferredAdminRentalLoad]);

  useEffect(() => {
    const failedEjectTimers = failedEjectTimersRef.current;

    return () => {
      cancelDeferredAdminRentalLoad();
      failedEjectTimers.forEach(timer => clearTimeout(timer));
      failedEjectTimers.clear();
    };
  }, [cancelDeferredAdminRentalLoad]);

  useEffect(() => {
    ejectingSlotsRef.current = ejectingSlots;
  }, [ejectingSlots]);

  const { showWarning, handleStay } = useIdleTimer({
    onIdle: () => {}, // The hook now returns showWarning, so onIdle can be empty
    onLogout: handleLogout,
    idleTimeout: 1000 * 60 * 14, // 14 minutes
    promptTimeout: 1000 * 60 * 1, // 1 minute
  });

  const handleStayLoggedIn = () => {
    handleStay();
  };

  const onNavigateToAnalytics = useCallback((initialData = null) => {
    setAnalyticsInitialData(initialData);
    setPage('analytics');
  }, []);

  // ✅ Prevent multiple push subscriptions across re-renders
  const subscribedRef = useRef(false);
  useEffect(() => {
    if (clientInfo?.clientId && !subscribedRef.current) {
      console.log('Client info available, attempting to subscribe for push notifications.');
      subscribeUserToPush(clientInfo.clientId);
      subscribedRef.current = true; // mark as subscribed
    }
  }, [clientInfo]);

  const t = useCallback((key) => {
    return translations[language]?.[key] || key;
  }, [language]);

  // ---------------------------------------------
  // ✅ Firebase Auth bootstrap: keep token + profile in sync
  // ---------------------------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        localStorage.removeItem('dashboardToken');
        setToken(null);
        setClientInfo(null);
        setLanguage('en');
        setInitialStatusCheck(false);
        setAllStationsData([]);
        setRentalData([]);
        setKiosksReady(false);
        cancelDeferredAdminRentalLoad();
        setAdminRentalsReady(false);
        setRentalScope({ ready: false, scopeType: 'pending', stationIds: [] });
        setAuthReady(true);
        return;
      }

      try {
        const idToken = await user.getIdToken(false);
        let tokenToUse = idToken;

        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) {
          await handleLogout();
          setAuthReady(true);
          return;
        }

        const profile = snap.data();
        if (profile?.active === false) {
          await handleLogout();
          setAuthReady(true);
          return;
        }

        const claimsAlreadyCurrent = tokenClaimsMatchProfile(idToken, profile);
        if (!claimsAlreadyCurrent) {
          try {
            await callFunctionWithAuth('auth_syncOwnClaims');
            tokenToUse = await user.getIdToken(true);
          } catch (syncError) {
            console.warn('Unable to sync auth claims during bootstrap:', syncError);
          }
        }

        localStorage.setItem('dashboardToken', tokenToUse);
        setToken(tokenToUse);

        const info = buildClientInfoFromProfile(profile, user.uid);
        setClientInfo(info);
        setLanguage(info?.features?.defaultlanguage || 'en');
        setAuthReady(true);
      } catch (e) {
        console.error('Auth bootstrap failed:', e);
        await handleLogout();
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, [cancelDeferredAdminRentalLoad, handleLogout]);

  useEffect(() => {
    if (!hasAuthToken || !auth.currentUser) return;

    const flowVersionRef = doc(db, 'server', 'flow_current');
    const unsubscribeFlowVersion = onSnapshot(flowVersionRef, (snapshot) => {
      const firestoreFlowVersion = snapshot.data()?.fversion;

      if (typeof firestoreFlowVersion !== 'string' || !firestoreFlowVersion.trim()) {
        return;
      }

      setClientInfo((prev) => {
        if (!prev || prev.serverFlowVersion === firestoreFlowVersion) {
          return prev;
        }

        return {
          ...prev,
          serverFlowVersion: firestoreFlowVersion,
        };
      });
    }, (error) => {
      console.warn('Unable to subscribe to server flow version:', error);
    });

    return () => unsubscribeFlowVersion();
  }, [hasAuthToken]);

  // Effect to handle token expiration when tab/PWA becomes visible again
  useEffect(() => {
    let refreshInFlight = false;

    const checkTokenOnFocus = async () => {
      const currentToken = localStorage.getItem('dashboardToken');
      if (!currentToken) {
        await handleLogout();
        return;
      }

      if (!shouldRefreshAuthToken(currentToken)) {
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        console.warn('Skipping auth token refresh while offline.');
        return;
      }

      if (refreshInFlight) {
        return;
      }

      refreshInFlight = true;
      try {
        if (!auth.currentUser) {
          await handleLogout();
          return;
        }

        const refreshed = await auth.currentUser.getIdToken(isTokenExpired(currentToken));
        localStorage.setItem('dashboardToken', refreshed);
        setToken((prevToken) => (prevToken === refreshed ? prevToken : refreshed));
      } catch (error) {
        if (isTransientAuthRefreshError(error)) {
          console.warn('Auth token refresh failed, keeping current session for retry:', error);
          return;
        }

        await handleLogout();
      } finally {
        refreshInFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkTokenOnFocus();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', checkTokenOnFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', checkTokenOnFocus);
    };
  }, [handleLogout]);

  const listenerHasClientInfo = Boolean(clientInfo);
  const listenerUid = clientInfo?.uid || '';
  const listenerUsername = clientInfo?.username || null;
  const listenerClientId = clientInfo?.clientId || null;
  const listenerRole = clientInfo?.role || null;
  const listenerCountry = clientInfo?.features?.country || null;
  const listenerIsAdmin = Boolean(clientInfo?.isAdmin);
  const listenerIsPartner = Boolean(clientInfo?.partner === true || listenerRole === 'partner');
  const listenerClientInfo = useMemo(() => {
    if (!listenerHasClientInfo) return null;

    return {
      uid: listenerUid,
      username: listenerUsername,
      clientId: listenerClientId,
      role: listenerRole,
      partner: listenerIsPartner,
      isAdmin: listenerIsAdmin,
    };
  }, [
    listenerClientId,
    listenerHasClientInfo,
    listenerIsAdmin,
    listenerIsPartner,
    listenerRole,
    listenerUid,
    listenerUsername,
  ]);
  const effectiveRentalScope = useMemo(() => (
    listenerIsAdmin
      ? { ...ADMIN_RENTAL_SCOPE, ready: adminRentalsReady }
      : rentalScope
  ), [adminRentalsReady, listenerIsAdmin, rentalScope]);
  const effectiveRentalStationIds = effectiveRentalScope.stationIds;
  const effectiveRentalStationIdsKey = effectiveRentalStationIds.join('\u001f');

  // ---------------------------------------------
  // Firestore listeners
  // ---------------------------------------------
  useEffect(() => {
    // ✅ Require actual firebase session too
    if (!hasAuthToken || !auth.currentUser || !listenerClientInfo) return;

    cancelDeferredAdminRentalLoad();
    setAdminRentalsReady(false);
    setKiosksReady(false);
    setRentalData([]);
    setRentalScope({
      ready: false,
      scopeType: listenerIsAdmin ? 'all' : 'pending',
      stationIds: [],
    });
    startupListenerRef.current = { kiosksLogged: false, rentalsLogged: false };
    const kiosksCollectionRef = collection(db, 'kiosks');
    const kioskScope = buildScopedKioskQuery(kiosksCollectionRef, listenerClientInfo);

    if (!kioskScope.queryRef) {
      setAllStationsData([]);
      setKiosksReady(true);
      setRentalScope({ ready: true, scopeType: kioskScope.scopeType, stationIds: [] });
      return undefined;
    }

    // Step 1: Real-time listener for raw Kiosk Data from Firestore
    const unsubscribeKiosks = onSnapshot(kioskScope.queryRef, (querySnapshot) => {
      const shouldLogFirstKioskSnapshot = !startupListenerRef.current.kiosksLogged;
      const now = Date.now();
      const firestoreKiosksData = querySnapshot.docs.map(docSnap => ({ stationid: docSnap.id, ...docSnap.data() }));

      setFirestoreError(null); // Clear error on new data
      setKiosksReady(true);
      if (shouldLogFirstKioskSnapshot) {
        startupListenerRef.current.kiosksLogged = true;
      }

      if (listenerIsAdmin && shouldLogFirstKioskSnapshot) {
        scheduleDeferredAdminRentalLoad();
      }

      const nextRentalStationIds = listenerIsAdmin
        ? []
        : uniqueSortedValues(firestoreKiosksData.map((kiosk) => kiosk.stationid));
      setRentalScope((prevScope) => {
        const nextScope = {
          ready: !listenerIsAdmin,
          scopeType: kioskScope.scopeType,
          stationIds: nextRentalStationIds,
        };

        return (
          prevScope.ready === nextScope.ready &&
          prevScope.scopeType === nextScope.scopeType &&
          arraysEqual(prevScope.stationIds, nextScope.stationIds)
        ) ? prevScope : nextScope;
      });

      // Filter out updates for ignored kiosks.
      setAllStationsData(prevStations => {
        const prevStationsMap = new Map(prevStations.map(s => [s.stationid, s]));
        const newStations = firestoreKiosksData.map(kiosk => {
          const ignoreUntil = ignoredKiosksRef.current[kiosk.stationid];
          if (ignoreUntil && now < ignoreUntil) {
            return prevStationsMap.get(kiosk.stationid) || normalizeKioskData([kiosk])[0];
          }
          return normalizeKioskData([kiosk])[0];
        });
        return newStations;
      });

    }, (error) => {
      setKiosksReady(true);
      setFirestoreError('Failed to connect to kiosk data. The dashboard may be out of date.');
      console.error("Error fetching real-time kiosks: ", error);
    });

    return () => {
      cancelDeferredAdminRentalLoad();
      unsubscribeKiosks();
    };
  }, [
    cancelDeferredAdminRentalLoad,
    hasAuthToken,
    listenerClientId,
    listenerCountry,
    listenerClientInfo,
    listenerIsAdmin,
    listenerIsPartner,
    listenerRole,
    listenerUid,
    listenerUsername,
    scheduleDeferredAdminRentalLoad,
  ]);

  useEffect(() => {
    if (!hasAuthToken || !auth.currentUser || !listenerClientInfo) return;
    if (!effectiveRentalScope.ready) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateThreshold = thirtyDaysAgo.toISOString();
    const dateThresholdMs = Date.parse(dateThreshold);
    const rentalsCollectionRef = collection(db, 'rentals');

    if (!listenerIsAdmin && effectiveRentalStationIds.length === 0) {
      setRentalData([]);
      startupListenerRef.current.rentalsLogged = true;
      return undefined;
    }

    const rentalQuerySpecs = listenerIsAdmin
      ? [
          {
            key: 'all',
            stationIds: [],
            queryRef: query(rentalsCollectionRef, where('rentalTime', '>=', dateThreshold)),
          },
          {
            // Keep legacy failures visible without listening to all history.
            key: 'vend_failed_without_rental_time',
            stationIds: [],
            queryRef: query(
              rentalsCollectionRef,
              where('status', '==', 'vend_failed'),
              where('failedAt', '>=', dateThreshold)
            ),
          },
        ]
      : buildScopedRentalQueries(rentalsCollectionRef, effectiveRentalStationIds, dateThreshold);
    const rentalSnapshotsByQuery = new Map();

    startupListenerRef.current.rentalsLogged = false;

    const unsubscribeRentals = rentalQuerySpecs.map((querySpec) => (
      onSnapshot(querySpec.queryRef, (querySnapshot) => {
        const rawRentals = querySnapshot.docs.map(docSnap => ({ rawid: docSnap.id, ...docSnap.data() }));
        const rentals = rawRentals.filter((rental) => rentalIsWithinWindow(rental, dateThresholdMs));
        setFirestoreError(null);

        rentalSnapshotsByQuery.set(querySpec.key, rentals);

        const hasAllInitialSnapshots = rentalSnapshotsByQuery.size === rentalQuerySpecs.length;
        if (!hasAllInitialSnapshots && !startupListenerRef.current.rentalsLogged) {
          return;
        }

        const combinedRentals = Array.from(
          new Map(
            Array.from(rentalSnapshotsByQuery.values())
              .flat()
              .map(rental => [rental.rawid || rental.orderid, rental])
          ).values()
        );
        setRentalData(combinedRentals);

        if (!startupListenerRef.current.rentalsLogged) {
          startupListenerRef.current.rentalsLogged = true;
        }
      }, (error) => {
        setFirestoreError('Failed to connect to rental data. The dashboard may be out of date.');
        console.error("Error fetching real-time rentals: ", error);
      })
    ));

    return () => {
      unsubscribeRentals.forEach((unsubscribe) => unsubscribe());
    };
  }, [
    effectiveRentalScope,
    effectiveRentalStationIds,
    effectiveRentalStationIdsKey,
    hasAuthToken,
    listenerClientInfo,
    listenerIsAdmin,
  ]);

  // Failsafe Effect: Cleans up lingering UI effects when Firestore data confirms the state.
  useEffect(() => {
    if (pendingSlots.length === 0) return;

    const slotsToRemoveFromPending = [];
    allStationsData.forEach(kiosk => {
      kiosk.modules.forEach(module => {
        const moduleNumber = module.id.split('m').pop();
        module.slots.forEach(slot => {
          if (slot.isLocked !== undefined) {
            pendingSlots.forEach(p => {
              if (p.stationid === kiosk.stationid && p.moduleid.toString().split('m').pop() == moduleNumber && p.slotid === slot.position) {
                slotsToRemoveFromPending.push(p);
              }
            });
          }
        });
      });
    });

    if (slotsToRemoveFromPending.length > 0) {
      setPendingSlots(prev => prev.filter(p => !slotsToRemoveFromPending.includes(p)));
    }
  }, [allStationsData, pendingSlots]);

  useEffect(() => {
    if (ejectingSlots.length === 0 || allStationsData.length === 0) return;

    const settledSlotKeys = new Set();

    ejectingSlots.forEach((trackedSlot) => {
      const kiosk = allStationsData.find((station) => station.stationid === trackedSlot.stationid);
      if (!kiosk) return;

      const targetModule = findMatchingModule(kiosk.modules, trackedSlot.moduleid, trackedSlot.chargerid);
      const targetSlot = findMatchingSlot(targetModule, trackedSlot.slotid, trackedSlot.chargerid);
      if (!targetModule || !targetSlot) return;

      const currentChargerId = Number(targetSlot?.sn ?? 0);
      const expectedChargerId = Number(trackedSlot?.chargerid);
      const chargerChanged = Number.isFinite(expectedChargerId) &&
        expectedChargerId > 0 &&
        currentChargerId > 0 &&
        currentChargerId !== expectedChargerId;

      if (slotLooksEmpty(targetSlot) || chargerChanged) {
        settledSlotKeys.add(getTrackedSlotKey(trackedSlot));
      }
    });

    if (settledSlotKeys.size === 0) return;

    debugEjectUi(
      'Clearing stale ejecting slots from kiosk snapshot',
      ejectingSlots.filter((slot) => settledSlotKeys.has(getTrackedSlotKey(slot)))
    );
    setEjectingSlots((prev) => prev.filter((slot) => !settledSlotKeys.has(getTrackedSlotKey(slot))));
  }, [allStationsData, debugEjectUi, ejectingSlots]);

  useEffect(() => {
    if (ejectingSlots.length === 0) return;

    const checkTimedOutEjectSlots = () => {
      const activeSlots = ejectingSlotsRef.current;
      if (activeSlots.length === 0) return;

      const now = Date.now();
      const timedOutSlots = activeSlots.filter((slot) => {
        const startedAt = Number(slot?.startedAt);
        return Number.isFinite(startedAt) && startedAt > 0 && now - startedAt >= EJECT_SLOT_TIMEOUT_MS;
      });
      if (timedOutSlots.length === 0) return;

      const timedOutSlotKeys = new Set(timedOutSlots.map(getTrackedSlotKey));

      debugEjectUi('Eject slots timed out', timedOutSlots);
      timedOutSlots.forEach((slot) => {
        flashFailedEjectSlot(slot.stationid, slot.moduleid, slot.slotid);
      });

      setEjectingSlots((prev) => prev.filter((slot) => !timedOutSlotKeys.has(getTrackedSlotKey(slot))));
      setPendingSlots((prev) => prev.filter((slot) => !timedOutSlotKeys.has(getTrackedSlotKey(slot))));
      setCommandStatus({
        state: 'error',
        message: timedOutSlots.length === 1
          ? t('eject_timeout_single')
          : t('eject_timeout_multiple').replace('{count}', timedOutSlots.length),
      });
    };

    const interval = setInterval(checkTimedOutEjectSlots, EJECT_TIMEOUT_CHECK_INTERVAL_MS);
    checkTimedOutEjectSlots();

    return () => clearInterval(interval);
  }, [debugEjectUi, ejectingSlots.length, flashFailedEjectSlot, t]);

  const latestTimestamp = useMemo(() => {
    if (!allStationsData?.length) {
      return new Date();
    }
    const latestStation = allStationsData.reduce((latest, current) => {
      if (!current?.timestamp) return latest;
      if (!latest?.timestamp) return current;
      const latestDate = new Date(latest.timestamp.endsWith('Z') ? latest.timestamp : latest.timestamp + 'Z');
      const currentDate = new Date(current.timestamp.endsWith('Z') ? current.timestamp : current.timestamp + 'Z');
      return currentDate > latestDate ? current : latest;
    }, null);

    return latestStation?.lastUpdated ? new Date(latestStation.lastUpdated) : new Date();
  }, [allStationsData]);

  const dedupedStationsData = useMemo(() => {
    if (!Array.isArray(allStationsData) || allStationsData.length === 0) {
      return [];
    }

    const winningLocations = new Map();

    allStationsData.forEach((kiosk, kioskIndex) => {
      const kioskOnline = isKioskOnline(kiosk, latestTimestamp);
      const kioskTimestamp = getKioskRecencyTimestamp(kiosk);

      (kiosk.modules || []).forEach((module, moduleIndex) => {
        (module.slots || []).forEach((slot, slotIndex) => {
          const chargerSn = String(slot?.sn || '').trim();
          if (!chargerSn || chargerSn === '0') return;

          const existing = winningLocations.get(chargerSn);
          const candidate = {
            kioskIndex,
            moduleIndex,
            slotIndex,
            kioskOnline,
            kioskTimestamp,
            slotQuality: getSlotDedupQuality(slot),
          };

          if (!existing) {
            winningLocations.set(chargerSn, candidate);
            return;
          }

          const shouldReplace = (
            (candidate.kioskOnline && !existing.kioskOnline) ||
            (
              candidate.kioskOnline === existing.kioskOnline &&
              candidate.slotQuality > existing.slotQuality
            ) ||
            (
              candidate.kioskOnline === existing.kioskOnline &&
              candidate.slotQuality === existing.slotQuality &&
              candidate.kioskTimestamp > existing.kioskTimestamp
            )
          );

          if (shouldReplace) {
            winningLocations.set(chargerSn, candidate);
          }
        });
      });
    });

    return allStationsData.map((kiosk, kioskIndex) => ({
      ...kiosk,
      modules: (kiosk.modules || []).map((module, moduleIndex) => ({
        ...module,
        slots: (module.slots || []).map((slot, slotIndex) => {
          const chargerSn = String(slot?.sn || '').trim();
          if (!chargerSn || chargerSn === '0') return slot;

          const winner = winningLocations.get(chargerSn);
          const isWinner = winner &&
            winner.kioskIndex === kioskIndex &&
            winner.moduleIndex === moduleIndex &&
            winner.slotIndex === slotIndex;

          return isWinner ? slot : clearDerivedSlot(slot);
        }),
      })),
    }));
  }, [allStationsData, latestTimestamp]);

  const manageIgnoredKiosk = useCallback((kioskId, shouldIgnore) => {
    if (shouldIgnore) {
      ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [kioskId]: Date.now() + 3600000 }; // Ignore for 1 hour
    } else {
      const newIgnored = { ...ignoredKiosksRef.current };
      delete newIgnored[kioskId];
      ignoredKiosksRef.current = newIgnored;
    }
  }, []);

  const pruneOutgoingCommandScopes = useCallback((now = Date.now()) => {
    for (const [requestId, scope] of outgoingCommandScopesRef.current.entries()) {
      if (now >= Number(scope?.expiresAt || 0)) {
        outgoingCommandScopesRef.current.delete(requestId);
      }
    }
  }, []);

  const rememberOutgoingCommandScope = useCallback((requestId, metadata = {}) => {
    const normalizedRequestId = normalizeCommandScopeId(requestId);
    if (!normalizedRequestId) return;

    const now = Date.now();
    pruneOutgoingCommandScopes(now);
    outgoingCommandScopesRef.current.set(normalizedRequestId, {
      ...metadata,
      requestId: normalizedRequestId,
      createdAt: now,
      expiresAt: now + COMMAND_RESPONSE_SCOPE_TTL_MS,
    });
  }, [pruneOutgoingCommandScopes]);

  const getCommandStatusVisibility = useCallback((data) => {
    const username = String(clientInfo?.username || '').trim().toLowerCase();
    if (username === 'chargerent') {
      return { shouldShow: true, reason: 'chargerent' };
    }

    if (!data || typeof data !== 'object') {
      return { shouldShow: false, reason: 'unscoped-message' };
    }

    pruneOutgoingCommandScopes();

    const requestIds = getCommandResponseRequestIds(data);
    const adminId = getCommandResponseAdminId(data);
    const matchingScope = getMatchingOutgoingCommandScope(outgoingCommandScopesRef.current, requestIds);

    if (matchingScope) {
      if (adminId && !currentSocketSessionIdRef.current) {
        currentSocketSessionIdRef.current = adminId;
      }
      return {
        shouldShow: true,
        reason: 'matching-request',
        requestIds,
        adminId,
        matchedRequestId: matchingScope.requestId,
      };
    }

    const currentSocketSessionId = currentSocketSessionIdRef.current;
    if (adminId && currentSocketSessionId && adminId === currentSocketSessionId) {
      return {
        shouldShow: true,
        reason: 'matching-admin',
        requestIds,
        adminId,
        matchedRequestId: '',
      };
    }

    return {
      shouldShow: false,
      reason: adminId ? 'different-admin' : (requestIds.length > 0 ? 'unknown-request' : 'missing-scope'),
      requestIds,
      adminId,
      matchedRequestId: '',
    };
  }, [clientInfo?.username, pruneOutgoingCommandScopes]);

  const setScopedCommandStatus = useCallback((data, status) => {
    const visibility = getCommandStatusVisibility(data);
    if (visibility.shouldShow) {
      setCommandStatus(status);
      return true;
    }

    console.info('[WS Receive] Suppressed toast for different command scope', {
      action: data?.action,
      status: data?.status,
      status_en: data?.status_en,
      reason: visibility.reason,
      requestIds: visibility.requestIds,
      admin: visibility.adminId,
      currentSocketSessionId: currentSocketSessionIdRef.current,
      user: clientInfo?.username,
    });
    return false;
  }, [clientInfo?.username, getCommandStatusVisibility]);

  const getFreshCommandToken = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('Not signed in');
    }

    const currentToken = localStorage.getItem('dashboardToken') || token || '';
    const freshToken = await auth.currentUser.getIdToken(shouldRefreshAuthToken(currentToken));

    if (freshToken && freshToken !== currentToken) {
      localStorage.setItem('dashboardToken', freshToken);
      setToken(freshToken);
    }

    return freshToken || currentToken;
  }, [token]);

  const onCommand = useCallback(async (stationid, action, moduleid = null, provisionid = null, uiVersion = null, details = null) => {
    let commandToken = '';
    try {
      commandToken = await getFreshCommandToken();
    } catch (error) {
      setCommandStatus({
        state: 'error',
        message: error?.message ? `${t('command_failed')} ${error.message}` : t('command_failed'),
      });
      return;
    }

    const targetKiosk = stationid
      ? allStationsData.find((kiosk) => kiosk.stationid === stationid)
      : null;
    const targetIsV2Kiosk = isV2Kiosk(targetKiosk);
    const kioskType = String(targetKiosk?.hardware?.type || '').trim();
    const shouldUseFirebaseForLock = Boolean(
      targetKiosk &&
      isNewSchemaKiosk(targetKiosk) &&
      (action === 'lock slot' || action === 'unlock slot')
    );
    const firebaseSection = FIREBASE_SAVE_ACTIONS[action];
    const shouldUseFirebaseForSave = Boolean(
      firebaseSection &&
      targetKiosk &&
      targetIsV2Kiosk &&
      details?.pushOnly !== true
    );
    const normalizedKioskPayload = normalizeKioskPayloadForSave(
      action,
      details?.kiosk || null,
      shouldUseFirebaseForSave,
    );

    const pushUiChangeToKiosk = async (kioskPayload, parentRequestId = '') => {
      const commandSocket = ws.current?.readyState === WebSocket.OPEN
        ? ws.current
        : await waitForOpenWebSocket(ws.current);

      if (!commandSocket || commandSocket.readyState !== WebSocket.OPEN) {
        return false;
      }

      const requestId = parentRequestId
        ? `${parentRequestId}-push`
        : createCommandRequestId('uichange', stationid, moduleid);
      const commandData = {
        stationid,
        action: 'uichange',
        requestId,
        timerequested: Date.now(),
        ...(provisionid && { provisionid }),
        ...(uiVersion && { version: uiVersion }),
        kiosk: kioskPayload,
      };

      rememberOutgoingCommandScope(requestId, {
        action: 'uichange',
        stationid,
        moduleid,
      });
      commandSocket.send(JSON.stringify({
        type: 'command',
        token: commandToken,
        data: commandData,
      }));
      ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationid]: Date.now() + 30000 };
      return true;
    };

    if (shouldUseFirebaseForLock) {
      const requestId = createCommandRequestId(action, stationid, moduleid);
      const slotid = Number(details?.slotid);
      const lockReason = typeof details?.info === 'string' ? details.info : '';

      if (moduleid != null && Number.isFinite(slotid)) {
        setLockingSlots((prev) => {
          const alreadyTracking = prev.some((slot) => (
            slot.stationid === stationid &&
            String(slot.moduleid) === String(moduleid) &&
            Number(slot.slotid) === slotid
          ));

          return alreadyTracking ? prev : [...prev, { stationid, moduleid, slotid }];
        });
      }

      setCommandStatus({ state: 'sending', message: t('sending_command') });

      try {
        const payload = await callFunctionWithAuth('kiosk_updateSlotLock', {
          stationid,
          moduleid,
          slotid,
          locked: action === 'lock slot',
          lockReason,
          requestId,
        });
        const normalizedKiosk = payload?.kiosk
          ? normalizeKioskData([payload.kiosk])[0]
          : null;

        if (normalizedKiosk) {
          setAllStationsData((prevKiosks) =>
            prevKiosks.map((station) =>
              station.stationid === normalizedKiosk.stationid ? normalizedKiosk : station
            )
          );
        }

        setCommandStatus({
          state: 'success',
          message: payload?.message || t('command_success'),
        });
      } catch (error) {
        setCommandStatus({
          state: 'error',
          message: error?.message ? `${t('command_failed')} ${error.message}` : t('command_failed'),
        });
      } finally {
        if (moduleid != null && Number.isFinite(slotid)) {
          setLockingSlots((prev) => prev.filter((slot) => !(
            slot.stationid === stationid &&
            String(slot.moduleid) === String(moduleid) &&
            Number(slot.slotid) === slotid
          )));
        }
      }
      return;
    }

    if (shouldUseFirebaseForSave) {
      const requestId = createCommandRequestId(action, stationid, moduleid);
      setCommandStatus({ state: 'sending', message: t('sending_command') });

      try {
        const payload = await callFunctionWithAuth('kiosk_updateSection', {
          stationid,
          section: firebaseSection,
          kiosk: normalizedKioskPayload,
          autoGeocode: details?.autoGeocode === true,
          requestId,
        });
        const normalizedKiosk = payload?.kiosk
          ? normalizeKioskData([payload.kiosk])[0]
          : null;

        if (normalizedKiosk) {
          setAllStationsData((prevKiosks) =>
            prevKiosks.map((station) =>
              station.stationid === normalizedKiosk.stationid ? normalizedKiosk : station
            )
          );
        }

        const shouldPushUiChange = action === 'uichange';
        const pushSent = shouldPushUiChange
          ? await pushUiChangeToKiosk(normalizedKiosk || normalizedKioskPayload, requestId)
          : false;

        setCommandStatus({
          state: pushSent || !shouldPushUiChange ? 'success' : 'error',
          message: pushSent
            ? `${payload?.message || t('command_success')} Push sent.`
            : shouldPushUiChange
              ? `${payload?.message || t('command_success')} Kiosk push failed: ${t('connection_lost')}`
              : payload?.message || t('command_success'),
        });
      } catch (error) {
        setCommandStatus({
          state: 'error',
          message: error?.message ? `${t('command_failed')} ${error.message}` : t('command_failed'),
        });
      }
      return;
    }

    const commandSocket = ws.current?.readyState === WebSocket.OPEN
      ? ws.current
      : await waitForOpenWebSocket(ws.current);

    if (commandSocket && commandSocket.readyState === WebSocket.OPEN) {
      const timerequested = Date.now();
      const providedRequestId = String(details?.requestId || details?.firmwareSessionId || '').trim();
      const requestId = providedRequestId || createCommandRequestId(action, stationid, moduleid);
      const baseData = {
        stationid,
        action,
        requestId,
        timerequested,
        ...(action.startsWith('eject') && kioskType ? { kioskType } : {}),
        ...(provisionid && { provisionid }),
        ...(uiVersion && { version: uiVersion }),
        ...(moduleid && { moduleid }),
      };
      const audioVolume = action === 'set volume'
        ? normalizeAudioVolume(details?.volume, 0)
        : null;

      let commandData = {};
      switch (action) {
        case 'lock slot':
        case 'unlock slot':
          if (details?.slotid != null && moduleid != null) {
            setLockingSlots(prev => [...prev, {
              stationid: stationid,
              moduleid: moduleid,
              slotid: details.slotid,
            }]);
          }
          commandData = {
            ...baseData,
            slotid: details?.slotid,
            ...(details?.info != null ? { info: details.info } : {}),
          };
          break;
        case 'lock module':
          commandData = { ...baseData };
          break;
        case 'eject specific':
          commandData = {
            ...baseData,
            slotid: details.slotid,
            info: details.info,
            ...(Number.isFinite(Number(details?.chargerid)) && Number(details?.chargerid) > 0 ? { chargerid: Number(details.chargerid) } : {})
          };
          break;
        case 'rent':
          commandData = { ...baseData, slotid: details.slotid, info: details.info };
          break;
        case 'vend':
          commandData = {
            ...baseData,
            slotid: details?.slotid,
            chargerid: details?.chargerid,
            info: details?.info
          };
          break;
        case 'eject count':
        case 'eject module':
        case 'reboot module':
          commandData = { ...baseData, ...details };
          break;
        case 'update module':
          commandData = { ...baseData, ...details };
          break;
        case 'refund':
          commandData = { ...baseData, ...details };
          break;
        case 'provision':
          commandData = { ...baseData, kiosk: details.kiosk };
          break;
        case 'set volume':
          commandData = {
            ...baseData,
            volume: audioVolume,
            muted: details?.muted === true || audioVolume === 0,
          };
          break;
        case 'wifichange': {
          const wifiPayload = normalizeWifiCommandPayload(normalizedKioskPayload);
          commandData = {
            ...baseData,
            kiosk: normalizedKioskPayload,
            wifi: wifiPayload.wifi,
            ssid: wifiPayload.ssid,
            password: wifiPayload.password,
          };
          break;
        }
        default:
          commandData = {
            ...baseData,
            ...(moduleid && { moduleid }),
            ...(details && {
              kiosk: normalizedKioskPayload,
              autoGeocode: details.autoGeocode,
            }),
          };
      }

      const message = {
        type: 'command',
        token: commandToken,
        data: commandData
      };

      rememberOutgoingCommandScope(requestId, {
        action,
        stationid,
        moduleid,
      });
      commandSocket.send(JSON.stringify(message));
      console.log('[WS Send]', message);
      if (action.startsWith('eject') || action === 'rent' || action === 'vend') {
        debugEjectUi('Sent eject-style command', commandData);
      }
      if (action === 'set volume') {
        setAllStationsData((prevStations) =>
          prevStations.map((station) =>
            station.stationid === stationid ? withAudioHardwareState(station, audioVolume) : station
          )
        );
      }

      console.log(`[2. IGNORE] Ignoring Firestore updates for ${stationid} for 30s.`);
      ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationid]: Date.now() + 30000 };

      setCommandStatus({ state: 'sending', message: t('sending_command') });
    } else {
      setCommandStatus({ state: 'error', message: t('connection_lost') });
    }
  }, [allStationsData, debugEjectUi, getFreshCommandToken, rememberOutgoingCommandScope, t]);

  // ---------------------------------------------
  // WebSocket connect (FULL HANDLER INCLUDED)
  // ---------------------------------------------
  useEffect(() => {
    if (!token || !clientInfo) return;

    let isCleaningUp = false;
    let reconnectTimer = null;

    const connect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        return;
      }
      const socket = new WebSocket(`wss://chargerentstations.com/ws/commands?token=${token}`);
      ws.current = socket;

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WS Receive]', data);

          const refundStatus = data.refund_status || data.status;

          if (data.action === 'refund' && (isSuccessfulRefundStatus(refundStatus) || isPendingRefundStatus(refundStatus)) && (data.orderId || data.transactionid)) {
            setRentalData(prevData =>
              prevData.map(rental =>
                rentalMatchesRefundConfirmation(rental, data)
                  ? applyRefundConfirmationToRental(rental, data)
                  : rental
              )
            );
          }

          if (data.action === 'ngrok connect' || data.action === 'ngrok disconnect' || data.action === 'ssh connect' || data.action === 'ssh disconnect') {
            const isSuccess = data.status == 1;
            const shouldShowCommandStatus = setScopedCommandStatus(data, { state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')) });
            if (isSuccess) {
              const isConnecting = data.action.endsWith('connect');
              const type = data.action.startsWith('ngrok') ? 'ngrok' : 'ssh';
              setAllStationsData(prev => prev.map(station =>
                station.stationid === data.kiosk ? { ...station, [type]: isConnecting } : station
              ));
              if (shouldShowCommandStatus && isConnecting && type === 'ngrok' && data.status_en && data.action === 'ngrok connect') {
                setNgrokInfo({ kioskId: data.kiosk, message: data.status_en });
                setNgrokModalOpen(true);
              }
            }
          } else if (data.action === 'provision') {
            const isSuccess = data.status_en === 'kiosk provisioned on server';
            const shouldShowCommandStatus = setScopedCommandStatus(data, { state: isSuccess ? 'success' : 'pending', message: data.status_en });

            if (shouldShowCommandStatus && isSuccess && data.admin) {
              setLastProvisionedId(data.admin);
            }
          } else if (data.action && (data.action.startsWith('eject') || data.action === 'rent' || data.action === 'vend')) { // EJECT LOGIC
            const isSuccess = data.status == 1;
            const fallbackFailureMessage = t('eject_failed');
            const shouldShowCommandStatus = setScopedCommandStatus(data, {
              state: isSuccess ? 'success' : 'error',
              message: data.status_en || (isSuccess ? t('command_success') : fallbackFailureMessage)
            });

            const stationId = data.kiosk || data.stationid;
            const moduleRef = data.moduleid || data.module;
            const slotRef = data.slot ?? data.slotid;
            const chargerId = data.chargerid ?? data.sn;

            debugEjectUi('Received eject response', {
              action: data.action,
              status: data.status,
              stationId,
              moduleRef,
              slotRef,
              chargerId,
              message: data.status_en,
            });
            clearEjectCommandState(stationId, moduleRef, slotRef, chargerId);

            if (isSuccess && stationId) {
              setAllStationsData(prevStations => {
                const updatedStations = prevStations.map(station => {
                  if (station.stationid !== stationId) return station;

                  const targetModule = findMatchingModule(station.modules, moduleRef, chargerId);
                  const targetSlot = findMatchingSlot(targetModule, slotRef, chargerId);

                  if (targetModule && targetSlot) {
                    clearEjectCommandState(stationId, targetModule.id, targetSlot.position, chargerId);
                  }

                  return {
                    ...station,
                    modules: station.modules.map(module =>
                      module.id === targetModule?.id
                        ? {
                            ...module,
                            slots: module.slots.map(slot =>
                              slot.position === targetSlot?.position
                                ? {
                                    ...slot,
                                    sn: 0,
                                    batteryLevel: 0,
                                    chargingCurrent: 0,
                                    sstat: '0C',
                                    cmos: null,
                                    isLocked: false,
                                    lock: false,
                                    lockReason: null,
                                  }
                                : slot
                            )
                          }
                        : module
                    )
                  };
                });
                return updatedStations;
              });

              setAllStationsData(prev => {
                ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationId]: Date.now() + 30000 };
                return prev;
              });
            } else if (shouldShowCommandStatus && stationId) {
              debugEjectUi('Eject response failed', {
                action: data.action,
                stationId,
                moduleRef,
                slotRef,
                chargerId,
                message: data.status_en,
              });
              flashFailedEjectSlot(stationId, moduleRef, slotRef);
            }

          } else if (data.action && (data.action.includes('lock') || data.action.includes('unlock'))) { // LOCK/UNLOCK LOGIC
            const isSuccess = data.status == 1;
            const stationId = data.kiosk;
            const moduleIdNum = data.module ? parseInt(data.module, 10) : null;
            const slotId = data.slot ? parseInt(data.slot, 10) : null;

            const isExplicitStatusUpdate = data.status === 'locked' || data.status === 'unlocked';
            const isImplicitSuccessUpdate = isSuccess && (data.status_en?.includes('locked') || data.status_en?.includes('unlocked'));

            if (isExplicitStatusUpdate || isImplicitSuccessUpdate) {
              setScopedCommandStatus(data, { state: 'success', message: data.status_en });

              let isNowLocked = undefined;
              if (data.status === 'locked') {
                isNowLocked = true;
              } else if (data.status === 'unlocked' || (isSuccess && data.status_en?.includes('unlocked'))) {
                isNowLocked = false;
              } else {
                isNowLocked = true;
              }

              console.log(`[4. CONFIRMATION] Flipping color for ${stationId}-${moduleIdNum}-${slotId}. New state isLocked: ${isNowLocked}`);
              setAllStationsData(prevStations => prevStations.map(s =>
                s.stationid !== stationId ? s : {
                  ...s,
                  modules: s.modules.map(m => {
                    if (!m.id.endsWith(`m${moduleIdNum}`)) return m;
                    return { ...m, slots: m.slots.map(sl => sl.position === slotId ? { ...sl, isLocked: isNowLocked } : sl) };
                  })
                }
              ));

              console.log(`[5. IGNORE] Ignoring Firestore updates for ${stationId} for 20s.`);
              ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationId]: Date.now() + 20000 };

              setLockingSlots(prev => prev.filter(l => !(l.stationid === stationId && l.moduleid.toString().endsWith(`m${moduleIdNum}`) && l.slotid === slotId)));
            } else if (data.status_en) {
              setScopedCommandStatus(data, { state: isSuccess ? 'success' : 'error', message: data.status_en });
            }
          } else if (data.action === 'enable' || data.action === 'disable') {
            const isSuccess = data.status == 1;
            setScopedCommandStatus(data, { state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? 'Command successful!' : 'Command failed.') });
            if (isSuccess && data.kiosk) {
              const stationId = data.kiosk;
              const isDisabled = data.action === 'disable';
              setAllStationsData(prevStations => prevStations.map(station =>
                station.stationid === stationId ? { ...station, disabled: isDisabled ? { status: true } : null } : station
              ));
            }
          } else if (data.action === 'set volume' || data.action === 'volume') {
            const isSuccess = Number(data.status) === 1 || data.status === 'accepted' || data.status === 'success';
            const stationId = data.kiosk || data.stationid;
            const audioVolume = normalizeAudioVolume(data.volume ?? data.data, null);
            setScopedCommandStatus(data, {
              state: isSuccess ? 'success' : 'error',
              message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')),
            });
            if (isSuccess && stationId && audioVolume !== null) {
              setAllStationsData((prevStations) =>
                prevStations.map((station) =>
                  station.stationid === stationId ? withAudioHardwareState(station, audioVolume) : station
                )
              );
            }
          } else if (data.action === 'update module') {
            const isSuccess = Number(data.status) === 1 || data.status === 'accepted';
            setScopedCommandStatus(data, { state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')) });
          } else if (data.action === 'reboot module' || data.action === 'module reboot') {
            const isSuccess = Number(data.status) === 1 || data.status === 'accepted' || data.status === 'success';
            setScopedCommandStatus(data, { state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')) });
          } else if (data.action === 'odroid reboot') {
            setScopedCommandStatus(data, { state: 'success', message: data.status_en });
          } else if (data.action === 'hotspot' && data.stationid) {
            const isSuccess = data.status === 1;
            setScopedCommandStatus(data, { state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('command_successful') : t('command_failed')) });
          } else if (data.status_en && data.status_en.includes('flow for kiosk')) {
            const messageParts = data.status_en.split(' ');
            const kioskId = messageParts[3];
            const newFlowVersion = messageParts.slice(8).join(' ');

            if (kioskId && newFlowVersion) {
              setAllStationsData(prevKiosks =>
                prevKiosks.map(station =>
                  station.stationid === kioskId
                    ? { ...station, fversion: newFlowVersion }
                    : station
                )
              );
              setScopedCommandStatus(data, { state: 'success', message: data.status_en });
            }
          } else if (data.status_en && data.status_en.includes('UI for kiosk')) {
            const messageParts = data.status_en.split(' ');
            const kioskId = messageParts[3];
            const newUiVersion = messageParts.slice(8).join(' ');

            if (kioskId && newUiVersion) {
              setAllStationsData(prevKiosks =>
                prevKiosks.map(station =>
                  station.stationid === kioskId
                    ? { ...station, uiVersion: newUiVersion }
                    : station
                )
              );
              setScopedCommandStatus(data, { state: 'success', message: data.status_en });
            }
          } else if (data.action && data.action.includes('change')) {
            const statusValue = data.statuscode ?? data.status;
            const isSuccess = Number(statusValue) === 1 || statusValue === 'success' || statusValue === 'accepted';
            const isPending = Number(statusValue) === 2 || statusValue === 'pending';
            let toastState = 'error';
            if (isSuccess) toastState = 'success';
            if (isPending) toastState = 'pending';

            setScopedCommandStatus(data, { state: toastState, message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')) });

            if (isSuccess && data.kiosk && typeof data.kiosk === 'object') {
              const [normalizedKiosk] = normalizeKioskData([data.kiosk]);
              const stationId = normalizedKiosk.stationid;

              setAllStationsData(prevKiosks =>
                prevKiosks.map(station =>
                  station.stationid === stationId ? normalizedKiosk : station
                )
              );
            }
          } else if (data.action === 'refund') {
            const isSuccess = isSuccessfulRefundStatus(refundStatus);
            const isPending = isPendingRefundStatus(refundStatus);
            const statusState = isSuccess ? 'success' : (isPending ? 'pending' : 'error');
            setScopedCommandStatus(data, { state: statusState, message: data.status_en || (isSuccess ? t('refund_success') : (isPending ? t('pending') : t('refund_failed'))) });
          }

        } catch (e) {
          console.error("Error handling WebSocket message in App.jsx:", e);
          setScopedCommandStatus(null, { state: 'error', message: t('invalid_response') });
        }
      };

      socket.onerror = (err) => {
        console.error("WebSocket error:", err);
        socket.close();
      };
      socket.onclose = () => {
        if (ws.current === socket) {
          ws.current = null;
        }
        if (!isCleaningUp) {
          reconnectTimer = setTimeout(connect, 1000);
        }
      };
    };

    connect();

    return () => {
      isCleaningUp = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      const socket = ws.current;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
      if (ws.current === socket) {
        ws.current = null;
      }
    };
  }, [token, clientInfo, t, clearEjectCommandState, debugEjectUi, flashFailedEjectSlot, setScopedCommandStatus]);

  // Login handler (kept for LoginPage)
  const handleLogin = () => {
    setPage('dashboard');
  };

  const dashboard = (
    <DashboardPage
      token={token}
      onLogout={handleLogout}
      clientInfo={clientInfo}
      t={t}
      language={language}
      setLanguage={setLanguage}
      onNavigateToAdmin={() => setPage('admin')}
      onNavigateToAiBooths={() => setPage('ai-booths')}
      onNavigateToBinding={() => setPage('binding')}
      onNavigateToRentals={(selection = 'today') => {
        const period = typeof selection === 'string' ? selection : selection?.period;
        const stationIds = Array.isArray(selection?.stationIds) ? selection.stationIds : [];
        const searchTerm = typeof selection?.searchTerm === 'string' ? selection.searchTerm : '';
        setRentalsInitialPeriod(['today', '7days', '30days'].includes(period) ? period : 'today');
        setRentalsInitialStationIds(stationIds);
        setRentalsInitialSearch(searchTerm);
        setPage('rentals');
      }}
      onNavigateToChargers={(searchTerm = '') => {
        setChargerSearchTerm(normalizeNavigationSearch(searchTerm));
        setPage('chargers');
      }}
      initialSearch={dashboardSearchTerm}
      onNavigateToReporting={() => setPage('reporting')}
      onNavigateToTesting={() => setPage('testing')}
      onNavigateToUiProfiles={() => setPage('ui-profiles')}
      onNavigateToAnalytics={onNavigateToAnalytics}
      onNavigateToKioskEditor={() => setPage('kiosk-editor')}
      rentalData={rentalData}
      allStationsData={dedupedStationsData}
      setAllStationsData={setAllStationsData}
      ngrokModalOpen={ngrokModalOpen}
      setNgrokModalOpen={setNgrokModalOpen}
      ngrokInfo={ngrokInfo}
      setNgrokInfo={setNgrokInfo}
      onCommand={onCommand}
      commandStatus={commandStatus}
      setCommandStatus={setCommandStatus}
      firestoreError={firestoreError}
      pendingSlots={pendingSlots}
      setPendingSlots={setPendingSlots}
      ejectingSlots={ejectingSlots}
      setEjectingSlots={setEjectingSlots}
      failedEjectSlots={failedEjectSlots}
      lockingSlots={lockingSlots}
      initialStatusCheck={initialStatusCheck}
      setInitialStatusCheck={setInitialStatusCheck}
      serverFlowVersion={clientInfo?.serverFlowVersion}
      serverUiVersion={clientInfo?.serverUiVersion}
      ignoredKiosksRef={ignoredKiosksRef}
      manageIgnoredKiosk={manageIgnoredKiosk}
      kiosksReady={kiosksReady}
    />
  );

  const renderPage = () => {
    // ✅ Don’t render authenticated routes until Firebase Auth initializes
    if (!authReady) {
      return (
        <div className="flex items-center justify-center h-screen bg-gray-100">
          <div className="text-xl font-semibold text-gray-700">Checking sign-in...</div>
        </div>
      );
    }

    if (auth.currentUser && (!token || !clientInfo)) {
      return (
        <div className="flex items-center justify-center h-screen bg-gray-100">
          <div className="text-xl font-semibold text-gray-700">Checking sign-in...</div>
        </div>
      );
    }

    // ✅ Must have firebase session + token + profile
    if (!auth.currentUser || !token || !clientInfo) {
      return <LoginPage onLogin={handleLogin} />;
    }

    const hasTestingAccess = clientInfo.username === 'chargerent' || clientInfo.features?.testing === true;
    const hasBindingAccess = clientInfo.username === 'chargerent' || clientInfo.features?.binding === true || clientInfo.commands?.binding === true;
    const hasReportingAccess = clientInfo.isAdmin || clientInfo.features?.reporting === true;
    const hasMediaAccess = clientInfo.isAdmin || clientInfo.features?.media === true;
    const hasUiProfilesAccess = clientInfo.isAdmin || clientInfo.features?.ui_editor === true || clientInfo.commands?.['client edit'] === true;
    const canOpenAdminTools = clientInfo.isAdmin || clientInfo.commands?.['client edit'] === true || hasMediaAccess || hasUiProfilesAccess;
    const hasAiBoothsAccess = canOpenAdminTools;
    const isRegularReportingUser = !clientInfo.isAdmin && clientInfo.role !== 'partner';

    switch (page) {
      case 'admin':
        if (!canOpenAdminTools) {
          return dashboard;
        }

        return (
          <AdminPage
            token={token}
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToProvisionPage={() => setPage('provision')}
            onNavigateToAgreement={() => setPage('agreement')}
            onNavigateToTemplates={() => setPage('templates')}
            onNavigateToMedia={() => setPage('media')}
            onNavigateToUiProfiles={() => setPage('ui-profiles')}
            onNavigateToAiBooths={() => setPage('ai-booths')}
            onNavigateToPayouts={() => setPage('payouts')}
            currentUser={clientInfo}
            t={t}
          />
        );
      case 'payouts':
        if (!clientInfo.isAdmin) {
          return dashboard;
        }

        return (
          <PayoutsPage
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAdmin={() => setPage('admin')}
            currentUser={clientInfo}
            t={t}
          />
        );
      case 'ui-profiles':
        if (!hasUiProfilesAccess) {
          return dashboard;
        }

        return (
          <UiProfilesPage
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAdmin={() => setPage('admin')}
            currentUser={clientInfo}
            allStationsData={dedupedStationsData}
            referenceTime={latestTimestamp}
            onCommand={onCommand}
            t={t}
          />
        );
      case 'ai-booths':
        if (!hasAiBoothsAccess) {
          return dashboard;
        }

        return (
          <AiBoothsPage
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAdmin={() => setPage('admin')}
            onNavigateToProvisionPage={() => setPage('provision')}
            allStationsData={dedupedStationsData}
            t={t}
          />
        );
      case 'media':
        if (!hasMediaAccess) {
          return dashboard;
        }

        return (
          <MediaPage
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAdmin={() => setPage('admin')}
            currentUser={clientInfo}
            allStationsData={dedupedStationsData}
            t={t}
          />
        );
      case 'binding':
        if (!hasBindingAccess) {
          return dashboard;
        }

        return (
          <BindingPage
            t={t}
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAdmin={() => setPage('admin')}
            currentUser={clientInfo}
            allStationsData={dedupedStationsData}
          />
        );
      case 'agreement':
        return (
          <ProfessionalAgreementPDF
            t={t}
            language={language}
            setLanguage={setLanguage}
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
          />
        );
      case 'templates':
        return (
          <TemplatesPage
            t={t}
            onLogout={handleLogout}
            onNavigateToAdmin={() => setPage('admin')}
            currentUser={clientInfo}
          />
        );
      case 'rentals':
        return (
          <RentalsPage
            onNavigateToProvisionPage={() => setPage('provision')}
            onNavigateToDashboard={(searchTerm = '') => {
              setDashboardSearchTerm(normalizeNavigationSearch(searchTerm));
              setPage('dashboard');
            }}
            onNavigateToChargers={(searchTerm = '') => {
              setChargerSearchTerm(normalizeNavigationSearch(searchTerm));
              setPage('chargers');
            }}
            clientInfo={clientInfo}
            rentalData={rentalData}
            allStationsData={dedupedStationsData}
            t={t}
            language={language}
            setLanguage={setLanguage}
            onLogout={handleLogout}
            onCommand={onCommand}
            commandStatus={commandStatus}
            setCommandStatus={setCommandStatus}
            referenceTime={latestTimestamp}
            initialPeriod={rentalsInitialPeriod}
            initialStationIds={rentalsInitialStationIds}
            initialSearch={rentalsInitialSearch}
          />
        );
      case 'chargers':
        return (
          <ChargersPage
            onNavigateToDashboard={(searchTerm = '') => {
              setDashboardSearchTerm(normalizeNavigationSearch(searchTerm));
              setPage('dashboard');
            }}
            rentalData={rentalData}
            kioskData={dedupedStationsData}
            t={t}
            language={language}
            setLanguage={setLanguage}
            onLogout={handleLogout}
            onCommand={onCommand}
            commandStatus={commandStatus}
            setCommandStatus={setCommandStatus}
            clientInfo={clientInfo}
            initialSearch={chargerSearchTerm}
          />
        );
      case 'reporting':
        if (!hasReportingAccess) {
          return dashboard;
        }

        return (
          <ReportingPage
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAnalytics={onNavigateToAnalytics}
            onLogout={handleLogout}
            t={t}
            rentalData={rentalData}
            allStationsData={dedupedStationsData}
            clientInfo={clientInfo}
            userMode={isRegularReportingUser}
          />
        );
      case 'analytics':
        return (
          <AnalyticsPage
            allStationsData={dedupedStationsData}
            rentalData={rentalData}
            initialData={analyticsInitialData}
            onNavigateToDashboard={() => setPage('dashboard')}
            onLogout={handleLogout}
            t={t}
          />
        );
      case 'testing':
        if (!hasTestingAccess) {
          return dashboard;
        }

        return (
          <TestingPage
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            clientInfo={clientInfo}
            t={t}
            language={language}
            setLanguage={setLanguage}
            rentalData={rentalData}
            allStationsData={dedupedStationsData}
            onCommand={onCommand}
            commandStatus={commandStatus}
            setCommandStatus={setCommandStatus}
            firestoreError={firestoreError}
            serverFlowVersion={clientInfo?.serverFlowVersion}
            serverUiVersion={clientInfo?.serverUiVersion}
            pendingSlots={pendingSlots}
            ejectingSlots={ejectingSlots}
            setEjectingSlots={setEjectingSlots}
            failedEjectSlots={failedEjectSlots}
            lockingSlots={lockingSlots}
            manageIgnoredKiosk={manageIgnoredKiosk}
            ngrokModalOpen={ngrokModalOpen}
            setNgrokModalOpen={setNgrokModalOpen}
            ngrokInfo={ngrokInfo}
            kiosksReady={kiosksReady}
          />
        );
      case 'kiosk-editor':
        return (
          <KioskEditorPage
            token={token}
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            t={t}
            kioskData={dedupedStationsData}
            onCommand={onCommand}
          />
        );
      case 'provision':
        return (
          <ProvisionPage
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAiBooths={() => setPage('ai-booths')}
            t={t}
            onCommand={onCommand}
            allStationsData={allStationsData}
            lastProvisionedId={lastProvisionedId}
            commandStatus={commandStatus}
            setCommandStatus={setCommandStatus}
          />
        );
      case 'dashboard':
      default:
        return dashboard;
    }
  };

  return (
    <>
      <InactivityModal
        isOpen={showWarning}
        onStay={handleStayLoggedIn}
        onLogout={handleLogout}
        countdown={60}
        t={t}
      />
      <ErrorBoundary>
        <Suspense fallback={<RouteLoadingState />}>
          {renderPage()}
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

export default App;
