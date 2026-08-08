// src/components/Dashboard/RentalStats.jsx

import { memo, useMemo } from 'react';
import { usesFullPriceRevenueTotal } from '../../utils/rentalRevenueDisplay';

const StatBox = memo(function StatBox({ period, selection, count, revenue, initialCharge, showInitialCharge, symbol, onShowRentalDetails, clientInfo, valueClass, t }) {
    const handleClick = (event) => {
        event.stopPropagation();
        onShowRentalDetails?.(selection);
    };

    return (
        <button
            type="button"
            className={`w-full bg-gray-100 p-2 rounded-md text-center ${onShowRentalDetails ? 'cursor-pointer hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500' : 'cursor-default'}`}
            onClick={handleClick}
            disabled={!onShowRentalDetails}
        >
            {(clientInfo?.features?.rental_counts || clientInfo?.isAdmin) && (
                <p className={`${valueClass} font-bold text-gray-700 leading-tight`}>{count}</p>
            )}
            {(clientInfo?.features?.rental_revenue || clientInfo?.isAdmin) && (
                <p className="text-sm font-semibold text-green-600">
                    <span className="block sm:inline">{symbol}{revenue.toFixed(0)}</span>
                    {showInitialCharge && (
                        <>
                            <span className="hidden sm:inline"> / </span>
                            <span className="mx-auto my-1 block h-px w-10 bg-green-300 sm:hidden" aria-hidden="true"></span>
                            <span className="block sm:inline">{symbol}{initialCharge.toFixed(0)}</span>
                        </>
                    )}
                </p>
            )}
            <p className="text-xs text-gray-500 mt-1">{t(period)}</p>
        </button>
    );
});

function RentalStats({ rentalData, dashboardStats, clientInfo, referenceTime, stationId, kiosks, isGlobal, activeFilters, gatewayOptions, t, onShowRentalDetails, onNavigateToActivity, leaseRevenue, repLeaseCommission }) {
    const stats = useMemo(() => {
        if (dashboardStats) return dashboardStats;

        const now = new Date(referenceTime.endsWith('Z') ? referenceTime : referenceTime + 'Z');
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        sevenDaysAgo.setMinutes(0, 0, 0);
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);
        thirtyDaysAgo.setMinutes(0, 0, 0);

        let relevantRentals = rentalData || [];

        // Filtering is now handled by parent components (LocationSummary, KioskPanel)
        // which pass down pre-filtered data. This simplifies RentalStats.
        relevantRentals = relevantRentals.filter(r => r.rentalTime);

        if (stationId) {
            relevantRentals = relevantRentals.filter(r => r.rentalStationid === stationId);
        } else if (kiosks) {
            // The `rentalData` prop is already pre-filtered by the parent `LocationSummary`
        }

        const totals = {
            today: { count: 0, revenue: 0, initialCharge: 0 },
            last7Days: { count: 0, revenue: 0, initialCharge: 0 },
            last30Days: { count: 0, revenue: 0, initialCharge: 0 },
        };

        relevantRentals.forEach(rental => {
            const normalizedRentalTime = rental.rentalTime.endsWith('Z')
                ? rental.rentalTime
                : `${rental.rentalTime}Z`;
            const rentalTime = Date.parse(normalizedRentalTime);
            if (!Number.isFinite(rentalTime) || rentalTime > now.getTime() || rentalTime < thirtyDaysAgo.getTime()) return;

            const revenue = Number(rental.totalCharged) || 0;
            const initialCharge = Number(rental.initialCharge) || 0;
            const addToPeriod = (period) => {
                period.count += 1;
                period.revenue += revenue;
                period.initialCharge += initialCharge;
            };

            addToPeriod(totals.last30Days);
            if (rentalTime >= sevenDaysAgo.getTime()) addToPeriod(totals.last7Days);
            if (rentalTime >= today.getTime()) addToPeriod(totals.today);
        });
        
        let symbol = '$';
        
        if (isGlobal) {
            const countryFilters = ['us', 'ca', 'fr'];
            const activeCountry = Object.keys(activeFilters || {}).find(key => activeFilters[key] && countryFilters.includes(key));
            
            if (activeCountry) {
                const rentalForSymbol = rentalData.find(r => r.symbol && r.rentalStationid.toLowerCase().startsWith(activeCountry));
                symbol = rentalForSymbol ? rentalForSymbol.symbol : '';
            } else {
                symbol = ''; // No symbol if 'all' or multiple countries are selected
            }
        } else {
            const firstRentalWithSymbol = relevantRentals.find(r => r.symbol);
            symbol = firstRentalWithSymbol ? firstRentalWithSymbol.symbol : '$';
        }

        return {
            ...totals,
            symbol: symbol
        };
    }, [activeFilters, dashboardStats, isGlobal, kiosks, referenceTime, rentalData, stationId]);

    const labelClass = stationId ? "text-sm" : "text-base";
    const valueClass = stationId ? "text-xl" : "text-2xl";
    const gapClass = stationId ? "gap-2" : "gap-4";

    const showLeaseRevenue = (clientInfo?.features?.lease_revenue || clientInfo?.isAdmin) && leaseRevenue > 0;
    const showRepLeaseCommission = clientInfo?.isAdmin && repLeaseCommission > 0;
    const showInitialCharge = !usesFullPriceRevenueTotal(gatewayOptions);
    const canNavigateToActivity = clientInfo?.isAdmin === true && Boolean(stationId) &&
        !showLeaseRevenue && typeof onNavigateToActivity === 'function';

    // If no rental/lease features are enabled, don't render anything.
    if (!clientInfo?.isAdmin && !clientInfo?.features?.rental_counts && !clientInfo?.features?.rental_revenue && !showLeaseRevenue) {
        return null;
    }

    return (
        <div className="flex flex-col justify-center text-center md:text-left">
            <h3 className={`font-bold text-gray-800 mb-2 ${labelClass}`}>
                {canNavigateToActivity ? (
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-sm text-left text-[#9D6B8F] underline decoration-[#D7B4CA] underline-offset-2 hover:text-[#7F536F] focus:outline-none focus:ring-2 focus:ring-[#B784A7]"
                        aria-label={`View activity for ${stationId}`}
                        onClick={(event) => {
                            event.stopPropagation();
                            onNavigateToActivity(stationId);
                        }}
                    >
                        <svg data-icon="activity-pulse" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l2.25-6 4.5 12L16 12h5" />
                        </svg>
                        {t('rental_activity')}
                    </button>
                ) : showLeaseRevenue ? t('revenue_activity') : t('rental_activity')}
            </h3>
            <div className={`grid ${showLeaseRevenue ? 'grid-cols-4' : 'grid-cols-3'} ${gapClass} items-stretch`}>
                <StatBox period="today" selection="today" count={stats.today.count} revenue={stats.today.revenue} initialCharge={stats.today.initialCharge} showInitialCharge={showInitialCharge} symbol={stats.symbol} onShowRentalDetails={onShowRentalDetails} clientInfo={clientInfo} valueClass={valueClass} t={t} />
                <StatBox period="days_7" selection="7days" count={stats.last7Days.count} revenue={stats.last7Days.revenue} initialCharge={stats.last7Days.initialCharge} showInitialCharge={showInitialCharge} symbol={stats.symbol} onShowRentalDetails={onShowRentalDetails} clientInfo={clientInfo} valueClass={valueClass} t={t} />
                <StatBox period="days_30" selection="30days" count={stats.last30Days.count} revenue={stats.last30Days.revenue} initialCharge={stats.last30Days.initialCharge} showInitialCharge={showInitialCharge} symbol={stats.symbol} onShowRentalDetails={onShowRentalDetails} clientInfo={clientInfo} valueClass={valueClass} t={t} />
                {showLeaseRevenue && (
                    <div className="bg-gray-100 p-2 rounded-md text-center flex flex-col justify-center">
                        <p className="text-sm font-semibold text-purple-600 leading-tight">{stats.symbol}{leaseRevenue}</p>
                        {showRepLeaseCommission && (
                            <p className="text-xs font-semibold text-green-600">
                                {stats.symbol}{repLeaseCommission.toFixed(2)}
                            </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">{t('lease_revenue')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default memo(RentalStats);
