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
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { db } from '../firebase-config';
import { formatDateTime } from '../utils/dateFormatter';

const PAGE_SIZE = 30;
const SEEN_STORAGE_KEY = 'chargerent:kiosk-activity-seen:v1';
const FILTERS = [
    ['all', 'All activity'],
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

const unseenTime = (event) => (
    event?.receivedAt?.toDate?.() ||
    event?.updatedAt?.toDate?.() ||
    event?.openedAt?.toDate?.() ||
    eventTime(event)
);

const timeValue = (value) => {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

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

function IncidentCard({ incident, onSelectStation }) {
    const style = SEVERITY_STYLES[incident.severity] || SEVERITY_STYLES.warning;

    return (
        <article className={`min-w-0 rounded-md border p-2 ${style}`}>
            <div className="flex min-w-0 items-center justify-between gap-1.5">
                <button
                    type="button"
                    className="truncate text-[11px] font-bold uppercase tracking-wide hover:underline"
                    onClick={() => onSelectStation(incident.stationId)}
                >
                    {incident.stationId || 'Unknown'}
                </button>
                <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase">Open</span>
            </div>
            <p className="mt-1 truncate text-xs font-semibold" title={incident.summary || incident.type}>{incident.summary || incident.type}</p>
            <div className="mt-1 flex items-center justify-between gap-1 text-[9px] opacity-70">
                <span className="truncate">{eventTimeLabel(incident)}</span>
                {incident.durationMs > 0 && <span className="shrink-0">{formatDuration(incident.durationMs)}</span>}
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
    const [seenActivity, setSeenActivity] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) || '{}');
        } catch {
            return {};
        }
    });

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
        if (!selectedStation) {
            setEvents([]);
            setCursor(null);
            setHasMore(false);
            setLoading(false);
            setLoadingMore(false);
            return;
        }
        append ? setLoadingMore(true) : setLoading(true);
        setError('');
        try {
            const constraints = [where('stationId', '==', selectedStation)];
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
    const seenScope = selectedStation || 'all-kiosks';
    const newestActivityByFilter = useMemo(() => Object.fromEntries(FILTERS.map(([filterValue]) => {
        const newest = [...visibleIncidents, ...events]
            .filter((event) => matchesFilter(event, filterValue))
            .reduce((latest, event) => Math.max(latest, timeValue(unseenTime(event))), 0);
        return [filterValue, newest];
    })), [events, visibleIncidents]);
    const unseenFilters = useMemo(() => new Set(FILTERS
        .filter(([filterValue]) => newestActivityByFilter[filterValue] > Number(seenActivity?.[seenScope]?.[filterValue] || 0))
        .map(([filterValue]) => filterValue)), [newestActivityByFilter, seenActivity, seenScope]);

    const chooseFilter = useCallback((nextFilter) => {
        setFilter(nextFilter);
        setSeenActivity((previous) => {
            const next = {
                ...previous,
                [seenScope]: {
                    ...(previous[seenScope] || {}),
                    [nextFilter]: newestActivityByFilter[nextFilter] || Date.now(),
                },
            };
            try {
                localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(next));
            } catch {
                // Seen indicators are a browser convenience; the activity page still works without storage.
            }
            return next;
        });
    }, [newestActivityByFilter, seenScope]);

    const handleStationSubmit = (event) => {
        event.preventDefault();
        selectStation(stationInput);
    };

    return (
        <div className="min-h-screen bg-slate-100 text-slate-900">
            <header className="sticky top-0 z-20 border-b bg-white/95 shadow-sm backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-3 sm:px-6">
                    <div className="min-w-0">
                        <h1 className="truncate text-lg font-bold sm:text-xl">Kiosk activity</h1>
                        <p className="hidden text-xs text-slate-500 sm:block">Operational incidents and non-rental events</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={onNavigateToDashboard} className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300" title="Back to dashboard" aria-label="Home">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 011-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        </button>
                        <button type="button" onClick={onLogout} className="rounded-md bg-red-500 p-2 text-white hover:bg-red-600" title="Logout" aria-label="Logout">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
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

                {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

                <section>
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="flex items-center gap-2 text-base font-bold">
                            <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                            Open incidents
                        </h2>
                        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">{visibleIncidents.length}</span>
                    </div>
                    {visibleIncidents.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                            {visibleIncidents.map((incident) => <IncidentCard key={incident.id} incident={incident} onSelectStation={selectStation} />)}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">No open incidents in this view.</div>
                    )}
                </section>

                {selectedStation && <section>
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-base font-bold">Activity history{selectedStation ? ` · ${selectedStation}` : ''}</h2>
                        <div className="flex gap-1 overflow-x-auto pb-1">
                            {FILTERS.map(([value, label]) => (
                                <button key={value} type="button" onClick={() => chooseFilter(value)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${filter === value ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-200'}`}>
                                    {label}
                                    {unseenFilters.has(value) && filter !== value && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-label="Unseen activity" />}
                                </button>
                            ))}
                        </div>
                    </div>
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
                </section>}
            </main>
        </div>
    );
}
