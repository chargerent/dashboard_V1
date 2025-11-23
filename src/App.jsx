// src/App.jsx
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { subscribeUserToPush, getOrCreateDeviceId } from './push';
import { db } from './firebase-config'; // Import Firestore instance
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { translations } from './utils/translations';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { normalizeKioskData } from './utils/helpers.js';
import KioskEditorPage from './pages/KioskEditorPage.jsx'; // This seems to be unused now
import RentalsPage from './pages/RentalsPage.jsx';
import ChargersPage from './pages/ChargersPage.jsx';
import ProvisionPage from './pages/ProvisionPage.jsx';
import ProfessionalAgreementPDF from './pages/AgreementPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ReportingPage from './pages/ReportingPage.jsx';

function initializeClientInfo(token) {
    const payload = JSON.parse(atob(token.split('.')[1]));
    let clientFeatures, clientCommands;

    if (payload.username === 'chargerent') {
        clientFeatures = { rentals: true, details: true, stationid: true, address: true, country: 'all', status: true, pricing: true, reporting: true };
        clientCommands = { edit: true, lock: true, eject: true, eject_multiple: true, updates: true, connectivity: true, reboot: true, reload: true, disable: true, "client edit": true };
    } else {
        const defaultFeatures = { rentals: false, details: false, stationid: true, address: true, country: 'all', status: false, pricing: false, reporting: false };
        const defaultCommands = { edit: false, lock: false, eject: false, eject_multiple: false, updates: false, connectivity: false, reboot: false, reload: false, disable: false, "client edit": false };
        
        clientFeatures = { ...defaultFeatures, ...(payload.features || {}) };
        const payloadCommands = payload.commands || payload.Commands; 
        clientCommands = { ...defaultCommands, ...(payloadCommands || {}) };
    }

    clientFeatures.country = payload.features?.country || 'all';
    clientFeatures.defaultlanguage = (payload.features?.defaultlanguage || 'EN').toLowerCase();

    return { username: payload.username, clientId: payload.clientId, features: clientFeatures, commands: clientCommands, serverFlowVersion: payload.serverFlowVersion, serverUiVersion: payload.serverUiVersion, partner: payload.partner || false };
}

function isTokenExpired(token) {
    if (!token) return true;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        // The 'exp' claim is in seconds, Date.now() is in milliseconds.
        const isExpired = Date.now() >= payload.exp * 1000;
        if (isExpired) console.log("Authentication token has expired.");
        return isExpired;
    } catch (e) {
        console.error("Failed to parse token, treating as expired:", e);
        return true; // Treat a malformed token as expired.
    }
}
function App() {
    const [token, setToken] = useState(localStorage.getItem('dashboardToken'));
    const [clientInfo, setClientInfo] = useState(null);
    const [language, setLanguage] = useState('en');
    const [page, setPage] = useState('dashboard'); // 'dashboard', 'admin', 'kiosk-editor', 'rentals', 'chargers', 'provision', 'reporting', 'analytics'
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

    const [lockingSlots, setLockingSlots] = useState([]); // Moved from DashboardPage
    const [allStationsData, setAllStationsData] = useState([]); // This state is now managed here.
    const [ngrokInfo, setNgrokInfo] = useState(null);
    const [rawKioskData, setRawKioskData] = useState([]); // New state for raw kiosk data
    
    const handleLogout = useCallback(() => {
        localStorage.removeItem('dashboardToken');
        setToken(null);
        setClientInfo(null);
        setLanguage('en');
        setPage('dashboard');
        setInitialStatusCheck(false);
    }, []);

    useEffect(() => {
        if (token) {
            try {
                const info = initializeClientInfo(token);
                setClientInfo(info);
                setLanguage(info.features.defaultlanguage);
            } catch (e) {
                handleLogout();
            }
        }
    }, [token]);

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

    // Effect to handle token expiration when tab/PWA becomes visible again
    useEffect(() => {
        const checkTokenOnFocus = () => {
            const currentToken = localStorage.getItem('dashboardToken');
            if (isTokenExpired(currentToken)) {
                handleLogout();
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkTokenOnFocus();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pageshow', checkTokenOnFocus); // Catches navigations and PWA foregrounding

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pageshow', checkTokenOnFocus);
        };
    }, [handleLogout]);

    useEffect(() => {
        if (!token) return;

        // Step 1: Real-time listener for raw Kiosk Data from Firestore
        const kiosksCollectionRef = collection(db, 'kiosks');
        const unsubscribeKiosks = onSnapshot(kiosksCollectionRef, (querySnapshot) => {
            const now = Date.now();
            const firestoreKiosksData = querySnapshot.docs.map(doc => ({ stationid: doc.id, ...doc.data() }));

            if (firestoreError) setFirestoreError(null); // Clear error on new data

            // This is the crucial part: Filter out updates for ignored kiosks.
            setAllStationsData(prevStations => {
                const prevStationsMap = new Map(prevStations.map(s => [s.stationid, s]));
                const newStations = firestoreKiosksData.map(kiosk => {
                    const ignoreUntil = ignoredKiosksRef.current[kiosk.stationid];
                    if (ignoreUntil && now < ignoreUntil) {
                        // If ignored, keep the previous state of this kiosk.
                        console.log(`[FIRESTORE IGNORE] Ignoring update for ${kiosk.stationid}`);
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
        const rentalQuery = collection(db, 'rentals');
        const unsubscribeRentals = onSnapshot(rentalQuery, (querySnapshot) => {
            const rentals = querySnapshot.docs.map(doc => ({ rawid: doc.id, ...doc.data() }));
            if (firestoreError) setFirestoreError(null); // Clear error on new data
            setRentalData(rentals);
        }, (error) => {
            setFirestoreError('Failed to connect to rental data. The dashboard may be out of date.');
            console.error("Error fetching real-time rentals: ", error);
        });
        
        return () => {
            unsubscribeKiosks(); // Detach the kiosks listener
            unsubscribeRentals(); // Detach the rentals listener
        };
    }, [token]);

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
        // Ensure timestamps are valid before reducing
        const latestStation = allStationsData.reduce((latest, current) => {
            if (!current?.timestamp) return latest;
            if (!latest?.timestamp) return current;
            // Handle both ISO string and Date objects
            const latestDate = new Date(latest.timestamp.endsWith('Z') ? latest.timestamp : latest.timestamp + 'Z');
            const currentDate = new Date(current.timestamp.endsWith('Z') ? current.timestamp : current.timestamp + 'Z');
            return currentDate > latestDate ? current : latest;
        }, null);
        // Fallback to a new Date object if no valid timestamp is found
        return latestStation?.lastUpdated ? new Date(latestStation.lastUpdated) : new Date();
    }, [allStationsData]);

    const manageIgnoredKiosk = useCallback((kioskId, shouldIgnore) => {
        if (shouldIgnore) {
            // Set a very long timeout. This will be cleared manually when editing is finished.
            ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [kioskId]: Date.now() + 3600000 }; // Ignore for 1 hour
        } else {
            const newIgnored = { ...ignoredKiosksRef.current };
            delete newIgnored[kioskId];
            ignoredKiosksRef.current = newIgnored;
        }
    }, []);

    const t = useCallback((key) => {
        return translations[language]?.[key] || key;
    }, [language]);

    const onCommand = useCallback((stationid, action, moduleid = null, provisionid = null, uiVersion = null, details = null) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            // Base data for all commands
            const baseData = {
                stationid,
                action,
                ...(provisionid && { provisionid }),
                ...(uiVersion && { version: uiVersion }),
                ...(moduleid && { moduleid }), // Always include moduleid if provided as a parameter
            };

            // Use a switch statement for clarity and to avoid complex conditional spreads
            let commandData = {};
            switch (action) {
                case 'lock slot':
                case 'unlock slot':
                    // For lock/unlock slot, slotid comes from details. moduleid is already in baseData.
                    // Use lockingSlots for the "glow" effect
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
                    // For lock module, moduleid is already in baseData. No additional details needed.
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
                    // Default handling for actions like 'change ...' or other general commands
                    commandData = { ...baseData, ...(moduleid && { moduleid }), ...(details && { kiosk: details.kiosk, autoGeocode: details.autoGeocode }) };
            }

            const message = {
                type: 'command',
                token: token,
                data: commandData
            };

            ws.current.send(JSON.stringify(message));
            console.log('[WS Send]', message);

            // Temporarily ignore updates for this kiosk for 30 seconds to prevent immediate Firestore overwrites
            // This ensures optimistic UI updates aren't reverted before the backend confirms.
            console.log(`[2. IGNORE] Ignoring Firestore updates for ${stationid} for 30s.`);
            ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationid]: Date.now() + 30000 };

            setCommandStatus({ state: 'sending', message: t('sending_command') });
        } else {
            setCommandStatus({ state: 'error', message: t('connection_lost') });
        }
    }, [token, t]);

    useEffect(() => {
        if (!token) return;

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
                                    ? { ...rental, 
                                        status: 'refunded', 
                                        refundStatus: data.refund_status || 'approved', 
                                        refundAmount: data.refund_amount, 
                                        refundDate: data.refund_date || new Date().toISOString() }
                                    : rental
                            )
                        );
                    }

                    // This logic is moved from DashboardPage to handle global command responses
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
                            // The 'admin' field seems to contain the provisionid on confirmation
                            setLastProvisionedId(data.admin);
                        }
                    } else if (data.action && (data.action.startsWith('eject') || data.action === 'rent')) { // EJECT LOGIC
                        const isSuccess = data.status == 1;
                        // Only show a toast if there's a message to show. The initial command echo might not have one.
                        if (data.status_en) {
                            setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en });
                        }
                        
                        const stationId = data.kiosk;
                        const moduleIdNum = data.module ? parseInt(data.module, 10) : null;
                        const slotId = data.slot ? parseInt(data.slot, 10) : null;
                        
                        // If the message has full details, handle both UI and data updates.
                        if (isSuccess && stationId && (moduleIdNum || moduleIdNum === 0) && (slotId || slotId === 0)) {
                            setAllStationsData(prevStations => {
                                const updatedStations = prevStations.map(station => {
                                    if (station.stationid !== stationId) return station;

                                    // Find the full module ID to remove the glow effect
                                    const targetModule = station.modules.find(m => m.id.endsWith(`m${moduleIdNum}`));
                                    if (targetModule) {
                                        setEjectingSlots(prev => {
                                            const newSlots = prev.filter(s => !(s.stationid === stationId && s.moduleid === targetModule.id && s.slotid === slotId));
                                            return newSlots;
                                        });
                                        // Also clear from pendingSlots if it was there
                                        setPendingSlots(prev => prev.filter(p => !(p.stationid === stationId && p.moduleid === targetModule.id && p.slotid === slotId)));
                                    }

                                    return {
                                        ...station,
                                        modules: station.modules.map(module => module.id.endsWith(`m${moduleIdNum}`) ? { ...module, slots: module.slots.map(slot => slot.position === slotId ? { ...slot, sn: 0, batteryLevel: 0, chargingCurrent: 0, sstat: '0C', cmos: null } : slot) } : module)
                                    };
                                });
                                return updatedStations;
                            });

                            // 3. Ignore subsequent Firestore updates for this kiosk for 30 seconds
                            setAllStationsData(prev => {
                                ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationId]: Date.now() + 30000 };
                                return prev;
                            });

                        }

                    } else if (data.action && (data.action.includes('lock') || data.action.includes('unlock'))) { // LOCK/UNLOCK LOGIC
                        const isSuccess = data.status == 1;
                        const stationId = data.kiosk;
                        const moduleIdNum = data.module ? parseInt(data.module, 10) : null;
                        const slotId = data.slot ? parseInt(data.slot, 10) : null;

                        setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? 'Command successful!' : 'Command failed.') });
                        
                        const isStatusUpdate = data.status === 'locked' || data.status === 'unlocked';

                        if (isStatusUpdate && stationId && (moduleIdNum || moduleIdNum === 0) && (slotId || slotId === 0)) {
                            let isNowLocked;
                            if (data.status === 'locked') {
                                isNowLocked = true;
                            } else if (data.status === 'unlocked') {
                                isNowLocked = false;
                            } else {
                                return; // Do nothing if status is not 'locked' or 'unlocked'
                            }
                            
                            console.log(`[4. CONFIRMATION] Flipping color for ${stationId}-${moduleIdNum}-${slotId}. New state isLocked: ${isNowLocked}`);
                            setAllStationsData(prevStations => prevStations.map(s =>
                                s.stationid !== stationId ? s : {
                                    ...s,
                                    modules: s.modules.map(m => {
                                        if (!m.id.endsWith(`m${moduleIdNum}`)) return m;
                                        // Update the slot's lock state
                                        return { ...m, slots: m.slots.map(sl => sl.position === slotId ? { ...sl, isLocked: isNowLocked } : sl) };
                                    })
                                }
                            ));

                            // --- IGNORE ---
                            // Ignore subsequent Firestore updates for this kiosk for 30 seconds
                            // to ensure our confirmed state isn't immediately overwritten.
                            console.log(`[5. IGNORE] Ignoring Firestore updates for ${stationId} for 20s.`);
                            ignoredKiosksRef.current = { ...ignoredKiosksRef.current, [stationId]: Date.now() + 20000 };

                            // --- CLEANUP ---
                            // Remove the slot from lockingSlots once the command is confirmed
                            setLockingSlots(prev => prev.filter(l => !(l.stationid === stationId && l.moduleid.toString().endsWith(`m${moduleIdNum}`) && l.slotid === slotId)));
                        }
                    } else if (data.action === 'enable' || data.action === 'disable') {
                        const isSuccess = data.status == 1;
                        setCommandStatus({ state: isSuccess ? 'success' : 'error', message: data.status_en || (isSuccess ? 'Command successful!' : 'Command failed.')});
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
                        // The stationid is now present in the confirmation, which is great.
                        // While we don't need to update the station data for this command,
                        // acknowledging it makes the logic consistent and more robust.
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
                ws.current.close(); // This will trigger the onclose handler
            };
            ws.current.onclose = () => {
                if (!isCleaningUp) { // Only attempt to reconnect if it's not an intentional close
                    setTimeout(connect, 1000);
                }
            };
        };

        connect();

        return () => {
            isCleaningUp = true;
            if (ws.current) {
                // Only close if the connection is open
                if (ws.current.readyState === WebSocket.OPEN) {
                    ws.current.close();
                }
            }
        };
    }, [token, t]);

    const handleLogin = (newToken) => {
        localStorage.setItem('dashboardToken', newToken);
        setToken(newToken);
        setPage('dashboard');
    };

    if (!token || !clientInfo) {
        return <LoginPage onLogin={handleLogin} />;
    }
    
    if (page === 'admin') {
        // This line is now corrected
        return <AdminPage 
            token={token} 
            onLogout={handleLogout} 
            onNavigateToDashboard={() => setPage('dashboard')} 
            onNavigateToProvisionPage={() => setPage('provision')} 
            onNavigateToAgreement={() => setPage('agreement')} 
            t={t} 
        />
    }

    if (page === 'agreement') {
        return <ProfessionalAgreementPDF 
            t={t} language={language} setLanguage={setLanguage} onLogout={handleLogout} onNavigateToDashboard={() => setPage('dashboard')}
        />
    }

    if (page === 'rentals') {
        return <RentalsPage 
            onNavigateToProvisionPage={() => setPage('provision')}
            onNavigateToDashboard={() => setPage('dashboard')} 
            clientInfo={clientInfo}
            rentalData={rentalData} // Rentals page uses raw rental data
            allStationsData={allStationsData}
            t={t} language={language} setLanguage={setLanguage} onLogout={handleLogout} onCommand={onCommand} 
            referenceTime={latestTimestamp}
        />;
    }

    if (page === 'chargers') {
        return <ChargersPage
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
        />;
    }

    if (page === 'reporting') {
        return <ReportingPage
            onNavigateToDashboard={() => setPage('dashboard')}
            onNavigateToAnalytics={onNavigateToAnalytics}
            onLogout={handleLogout}
            t={t}
            rentalData={rentalData}
            allStationsData={allStationsData}
            clientInfo={clientInfo}
        />;
    }

    if (page === 'analytics') {
        return <AnalyticsPage
            allStationsData={allStationsData}
            rentalData={rentalData}
            initialData={analyticsInitialData}
            onNavigateToDashboard={() => setPage('dashboard')}
            onLogout={handleLogout}
            t={t}
        />;
    }

    const dashboard = (
        <DashboardPage 
            token={token} 
            onLogout={handleLogout} 
            clientInfo={clientInfo} 
            t={t} 
            language={language}
            setLanguage={setLanguage} 
            onNavigateToAdmin={() => setPage('admin')}
            onNavigateToRentals={() => setPage('rentals')}
            onNavigateToChargers={() => setPage('chargers')}
            onNavigateToReporting={() => setPage('reporting')}
            onNavigateToAnalytics={onNavigateToAnalytics}
            onNavigateToKioskEditor={() => setPage('kiosk-editor')}
            rentalData={rentalData}
            allStationsData={allStationsData} setAllStationsData={setAllStationsData} ngrokModalOpen={ngrokModalOpen} setNgrokModalOpen={setNgrokModalOpen} ngrokInfo={ngrokInfo} setNgrokInfo={setNgrokInfo}
            onCommand={onCommand}
            commandStatus={commandStatus} setCommandStatus={setCommandStatus}
            firestoreError={firestoreError}
            pendingSlots={pendingSlots} setPendingSlots={setPendingSlots}
            ejectingSlots={ejectingSlots} setEjectingSlots={setEjectingSlots}
            lockingSlots={lockingSlots} // Pass lockingSlots down from App.jsx
            initialStatusCheck={initialStatusCheck}
            setInitialStatusCheck={setInitialStatusCheck}
            serverFlowVersion={clientInfo.serverFlowVersion}
            serverUiVersion={clientInfo.serverUiVersion}
            ignoredKiosksRef={ignoredKiosksRef}
            manageIgnoredKiosk={manageIgnoredKiosk}
        />
    );

    if (page === 'dashboard') {
        return dashboard;
    }

    if (page === 'kiosk-editor') {
        return <KioskEditorPage token={token} onLogout={handleLogout} onNavigateToDashboard={() => setPage('dashboard')} t={t} kioskData={allStationsData} onCommand={onCommand} />;
    }

    if (page === 'provision') {
        return <ProvisionPage onLogout={handleLogout} onNavigateToDashboard={() => setPage('dashboard')} t={t} onCommand={onCommand} allStationsData={allStationsData} lastProvisionedId={lastProvisionedId} />
    }

    return dashboard;
};

export default App;