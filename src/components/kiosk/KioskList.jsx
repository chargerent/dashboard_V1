import KioskPanel from './kioskPanel';

const KioskList = ({ kiosks, expandedKioskId, onKioskToggle, onToggleEdit, mockNow, rentalData, clientInfo, t, onCommand, onShowRentalDetails }) => {
    return (
        <div className="space-y-4">
            {kiosks.map(kiosk => (
                <div key={kiosk.stationid}>
                    <KioskPanel
                        kiosk={kiosk}
                        isExpanded={expandedKioskId === kiosk.stationid}
                        onToggle={onKioskToggle}
                        onToggleEdit={onToggleEdit}
                        mockNow={mockNow}
                        rentalData={rentalData}
                        clientInfo={clientInfo}
                        t={t}
                        onCommand={onCommand}
                        onShowRentalDetails={onShowRentalDetails}
                    />
                </div>
            ))}
        </div>
    );
};

export default KioskList;