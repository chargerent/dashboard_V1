// src/components/Dashboard/GlobalRentalActivity.jsx

import { memo } from 'react';
import RentalStats from './RentalStats';

function GlobalRentalActivity({ rentalData, clientInfo, referenceTime, activeFilters, t, onShowRentalDetails, leaseRevenue }) {
    return (
        <div className="bg-white p-4 rounded-lg shadow-md mb-8">
            <RentalStats 
                rentalData={rentalData}
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

export default memo(GlobalRentalActivity);
