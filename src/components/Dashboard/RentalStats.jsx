// src/components/Dashboard/RentalStats.jsx

import { useMemo } from 'react';
function RentalStats({ rentalData, clientInfo, referenceTime, stationId, kiosks, isGlobal, activeFilters, t, onShowRentalDetails, leaseRevenue, repLeaseCommission }) {
    const stats = useMemo(() => {
        const now = new Date(referenceTime.endsWith('Z') ? referenceTime : referenceTime + 'Z');
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);

        let relevantRentals = rentalData || [];

        // Filtering is now handled by parent components (LocationSummary, KioskPanel)
        // which pass down pre-filtered data. This simplifies RentalStats.
        relevantRentals = relevantRentals.filter(r => r.rentalTime);

        if (stationId) {
            relevantRentals = relevantRentals.filter(r => r.rentalStationid === stationId);
        } else if (kiosks) {
            // The `rentalData` prop is already pre-filtered by the parent `LocationSummary`
        }

        const sumTotalCharged = (rentals) => rentals.reduce((sum, rental) => sum + (rental.totalCharged || 0), 0);
        const sumInitialCharge = (rentals) => rentals.reduce((sum, rental) => sum + (rental.initialCharge || 0), 0);

        const rentalsInDateRange = (rentals, start, end) => 
            rentals.filter(r => {
                if (!r.rentalTime) return false;
                const rentalDate = new Date(r.rentalTime.endsWith('Z') ? r.rentalTime : r.rentalTime + 'Z');
                return rentalDate >= start && rentalDate <= end;
            });
        
        const todayRentals = rentalsInDateRange(relevantRentals, today, now);
        const last7DaysRentals = rentalsInDateRange(relevantRentals, sevenDaysAgo, now);
        const last30DaysRentals = rentalsInDateRange(relevantRentals, thirtyDaysAgo, now);
        
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
            today: { count: todayRentals.length, revenue: sumTotalCharged(todayRentals), initialCharge: sumInitialCharge(todayRentals) },
            last7Days: { count: last7DaysRentals.length, revenue: sumTotalCharged(last7DaysRentals), initialCharge: sumInitialCharge(last7DaysRentals) },
            last30Days: { count: last30DaysRentals.length, revenue: sumTotalCharged(last30DaysRentals), initialCharge: sumInitialCharge(last30DaysRentals) },
            symbol: symbol
        };
    }, [rentalData, clientInfo, referenceTime, stationId, kiosks, isGlobal, activeFilters]);

    const labelClass = stationId ? "text-sm" : "text-base";
    const valueClass = stationId ? "text-xl" : "text-2xl";
    const gapClass = stationId ? "gap-2" : "gap-4";

    const StatBox = ({ period, count, revenue, initialCharge, symbol, onClick }) => {
        const handleClick = (e) => {
            e.stopPropagation(); // Prevent click from bubbling up to KioskPanel
            if (onClick) onClick();
        };
        return (
            <div 
                className={`bg-gray-100 p-2 rounded-md text-center ${onClick ? 'cursor-pointer hover:bg-gray-200 transition-colors' : 'cursor-default'}`}
                onClick={handleClick}
            >
                {(clientInfo?.features?.rental_counts || clientInfo?.username === 'chargerent') && (
                    <p className={`${valueClass} font-bold text-gray-700 leading-tight`}>{count}</p>
                )}
                {(clientInfo?.features?.rental_revenue || clientInfo?.username === 'chargerent') && (
                    <p className="text-sm font-semibold text-green-600">{symbol}{revenue.toFixed(2)} / {initialCharge.toFixed(2)}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">{t(period)}</p>
            </div>
        );
    };

    const showLeaseRevenue = (clientInfo?.features?.lease_revenue || clientInfo?.username === 'chargerent') && leaseRevenue > 0;
    const showRepLeaseCommission = clientInfo?.username === 'chargerent' && repLeaseCommission > 0;

    // If no rental/lease features are enabled, don't render anything.
    if (clientInfo?.username !== 'chargerent' && !clientInfo?.features?.rental_counts && !clientInfo?.features?.rental_revenue && !showLeaseRevenue) {
        return null;
    }

    return (
        <div className="flex flex-col justify-center text-center md:text-left">
            <h3 className={`font-bold text-gray-800 mb-2 ${labelClass}`}>{showLeaseRevenue ? t('revenue_activity') : t('rental_activity')}</h3>
            <div className={`grid ${showLeaseRevenue ? 'grid-cols-4' : 'grid-cols-3'} ${gapClass} items-stretch`}>
                <StatBox period="today" count={stats.today.count} revenue={stats.today.revenue} initialCharge={stats.today.initialCharge} symbol={stats.symbol} onClick={onShowRentalDetails ? () => onShowRentalDetails('today') : null} />
                <StatBox period="days_7" count={stats.last7Days.count} revenue={stats.last7Days.revenue} initialCharge={stats.last7Days.initialCharge} symbol={stats.symbol} onClick={onShowRentalDetails ? () => onShowRentalDetails('7days') : null} />
                <StatBox period="days_30" count={stats.last30Days.count} revenue={stats.last30Days.revenue} initialCharge={stats.last30Days.initialCharge} symbol={stats.symbol} onClick={onShowRentalDetails ? () => onShowRentalDetails('30days') : null} />
                {showLeaseRevenue && (
                    <div className="bg-gray-100 p-2 rounded-md text-center flex flex-col justify-center">
                        <p className={`${valueClass} font-bold text-purple-600 leading-tight`}>{stats.symbol}{leaseRevenue}</p>
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

export default RentalStats;