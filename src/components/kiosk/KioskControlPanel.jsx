// src/components/kiosk/KioskControlPanel.jsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/outline';
import { getKioskPowerThreshold } from '../../utils/helpers';
import { logKioskInteraction } from '../../utils/kioskInteractionDebug';

const ControlButton = ({ icon, label, subLabel, onClick, className = '', status, statusColor = 'green', disabled = false, debugAction = '', debugContext = {} }) => (
    <button 
        type="button"
        data-kiosk-action={debugAction || label}
        data-kiosk-stationid={debugContext.stationid || ''}
        data-kiosk-disabled-reason={disabled ? 'disabled-prop' : ''}
        onClick={(e) => {
            e.stopPropagation();
            logKioskInteraction('control-button-click-handler', {
                label,
                disabled,
                debugAction: debugAction || label,
                debugContext,
            }, e);
            onClick();
        }}
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
        {subLabel && <span className="text-[9px] text-center leading-tight text-gray-500 -mt-1">{subLabel}</span>}
    </button>
);

const V2_TYPES = ['CT3', 'CT4', 'CT8', 'CT12', 'CK48'];
const DEFAULT_AUDIO_VOLUME = 50;

const clampVolume = (value, fallback = DEFAULT_AUDIO_VOLUME) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(100, Math.max(0, Math.round(parsed)));
};

const getKioskAudioVolume = (kiosk) => {
    if (String(kiosk?.hardware?.audio || '').toLowerCase() === 'off') {
        return 0;
    }

    const configuredVolume = Number(kiosk?.hardware?.volume);
    if (Number.isFinite(configuredVolume)) {
        return clampVolume(configuredVolume);
    }

    return DEFAULT_AUDIO_VOLUME;
};

const getDisplayVersion = (version) => (
    typeof version === 'string' && version.trim()
        ? version.trim().split(' ')[0]
        : null
);

const V2AudioControl = ({ kiosk, t, onCommand, disabled }) => {
    const initialVolume = getKioskAudioVolume(kiosk);
    const [volume, setVolume] = useState(initialVolume);
    const lastAudibleVolumeRef = useRef(initialVolume > 0 ? initialVolume : DEFAULT_AUDIO_VOLUME);

    useEffect(() => {
        const nextVolume = getKioskAudioVolume(kiosk);
        setVolume(nextVolume);
        if (nextVolume > 0) {
            lastAudibleVolumeRef.current = nextVolume;
        }
    }, [kiosk?.hardware?.audio, kiosk?.hardware?.volume, kiosk?.stationid]);

    const requestVolume = (nextVolume) => {
        const normalizedVolume = clampVolume(nextVolume);

        if (disabled) {
            return;
        }

        onCommand(kiosk.stationid, 'set volume', null, null, null, {
            volume: normalizedVolume,
            muted: normalizedVolume === 0,
        });
    };

    const handleSliderChange = (event) => {
        setVolume(clampVolume(event.target.value));
    };

    const muted = volume === 0;
    const toggleLabel = muted ? t('unmute_audio') : t('mute_audio');
    const nextMuteVolume = muted ? lastAudibleVolumeRef.current : 0;

    return (
        <div className="col-span-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sky-900">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        requestVolume(nextMuteVolume);
                    }}
                    disabled={disabled}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-sky-700 shadow-sm transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:text-gray-300"
                    title={toggleLabel}
                    aria-label={toggleLabel}
                >
                    {muted ? (
                        <SpeakerXMarkIcon className="h-5 w-5" />
                    ) : (
                        <SpeakerWaveIcon className="h-5 w-5" />
                    )}
                </button>
                <label className="min-w-0 flex-1">
                    <span className="mb-1 flex items-center justify-between text-[11px] font-semibold">
                        <span>{t('audio_volume')}</span>
                        <span className="font-mono">{volume}%</span>
                    </span>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={volume}
                        disabled={disabled}
                        onChange={handleSliderChange}
                        className="h-2 w-full cursor-pointer accent-sky-600 disabled:cursor-not-allowed"
                        aria-label={t('audio_volume')}
                    />
                </label>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        requestVolume(volume);
                    }}
                    disabled={disabled}
                    className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-md bg-sky-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                >
                    <CheckIcon className="h-3.5 w-3.5" />
                    {t('set_volume')}
                </button>
            </div>
        </div>
    );
};

function KioskControlPanel({ kiosk, t, onCommand, serverUiVersion, serverFlowVersion, clientInfo, _isOnline, disabled = false }) {
    const isV2 = V2_TYPES.includes(kiosk.hardware?.type);
    const canControlAudio = isV2 && clientInfo.commands.audio;
    const debugContext = { stationid: kiosk.stationid, source: 'KioskControlPanel' };
    const flowSubLabel = () => {
        const kioskV = getDisplayVersion(kiosk.fversion);
        const serverV = getDisplayVersion(serverFlowVersion);
        if (kioskV && serverV) return `${kioskV} → ${serverV}`;
        return kioskV || serverV || '';
    };

    const uiSubLabel = () => {
        const kioskV = getDisplayVersion(kiosk.ui?.version || kiosk.uiVersion);
        const serverV = getDisplayVersion(serverUiVersion);
        const serverFlowV = getDisplayVersion(serverFlowVersion);
        const uiVersionText = kioskV && serverV ? `${kioskV} → ${serverV}` : kioskV || serverV || '';

        if (!isV2 && serverFlowV) {
            return uiVersionText ? `${uiVersionText} | Flow ${serverFlowV}` : `Flow ${serverFlowV}`;
        }

        return uiVersionText;
    };

    const ejectCounts = useMemo(() => {
        const fullThreshold = getKioskPowerThreshold(kiosk);
        
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
        <div
            className="bg-white p-3 rounded-lg shadow-inner h-full"
            data-kiosk-control-panel="true"
            data-kiosk-stationid={kiosk.stationid}
        >
            <div className="grid grid-cols-2 gap-2">
                {clientInfo.commands.reload && (
                    <ControlButton debugAction="reload ui" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'reload ui')} disabled={disabled} label={t('reload_ui')} className="bg-orange-100 hover:bg-orange-200 text-orange-800" icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>} />
                )}
                {clientInfo.commands.disable && (                    
                    <ControlButton 
                        onClick={() => onCommand(kiosk.stationid, kiosk.disabled ? 'enable' : 'disable')}
                        debugAction={kiosk.disabled ? 'enable' : 'disable'}
                        debugContext={debugContext}
                        disabled={disabled} 
                        label={kiosk.disabled ? t('enable') : t('disable')}
                        status={kiosk.disabled} statusColor="red"
                        className="bg-red-100 hover:bg-red-200 text-red-800" 
                        icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>} />
                )}
                
                {clientInfo.commands.connectivity && !isV2 && (
                    <>
                        <ControlButton debugAction={kiosk.ngrok ? 'ngrok disconnect' : 'ngrok connect'} debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, kiosk.ngrok ? 'ngrok disconnect' : 'ngrok connect')} disabled={disabled} status={kiosk.ngrok} label={t('ngrok')} className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800" icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>} />
                        <ControlButton debugAction={kiosk.ssh ? 'ssh disconnect' : 'ssh connect'} debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, kiosk.ssh ? 'ssh disconnect' : 'ssh connect')} disabled={disabled} status={kiosk.ssh} label={t('ssh')} className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800" icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" /></svg>} />
                        <ControlButton
                            onClick={() => onCommand(kiosk.stationid, 'hotspot')}
                            debugAction="hotspot"
                            debugContext={debugContext}
                            disabled={false}
                            label={t('hotspot')}
                            className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800"
                            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.556A5.5 5.5 0 0112 15c1.453 0 2.8.54 3.889 1.556M4.889 13.333A9.5 9.5 0 0112 11c2.477 0 4.78.94 6.556 2.667m-13.112-6.222A13.5 13.5 0 0112 7c3.523 0 6.81.94 9.667 2.778" /></svg>}
                        />
                    </>
                )}

                {clientInfo.features.rentals && (
                        <ControlButton debugAction="rent" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'rent')} disabled={disabled} label={t('rent')} className="col-span-2 bg-sky-100 hover:bg-sky-200 text-sky-800" />
                )}

                {clientInfo.commands.eject && (
                    <>
                        <ControlButton debugAction="eject all" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'eject all')} disabled={disabled} label={`${t('eject_all')} (${ejectCounts.total})`} className="bg-green-100 hover:bg-green-200 text-green-800" />
                        <ControlButton debugAction="eject full" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'eject full')} disabled={disabled} label={`${t('eject_full')} (${ejectCounts.full})`} className="bg-green-100 hover:bg-green-200 text-green-800" />
                        <ControlButton debugAction="eject empty" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'eject empty')} disabled={disabled} label={`${t('eject_empty')} (${ejectCounts.empty})`} className="bg-green-100 hover:bg-green-200 text-green-800" />
                        <ControlButton debugAction="eject locked" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'eject locked')} disabled={disabled} label={`${t('eject_locked')} (${ejectCounts.locked})`} className="bg-green-100 hover:bg-green-200 text-green-800" />
                    </>
                )}

                {clientInfo.commands.eject_multiple && (
                    <>
                        <ControlButton debugAction="eject count 5" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'eject count', null, null, null, { slotid: 5 })} disabled={disabled} label={t('eject_5')} className="bg-green-100 hover:bg-green-200 text-green-800" />
                        <ControlButton debugAction="eject count 10" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'eject count', null, null, null, { slotid: 10 })} disabled={disabled} label={t('eject_10')} className="bg-green-100 hover:bg-green-200 text-green-800" />
                    </>
                )}

                {canControlAudio && (
                    <V2AudioControl kiosk={kiosk} t={t} onCommand={onCommand} disabled={disabled} />
                )}
                
                {clientInfo.commands.updates && !isV2 && (
                    <>
                        <ControlButton debugAction="update flow" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'update flow', null, kiosk.provisionid)} disabled={disabled} label={t('update_flow')} subLabel={flowSubLabel()} className="bg-blue-100 hover:bg-blue-200 text-blue-800" />
                        <ControlButton debugAction="update ui" debugContext={debugContext} onClick={() => onCommand(kiosk.stationid, 'update ui', null, kiosk.provisionid, serverUiVersion)} disabled={disabled} label={t('update_ui')} subLabel={uiSubLabel()} className="bg-blue-100 hover:bg-blue-200 text-blue-800" />
                    </>
                )}
            </div>
        </div>
    );
}

export default KioskControlPanel;
