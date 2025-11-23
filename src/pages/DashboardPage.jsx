// src/pages/DashboardPage.jsx
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import FilterPanel from '../components/Dashboard/filterPanel';
import KioskPanel from '../components/kiosk/kioskPanel';
import KioskDetailPanel from '../components/kiosk/KioskDetailPanel';
import KioskEditPanel from '../components/kiosk/KioskEditPanel';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import NgrokModal from '../components/UI/NgrokModal';
import LoadingSpinner from '../components/UI/LoadingSpinner';
import InitialStatusPage from '../components/UI/InitialStatusPage';
import SoldOutKiosksModal from '../components/UI/SoldOutKiosksModal.jsx';
import TimeoutWarningModal from '../components/UI/TimeoutWarningModal';
import { normalizeKioskData, isKioskOnline, isKioskActive } from '../utils/helpers';
import GlobalRentalActivity from '../components/Dashboard/GlobalRentalActivity';
import { useIdleTimer } from '../hooks/useIdleTimer';
import LocationSummary from '../components/Dashboard/LocationSummary';
import CommandStatusToast from '../components/UI/CommandStatusToast';
import { subscribeUserToPush } from '../push'; // This is unused
import RentalDetailView from '../components/Dashboard/RentalDetailView';

export default function DashboardPage({ token, onLogout, clientInfo, t, language, setLanguage, onNavigateToAdmin, onNavigateToRentals, onNavigateToChargers, onNavigateToReporting, rentalData, allStationsData, setAllStationsData, onCommand, commandStatus, setCommandStatus, firestoreError, initialStatusCheck, setInitialStatusCheck, serverFlowVersion, serverUiVersion, pendingSlots, setPendingSlots, ejectingSlots, setEjectingSlots, lockingSlots, ignoredKiosksRef, ngrokModalOpen, setNgrokModalOpen, ngrokInfo, setNgrokInfo, manageIgnoredKiosk }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedKioskId, setExpandedKioskId] = useState(null);
    const [editingKioskId, setEditingKioskId] = useState(null);
    const [activeFilters, setActiveFilters] = useState({ all: true });
    const [showActiveOnly, setShowActiveOnly] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [commandDetails, setCommandDetails] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);
    const ITEMS_PER_PAGE = 12;
    const [showInitialStatus, setShowInitialStatus] = useState(false);
    const [rentalDetailView, setRentalDetailView] = useState(null); // { kioskId, period }
    const [showSoldOutModal, setShowSoldOutModal] = useState(false);
    const [commandModalOpen, setCommandModalOpen] = useState(false);

    const { showWarning, handleStay } = useIdleTimer({ onLogout, idleTimeout: 540000, warningTimeout: 60000 });

    useEffect(() => {
        // Set loading to false once the initial data has arrived.
        if (allStationsData.length > 0) setLoading(false);
    }, [allStationsData]);

    useEffect(() => {
        // When the dashboard loads, subscribe to push notifications
        if (clientInfo?.clientId && 'serviceWorker' in navigator && 'PushManager' in window) {
            subscribeUserToPush(clientInfo.clientId).catch(err => {
                console.error('Failed to subscribe to push notifications', err);
            });
        }
    }, [clientInfo?.clientId]);

    // Debounce search term
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
            setCurrentPage(1); // Reset to first page on new search
        }, 300);
        return () => clearTimeout(handler);
    }, [searchTerm]);

    const handleToggleDetails = (stationid) => {
        setEditingKioskId(null); 
        setRentalDetailView(null);
        setExpandedKioskId(prevId => (prevId === stationid ? null : stationid));
    };

    const handleToggleEditMode = (stationid) => {
        setExpandedKioskId(null);
        setEditingKioskId(prevId => (prevId === stationid ? null : stationid));
        setRentalDetailView(null);
    };

    // Effect to manage ignoring kiosk updates while editing
    useEffect(() => {
        if (editingKioskId) {
            manageIgnoredKiosk(editingKioskId, true);
        }

        // Cleanup function to remove the kiosk from the ignore list when editing is done
        return () => {
            if (editingKioskId) manageIgnoredKiosk(editingKioskId, false);
        };
    }, [editingKioskId, manageIgnoredKiosk]);

    const handleShowRentalDetails = (kioskId, period) => {
        setExpandedKioskId(null);
        setEditingKioskId(null);
        setRentalDetailView(prev => {
            // If it's the same kiosk and period, close it. Otherwise, open the new one.
            if (prev && prev.kioskId === kioskId && prev.period === period) return null;
            return { kioskId, period };
        });
    };

    const handleSlotClick = (stationid, moduleid, slotid) => {
        const confirmationText = `${t('eject_confirmation')} ${slotid}?`;
        setCommandDetails({ stationid, moduleid, slotid, action: 'eject specific', confirmationText });
        setCommandModalOpen(true);
    };
    
    const handleLockSlotClick = (stationid, moduleid, slotid, isCurrentlyLocked) => {
        const action = isCurrentlyLocked ? 'unlock slot' : 'lock slot';
        const confirmationText = `${isCurrentlyLocked ? t('unlock_confirmation') : t('lock_confirmation')} ${slotid}?`;

        // Always get the latest kiosk data from the state to avoid stale closures
        const targetKiosk = allStationsData.find(k => k.stationid === stationid);

        let lockReason = '';
        if (isCurrentlyLocked) {
            const targetModule = targetKiosk?.modules.find(m => m.id === moduleid);
            const targetSlot = targetModule?.slots.find(s => s.position === slotid);
            if (targetSlot && targetSlot.lockReason) {
                lockReason = targetSlot.lockReason;
            }
        }
        setCommandDetails({ stationid, moduleid, slotid, action, confirmationText, lockReason });
        setCommandModalOpen(true);
    };

    const handleSendCommand = (reason = null) => {
        setCommandModalOpen(false);

        const { stationid, moduleid, slotid, action } = commandDetails;
        
        // If this is a save action, un-ignore the kiosk now that we are sending the command.
        if (action.includes('change')) {
            manageIgnoredKiosk(stationid, false);
        }

        if (action.startsWith('eject') || action === 'rent') {
            const targetKiosk = allStationsData.find(k => k.stationid === stationid);
            if (!targetKiosk) return;

            let slotsToEject = [];
            const powerThreshold = targetKiosk.hardware?.power || 80;

            switch (action) {
                case 'eject specific':
                case 'rent':
                    slotsToEject.push({ stationid, moduleid, slotid });
                    break;
                case 'eject module':
                    const targetModule = targetKiosk.modules.find(m => m.id === moduleid);
                    if (targetModule) {
                        targetModule.slots.forEach(slot => {
                            if (slot.sn && slot.sn !== 0) {
                                slotsToEject.push({ stationid, moduleid: targetModule.id, slotid: slot.position });
                            }
                        });
                    }
                    break;
                case 'eject all':
                    targetKiosk.modules.forEach(module => {
                        module.slots.forEach(slot => {
                            if (slot.sn && slot.sn !== 0 && !slot.isLocked) {
                                slotsToEject.push({ stationid, moduleid: module.id, slotid: slot.position });
                            }
                        });
                    });
                    break;
                case 'eject full':
                        targetKiosk.modules.forEach(module => {
                        module.slots.forEach(slot => {
                            if (slot.sn && slot.sn !== 0 && slot.batteryLevel >= powerThreshold) {
                                slotsToEject.push({ stationid, moduleid: module.id, slotid: slot.position });
                            }
                        });
                    });
                    break;
                case 'eject empty':
                        targetKiosk.modules.forEach(module => {
                        module.slots.forEach(slot => {
                            if (slot.sn && slot.sn !== 0 && typeof slot.batteryLevel === 'number' && slot.batteryLevel < powerThreshold && !slot.isLocked) {
                                slotsToEject.push({ stationid, moduleid: module.id, slotid: slot.position });
                            }
                        });
                    });
                    break;
                case 'eject locked':
                        targetKiosk.modules.forEach(module => {
                        module.slots.forEach(slot => {
                            if (slot.isLocked) {
                                slotsToEject.push({ stationid, moduleid: module.id, slotid: slot.position });
                            }
                        });
                    });
                    break;
            }
            if (slotsToEject.length > 0) { // This condition already covers all eject actions
                setEjectingSlots(prev => [...prev, ...slotsToEject]);
            }
        }

        const details = {
            ...(commandDetails.action.includes('change') && { kiosk: commandDetails.kiosk, autoGeocode: commandDetails.autoGeocode }),
            ...((commandDetails.action === 'lock slot' || commandDetails.action === 'unlock slot' || commandDetails.action === 'eject specific' || commandDetails.action === 'rent') && { slotid: commandDetails.slotid, info: reason }),
            ...(commandDetails.action === 'eject count' && { slotid: commandDetails.slotid }),
            ...(reason && typeof reason === 'object' && { ...reason })
        };
        onCommand(commandDetails.stationid, commandDetails.action, commandDetails.moduleid, commandDetails.provisionid, commandDetails.uiVersion, details);
    };

    const handleKioskSave = (stationid, section, data, autoGeocode) => {
        const confirmationText = t('save_info_confirmation');

        let action;
        if (section === 'pricing') {
            action = 'pricechange';
        } else if (section === 'hardware') {
            action = 'hardwarechange';
        } else if (section === 'ui') {
            action = 'uichange';
        } else {
            action = 'infochange';
        }

        setCommandDetails({
            stationid,
            action: action,
            kiosk: data, // Use the updated data from the form
            autoGeocode: autoGeocode,
            confirmationText,
        });
        setCommandModalOpen(true);
    };
    const handleGeneralCommand = (stationid, action, moduleid = null, provisionid = null, uiVersion = null, details = null) => {
        let confirmationText = `Are you sure you want to ${action}?`;
        let commandDetailsPayload = { stationid, action, moduleid, provisionid, uiVersion, ...details };
        const targetKiosk = allStationsData.find(k => k.stationid === stationid);

        if (action === 'disable' && targetKiosk?.disabled) {
            action = 'enable';
        }

        if (action === 'reboot') {
            confirmationText = t('reboot_confirmation');
        } else if (action === 'ngrok connect') {
            confirmationText = t('ngrok_connect_confirmation');
        } else if (action === 'ngrok disconnect') {
            confirmationText = t('ngrok_disconnect_confirmation');
        } else if (action === 'ssh connect') {
            confirmationText = t('ssh_connect_confirmation');
        } else if (action === 'ssh disconnect') {
            confirmationText = t('ssh_disconnect_confirmation');
        } else if (action === 'enable') {
            confirmationText = t('enable_confirmation');
        } else if (action === 'disable') {
            confirmationText = t('disable_confirmation');
        } else if (action === 'eject module') {
            confirmationText = `${t('eject_module_confirmation')}?`;
            commandDetailsPayload.slotid = moduleid; // Repurpose slotid for moduleid in this case
        } else if (action === 'lock module') {
            confirmationText = `${t('lock_module_confirmation')}?`;
            commandDetailsPayload.slotid = moduleid; // Repurpose slotid for moduleid
        } else if (action === 'refund') {
            // Refund confirmation is handled in its own modal, so we bypass the generic one.
            onCommand(stationid, 'refund', null, null, null, details);
            return;
        } else if (action === 'rent') {
            confirmationText = t('rent_confirmation');
        } else if (action === 'eject count') {
            confirmationText = `${t('eject_count_confirmation')} ${details.slotid} ${t('chargers')}?`;
        }
        commandDetailsPayload.action = action;
        commandDetailsPayload.confirmationText = confirmationText;
        setCommandDetails(commandDetailsPayload);
        setCommandModalOpen(true);
    };

    const clientStations = useMemo(() => {
        let stations = allStationsData || [];

        if (clientInfo.username !== 'chargerent') { // For non-admin users
            if (clientInfo.partner) {
                stations = stations.filter(s => s.info.rep?.toLowerCase() === clientInfo.clientId?.toLowerCase());
            } else {
                stations = stations.filter(s => s.info.client === clientInfo.clientId);
            }
        }
        return stations;
    }, [allStationsData, clientInfo]);
    
    const stationsByLocation = useMemo(() => {
        return (clientStations || []).reduce((acc, station) => {
            const location = station.info.location;
            if (!acc[location]) acc[location] = [];
            acc[location].push(station);
            return acc;
        }, {});
    }, [clientStations]);

    const latestTimestamp = useMemo(() => {
        if (!allStationsData || allStationsData.length === 0) {
            return new Date().toISOString();
        }
        const latestStation = allStationsData.reduce((latest, current) => {
            if (!current || !current.lastUpdated) return latest;
            if (!latest) return current;
            const latestDate = new Date(latest.lastUpdated.endsWith('Z') ? latest.lastUpdated : latest.lastUpdated + 'Z');
            const currentDate = new Date(current.lastUpdated.endsWith('Z') ? current.lastUpdated : current.lastUpdated + 'Z');
            return currentDate > latestDate ? current : latest;
        }, null);
        return latestStation ? latestStation.lastUpdated : new Date().toISOString();
    }, [allStationsData]);
    
    const preFilteredKiosks = useMemo(() => {
        let kiosks = clientStations;
        
        // The 'Active' filter should only apply for 'chargerent' and 'partner' users.
        // Regular clients should always see all their kiosks.
        if (showActiveOnly && (clientInfo.username === 'chargerent' || clientInfo.partner)) {
            kiosks = kiosks.filter(k => isKioskActive(k, latestTimestamp));
        }

        // If there's a search term, apply it globally, ignoring country filters.
        if (clientInfo.username === 'chargerent' && debouncedSearchTerm) {
            const lowercasedSearch = debouncedSearchTerm.toLowerCase();
            kiosks = kiosks.filter(k => 
                k.info.location?.toLowerCase().includes(lowercasedSearch) ||
                k.stationid.toLowerCase().includes(lowercasedSearch) ||
                k.info.city?.toLowerCase().includes(lowercasedSearch) ||
                k.info.place?.toLowerCase().includes(lowercasedSearch) ||
                k.info.locationtype?.toLowerCase().includes(lowercasedSearch)
            );
        } else {
            // Otherwise, apply country and master filters as usual.
            const countryFilters = ['us', 'ca', 'fr'];
            if (activeFilters.master) {
                kiosks = kiosks.filter(k => k.info.place?.toUpperCase().includes('MASTER'));
            } else if (activeFilters.disney) {
                kiosks = kiosks.filter(k => k.info.location?.toLowerCase().includes('disney'));
            } else {
                const activeCountry = Object.keys(activeFilters).find(key => activeFilters[key] && countryFilters.includes(key));
                if (activeCountry && !activeFilters.all) { // Only apply country filter if 'all' is not active
                    kiosks = kiosks.filter(k => k.info.country?.toLowerCase() === activeCountry.toLowerCase());
                }
            }
        }
        return kiosks;
    }, [clientStations, showActiveOnly, debouncedSearchTerm, activeFilters, clientInfo.username, latestTimestamp]);
    
            const offlineKioskCount = useMemo(() => {
        return preFilteredKiosks.filter(kiosk => !isKioskOnline(kiosk, latestTimestamp)).length;
    }, [preFilteredKiosks, latestTimestamp]);

    const soldOutKioskCount = useMemo(() => {
        return preFilteredKiosks.filter(kiosk => kiosk.count === 0).length;
    }, [preFilteredKiosks]);

    const disconnectedKioskCount = useMemo(() => {
        return preFilteredKiosks.filter(kiosk => kiosk.modules.some(m => m.output === false)).length;
    }, [preFilteredKiosks]);

    const totalLeaseRevenue = useMemo(() => {
        if (!clientInfo?.features?.lease_revenue) return 0;
        return preFilteredKiosks.filter(k => k.pricing?.kioskmode === 'LEASE').reduce((sum, k) => sum + (Number(k.pricing?.leaseamount) || 0), 0);
    }, [preFilteredKiosks, clientInfo]);

    const filteredLocations = useMemo(() => {
        const locations = preFilteredKiosks.reduce((acc, station) => {
            const location = station.info.location;
            if (!acc[location]) acc[location] = [];
            acc[location].push(station);
            return acc;
        }, {});

        let allEntries = Object.entries(locations);

        // This logic should apply to any user with filter panel access, not just 'chargerent'.
        // It is also independent of the search term.
        const statusFilters = Object.keys(activeFilters).filter(key => activeFilters[key] && (key === 'offline' || key === 'soldout' || key === 'disconnected'));
        if (statusFilters.length > 0) {
            allEntries = allEntries.filter(([location, kiosks]) => {
                return statusFilters.every(filter => {
                    switch(filter) {
                        case 'offline':
                            return kiosks.some(k => !isKioskOnline(k, latestTimestamp));
                        case 'soldout':
                            return kiosks.some(k => k.count === 0);
                        case 'disconnected':
                            return kiosks.some(k => k.modules.some(m => m.output === false));
                        default:
                            return true;
                    }
                });
            });
        }

        return allEntries;

    }, [preFilteredKiosks, activeFilters, latestTimestamp]);

    const countryOrder = { 'CA': 1, 'FR': 2, 'US': 3 };

    // 1. Sort kiosks within each location group by stationid
    for (const [, kiosks] of filteredLocations) {
        kiosks.sort((a, b) => a.stationid.localeCompare(b.stationid));
    }

    // 2. Sort the location groups themselves by country, then by the first stationid in the group
    filteredLocations.sort(([locationA, kiosksA], [locationB, kiosksB]) => {
        const orderA = countryOrder[(kiosksA[0]?.info.country || 'ZZ').toUpperCase()] || 99;
        const orderB = countryOrder[(kiosksB[0]?.info.country || 'ZZ').toUpperCase()] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return kiosksA[0].stationid.localeCompare(kiosksB[0].stationid);
    });

    // Reset page to 1 if filters change and current page becomes invalid
    useEffect(() => {
        const totalPages = Math.ceil(filteredLocations.length / ITEMS_PER_PAGE);
        if (currentPage > totalPages) setCurrentPage(1);
    }, [filteredLocations, currentPage]);

    const filteredKiosksForGlobalStats = useMemo(() => {
        return filteredLocations.flatMap(([location, kiosks]) => kiosks);
    }, [filteredLocations]);

    const kioskToEdit = useMemo(() => {
        return editingKioskId ? allStationsData.find(k => k.stationid === editingKioskId) : null;
    }, [editingKioskId, allStationsData]);
    
    useEffect(() => { // This is the correct location for this hook
        // Show the offline kiosks modal on initial load if conditions are met.
        // To avoid race conditions with state updates, we derive the stations directly from the `kioskData` prop for this check.
        if (!loading && clientInfo?.features?.status && !initialStatusCheck && allStationsData.length > 0) {
            let stations = allStationsData; // Use the already normalized data

            if (clientInfo.username !== 'chargerent') {
                stations = stations.filter(s => s.info.client === clientInfo.clientId);
            }

            const countryFilter = clientInfo.features.country;
            if (countryFilter && countryFilter.toLowerCase() !== 'all') {
                stations = stations.filter(s => s.info.country?.toUpperCase() === countryFilter.toUpperCase());
            }

            const initialOfflineCount = stations.filter(k => isKioskActive(k, latestTimestamp) && !isKioskOnline(k, latestTimestamp)).length;
            if (initialOfflineCount > 0) {
                setShowInitialStatus(true);
            }
        }
    }, [loading, clientInfo, allStationsData, initialStatusCheck]); // Dependencies are correct

    const handleInitialStatusDone = () => {
        setShowInitialStatus(false);
        setInitialStatusCheck(true); // Mark it as seen for this session
    };

    const handleFilterChange = (filterKey) => {
        setSearchTerm(''); // Clear search when a filter is clicked
        setCurrentPage(1);

        const countryFilters = ['us', 'ca', 'fr']; // Disney is handled separately
        const specialStatusFilters = ['offline', 'soldout', 'disconnected'];

        if (filterKey === 'all') {
            setActiveFilters({ all: true });
            return;
        }

        setActiveFilters(prev => {
            let newFilters = { ...prev };
            delete newFilters.all; // 'all' is mutually exclusive

            const isCurrentlyActive = newFilters[filterKey];

            if (countryFilters.includes(filterKey)) {
                // Country filters are radio-button-like
                countryFilters.forEach(cf => delete newFilters[cf]);
                // Master is also mutually exclusive with countries
                delete newFilters.master;
                delete newFilters.disney;
                if (!isCurrentlyActive) newFilters[filterKey] = true;
            } else if (specialStatusFilters.includes(filterKey)) {
                // Offline and Soldout are mutually exclusive
                delete newFilters.offline;
                delete newFilters.soldout;
                delete newFilters.disconnected;
                if (!isCurrentlyActive) {
                    newFilters[filterKey] = true;
                }
            } else {
                // Handle master and disney filters
                if ((filterKey === 'master' || filterKey === 'disney') && !isCurrentlyActive) {
                    countryFilters.forEach(cf => delete newFilters[cf]);
                    delete newFilters.master;
                    delete newFilters.disney;
                }
                newFilters[filterKey] = !isCurrentlyActive;
            }

            // If no filters are active after the change, default to 'ca'
            if (filterKey === 'master' && !isCurrentlyActive) {
                // When activating master, clear country filters
                countryFilters.forEach(cf => delete newFilters[cf]);
            }

            const anyActive = Object.values(newFilters).some(val => val);
            if (!anyActive) {
                return { ca: true };
            }

            return newFilters;
        });
    };

    const handleSearchChange = (value) => {
        setSearchTerm(value);
    }

    // Pagination logic
    const paginatedLocations = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredLocations.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredLocations, currentPage]);

    const stationInfoForEnrichment = useMemo(() => {
        return (allStationsData || []).map(s => ({ stationid: s.stationid, client: s.info.client, rep: s.info.rep }));
    }, [allStationsData]);

    const enrichedRentalData = useMemo(() => {
        const stationToClientMap = new Map();
        stationInfoForEnrichment.forEach(station => {
            stationToClientMap.set(station.stationid, { client: station.client, rep: station.rep });
        });
        const enriched = (rentalData || []).map(rental => ({
            ...rental,
            clientId: stationToClientMap.get(rental.rentalStationid)?.client || rental.clientId, repId: stationToClientMap.get(rental.rentalStationid)?.rep || rental.repId
        }));
        return enriched;
    }, [rentalData, stationInfoForEnrichment]);

    const offlineKiosksByCountry = useMemo(() => {
        if (!showInitialStatus) return {};
        // Use clientStations which is already filtered by permission
        const activeButOffline = clientStations.filter(k => isKioskActive(k, latestTimestamp) && !isKioskOnline(k, latestTimestamp));
        return activeButOffline.reduce((acc, kiosk) => {
            const country = kiosk.info.country || 'Unknown';
            if (!acc[country]) acc[country] = [];
            acc[country].push(kiosk);
            // Sort kiosks within each country
            acc[country].sort((a, b) => a.stationid.localeCompare(b.stationid));
            return acc;
        }, {});
    }, [clientStations, latestTimestamp, showInitialStatus]);
    
return (
    <div>
        <ConfirmationModal 
            isOpen={commandModalOpen} 
            onClose={() => setCommandModalOpen(false)}
            onConfirm={handleSendCommand}
            details={commandDetails}
            t={t}
        />
        <NgrokModal
            isOpen={ngrokModalOpen}
            onClose={() => setNgrokModalOpen(false)}
            info={ngrokInfo}
            t={t}
        />
        <SoldOutKiosksModal
            isOpen={showSoldOutModal}
            onClose={() => setShowSoldOutModal(false)}
            soldOutKiosks={preFilteredKiosks.filter(kiosk => kiosk.count === 0)}
            t={t}
        />
        <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus(null)} />
        <div className="min-h-screen bg-gray-100">
            {showInitialStatus ? (
                <InitialStatusPage
                    offlineKiosksByCountry={offlineKiosksByCountry}
                    onDone={handleInitialStatusDone}
                    t={t}
                />
            ) : (
                <>

            {showWarning && <TimeoutWarningModal onStay={handleStay} onLogout={onLogout} />}
            <header className="bg-white shadow-sm">
                <div className="max-w-screen-2xl mx-auto py-4 px-4 sm:px-4 lg:px-6 flex justify-between items-center">
                    {/* Language buttons on the left */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => setLanguage('en')} className={`px-2 py-1 text-sm font-bold rounded-md ${language === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>EN</button>
                        <button onClick={() => setLanguage('fr')} className={`px-2 py-1 text-sm font-bold rounded-md ${language === 'fr' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>FR</button>
                    </div>
                    {/* Action buttons on the right */}
                    <div className="flex items-center gap-4">
                    {clientInfo.features.rentals && (
                        <>
                            <button onClick={onNavigateToRentals} className="p-2 rounded-md bg-green-100 text-green-700 hover:bg-green-200" title={t('rentals_page_title')}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                </svg>
                            </button>
                            <button onClick={onNavigateToChargers} className="p-2 rounded-md bg-yellow-100 text-yellow-700 hover:bg-yellow-200" title={t('chargers_page_title')}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </button>
                            {clientInfo.features.reporting && (
                                <button onClick={onNavigateToReporting} className="p-2 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200" title={t('reporting_page_title')}>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                </button>
                            )}
                        </>
                    )}
                    {clientInfo.commands['client edit'] && (
                        <button onClick={onNavigateToAdmin} className="p-2 rounded-md bg-orange-100 text-orange-700 hover:bg-orange-200" title={t('manage_clients')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        </button>
                    )}
                    <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    </button>
                    </div>
                </div>
            </header>
            <main className="max-w-screen-2xl mx-auto py-6 sm:px-4 lg:px-6">
                {loading ? (
                    <LoadingSpinner t={t} />
                ) : firestoreError ? (
                    <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6" role="alert">
                        <p className="font-bold">{t('connection_error_title')}</p>
                        <p>{firestoreError}</p>
                    </div>
                ) : (
                    <>
                        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">{error}</div>}
                        {clientInfo.features.rentals && (
                            <FilterPanel 
                                activeFilters={activeFilters} 
                                onFilterChange={handleFilterChange}
                                showActiveOnly={showActiveOnly}
                                onShowActiveOnlyChange={setShowActiveOnly}
                                searchTerm={searchTerm}
                                onSearchChange={handleSearchChange}
                                offlineCount={offlineKioskCount}
                                soldOutCount={soldOutKioskCount}
                                disconnectedCount={disconnectedKioskCount}
                                clientInfo={clientInfo}
                                t={t}
                            />
                        )}
                        {clientInfo.features.rentals && (
                            <GlobalRentalActivity
                                kiosks={filteredKiosksForGlobalStats}
                                rentalData={enrichedRentalData}
                                clientInfo={clientInfo}
                                referenceTime={latestTimestamp}
                                onShowRentalDetails={(kioskId, period) => handleShowRentalDetails(kioskId, period)}
                                activeFilters={activeFilters}
                                leaseRevenue={totalLeaseRevenue}
                                t={t}
                            />
                        )}

                        {allStationsData.length === 0 && loading ? (
                            <LoadingSpinner t={t} />
                        ) : paginatedLocations.length > 0 ? (
                            <>
                                {paginatedLocations.map(([location, kiosks]) => (
                                    <div key={location} className="mb-12">
                                        <LocationSummary 
                                            location={location} 
                                            kiosks={kiosks} 
                                            chargerThreshold={0.25} 
                                            clientInfo={clientInfo}
                                            rentalData={enrichedRentalData}
                                            referenceTime={latestTimestamp}
                                            t={t}
                                            onShowRentalDetails={(kioskId, period) => handleShowRentalDetails(kioskId, period)}
                                        />
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                            {kiosks.map(kiosk => (
                                                <div key={kiosk.stationid}>
                                                    <KioskPanel kiosk={kiosk} isExpanded={expandedKioskId === kiosk.stationid || editingKioskId === kiosk.stationid} onToggle={handleToggleDetails} onToggleEdit={handleToggleEditMode} mockNow={latestTimestamp} rentalData={enrichedRentalData} clientInfo={clientInfo} t={t} onCommand={handleGeneralCommand} onShowRentalDetails={handleShowRentalDetails} />
                                                    {editingKioskId === kiosk.stationid && kioskToEdit ? (
                                                        <KioskEditPanel kiosk={kioskToEdit} onSave={handleKioskSave} clientInfo={clientInfo} isVisible={editingKioskId === kiosk.stationid} t={t} onCommand={handleGeneralCommand} />
                                                    ) : (
                                                        clientInfo.features.details && <KioskDetailPanel kiosk={kiosk} isVisible={expandedKioskId === kiosk.stationid} onSlotClick={handleSlotClick} onLockSlot={handleLockSlotClick} pendingSlots={pendingSlots} ejectingSlots={ejectingSlots} lockingSlots={lockingSlots} t={t} onCommand={handleGeneralCommand} clientInfo={clientInfo} mockNow={latestTimestamp} serverFlowVersion={serverFlowVersion} serverUiVersion={serverUiVersion} />
                                                    )}
                                                    {rentalDetailView?.kioskId === kiosk.stationid && (
                                                        <RentalDetailView kiosk={kiosk} period={rentalDetailView.period} rentalData={enrichedRentalData} onClose={() => setRentalDetailView(null)} onCommand={handleGeneralCommand} t={t} />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                                <PaginationControls currentPage={currentPage} totalPages={Math.ceil(filteredLocations.length / ITEMS_PER_PAGE)} onPageChange={setCurrentPage} />
                            </>
                        ) : (
                            <div className="text-center text-gray-500 mt-10 bg-white p-8 rounded-lg shadow-md">{t('no_stations_found')}</div>
                        )}
                    </>
                )}
            </main>
                </>
            )}
        </div>
    </div>
);

}

const PaginationControls = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;

    return (
        <div className="flex justify-center items-center gap-4 mt-8">
            <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                Previous
            </button>
            <span className="text-sm text-gray-700">Page {currentPage} of {totalPages}</span>
            <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                Next
            </button>
        </div>
    );
};