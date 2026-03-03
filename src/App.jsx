// src/App.jsx
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useIdleTimer } from './hooks/useIdleTimer';
import InactivityModal from './components/InactivityModal';
import ErrorBoundary from './components/ErrorBoundary';
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

// 🔥 firebase-config must export BOTH db and auth
import { db, auth } from './firebase-config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, query, where } from 'firebase/firestore';

function buildClientInfoFromProfile(profile, uid) {
  if (!profile) return null;

  const username = profile.username || '';
  const clientId = profile.clientId || '';
  const role = profile.role || (username === 'chargerent' ? 'admin' : 'user');

  const defaultFeatures = {
    rentals: false,
    details: false,
    stationid: true,
    address: true,
    country: 'all',
    status: false,
    pricing: false,
    reporting: false
  };

  const defaultCommands = {
    edit: false,
    lock: false,
    eject: false,
    eject_multiple: false,
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

  // Admin override — do NOT spread profile values on top; stored false values would override these
  if (role === 'admin' || username === 'chargerent') {
    features = {
      rentals: true,
      details: true,
      stationid: true,
      address: true,
      status: true,
      pricing: true,
      reporting: true,
      search: true,
      lease_revenue: true,
      rental_counts: true,
      rental_revenue: true,
      client_commission: true,
      rep_commission: true,
      country: features.country || 'all',
      defaultlanguage: features.defaultlanguage || 'en',
    };
    commands = {
      edit: true,
      lock: true,
      eject: true,
      eject_multiple: true,
      updates: true,
      connectivity: true,
      reboot: true,
      reload: true,
      disable: true,
      "client edit": true,
    };
  }

  // Normalize language
  features.country = features.country || features.Country || 'all';
  features.defaultlanguage = (features.defaultlanguage || features.defaultLanguage || 'en').toString().toLowerCase();

  return {
    uid,
    username,
    clientId,
    features,
    commands,
    role,
    isAdmin: role === 'admin' || username === 'chargerent',
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
  const [page, setPage] = useState('dashboard'); // 'dashboard', 'admin', 'kiosk-editor', 'rentals', 'chargers', 'provision', 'reporting', 'analytics'
  const [rentalsInitialSearch, setRentalsInitialSearch] = useState('');
  const [dashboardInitialSearch, setDashboardInitialSearch] = useState('');
  const [chargersInitialSearch, setChargersInitialSearch] = useState('');
  const [rentalData, setRentalData] = useState([]);
  const [commandStatus, setCommandStatus] = useState(null);
  const [firestoreError, setFirestoreError] = useState(null);
  const [initialStatusCheck, setInitialStatusCheck] = useState(false);

  // Centralized state for optimistic UI
  const [pendingSlots, setPendingSlots] = useState([]);
  const [ejectingSlots, setEjectingSlots] = useState([]);
  const [ngrokModalOpen, setNgrokModalOpen] = useState(false);
  const [lastProvisionedId, setLastProvisionedId] = useState(null);
  const [analyticsInitialData, setAnalyticsInitialData] = useState(null);

  const ws = useRef(null);
  const ignoredKiosksRef = useRef({});
  const wsSessionIdRef = useRef(null);
  const pendingCommandsRef = useRef([]); // tracks commands sent by this session for response filtering
  const isRefreshingTokenRef = useRef(false);

  const [lockingSlots, setLockingSlots] = useState([]);
  const [allStationsData, setAllStationsData] = useState([]);
  const [ngrokInfo, setNgrokInfo] = useState(null);

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
        setAuthReady(true);
        return;
      }

      try {
        // ✅ Force refresh so callable functions + rules are consistent
        const idToken = await user.getIdToken(true);
        localStorage.setItem('dashboardToken', idToken);
        setToken(idToken);

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
  }, [handleLogout]);

  // Effect to handle token expiration when tab/PWA becomes visible again
  useEffect(() => {
    const checkTokenOnFocus = async () => {
      // Guard against visibilitychange and pageshow both firing at the same time
      if (isRefreshingTokenRef.current) return;
      isRefreshingTokenRef.current = true;

      try {
        const currentToken = localStorage.getItem('dashboardToken');
        if (isTokenExpired(currentToken)) {
          await handleLogout();
          return;
        }

        if (auth.currentUser) {
          const refreshed = await auth.currentUser.getIdToken(true);
          localStorage.setItem('dashboardToken', refreshed);
          setToken(refreshed);
        }
      } catch (e) {
        await handleLogout();
      } finally {
        isRefreshingTokenRef.current = false;
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
    if (!token || !auth.currentUser) return;

    // Step 1: Real-time listener for raw Kiosk Data from Firestore
    const kiosksCollectionRef = collection(db, 'kiosks');
    const unsubscribeKiosks = onSnapshot(kiosksCollectionRef, (querySnapshot) => {
      const now = Date.now();
      const firestoreKiosksData = querySnapshot.docs.map(docSnap => ({ stationid: docSnap.id, ...docSnap.data() }));

      if (firestoreError) setFirestoreError(null); // Clear error on new data

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
      setRentalData(rentals);
    }, (error) => {
      setFirestoreError('Failed to connect to rental data. The dashboard may be out of date.');
      console.error("Error fetching real-time rentals: ", error);
    });

    return () => {
      unsubscribeKiosks();
      unsubscribeRentals();
    };
  }, [token, firestoreError]);

  // Failsafe Effect: Cleans up lingering UI effects when Firestore data confirms the state.
  useEffect(() => {
    if (pendingSlots.length === 0 && ejectingSlots.length === 0) return;

    const now = Date.now();
    const slotsToRemoveFromPending = [];
    const slotsToRemoveFromEjecting = [];

    allStationsData.forEach(kiosk => {
      kiosk.modules?.forEach(module => {
        const moduleNumber = module.id.split('m').pop();
        module.slots?.forEach(slot => {
          // Existing: clean up pendingSlots when lock state is confirmed by Firestore
          if (slot.isLocked !== undefined) {
            pendingSlots.forEach(p => {
              if (p.stationid === kiosk.stationid && p.moduleid.toString().split('m').pop() == moduleNumber && p.slotid === slot.position) {
                slotsToRemoveFromPending.push(p);
              }
            });
          }

          // New: after the 30s ignore window expires, Firestore is authoritative — clear
          // ejectingSlots for this slot regardless of whether it's empty or occupied.
          // This handles: kiosk returned error but charger was physically dispensed (sn:0),
          // and also: eject truly failed (sn: non-zero) — either way the spinner should stop.
          const ignoreUntil = ignoredKiosksRef.current[kiosk.stationid];
          const isFirestoreLive = !ignoreUntil || now >= ignoreUntil;
          if (isFirestoreLive) {
            ejectingSlots.forEach(e => {
              if (e.stationid === kiosk.stationid && e.moduleid?.toString().split('m').pop() == moduleNumber && e.slotid === slot.position) {
                slotsToRemoveFromEjecting.push(e);
              }
            });
          }
        });
      });
    });

    if (slotsToRemoveFromPending.length > 0) {
      setPendingSlots(prev => prev.filter(p => !slotsToRemoveFromPending.includes(p)));
    }
    if (slotsToRemoveFromEjecting.length > 0) {
      setEjectingSlots(prev => prev.filter(e => !slotsToRemoveFromEjecting.includes(e)));
    }
  }, [allStationsData, pendingSlots, ejectingSlots]);

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
      const baseData = {
        stationid,
        action,
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

      // Record this command so the response handler can identify it as "ours"
      pendingCommandsRef.current.push({ stationid, sentAt: Date.now() });

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
    if (!token) return;

    let isCleaningUp = false;

    const connect = () => {
      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        return;
      }
      wsSessionIdRef.current = crypto.randomUUID();
      ws.current = new WebSocket(`wss://chargerentstations.com/ws/commands`);

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WS Receive]', data);

          // Only show toast notifications for commands I initiated.
          // State updates (slot clearing, kiosk status) still apply to all responses
          // since they reflect real hardware state changes.
          //
          // The kiosk stores 'admin' in global context and may not echo our session UUID back,
          // so we track commands sent by this session locally and match by stationid within 30s.
          const responseStationId = data.kiosk || data.stationid;
          const now = Date.now();
          // Expire old entries
          pendingCommandsRef.current = pendingCommandsRef.current.filter(c => now - c.sentAt < 30000);
          const isMyCommand =
            (!data.admin && !data.sessionId) ||                                            // legacy broadcast → show to all
            data.admin === wsSessionIdRef.current ||                                       // admin echoed our UUID (future-proof)
            (responseStationId && pendingCommandsRef.current.some(c => c.stationid === responseStationId)); // we sent to this kiosk recently

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

          // Kiosk sends action:'ssh' with statuscode; backend may send 'ssh connect'/'ssh disconnect'
          const isSshMsg = data.action === 'ssh connect' || data.action === 'ssh disconnect' ||
            (data.action === 'ssh' && data.status_en);
          const isNgrokMsg = data.action === 'ngrok connect' || data.action === 'ngrok disconnect';

          if (isNgrokMsg || isSshMsg) {
            const isSuccess = data.status == 1 || data.statuscode == 1;
            if (isMyCommand) setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')) });
            if (isSuccess) {
              const type = isNgrokMsg ? 'ngrok' : 'ssh';
              let isConnecting;
              if (data.action === 'ssh connect' || data.action === 'ngrok connect') isConnecting = true;
              else if (data.action === 'ssh disconnect' || data.action === 'ngrok disconnect') isConnecting = false;
              else isConnecting = !!data.status_en?.toLowerCase().includes('connected') &&
                !data.status_en?.toLowerCase().includes('disconnected');

              const kioskId = data.kiosk || data.stationid;
              setAllStationsData(prev => prev.map(station =>
                station.stationid === kioskId ? { ...station, [type]: isConnecting } : station
              ));
              if (isConnecting && type === 'ngrok' && data.status_en && data.action === 'ngrok connect') {
                setNgrokInfo({ kioskId, message: data.status_en });
                setNgrokModalOpen(true);
              }
            }
          } else if (data.action === 'provision') {
            const isSuccess = data.status_en === 'kiosk provisioned on server';
            if (isMyCommand) setCommandStatus({ state: isSuccess ? 'success' : 'pending', message: data.status_en });

            if (isSuccess && data.admin) {
              setLastProvisionedId(data.admin);
            }
          // 'admineject' from kiosk doesn't start with 'eject' — use includes() instead
          } else if (data.action && (data.action.includes('eject') || data.action === 'rent')) { // EJECT LOGIC
            // Kiosk may send status:'ok' or status:1 — accept both
            const isSuccess = data.status == 1 || data.status === 'ok' || data.statuscode == 1;
            if (data.status_en && isMyCommand) {
              setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en });
            }

            // Kiosk uses 'kiosk' or 'stationid' inconsistently — check both
            const stationId = data.kiosk || data.stationid;
            const moduleIdNum = data.module != null ? parseInt(data.module, 10) : null;
            const slotId = data.slot != null ? parseInt(data.slot, 10) : null;

            if (isSuccess && stationId) {
              const hasSpecificSlot = moduleIdNum !== null && slotId !== null;

              if (hasSpecificSlot) {
                // Single slot response — clear that slot and update its state
                setAllStationsData(prevStations => prevStations.map(station => {
                  if (station.stationid !== stationId) return station;
                  const targetModule = station.modules.find(m => m.id.endsWith(`m${moduleIdNum}`));
                  if (targetModule) {
                    setEjectingSlots(prev => prev.filter(s => !(s.stationid === stationId && s.moduleid === targetModule.id && s.slotid === slotId)));
                    setPendingSlots(prev => prev.filter(p => !(p.stationid === stationId && p.moduleid === targetModule.id && p.slotid === slotId)));
                  }
                  return {
                    ...station,
                    modules: station.modules.map(module =>
                      module.id.endsWith(`m${moduleIdNum}`)
                        ? { ...module, slots: module.slots.map(slot => slot.position === slotId ? { ...slot, sn: 0, batteryLevel: 0, chargingCurrent: 0, sstat: '0C', cmos: null } : slot) }
                        : module
                    )
                  };
                }));
              } else {
                // Bulk eject response (no slot number) — clear ejectingSlots for this kiosk/module
                // Firestore will update the actual slot states after the ignore window expires
                setEjectingSlots(prev => prev.filter(s => {
                  if (s.stationid !== stationId) return true;
                  if (moduleIdNum !== null) return !s.moduleid.toString().includes(`m${moduleIdNum}`);
                  return false;
                }));
              }

              ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationId]: Date.now() + 30000 };
            }

          } else if (data.action && (data.action.includes('lock') || data.action.includes('unlock'))) { // LOCK/UNLOCK LOGIC
            // Kiosk sends status:'ok' — accept that along with numeric 1
            const isSuccess = data.status == 1 || data.status === 'ok' || data.statuscode == 1;
            // Kiosk uses 'kiosk' or 'stationid' inconsistently — check both
            const stationId = data.kiosk || data.stationid;
            const moduleIdNum = data.module != null ? parseInt(data.module, 10) : null;
            const slotId = data.slot != null ? parseInt(data.slot, 10) : null;

            // Trigger update from explicit status strings, status_en text, or a successful status code
            const isUpdateTriggered = isSuccess ||
              data.status === 'locked' || data.status === 'unlocked' ||
              data.status_en?.includes('locked') || data.status_en?.includes('unlocked');

            if (isUpdateTriggered && stationId) {
              if (isMyCommand) setCommandStatus({ state: 'success', message: data.status_en });

              // Determine new lock state: explicit status field wins, then status_en text, then action name
              let isNowLocked;
              if (data.status === 'locked') {
                isNowLocked = true;
              } else if (data.status === 'unlocked') {
                isNowLocked = false;
              } else if (data.status_en?.includes('unlocked')) {
                isNowLocked = false;
              } else if (data.status_en?.includes('locked')) {
                isNowLocked = true;
              } else {
                isNowLocked = !data.action.includes('unlock');
              }

              console.log(`[4. CONFIRMATION] Flipping color for ${stationId}-${moduleIdNum}-${slotId}. New state isLocked: ${isNowLocked}`);
              if (moduleIdNum !== null && slotId !== null) {
                setAllStationsData(prevStations => prevStations.map(s =>
                  s.stationid !== stationId ? s : {
                    ...s,
                    modules: s.modules.map(m => {
                      if (!m.id.endsWith(`m${moduleIdNum}`)) return m;
                      return { ...m, slots: m.slots.map(sl => sl.position === slotId ? { ...sl, isLocked: isNowLocked } : sl) };
                    })
                  }
                ));
              }

              console.log(`[5. IGNORE] Ignoring Firestore updates for ${stationId} for 20s.`);
              ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationId]: Date.now() + 20000 };

              setLockingSlots(prev => prev.filter(l => !(l.stationid === stationId && l.moduleid.toString().endsWith(`m${moduleIdNum}`) && l.slotid === slotId)));
            } else if (data.status_en) {
              if (isMyCommand) setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en });
            }
          } else if (data.action === 'enable' || data.action === 'disable') {
            const isSuccess = data.status == 1;
            if (isMyCommand) setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? 'Command successful!' : 'Command failed.') });
            if (isSuccess && data.kiosk) {
              const stationId = data.kiosk;
              const isDisabled = data.action === 'disable';
              setAllStationsData(prevStations => prevStations.map(station =>
                station.stationid === stationId ? { ...station, disabled: isDisabled ? { status: true } : null } : station
              ));
            }
          } else if (data.action === 'odroid reboot') {
            if (isMyCommand) setCommandStatus({ state: 'success', message: data.status_en });
          } else if (data.action === 'hotspot' && data.stationid) {
            const isSuccess = data.status === 1;
            if (isMyCommand) setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('command_successful') : t('command_failed')) });
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
              if (isMyCommand) setCommandStatus({ state: 'success', message: data.status_en });
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
              if (isMyCommand) setCommandStatus({ state: 'success', message: data.status_en });
            }
          } else if (data.action && data.action.includes('change')) {
            const isSuccess = data.statuscode == 1 || data.statuscode == 2;
            let toastState = isSuccess ? 'success' : 'error';

            if (isMyCommand) setCommandStatus({ state: toastState, message: data.status_en || (isSuccess ? t('command_success') : t('command_failed')) });

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
            if (isMyCommand) setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? t('refund_success') : t('refund_failed')) });
          }

        } catch (e) {
          console.error("Error handling WebSocket message in App.jsx:", e);
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
  }, [token, t]);

  // Login handler (kept for LoginPage)
  const handleLogin = ({ token: newToken, profile, uid }) => {
    localStorage.setItem('dashboardToken', newToken);
    setToken(newToken);

    const info = buildClientInfoFromProfile(profile, uid);
    setClientInfo(info);
    setLanguage(info?.features?.defaultlanguage || 'en');

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
      onNavigateToRentals={() => { setRentalsInitialSearch(''); setPage('rentals'); }}
      onNavigateToChargers={(sn) => { if (sn) setChargersInitialSearch(sn); else setChargersInitialSearch(''); setPage('chargers'); }}
      initialSearch={dashboardInitialSearch}
      onNavigateToReporting={() => setPage('reporting')}
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
      lockingSlots={lockingSlots}
      initialStatusCheck={initialStatusCheck}
      setInitialStatusCheck={setInitialStatusCheck}
      serverFlowVersion={clientInfo?.serverFlowVersion}
      serverUiVersion={clientInfo?.serverUiVersion}
      ignoredKiosksRef={ignoredKiosksRef}
      manageIgnoredKiosk={manageIgnoredKiosk}
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

    // ✅ Must have firebase session + token + profile
    if (!auth.currentUser || !token || !clientInfo) {
      return <LoginPage onLogin={handleLogin} />;
    }

    if (allStationsData.length === 0) {
      return (
        <div className="flex items-center justify-center h-screen bg-gray-100">
          <div className="text-xl font-semibold text-gray-700">Loading Dashboard...</div>
        </div>
      );
    }

    switch (page) {
      case 'admin':
        return (
          <AdminPage
            token={token}
            onLogout={handleLogout}
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToProvisionPage={() => setPage('provision')}
            onNavigateToAgreement={() => setPage('agreement')}
            t={t}
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
            initialSearch={rentalsInitialSearch}
          />
        );
      case 'chargers':
        return (
          <ChargersPage
            onNavigateToDashboard={(stationId) => { if (stationId) setDashboardInitialSearch(stationId); setPage('dashboard'); }}
            onNavigateToRentals={(sn) => { setRentalsInitialSearch(sn); setPage('rentals'); }}
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
            initialSearch={chargersInitialSearch}
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
      <ErrorBoundary>
        {renderPage()}
      </ErrorBoundary>
    </>
  );
}

export default App;