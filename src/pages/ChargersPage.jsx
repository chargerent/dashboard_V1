// src/pages/ChargersPage.jsx

import { useMemo, useState } from 'react';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import CommandStatusToast from '../components/UI/CommandStatusToast';
import { formatDateTime, formatDuration } from '../utils/dateFormatter';
import { normalizeKioskData } from '../utils/helpers';

const ChargerCard = ({ charger, t, onCommand }) => {
    const statusClass = charger.status === 'rented' ? 'bg-blue-100 text-blue-800' :
                        charger.status === 'in_kiosk' ? 'bg-green-100 text-green-800' :
                        charger.status === 'missing' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800';

    const isProblematic = charger.shortRentals >= 5;
    const cardBgClass = isProblematic ? 'bg-red-50' : 'bg-white';

    const isLocked = charger.location?.isLocked;

    const handleLockClick = () => {
        if (!charger.location) return;
        const { stationId, moduleId, slotId } = charger.location;
        const action = isLocked ? 'unlock slot' : 'lock slot';
        onCommand(stationId, action, moduleId, null, null, { slotid: slotId });
    };

    const canLock = charger.status === 'in_kiosk' && onCommand;
    const lockButtonColor = isLocked ? 'text-red-600 bg-red-100' : 'text-gray-400 hover:text-red-600 hover:bg-red-100';

    return (
        <div className={`${cardBgClass} shadow-md rounded-lg p-4 flex flex-col justify-between`}>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="font-bold text-lg text-gray-800 font-mono">{charger.sn}</h3>
                </div>
                <div className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClass}`}>
                    {t(charger.status)}
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                    <p className="text-xs text-gray-500">{t('total_rentals')}</p>
                    <p className="font-semibold text-gray-800">{charger.totalRentals}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-500">{t('short_rentals')}</p>
                    <p className="font-semibold text-gray-800">{charger.shortRentals}</p>
                </div>
                {charger.lastRentalTime && (
                    <>
                        <div>
                            <p className="text-xs text-gray-500">{t('last_rented')}</p>
                            <p className="font-semibold text-gray-800">{formatDateTime(charger.lastRentalTime)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">{t('duration')}</p>
                            <p className="font-semibold text-gray-800">{charger.lastRentalDuration}</p>
                        </div>
                    </>
                )}
            </div>

            {charger.location && (
                <div className="mt-4 border-t pt-4">
                    <p className="text-xs text-gray-500">{t('current_location')}</p>
                    <p className="text-sm font-medium text-gray-800">{charger.location.stationId}</p>
                    <p className="text-xs text-gray-600">
                        {t('module')}: {charger.location.moduleId.split('m').pop()}, {t('slot')}: {charger.location.slotId}
                    </p>
                </div>
            )}
            {(charger.status === 'rented' || charger.status === 'missing') && charger.rentedFrom && (
                <div className="mt-4 border-t pt-4">
                    <p className="text-xs text-gray-500">{t('rented_from')}</p>
                    <p className="text-sm font-medium text-gray-800">{charger.rentedFrom.stationId}</p>
                    <p className="text-xs text-gray-600">
                        {t('module')}: {charger.rentedFrom.moduleId}, {t('slot')}: {charger.rentedFrom.slotId}
                    </p>
                </div>
            )}
            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
                <button
                    onClick={handleLockClick}
                    disabled={!canLock}
                    className={`p-2 rounded-full ${lockButtonColor} disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors`}
                    title={canLock ? (isLocked ? t('unlock_slot') : t('lock_slot')) : t('cannot_lock_charger')}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default function ChargersPage({ onNavigateToDashboard, rentalData, kioskData, t, language, setLanguage, onLogout, onCommand, commandStatus, setCommandStatus, clientInfo }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');

    const chargers = useMemo(() => {
        console.log('[ChargersPage] Recalculating chargers. Props:', { rentalData, kioskData, clientInfo });
        if (!rentalData || !kioskData) {
            console.log('[ChargersPage] Missing rentalData or kioskData.');
            return [];
        }
        if (!clientInfo) {
            return [];
        }
        const chargerMap = new Map(); // Using a Map to ensure each charger SN is unique.

        // 1. Create a map of all chargers currently in any kiosk for quick lookup.
        const kioskChargerLocations = new Map();
        const clientKiosks = clientInfo.partner
            ? (kioskData || []).filter(k => k.info.rep?.toLowerCase() === clientInfo.clientId?.toLowerCase())
            : (kioskData || []).filter(k => k.info.client === clientInfo.clientId);

        const kiosksToProcess = clientInfo.username === 'chargerent' ? kioskData : clientKiosks;

        if (kiosksToProcess) {
            for (const kiosk of kiosksToProcess) {
                for (const module of (kiosk.modules || [])) {
                    (module.slots || []).forEach(slot => {
                        if (slot.sn && slot.sn !== 0) {
                            kioskChargerLocations.set(String(slot.sn), {
                                stationId: kiosk.stationid,
                                moduleId: module.id,
                                slotId: slot.position,
                                isLocked: !!slot.isLocked,
                                lockReason: slot.lockReason || '',
                            });
                        }
                    });
                }
            }
        }
        console.log(`[ChargersPage] Found ${kioskChargerLocations.size} chargers in kiosks.`);
        
        // 1. Process rental data to get rental counts
        if (rentalData && clientInfo) {
            let clientRentals = rentalData;

            // Filter rentals based on client permissions, similar to RentalsPage
            if (clientInfo.username !== 'chargerent') {
                if (clientInfo.partner) {
                    clientRentals = rentalData.filter(r => r.repId?.toLowerCase() === clientInfo.clientId?.toLowerCase());
                } else {
                    clientRentals = rentalData.filter(r => r.clientId === clientInfo.clientId);
                }
            }
            console.log(`[ChargersPage] Processing ${clientRentals.length} rentals for client.`);

            // Sort by time descending to easily find the latest status
            const sortedRentals = [...clientRentals].sort((a, b) => new Date(b.rentalTime) - new Date(a.rentalTime));

            for (const rental of clientRentals) {
                if (!rental.sn) continue;

                if (!chargerMap.has(rental.sn)) {
                    chargerMap.set(rental.sn, {
                        sn: rental.sn,
                        totalRentals: 0,
                        shortRentals: 0,
                        status: 'unknown',
                        location: null,
                        lastRentalTime: null,
                        lastRentalDuration: null,
                        rentedFrom: null,
                        isLocked: false,
                    });
                }

                const charger = chargerMap.get(rental.sn);
                charger.totalRentals += 1;
                if (rental.rentalPeriod && rental.rentalPeriod < 5 * 60 * 1000) {
                    charger.shortRentals += 1;
                }
            }
            
            // 2. Determine last rental info for all chargers
            for (const rental of sortedRentals) {
                if (!rental.sn) continue;
                const charger = chargerMap.get(rental.sn);
                
                // Set last rental time only if it hasn't been set yet (because of the sort)
                if (charger && !charger.lastRentalTime) {
                    charger.lastRentalTime = rental.rentalTime;
                    charger.lastRentalDuration = formatDuration(rental.rentalTime, rental.returnTime);
                    charger.rentedFrom = { stationId: rental.rentalStationid, moduleId: rental.rentalModuleid, slotId: rental.rentalSlotid };
                    charger.lastRentalStatus = rental.status; // Store the status of the last event
                }
            }

            // 3. Set final status based on kiosk location and last rental status
            for (const charger of chargerMap.values()) {
                if (kioskChargerLocations.has(charger.sn)) {
                    const location = kioskChargerLocations.get(charger.sn);
                    charger.status = 'in_kiosk';
                    charger.location = location;
                    charger.isLocked = location.isLocked;
                } else if (charger.lastRentalStatus === 'rented') {
                    charger.status = 'rented';
                } else if (charger.lastRentalStatus === 'returned') {
                    // If its last rental was a return, but it's not in a kiosk, it's missing.
                    charger.status = 'missing';
                }
            }

            // Add chargers that are in kiosks but have no rental history
            for (const [sn, location] of kioskChargerLocations.entries()) {
                if (!chargerMap.has(sn)) {
                    chargerMap.set(sn, { sn, totalRentals: 0, shortRentals: 0, status: 'in_kiosk', location, isLocked: location.isLocked });
                }
            }
        }

        console.log(`[ChargersPage] Final chargerMap has ${chargerMap.size} chargers.`, chargerMap);

        return Array.from(chargerMap.values()).sort((a, b) => a.sn.localeCompare(b.sn));
    }, [rentalData, kioskData, clientInfo]);

    const filteredChargers = useMemo(() => {
        let filtered = [...chargers];

        if (activeFilter === 'short_rentals') {
            filtered = filtered.filter(charger => charger.shortRentals > 0);
        } else if (activeFilter === 'in_kiosk') {
            filtered = filtered.filter(charger => charger.status === 'in_kiosk');
        } else if (activeFilter === 'rented') {
            filtered = filtered.filter(charger => charger.status === 'rented');
        } else if (activeFilter === 'missing') {
            filtered = filtered.filter(charger => charger.status === 'missing');
        }

        if (!searchTerm) return filtered;

        const lowercasedSearch = searchTerm.toLowerCase();
        return filtered.filter(charger =>
            (charger.sn && charger.sn.toLowerCase().includes(lowercasedSearch)) ||
            (charger.location?.stationId && charger.location.stationId.toLowerCase().includes(lowercasedSearch))
        );
    }, [chargers, searchTerm, activeFilter]);

    const [commandDetails, setCommandDetails] = useState(null);
    const [commandModalOpen, setCommandModalOpen] = useState(false);

    const handleCommand = (stationid, action, moduleid, provisionid, uiVersion, details) => {
        const isLocking = action === 'lock slot';
        const confirmationText = isLocking 
            ? `${t('lock_confirmation')} ${details.slotid}?`
            : `${t('unlock_confirmation')} ${details.slotid}?`;
        setCommandDetails({ stationid, action, moduleid, slotid: details.slotid, confirmationText, ...details });
        setCommandModalOpen(true);
    };

    const handleConfirmCommand = (reason = null) => {
        setCommandModalOpen(false);
        onCommand(commandDetails.stationid, commandDetails.action, commandDetails.moduleid, null, null, { slotid: commandDetails.slotid, info: reason });
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus(null)} />
            <ConfirmationModal isOpen={commandModalOpen} onClose={() => setCommandModalOpen(false)} onConfirm={handleConfirmCommand} details={commandDetails} t={t} />
            <header className="bg-white shadow-sm">
                <div className="max-w-screen-xl mx-auto py-4 px-4 sm:px-4 lg:px-6 flex justify-between items-center">
                    {/* Language buttons on the left */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => setLanguage('en')} className={`px-2 py-1 text-sm font-bold rounded-md ${language === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>EN</button>
                        <button onClick={() => setLanguage('fr')} className={`px-2 py-1 text-sm font-bold rounded-md ${language === 'fr' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>FR</button>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={onNavigateToDashboard} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300" title={t('back_to_dashboard')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        </button>
                        <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                </div>
            </header>
            <main className="max-w-screen-xl mx-auto py-6 sm:px-4 lg:px-6">
                <div className="bg-white p-4 rounded-lg shadow-md mb-8 space-y-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {['all', 'in_kiosk', 'rented', 'missing', 'short_rentals'].map(filter => (
                            <button key={filter} onClick={() => setActiveFilter(filter)}
                                className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${activeFilter === filter ? 'bg-blue-600 text-white shadow' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                                {t(filter)}
                            </button>
                        ))}
                        <div className="flex-grow"></div>
                        <div className="text-right">
                            <span className="text-lg font-bold text-gray-800">{filteredChargers.length}</span>
                            <span className="text-sm text-gray-500 ml-2">{t('chargers')}</span>
                        </div>
                    </div>
                    <div className="relative mt-4">
                        <input
                            type="text"
                            placeholder={t('chargers_search_placeholder')}
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-full focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredChargers.map(charger => (
                        <ChargerCard key={charger.sn} charger={charger} t={t} onCommand={handleCommand} />
                    ))}
                </div>
            </main>
        </div>
    );
}
