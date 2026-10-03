// src/components/kiosk/KioskDetailPanel.jsx

import { memo, useMemo, useCallback, useEffect, useState } from 'react';
import KioskControlPanel from './KioskControlPanel';
import Ctf7ModulePanel from './Ctf7ModulePanel.jsx';
import {
    getKioskPowerThreshold,
    hasNonZeroChargerId,
    isChargeStatusError,
    isKioskOnline,
    isModuleOnline,
    isNewSchemaKiosk,
    isSlotActivelyCharging,
    resolveModuleWifiStatus,
} from '../../utils/helpers';
import { formatModuleFirmwareVersion } from '../../utils/firmwareVersion';
import { installKioskInteractionDebugCapture, logKioskInteraction } from '../../utils/kioskInteractionDebug';
import { resolveKioskUiProfileStatus } from '../../utils/kioskUiProfileStatus';
import { resolveKioskMediaPlaybackStatus } from '../../utils/kioskMediaPlaybackStatus';
import { callFunctionWithAuth } from '../../utils/callableRequest';

const UI_PROFILE_STATUS_CLASSES = {
    confirmed: 'border-emerald-400/30 bg-emerald-400/15 text-emerald-200',
    pending: 'border-amber-400/30 bg-amber-400/15 text-amber-100',
    'out-of-sync': 'border-orange-400/30 bg-orange-400/15 text-orange-100',
    error: 'border-red-400/30 bg-red-400/15 text-red-100',
    legacy: 'border-gray-400/30 bg-gray-400/10 text-gray-300',
};

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

const ChargeStatusIndicator = ({ slot }) => {
    const normalizedStatus = String(slot?.cmos ?? '').trim().toUpperCase();
    if (!normalizedStatus) return null;

    const colorClass = isChargeStatusError(slot)
        ? 'text-red-600'
        : isSlotActivelyCharging(slot)
            ? 'text-green-600'
            : 'text-gray-500';

    return (
        <span className={`text-[10px] font-mono font-bold ${colorClass}`}>{normalizedStatus}</span>
    );
};

const ChargeTimeoutIndicator = () => (
    <span
        className="inline-flex shrink-0 text-amber-700"
        title="Charging start timed out"
        aria-label="Charging start timed out"
        data-kiosk-charge-timeout="true"
    >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 2h6M12 2v3m6.36 1.64 1.42-1.42M12 8v5l3 2" />
            <circle cx="12" cy="14" r="8" />
        </svg>
    </span>
);

const isSlotInChargeTimeout = (module, slot, now) => {
    const state = module?.chargeControl?.[`slot${slot?.position}`];
    const blockedUntil = Number(state?.blockedUntil);
    const numericStatus = Number(slot?.status);
    const slotLooksEmpty = !slot ||
        slot.sstat === '0C' ||
        !hasNonZeroChargerId(slot?.sn) ||
        (Number.isFinite(numericStatus) && numericStatus === 0);

    return !slotLooksEmpty &&
        String(state?.blockedAction || '').trim().toLowerCase() === 'start' &&
        Number.isFinite(blockedUntil) &&
        blockedUntil > now;
};

const moduleIdsMatch = (left, right) => {
    const leftId = String(left || '').trim();
    const rightId = String(right || '').trim();

    if (!leftId || !rightId) return false;
    if (leftId === rightId) return true;

    return leftId.split('m').pop() === rightId.split('m').pop();
};

const DEFAULT_LOCKED_SLOT_CLASSES = 'border-red-500 bg-red-100 text-red-800';
const PURPLE_LOCKED_SLOT_CLASSES = 'border-purple-400 bg-purple-100 text-purple-800';

const normalizeLockReason = (reason) => (
    String(reason || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
);

const isPurpleLockReason = (reason) => {
    const normalizedReason = normalizeLockReason(reason);
    return normalizedReason === 'broken charger suspected: 2 consecutive returns between 1 and 5 minutes' ||
        normalizedReason.startsWith('auto locked after verified motor error; charger remained present') ||
        normalizedReason.startsWith('never dispensed:');
};

const getLockedSlotClasses = (slot) => (
    isPurpleLockReason(slot?.lockReason)
        ? PURPLE_LOCKED_SLOT_CLASSES
        : DEFAULT_LOCKED_SLOT_CLASSES
);

const slotHasDisplayableCharger = (slot) => (
    hasNonZeroChargerId(slot?.sn) || slot?.isSstatError === true
);

const getModuleTypeOutlineClass = (module) => {
    const modtype = String(module?.modtype ?? '').trim().padStart(2, '0');

    if (modtype === '01') return 'ring-2 ring-gray-400';
    if (modtype === '03') return 'ring-2 ring-black';

    return '';
};

const ModuleWifiStatus = ({ moduleId, status }) => {
    const ssid = String(status?.ssid || '').trim();
    const source = String(status?.source || 'unavailable');
    const signalLabel = Number.isFinite(status?.signalDbm) ? `${status.signalDbm} dBm` : '';
    const sourceLabel = source === 'reported'
        ? signalLabel || 'Live'
        : source === 'configured'
            ? 'Saved'
            : '—';
    const displaySsid = ssid || 'Not reported';
    const title = source === 'reported'
        ? `Reported Wi-Fi: ${displaySsid}${signalLabel ? ` (${signalLabel})` : ''}`
        : source === 'configured'
            ? `Saved Wi-Fi: ${displaySsid}; no module report yet`
            : 'Wi-Fi has not been reported';

    return (
        <div
            className="mt-1 flex min-w-0 items-center gap-1.5 rounded-md bg-sky-50 px-1.5 py-1 text-[10px] text-sky-800"
            title={title}
            aria-label={`${moduleId} ${title}`}
            data-kiosk-module-wifi={moduleId}
            data-kiosk-wifi-source={source}
            data-kiosk-wifi-ssid={ssid}
        >
            <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" d="M5 12.55a11 11 0 0114.08 0M8.53 16.11a6 6 0 016.95 0M12 20h.01" />
            </svg>
            <span className="shrink-0 font-semibold">Wi-Fi</span>
            <span className="min-w-0 flex-1 truncate font-mono font-semibold">{displaySsid}</span>
            <span className="shrink-0 text-[9px] font-semibold text-sky-600">{sourceLabel}</span>
        </div>
    );
};

const resolvePlaylistAssetKind = (asset) => {
    const kind = String(asset?.kind || '').trim().toLowerCase();
    if (kind) return kind;

    const contentType = String(asset?.contentType || '').trim().toLowerCase();
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType === 'application/pdf') return 'pdf';

    return 'other';
};

// --- Main Detail Panel Component ---
function KioskDetailPanel({ kiosk, isVisible, onSlotClick, onLockSlot, pendingSlots, ejectingSlots, failedEjectSlots, lockingSlots, t, onCommand, onNavigateToChargers, serverUiVersion, serverFlowVersion, clientInfo, mockNow }) {
    const [mountedAt] = useState(() => Date.now());
    const [selectedModuleId, setSelectedModuleId] = useState(() => String(kiosk.modules?.[0]?.id || ''));
    const [v1MediaAssignment, setV1MediaAssignment] = useState(null);
    const [v1MediaLoadState, setV1MediaLoadState] = useState('idle');
    const [activeMediaIndex, setActiveMediaIndex] = useState(0);
    const isOnline = isKioskOnline(kiosk, mockNow);
    const isV2Kiosk = isNewSchemaKiosk(kiosk);
    const stationId = kiosk.stationid;
    const hardwareType = String(kiosk.hardware?.type || '').trim().toUpperCase();
    const isCK50Kiosk = hardwareType === 'CK50';
    const hasAnyCommands = Object.values(clientInfo.commands).some(v => v === true) || clientInfo.features.rentals;
    const canUpdateModules = clientInfo.commands.updates && isV2Kiosk && hardwareType !== 'CTF7';
    const showModuleFirmwareMetadata = isV2Kiosk;
    const showInlineModuleIds = ['CT3', 'CT4', 'CT8', 'CT12', 'CK24', 'CK40', 'CK48'].includes(kiosk.hardware?.type);
    const chargeReadyThreshold = getKioskPowerThreshold(kiosk);
    const mockNowMs = mockNow instanceof Date ? mockNow.getTime() : Number(mockNow);
    const chargeTimeoutNow = Number.isFinite(mockNowMs) ? mockNowMs : mountedAt;
    const isUiMode = String(kiosk.ui?.mode || '').trim().toUpperCase() === 'UI';
    const displayedStateLabel = isUiMode ? 'UI State' : 'Terminal State';
    const displayedState = isUiMode
        ? kiosk.uistate
        : kiosk.activity?.terminal?.currentState || kiosk.terminalState || kiosk.uistate;
    const uiProfileStatus = useMemo(() => resolveKioskUiProfileStatus(kiosk), [kiosk]);
    useEffect(() => installKioskInteractionDebugCapture(), []);
    useEffect(() => {
        if (!isVisible || !isCK50Kiosk || !stationId) {
            setV1MediaAssignment(null);
            setV1MediaLoadState('idle');
            return undefined;
        }

        const abortController = new AbortController();
        let disposed = false;
        const normalizedStationId = String(stationId).trim().toUpperCase();

        setV1MediaLoadState('loading');
        callFunctionWithAuth('media_listAssets', {}, {
            timeoutMs: 15000,
            timeoutMessage: 'Loading the CK50 screen preview took too long.',
            abortController,
            abortMessage: 'CK50 screen preview request canceled.',
            forceRefreshToken: false,
        }).then((payload) => {
            if (disposed) return;

            const assignments = Array.isArray(payload?.v1Assignments) ? payload.v1Assignments : [];
            const assignment = assignments.find((entry) => (
                String(entry?.stationid || '').trim().toUpperCase() === normalizedStationId
            ));

            setV1MediaAssignment(assignment || {
                stationid: normalizedStationId,
                active: false,
                playlist: [],
                assetIds: [],
            });
            setV1MediaLoadState('loaded');
        }).catch(() => {
            if (disposed || abortController.signal.aborted) return;
            setV1MediaAssignment(null);
            setV1MediaLoadState('error');
        });

        return () => {
            disposed = true;
            abortController.abort();
        };
    }, [isCK50Kiosk, isVisible, stationId]);
    const effectiveMedia = isCK50Kiosk
        ? (v1MediaAssignment || kiosk?.media || null)
        : kiosk?.media;
    const mediaPlaylist = useMemo(() => {
        if (effectiveMedia?.active !== true) {
            return [];
        }

        return (Array.isArray(effectiveMedia?.playlist) ? effectiveMedia.playlist : [])
            .filter((asset) => String(asset?.downloadUrl || '').trim())
            .map((asset) => ({
                ...asset,
                previewKind: resolvePlaylistAssetKind(asset),
            }));
    }, [effectiveMedia]);
    const mediaPlaylistKey = useMemo(() => (
        mediaPlaylist
            .map((asset) => String(asset?.assetId || asset?.downloadUrl || ''))
            .join('|')
    ), [mediaPlaylist]);
    const advanceMediaPreview = useCallback(() => {
        setActiveMediaIndex((currentIndex) => (
            mediaPlaylist.length > 0 ? (currentIndex + 1) % mediaPlaylist.length : 0
        ));
    }, [mediaPlaylist.length]);
    useEffect(() => {
        setActiveMediaIndex(0);
    }, [mediaPlaylistKey, stationId]);
    const primaryMediaAsset = mediaPlaylist.length > 0
        ? mediaPlaylist[activeMediaIndex % mediaPlaylist.length]
        : null;
    const mediaPlaybackStatus = useMemo(() => (
        isCK50Kiosk ? resolveKioskMediaPlaybackStatus({
            kiosk,
            assignment: effectiveMedia || {},
            referenceTime: mockNow,
            isOnline,
        }) : null
    ), [effectiveMedia, isCK50Kiosk, isOnline, kiosk, mockNow]);
    const shouldDisplayMediaArtwork = !isCK50Kiosk || mediaPlaybackStatus?.state === 'playing';
    useEffect(() => {
        if (!shouldDisplayMediaArtwork || !primaryMediaAsset || mediaPlaylist.length < 2 || primaryMediaAsset.previewKind === 'video') {
            return undefined;
        }

        const playTimeSeconds = Math.max(1, Math.min(3600, Number(primaryMediaAsset.playTime || 20)));
        const timeoutId = globalThis.setTimeout(advanceMediaPreview, playTimeSeconds * 1000);
        return () => globalThis.clearTimeout(timeoutId);
    }, [advanceMediaPreview, mediaPlaylist.length, primaryMediaAsset, shouldDisplayMediaArtwork]);
    const formatFotaVersion = useCallback((module) => {
        const rawVersion = String(
            module?.fotaVersion ||
            module?.firmwareVersion ||
            module?.mcuVersion ||
            module?.lastSeenHardware ||
            kiosk.hardware?.fotaVersion ||
            kiosk.hardware?.firmwareVersion ||
            kiosk.hardware?.mcuVersion ||
            ''
        ).trim();

        if (!rawVersion) {
            return {
                label: 'FOTA ---',
                title: 'No FOTA version reported',
            };
        }

        const versionToken = rawVersion.match(/\bV\d{3,5}\b/i)?.[0];
        return {
            label: `FOTA ${versionToken ? versionToken.toUpperCase() : rawVersion}`,
            title: rawVersion,
        };
    }, [kiosk.hardware?.firmwareVersion, kiosk.hardware?.fotaVersion, kiosk.hardware?.mcuVersion]);
    const orderedModules = useMemo(() => {
        const modules = Array.isArray(kiosk.modules) ? kiosk.modules : [];
        const savedOrder = Array.isArray(kiosk.moduleDisplayOrder) ? kiosk.moduleDisplayOrder : [];
        if (savedOrder.length === 0) return modules;

        const ordered = savedOrder
            .map((moduleId) => modules.find((module) => moduleIdsMatch(module?.id, moduleId)))
            .filter(Boolean);
        const remaining = modules.filter((module) => (
            !ordered.some((orderedModule) => moduleIdsMatch(orderedModule?.id, module?.id))
        ));
        return [...ordered, ...remaining];
    }, [kiosk.moduleDisplayOrder, kiosk.modules]);
    const moduleEntries = useMemo(() => (
        Array.isArray(orderedModules)
            ? orderedModules
                .map((module) => {
                    const moduleId = String(module?.id || '').trim();
                    const firmwareVersion = formatModuleFirmwareVersion(
                        module?.softwareVersion,
                        module?.hardwareVersion
                    );
                    const fotaVersion = formatFotaVersion(module);
                    return {
                        moduleId,
                        moduleOnline: isModuleOnline(module, mockNow),
                        wifiStatus: resolveModuleWifiStatus(kiosk, moduleId),
                        firmwareLabel: `FW ${firmwareVersion}`,
                        fotaVersionLabel: fotaVersion.label,
                        fotaVersionTitle: fotaVersion.title,
                        updateLabel: t('update_module'),
                    };
                })
                .filter((entry) => entry.moduleId)
            : []
    ), [formatFotaVersion, kiosk, mockNow, orderedModules, t]);
    const moduleIds = useMemo(() => (
        moduleEntries.map((entry) => entry.moduleId)
    ), [moduleEntries]);
    const hasMultipleModules = isV2Kiosk && orderedModules.length > 1;
    const selectedModule = hasMultipleModules
        ? orderedModules.find((module) => moduleIdsMatch(module?.id, selectedModuleId)) || orderedModules[0]
        : orderedModules[0];
    const visibleModules = hasMultipleModules && selectedModule ? [selectedModule] : orderedModules;
    const showModuleIdCards = isV2Kiosk && moduleIds.length > 0 && !showInlineModuleIds;
    useEffect(() => {
        if (!hasMultipleModules) {
            setSelectedModuleId(String(orderedModules[0]?.id || ''));
            return;
        }

        if (!orderedModules.some((module) => moduleIdsMatch(module?.id, selectedModuleId))) {
            setSelectedModuleId(String(orderedModules[0]?.id || ''));
        }
    }, [hasMultipleModules, orderedModules, selectedModuleId]);
    const handleMoveModule = useCallback((moduleId, direction) => {
        const currentIndex = orderedModules.findIndex((module) => moduleIdsMatch(module?.id, moduleId));
        const nextIndex = currentIndex + direction;
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedModules.length) return;

        const nextModules = orderedModules.slice();
        [nextModules[currentIndex], nextModules[nextIndex]] = [nextModules[nextIndex], nextModules[currentIndex]];
        const nextOrder = nextModules.map((module) => String(module.id));
        const directionLabel = direction < 0 ? 'up' : 'down';
        onCommand(kiosk.stationid, 'moduleorderchange', moduleId, null, null, {
            kiosk: {
                ...kiosk,
                hardware: {
                    ...kiosk.hardware,
                    moduleOrder: nextOrder,
                },
            },
            confirmationText: `Move module ${moduleId} ${directionLabel} to match its physical position?`,
        });
    }, [kiosk, onCommand, orderedModules]);
    const formatChargeRate = useCallback((rate) => {
        const numericRate = Number(rate);
        if (!Number.isFinite(numericRate) || numericRate <= 0) {
            return '--';
        }

        return `${numericRate.toFixed(3)} %/min`;
    }, []);
    const formatEtaToReady = useCallback((etaMinutes) => {
        if (etaMinutes === 0) {
            return '0m';
        }

        if (!Number.isFinite(etaMinutes) || etaMinutes < 0) {
            return '--';
        }

        if (etaMinutes < 60) {
            return `${Math.ceil(etaMinutes)}m`;
        }

        const hours = Math.floor(etaMinutes / 60);
        const minutes = Math.ceil(etaMinutes % 60);
        return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
    }, []);
    const handleModuleUpdate = useCallback((moduleId) => {
        logKioskInteraction('module-update-click-handler', {
            stationId: kiosk.stationid,
            moduleId,
        });
        onCommand(kiosk.stationid, 'update module', moduleId);
    }, [kiosk.stationid, onCommand]);
    const renderModuleQuickActions = (moduleId) => {
        const actions = [
            {
                action: 'reboot module',
                enabled: clientInfo.commands.reboot,
                label: `Reboot module ${moduleId}`,
                className: 'hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700',
                icon: (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                ),
            },
            {
                action: 'eject module',
                enabled: clientInfo.commands.eject,
                label: `Eject all chargers from module ${moduleId}`,
                className: 'hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700',
                icon: <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12M5 21h14" />,
            },
        ].filter((item) => item.enabled);

        if (actions.length === 0) return null;

        return (
            <div className="flex shrink-0 items-center gap-1" data-kiosk-module-actions={moduleId}>
                {actions.map((item) => (
                    <button
                        key={item.action}
                        type="button"
                        title={item.label}
                        aria-label={item.label}
                        data-kiosk-action={item.action}
                        data-kiosk-stationid={stationId}
                        data-kiosk-moduleid={moduleId}
                        onClick={(event) => {
                            event.stopPropagation();
                            logKioskInteraction('module-quick-action-click-handler', {
                                stationId,
                                moduleId,
                                action: item.action,
                            }, event);
                            onCommand(stationId, item.action, moduleId);
                        }}
                        disabled={!isOnline}
                        className={`flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-300 ${item.className}`}
                    >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            {item.icon}
                        </svg>
                    </button>
                ))}
            </div>
        );
    };
    const handleNavigateToCharger = useCallback((event, chargerSn) => {
        event.stopPropagation();
        logKioskInteraction('charger-link-click-handler', {
            stationId,
            chargerSn,
        }, event);
        if (!chargerSn || !onNavigateToChargers) return;
        onNavigateToChargers(String(chargerSn));
    }, [onNavigateToChargers, stationId]);
    const compactHeaderModules = useMemo(() => (
        Array.isArray(orderedModules)
            ? orderedModules.map((module, index) => {
                const estimatedPctPerMinute = Number(module?.chargeMetrics?.estimatedPctPerMinute);
                const activeChargingSlots = Array.isArray(module?.slots)
                    ? module.slots.filter((slot) => (
                        slot &&
                        hasNonZeroChargerId(slot.sn) &&
                        isSlotActivelyCharging(slot)
                    ))
                    : [];
                const hasReadyCharger = Array.isArray(module?.slots) && module.slots.some((slot) => (
                    slot &&
                    hasNonZeroChargerId(slot.sn) &&
                    typeof slot.batteryLevel === 'number' &&
                    slot.batteryLevel >= chargeReadyThreshold
                ));
                const etaCandidates = !hasReadyCharger && Number.isFinite(estimatedPctPerMinute) && estimatedPctPerMinute > 0
                    ? activeChargingSlots
                        .filter((slot) => typeof slot.batteryLevel === 'number' && slot.batteryLevel < chargeReadyThreshold)
                        .map((slot) => (chargeReadyThreshold - slot.batteryLevel) / estimatedPctPerMinute)
                        .filter((eta) => Number.isFinite(eta) && eta >= 0)
                    : [];

                const fotaVersion = formatFotaVersion(module);
                const moduleId = String(module?.id || '').trim() || '---';
                return {
                    key: `${module?.id || 'module'}-${index}`,
                    moduleId,
                    moduleOnline: isModuleOnline(module, mockNow),
                    wifiStatus: resolveModuleWifiStatus(kiosk, moduleId),
                    updateLabel: t('update_module'),
                    firmwareLabel: `FW ${formatModuleFirmwareVersion(
                        module?.softwareVersion,
                        module?.hardwareVersion
                    )}`,
                    fotaVersionLabel: fotaVersion.label,
                    fotaVersionTitle: fotaVersion.title,
                    avgChargeRate: formatChargeRate(estimatedPctPerMinute),
                    etaToReady: hasReadyCharger
                        ? formatEtaToReady(0)
                        : formatEtaToReady(etaCandidates.length > 0 ? Math.min(...etaCandidates) : Number.NaN),
                };
            })
            : []
    ), [chargeReadyThreshold, formatChargeRate, formatEtaToReady, formatFotaVersion, kiosk, mockNow, orderedModules, t]);
    const showLegacySideIndicators = !kiosk.isNewSchema;

    const ejectingSet = useMemo(
        () => new Set((Array.isArray(ejectingSlots) ? ejectingSlots : []).map((slot) => `${slot.stationid}-${slot.moduleid}-${slot.slotid}`)),
        [ejectingSlots]
    );
    const pendingSet = useMemo(
        () => new Set((Array.isArray(pendingSlots) ? pendingSlots : []).map((slot) => `${slot.stationid}-${slot.moduleid}-${slot.slotid}`)),
        [pendingSlots]
    );
    const failedEjectList = useMemo(
        () => (Array.isArray(failedEjectSlots) ? failedEjectSlots : []),
        [failedEjectSlots]
    );

    // A simple Set is all we need to know which slots are "in-progress"
    const lockingSet = useMemo(
        () => new Set((Array.isArray(lockingSlots) ? lockingSlots : []).map((slot) => `${slot.stationid}-${slot.moduleid}-${slot.slotid}`)),
        [lockingSlots]
    );

    const hasFailedEject = useCallback((module, slot) => {
        return failedEjectList.some((failedSlot) =>
            failedSlot.stationid === stationId &&
            Number(failedSlot.slotid) === Number(slot.position) &&
            moduleIdsMatch(failedSlot.moduleid, module.id)
        );
    }, [failedEjectList, stationId]);

    const getLockButtonTitle = useCallback((slot) => {
        if (!slot?.isLocked) {
            return t('lock_slot');
        }

        const lockReason = String(slot.lockReason || '').trim();
        return lockReason || t('unlock_slot');
    }, [t]);

    const getSlotStyle = useCallback((slot, module) => {
        const slotId = `${stationId}-${module.id}-${slot.position}`;
        const numericStatus = Number(slot?.status);
        const slotLooksEmpty = !slot || (
            !slot.isSstatError && (
                slot.sstat === '0C' ||
                !hasNonZeroChargerId(slot?.sn) ||
                (Number.isFinite(numericStatus) && numericStatus === 0)
            )
        );

        if (lockingSet.has(slotId)) {
            if (slot.isLocked) { // If the slot is currently locked, keep its locked color while glowing.
                return { className: `${getLockedSlotClasses(slot)} slot-lock-glow`, glow: false };
            } else { // If the slot is currently unlocked, glow blue.
                return { className: 'border-blue-400 bg-blue-100 text-blue-800 slot-lock-glow', glow: false };
            }
        }
        if (hasFailedEject(module, slot)) {
            return { className: 'border-red-500 bg-red-100 text-red-800 animate-pulse', glow: false };
        }
        if (ejectingSet.has(slotId) && !slot.isLocked && !slotLooksEmpty) {
            return { className: 'border-green-500 bg-green-100 text-green-800 slot-glow', glow: false };
        }
        if (pendingSet.has(slotId)) {
            return { className: 'border-yellow-400 bg-yellow-100 text-yellow-800 animate-pulse', glow: false };
        }
        if (slot.isLocked) {
            return { className: getLockedSlotClasses(slot), glow: false };
        }
        if (slotLooksEmpty) {
            return { className: 'border-gray-300 bg-gray-100 text-gray-400', glow: false };
        }

        const isCharging = isSlotActivelyCharging(slot);

        if (isCharging) {
            return {
                className: 'border-yellow-500 bg-yellow-200 text-yellow-900',
                glow: true,
            };
        }

        let className = '';

        if (slot.batteryLevel >= chargeReadyThreshold) {
            className = 'border-blue-500 bg-blue-100 text-blue-800';
        } else {
            className = 'border-orange-400 bg-orange-100 text-orange-800';
        }

        return { className, glow: false };
    }, [chargeReadyThreshold, ejectingSet, hasFailedEject, lockingSet, pendingSet, stationId]);

    const renderModuleControls = (module) => {
        const canEjectModule = clientInfo.commands.eject;
        const canRebootModule = !isV2Kiosk && clientInfo.commands.reboot;
        const canChargeModule = !isV2Kiosk && clientInfo.commands.reboot;
        const moduleChargeEnabled = module?.chargeControl?.enabled !== false;
        const chargeAction = moduleChargeEnabled ? 'stop charge module' : 'start charge module';

        if (!canEjectModule && !canChargeModule && !canRebootModule) {
            return null;
        }

        return (
            <div className="flex items-center gap-1 mt-1 pt-1 border-t border-gray-200">
                {canEjectModule && (
                    <button
                        type="button"
                        title={t('eject_all_from_module')}
                        data-kiosk-action="eject module"
                        data-kiosk-stationid={stationId}
                        data-kiosk-moduleid={module.id}
                        data-kiosk-disabled-reason={!canEjectModule ? 'permission' : ''}
                        onClick={(e) => {
                            e.stopPropagation();
                            logKioskInteraction('module-eject-click-handler', {
                                stationId,
                                moduleId: module.id,
                            }, e);
                            onCommand(stationId, 'eject module', module.id);
                        }}
                        className="p-1 flex-1 text-gray-500 hover:bg-gray-100 rounded flex justify-center items-center"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                        </svg>
                    </button>
                )}
                {canChargeModule && (
                    <button
                        type="button"
                        title={moduleChargeEnabled ? t('stop_charge_module') : t('start_charge_module')}
                        data-kiosk-action={chargeAction}
                        data-kiosk-stationid={stationId}
                        data-kiosk-moduleid={module.id}
                        data-kiosk-disabled-reason={!isOnline ? 'offline' : ''}
                        onClick={(e) => {
                            e.stopPropagation();
                            logKioskInteraction('module-charge-toggle-click-handler', {
                                stationId,
                                moduleId: module.id,
                                action: chargeAction,
                                isOnline,
                            }, e);
                            onCommand(stationId, chargeAction, module.id);
                        }}
                        disabled={!isOnline}
                        className={`p-1 flex-1 rounded flex justify-center items-center disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent ${
                            moduleChargeEnabled
                                ? 'text-yellow-600 hover:bg-yellow-100'
                                : 'text-gray-500 hover:bg-gray-100'
                        }`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill={moduleChargeEnabled ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
                        </svg>
                    </button>
                )}
                {canRebootModule && (
                    <button
                        type="button"
                        title={t('reboot_module')}
                        data-kiosk-action="reboot module"
                        data-kiosk-stationid={stationId}
                        data-kiosk-moduleid={module.id}
                        data-kiosk-disabled-reason={!isOnline ? 'offline' : ''}
                        onClick={(e) => {
                            e.stopPropagation();
                            logKioskInteraction('module-reboot-click-handler', {
                                stationId,
                                moduleId: module.id,
                                isOnline,
                            }, e);
                            onCommand(stationId, 'reboot module', module.id);
                        }}
                        disabled={!isOnline}
                        className="p-1 flex-1 text-gray-500 hover:bg-gray-100 rounded flex justify-center items-center disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                )}
            </div>
        );
    };
    
    const renderSlotButton = (slot, module, style, key) => {
        const canEject = clientInfo.commands.eject;
        const canLock = clientInfo.commands.lock;
        const hasCharger = slotHasDisplayableCharger(slot);
        const isChargeTimedOut = isSlotInChargeTimeout(module, slot, chargeTimeoutNow);
        const ejectDisabledReason = !canEject ? 'permission' : !isOnline ? 'offline' : '';
        const lockDisabledReason = !isOnline ? 'offline' : '';

        return (
            <div
                key={key}
                className={`relative flex items-stretch p-0.5 rounded-md border transition-colors duration-200 text-left ${style.className} ${style.glow ? 'slot-charging-glow' : ''}`}
                data-kiosk-slot-debug="true"
                data-kiosk-stationid={stationId}
                data-kiosk-moduleid={module.id}
                data-kiosk-slotid={slot.position}
            >
                {/* Eject Button */}
                <div className={`relative flex-grow p-0.5 rounded-l-md overflow-hidden ${isCK50Kiosk ? 'min-w-0' : 'flex items-center justify-start'}`}>
                    <button
                        type="button"
                        data-kiosk-action="slot eject"
                        data-kiosk-stationid={stationId}
                        data-kiosk-moduleid={module.id}
                        data-kiosk-slotid={slot.position}
                        data-kiosk-disabled-reason={ejectDisabledReason}
                        onClick={(event) => {
                            logKioskInteraction('slot-eject-click-handler', {
                                stationId,
                                moduleId: module.id,
                                slotid: slot.position,
                                canEject,
                                isOnline,
                                hasCharger,
                                disabledReason: ejectDisabledReason,
                            }, event);
                            onSlotClick(stationId, module.id, slot.position);
                        }}
                        disabled={!canEject || !isOnline}
                        className={isCK50Kiosk
                            ? 'grid h-9 w-full min-w-0 grid-cols-[24px_minmax(0,1fr)] grid-rows-2 items-center gap-x-0.5 disabled:cursor-not-allowed'
                            : 'flex min-w-0 flex-grow items-center justify-start disabled:cursor-not-allowed'}
                    >
                        {isCK50Kiosk ? (
                            <>
                                <span className="col-start-1 row-start-1 self-center text-center font-mono text-xs text-gray-500">
                                    {String(slot.position).padStart(2, '0')}
                                </span>
                                <span className="col-start-1 row-start-2 flex items-center justify-center self-center">
                                    <StatusIndicator status={slot.sstat} />
                                </span>
                                <span className="col-start-2 row-start-1 flex min-w-0 items-center gap-0.5 self-center font-mono text-[8px] font-bold">
                                    <span>{hasCharger ? `${slot.batteryLevel}%` : t('empty')}</span>
                                    <ChargeStatusIndicator slot={slot} />
                                    {isChargeTimedOut && <ChargeTimeoutIndicator />}
                                </span>
                            </>
                        ) : (
                            <>
                                <div className="mr-2 flex w-8 flex-col items-center">
                                    <span className="text-xs font-mono text-gray-500">{String(slot.position).padStart(2, '0')}</span>
                                    <StatusIndicator status={slot.sstat} />
                                </div>
                                <div className="flex min-w-0 flex-col items-start">
                                    <span className="flex items-center gap-1 font-mono text-xs font-bold">
                                        <span>{hasCharger ? `${slot.batteryLevel}%` : t('empty')}</span>
                                        <ChargeStatusIndicator slot={slot} />
                                        {isChargeTimedOut && <ChargeTimeoutIndicator />}
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-mono leading-tight truncate">{'\u00A0'}</span>
                                </div>
                            </>
                        )}
                    </button>
                    {hasCharger && (
                        <button
                            type="button"
                            data-kiosk-action="charger link"
                            data-kiosk-stationid={stationId}
                            data-kiosk-moduleid={module.id}
                            data-kiosk-slotid={slot.position}
                            onClick={(event) => handleNavigateToCharger(event, slot.sn)}
                            className={`${isCK50Kiosk ? 'absolute bottom-[5px] left-[26px] text-[8px]' : 'ml-2 text-[10px]'} shrink-0 font-mono leading-tight text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900`}
                            title={`${t('chargers_page_title')}: ${slot.sn}`}
                        >
                            {slot.sn}
                        </button>
                    )}
                </div>

                {/* Lock/Unlock Button */}
                {canLock && (
                    <div className="flex flex-shrink-0 items-center border-l border-gray-300/50">
                        <button
                            type="button"
                            data-kiosk-action={slot.isLocked ? 'unlock slot' : 'lock slot'}
                            data-kiosk-stationid={stationId}
                            data-kiosk-moduleid={module.id}
                            data-kiosk-slotid={slot.position}
                            data-kiosk-disabled-reason={lockDisabledReason}
                            onClick={(event) => {
                                logKioskInteraction('slot-lock-click-handler', {
                                    stationId,
                                    moduleId: module.id,
                                    slotid: slot.position,
                                    isCurrentlyLocked: slot.isLocked,
                                    isOnline,
                                    disabledReason: lockDisabledReason,
                                }, event);
                                onLockSlot(stationId, module.id, slot.position, slot.isLocked);
                            }}
                            disabled={!isOnline}
                            className={`flex h-8 items-center justify-center rounded-r-md hover:bg-gray-200/50 disabled:cursor-not-allowed ${isCK50Kiosk ? 'w-6' : 'w-8'}`}
                            title={getLockButtonTitle(slot)}
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

                {showLegacySideIndicators && slot.isFullNotCharging && (
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-red-500 rounded-r-md"></div>
                )}
                {showLegacySideIndicators && slot.isSstatError && (
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-purple-500 rounded-r-md"></div>
                )}
            </div>
        );
    };

    const renderModuleOperationalSwitch = (module) => {
        if (isV2Kiosk || !clientInfo.commands.disable) return null;

        const enabled = module?.operationalEnabled !== false;
        const action = enabled ? 'disable module' : 'enable module';

        return (
            <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${enabled ? 'Disable' : 'Enable'} rentals for ${module.id}`}
                data-kiosk-action={action}
                data-kiosk-stationid={stationId}
                data-kiosk-moduleid={module.id}
                disabled={!isOnline}
                onClick={(event) => {
                    event.stopPropagation();
                    onCommand(stationId, action, module.id);
                }}
                className={`relative inline-flex h-6 w-[52px] items-center rounded-full text-[8px] font-black uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${enabled ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'}`}
            >
                <span className={`absolute z-10 ${enabled ? 'left-2' : 'right-1.5'}`}>
                    {enabled ? 'ON' : 'OFF'}
                </span>
                <span className={`absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-7' : ''}`} />
            </button>
        );
    };

    const renderModule = (module, { reverseOrder = false, className = '' } = {}) => (
        <div
            key={module.id}
            data-kiosk-module-operational={module.operationalEnabled === false ? 'disabled' : 'enabled'}
            className={`${module.operationalEnabled === false ? 'border-2 border-gray-400 bg-gray-100' : module.output === false ? 'bg-red-100' : 'bg-white'} p-2 rounded-lg shadow-inner ${getModuleTypeOutlineClass(module)} ${className}`}
        >
            <div className="mb-1.5 flex justify-end">
                {renderModuleOperationalSwitch(module)}
            </div>
            <div className={`flex flex-col gap-1 ${module.operationalEnabled === false ? 'opacity-45 grayscale' : ''}`}>
                {module.slots.slice().sort((a, b) => reverseOrder ? b.position - a.position : a.position - b.position).map(slot => {
                    const style = getSlotStyle(slot, module);
                    return renderSlotButton(slot, module, style, slot.position);
                })}
            </div>
            {renderModuleControls(module)}
        </div>
    );

    const renderPaymentTerminal = (hardwareType) => {
        const model = String(hardwareType || kiosk.hardware?.type || '').toUpperCase();
        const modelStyles = {
            CT10: {
                shell: 'border-cyan-700/60 bg-gradient-to-b from-gray-800 to-gray-950 p-4',
                profileName: 'text-base',
            },
            CK20: {
                shell: 'border-blue-700/60 bg-gradient-to-br from-gray-800 to-slate-950 p-3.5',
                profileName: 'text-sm',
            },
            CK30: {
                shell: 'border-indigo-700/60 bg-gradient-to-r from-gray-900 to-slate-950 p-3',
                profileName: 'text-sm',
            },
        };
        const style = modelStyles[model] || modelStyles.CT10;
        return (
            <div
                className={`h-auto rounded-lg border text-white shadow-lg ${style.shell}`}
                data-kiosk-profile-screen={model}
                data-kiosk-profile-state={uiProfileStatus.state}
            >
                <div className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/45">Profile</p>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${UI_PROFILE_STATUS_CLASSES[uiProfileStatus.state]}`}>
                            {uiProfileStatus.statusLabel}
                        </span>
                    </div>
                    <p className={`mt-0.5 truncate font-bold text-white ${style.profileName}`} title={uiProfileStatus.profileName}>
                        {uiProfileStatus.profileName}
                    </p>
                    <p className="mt-1 text-[10px] text-white/60">{uiProfileStatus.versionLabel}</p>
                    <p className="mt-1 truncate text-[10px] text-white/50" title={uiProfileStatus.updatedAt || 'Update time unknown'}>
                        Updated {uiProfileStatus.updatedLabel}
                    </p>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 border-t border-white/10 pt-2">
                    <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wide text-white/35">UI Mode</p>
                        <p className="truncate text-[11px] font-semibold text-white/80">{kiosk.ui?.mode || '---'}</p>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wide text-white/35">{displayedStateLabel}</p>
                        <p className="truncate text-[11px] font-semibold text-white/80">{displayedState || '---'}</p>
                    </div>
                    <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wide text-white/35">SN</p>
                        <p className="truncate text-[11px] font-semibold text-white/80">{kiosk.hardware?.sn || '---'}</p>
                    </div>
                </div>
            </div>
        );
    };

    const renderCompactTowerHeader = () => {
        return (
            <div className="bg-white p-4 rounded-lg shadow-inner">
                <div className="min-w-0">
                        <div className="flex flex-col gap-2">
                            {(compactHeaderModules.length > 0 ? compactHeaderModules : [{
                                key: stationId || 'placeholder',
                                moduleId: stationId || '---',
                                moduleOnline: false,
                                updateLabel: t('update_module'),
                                firmwareLabel: 'FW ---',
                                fotaVersionLabel: 'FOTA ---',
                                fotaVersionTitle: 'No FOTA version reported',
                                avgChargeRate: '--',
                                etaToReady: '--',
                                wifiStatus: { ssid: '', source: 'unavailable', signalDbm: null },
                            }]).map((module, moduleIndex) => {
                                const isSelected = !hasMultipleModules || moduleIdsMatch(module.moduleId, selectedModule?.id);
                                return (
                                <div
                                    key={module.key}
                                    role={hasMultipleModules ? 'button' : undefined}
                                    tabIndex={hasMultipleModules ? 0 : undefined}
                                    aria-pressed={hasMultipleModules ? isSelected : undefined}
                                    onClick={hasMultipleModules ? () => setSelectedModuleId(module.moduleId) : undefined}
                                    onKeyDown={hasMultipleModules ? (event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setSelectedModuleId(module.moduleId);
                                        }
                                    } : undefined}
                                    className={`flex min-h-[118px] flex-col justify-between rounded-lg border px-3 py-2 shadow-sm sm:min-h-[128px] ${isSelected ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200' : 'border-gray-200 bg-gray-50'} ${hasMultipleModules ? 'cursor-pointer transition hover:border-sky-300 hover:bg-sky-50/60' : ''}`}
                                >
                                    <div className="px-0.5 py-0.5 text-xs">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 truncate font-mono text-xs text-gray-700">{module.moduleId}</div>
                                            {renderModuleQuickActions(module.moduleId)}
                                        </div>
                                        <ModuleWifiStatus moduleId={module.moduleId} status={module.wifiStatus} />
                                        {hasMultipleModules && canUpdateModules && (
                                            <div className="mt-1 flex gap-1">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleMoveModule(module.moduleId, -1);
                                                    }}
                                                    disabled={moduleIndex === 0}
                                                    className="flex h-6 w-7 items-center justify-center rounded border border-gray-200 bg-white text-sm text-gray-600 hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-30"
                                                    title={`Move ${module.moduleId} up`}
                                                    aria-label={`Move ${module.moduleId} up`}
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleMoveModule(module.moduleId, 1);
                                                    }}
                                                    disabled={moduleIndex === compactHeaderModules.length - 1}
                                                    className="flex h-6 w-7 items-center justify-center rounded border border-gray-200 bg-white text-sm text-gray-600 hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-30"
                                                    title={`Move ${module.moduleId} down`}
                                                    aria-label={`Move ${module.moduleId} down`}
                                                >
                                                    ↓
                                                </button>
                                            </div>
                                        )}
                                        {showModuleFirmwareMetadata && (
                                            <>
                                                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-gray-500">
                                                    <span>{module.firmwareLabel}</span>
                                                </div>
                                                <div
                                                    className="mt-1 truncate font-mono text-[10px] font-semibold text-emerald-700"
                                                    title={module.fotaVersionTitle}
                                                >
                                                    {module.fotaVersionLabel}
                                                </div>
                                            </>
                                        )}
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="whitespace-nowrap text-gray-500">{t('avg_charge_rate')}</span>
                                            <span className="whitespace-nowrap font-semibold text-gray-700">{module.avgChargeRate}</span>
                                        </div>
                                        <div className="mt-1 flex items-center justify-between gap-3">
                                            <span className="text-gray-500">{t('eta_to_80')}</span>
                                            <span className="font-semibold text-gray-700">{module.etaToReady}</span>
                                        </div>
                                        {canUpdateModules && (
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleModuleUpdate(module.moduleId);
                                                }}
                                                disabled={!module.moduleOnline}
                                                className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                                            >
                                                {module.updateLabel}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                </div>
            </div>
        );
    };

    const renderCT3 = () => {
        return (
            <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
                <div className="w-full flex flex-col gap-3">
                    {renderCompactTowerHeader()}
                    {visibleModules[0] && renderModule(visibleModules[0], { className: 'w-full' })}
                </div>
            </div>
        );
    };

    const slotOrderInCompactGroup = [2, 0, 3, 1];
    const ct8SlotOrder = [3, 2, 1, 0];

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

    const renderCompactGridSlot = (entry, key) => {
        const isCK4xCompactSlot = ['CK40', 'CK48'].includes(kiosk.hardware?.type);

        if (!entry?.slot || !entry?.module) {
            return <div key={key} className={`${isCK4xCompactSlot ? 'min-h-[68px]' : 'min-h-[40px]'} rounded-md border border-gray-300 bg-gray-100`} />;
        }

        const { slot, module, displayPosition } = entry;
        const style = getSlotStyle(slot, module);
        const hasCharger = slotHasDisplayableCharger(slot);
        const isChargeTimedOut = isSlotInChargeTimeout(module, slot, chargeTimeoutNow);
        const canEject = clientInfo.commands.eject;
        const canLock = clientInfo.commands.lock;
        const ejectDisabledReason = !canEject ? 'permission' : !isOnline ? 'offline' : '';
        const lockDisabledReason = !isOnline ? 'offline' : '';

        return (
            <div
                key={key}
                className={`relative ${isCK4xCompactSlot ? 'min-h-[68px]' : 'min-h-[52px]'} rounded-md border p-0.5 text-left transition-colors duration-200 ${style.className} ${style.glow ? 'slot-charging-glow' : ''}`}
                data-kiosk-slot-debug="true"
                data-kiosk-stationid={kiosk.stationid}
                data-kiosk-moduleid={module.id}
                data-kiosk-slotid={slot.position}
            >
                <div className="grid h-full w-full min-w-0 grid-cols-1 rounded-md px-1.5 py-1">
                    <button
                        type="button"
                        data-kiosk-action="compact slot eject"
                        data-kiosk-stationid={kiosk.stationid}
                        data-kiosk-moduleid={module.id}
                        data-kiosk-slotid={slot.position}
                        data-kiosk-disabled-reason={ejectDisabledReason}
                        onClick={(event) => {
                            logKioskInteraction('compact-slot-eject-click-handler', {
                                stationId: kiosk.stationid,
                                moduleId: module.id,
                                slotid: slot.position,
                                displayPosition,
                                canEject,
                                isOnline,
                                hasCharger,
                                disabledReason: ejectDisabledReason,
                            }, event);
                            if (canEject && isOnline) {
                                onSlotClick(kiosk.stationid, module.id, slot.position);
                            }
                        }}
                        disabled={!canEject || !isOnline}
                        className={`grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 text-left disabled:cursor-not-allowed ${isCK4xCompactSlot ? 'min-h-[36px]' : ''}`}
                        title={hasCharger ? `SN ${slot.sn}` : `Slot ${displayPosition || slot.position}`}
                    >
                        <div className="flex min-w-[22px] shrink-0 flex-col items-start justify-start pt-0.5">
                            <span className="text-[10px] font-mono leading-none text-gray-500">
                                {String(displayPosition || slot.position).padStart(2, '0')}
                            </span>
                            <StatusIndicator status={slot.sstat} />
                        </div>
                        <div className="flex min-w-0 items-start justify-end gap-0.5 pt-0.5 text-right">
                            <span className="whitespace-nowrap text-[11px] font-bold leading-none">
                                {hasCharger ? `${slot.batteryLevel}%` : '—'}
                            </span>
                            <ChargeStatusIndicator slot={slot} />
                            {isChargeTimedOut && <ChargeTimeoutIndicator />}
                        </div>
                    </button>
                    {hasCharger && (
                        <button
                            type="button"
                            data-kiosk-action="compact charger link"
                            data-kiosk-stationid={kiosk.stationid}
                            data-kiosk-moduleid={module.id}
                            data-kiosk-slotid={slot.position}
                            onClick={(event) => handleNavigateToCharger(event, slot.sn)}
                            className={`mt-0.5 block w-full min-w-0 truncate text-left font-mono leading-tight text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 ${isCK4xCompactSlot ? 'text-[9px]' : 'pr-5 text-[8px]'}`}
                            title={`${t('chargers_page_title')}: ${slot.sn}`}
                            aria-label={`${t('chargers_page_title')}: ${slot.sn}`}
                        >
                            {slot.sn}
                        </button>
                    )}
                    {!hasCharger && (
                        <span className={`mt-0.5 block w-full font-mono text-[9px] leading-tight text-gray-500 ${isCK4xCompactSlot ? '' : 'pr-5'}`}>
                            {'\u00A0'}
                        </span>
                    )}
                </div>

                {canLock && (
                    <button
                        type="button"
                        data-kiosk-action={slot.isLocked ? 'compact unlock slot' : 'compact lock slot'}
                        data-kiosk-stationid={kiosk.stationid}
                        data-kiosk-moduleid={module.id}
                        data-kiosk-slotid={slot.position}
                        data-kiosk-disabled-reason={lockDisabledReason}
                        onClick={(event) => {
                            event.stopPropagation();
                            logKioskInteraction('compact-slot-lock-click-handler', {
                                stationId: kiosk.stationid,
                                moduleId: module.id,
                                slotid: slot.position,
                                displayPosition,
                                isCurrentlyLocked: slot.isLocked,
                                isOnline,
                                disabledReason: lockDisabledReason,
                            }, event);
                            onLockSlot(kiosk.stationid, module.id, slot.position, slot.isLocked);
                        }}
                        disabled={!isOnline}
                        className={`absolute right-1 ${isCK4xCompactSlot ? 'top-5' : 'bottom-1'} flex h-[18px] w-[18px] items-center justify-center rounded-md bg-white/75 shadow-sm hover:bg-white disabled:cursor-not-allowed`}
                        title={getLockButtonTitle(slot)}
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

    const renderCompactGroupCard = (slotsByPosition, groupIndex, slotOrder = slotOrderInCompactGroup) => (
        <div key={groupIndex} className="bg-white p-1 rounded-lg shadow-inner">
            <div className="grid grid-cols-2 gap-1">
                {slotOrder.map((slotOffset, index) => {
                    const position = groupIndex * 4 + slotOffset + 1;
                    return renderCompactGridSlot(slotsByPosition.get(position), `${groupIndex}-${index}`);
                })}
            </div>
        </div>
    );

    const renderCompactTower = (minimumGroups) => {
        const { slotsByPosition, maxPosition } = buildCompactSlotMap(visibleModules);
        const groupCount = Math.max(minimumGroups, Math.ceil(maxPosition / 4) || 0);

        return (
            <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
                <div className="w-full max-w-md flex flex-col gap-3">
                    {renderCompactTowerHeader()}

                    <div className="flex flex-col gap-2">
                        {Array.from({ length: groupCount }, (_, groupIndex) => (
                            renderCompactGroupCard(slotsByPosition, groupIndex)
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderCompactPortraitScreen = (label = '16IN') => (
        <div className="overflow-hidden rounded-lg bg-gray-950 shadow-lg ring-1 ring-gray-800">
            <div className="flex w-full flex-col justify-between p-3 text-white" style={{ aspectRatio: '9 / 16' }}>
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50">{label}</p>
                    <p className="mt-1 truncate text-xs font-semibold text-white">{kiosk.ui?.mode || 'MEDIA'}</p>
                </div>
                <div className="space-y-2">
                    <div className="h-1.5 w-2/3 rounded-full bg-white/20" />
                    <div className="h-1.5 w-1/2 rounded-full bg-white/10" />
                    <div className="h-12 rounded-md bg-white/10" />
                </div>
                <div className="text-[10px] font-mono text-white/55">
                    {kiosk.hardware?.sn || kiosk.stationid || '---'}
                </div>
            </div>
        </div>
    );

    const renderMediaPlaybackState = (status = {}) => {
        const state = String(status?.state || 'pending');
        const stateContent = {
            pending: {
                label: 'Awaiting kiosk',
                description: 'The kiosk has not confirmed this media assignment yet.',
                accent: 'bg-amber-400',
                badge: 'bg-amber-400/15 text-amber-200 ring-amber-300/25',
            },
            downloaded: {
                label: 'Downloaded',
                description: 'The files are loaded. Waiting for playback verification.',
                accent: 'bg-sky-400',
                badge: 'bg-sky-400/15 text-sky-200 ring-sky-300/25',
            },
            'out-of-sync': {
                label: 'Out of sync',
                description: 'The assigned dashboard playlist is not active on this screen.',
                accent: 'bg-orange-400',
                badge: 'bg-orange-400/15 text-orange-200 ring-orange-300/25',
            },
            error: {
                label: 'Load error',
                description: 'The kiosk could not load or start the assigned media.',
                accent: 'bg-red-400',
                badge: 'bg-red-400/15 text-red-200 ring-red-300/25',
            },
            offline: {
                label: 'Offline',
                description: 'Playback cannot be confirmed while the kiosk is offline.',
                accent: 'bg-gray-400',
                badge: 'bg-white/10 text-white/70 ring-white/15',
            },
            stale: {
                label: 'Playback stale',
                description: 'The last playback confirmation is too old to trust.',
                accent: 'bg-gray-400',
                badge: 'bg-white/10 text-white/70 ring-white/15',
            },
            cleared: {
                label: 'Cleared',
                description: 'Dashboard media has been removed from this screen.',
                accent: 'bg-gray-400',
                badge: 'bg-white/10 text-white/70 ring-white/15',
            },
            unassigned: {
                label: 'No media assigned',
                description: 'Assign media to this station from the Media page.',
                accent: 'bg-gray-500',
                badge: 'bg-white/10 text-white/70 ring-white/15',
            },
        };
        const content = stateContent[state] || stateContent.pending;

        return (
            <div
                className="flex h-full w-full flex-col items-center justify-center bg-neutral-950 px-5 text-center text-white"
                data-kiosk-media-state={state}
            >
                <span className={`h-2.5 w-2.5 rounded-full ${content.accent}`} aria-hidden="true" />
                <div className={`mt-4 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1 ring-inset ${content.badge}`}>
                    Media state
                </div>
                <p className="mt-3 text-base font-semibold text-white">{content.label}</p>
                <p className="mt-1 max-w-[210px] text-xs leading-relaxed text-white/60">{content.description}</p>
            </div>
        );
    };

    const renderAssignedMediaScreen = () => {
        if (!isVisible) {
            return null;
        }

        if (isCK50Kiosk && v1MediaLoadState === 'loading') {
            return (
                <div
                    className="flex h-full w-full flex-col items-center justify-center bg-neutral-950 px-4 text-center text-white"
                    data-kiosk-media-state="loading"
                >
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/25 border-t-white" aria-hidden="true" />
                    <p className="mt-3 text-xs font-medium text-white/75">Loading screen media…</p>
                </div>
            );
        }

        if (isCK50Kiosk && v1MediaLoadState === 'error') {
            return (
                <div
                    className="flex h-full w-full flex-col items-center justify-center bg-neutral-950 px-4 text-center text-white"
                    data-kiosk-media-state="assignment-error"
                >
                    <p className="text-sm font-medium">Preview unavailable</p>
                    <p className="mt-1 text-xs text-white/60">Unable to load the CK50 media assignment.</p>
                </div>
            );
        }

        if (isCK50Kiosk && !shouldDisplayMediaArtwork) {
            return renderMediaPlaybackState(mediaPlaybackStatus);
        }

        if (!primaryMediaAsset) {
            return (
                <div className="flex h-full w-full flex-col items-center justify-center bg-neutral-950 px-4 text-center text-white">
                    <div className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                        Screen Preview
                    </div>
                    <p className="mt-3 text-sm font-medium text-white">No media assigned</p>
                    <p className="mt-1 text-xs text-white/60">Assign media to this station to preview the screen.</p>
                </div>
            );
        }

        if (primaryMediaAsset.previewKind === 'image') {
            return (
                <img
                    src={primaryMediaAsset.downloadUrl}
                    alt={primaryMediaAsset.name || `${stationId} assigned media`}
                    className="h-full w-full object-contain"
                    loading="lazy"
                    data-kiosk-media-playing="true"
                />
            );
        }

        if (primaryMediaAsset.previewKind === 'video') {
            return (
                <video
                    src={primaryMediaAsset.downloadUrl}
                    className="h-full w-full object-contain"
                    autoPlay
                    muted
                    playsInline
                    loop={mediaPlaylist.length === 1}
                    onEnded={mediaPlaylist.length > 1 ? advanceMediaPreview : undefined}
                    controls
                    preload="metadata"
                    data-kiosk-media-playing="true"
                />
            );
        }

        if (primaryMediaAsset.previewKind === 'pdf') {
            return (
                <div className="flex h-full w-full flex-col items-center justify-center bg-red-50 px-4 text-center">
                    <div className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                        PDF
                    </div>
                    <p className="mt-3 text-sm font-medium text-gray-800">{primaryMediaAsset.name || 'Assigned PDF'}</p>
                    <p className="mt-1 text-xs text-gray-500">PDF assigned to this station.</p>
                </div>
            );
        }

        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-100 px-4 text-center text-sm text-gray-500">
                Preview unavailable for this media type.
            </div>
        );
    };

    const renderCT8 = () => {
        const { slotsByPosition } = buildCompactSlotMap(visibleModules);

        return (
            <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
                <div className="w-full max-w-lg space-y-3">
                    {renderCompactTowerHeader()}
                    <div className="grid grid-cols-[minmax(92px,126px)_minmax(210px,1fr)] items-stretch gap-2 sm:grid-cols-[minmax(92px,126px)_minmax(210px,1fr)]">
                        {renderCompactPortraitScreen('16IN')}
                        <div className="flex h-full flex-col justify-between gap-2">
                            {[0, 1].map((groupIndex) => (
                                renderCompactGroupCard(slotsByPosition, groupIndex, ct8SlotOrder)
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderCK24 = () => {
        // CK24 uses the same six 2×2 module placements as the right column of CK48.
        // Its flat slot positions 1–24 map to logical module indices 0–5.
        const { slotsByPosition } = buildCompactSlotMap(visibleModules);
        const rightColumnIndices = [0, 1, 2, 3, 4, 5];

        return (
            <div className="p-1.5 flex flex-col items-center gap-2.5">
                <div className="w-full max-w-lg space-y-2.5">
                    {renderCompactTowerHeader()}

                    <div className="w-full overflow-hidden rounded-lg bg-black shadow-lg">
                        <div className="w-full" style={{ aspectRatio: '9 / 16' }}>
                            {renderAssignedMediaScreen()}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        {rightColumnIndices.map((groupIndex) => (
                            renderCompactGroupCard(slotsByPosition, groupIndex)
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderCK4xScreen = () => (
        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-lg bg-black shadow-lg">
            <div className="w-full" style={{ aspectRatio: '9 / 16' }}>
                {renderAssignedMediaScreen()}
            </div>
        </div>
    );

    const renderCK40 = () => {
        // CK40 keeps CK48's 2-column body and in-group slot order. Positions
        // 1-24 run down the left; the upper two groups on the right are physically
        // absent, then positions 25-40 continue down the remaining right groups.
        const { slotsByPosition } = buildCompactSlotMap(visibleModules);
        const groupRows = [
            [0, null],
            [1, null],
            [2, 6],
            [3, 7],
            [4, 8],
            [5, 9],
        ];

        return (
            <div className="p-1.5 flex flex-col items-center gap-2.5">
                <div className="w-full space-y-2.5">
                    {renderCompactTowerHeader()}
                    {renderCK4xScreen()}

                    <div className="grid w-full grid-cols-2 gap-x-3 gap-y-2">
                        {groupRows.flatMap(([leftGroupIndex, rightGroupIndex], rowIndex) => [
                            renderCompactGroupCard(slotsByPosition, leftGroupIndex),
                            rightGroupIndex === null ? (
                                <div
                                    key={`ck40-missing-right-${rowIndex}`}
                                    aria-hidden="true"
                                    data-kiosk-ck40-missing-group="true"
                                />
                            ) : renderCompactGroupCard(slotsByPosition, rightGroupIndex),
                        ])}
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
        const { slotsByPosition } = buildCompactSlotMap(visibleModules);
        const leftColumnIndices = [6, 7, 8, 9, 10, 11];
        const rightColumnIndices = [0, 1, 2, 3, 4, 5];

        return (
            <div className="p-1.5 flex flex-col items-center gap-2.5">
                <div className="w-full space-y-2.5">
                    {renderCompactTowerHeader()}

                    {renderCK4xScreen()}

                    <div className="grid w-full grid-cols-2 gap-3">
                        <div className="flex min-w-0 flex-col gap-2">
                            {leftColumnIndices.map((groupIndex) => (
                                renderCompactGroupCard(slotsByPosition, groupIndex)
                            ))}
                        </div>
                        <div className="flex min-w-0 flex-col gap-2">
                            {rightColumnIndices.map((groupIndex) => (
                                renderCompactGroupCard(slotsByPosition, groupIndex)
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
                    {visibleModules[0] && renderModule(visibleModules[0])}
                    {renderPaymentTerminal('CT10')}
                </div>
            </div>
        );
    };

    const renderCK20 = () => {
        return (
        <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
            <div className="w-full flex flex-col gap-3">
                {renderPaymentTerminal('CK20')}
                {visibleModules.map((module) => renderModule(module, { reverseOrder: true }))}
            </div>
        </div>
    )};
    
    const renderCK30 = () => {
        return (
        <div className="p-2 flex flex-col items-center max-h-[60vh] md:max-h-none overflow-y-auto">
            <div className="w-full flex flex-col gap-3">
                {visibleModules[0] && renderModule(visibleModules[0], { reverseOrder: true })}
                {renderPaymentTerminal('CK30')}
                {visibleModules.slice(1).map((module) => renderModule(module, { reverseOrder: true }))}
            </div>
        </div>
    )};

    const renderCK50 = () => {
        const screenMediaLabel = v1MediaLoadState === 'loading'
            ? 'Loading…'
            : v1MediaLoadState === 'error'
                ? 'Preview unavailable'
                : shouldDisplayMediaArtwork
                    ? (primaryMediaAsset?.name || 'Playing')
                    : (mediaPlaybackStatus?.label || 'Awaiting kiosk');
        const screenMediaTitle = shouldDisplayMediaArtwork
            ? (primaryMediaAsset?.name || 'Playing dashboard media')
            : (mediaPlaybackStatus?.error || mediaPlaybackStatus?.label || 'Awaiting kiosk confirmation');
        const ck50TerminalState = kiosk.activity?.terminal?.currentState || kiosk.terminalState || kiosk.uistate || '---';

        return (
            <div className="flex max-h-[60vh] flex-col items-center gap-3 overflow-y-auto p-2 pb-4">
                <div className="w-full space-y-2.5">
                    <div
                        className="mx-auto w-full max-w-[280px] overflow-hidden rounded-xl bg-black shadow-lg ring-4 ring-gray-700"
                        data-kiosk-ck50-screen-preview="true"
                    >
                        <div className="w-full" style={{ aspectRatio: '9 / 16' }}>
                            {renderAssignedMediaScreen()}
                        </div>
                    </div>

                    <div className="flex items-start justify-between gap-2 rounded-lg bg-gray-900 px-3 py-2 text-white">
                        <div className="min-w-0">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/50">Screen media</p>
                            <p className="truncate text-xs font-semibold" title={screenMediaTitle}>
                                {screenMediaLabel}
                            </p>
                        </div>
                        {shouldDisplayMediaArtwork && mediaPlaylist.length > 1 && (
                            <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold text-white/70">
                                {(activeMediaIndex % mediaPlaylist.length) + 1}/{mediaPlaylist.length}
                            </span>
                        )}
                    </div>

                    <div
                        className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white shadow-inner"
                        data-kiosk-ck50-profile-summary="true"
                        data-kiosk-profile-state={uiProfileStatus.state}
                    >
                        <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/45">Profile</p>
                                <p className="truncate text-xs font-bold text-white" title={uiProfileStatus.profileName}>
                                    {uiProfileStatus.profileName}
                                </p>
                                <p className="mt-0.5 text-[9px] text-white/50">{uiProfileStatus.versionLabel}</p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${UI_PROFILE_STATUS_CLASSES[uiProfileStatus.state]}`}>
                                {uiProfileStatus.statusLabel}
                            </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-3 border-t border-white/10 pt-2">
                            <div className="min-w-0">
                                <p className="text-[9px] uppercase tracking-wide text-white/35">UI Mode</p>
                                <p className="truncate text-[11px] font-semibold text-white/80">{kiosk.ui?.mode || '---'}</p>
                            </div>
                            <div className="min-w-0">
                                <p className="text-[9px] uppercase tracking-wide text-white/35">Terminal State</p>
                                <p className="truncate text-[11px] font-semibold text-white/80" title={String(ck50TerminalState)}>
                                    {ck50TerminalState}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid w-full grid-cols-2 gap-2" data-kiosk-ck50-modules="all">
                        {visibleModules.slice(0, 2).reverse().map((module) => renderModule(module, { reverseOrder: true }))}
                    </div>
                    <div className="grid w-full grid-cols-3 gap-2" data-kiosk-ck50-modules="all">
                        {visibleModules.slice(2, 5).map((module) => renderModule(module, { reverseOrder: true }))}
                    </div>
                </div>
            </div>
        );
    };

    const renderContent = () => {
        switch (hardwareType) {
            case 'CTF7':
                return <Ctf7ModulePanel modules={visibleModules} />;
            case 'CT3':
                return renderCT3();
            case 'CT4':
                return renderCompactTower(1);
            case 'CT8':
                return renderCT8();
            case 'CT12':
                return renderCompactTower(3);
            case 'CT10':
                return renderCT10();
            case 'CK20':
                return renderCK20();
            case 'CK30':
                return renderCK30();
            case 'CK24':
                return renderCK24();
            case 'CK40':
                return renderCK40();
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
            <div
                className={`detail-panel-enter ${isVisible ? 'detail-panel-enter-active' : ''}`}
                data-kiosk-detail-panel="true"
                data-kiosk-stationid={stationId}
            >
            <div className="flex flex-col gap-2 p-2 bg-gray-100 rounded-b-lg border-t border-gray-200">
                {hasAnyCommands && (
                    <div className="w-full">
                        <KioskControlPanel kiosk={kiosk} t={t} onCommand={onCommand} serverUiVersion={serverUiVersion} serverFlowVersion={serverFlowVersion} clientInfo={clientInfo} isOnline={isOnline} disabled={!isOnline} />
                    </div>
                )}
                {showModuleIdCards && (
                    <div className="w-full rounded-lg bg-white shadow-sm">
                        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">
                            <span>{t('module_view')}:</span>
                        </div>
                        <div className="flex flex-wrap gap-2 px-4 py-3">
                            {moduleEntries.map((entry, moduleIndex) => (
                                canUpdateModules ? (
                                    <div
                                        key={entry.moduleId}
                                        role={hasMultipleModules ? 'button' : undefined}
                                        tabIndex={hasMultipleModules ? 0 : undefined}
                                        aria-pressed={hasMultipleModules ? moduleIdsMatch(entry.moduleId, selectedModule?.id) : undefined}
                                        onClick={hasMultipleModules ? () => setSelectedModuleId(entry.moduleId) : undefined}
                                        onKeyDown={hasMultipleModules ? (event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setSelectedModuleId(entry.moduleId);
                                            }
                                        } : undefined}
                                        className={`flex min-w-[122px] flex-col gap-2 rounded-md border px-3 py-2 ${moduleIdsMatch(entry.moduleId, selectedModule?.id) ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200' : 'border-transparent bg-gray-100'} ${hasMultipleModules ? 'cursor-pointer transition hover:border-sky-300 hover:bg-sky-50/60' : ''}`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="min-w-0 truncate font-mono text-xs text-gray-700">{entry.moduleId}</span>
                                            {renderModuleQuickActions(entry.moduleId)}
                                        </div>
                                        <ModuleWifiStatus moduleId={entry.moduleId} status={entry.wifiStatus} />
                                        {hasMultipleModules && (
                                            <div className="flex gap-1">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleMoveModule(entry.moduleId, -1);
                                                    }}
                                                    disabled={moduleIndex === 0}
                                                    className="flex h-6 w-7 items-center justify-center rounded border border-gray-200 bg-white text-sm text-gray-600 hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-30"
                                                    title={`Move ${entry.moduleId} up`}
                                                    aria-label={`Move ${entry.moduleId} up`}
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleMoveModule(entry.moduleId, 1);
                                                    }}
                                                    disabled={moduleIndex === moduleEntries.length - 1}
                                                    className="flex h-6 w-7 items-center justify-center rounded border border-gray-200 bg-white text-sm text-gray-600 hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-30"
                                                    title={`Move ${entry.moduleId} down`}
                                                    aria-label={`Move ${entry.moduleId} down`}
                                                >
                                                    ↓
                                                </button>
                                            </div>
                                        )}
                                        {showModuleFirmwareMetadata && (
                                            <>
                                                <span className="font-mono text-[10px] text-gray-500">
                                                    {entry.firmwareLabel}
                                                </span>
                                                <span
                                                    className="max-w-[160px] truncate font-mono text-[10px] font-semibold text-emerald-700"
                                                    title={entry.fotaVersionTitle}
                                                >
                                                    {entry.fotaVersionLabel}
                                                </span>
                                            </>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleModuleUpdate(entry.moduleId);
                                            }}
                                            disabled={!entry.moduleOnline}
                                            className="inline-flex items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-400"
                                        >
                                            {entry.updateLabel}
                                        </button>
                                    </div>
                                ) : (
                                    <div
                                        key={entry.moduleId}
                                        role={hasMultipleModules ? 'button' : undefined}
                                        tabIndex={hasMultipleModules ? 0 : undefined}
                                        onClick={hasMultipleModules ? () => setSelectedModuleId(entry.moduleId) : undefined}
                                        onKeyDown={hasMultipleModules ? (event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setSelectedModuleId(entry.moduleId);
                                            }
                                        } : undefined}
                                        aria-pressed={hasMultipleModules ? moduleIdsMatch(entry.moduleId, selectedModule?.id) : undefined}
                                        className={`flex min-w-[122px] flex-col rounded border px-2 py-1 text-left font-mono text-xs text-gray-700 ${moduleIdsMatch(entry.moduleId, selectedModule?.id) ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200' : 'border-transparent bg-gray-200'} ${hasMultipleModules ? 'cursor-pointer transition hover:border-sky-300 hover:bg-sky-50/60' : ''}`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="min-w-0 truncate">{entry.moduleId}</span>
                                            {renderModuleQuickActions(entry.moduleId)}
                                        </div>
                                        <ModuleWifiStatus moduleId={entry.moduleId} status={entry.wifiStatus} />
                                        {showModuleFirmwareMetadata && (
                                            <>
                                                <span className="text-[10px] text-gray-500">{entry.firmwareLabel}</span>
                                                <span className="max-w-[160px] truncate text-[10px] font-semibold text-emerald-700" title={entry.fotaVersionTitle}>
                                                    {entry.fotaVersionLabel}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                )
                            ))}
                        </div>
                    </div>
                )}
                <div className="w-full">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

export default memo(KioskDetailPanel);
