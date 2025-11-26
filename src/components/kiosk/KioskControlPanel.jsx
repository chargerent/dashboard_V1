// src/components/kiosk/KioskControlPanel.jsx

import React, { useMemo } from 'react';

const ControlButton = ({ icon, label, subLabel, onClick, className = '', status, statusColor = 'green', disabled = false }) => (
    <button 
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        disabled={disabled}
        className={`relative flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors duration-200 ${className} disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed`}
    >
        {status !== undefined && (
            <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                status 
                    ? (statusColor === 'red' ? 'bg-red-500' : 'bg-green-500') 
                    : 'bg-gray-400'
            }`}></span>
        )}
        {icon}
        <span className="text-xs font-semibold">{label}</span>
        {subLabel && <span className="text-[9px] whitespace-nowrap text-gray-500 -mt-1">{subLabel}</span>}
    </button>
);

function KioskControlPanel({ kiosk, t, onCommand, serverUiVersion, serverFlowVersion, clientInfo, isOnline, disabled = false }) {
    const flowSubLabel = () => {
        const kioskV = kiosk.fversion ? kiosk.fversion.split(' ')[0] : null;
        const serverV = serverFlowVersion ? serverFlowVersion.split(' ')[0] : null;
        if (kioskV && serverV) return `${kioskV} → ${serverV}`;
        return kioskV || serverV || '';
    };

    const uiSubLabel = () => {
        const kioskV = kiosk.ui?.version || kiosk.uiVersion || null;
        const serverV = serverUiVersion || null;
        if (kioskV && serverV) return `${kioskV} → ${serverV}`;
        return kioskV || serverV || '';
    };

    const ejectCounts = useMemo(() => {
        const fullThreshold = kiosk.hardware?.power || 80;
        
        let totalChargers = 0;
        let fullChargers = 0;
        let emptyChargers = 0;
        let lockedChargers = 0;

        kiosk.modules.forEach(module => {
            module.slots.forEach(slot => {
                if (slot.sn && slot.sn !== 0) { // It has a charger
                    totalChargers++;
                    if (slot.batteryLevel >= fullThreshold && !slot.isLocked) fullChargers++;
                    if (typeof slot.batteryLevel === 'number' && slot.batteryLevel < fullThreshold && !slot.isLocked) {
                        emptyChargers++;
                    }
                    if (slot.isLocked) lockedChargers++;
                }
            });
        });
        return { total: totalChargers, full: fullChargers, empty: emptyChargers, locked: lockedChargers };
    }, [kiosk]);

    return (
        <div className="bg-white p-3 rounded-lg shadow-inner h-full">
            <div className="grid grid-cols-2 gap-2">
                {clientInfo.commands.reload && (
                    <ControlButton onClick={() => onCommand(kiosk.stationid, 'reload ui')} disabled={disabled} label={t('reload_ui')} className="bg-orange-100 hover:bg-orange-200 text-orange-800" icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>} />
                )}
                {clientInfo.commands.disable && (                    
                    <ControlButton 
                        onClick={() => onCommand(kiosk.stationid, !!kiosk.disabled ? 'enable' : 'disable')}
                        disabled={disabled} 
                        label={!!kiosk.disabled ? t('enable') : t('disable')}
                        status={!!kiosk.disabled} statusColor="red"
                        className="bg-red-100 hover:bg-red-200 text-red-800" 
                        icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>} />
                )}
                
                {clientInfo.commands.connectivity && (
                    <>
                        <ControlButton onClick={() => onCommand(kiosk.stationid, kiosk.ngrok ? 'ngrok disconnect' : 'ngrok connect')} disabled={disabled} status={kiosk.ngrok} label={t('ngrok')} className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800" icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>} />
                        <ControlButton onClick={() => onCommand(kiosk.stationid, kiosk.ssh ? 'ssh disconnect' : 'ssh connect')} disabled={disabled} status={kiosk.ssh} label={t('ssh')} className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800" icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" /></svg>} />
                        <ControlButton 
                            onClick={() => onCommand(kiosk.stationid, 'hotspot')}
                            disabled={false}
                            label={t('hotspot')} 
                            className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800" 
                            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.556A5.5 5.5 0 0112 15c1.453 0 2.8.54 3.889 1.556M4.889 13.333A9.5 9.5 0 0112 11c2.477 0 4.78.94 6.556 2.667m-13.112-6.222A13.5 13.5 0 0112 7c3.523 0 6.81.94 9.667 2.778" /></svg>} 
                        />
                    </>
                )}

                {clientInfo.features.rentals && (
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'rent')} disabled={disabled} label={t('rent')} className="col-span-2 bg-sky-100 hover:bg-sky-200 text-sky-800" />
                )}

                {clientInfo.commands.eject && (
                    <>
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'eject all')} disabled={disabled} label={`${t('eject_all')} (${ejectCounts.total})`} className="bg-green-100 hover:bg-green-200 text-green-800" />
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'eject full')} disabled={disabled} label={`${t('eject_full')} (${ejectCounts.full})`} className="bg-green-100 hover:bg-green-200 text-green-800" />
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'eject empty')} disabled={disabled} label={`${t('eject_empty')} (${ejectCounts.empty})`} className="bg-green-100 hover:bg-green-200 text-green-800" />
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'eject locked')} disabled={disabled} label={`${t('eject_locked')} (${ejectCounts.locked})`} className="bg-green-100 hover:bg-green-200 text-green-800" />
                    </>
                )}

                {clientInfo.commands.eject_multiple && (
                    <>
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'eject count', null, null, null, { slotid: 5 })} disabled={disabled} label={t('eject_5')} className="bg-green-100 hover:bg-green-200 text-green-800" />
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'eject count', null, null, null, { slotid: 10 })} disabled={disabled} label={t('eject_10')} className="bg-green-100 hover:bg-green-200 text-green-800" />
                    </>
                )}
                
                {clientInfo.commands.updates && (
                    <>
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'update flow', null, kiosk.provisionid)} disabled={disabled} label={t('update_flow')} subLabel={flowSubLabel()} className="bg-blue-100 hover:bg-blue-200 text-blue-800" />
                        <ControlButton onClick={() => onCommand(kiosk.stationid, 'update ui', null, kiosk.provisionid, serverUiVersion)} disabled={disabled} label={t('update_ui')} subLabel={uiSubLabel()} className="bg-blue-100 hover:bg-blue-200 text-blue-800" />
                    </>
                )}
            </div>
        </div>
    );
}

export default KioskControlPanel;