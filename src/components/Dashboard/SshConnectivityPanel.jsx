import { useEffect, useMemo, useRef } from 'react';
import { isKioskActive } from '../../utils/helpers';

function formatCheckedAt(value) {
    const timestamp = Number(value || 0);
    if (!timestamp) return 'Waiting for kiosk response';
    return `Checked ${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

export default function SshConnectivityPanel({
    kiosks,
    statusByStation,
    onRefresh,
    onDisconnect,
    ngrokStatusByStation,
    onRefreshNgrok,
    onDisconnectNgrok,
    referenceTime,
}) {
    const requestedStationsRef = useRef(new Set());
    const requestedNgrokStationsRef = useRef(new Set());
    const connectedKiosks = useMemo(() => (
        (Array.isArray(kiosks) ? kiosks : [])
            .filter((kiosk) => kiosk?.ssh === true && kiosk?.stationid && isKioskActive(kiosk, referenceTime))
            .sort((left, right) => String(left.stationid).localeCompare(String(right.stationid)))
    ), [kiosks, referenceTime]);
    const connectedNgrokKiosks = useMemo(() => (
        (Array.isArray(kiosks) ? kiosks : [])
            .filter((kiosk) => kiosk?.ngrok === true && kiosk?.stationid && isKioskActive(kiosk, referenceTime))
            .sort((left, right) => String(left.stationid).localeCompare(String(right.stationid)))
    ), [kiosks, referenceTime]);

    useEffect(() => {
        const connectedIds = new Set(connectedKiosks.map((kiosk) => kiosk.stationid));

        for (const requestedId of requestedStationsRef.current) {
            if (!connectedIds.has(requestedId)) requestedStationsRef.current.delete(requestedId);
        }

        connectedKiosks.forEach((kiosk) => {
            if (requestedStationsRef.current.has(kiosk.stationid)) return;
            requestedStationsRef.current.add(kiosk.stationid);
            onRefresh(kiosk);
        });
    }, [connectedKiosks, onRefresh]);

    useEffect(() => {
        const connectedIds = new Set(connectedNgrokKiosks.map((kiosk) => kiosk.stationid));

        for (const requestedId of requestedNgrokStationsRef.current) {
            if (!connectedIds.has(requestedId)) requestedNgrokStationsRef.current.delete(requestedId);
        }

        connectedNgrokKiosks.forEach((kiosk) => {
            if (requestedNgrokStationsRef.current.has(kiosk.stationid)) return;
            requestedNgrokStationsRef.current.add(kiosk.stationid);
            onRefreshNgrok(kiosk);
        });
    }, [connectedNgrokKiosks, onRefreshNgrok]);

    return (
        <section
            className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            data-testid="remote-connectivity-panel"
            aria-labelledby="remote-connectivity-heading"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 id="remote-connectivity-heading" className="text-base font-bold text-slate-900">Remote Connectivity</h2>
                    <p className="mt-1 text-sm text-slate-500">Connected SSH and Ngrok tunnels with live usage checks.</p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        connectedKiosks.forEach(onRefresh);
                        connectedNgrokKiosks.forEach(onRefreshNgrok);
                    }}
                    disabled={connectedKiosks.length === 0 && connectedNgrokKiosks.length === 0}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Refresh status
                </button>
            </div>

            <h3 className="mt-4 text-sm font-bold text-slate-800">SSH connections</h3>
            {connectedKiosks.length === 0 ? (
                <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-600">No connected SSH tunnels.</p>
            ) : (
                <div className="mt-4 space-y-2">
                    {connectedKiosks.map((kiosk) => {
                        const status = statusByStation?.[kiosk.stationid];
                        const activeSessions = Number(status?.activeSessions || 0);
                        const hasFreshStatus = Boolean(status?.checkedAt);
                        const isInUse = hasFreshStatus && activeSessions > 0;

                        return (
                            <div
                                key={kiosk.stationid}
                                data-testid={`ssh-connectivity-row-${kiosk.stationid}`}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3"
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-bold text-slate-900">{kiosk.stationid}</span>
                                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Tunnel connected</span>
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                            !hasFreshStatus
                                                ? 'bg-slate-100 text-slate-600'
                                                : isInUse
                                                    ? 'bg-amber-100 text-amber-800'
                                                    : 'bg-blue-100 text-blue-800'
                                        }`}>
                                            {!hasFreshStatus ? 'Checking…' : isInUse ? `${activeSessions} session${activeSessions === 1 ? '' : 's'} in use` : 'Idle'}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">{formatCheckedAt(status?.checkedAt)}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onDisconnect(kiosk)}
                                    className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${isInUse ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'}`}
                                >
                                    {isInUse ? 'Force disconnect' : 'Disconnect'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <h3 className="mt-6 text-sm font-bold text-slate-800">Ngrok connections</h3>
            {connectedNgrokKiosks.length === 0 ? (
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-600">No connected Ngrok tunnels.</p>
            ) : (
                <div className="mt-2 space-y-2">
                    {connectedNgrokKiosks.map((kiosk) => {
                        const status = ngrokStatusByStation?.[kiosk.stationid];
                        const activeConnections = Number(status?.activeConnections || 0);
                        const recentRequestRate = Number(status?.recentRequestRate || 0);
                        const hasFreshStatus = Boolean(status?.checkedAt);
                        const isInUse = hasFreshStatus && activeConnections > 0;
                        const hasRecentTraffic = hasFreshStatus && !isInUse && recentRequestRate > 0;
                        const usageLabel = !hasFreshStatus
                            ? 'Checking…'
                            : isInUse
                                ? `${activeConnections} connection${activeConnections === 1 ? '' : 's'} in use`
                                : hasRecentTraffic
                                    ? 'Recent traffic'
                                    : 'Idle';

                        return (
                            <div
                                key={kiosk.stationid}
                                data-testid={`ngrok-connectivity-row-${kiosk.stationid}`}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3"
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-bold text-slate-900">{kiosk.stationid}</span>
                                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Tunnel connected</span>
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                            !hasFreshStatus
                                                ? 'bg-slate-100 text-slate-600'
                                                : isInUse || hasRecentTraffic
                                                    ? 'bg-amber-100 text-amber-800'
                                                    : 'bg-blue-100 text-blue-800'
                                        }`}>
                                            {usageLabel}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {formatCheckedAt(status?.checkedAt)}
                                        {status?.publicUrl ? ` · ${status.publicUrl}` : ''}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onDisconnectNgrok(kiosk)}
                                    className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${isInUse || hasRecentTraffic ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'}`}
                                >
                                    {isInUse || hasRecentTraffic ? 'Force disconnect' : 'Disconnect'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
