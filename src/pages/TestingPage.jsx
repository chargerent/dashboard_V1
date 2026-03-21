/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import KioskPanel from '../components/kiosk/kioskPanel';
import KioskDetailPanel from '../components/kiosk/KioskDetailPanel';
import KioskEditPanel from '../components/kiosk/KioskEditPanel';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import NgrokModal from '../components/UI/NgrokModal';
import LoadingSpinner from '../components/UI/LoadingSpinner';
import TimeoutWarningModal from '../components/UI/TimeoutWarningModal';
import CommandStatusToast from '../components/UI/CommandStatusToast';
import RentalDetailView from '../components/Dashboard/RentalDetailView';
import { filterStationsForClient } from '../utils/helpers';
import { normalizeStationId, parseStationQrInput } from '../utils/stationQr';
import useKioskCommandFlow from '../hooks/useKioskCommandFlow';
import { useIdleTimer } from '../hooks/useIdleTimer';

const CAMERA_SCAN_INTERVAL_MS = 250;

function getScannerErrorMessage(error, t) {
    const errorName = String(error?.name || '');

    if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        return t('testing_camera_permission_denied');
    }

    if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        return t('testing_camera_no_device');
    }

    if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        return t('testing_camera_busy');
    }

    return t('testing_camera_error');
}

export default function TestingPage({
    onLogout,
    onNavigateToDashboard,
    clientInfo,
    t,
    language,
    setLanguage,
    rentalData,
    allStationsData,
    onCommand,
    commandStatus,
    setCommandStatus,
    firestoreError,
    serverFlowVersion,
    serverUiVersion,
    pendingSlots,
    ejectingSlots,
    setEjectingSlots,
    failedEjectSlots,
    lockingSlots,
    manageIgnoredKiosk,
    ngrokModalOpen,
    setNgrokModalOpen,
    ngrokInfo,
    kiosksReady,
}) {
    const [stationInput, setStationInput] = useState('');
    const [loadedStationId, setLoadedStationId] = useState('');
    const [pageError, setPageError] = useState('');
    const [cameraError, setCameraError] = useState('');
    const [scannerActive, setScannerActive] = useState(false);
    const [startingScanner, setStartingScanner] = useState(false);
    const [showStationDetails, setShowStationDetails] = useState(true);
    const [editingKioskId, setEditingKioskId] = useState(null);
    const [rentalDetailView, setRentalDetailView] = useState(null);

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const detectorRef = useRef(null);
    const scanTimerRef = useRef(null);

    const { showWarning, handleStay } = useIdleTimer({ onLogout, idleTimeout: 540000, warningTimeout: 60000 });
    const visibleStations = useMemo(() => filterStationsForClient(allStationsData, clientInfo), [allStationsData, clientInfo]);
    const selectedKiosk = useMemo(() => {
        if (!loadedStationId) {
            return null;
        }

        return visibleStations.find((station) => normalizeStationId(station.stationid) === loadedStationId) || null;
    }, [loadedStationId, visibleStations]);

    const latestTimestamp = useMemo(() => {
        if (!allStationsData?.length) {
            return new Date().toISOString();
        }

        const latestStation = allStationsData.reduce((latest, current) => {
            if (!current?.lastUpdated) return latest;
            if (!latest?.lastUpdated) return current;

            const latestDate = new Date(latest.lastUpdated.endsWith('Z') ? latest.lastUpdated : `${latest.lastUpdated}Z`);
            const currentDate = new Date(current.lastUpdated.endsWith('Z') ? current.lastUpdated : `${current.lastUpdated}Z`);
            return currentDate > latestDate ? current : latest;
        }, null);

        return latestStation?.lastUpdated || new Date().toISOString();
    }, [allStationsData]);

    const {
        commandDetails,
        commandModalOpen,
        setCommandModalOpen,
        handleGeneralCommand,
        handleKioskSave,
        handleLockSlotClick,
        handleSendCommand,
        handleSlotClick,
    } = useKioskCommandFlow({
        allStationsData,
        setEjectingSlots,
        manageIgnoredKiosk,
        onCommand,
        t,
    });

    const stopScanner = useCallback(() => {
        if (scanTimerRef.current) {
            window.clearTimeout(scanTimerRef.current);
            scanTimerRef.current = null;
        }

        const stream = streamRef.current;
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        detectorRef.current = null;
        setScannerActive(false);
        setStartingScanner(false);
    }, []);

    const attachStreamToVideo = useCallback(async (stream) => {
        const video = videoRef.current;
        if (!video) {
            return;
        }

        if (video.srcObject !== stream) {
            video.srcObject = stream;
        }

        await video.play();
    }, []);

    const loadStationFromValue = useCallback((rawValue) => {
        const parsedValue = parseStationQrInput(rawValue);

        if (!parsedValue.stationid || (parsedValue.mode !== 'qr' && parsedValue.mode !== 'manual')) {
            setPageError(t('testing_station_qr_invalid'));
            return false;
        }

        setPageError('');
        setCameraError('');
        setStationInput(rawValue);
        setLoadedStationId(parsedValue.stationid);
        setEditingKioskId(null);
        setShowStationDetails(true);
        setRentalDetailView(null);
        return true;
    }, [t]);

    const handleDetectedQrValue = useCallback((rawValue) => {
        const didLoad = loadStationFromValue(rawValue);
        if (didLoad) {
            stopScanner();
        } else {
            setCameraError(t('testing_station_qr_invalid'));
        }
        return didLoad;
    }, [loadStationFromValue, stopScanner, t]);

    const startScanner = useCallback(async () => {
        setCameraError('');
        setPageError('');

        if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            setCameraError(t('testing_camera_secure_context'));
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            setCameraError(t('testing_camera_not_supported'));
            return;
        }

        if (typeof window.BarcodeDetector !== 'function') {
            setCameraError(t('testing_camera_not_supported'));
            return;
        }

        setStartingScanner(true);

        try {
            detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
            });

            streamRef.current = stream;
            setScannerActive(true);
        } catch (error) {
            console.error('Failed to start testing scanner:', error);
            stopScanner();
            setCameraError(getScannerErrorMessage(error, t));
        } finally {
            setStartingScanner(false);
        }
    }, [stopScanner, t]);

    useEffect(() => {
        if (!scannerActive || !streamRef.current) {
            return undefined;
        }

        let cancelled = false;

        attachStreamToVideo(streamRef.current).catch((error) => {
            if (cancelled) {
                return;
            }

            console.error('Failed to attach testing camera preview:', error);
            stopScanner();
            setCameraError(getScannerErrorMessage(error, t));
        });

        return () => {
            cancelled = true;
        };
    }, [attachStreamToVideo, scannerActive, stopScanner, t]);

    useEffect(() => {
        if (!scannerActive || !videoRef.current || !detectorRef.current) {
            return undefined;
        }

        let cancelled = false;

        const scan = async () => {
            if (cancelled) {
                return;
            }

            const video = videoRef.current;
            if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
                scanTimerRef.current = window.setTimeout(scan, CAMERA_SCAN_INTERVAL_MS);
                return;
            }

            try {
                const detections = await detectorRef.current.detect(video);
                const match = detections.find((detection) => detection?.rawValue);

                if (match?.rawValue) {
                    const didLoad = handleDetectedQrValue(match.rawValue);
                    if (didLoad) {
                        return;
                    }
                }
            } catch (error) {
                console.error('Failed while scanning QR code:', error);
                setCameraError(t('testing_camera_scan_error'));
                stopScanner();
                return;
            }

            if (!cancelled) {
                scanTimerRef.current = window.setTimeout(scan, CAMERA_SCAN_INTERVAL_MS);
            }
        };

        scan();

        return () => {
            cancelled = true;
            if (scanTimerRef.current) {
                window.clearTimeout(scanTimerRef.current);
                scanTimerRef.current = null;
            }
        };
    }, [handleDetectedQrValue, scannerActive, stopScanner, t]);

    useEffect(() => {
        return () => {
            stopScanner();
        };
    }, [stopScanner]);

    useEffect(() => {
        if (editingKioskId) {
            manageIgnoredKiosk(editingKioskId, true);
        }

        return () => {
            if (editingKioskId) {
                manageIgnoredKiosk(editingKioskId, false);
            }
        };
    }, [editingKioskId, manageIgnoredKiosk]);

    useEffect(() => {
        if (!loadedStationId || !kiosksReady) {
            return;
        }

        if (selectedKiosk) {
            setPageError('');
            return;
        }

        const stationExists = allStationsData.some((station) => normalizeStationId(station.stationid) === loadedStationId);
        setPageError(stationExists ? t('testing_station_unavailable') : t('testing_station_not_found'));
    }, [allStationsData, kiosksReady, loadedStationId, selectedKiosk, t]);

    const handleSubmit = useCallback((event) => {
        event.preventDefault();
        const didLoad = loadStationFromValue(stationInput);
        if (didLoad) {
            stopScanner();
        }
    }, [loadStationFromValue, stationInput, stopScanner]);

    const handleToggleDetails = useCallback((stationid) => {
        if (normalizeStationId(stationid) !== loadedStationId) {
            return;
        }

        setEditingKioskId(null);
        setRentalDetailView(null);
        setShowStationDetails((prev) => !prev);
    }, [loadedStationId]);

    const handleToggleEditMode = useCallback((stationid) => {
        setRentalDetailView(null);
        setShowStationDetails(true);
        setEditingKioskId((prev) => (prev === stationid ? null : stationid));
    }, []);

    const handleShowRentalDetails = useCallback((kioskId, period) => {
        setEditingKioskId(null);
        setShowStationDetails(true);
        setRentalDetailView((prev) => {
            if (prev?.kioskId === kioskId && prev?.period === period) {
                return null;
            }
            return { kioskId, period };
        });
    }, []);

    return (
        <div className="min-h-screen bg-slate-100">
            <ConfirmationModal
                isOpen={commandModalOpen}
                onClose={() => setCommandModalOpen(false)}
                onConfirm={handleSendCommand}
                details={commandDetails}
                t={t}
            />
            <NgrokModal
                isOpen={ngrokModalOpen}
                onClose={() => setNgrokModalOpen(false)}
                info={ngrokInfo}
                t={t}
            />
            <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus(null)} />
            {showWarning && <TimeoutWarningModal onStay={handleStay} onLogout={onLogout} />}

            <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
                    <button onClick={onNavigateToDashboard} className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700" type="button">
                        {t('back_to_dashboard')}
                    </button>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setLanguage('en')} className={`rounded-md px-2 py-1 text-sm font-bold ${language === 'en' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`} type="button">EN</button>
                        <button onClick={() => setLanguage('fr')} className={`rounded-md px-2 py-1 text-sm font-bold ${language === 'fr' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`} type="button">FR</button>
                        <button onClick={onLogout} className="rounded-full bg-red-500 px-3 py-2 text-sm font-semibold text-white" type="button">
                            {t('logout')}
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
                <section className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl">
                    <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 px-5 py-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-200">{t('testing_page_title')}</p>
                    </div>

                    <div className="space-y-4 px-4 py-4">
                        <button
                            type="button"
                            onClick={scannerActive ? stopScanner : startScanner}
                            disabled={startingScanner}
                            className={`flex w-full items-center justify-center rounded-2xl px-4 py-4 text-base font-semibold transition ${scannerActive ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-blue-500 text-white hover:bg-blue-600'} disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                            {startingScanner
                                ? t('testing_camera_starting')
                                : scannerActive
                                    ? t('testing_stop_camera')
                                    : t('testing_start_camera')}
                        </button>

                        {scannerActive && (
                            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
                                <div className="relative aspect-[3/4] w-full bg-black">
                                    <video
                                        ref={videoRef}
                                        className="h-full w-full object-cover"
                                        autoPlay
                                        muted
                                        playsInline
                                    />
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                        <div className="h-56 w-56 rounded-[2rem] border-2 border-white/80 shadow-[0_0_0_999px_rgba(15,23,42,0.35)]" />
                                    </div>
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-4 pt-12 text-center text-sm text-white">
                                        {t('testing_camera_hint')}
                                    </div>
                                </div>
                            </div>
                        )}

                        {(cameraError || firestoreError) && (
                            <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                                {cameraError || firestoreError}
                            </div>
                        )}
                    </div>
                </section>

                <section className="rounded-3xl bg-white p-4 shadow-md">
                    <form className="space-y-3" onSubmit={handleSubmit}>
                        <div>
                            <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="testing-station-input">
                                {t('testing_station_input_label')}
                            </label>
                            <input
                                id="testing-station-input"
                                value={stationInput}
                                onChange={(event) => setStationInput(event.target.value)}
                                placeholder="https://chargerent.online/stations/qr?id=US8001"
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
                                autoCapitalize="characters"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                            <p className="mt-2 text-xs text-slate-500">{t('testing_station_input_hint')}</p>
                        </div>

                        <div className="flex gap-3">
                            <button type="submit" className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                                {t('testing_load_station')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStationInput('');
                                    setLoadedStationId('');
                                    setPageError('');
                                    setCameraError('');
                                    setEditingKioskId(null);
                                    setRentalDetailView(null);
                                    setShowStationDetails(true);
                                    stopScanner();
                                }}
                                className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                            >
                                {t('close')}
                            </button>
                        </div>
                    </form>
                </section>

                {loadedStationId && (
                    <section className="rounded-3xl bg-white p-4 shadow-md">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t('station_id')}</p>
                                <p className="mt-1 font-mono text-xl font-bold text-slate-900">{loadedStationId}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowStationDetails((prev) => !prev)}
                                className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                            >
                                {showStationDetails ? t('testing_hide_station') : t('testing_show_station')}
                            </button>
                        </div>

                        {pageError && (
                            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                {pageError}
                            </div>
                        )}

                        {!selectedKiosk && !kiosksReady && (
                            <div className="mt-4">
                                <LoadingSpinner t={t} />
                            </div>
                        )}
                    </section>
                )}

                {selectedKiosk && (
                    <section className="space-y-3">
                        <KioskPanel
                            kiosk={selectedKiosk}
                            isExpanded={showStationDetails || editingKioskId === selectedKiosk.stationid}
                            onToggle={handleToggleDetails}
                            onToggleEdit={handleToggleEditMode}
                            mockNow={latestTimestamp}
                            rentalData={rentalData}
                            clientInfo={clientInfo}
                            t={t}
                            onCommand={handleGeneralCommand}
                            onShowRentalDetails={handleShowRentalDetails}
                        />

                        {editingKioskId === selectedKiosk.stationid ? (
                            <KioskEditPanel
                                kiosk={selectedKiosk}
                                onSave={handleKioskSave}
                                onCommand={handleGeneralCommand}
                                clientInfo={clientInfo}
                                t={t}
                                serverUiVersion={serverUiVersion}
                                serverFlowVersion={serverFlowVersion}
                            />
                        ) : (
                            showStationDetails && (
                                <KioskDetailPanel
                                    kiosk={selectedKiosk}
                                    isVisible={true}
                                    onSlotClick={handleSlotClick}
                                    onLockSlot={handleLockSlotClick}
                                    pendingSlots={pendingSlots}
                                    ejectingSlots={ejectingSlots}
                                    failedEjectSlots={failedEjectSlots}
                                    lockingSlots={lockingSlots}
                                    t={t}
                                    onCommand={handleGeneralCommand}
                                    clientInfo={clientInfo}
                                    mockNow={latestTimestamp}
                                    serverFlowVersion={serverFlowVersion}
                                    serverUiVersion={serverUiVersion}
                                />
                            )
                        )}

                        {rentalDetailView?.kioskId === selectedKiosk.stationid && (
                            <RentalDetailView
                                kiosk={selectedKiosk}
                                period={rentalDetailView.period}
                                rentalData={rentalData}
                                onClose={() => setRentalDetailView(null)}
                                onCommand={handleGeneralCommand}
                                t={t}
                            />
                        )}
                    </section>
                )}
            </main>
        </div>
    );
}
