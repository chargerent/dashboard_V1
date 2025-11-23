// src/components/Dashboard/LocationSummary.jsx

import React, { useMemo } from 'react';
import { isKioskOnline } from '../../utils/helpers';
import RentalStats from './RentalStats';

// Helper component for progress bars
const RectangularProgress = ({ percentage, color, value, label, subLabel }) => {
    return (
        <div className="flex flex-col w-full bg-gray-50 p-3 rounded-lg border border-gray-200">
            <div className="flex justify-between items-baseline mb-1">
                <span className="text-sm font-semibold text-gray-700">{label}</span>
                <span className="text-2xl font-bold text-gray-800">{value}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                    className="h-2 rounded-full" 
                    style={{ width: `${percentage}%`, backgroundColor: color, transition: 'width 0.5s ease-in-out' }}
                ></div>
            </div>
            {subLabel && <p className="text-xs text-gray-500 mt-1 text-right">{subLabel}</p>}
        </div>
    );
};

// Helper component for simple stat displays
const StatDisplay = ({ value, label }) => (
    <div className="flex flex-col w-full bg-gray-50 p-3 rounded-lg border border-gray-200">
        <div className="flex justify-between items-baseline">
            <span className="text-sm font-semibold text-gray-700">{label}</span>
            <span className="text-2xl font-bold text-gray-800">{value}</span>
        </div>
    </div>
);

// Combined Commission Stats component, styled like RentalStats
const CommissionStats = ({ clientInfo, accountMTD, accountYTD, repMTD, repYTD, showAccount, showRep, t }) => {
    const StatBox = ({ title, revenue, period }) => (
        <div className="flex flex-col justify-start text-center md:text-left">
            <h3 className="font-bold text-gray-800 mb-2 text-base">{title} ({period})</h3>
            <div className="bg-gray-100 p-2 rounded-md text-center">
                <p className="text-xl font-bold text-green-600 leading-tight">${revenue.toFixed(2)}</p>
                <p className="text-xs text-gray-500 mt-1">{period}</p>
            </div>
        </div>
    );

    return (
        <div className="grid grid-cols-2 gap-4">
            {showAccount && <StatBox title={t('client_commission_short')} revenue={accountMTD} period="MTD" />}
            {showAccount && clientInfo.username === 'chargerent' && <StatBox title={t('client_commission_short')} revenue={accountYTD} period="YTD" />}
            
            {showRep && <StatBox title={t('rep_commission_short')} revenue={repMTD} period="MTD" />}
            {showRep && clientInfo.username === 'chargerent' && <StatBox title={t('rep_commission_short')} revenue={repYTD} period="YTD" />}
        </div>
    );
};

function LocationSummary({ location, kiosks, chargerThreshold, clientInfo, rentalData, referenceTime, t, onShowRentalDetails }) {
    const summary = useMemo(() => {
        const leaseKiosks = kiosks.filter(k => k.pricing?.kioskmode === 'LEASE');
        const hasLeaseKiosks = leaseKiosks.length > 0;
        const totalLeaseRevenue = leaseKiosks.reduce((sum, k) => sum + (Number(k.pricing?.leaseamount) || 0), 0);
        const currencySymbol = kiosks[0]?.pricing?.symbol || '$';

        const onlineKiosks = kiosks.filter(k => isKioskOnline(k, referenceTime)).length;
        let totalChargers = 0;
        let fullChargers = 0;

        kiosks.forEach(kiosk => {
            const fullThreshold = kiosk.hardware?.power || 80;
            (kiosk.modules || []).forEach(module => {
                totalChargers += module.slots?.filter(s => s.sn && s.sn !== 0).length || 0;
                fullChargers += module.slots?.filter(s => s.sn && s.sn !== 0 && s.batteryLevel >= fullThreshold && !s.isLocked).length || 0;
            });
        });
        
        const stationIdsInLocation = new Set(kiosks.map(k => k.stationid));        
        let locationRentals = (rentalData || []);
        
        if (clientInfo.username !== 'chargerent') {
            if (clientInfo.partner) {
                locationRentals = locationRentals.filter(r => r.repId?.toLowerCase() === clientInfo.clientId?.toLowerCase());
            } else {
                locationRentals = locationRentals.filter(r => r.clientId === clientInfo.clientId);
            }
        }
        locationRentals = locationRentals.filter(r => stationIdsInLocation.has(r.rentalStationid));
        const rentedChargers = locationRentals.filter(r => r.status === 'rented').length;
        const missingChargers = locationRentals.filter(r => r.status === 'lost').length;
        
        const now = new Date(referenceTime.endsWith('Z') ? referenceTime : referenceTime + 'Z');
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const yearStart = new Date(now.getFullYear(), 0, 1);

        const rentalsInDateRange = (rentals, start, end) =>
            rentals.filter(r => {
                if (!r.rentalTime) return false;
                const rentalDate = new Date(r.rentalTime.endsWith('Z') ? r.rentalTime : r.rentalTime + 'Z');
                return rentalDate >= start && rentalDate <= end;
            });

        const mtdRentals = rentalsInDateRange(locationRentals, monthStart, now);
        const ytdRentals = rentalsInDateRange(locationRentals, yearStart, now);

        let accountCommissionMTD = 0;
        let repCommissionMTD = 0;
        let accountCommissionYTD = 0;
        let repCommissionYTD = 0;

        kiosks.forEach(kiosk => {
            const isLeaseKiosk = kiosk.pricing?.kioskmode === 'LEASE';
            const kioskMtdRevenue = mtdRentals.filter(r => r.rentalStationid === kiosk.stationid).reduce((acc, r) => acc + (r.totalCharged || 0), 0);
            const kioskYtdRevenue = ytdRentals.filter(r => r.rentalStationid === kiosk.stationid).reduce((acc, r) => acc + (r.totalCharged || 0), 0);

            if (kiosk.info.accountpercent) {
                accountCommissionMTD += kioskMtdRevenue * (kiosk.info.accountpercent / 100);
                accountCommissionYTD += kioskYtdRevenue * (kiosk.info.accountpercent / 100);
            }

            if (kiosk.info.reppercent) {
                if (isLeaseKiosk) {
                    // For lease kiosks, rep commission is based on lease amount, not rental revenue.
                    const leaseCommission = (Number(kiosk.pricing?.leaseamount) || 0) * (Number(kiosk.info.reppercent) / 100);
                    // MTD is the monthly lease commission.
                    repCommissionMTD += leaseCommission;
                    // YTD is the monthly commission multiplied by the number of months passed this year.
                    repCommissionYTD += leaseCommission * (now.getMonth() + 1);
                } else {
                    // For non-lease kiosks, commission is based on rental revenue.
                    repCommissionMTD += kioskMtdRevenue * (kiosk.info.reppercent / 100);
                    repCommissionYTD += kioskYtdRevenue * (kiosk.info.reppercent / 100);
                }
            }
        });

        const addressInfo = kiosks.length > 0 ? `${kiosks[0].info.stationaddress}, ${kiosks[0].info.city}, ${kiosks[0].info.zip}` : '';

        // Calculate rep commission specifically from lease revenue
        const repLeaseCommission = leaseKiosks.reduce((sum, k) => {
            if (clientInfo.username === 'chargerent' || clientInfo.username === k.info.rep) {
                return sum + ((Number(k.pricing?.leaseamount) || 0) * (Number(k.info.reppercent) || 0) / 100);
            }
            return sum;
        }, 0);

        return { onlineKiosks, totalChargers, fullChargers, rentedChargers, missingChargers, addressInfo, locationRentals, accountCommissionMTD, repCommissionMTD, accountCommissionYTD, repCommissionYTD, totalLeaseRevenue, currencySymbol, repLeaseCommission };
    }, [kiosks, rentalData, referenceTime, clientInfo]);

    const kioskOnlinePercent = kiosks.length > 0 ? (summary.onlineKiosks / kiosks.length) * 100 : 0;
    const kioskStatusColor = summary.onlineKiosks === kiosks.length ? '#22c55e' : '#ef4444';
    
    const chargerFullPercent = useMemo(() => {
        if (summary.totalChargers === 0) return 0;
        return (summary.fullChargers / summary.totalChargers) * 100;
    }, [summary.fullChargers, summary.totalChargers]);

    const chargerStatusColor = useMemo(() => {
        if (chargerFullPercent >= 50) return '#22c55e'; // Green for 50% or more
        if (chargerFullPercent >= 10) return '#f59e0b'; // Yellow for 10% to 49%
        return '#ef4444'; // Red for less than 10%
    }, [chargerFullPercent]);
    
    const canShowRentalInfo = clientInfo.features.rentals || clientInfo.features.lease_revenue || clientInfo.features.rental_counts || clientInfo.features.rental_revenue;

    const showAccountCommission = (clientInfo.features.client_commission || clientInfo.username === 'chargerent') && kiosks.some(k => k.info.accountpercent > 0);
    const showRepCommission = (clientInfo.features.rep_commission || clientInfo.username === 'chargerent') && kiosks.some(k => k.info.reppercent > 0);

    return (
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800">{location}</h2>
                    {clientInfo.features.address && <p className="text-sm text-gray-500 mt-1">{summary.addressInfo}</p>}
                </div>
            </div>
            <div className={`grid grid-cols-1 md:grid-cols-2 ${canShowRentalInfo ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-4`}>
                <RectangularProgress
                    percentage={kioskOnlinePercent}
                    color={kioskStatusColor}
                    value={kiosks.length}
                    label={t('assets_deployed')}
                    subLabel={`${summary.onlineKiosks} ${t('online')}`}
                />
                <RectangularProgress
                    percentage={chargerFullPercent}
                    color={chargerStatusColor}
                    value={summary.totalChargers}
                    label={t('chargers_in_system')}
                    subLabel={`${summary.fullChargers} ${t('full')}`}
                />
                {canShowRentalInfo && (
                    <React.Fragment>
                        <StatDisplay
                            value={summary.rentedChargers}
                            label={t('currently_rented')}
                        />
                        <StatDisplay
                            value={summary.missingChargers}
                            label={t('missing_chargers')}
                        />
                    </React.Fragment>
                )}
            </div>
            {canShowRentalInfo && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6 mt-6">
                    <div className="md:col-span-1">
                        <RentalStats 
                            rentalData={summary.locationRentals} 
                            clientInfo={clientInfo} 
                            referenceTime={referenceTime}
                            leaseRevenue={summary.totalLeaseRevenue}
                            repLeaseCommission={summary.repLeaseCommission}
                            kiosks={kiosks}
                            t={t}
                            onShowRentalDetails={onShowRentalDetails}
                        />
                    </div>
                    {(showAccountCommission || showRepCommission) && (
                        <div className="md:col-span-1">
                            <CommissionStats
                                accountMTD={summary.accountCommissionMTD}
                                accountYTD={summary.accountCommissionYTD}
                                repMTD={summary.repCommissionMTD}
                                repYTD={summary.repCommissionYTD}
                                showAccount={showAccountCommission}
                                showRep={showRepCommission}
                                clientInfo={clientInfo}
                                t={t}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default LocationSummary;