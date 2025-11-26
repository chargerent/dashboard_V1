// src/components/kiosk/KioskDetailPanel.jsx

import React, { useMemo, useRef, useCallback } from 'react';
import KioskControlPanel from './KioskControlPanel';
import { isKioskOnline } from '../../utils/helpers';

// --- Sub-component for the charger status code ---
const StatusIndicator = ({ status }) => {
    // Return a placeholder to maintain consistent height
    if (!status) return <span className="text-xs h-4">&nbsp;</span>;

    let colorClass = 'text-red-500';
    if (status === '0C') {
        colorClass = 'text-gray-500';
    } else if (status === '0F') {
        colorClass = 'text-green-600';
    }

    return (
        <span className={`text-xs font-mono font-bold ${colorClass}`}>{status || ''}</span>
    );
};

// --- Main Detail Panel Component ---
function KioskDetailPanel({ kiosk, isVisible, onSlotClick, onLockSlot, pendingSlots, ejectingSlots, lockingSlots, t, onCommand, serverUiVersion, serverFlowVersion, clientInfo, mockNow }) {
    const isOnline = isKioskOnline(kiosk, mockNow);
    const hasAnyCommands = Object.values(clientInfo.commands).some(v => v === true) || clientInfo.features.rentals;
    
    const createSlotSet = (slots) => useMemo(() => new Set(slots.map(s => `${s.stationid}-${s.moduleid}-${s.slotid}`)), [slots]);
    const ejectingSet = createSlotSet(ejectingSlots);
    const pendingSet = createSlotSet(pendingSlots);

    // A simple Set is all we need to know which slots are "in-progress"
    const lockingSet = createSlotSet(lockingSlots);

    const getSlotStyle = useCallback((slot, module) => {
        const slotId = `${kiosk.stationid}-${module.id}-${slot.position}`;

        if (lockingSet.has(slotId)) {
            if (slot.isLocked) { // If the slot is currently locked, glow red.
                return { className: 'border-red-500 bg-red-100 text-red-800 slot-lock-glow', glow: false };
            } else { // If the slot is currently unlocked, glow blue.
                return { className: 'border-blue-400 bg-blue-100 text-blue-800 slot-lock-glow', glow: false };
            }
        }
        if (ejectingSet.has(slotId) && !slot.isLocked) {
            return { className: 'border-green-500 bg-green-100 text-green-800 slot-glow', glow: false };
        }
        if (pendingSet.has(slotId)) {
            return { className: 'border-yellow-400 bg-yellow-100 text-yellow-800 animate-pulse', glow: false };
        }
        if (slot.isLocked) {
            return { className: 'border-red-500 bg-red-100 text-red-800', glow: false };
        }
        if (!slot || !slot.sn) {
            return { className: 'border-gray-300 bg-gray-100 text-gray-400', glow: false };
        }

        const isCharging = slot.chargingCurrent > 0;
        let className = '';
        const fullThreshold = kiosk.hardware?.power || 80;

        if (slot.batteryLevel >= fullThreshold) {
            className = 'border-blue-500 bg-blue-100 text-blue-800';
        } else {
            className = 'border-orange-400 bg-orange-100 text-orange-800';
        }

        return { className, glow: isCharging };
    }, [kiosk.stationid, kiosk.hardware, ejectingSet, pendingSet, lockingSet, t]);

    const ModuleControls = ({ module }) => (
        <div className="flex items-center mt-1 pt-1 border-t border-gray-200">
            <button 
                title={t('eject_all_from_module')} 
                onClick={(e) => { e.stopPropagation(); onCommand(kiosk.stationid, 'eject module', module.id); }} 
                className="p-1 w-full text-gray-500 hover:bg-gray-100 rounded flex justify-center items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                </svg>
            </button>
        </div>
    );
    
    const SlotButton = React.memo(({ slot, module, style }) => {
        const canInteract = clientInfo.commands.eject || clientInfo.commands.lock;
        const canEject = clientInfo.commands.eject;
        const canLock = clientInfo.commands.lock;

        return (
            <div className={`relative flex items-stretch p-0.5 rounded-md border transition-all duration-300 text-left ${style.className} ${style.glow ? 'slot-glow' : ''}`}>
                {/* Eject Button */}
                <button
                    onClick={() => onSlotClick(kiosk.stationid, module.id, slot.position)}
                    disabled={!canEject || !isOnline || !slot.sn}
                    className="flex-grow flex items-center justify-start p-0.5 rounded-l-md disabled:cursor-not-allowed overflow-hidden"
                >
                    <div className="flex flex-col items-center w-8 mr-2">
                        <span className="text-sm font-mono text-gray-500">{String(slot.position).padStart(2, '0')}</span>
                        <StatusIndicator status={slot.sstat} />
                    </div>
                    <div className="flex flex-col items-start min-w-0">
                        <span className="text-sm font-mono font-bold">{(slot.sn && slot.sn !== '0000000000') || slot.isSstatError ? `${slot.batteryLevel}%` : t('empty')}</span>
                        <span className="text-[10px] text-gray-400 font-mono leading-tight truncate">{((slot.sn && slot.sn !== '0000000000') || slot.isSstatError) ? slot.sn : '\u00A0'}</span>
                    </div>
                </button>

                {/* Lock/Unlock Button */}
                {canLock && (
                    <div className="flex flex-shrink-0 items-center border-l border-gray-300/50">
                        <button
                            onClick={() => onLockSlot(kiosk.stationid, module.id, slot.position, slot.isLocked)}
                            disabled={!isOnline}
                            className="flex items-center justify-center w-8 h-8 rounded-r-md hover:bg-gray-200/50 disabled:cursor-not-allowed"
                            title={slot.isLocked ? t('unlock_slot') : t('lock_slot')}
                        >
                            {slot.isLocked ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                </svg>
                            )}
                        </button>
                    </div>
                )}

                {slot.isFullNotCharging && (
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-red-500 rounded-r-md"></div>
                )}
                {slot.isSstatError && (
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-purple-500 rounded-r-md"></div>
                )}
            </div>
        );
    });

    const Module = ({ module, reverseOrder = false }) => (
        <div className="bg-white p-2 rounded-lg shadow-inner">
            <div className="flex flex-col gap-1.5">
                {module.slots.slice().sort((a, b) => reverseOrder ? b.position - a.position : a.position - b.position).map(slot => {
                    const style = getSlotStyle(slot, module);
                    return <SlotButton key={slot.position} slot={slot} module={module} style={style} />
                })}
            </div>
            {(clientInfo.commands.eject || clientInfo.commands.lock) && <ModuleControls module={module} />}
        </div>
    );

    const PaymentTerminal = () => (
        <div className="bg-gray-800 text-white p-4 h-24 flex flex-col justify-center rounded-lg shadow-lg">
            <div className="text-left w-full px-2">
                <p className="text-xs text-gray-400">UI Mode</p>
                <p className="text-sm text-white font-semibold truncate">{kiosk.ui?.mode || '---'}</p>
                <p className="text-xs text-gray-400 mt-2">UI State</p>
                <p className="text-sm text-white font-semibold truncate">{kiosk.uistate || '---'}</p>
            </div>
        </div>
    );

    const renderCT10 = () => {
        const hardwareType = kiosk.hardware?.type;
        return (
            <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
                <div className="w-full flex flex-col gap-3">
                    {kiosk.modules[0] && <Module module={kiosk.modules[0]} />}
                    <PaymentTerminal />
                </div>
            </div>
        );
    };

    const renderCK20 = () => {
        const hardwareType = kiosk.hardware?.type;
        return (
        <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
            <div className="w-full flex flex-col gap-3">
                <PaymentTerminal />
                {kiosk.modules[0] && <Module module={kiosk.modules[0]} reverseOrder={true} />}
                {kiosk.modules[1] && <Module module={kiosk.modules[1]} reverseOrder={true} />}
            </div>
        </div>
    )};
    
    const renderCK30 = () => {
        const hardwareType = kiosk.hardware?.type;

        return (
        <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
            <div className="w-full flex flex-col gap-3">
                {kiosk.modules[0] && <Module module={kiosk.modules[0]} reverseOrder={true} />}
                <PaymentTerminal />
                {kiosk.modules[1] && <Module module={kiosk.modules[1]} reverseOrder={true} />}
                {kiosk.modules[2] && <Module module={kiosk.modules[2]} reverseOrder={true} />}
            </div>
        </div>
    )};

    const PlaceholderView = ({ type }) => (
        <div className="p-8 text-center text-gray-500">
            <p>Detailed slot view for <strong>{type}</strong> kiosks is not yet implemented.</p>
        </div>
    );

    const renderContent = () => {
        const hardwareType = kiosk.hardware?.type;
        switch (hardwareType) {
            case 'CT10':
                return renderCT10();
            case 'CK20':
                return renderCK20();
            case 'CK30':
                return renderCK30();
            case 'CK50':
                return <PlaceholderView type={hardwareType} />;
            default:
                return (
                    <p className="p-8 text-center text-gray-500">
                        No detailed view available for this kiosk type ({hardwareType || 'Unknown'}).
                    </p>
                );
        }
    };
    
    return (
            <div className={`detail-panel-enter ${isVisible ? 'detail-panel-enter-active' : ''}`}>
            <div className="flex flex-col md:flex-row gap-2 p-2 bg-gray-100 rounded-b-lg border-t border-gray-200">
                {hasAnyCommands && (
                    <div className="flex-shrink-0 w-full md:w-1/2">
                        <KioskControlPanel kiosk={kiosk} t={t} onCommand={onCommand} serverUiVersion={serverUiVersion} serverFlowVersion={serverFlowVersion} clientInfo={clientInfo} isOnline={isOnline} disabled={!isOnline} />
                    </div>
                )}
                <div className="w-full md:w-1/2">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

export default KioskDetailPanel;
