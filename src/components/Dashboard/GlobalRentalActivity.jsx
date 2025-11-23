// src/components/Dashboard/GlobalRentalActivity.jsx

import { useMemo } from 'react';
import RentalStats from './RentalStats';

function GlobalRentalActivity({ kiosks, rentalData, clientInfo, referenceTime, activeFilters, t, onShowRentalDetails, leaseRevenue }) {
    const filteredRentals = useMemo(() => {
        // Create a lookup map from kiosk stationid to its info object.
        const stationInfoMap = new Map(kiosks.map(kiosk => [kiosk.stationid, { 
            country: kiosk.stationid?.substring(0, 2).toLowerCase(),
            location: kiosk.info?.location,
            place: kiosk.info?.place
        }]));

        // Enrich rental data with country information from the kiosks map
        const enrichedRentalData = rentalData.map(rental => ({
            ...rental,
            stationInfo: stationInfoMap.get(rental.rentalStationid)
        }));

        // Find the active primary filter (country, master, disney)
        const activePrimaryFilter = activeFilters ? Object.keys(activeFilters).find(key => activeFilters[key] && ['us', 'ca', 'fr', 'master', 'disney'].includes(key)) : null;

        let finalFilteredRentals;

        // For partners (excluding 'chargerent'), first filter by their ID
        if (clientInfo.partner && clientInfo.username !== 'chargerent') {
            const partnerId = clientInfo.clientId?.toLowerCase();
            const partnerRentals = enrichedRentalData.filter(r => r.repId?.toLowerCase() === partnerId);
            
            // Then, apply country filter if one is active
            if (activePrimaryFilter) {
                finalFilteredRentals = partnerRentals.filter(r => r.stationInfo?.country?.toLowerCase() === activePrimaryFilter.toLowerCase());
            } else {
                finalFilteredRentals = partnerRentals;
            }
        } else {
            // For 'chargerent' and other non-partner accounts, apply the active primary filter
            if (activePrimaryFilter) {
                if (activePrimaryFilter === 'master') {
                    finalFilteredRentals = enrichedRentalData.filter(r => r.stationInfo?.place?.toUpperCase().includes('MASTER'));
                } else if (activePrimaryFilter === 'disney') {
                    finalFilteredRentals = enrichedRentalData.filter(r => r.stationInfo?.location?.toLowerCase().includes('disney'));
                } else { // Country filter
                    finalFilteredRentals = enrichedRentalData.filter(r => r.stationInfo?.country?.toLowerCase() === activePrimaryFilter.toLowerCase());
                }
            } else {
                finalFilteredRentals = enrichedRentalData; // Return all data if no filters apply
            }
        }

        return finalFilteredRentals;
    }, [rentalData, kiosks, clientInfo, activeFilters]);

    const canShowRentalInfo = clientInfo.features.rentals || clientInfo.features.lease_revenue || clientInfo.features.rental_counts || clientInfo.features.rental_revenue;

    return (
        <div className="bg-white p-4 rounded-lg shadow-md mb-8">
            <RentalStats 
                rentalData={filteredRentals} 
                clientInfo={clientInfo} 
                referenceTime={referenceTime}
                leaseRevenue={leaseRevenue}
                isGlobal={true}
                activeFilters={activeFilters}
                t={t}
                onShowRentalDetails={onShowRentalDetails}
            />
        </div>
    );
}

export default GlobalRentalActivity;