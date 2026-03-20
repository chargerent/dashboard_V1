// src/App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useIdleTimer } from './hooks/useIdleTimer';
import InactivityModal from './components/InactivityModal';
import { subscribeUserToPush } from './push';

import { translations } from './utils/translations';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { normalizeKioskData } from './utils/helpers.js';
import KioskEditorPage from './pages/KioskEditorPage.jsx';
import RentalsPage from './pages/RentalsPage.jsx';
import ChargersPage from './pages/ChargersPage.jsx';
import ProvisionPage from './pages/ProvisionPage.jsx';
import ProfessionalAgreementPDF from './pages/AgreementPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ReportingPage from './pages/ReportingPage.jsx';
import BindingPage from './pages/BindingPage.jsx';
import TemplatesPage from './pages/TemplatesPage.jsx';
import TestingPage from './pages/TestingPage.jsx';
import { callFunctionWithAuth } from './utils/callableRequest.js';
import { markStartupStep, measureStartupDuration } from './utils/startupTrace.js';

// 🔥 firebase-config must export BOTH db and auth
import { db, auth } from './firebase-config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, query, where } from 'firebase/firestore';

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

function slotStateMatchesResponse(slotState, stationId, moduleRef, slotRef) {
  if (!slotState || slotState.stationid !== stationId) return false;
  if (!moduleMatchesResponse({ id: slotState.moduleid }, moduleRef)) return false;

  const numericSlotId = Number(slotRef);
  if (!Number.isFinite(numericSlotId)) return true;

  return Number(slotState.slotid) === numericSlotId;
}

function createCommandRequestId(action, stationid, moduleid) {
  const prefix = String(action || 'command').replace(/\s+/g, '-').toLowerCase();
  const targetStation = String(stationid || 'unknown').trim() || 'unknown';
  const targetModule = String(moduleid || 'na').trim() || 'na';
  const randomSegment = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${targetStation}-${targetModule}-${Date.now()}-${randomSegment}`;
}

function buildClientInfoFromProfile(profile, uid) {
  if (!profile) return null;

  const username = profile.username || '';
  const clientId = profile.clientId || '';
  const partner = !!profile.partner;
  const role = String(profile.role || (username === 'chargerent' ? 'admin' : 'user')).toLowerCase();
  const isAdmin = role === 'admin' || username === 'chargerent';

  const defaultFeatures = {
    rentals: false,
    details: false,
    stationid: true,
    address: true,
    country: 'all',
    status: false,
    pricing: false,
    reporting: false,
    testing: false
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
    disable: false,
    "client edit": false
  };

  let features = { ...defaultFeatures, ...(profile.features || {}) };
  const payloadCommands = profile.commands || profile.Commands;
  let commands = { ...defaultCommands, ...(payloadCommands || {}) };

  // Admin override
  if (isAdmin) {
    features = {
      rentals: true,
      details: true,
      stationid: true,
      address: true,
      country: 'all',
      status: true,
      pricing: true,
      reporting: true,
      ...(profile.features || {})
    };
    commands = {
      edit: true,
      lock: true,
      eject: true,
      eject_multiple: true,
      binding: true,
      updates: true,
      connectivity: true,
      reboot: true,
      reload: true,
      disable: true,
      "client edit": true,
      ...(payloadCommands || {})
    };
  }

  // Normalize language
  features.country = features.country || features.Country || 'all';
  features.defaultlanguage = (features.defaultlanguage || features.defaultLanguage || 'en').toString().toLowerCase();
  features.testing = username === 'chargerent' || features.testing === true;

  return {
    uid,
    username,
    clientId,
    features,
    commands,
    partner,
    isAdmin,
    role,
    serverFlowVersion: profile.serverFlowVersion,
    serverUiVersion: profile.serverUiVersion
  };
}

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const isExpired = Date.now() >= payload.exp * 1000;
    if (isExpired) console.log("Authentication token has expired.");
    return isExpired;
  } catch (e) {
    console.error("Failed to parse token, treating as expired:", e);
    return true;
  }
}

function App() {
  // ✅ Gate rendering until Firebase Auth has initialized
  const [authReady, setAuthReady] = useState(false);

  // Firebase ID token
  const [token, setToken] = useState(localStorage.getItem('dashboardToken'));
  const [clientInfo, setClientInfo] = useState(null);
  const [language, setLanguage] = useState('en');
  const [page, setPage] = useState('dashboard'); // 'dashboard', 'admin', 'binding', 'templates', 'kiosk-editor', 'rentals', 'chargers', 'provision', 'reporting', 'analytics', 'testing'
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
  const startupListenerRef = useRef({ kiosksLogged: false, rentalsLogged: false });

  const [lockingSlots, setLockingSlots] = useState([]);
  const [allStationsData, setAllStationsData] = useState([]);
  const [ngrokInfo, setNgrokInfo] = useState(null);
  const [kiosksReady, setKiosksReady] = useState(false);

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

  const clearEjectCommandState = useCallback((stationId, moduleRef, slotRef) => {
    if (!stationId || !moduleRef) return;

    setEjectingSlots(prev =>
      prev.filter(slot => !slotStateMatchesResponse(slot, stationId, moduleRef, slotRef))
    );
    setPendingSlots(prev =>
      prev.filter(slot => !slotStateMatchesResponse(slot, stationId, moduleRef, slotRef))
    );
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await signOut(auth);
    } catch (e) {
      // ignore
    }
    localStorage.removeItem('dashboardToken');
    setToken(null);
    setClientInfo(null);
    setLanguage('en');
    setPage('dashboard');
    setInitialStatusCheck(false);
  }, []);

  useEffect(() => {
    return () => {
      failedEjectTimersRef.current.forEach(timer => clearTimeout(timer));
      failedEjectTimersRef.current.clear();
    };
  }, []);

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
      markStartupStep('auth.onAuthStateChanged', {
        hasUser: !!user,
        uid: user?.uid || null,
      });

      if (!user) {
        localStorage.removeItem('dashboardToken');
        setToken(null);
        setClientInfo(null);
        setLanguage('en');
        setInitialStatusCheck(false);
        setAllStationsData([]);
        setRentalData([]);
        setKiosksReady(false);
        markStartupStep('auth.signedOut');
        setAuthReady(true);
        return;
      }

      try {
        const tokenStartedAt = performance.now();
        const idToken = await user.getIdToken(true);
        markStartupStep('auth.getIdToken.resolved', {
          durationMs: measureStartupDuration(tokenStartedAt),
        });
        let tokenToUse = idToken;

        const profileStartedAt = performance.now();
        const snap = await getDoc(doc(db, 'users', user.uid));
        markStartupStep('auth.profileFetch.resolved', {
          durationMs: measureStartupDuration(profileStartedAt),
          exists: snap.exists(),
        });
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

        try {
          await callFunctionWithAuth('auth_syncOwnClaims');
          tokenToUse = await user.getIdToken(true);
        } catch (syncError) {
          console.warn('Unable to sync auth claims during bootstrap:', syncError);
        }

        localStorage.setItem('dashboardToken', tokenToUse);
        setToken(tokenToUse);

        const info = buildClientInfoFromProfile(profile, user.uid);
        setClientInfo(info);
        setLanguage(info?.features?.defaultlanguage || 'en');
        markStartupStep('auth.bootstrap.complete', {
          uid: user.uid,
          language: info?.features?.defaultlanguage || 'en',
        });
        setAuthReady(true);
      } catch (e) {
        console.error('Auth bootstrap failed:', e);
        markStartupStep('auth.bootstrap.error', {
          message: e?.message || 'unknown error',
        });
        await handleLogout();
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, [handleLogout]);

  // Effect to handle token expiration when tab/PWA becomes visible again
  useEffect(() => {
    const checkTokenOnFocus = async () => {
      const currentToken = localStorage.getItem('dashboardToken');
      if (isTokenExpired(currentToken)) {
        await handleLogout();
        return;
      }

      // Refresh token
      try {
        if (auth.currentUser) {
          const refreshed = await auth.currentUser.getIdToken(true);
          localStorage.setItem('dashboardToken', refreshed);
          setToken(refreshed);
        }
      } catch (e) {
        await handleLogout();
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

  // ---------------------------------------------
  // Firestore listeners
  // ---------------------------------------------
  useEffect(() => {
    // ✅ Require actual firebase session too
    if (!token || !auth.currentUser || !clientInfo) return;

    setKiosksReady(false);
    startupListenerRef.current = { kiosksLogged: false, rentalsLogged: false };
    const listenersStartedAt = performance.now();
    markStartupStep('firestore.listeners.attach', {
      uid: auth.currentUser.uid,
    });

    // Step 1: Real-time listener for raw Kiosk Data from Firestore
    const kiosksCollectionRef = collection(db, 'kiosks');
    const unsubscribeKiosks = onSnapshot(kiosksCollectionRef, (querySnapshot) => {
      const now = Date.now();
      const firestoreKiosksData = querySnapshot.docs.map(docSnap => ({ stationid: docSnap.id, ...docSnap.data() }));

      if (firestoreError) setFirestoreError(null); // Clear error on new data
      setKiosksReady(true);
      if (!startupListenerRef.current.kiosksLogged) {
        startupListenerRef.current.kiosksLogged = true;
        markStartupStep('firestore.kiosks.firstSnapshot', {
          durationMs: measureStartupDuration(listenersStartedAt),
          count: firestoreKiosksData.length,
        });
      }

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
      markStartupStep('firestore.kiosks.error', {
        message: error?.message || 'unknown error',
      });
      setFirestoreError('Failed to connect to kiosk data. The dashboard may be out of date.');
      console.error("Error fetching real-time kiosks: ", error);
    });

    // Step 2: Real-time listener for Rental Data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateThreshold = thirtyDaysAgo.toISOString();
    const rentalQuery = query(collection(db, 'rentals'), where('rentalTime', '>=', dateThreshold));
    const unsubscribeRentals = onSnapshot(rentalQuery, (querySnapshot) => {
      const rentals = querySnapshot.docs.map(docSnap => ({ rawid: docSnap.id, ...docSnap.data() }));
      if (firestoreError) setFirestoreError(null);
      if (!startupListenerRef.current.rentalsLogged) {
        startupListenerRef.current.rentalsLogged = true;
        markStartupStep('firestore.rentals.firstSnapshot', {
          durationMs: measureStartupDuration(listenersStartedAt),
          count: rentals.length,
        });
      }
      setRentalData(rentals);
    }, (error) => {
      markStartupStep('firestore.rentals.error', {
        message: error?.message || 'unknown error',
      });
      setFirestoreError('Failed to connect to rental data. The dashboard may be out of date.');
      console.error("Error fetching real-time rentals: ", error);
    });

    return () => {
      unsubscribeKiosks();
      unsubscribeRentals();
    };
  }, [token, clientInfo, firestoreError]);

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

  const manageIgnoredKiosk = useCallback((kioskId, shouldIgnore) => {
    if (shouldIgnore) {
      ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [kioskId]: Date.now() + 3600000 }; // Ignore for 1 hour
    } else {
      const newIgnored = { ...ignoredKiosksRef.current };
      delete newIgnored[kioskId];
      ignoredKiosksRef.current = newIgnored;
    }
  }, []);

  const onCommand = useCallback((stationid, action, moduleid = null, provisionid = null, uiVersion = null, details = null) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const timerequested = Date.now();
      const requestId = createCommandRequestId(action, stationid, moduleid);
      const baseData = {
        stationid,
        action,
        requestId,
        timerequested,
        ...(provisionid && { provisionid }),
        ...(uiVersion && { version: uiVersion }),
        ...(moduleid && { moduleid }),
      };

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
          commandData = { ...baseData, slotid: details?.slotid };
          break;
        case 'lock module':
          commandData = { ...baseData };
          break;
        case 'eject specific':
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
          commandData = { ...baseData, ...details };
          break;
        case 'refund':
          commandData = { ...baseData, ...details };
          break;
        case 'provision':
          commandData = { ...baseData, kiosk: details.kiosk };
          break;
        default:
          commandData = { ...baseData, ...(moduleid && { moduleid }), ...(details && { kiosk: details.kiosk, autoGeocode: details.autoGeocode }) };
      }

      const message = {
        type: 'command',
        token: token,
        data: commandData
      };

      ws.current.send(JSON.stringify(message));
      console.log('[WS Send]', message);

      console.log(`[2. IGNORE] Ignoring Firestore updates for ${stationid} for 30s.`);
      ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationid]: Date.now() + 30000 };

      setCommandStatus({ state: 'sending', message: t('sending_command') });
    } else {
      setCommandStatus({ state: 'error', message: t('connection_lost') });
    }
  }, [token, t]);

  // ---------------------------------------------
  // WebSocket connect (FULL HANDLER INCLUDED)
  // ---------------------------------------------
  useEffect(() => {
    if (!token || !clientInfo) return;

    let isCleaningUp = false;

    const connect = () => {
      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        return;
      }
      ws.current = new WebSocket(`wss://chargerentstations.com/ws/commands?token=${token}`);

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WS Receive]', data);

          if (data.action === 'refund' && data.status === 'approved' && (data.orderId || data.transactionid)) {
            setRentalData(prevData =>
              prevData.map(rental =>
                (rental.orderid === data.orderId || rental.rawid === data.transactionid)
                  ? {
                    ...rental,
                    status: 'refunded',
                    refundStatus: data.refund_status || 'approved',
                    refundAmount: data.refund_amount,
                    refundDate: data.refund_date || new Date().toISOString()
                  }
                  : rental
              )
            );
          }

          if (data.action === 'ngrok connect' || data.action === 'ngrok disconnect' || data.action === 'ssh connect' || data.action === 'ssh disconnect') {
            const isSuccess = data.status == 1;
            setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')) });
            if (isSuccess) {
              const isConnecting = data.action.endsWith('connect');
              const type = data.action.startsWith('ngrok') ? 'ngrok' : 'ssh';
              setAllStationsData(prev => prev.map(station =>
                station.stationid === data.kiosk ? { ...station, [type]: isConnecting } : station
              ));
              if (isConnecting && type === 'ngrok' && data.status_en && data.action === 'ngrok connect') {
                setNgrokInfo({ kioskId: data.kiosk, message: data.status_en });
                setNgrokModalOpen(true);
              }
            }
          } else if (data.action === 'provision') {
            const isSuccess = data.status_en === 'kiosk provisioned on server';
            setCommandStatus({ state: isSuccess ? 'success' : 'pending', message: data.status_en });

            if (isSuccess && data.admin) {
              setLastProvisionedId(data.admin);
            }
          } else if (data.action && (data.action.startsWith('eject') || data.action === 'rent' || data.action === 'vend')) { // EJECT LOGIC
            const isSuccess = data.status == 1;
            const fallbackFailureMessage = t('eject_failed');
            setCommandStatus({
              state: isSuccess ? 'success' : 'error',
              message: data.status_en || (isSuccess ? t('command_success') : fallbackFailureMessage)
            });

            const stationId = data.kiosk || data.stationid;
            const moduleRef = data.moduleid || data.module;
            const slotRef = data.slot ?? data.slotid;
            const chargerId = data.chargerid ?? data.sn;

            clearEjectCommandState(stationId, moduleRef, slotRef);

            if (isSuccess && stationId) {
              setAllStationsData(prevStations => {
                const updatedStations = prevStations.map(station => {
                  if (station.stationid !== stationId) return station;

                  const targetModule = findMatchingModule(station.modules, moduleRef, chargerId);
                  const targetSlot = findMatchingSlot(targetModule, slotRef, chargerId);

                  if (targetModule && targetSlot) {
                    clearEjectCommandState(stationId, targetModule.id, targetSlot.position);
                  }

                  return {
                    ...station,
                    modules: station.modules.map(module =>
                      module.id === targetModule?.id
                        ? {
                            ...module,
                            slots: module.slots.map(slot =>
                              slot.position === targetSlot?.position
                                ? { ...slot, sn: 0, batteryLevel: 0, chargingCurrent: 0, sstat: '0C', cmos: null }
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
            } else if (stationId) {
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
              setCommandStatus({ state: 'success', message: data.status_en });

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
              setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en });
            }
          } else if (data.action === 'enable' || data.action === 'disable') {
            const isSuccess = data.status == 1;
            setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? 'Command successful!' : 'Command failed.') });
            if (isSuccess && data.kiosk) {
              const stationId = data.kiosk;
              const isDisabled = data.action === 'disable';
              setAllStationsData(prevStations => prevStations.map(station =>
                station.stationid === stationId ? { ...station, disabled: isDisabled ? { status: true } : null } : station
              ));
            }
          } else if (data.action === 'odroid reboot') {
            setCommandStatus({ state: 'success', message: data.status_en });
          } else if (data.action === 'hotspot' && data.stationid) {
            const isSuccess = data.status === 1;
            setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('command_successful') : t('command_failed')) });
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
              setCommandStatus({ state: 'success', message: data.status_en });
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
              setCommandStatus({ state: 'success', message: data.status_en });
            }
          } else if (data.action && data.action.includes('change')) {
            const isSuccess = data.statuscode == 1;
            const isPending = data.statuscode == 2;
            let toastState = 'error';
            if (isSuccess) toastState = 'success';
            if (isPending) toastState = 'pending';

            setCommandStatus({ state: toastState, message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')) });

            if (isSuccess && data.kiosk) {
              const [normalizedKiosk] = normalizeKioskData([data.kiosk]);
              const stationId = normalizedKiosk.stationid;

              setAllStationsData(prevKiosks =>
                prevKiosks.map(station =>
                  station.stationid === stationId ? normalizedKiosk : station
                )
              );
            }
          } else if (data.action === 'refund') {
            const isSuccess = data.status === 'approved';
            setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('refund_success') : t('refund_failed')) });
          }

        } catch (e) {
          console.error("Error handling WebSocket message in App.jsx:", e);
          setCommandStatus({ state: 'error', message: t('invalid_response') });
        }
      };

      ws.current.onerror = (err) => {
        console.error("WebSocket error:", err);
        ws.current.close();
      };
      ws.current.onclose = () => {
        if (!isCleaningUp) {
          setTimeout(connect, 1000);
        }
      };
    };

    connect();

    return () => {
      isCleaningUp = true;
      if (ws.current) {
        if (ws.current.readyState === WebSocket.OPEN) {
          ws.current.close();
        }
      }
    };
  }, [token, clientInfo, t, clearEjectCommandState, flashFailedEjectSlot]);

  // Login handler (kept for LoginPage)
  const handleLogin = () => {
    markStartupStep('login.onLogin');
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
      onNavigateToBinding={() => setPage('binding')}
      onNavigateToRentals={() => setPage('rentals')}
      onNavigateToChargers={() => setPage('chargers')}
      onNavigateToReporting={() => setPage('reporting')}
      onNavigateToTesting={() => setPage('testing')}
      onNavigateToAnalytics={onNavigateToAnalytics}
      onNavigateToKioskEditor={() => setPage('kiosk-editor')}
      rentalData={rentalData}
      allStationsData={allStationsData}
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

    switch (page) {
      case 'admin':
        return (
          <AdminPage
            token={token}
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToProvisionPage={() => setPage('provision')}
            onNavigateToAgreement={() => setPage('agreement')}
            onNavigateToTemplates={() => setPage('templates')}
            currentUser={clientInfo}
            t={t}
          />
        );
      case 'binding':
        return (
          <BindingPage
            t={t}
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAdmin={() => setPage('admin')}
            currentUser={clientInfo}
            allStationsData={allStationsData}
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
            onNavigateToDashboard={() => setPage('dashboard')}
            clientInfo={clientInfo}
            rentalData={rentalData}
            allStationsData={allStationsData}
            t={t}
            language={language}
            setLanguage={setLanguage}
            onLogout={handleLogout}
            onCommand={onCommand}
            referenceTime={latestTimestamp}
          />
        );
      case 'chargers':
        return (
          <ChargersPage
            onNavigateToDashboard={() => setPage('dashboard')}
            rentalData={rentalData}
            kioskData={allStationsData}
            t={t}
            language={language}
            setLanguage={setLanguage}
            onLogout={handleLogout}
            onCommand={onCommand}
            commandStatus={commandStatus}
            setCommandStatus={setCommandStatus}
            clientInfo={clientInfo}
          />
        );
      case 'reporting':
        return (
          <ReportingPage
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAnalytics={onNavigateToAnalytics}
            onLogout={handleLogout}
            t={t}
            rentalData={rentalData}
            allStationsData={allStationsData}
            clientInfo={clientInfo}
          />
        );
      case 'analytics':
        return (
          <AnalyticsPage
            allStationsData={allStationsData}
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
            allStationsData={allStationsData}
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
            kioskData={allStationsData}
            onCommand={onCommand}
          />
        );
      case 'provision':
        return (
          <ProvisionPage
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            t={t}
            onCommand={onCommand}
            allStationsData={allStationsData}
            lastProvisionedId={lastProvisionedId}
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
      {renderPage()}
    </>
  );
}

export default App;
