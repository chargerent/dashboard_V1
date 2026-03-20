// src/components/kiosk/KioskDetailPanel.jsx

import React, { useMemo, useCallback } from 'react';
import KioskControlPanel from './KioskControlPanel';
import { isKioskOnline } from '../../utils/helpers';

// --- Sub-component for the charger status code ---
const StatusIndicator = ({ status }) => {
    // Return a placeholder to maintain consistent height
    if (!status) return <span className="text-[10px] h-3">&nbsp;</span>;

    let colorClass = 'text-red-500';
    if (status === '0C') {
        colorClass = 'text-gray-500';
    } else if (status === '0F') {
        colorClass = 'text-green-600';
    }

    return (
        <span className={`text-[10px] font-mono font-bold ${colorClass}`}>{status || ''}</span>
    );
};

const moduleIdsMatch = (left, right) => {
    const leftId = String(left || '').trim();
    const rightId = String(right || '').trim();

    if (!leftId || !rightId) return false;
    if (leftId === rightId) return true;

    return leftId.split('m').pop() === rightId.split('m').pop();
};

// --- Main Detail Panel Component ---
function KioskDetailPanel({ kiosk, isVisible, onSlotClick, onLockSlot, pendingSlots, ejectingSlots, failedEjectSlots, lockingSlots, t, onCommand, serverUiVersion, serverFlowVersion, clientInfo, mockNow }) {
    const isOnline = isKioskOnline(kiosk, mockNow);
    const hasAnyCommands = Object.values(clientInfo.commands).some(v => v === true) || clientInfo.features.rentals;
    
    const createSlotSet = (slots) => useMemo(() => new Set(slots.map(s => `${s.stationid}-${s.moduleid}-${s.slotid}`)), [slots]);
    const ejectingSet = createSlotSet(ejectingSlots);
    const pendingSet = createSlotSet(pendingSlots);
    const failedEjectList = Array.isArray(failedEjectSlots) ? failedEjectSlots : [];

    // A simple Set is all we need to know which slots are "in-progress"
    const lockingSet = createSlotSet(lockingSlots);

    const hasFailedEject = useCallback((module, slot) => {
        return failedEjectList.some((failedSlot) =>
            failedSlot.stationid === kiosk.stationid &&
            Number(failedSlot.slotid) === Number(slot.position) &&
            moduleIdsMatch(failedSlot.moduleid, module.id)
        );
    }, [failedEjectList, kiosk.stationid]);

    const getSlotStyle = useCallback((slot, module) => {
        const slotId = `${kiosk.stationid}-${module.id}-${slot.position}`;

        if (lockingSet.has(slotId)) {
            if (slot.isLocked) { // If the slot is currently locked, glow red.
                return { className: 'border-red-500 bg-red-100 text-red-800 slot-lock-glow', glow: false };
            } else { // If the slot is currently unlocked, glow blue.
                return { className: 'border-blue-400 bg-blue-100 text-blue-800 slot-lock-glow', glow: false };
            }
        }
        if (hasFailedEject(module, slot)) {
            return { className: 'border-red-500 bg-red-100 text-red-800 animate-pulse', glow: false };
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
        // A slot is empty if its status is '0C' (Open Circuit) and it's not in an error state.
        if (!slot || (slot.sstat === '0C' && !slot.isSstatError)) {
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
    }, [kiosk.stationid, kiosk.hardware, ejectingSet, pendingSet, lockingSet, hasFailedEject]);

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
        const hasCharger = (slot.sstat && slot.sstat !== '0C') || slot.isSstatError;

        return (
            <div className={`relative flex items-stretch p-0.5 rounded-md border transition-all duration-300 text-left ${style.className} ${style.glow ? 'slot-glow' : ''}`}>
                {/* Eject Button */}
                <button
                    onClick={() => onSlotClick(kiosk.stationid, module.id, slot.position)}
                    disabled={!canEject || !isOnline || !hasCharger}
                    className="flex-grow flex items-center justify-start p-0.5 rounded-l-md disabled:cursor-not-allowed overflow-hidden"
                >
                    <div className="flex flex-col items-center w-8 mr-2">
                        <span className="text-xs font-mono text-gray-500">{String(slot.position).padStart(2, '0')}</span>
                        <StatusIndicator status={slot.sstat} />
                    </div>
                    <div className="flex flex-col items-start min-w-0">
                        <span className="text-xs font-mono font-bold">{hasCharger ? `${slot.batteryLevel}%` : t('empty')}</span>
                        <span className="text-[10px] text-gray-400 font-mono leading-tight truncate">{hasCharger ? slot.sn : '\u00A0'}</span>
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
        <div className={`${module.output === false ? 'bg-red-100' : 'bg-white'} p-2 rounded-lg shadow-inner`}>
            <div className="flex flex-col gap-1">
                {module.slots.slice().sort((a, b) => reverseOrder ? b.position - a.position : a.position - b.position).map(slot => {
                    const style = getSlotStyle(slot, module);
                    return <SlotButton key={slot.position} slot={slot} module={module} style={style} />
                })}
            </div>
            {(clientInfo.commands.eject || clientInfo.commands.lock) && <ModuleControls module={module} />}
        </div>
    );

    const PaymentTerminal = () => (
        <div className="bg-gray-800 text-white p-4 h-auto flex flex-col justify-center rounded-lg shadow-lg">
            <div className="text-left w-full px-2">
                <p className="text-xs text-gray-400">UI Mode</p>
                <p className="text-sm text-white font-semibold truncate">{kiosk.ui?.mode || '---'}</p>
                <p className="text-xs text-gray-400 mt-2">UI State</p>
                <p className="text-sm text-white font-semibold truncate">{kiosk.uistate || '---'}</p>
                <p className="text-xs text-gray-400 mt-2">SN</p>
                <p className="text-sm text-white font-semibold truncate">{kiosk.hardware?.sn || '---'}</p>
            </div>
        </div>
    );

    const renderCT3 = () => {
        return (
            <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
                <div className="bg-white p-4 rounded-lg shadow-inner flex flex-col items-center gap-3 w-full max-w-md">
                    <div className="w-16 h-16 bg-gray-200 flex items-center justify-center rounded-md">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M8 21H4a1 1 0 0 1-1-1V16a1 1 0 0 0-2 0v4a3 3 0 0 0 3 3H8a1 1 0 0 0 0-2Zm14-6a1 1 0 0 0-1 1v4a1 1 0 0 1-1 1H16a1 1 0 0 0 0 2h4a3 3 0 0 0 3-3V16a1 1 0 0 0-2 0ZM20 1H16a1 1 0 0 0 0 2h4a1 1 0 0 1 1 1V8a1 1 0 0 0 2 0V4a3 3 0 0 0-3-3ZM2 9a1 1 0 0 0 1-1V4a1 1 0 0 1 1-1H8a1 1 0 0 0 0-2H4a3 3 0 0 0-3 3V8a1 1 0 0 0 1 1Zm8-4H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1ZM9 9H7V7H9Zm5 2h4a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H14a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Zm1-4h2V9H15Zm-5 6H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V14a1 1 0 0 0-1-1Zm-1 4H7V15H9Zm5-1a1 1 0 0 0 1-1 1 1 0 0 0 0-2H14a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1Zm4-3a1 1 0 0 0-1 1v3a1 1 0 0 0 0 2h1a1 1 0 0 0 1-1V14a1 1 0 0 0-1-1Zm-4 4a1 1 0 1 0 1 1A1 1 0 0 0 14 17Z" /></svg>
                    </div>
                    {kiosk.modules[0] && <Module module={kiosk.modules[0]} />}
                </div>
            </div>
        );
    };

    const slotOrderInCompactGroup = [2, 0, 3, 1];

    const buildCompactSlotMap = (modules = []) => {
        const rawEntries = [];

        modules.forEach((module, moduleIndex) => {
            const slots = Array.isArray(module?.slots)
                ? module.slots.slice().sort((left, right) => Number(left?.position || 0) - Number(right?.position || 0))
                : [];

            slots.forEach((slot, slotIndex) => {
                rawEntries.push({ module, slot, moduleIndex, slotIndex });
            });
        });

        const positionCounts = new Map();
        rawEntries.forEach(({ slot }) => {
            const position = Number(slot?.position || 0);
            if (position > 0) {
                positionCounts.set(position, (positionCounts.get(position) || 0) + 1);
            }
        });

        const hasDuplicatePositions = Array.from(positionCounts.values()).some((count) => count > 1);
        const slotsByPosition = new Map();

        rawEntries.forEach(({ module, slot, moduleIndex, slotIndex }) => {
            const rawPosition = Number(slot?.position || 0);
            const absolutePosition = hasDuplicatePositions ? (moduleIndex * 4) + slotIndex + 1 : rawPosition;
            if (absolutePosition > 0 && !slotsByPosition.has(absolutePosition)) {
                slotsByPosition.set(absolutePosition, {
                    slot,
                    module,
                    displayPosition: absolutePosition
                });
            }
        });

        const positions = Array.from(slotsByPosition.keys());
        return {
            slotsByPosition,
            maxPosition: positions.length > 0 ? Math.max(...positions) : 0
        };
    };

    const CompactGridSlot = ({ entry }) => {
        if (!entry?.slot || !entry?.module) {
            return <div className="min-h-[40px] rounded-md border border-gray-300 bg-gray-100" />;
        }

        const { slot, module, displayPosition } = entry;
        const style = getSlotStyle(slot, module);
        const hasCharger = (slot.sstat && slot.sstat !== '0C') || slot.isSstatError;
        const canEject = clientInfo.commands.eject;
        const canLock = clientInfo.commands.lock;

        return (
            <div className={`relative min-h-[40px] rounded-md border p-0.5 text-left transition-all duration-300 ${style.className} ${style.glow ? 'slot-glow' : ''}`}>
                <button
                    onClick={() => hasCharger && canEject && onSlotClick(kiosk.stationid, module.id, slot.position)}
                    disabled={!canEject || !isOnline || !hasCharger}
                    className="flex h-full w-full min-w-0 items-start gap-1.5 rounded-md px-2 py-0.5 pr-7 disabled:cursor-not-allowed"
                    title={hasCharger ? `SN ${slot.sn}` : `Slot ${displayPosition || slot.position}`}
                >
                    <div className="flex w-7 flex-col items-center justify-center pt-0.5">
                        <span className="text-[10px] font-mono leading-none text-gray-500">
                            {String(displayPosition || slot.position).padStart(2, '0')}
                        </span>
                        <StatusIndicator status={slot.sstat} />
                    </div>
                    <div className="flex min-w-0 flex-col pt-0.5">
                        <span className="text-[13px] font-bold leading-none">
                            {hasCharger ? `${slot.batteryLevel}%` : '—'}
                        </span>
                        <span className="truncate font-mono text-[9px] leading-tight text-gray-500">
                            {hasCharger ? slot.sn : '\u00A0'}
                        </span>
                    </div>
                </button>

                {canLock && (
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            onLockSlot(kiosk.stationid, module.id, slot.position, slot.isLocked);
                        }}
                        disabled={!isOnline}
                        className="absolute bottom-1 right-1 flex h-[18px] w-[18px] items-center justify-center rounded-md bg-white/75 shadow-sm hover:bg-white disabled:cursor-not-allowed"
                        title={slot.isLocked ? t('unlock_slot') : t('lock_slot')}
                    >
                        {slot.isLocked ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-red-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2V7a3 3 0 10-6 0v2h6z" clipRule="evenodd" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                            </svg>
                        )}
                    </button>
                )}
            </div>
        );
    };

    const CompactGroupCard = ({ slotsByPosition, groupIndex }) => (
        <div className="bg-white p-1 rounded-lg shadow-inner">
            <div className="grid grid-cols-2 gap-1">
                {slotOrderInCompactGroup.map((slotOrder, index) => {
                    const position = groupIndex * 4 + slotOrder + 1;
                    return <CompactGridSlot key={`${groupIndex}-${index}`} entry={slotsByPosition.get(position)} />;
                })}
            </div>
        </div>
    );

    const renderCompactTower = (hardwareType, minimumGroups) => {
        const { slotsByPosition, maxPosition } = buildCompactSlotMap(kiosk.modules);
        const groupCount = Math.max(minimumGroups, Math.ceil(maxPosition / 4) || 0);
        const qrFallback = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
                <rect width="220" height="220" rx="18" fill="#f3f4f6"/>
                <rect x="26" y="26" width="168" height="168" rx="14" fill="#ffffff" stroke="#d1d5db" stroke-width="4"/>
                <text x="110" y="106" text-anchor="middle" font-family="monospace" font-size="16" fill="#6b7280">QR</text>
                <text x="110" y="132" text-anchor="middle" font-family="monospace" font-size="14" fill="#4b5563">${kiosk.stationid || '---'}</text>
            </svg>`
        )}`;

        return (
            <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
                <div className="w-full max-w-md flex flex-col gap-3">
                    <div className="bg-white p-4 rounded-lg shadow-inner flex flex-col items-center gap-3">
                        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
                            <img
                                src={qrFallback}
                                alt={`${kiosk.stationid} QR`}
                                className="h-32 w-32 rounded-md object-cover"
                            />
                        </div>
                        <div className="text-center leading-tight">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">{hardwareType}</p>
                            <p className="mt-1 font-mono text-sm text-gray-600">{kiosk.stationid || '---'}</p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        {Array.from({ length: groupCount }, (_, groupIndex) => (
                            <CompactGroupCard key={groupIndex} slotsByPosition={slotsByPosition} groupIndex={groupIndex} />
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderCK48 = () => {
        // CK48 stores all 48 slots flat in modules[0] with absolute positions 1–48.
        // Visual layout: 12 logical modules arranged in 2 columns (right: 0–5, left: 6–11).
        // Within each logical module the 4 slots are displayed in a 2×2 grid using
        // the order [2, 0, 3, 1] applied as: position = moduleIndex * 4 + slotOrder + 1
        const { slotsByPosition } = buildCompactSlotMap(kiosk.modules);
        const leftColumnIndices = [6, 7, 8, 9, 10, 11];
        const rightColumnIndices = [0, 1, 2, 3, 4, 5];

        return (
            <div className="p-1.5 flex flex-col items-center gap-2.5">
                <div className="w-full space-y-2.5">
                    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-lg bg-black shadow-lg">
                        <div className="w-full" style={{ aspectRatio: '228 / 405' }}>
                            <img
                                src={`https://chargerentstations.com/images/${kiosk.stationid}.jpg`}
                                alt={`${kiosk.stationid} screen`}
                                className="h-full w-full object-cover"
                                onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/456x810/000000/FFFFFF?text=No+Image'; }}
                            />
                        </div>
                    </div>

                    <div className="grid w-full gap-3 xl:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            {leftColumnIndices.map((groupIndex) => (
                                <CompactGroupCard key={groupIndex} slotsByPosition={slotsByPosition} groupIndex={groupIndex} />
                            ))}
                        </div>
                        <div className="flex flex-col gap-2">
                            {rightColumnIndices.map((groupIndex) => (
                                <CompactGroupCard key={groupIndex} slotsByPosition={slotsByPosition} groupIndex={groupIndex} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderCT10 = () => {
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

    const renderCK50 = () => {
        return (
            <div className="p-2 flex flex-col items-center gap-4 max-h-[60vh] overflow-y-auto pb-4">
                <div className="bg-gray-900 rounded-lg shadow-lg text-white flex flex-col justify-center border-4 border-gray-700 relative p-4 w-full" style={{ aspectRatio: '9/16' }}>
                    <div className="text-left w-full space-y-2">
                        <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider">UI Mode</p>
                            <p className="text-xs text-white font-semibold truncate">{kiosk.ui?.mode || '---'}</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider">UI State</p>
                            <p className="text-xs text-white font-semibold truncate">{kiosk.uistate || '---'}</p>
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider">SN</p>
                            <p className="text-xs text-white font-semibold truncate">{kiosk.hardware?.sn || '---'}</p>
                        </div>
                    </div>
                </div>
                <div className="w-full grid grid-cols-2 gap-2">
                    {kiosk.modules[1] && <Module module={kiosk.modules[1]} reverseOrder={true} />}
                    {kiosk.modules[0] && <Module module={kiosk.modules[0]} reverseOrder={true} />}
                </div>
                <div className="w-full grid grid-cols-3 gap-2">
                    {kiosk.modules[2] && <Module module={kiosk.modules[2]} reverseOrder={true} />}
                    {kiosk.modules[3] && <Module module={kiosk.modules[3]} reverseOrder={true} />}
                    {kiosk.modules[4] && <Module module={kiosk.modules[4]} reverseOrder={true} />}
                </div>
            </div>
        );
    };

    const PlaceholderView = ({ type }) => (
        <div className="p-8 text-center text-gray-500">
            <p>Detailed slot view for <strong>{type}</strong> kiosks is not yet implemented.</p>
        </div>
    );

    const renderContent = () => {
        const hardwareType = kiosk.hardware?.type;
        switch (hardwareType) {
            case 'CT3':
                return renderCT3();
            case 'CT4':
                return renderCompactTower('CT4', 1);
            case 'CT8':
                return renderCompactTower('CT8', 2);
            case 'CT12':
                return renderCompactTower('CT12', 3);
            case 'CT10':
                return renderCT10();
            case 'CK20':
                return renderCK20();
            case 'CK30':
                return renderCK30();
            case 'CK48':
                return renderCK48();
            case 'CK50':
                return renderCK50();
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
            <div className="flex flex-col gap-2 p-2 bg-gray-100 rounded-b-lg border-t border-gray-200">
                {hasAnyCommands && (
                    <div className="w-full">
                        <KioskControlPanel kiosk={kiosk} t={t} onCommand={onCommand} serverUiVersion={serverUiVersion} serverFlowVersion={serverFlowVersion} clientInfo={clientInfo} isOnline={isOnline} disabled={!isOnline} />
                    </div>
                )}
                <div className="w-full">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

export default KioskDetailPanel;
