import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    collection,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    startAfter,
    where,
} from 'firebase/firestore';
import { ArrowLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { db } from '../firebase-config';
import { formatDateTime } from '../utils/dateFormatter';
import { VERSION as DASHBOARD_VERSION } from '../version';

const PAGE_SIZE = 30;
const FILTERS = [
    ['all', 'All activity'],
    ['errors', 'Errors'],
    ['connectivity', 'Connectivity'],
    ['module', 'Modules'],
    ['interaction', 'Interactions'],
    ['terminal', 'Terminal'],
    ['admin', 'Admin'],
];

const SEVERITY_STYLES = {
    critical: 'border-red-300 bg-red-50 text-red-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-slate-200 bg-white text-slate-700',
};

const eventTime = (event) => (
    event?.occurredAt?.toDate?.() ||
    event?.openedAt?.toDate?.() ||
    event?.updatedAt?.toDate?.() ||
    event?.occurredAt ||
    null
);

const eventTimeLabel = (event) => {
    const value = eventTime(event);
    if (!value) return 'Time unavailable';
    const normalized = value instanceof Date ? value.toISOString() : String(value);
    return formatDateTime(normalized);
};

const formatDuration = (durationMs) => {
    const totalMinutes = Math.max(0, Math.floor(Number(durationMs || 0) / 60000));
    if (totalMinutes < 60) return `${totalMinutes}m`;
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
};

const matchesFilter = (event, filter) => {
    if (filter === 'all') return true;
    if (filter === 'errors') return ['warning', 'error', 'critical'].includes(event.severity);
    return event.category === filter;
};

function ActivityRow({ event, open = false, onSelectStation }) {
    const style = SEVERITY_STYLES[event.severity] || SEVERITY_STYLES.info;

    return (
        <article className={`rounded-lg border p-3 sm:p-4 ${style}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <button
                        type="button"
                        className="text-xs font-bold uppercase tracking-wide hover:underline"
                        onClick={() => onSelectStation(event.stationId)}
                    >
                        {event.stationId || 'Unknown kiosk'}
                    </button>
                    <p className="mt-1 text-sm font-semibold leading-5">{event.summary || event.type}</p>
                </div>
                <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 font-mono text-[10px] font-bold uppercase">
                    {open ? 'Open' : event.severity || 'Info'}
                </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] opacity-75">
                <span>{eventTimeLabel(event)}</span>
                {event.moduleId && <span>Module {event.moduleId}</span>}
                {event.page && <span>Screen: {event.page}</span>}
                {event.terminalState && <span>{event.terminalState.replaceAll('_', ' ')}</span>}
                {event.durationMs > 0 && <span>{formatDuration(event.durationMs)}</span>}
            </div>
        </article>
    );
}

export default function ActivityPage({
    onLogout,
    onNavigateToDashboard,
    allStationsData = [],
    initialStationId = '',
    onStationChange,
}) {
    const [selectedStation, setSelectedStation] = useState(initialStationId);
    const [stationInput, setStationInput] = useState(initialStationId);
    const [filter, setFilter] = useState('all');
    const [incidents, setIncidents] = useState([]);
    const [events, setEvents] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');

    const allowedStationKey = allStationsData
        .map((station) => String(station.stationid || '').trim())
        .filter(Boolean)
        .sort()
        .join('\u0000');
    const allowedStationIds = useMemo(() => new Set(
        allowedStationKey ? allowedStationKey.split('\u0000') : []
    ), [allowedStationKey]);
    const stationOptions = useMemo(() => [...allowedStationIds].sort(), [allowedStationIds]);

    const selectStation = useCallback((stationId = '') => {
        const normalized = String(stationId || '').trim().toUpperCase();
        setSelectedStation(normalized);
        setStationInput(normalized);
        onStationChange(normalized);
    }, [onStationChange]);

    useEffect(() => {
        setSelectedStation(initialStationId);
        setStationInput(initialStationId);
    }, [initialStationId]);

    useEffect(() => {
        const incidentsQuery = query(
            collection(db, 'kioskIncidents'),
            where('state', '==', 'open'),
        );
        return onSnapshot(incidentsQuery, (snapshot) => {
            setIncidents(snapshot.docs
                .map((document) => ({ id: document.id, ...document.data() }))
                .filter((incident) => allowedStationIds.has(incident.stationId)));
        }, (snapshotError) => {
            console.error('Unable to load open kiosk incidents', snapshotError);
            setError('Open incidents are temporarily unavailable.');
        });
    }, [allowedStationIds]);

    const loadEvents = useCallback(async ({ append = false, after = null } = {}) => {
        append ? setLoadingMore(true) : setLoading(true);
        setError('');
        try {
            const constraints = [];
            if (selectedStation) constraints.push(where('stationId', '==', selectedStation));
            constraints.push(orderBy('occurredAt', 'desc'));
            if (after) constraints.push(startAfter(after));
            constraints.push(limit(PAGE_SIZE));
            const snapshot = await getDocs(query(collection(db, 'kioskEvents'), ...constraints));
            const nextEvents = snapshot.docs
                .map((document) => ({ id: document.id, ...document.data() }))
                .filter((event) => allowedStationIds.has(event.stationId));
            setEvents((previous) => append ? [...previous, ...nextEvents] : nextEvents);
            setCursor(snapshot.docs.at(-1) || null);
            setHasMore(snapshot.size === PAGE_SIZE);
        } catch (loadError) {
            console.error('Unable to load kiosk activity history', loadError);
            setError('Activity history is temporarily unavailable.');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [allowedStationIds, selectedStation]);

    useEffect(() => {
        setEvents([]);
        setCursor(null);
        loadEvents();
    }, [loadEvents]);

    const visibleIncidents = useMemo(() => incidents
        .filter((incident) => !selectedStation || incident.stationId === selectedStation)
        .sort((left, right) => Number(eventTime(right)) - Number(eventTime(left))), [incidents, selectedStation]);
    const visibleEvents = useMemo(() => events.filter((event) => matchesFilter(event, filter)), [events, filter]);

    const handleStationSubmit = (event) => {
        event.preventDefault();
        selectStation(stationInput);
    };

    return (
        <div className="min-h-screen bg-slate-100 text-slate-900">
            <header className="sticky top-0 z-20 border-b bg-white/95 shadow-sm backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-3 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <button type="button" onClick={onNavigateToDashboard} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Back to dashboard">
                            <ArrowLeftIcon className="h-5 w-5" />
                        </button>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-bold sm:text-xl">Kiosk activity</h1>
                            <p className="hidden text-xs text-slate-500 sm:block">Operational incidents and non-rental events</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="hidden rounded bg-slate-100 px-2 py-1 text-xs text-slate-500 sm:inline">v{DASHBOARD_VERSION}</span>
                        <button type="button" onClick={onLogout} className="rounded-md bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600">Logout</button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl space-y-5 px-3 py-5 sm:px-6">
                <section className="rounded-xl bg-white p-3 shadow-sm sm:p-4">
                    <form onSubmit={handleStationSubmit} className="flex flex-col gap-2 sm:flex-row">
                        <label className="sr-only" htmlFor="activity-station">Kiosk ID</label>
                        <input
                            id="activity-station"
                            list="activity-stations"
                            value={stationInput}
                            onChange={(event) => setStationInput(event.target.value)}
                            placeholder="Search kiosk ID"
                            className="min-h-11 flex-1 rounded-md border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <datalist id="activity-stations">
                            {stationOptions.map((stationId) => <option key={stationId} value={stationId} />)}
                        </datalist>
                        <div className="flex gap-2">
                            <button type="submit" className="min-h-11 flex-1 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 sm:flex-none">View kiosk</button>
                            {selectedStation && (
                                <button type="button" onClick={() => selectStation('')} className="min-h-11 flex-1 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:flex-none">All kiosks</button>
                            )}
                        </div>
                    </form>
                </section>

                <section>
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="flex items-center gap-2 text-base font-bold">
                            <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                            Open incidents
                        </h2>
                        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">{visibleIncidents.length}</span>
                    </div>
                    {visibleIncidents.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-2">
                            {visibleIncidents.map((incident) => <ActivityRow key={incident.id} event={incident} open onSelectStation={selectStation} />)}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">No open incidents in this view.</div>
                    )}
                </section>

                <section>
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-base font-bold">Activity history{selectedStation ? ` · ${selectedStation}` : ''}</h2>
                        <div className="flex gap-1 overflow-x-auto pb-1">
                            {FILTERS.map(([value, label]) => (
                                <button key={value} type="button" onClick={() => setFilter(value)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${filter === value ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-200'}`}>{label}</button>
                            ))}
                        </div>
                    </div>
                    {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                    {loading ? (
                        <p className="rounded-lg bg-white p-6 text-center text-sm text-slate-500">Loading activity…</p>
                    ) : visibleEvents.length > 0 ? (
                        <div className="space-y-3">
                            {visibleEvents.map((event) => <ActivityRow key={event.id} event={event} onSelectStation={selectStation} />)}
                        </div>
                    ) : (
                        <p className="rounded-lg bg-white p-6 text-center text-sm text-slate-500">No matching activity recorded.</p>
                    )}
                    {hasMore && !loading && (
                        <div className="mt-4 flex justify-center">
                            <button type="button" disabled={loadingMore} onClick={() => loadEvents({ append: true, after: cursor })} className="min-h-11 rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                {loadingMore ? 'Loading…' : 'Load more'}
                            </button>
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}
