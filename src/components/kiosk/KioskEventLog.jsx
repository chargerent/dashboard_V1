import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { ChevronDownIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { db } from '../../firebase-config';
import { formatDateTime } from '../../utils/dateFormatter';

const FILTERS = [
    ['all', 'All'],
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
    info: 'border-slate-200 bg-slate-50 text-slate-700',
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

const matchesFilter = (event, filter) => {
    if (filter === 'all') return true;
    if (filter === 'errors') return ['warning', 'error', 'critical'].includes(event.severity);
    return event.category === filter;
};

const formatDuration = (durationMs) => {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs || 0) / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export default function KioskEventLog({ stationId }) {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('errors');
    const [events, setEvents] = useState([]);
    const [incidents, setIncidents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open || !stationId) return undefined;
        setLoading(true);
        setError('');

        const eventsQuery = query(
            collection(db, 'kioskEvents'),
            where('stationId', '==', stationId),
            orderBy('occurredAt', 'desc'),
            limit(50),
        );
        const incidentsQuery = query(
            collection(db, 'kioskIncidents'),
            where('stationId', '==', stationId),
            where('state', '==', 'open'),
            orderBy('openedAt', 'desc'),
            limit(25),
        );

        let eventsReady = false;
        let incidentsReady = false;
        const markReady = () => {
            if (eventsReady && incidentsReady) setLoading(false);
        };
        const handleError = (snapshotError) => {
            console.error('Unable to load kiosk activity', snapshotError);
            setError('Activity history is temporarily unavailable.');
            setLoading(false);
        };

        const unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
            setEvents(snapshot.docs.map((document) => ({id: document.id, ...document.data()})));
            eventsReady = true;
            markReady();
        }, handleError);
        const unsubscribeIncidents = onSnapshot(incidentsQuery, (snapshot) => {
            setIncidents(snapshot.docs.map((document) => ({id: document.id, ...document.data()})));
            incidentsReady = true;
            markReady();
        }, handleError);

        return () => {
            unsubscribeEvents();
            unsubscribeIncidents();
        };
    }, [open, stationId]);

    const rows = useMemo(() => {
        const openIncidentKeys = new Set(incidents.map((incident) => incident.incidentKey).filter(Boolean));
        const history = events.filter((event) => (
            !event.incidentKey || !openIncidentKeys.has(event.incidentKey)
        ));
        return [...incidents, ...history]
            .filter((event) => matchesFilter(event, filter))
            .sort((left, right) => Number(eventTime(right)) - Number(eventTime(left)));
    }, [events, incidents, filter]);

    const criticalCount = incidents.filter((incident) => incident.severity === 'critical').length;
    const warningCount = incidents.filter((incident) => incident.severity !== 'critical').length;

    return (
        <section
            className="mt-4 border-t pt-3"
            onClick={(event) => event.stopPropagation()}
            aria-label={`${stationId} activity and errors`}
        >
            <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-1 py-2 text-left hover:bg-slate-50"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="flex min-w-0 items-center gap-2">
                    <ExclamationTriangleIcon className={`h-4 w-4 ${criticalCount ? 'text-red-600' : warningCount ? 'text-amber-600' : 'text-slate-400'}`} />
                    <span className="text-sm font-semibold text-slate-700">Activity &amp; Errors</span>
                    {open && incidents.length > 0 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                            {incidents.length} open
                        </span>
                    )}
                </span>
                <ChevronDownIcon className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="mt-2 space-y-3">
                    <div className="flex gap-1 overflow-x-auto pb-1">
                        {FILTERS.map(([value, label]) => (
                            <button
                                type="button"
                                key={value}
                                onClick={() => setFilter(value)}
                                className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${filter === value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    {loading && <p className="py-3 text-center text-xs text-slate-500">Loading activity…</p>}
                    {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
                    {!loading && !error && rows.length === 0 && (
                        <p className="py-3 text-center text-xs text-slate-500">No matching activity recorded.</p>
                    )}

                    {!loading && !error && rows.length > 0 && (
                        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                            {rows.map((event) => {
                                const isOpen = event.state === 'open';
                                const style = SEVERITY_STYLES[event.severity] || SEVERITY_STYLES.info;
                                return (
                                    <article key={event.id} className={`rounded-md border p-2.5 text-xs ${style}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="font-semibold leading-4">{event.summary || event.type}</p>
                                            <span className="shrink-0 font-mono text-[10px] uppercase">
                                                {isOpen ? 'OPEN' : event.severity || 'INFO'}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] opacity-80">
                                            <span>{eventTimeLabel(event)}</span>
                                            {event.moduleId && <span>Module {event.moduleId}</span>}
                                            {event.page && <span>Screen: {event.page}</span>}
                                            {event.terminalState && <span>{event.terminalState.replaceAll('_', ' ')}</span>}
                                            {event.durationMs > 0 && <span>{formatDuration(event.durationMs)}</span>}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
