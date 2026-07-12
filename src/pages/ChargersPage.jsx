// src/pages/ChargersPage.jsx

import { useMemo, useState, useEffect } from 'react';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import CommandStatusToast from '../components/UI/CommandStatusToast';
import { formatDateTime, formatDuration } from '../utils/dateFormatter';
import { formatRentalChargeAmount, isReturnedRentalStatus, normalizeRefundStatus } from '../utils/rentals.js';
import { normalizeText, textEquals, textIncludes, toText } from '../utils/text';
import { isKioskOnline } from '../utils/helpers';

const firstPresent = (...values) => (
    values.find(value => value !== null && value !== undefined && String(value).trim() !== '')
);

const getRentalChargerId = (rental) => toText(firstPresent(rental?.sn, rental?.chargerid));

const humanizeCode = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    return raw
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase());
};

const translateCode = (value, t) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const translated = t(raw);
    return translated === raw ? humanizeCode(raw) : translated;
};

const formatTransactionId = (value) => {
    const transactionId = String(value || '').trim();
    if (!transactionId) return '';
    if (transactionId.length <= 18) return transactionId;

    return `${transactionId.slice(0, 8)}...${transactionId.slice(-6)}`;
};

const formatCardLast4 = (value) => {
    const cardLast4 = String(value || '').trim();
    return cardLast4;
};

const formatPower = (value) => {
    if (value === null || value === undefined || value === '') return '';

    const numericPower = Number(value);
    return Number.isFinite(numericPower) ? `${numericPower}%` : String(value);
};

const PILL_BASE_CLASS = 'rounded-full px-2 py-0.5 text-[10px] font-semibold';
const NEUTRAL_PILL_CLASS = `${PILL_BASE_CLASS} border border-gray-200 bg-gray-50 text-gray-600`;
const SHORT_RENTAL_PILL_CLASS = `${PILL_BASE_CLASS} bg-red-100 text-red-700`;
const REFUND_PILL_CLASS = `${PILL_BASE_CLASS} bg-emerald-100 text-emerald-800`;

const getRentalStatusClass = (status) => {
    const normalizedStatus = normalizeText(status);

    if (normalizedStatus === 'rented') return `${PILL_BASE_CLASS} bg-blue-100 text-blue-800`;
    if (normalizedStatus === 'returned') return `${PILL_BASE_CLASS} bg-green-100 text-green-800`;
    if (normalizedStatus === 'refunded') return `${PILL_BASE_CLASS} bg-emerald-100 text-emerald-800`;
    if (normalizedStatus === 'purchased') return `${PILL_BASE_CLASS} bg-purple-100 text-purple-800`;
    if (normalizedStatus === 'pending') return `${PILL_BASE_CLASS} bg-orange-100 text-orange-800`;
    if (normalizedStatus === 'vend_failed') return `${PILL_BASE_CLASS} bg-red-100 text-red-800`;

    return NEUTRAL_PILL_CLASS;
};

const buildStationLabel = (stationId, location, place) => {
    const primary = [stationId, location].filter(Boolean).join(' - ');
    return primary || place || '';
};

const buildSlotDetail = (moduleId, slotId, power) => {
    const parts = [];

    if (moduleId) parts.push(`M: ${String(moduleId).split('m').pop()}`);
    if (slotId !== null && slotId !== undefined && slotId !== '') parts.push(`S: ${slotId}`);
    if (power !== null && power !== undefined && power !== '') parts.push(`@ ${formatPower(power)}`);

    return parts.join(' ');
};

const buildVendIssueParts = (rental, t) => {
    const parts = [];
    const failureReason = firstPresent(rental.failureReason, rental.lastVendFailureReason, rental.lastVendFailure?.reason);
    const exitStatus = firstPresent(rental.exitStatus, rental.lastVendFailure?.exitStatus);
    const solenoidStatus = firstPresent(rental.solenoidStatus, rental.lastVendFailure?.solenoidStatus);
    const requestedSn = firstPresent(rental.lastVendFailure?.requestedSn, rental.currentVendAttempt?.sn);
    const responseSn = firstPresent(rental.lastVendFailure?.responseSn, rental.currentVendAttempt?.responseSn);

    if (failureReason) parts.push(`${t('reason')}: ${humanizeCode(failureReason)}`);
    if (exitStatus !== undefined) parts.push(`${t('exit_status')}: ${exitStatus}`);
    if (solenoidStatus !== undefined) parts.push(`${t('solenoid_status')}: ${solenoidStatus}`);
    if (requestedSn) parts.push(`${t('requested')}: ${requestedSn}`);
    if (responseSn && String(responseSn) !== String(requestedSn || '')) parts.push(`${t('response')}: ${responseSn}`);

    return parts;
};

const enrichRentalForHistory = (rental, stationInfoById) => {
    const rentalStationInfo = stationInfoById.get(String(rental?.rentalStationid || '')) || {};
    const returnStationInfo = stationInfoById.get(String(rental?.returnStationid || '')) || {};

    return {
        ...rental,
        rentalLocation: firstPresent(rental?.rentalLocation, rentalStationInfo.location),
        rentalPlace: firstPresent(rental?.rentalPlace, rentalStationInfo.place),
        returnLocation: firstPresent(rental?.returnLocation, returnStationInfo.location),
        returnPlace: firstPresent(rental?.returnPlace, returnStationInfo.place),
    };
};

const RentalHistoryItem = ({ rental, t, onOpen }) => {
    const status = normalizeText(rental.status) || 'unknown';
    const statusLabel = translateCode(status, t);
    const transactionId = firstPresent(
        rental.orderid,
        rental.rawid,
        rental.transactionid,
        rental.transactionId,
        rental.paymentSessionId
    );
    const rentalStationLabel = buildStationLabel(rental.rentalStationid, rental.rentalLocation, rental.rentalPlace);
    const returnStationLabel = rental.returnTime
        ? buildStationLabel(rental.returnStationid, rental.returnLocation, rental.returnPlace)
        : t('in_use');
    const rentalSlotDetail = buildSlotDetail(rental.rentalModuleid, rental.rentalSlotid, rental.rentPower);
    const returnSlotDetail = rental.returnTime
        ? buildSlotDetail(rental.returnModuleid, rental.returnSlotid, rental.returnPower)
        : '';
    const duration = rental.returnTime ? formatDuration(rental.rentalTime, rental.returnTime) : t('in_use');
    const shouldShowAmount = isReturnedRentalStatus(rental.status) || status === 'purchased' || Number(rental.totalCharged || rental.buyprice || 0) > 0;
    const amount = shouldShowAmount ? formatRentalChargeAmount(rental) : '';
    const returnType = translateCode(rental.returnType, t);
    const refundStatus = normalizeRefundStatus(rental.refundStatus);
    const vendIssueParts = buildVendIssueParts(rental, t);
    const isShortRental = isReturnedRentalStatus(rental.status) && rental.rentalPeriod && rental.rentalPeriod < 5 * 60 * 1000;
    const attemptsCount = Array.isArray(rental.vendAttempts) ? rental.vendAttempts.length : 0;
    const cardLast4 = formatCardLast4(rental.card_last4);
    const rentalTimeLabel = formatDateTime(rental.rentalTime);
    const returnTimeLabel = rental.returnTime ? formatDateTime(rental.returnTime) : t('in_use');
    const metadataPills = [
        { label: returnType, className: NEUTRAL_PILL_CLASS },
        {
            label: attemptsCount > 0 ? `${attemptsCount} ${t(attemptsCount === 1 ? 'attempt' : 'attempts')}` : '',
            className: NEUTRAL_PILL_CLASS,
        },
        {
            label: refundStatus ? `${t('refund_status')}: ${translateCode(refundStatus, t)}` : '',
            className: REFUND_PILL_CLASS,
        },
    ].filter(pill => pill.label);

    return (
        <div
            onClick={onOpen}
            className={`text-xs rounded-md border border-gray-200 bg-white p-3 ${onOpen ? 'cursor-pointer hover:border-gray-400 transition-colors' : ''}`}
        >
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2">
                <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-gray-900" title={rental.rentalStationid || rentalStationLabel}>
                        {rental.rentalStationid || rentalStationLabel || t('station')}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500" title={transactionId}>
                        ID: {formatTransactionId(transactionId) || '—'}
                    </p>
                    {cardLast4 && (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                            {t('card')}: {cardLast4}
                        </p>
                    )}
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                    <div className="flex items-center justify-end gap-1.5">
                        <span className={getRentalStatusClass(status)}>{statusLabel}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                        {!isShortRental && (
                            <span className="text-[10px] font-medium text-gray-500">{duration}</span>
                        )}
                        {isShortRental && (
                            <span className={SHORT_RENTAL_PILL_CLASS}>{t('short_rental')}</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="mt-3 space-y-3">
                <div>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('rented')}</p>
                        <p className="text-[11px] font-medium text-gray-600">{rentalTimeLabel}</p>
                    </div>
                    <p className="mt-0.5 truncate font-semibold text-gray-900" title={rentalStationLabel}>
                        {rentalStationLabel || '—'}
                    </p>
                    {rentalSlotDetail && (
                        <p className="mt-0.5 text-[11px] text-gray-500">{rentalSlotDetail}</p>
                    )}
                    {rental.rentPower != null && (
                        <p className="mt-1 text-[11px] font-medium text-gray-700">
                            {t('rent_power')}: {formatPower(rental.rentPower)}
                        </p>
                    )}
                </div>

                <div>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('returned')}</p>
                        <p className="text-[11px] font-medium text-gray-600">{returnTimeLabel}</p>
                    </div>
                    <p className="mt-0.5 truncate font-semibold text-gray-900" title={returnStationLabel}>
                        {returnStationLabel || '—'}
                    </p>
                    {(returnSlotDetail || returnType) && (
                        <p className="mt-0.5 text-[11px] text-gray-500">{returnSlotDetail || returnType}</p>
                    )}
                    {rental.returnPower != null && (
                        <p className="mt-1 text-[11px] font-medium text-gray-700">
                            {t('return_power')}: {formatPower(rental.returnPower)}
                        </p>
                    )}
                </div>
            </div>

            {(metadataPills.length > 0 || amount) && (
                <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-gray-100 pt-2">
                    {metadataPills.map(({ label, className }, index) => (
                        <span
                            key={`${label}-${index}`}
                            className={className}
                        >
                            {label}
                        </span>
                    ))}
                    <span className="ml-1 font-mono text-sm font-semibold text-gray-900">{amount || '—'}</span>
                </div>
            )}

            {vendIssueParts.length > 0 && (
                <div className="mt-2 border-t border-gray-100 pt-2 text-[10px] leading-4 text-gray-600">
                    {vendIssueParts.join(' | ')}
                </div>
            )}

        </div>
    );
};

const ChargerCard = ({ charger, t, onCommand, onNavigateToRentals, onNavigateToDashboard }) => {
    const [showRentals, setShowRentals] = useState(false);

    const statusClass = charger.status === 'rented' ? 'bg-blue-100 text-blue-800' :
                        charger.status === 'in_kiosk' ? 'bg-green-100 text-green-800' :
                        charger.status === 'missing' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800';

    const isProblematic = charger.shortRentals >= 5;
    const cardBgClass = isProblematic ? 'bg-red-50' : 'bg-white';

    const isLocked = charger.location?.isLocked;

    const handleLockClick = () => {
        if (!charger.location) return;
        const { stationId, moduleId, slotId, lockReason } = charger.location;
        const action = isLocked ? 'unlock slot' : 'lock slot';
        onCommand(stationId, action, moduleId, null, null, {
            slotid: slotId,
            lockReason: lockReason || '',
        });
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
                    <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-gray-800">{charger.location.stationId}</p>
                        {onNavigateToDashboard && (
                            <button
                                onClick={() => onNavigateToDashboard(charger.location.stationId)}
                                className="text-blue-500 hover:text-blue-700 transition-colors"
                                title={t('go_to_kiosk')}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                            </button>
                        )}
                    </div>
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
            {charger.rentals && charger.rentals.length > 0 && (
                <div className="mt-4 border-t pt-3">
                    <button
                        onClick={() => setShowRentals(prev => !prev)}
                        className="flex items-center justify-between w-full text-xs font-semibold text-gray-500 hover:text-gray-800 transition-colors"
                    >
                        <span>{t('rental_history')} ({charger.rentals.length})</span>
                        <svg className={`w-4 h-4 transition-transform duration-200 ${showRentals ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    {showRentals && (
                        <div className="mt-2 max-h-96 overflow-y-auto space-y-2 pr-1">
                            {charger.rentals.map((rental, index) => (
                                <RentalHistoryItem
                                    key={rental.rawid || rental.orderid || `${rental.rentalTime}-${index}`}
                                    rental={rental}
                                    t={t}
                                    onOpen={onNavigateToRentals ? () => onNavigateToRentals(charger.sn) : null}
                                />
                            ))}
                        </div>
                    )}
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

export default function ChargersPage({ onNavigateToDashboard, onNavigateToRentals, rentalData, kioskData, t, language, setLanguage, onLogout, onCommand, commandStatus, setCommandStatus, clientInfo, initialSearch = '' }) {
    const [searchTerm, setSearchTerm] = useState(initialSearch);
    const [activeFilter, setActiveFilter] = useState('all');

    const latestTimestamp = useMemo(() => {
        if (!Array.isArray(kioskData) || kioskData.length === 0) {
            return new Date().toISOString();
        }

        const latestStation = kioskData.reduce((latest, current) => {
            if (!current || !current.lastUpdated) return latest;
            if (!latest) return current;

            const latestDate = new Date(latest.lastUpdated.endsWith('Z') ? latest.lastUpdated : `${latest.lastUpdated}Z`);
            const currentDate = new Date(current.lastUpdated.endsWith('Z') ? current.lastUpdated : `${current.lastUpdated}Z`);
            return currentDate > latestDate ? current : latest;
        }, null);

        return latestStation ? latestStation.lastUpdated : new Date().toISOString();
    }, [kioskData]);

    const getKioskTimestamp = (kiosk) => {
        const rawTimestamp = kiosk?.lastUpdated || kiosk?.lastUpdate || kiosk?.timestamp || '';
        if (!rawTimestamp) return 0;

        const normalizedTimestamp = rawTimestamp.endsWith('Z') ? rawTimestamp : `${rawTimestamp}Z`;
        const parsedTimestamp = Date.parse(normalizedTimestamp);
        return Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
    };

    useEffect(() => {
        setSearchTerm(initialSearch);
    }, [initialSearch]);

    // Stable fingerprint of charger locations — only changes when a charger SN
    // actually moves in/out of a slot. Heartbeat-only updates (battery, timestamp)
    // produce the same string, preventing unnecessary charger recalculation.
    const kioskChargerFingerprint = useMemo(() => {
        if (!kioskData) return '';
        return kioskData
            .map(k => `${k.stationid}:${
                (k.modules || []).map(m =>
                    (m.slots || []).filter(s => s.sn && s.sn !== 0)
                        .map(s => `${s.sn}@${m.id}/${s.position}:${s.isLocked ? 1 : 0}`)
                        .join(',')
                ).join(';')
            }`)
            .sort()
            .join('|');
    }, [kioskData]);

    const chargers = useMemo(() => {
        if (!rentalData || !kioskData) {
            return [];
        }
        if (!clientInfo) {
            return [];
        }
        const chargerMap = new Map(); // Using a Map to ensure each charger SN is unique.
        const stationInfoById = new Map(
            (kioskData || []).map(kiosk => [
                String(kiosk?.stationid || ''),
                {
                    location: kiosk?.info?.location || '',
                    place: kiosk?.info?.place || '',
                },
            ])
        );

        // 1. Create a map of all chargers currently in any kiosk for quick lookup.
        const kioskChargerLocations = new Map();
        const clientKiosks = clientInfo.role === 'partner'
            ? (kioskData || []).filter(k => textEquals(k.info.rep, clientInfo.clientId))
            : (kioskData || []).filter(k => textEquals(k.info.client, clientInfo.clientId));

        const kiosksToProcess = (clientInfo.isAdmin ? kioskData : clientKiosks)
            .filter((kiosk) => isKioskOnline(kiosk, latestTimestamp));

        if (kiosksToProcess) {
            for (const kiosk of kiosksToProcess) {
                for (const module of (kiosk.modules || [])) {
                    (module.slots || []).forEach(slot => {
                        if (slot.sn && slot.sn !== 0) {
                            const nextLocation = {
                                stationId: kiosk.stationid,
                                moduleId: module.id,
                                slotId: slot.position,
                                isLocked: !!slot.isLocked,
                                lockReason: slot.lockReason || '',
                                kioskTimestamp: getKioskTimestamp(kiosk),
                            };
                            const existingLocation = kioskChargerLocations.get(String(slot.sn));

                            if (!existingLocation || nextLocation.kioskTimestamp >= existingLocation.kioskTimestamp) {
                                kioskChargerLocations.set(String(slot.sn), nextLocation);
                            }
                        }
                    });
                }
            }
        }
        
        // 1. Process rental data to get rental counts
        if (rentalData && clientInfo) {
            let clientRentals = rentalData;

            // Filter rentals based on client permissions, similar to RentalsPage
            if (!clientInfo.isAdmin) {
                if (clientInfo.role === 'partner') {
                    clientRentals = rentalData.filter(r => textEquals(r.repId, clientInfo.clientId));
                } else {
                    clientRentals = rentalData.filter(r => textEquals(r.clientId, clientInfo.clientId));
                }
            }

            // Sort by time descending to easily find the latest status
            const enrichedRentals = clientRentals.map(rental => enrichRentalForHistory(rental, stationInfoById));
            const sortedRentals = [...enrichedRentals].sort((a, b) => new Date(b.rentalTime) - new Date(a.rentalTime));

            for (const rental of enrichedRentals) {
                const chargerSn = getRentalChargerId(rental);
                if (!chargerSn) continue;

                if (!chargerMap.has(chargerSn)) {
                    chargerMap.set(chargerSn, {
                        sn: chargerSn,
                        totalRentals: 0,
                        shortRentals: 0,
                        status: 'unknown',
                        location: null,
                        lastRentalTime: null,
                        lastRentalDuration: null,
                        rentedFrom: null,
                        isLocked: false,
                        rentals: [],
                    });
                }

                const charger = chargerMap.get(chargerSn);
                charger.totalRentals += 1;
                if (rental.rentalPeriod && rental.rentalPeriod < 5 * 60 * 1000) {
                    charger.shortRentals += 1;
                }
                charger.rentals.push(rental);
            }
            
            // 2. Determine last rental info for all chargers
            for (const rental of sortedRentals) {
                const chargerSn = getRentalChargerId(rental);
                if (!chargerSn) continue;
                const charger = chargerMap.get(chargerSn);
                
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
                } else if (isReturnedRentalStatus(charger.lastRentalStatus)) {
                    // If its last rental was a return, but it's not in a kiosk, it's missing.
                    charger.status = 'missing';
                }
            }

            // Add chargers that are in kiosks but have no rental history
            for (const [sn, location] of kioskChargerLocations.entries()) {
                if (!chargerMap.has(sn)) {
                    chargerMap.set(sn, { sn, totalRentals: 0, shortRentals: 0, status: 'in_kiosk', location, isLocked: location.isLocked, rentals: [] });
                }
            }

            // Sort each charger's rental history newest first
            for (const charger of chargerMap.values()) {
                charger.rentals.sort((a, b) => new Date(b.rentalTime) - new Date(a.rentalTime));
            }
        }


        return Array.from(chargerMap.values()).sort((a, b) => a.sn.localeCompare(b.sn));
    }, [rentalData, kioskChargerFingerprint, clientInfo, kioskData, latestTimestamp]);

    const filteredChargers = useMemo(() => {
        let filtered = [...chargers];

        if (activeFilter === 'short_rentals') {
            filtered = filtered.filter(charger => charger.shortRentals > 0);
            filtered.sort((a, b) => b.shortRentals - a.shortRentals);
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
            textIncludes(charger.sn, lowercasedSearch) ||
            textIncludes(charger.location?.stationId, lowercasedSearch)
        );
    }, [chargers, searchTerm, activeFilter]);

    const [commandDetails, setCommandDetails] = useState(null);
    const [commandModalOpen, setCommandModalOpen] = useState(false);

    const handleCommand = (stationid, action, moduleid, provisionid, uiVersion, details) => {
        const isLocking = action === 'lock slot';
        const confirmationText = isLocking 
            ? `${t('lock_confirmation')} ${details.slotid}?`
            : `${t('unlock_confirmation')} ${details.slotid}?`;
        setCommandDetails({
            stationid,
            action,
            moduleid,
            slotid: details.slotid,
            confirmationText,
            lockReason: details?.lockReason || '',
            ...details,
        });
        setCommandModalOpen(true);
    };

    const handleConfirmCommand = (reason = null) => {
        setCommandModalOpen(false);
        if (!commandDetails) return;
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
                        <button onClick={() => onNavigateToDashboard()} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300" title={t('back_to_dashboard')}>
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
                        <ChargerCard key={charger.sn} charger={charger} t={t} onCommand={handleCommand} onNavigateToRentals={onNavigateToRentals} onNavigateToDashboard={onNavigateToDashboard} />
                    ))}
                </div>
            </main>
        </div>
    );
}
