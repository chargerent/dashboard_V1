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
    const connections = useMemo(() => (
        [
            ...connectedKiosks.map((kiosk) => ({ type: 'ssh', kiosk })),
            ...connectedNgrokKiosks.map((kiosk) => ({ type: 'ngrok', kiosk })),
        ].sort((left, right) => (
            String(left.kiosk.stationid).localeCompare(String(right.kiosk.stationid)) ||
            left.type.localeCompare(right.type)
        ))
    ), [connectedKiosks, connectedNgrokKiosks]);

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
                    <h2 id="remote-connectivity-heading" className="text-base font-bold text-slate-900">Remote Connections</h2>
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

            {connections.length === 0 ? (
                <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-600">No active remote connections.</p>
            ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {connections.map(({ type, kiosk }) => {
                        const isSsh = type === 'ssh';
                        const status = isSsh
                            ? statusByStation?.[kiosk.stationid]
                            : ngrokStatusByStation?.[kiosk.stationid];
                        const activeCount = Number(isSsh ? status?.activeSessions || 0 : status?.activeConnections || 0);
                        const recentRequestRate = Number(status?.recentRequestRate || 0);
                        const hasFreshStatus = Boolean(status?.checkedAt);
                        const isInUse = hasFreshStatus && activeCount > 0;
                        const hasRecentTraffic = !isSsh && hasFreshStatus && !isInUse && recentRequestRate > 0;
                        const usageLabel = !hasFreshStatus
                            ? 'Checking…'
                            : isInUse
                                ? `${activeCount} ${isSsh ? 'session' : 'connection'}${activeCount === 1 ? '' : 's'} in use`
                                : hasRecentTraffic
                                    ? 'Recent traffic'
                                    : 'Idle';
                        const needsWarning = isInUse || hasRecentTraffic;
                        const disconnect = isSsh ? onDisconnect : onDisconnectNgrok;

                        return (
                            <button
                                type="button"
                                key={`${type}-${kiosk.stationid}`}
                                data-testid={`${type}-connectivity-row-${kiosk.stationid}`}
                                onClick={() => disconnect(kiosk)}
                                aria-label={`Disconnect ${isSsh ? 'SSH' : 'Ngrok'} connection for ${kiosk.stationid}`}
                                className={`group min-w-0 rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                                    needsWarning
                                        ? 'border-amber-200 bg-amber-50 hover:border-amber-300 hover:bg-amber-100 focus:ring-amber-500'
                                        : 'border-slate-200 bg-white hover:border-red-300 hover:bg-red-50 focus:ring-red-500'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-base font-bold text-slate-900">{kiosk.stationid}</span>
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                                                isSsh ? 'bg-violet-100 text-violet-800' : 'bg-cyan-100 text-cyan-800'
                                            }`}>
                                                {isSsh ? 'SSH' : 'Ngrok'}
                                            </span>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Connected</span>
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                !hasFreshStatus
                                                    ? 'bg-slate-100 text-slate-600'
                                                    : needsWarning
                                                        ? 'bg-amber-100 text-amber-800'
                                                        : 'bg-blue-100 text-blue-800'
                                            }`}>
                                                {usageLabel}
                                            </span>
                                        </div>
                                    </div>
                                    <span className={`shrink-0 text-xs font-bold ${needsWarning ? 'text-amber-700' : 'text-red-600'} group-hover:underline`}>
                                        {needsWarning ? 'Force disconnect' : 'Disconnect'}
                                    </span>
                                </div>
                                <p className="mt-3 truncate text-xs text-slate-500">
                                    {formatCheckedAt(status?.checkedAt)}
                                    {!isSsh && status?.publicUrl ? ` · ${status.publicUrl}` : ''}
                                </p>
                            </button>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
