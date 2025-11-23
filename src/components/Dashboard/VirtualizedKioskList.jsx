import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import LocationSummary from './LocationSummary';
import KioskPanel from '../kiosk/kioskPanel';
import KioskEditPanel from '../kiosk/KioskEditPanel';
import KioskDetailPanel from '../kiosk/KioskDetailPanel';
import RentalDetailView from './RentalDetailView';

export default function VirtualizedKioskList({
    filteredLocations,
    kioskToEdit,
    rentalDetailView,
    expandedKioskId,
    editingKioskId,
    latestTimestamp,
    enrichedRentalData,
    clientInfo,
    t,
    handleGeneralCommand,
    handleShowRentalDetails,
    handleToggleDetails,
    handleToggleEditMode,
    handleKioskSave,
    pendingSlots,
    ejectingSlots,
    lockingSlots
}) {
    const rowVirtualizer = useVirtualizer({
        count: filteredLocations.length,
        getScrollElement: () => window,
        estimateSize: (index) => {
            const [, kiosks] = filteredLocations[index];
            const isExpanded = kiosks.some(k => expandedKioskId === k.stationid || editingKioskId === k.stationid);
            // A more dynamic estimate based on expanded state
            return isExpanded ? 800 : 400;
        },
        overscan: 5,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();

    return (
        <div className="w-full">
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map(virtualItem => {
                    const [location, kiosks] = filteredLocations[virtualItem.index];

                    return (
                        <div key={location} data-index={virtualItem.index} ref={virtualItem.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }} className="mb-12 px-2">
                                <LocationSummary location={location} kiosks={kiosks} clientInfo={clientInfo} rentalData={enrichedRentalData} referenceTime={latestTimestamp} t={t} onShowRentalDetails={handleShowRentalDetails} />
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {kiosks.map(kiosk => (
                                        <div key={kiosk.stationid}>
                                            <KioskPanel kiosk={kiosk} isExpanded={expandedKioskId === kiosk.stationid || editingKioskId === kiosk.stationid} onToggle={handleToggleDetails} onToggleEdit={handleToggleEditMode} mockNow={latestTimestamp} rentalData={enrichedRentalData} clientInfo={clientInfo} t={t} onCommand={handleGeneralCommand} onShowRentalDetails={handleShowRentalDetails} />
                                            {editingKioskId === kiosk.stationid && kioskToEdit ? (
                                                <KioskEditPanel kiosk={kioskToEdit} onSave={handleKioskSave} clientInfo={clientInfo} isVisible={editingKioskId === kiosk.stationid} t={t} onCommand={handleGeneralCommand} />
                                            ) : (
                                                clientInfo.features.details && <KioskDetailPanel kiosk={kiosk} isVisible={expandedKioskId === kiosk.stationid} onSlotClick={() => {}} onLockSlot={() => {}} pendingSlots={pendingSlots} ejectingSlots={ejectingSlots} lockingSlots={lockingSlots} t={t} onCommand={handleGeneralCommand} clientInfo={clientInfo} mockNow={latestTimestamp} />
                                            )}
                                            {rentalDetailView?.kioskId === kiosk.stationid && (
                                                <RentalDetailView kiosk={kiosk} period={rentalDetailView.period} rentalData={enrichedRentalData} onClose={() => setRentalDetailView(null)} onCommand={handleGeneralCommand} t={t} />
                                            )}
                                        </div>
                                    ))}
                                </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}