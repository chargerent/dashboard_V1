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
import { isKioskActive, isKioskOnline } from '../utils/helpers';

const PAGE_SIZE = 30;
const SEEN_STORAGE_KEY = 'chargerent:kiosk-activity-seen:v1';
const TELEMETRY_OVERDUE_TYPE = 'kiosk_telemetry_overdue';
const MQTT_DISCONNECTED_TYPE = 'mqtt_disconnected';
const MODULE_EVENT_TYPES = new Set([
    TELEMETRY_OVERDUE_TYPE,
    `${TELEMETRY_OVERDUE_TYPE}_resolved`,
    'module_connected',
    'module_disconnected',
    'module_telemetry_overdue',
    'module_telemetry_overdue_resolved',
]);
const CONNECTIVITY_EVENT_TYPES = new Set([
    'mqtt_connected',
    MQTT_DISCONNECTED_TYPE,
    `${MQTT_DISCONNECTED_TYPE}_resolved`,
    'kiosk_online',
    'kiosk_offline',
]);
const FILTERS = [
    ['all', 'All activity'],
    ['connectivity', 'Connectivity'],
    ['module', 'Modules'],
    ['interaction', 'Interactions'],
    ['admin', 'Admin'],
];
const DATE_RANGES = [
    ['today', 'Today', 1],
    ['3days', '3 days', 3],
    ['7days', '7 days', 7],
];

const SEVERITY_STYLES = {
    critical: 'border-red-300 bg-red-50 text-red-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-slate-200 bg-white text-slate-700',
};
const RENTAL_INTERACTION_STYLE = 'border-emerald-200 bg-emerald-50 text-emerald-900';
const TRANSACTION_TIMELINE_EVENT_TYPES = new Set([
    'rental_paid',
    'charger_reserved',
    'reservation_released',
    'payment_timed_out',
    'payment_declined',
    'payment_approved',
    'charger_dispense_failed',
    'charger_dispensed',
    'charger_rented',
    'charger_returned',
    'charger_purchased',
    'rental_refunded',
    'rental_canceled',
    'rental_failed',
    'interaction_failed',
    'interaction_timed_out',
]);

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
    const normalized = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(normalized.getTime())) return 'Time unavailable';
    return normalized.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
    });
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

const pageVisitSummary = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return 'Unknown page';
    const exactSummary = {
        startpage: 'Returned to start page',
        returninfopage: 'Return information page',
        returntypage: 'Return complete page',
        waitpage: 'Please wait page',
        loadingpage: 'Loading page',
        thankyoupage: 'Thank you page',
        declinedpage: 'Payment declined page',
        ooopage: 'Out of order page',
        remotepage: 'Remote support page',
        loginpage: 'Admin login page',
    }[normalized.toLowerCase()];
    if (exactSummary) return exactSummary;
    const pageName = normalized
        .replace(/page$/i, '')
        .replaceAll('_', ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return `${pageName.charAt(0).toUpperCase()}${pageName.slice(1)} page`;
};

const kioskInteractionSurface = (kiosk) => {
    const screen = String(kiosk?.hardware?.screen || '').toLowerCase();
    const uiMode = String(kiosk?.ui?.mode || '').toLowerCase();
    return /no screen|none|terminal only/.test(screen) || uiMode === 'media' ? 'terminal' : 'ui';
};

const eventInteractionSurface = (event, fallbackSurface = 'ui') => {
    const explicit = String(event.sourceSurface || '').toLowerCase();
    if (explicit === 'ui' || explicit === 'terminal') return explicit;
    return fallbackSurface;
};

const interactionSequence = (event) => {
    const state = String(event.page || event.currentValue || '').trim().toLowerCase();
    if (event.type === 'ui_state_changed' && /^button[ _-]*pressed$/.test(state)) return 10;
    if (event.type === 'customer_button_state_changed' && state === 'disabled') return 20;
    return 50;
};

const normalizeActivityEvent = (event, fallbackSurface) => {
    const type = String(event.type || '');
    const isResolvedHeartbeat = type === `${TELEMETRY_OVERDUE_TYPE}_resolved`;
    if (type === TELEMETRY_OVERDUE_TYPE || isResolvedHeartbeat) {
        return {
            ...event,
            category: 'module',
            summary: isResolvedHeartbeat ? 'Heartbeat restored' : 'Overdue heartbeat',
        };
    }
    if (type === 'ui_state_changed') {
        const sourceSurface = eventInteractionSurface(event, fallbackSurface);
        const page = String(event.page || event.currentValue || '').trim();
        const isButtonPress = /^button[ _-]*pressed$/i.test(page);
        return {
            ...event,
            category: 'interaction',
            sourceSurface,
            summary: isButtonPress
                ? sourceSurface === 'terminal' ? 'Terminal button pressed' : 'Button pressed'
                : pageVisitSummary(page),
        };
    }
    if (type === 'customer_button_state_changed') {
        return { ...event, category: 'interaction', severity: 'info' };
    }
    if (event.category === 'terminal' || type === 'terminal_state_entered') {
        return { ...event, category: 'interaction' };
    }
    if (type === 'module_disconnected' || type === 'module_connected') {
        const moduleId = String(event.moduleId || '').trim();
        return {
            ...event,
            category: 'module',
            summary: `Module${moduleId ? ` ${moduleId}` : ''} ${type === 'module_connected' ? 'connected' : 'disconnected'}`,
        };
    }
    if (MODULE_EVENT_TYPES.has(type)) return { ...event, category: 'module' };
    if (CONNECTIVITY_EVENT_TYPES.has(type)) return { ...event, category: 'connectivity' };
    return event;
};

const interactionTitle = (events, cardKind = '') => {
    if (cardKind === 'return') return 'Charger return';
    if (cardKind === 'rental') return 'Rental interaction';
    const kind = events.find((event) => event.interactionKind)?.interactionKind;
    if (kind === 'rental' || kind === 'rent') return 'Rental interaction';
    if (kind === 'return') return 'Return interaction';
    const selectedAction = events.find((event) => event.action)?.action;
    if (selectedAction) return `${String(selectedAction).replaceAll('_', ' ')} interaction`;
    return 'Kiosk interaction';
};

const eventDetailLabels = (event) => [
    (event.transactionId || event.details?.transactionId) && `Transaction ${event.transactionId || event.details.transactionId}`,
    (event.reservationId || event.details?.reservationId) && `Reservation ${event.reservationId || event.details.reservationId}`,
    event.moduleId && `Module ${event.moduleId}`,
    (event.slotId ?? event.slot) != null && `Slot ${event.slotId ?? event.slot}`,
    event.chargerId && `Charger ${event.chargerId}`,
    event.page && `Screen: ${event.page}`,
    event.terminalState && `Terminal: ${String(event.terminalState).replaceAll('_', ' ')}`,
    event.error || event.errorMessage || event.failureReason || event.details?.failureReason,
].filter(Boolean);

const rentalTimelineKey = (event) => String(
    event.details?.rentalId || event.rentalId || event.transactionId || '',
).trim();

const uniqueTimelineEvents = (events) => [...new Map(
    events.map((event) => [event.id, event]),
).values()].sort((left, right) => (
    timeValue(eventTime(left)) - timeValue(eventTime(right)) ||
    interactionSequence(left) - interactionSequence(right)
));

const groupInteractionEvents = (activityEvents, relatedTimelineEvents = []) => {
    const grouped = new Map();
    const items = [];

    activityEvents.forEach((event) => {
        const transactionKey = rentalTimelineKey(event);
        const isTransactionEvent = event.category === 'interaction' &&
            transactionKey && TRANSACTION_TIMELINE_EVENT_TYPES.has(event.type);
        if (!isTransactionEvent) {
            items.push({ key: event.id, type: 'event', event, occurredAt: timeValue(eventTime(event)) });
            return;
        }
        const cardKind = event.type === 'charger_returned' ? 'return' : 'rental';
        const key = `${cardKind}:${transactionKey}`;
        let group = grouped.get(key);
        if (!group) {
            group = { key, type: 'interaction', cardKind, transactionKey, events: [], occurredAt: 0 };
            grouped.set(key, group);
            items.push(group);
        }
        group.events.push(event);
        group.occurredAt = Math.max(group.occurredAt, timeValue(eventTime(event)));
    });

    const timelinesByRental = new Map();
    [...activityEvents, ...relatedTimelineEvents].forEach((event) => {
        const key = rentalTimelineKey(event);
        if (!key || event.category !== 'interaction' || !TRANSACTION_TIMELINE_EVENT_TYPES.has(event.type)) return;
        const timeline = timelinesByRental.get(key) || [];
        timeline.push(event);
        timelinesByRental.set(key, timeline);
    });
    timelinesByRental.forEach((timeline, key) => {
        timelinesByRental.set(key, uniqueTimelineEvents(timeline));
    });

    grouped.forEach((group) => {
        group.events = uniqueTimelineEvents(group.events);
        group.cardEvent = group.cardKind === 'return'
            ? group.events.find((event) => event.type === 'charger_returned')
            : group.events[0];
        if (timelinesByRental.has(group.transactionKey)) {
            group.events = timelinesByRental.get(group.transactionKey);
        }
    });
    return items.sort((left, right) => right.occurredAt - left.occurredAt);
};

const activityStateKey = (event) => {
    if (event.type === 'module_disconnected' || event.type === 'module_connected') {
        return `module:${event.type}:${String(event.moduleId || '').trim()}`;
    }
    if (event.incidentKey) return `${event.incidentKey}:${event.state || event.type}`;
    return [
        event.type,
        event.moduleId,
        event.page,
        event.terminalState,
        event.currentValue,
        event.summary,
    ].map((value) => String(value ?? '')).join(':');
};

const collapseRepeatedStates = (activityEvents) => activityEvents.reduce((collapsed, event) => {
    const previous = collapsed.at(-1);
    if (previous && activityStateKey(previous) === activityStateKey(event)) return collapsed;
    collapsed.push(event);
    return collapsed;
}, []);

const RELATED_STATE_WINDOW_MS = 2 * 60 * 1000;
const relatedStateExists = (events, event, types, moduleSpecific = false) => {
    const eventMs = timeValue(eventTime(event));
    return events.some((candidate) => {
        if (candidate === event || !types.has(candidate.type)) return false;
        if (moduleSpecific && String(candidate.moduleId || '') !== String(event.moduleId || '')) return false;
        const candidateMs = timeValue(eventTime(candidate));
        return eventMs > 0 && candidateMs > 0 && Math.abs(candidateMs - eventMs) <= RELATED_STATE_WINDOW_MS;
    });
};

const collapseRelatedModuleStates = (activityEvents) => activityEvents.filter((event) => {
    if (event.type === 'module_disconnected_resolved') return false;
    if (event.type === 'module_telemetry_overdue') {
        return !relatedStateExists(activityEvents, event, new Set(['module_disconnected']), true);
    }
    if (event.type === 'module_telemetry_overdue_resolved') {
        return !relatedStateExists(activityEvents, event, new Set(['module_connected', 'module_disconnected_resolved']), true);
    }
    if (event.kioskGeneration === 'v2' && event.type === TELEMETRY_OVERDUE_TYPE) {
        return !relatedStateExists(activityEvents, event, new Set(['module_disconnected', 'module_telemetry_overdue']));
    }
    if (event.kioskGeneration === 'v2' && event.type === `${TELEMETRY_OVERDUE_TYPE}_resolved`) {
        return !relatedStateExists(activityEvents, event, new Set(['module_connected', 'module_disconnected_resolved', 'module_telemetry_overdue_resolved']));
    }
    return true;
});

function ActivityRow({ event, open = false, onNavigateToDashboard }) {
    const style = SEVERITY_STYLES[event.severity] || SEVERITY_STYLES.info;

    return (
        <article className={`rounded-lg border p-3 sm:p-4 ${style}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <button
                        type="button"
                        className="text-xs font-bold uppercase tracking-wide hover:underline"
                        onClick={() => onNavigateToDashboard(event.stationId)}
                        aria-label={`Show ${event.stationId || 'unknown kiosk'} on dashboard`}
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
                {event.durationMs > 0 && <span>{formatDuration(event.durationMs)}</span>}
                {eventDetailLabels(event).map((label) => <span key={label}>{label}</span>)}
            </div>
        </article>
    );
}

function InteractionCard({ events, cardEvent, cardKind, onNavigateToDashboard }) {
    const firstEvent = events[0];
    const lastEvent = events.at(-1);
    const displayEvent = cardEvent || firstEvent;
    const severity = events.some((event) => ['critical', 'error'].includes(event.severity))
        ? 'error'
        : events.some((event) => event.severity === 'warning') ? 'warning' : 'info';
    const isRentalInteraction = events.some((event) => (
        ['rental', 'rent'].includes(String(event.interactionKind || '').toLowerCase()) ||
        event.source === 'rental' ||
        Boolean(event.transactionId)
    ));
    const style = severity === 'info' && isRentalInteraction
        ? RENTAL_INTERACTION_STYLE
        : SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;
    const transactionIds = [...new Set(events.map((event) => event.transactionId).filter(Boolean))];
    const completed = events.some((event) => [
        'interaction_completed',
        'charger_dispensed',
        'charger_returned',
    ].includes(event.type));
    const failed = events.some((event) => ['interaction_failed', 'interaction_timed_out', 'charger_dispense_failed', 'payment_declined'].includes(event.type));
    const rentalStartedAt = events.find((event) => event.type === 'charger_rented');
    const rentalReturnedAt = [...events].reverse().find((event) => event.type === 'charger_returned');
    const rentalDurationMs = rentalStartedAt && rentalReturnedAt
        ? Math.max(0, timeValue(eventTime(rentalReturnedAt)) - timeValue(eventTime(rentalStartedAt)))
        : 0;

    return (
        <details className={`group rounded-lg border ${style}`}>
            <summary className="cursor-pointer list-none p-3 marker:hidden sm:p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <button
                            type="button"
                            className="text-xs font-bold uppercase tracking-wide hover:underline"
                            onClick={(event) => {
                                event.preventDefault();
                                onNavigateToDashboard(displayEvent.stationId);
                            }}
                            aria-label={`Show ${displayEvent.stationId || 'unknown kiosk'} on dashboard`}
                        >
                            {displayEvent.stationId || 'Unknown kiosk'}
                        </button>
                        <p className="mt-1 text-sm font-semibold leading-5">{interactionTitle(events, cardKind)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 font-mono text-[10px] font-bold uppercase">
                        {failed ? 'Error' : completed ? 'Complete' : 'In progress'}
                    </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] opacity-75">
                    <span>{eventTimeLabel(displayEvent)}</span>
                    <span>{events.length} steps</span>
                    {transactionIds.map((transactionId) => <span key={transactionId}>Transaction {transactionId}</span>)}
                    {rentalDurationMs > 0 && <span>Rental duration {formatDuration(rentalDurationMs)}</span>}
                    <span className="font-semibold group-open:hidden">View timeline</span>
                </div>
            </summary>
            <ol className="mx-3 mb-3 border-l border-current/20 pl-4 sm:mx-4 sm:mb-4">
                {events.map((event) => (
                    <li key={event.id} className="relative pb-3 last:pb-0">
                        <span className="absolute -left-[1.18rem] top-1.5 h-2 w-2 rounded-full bg-current" />
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className="text-sm font-semibold">{event.summary || event.type}</p>
                            <time className="text-[11px] opacity-70">{eventTimeLabel(event)}</time>
                        </div>
                        {eventDetailLabels(event).length > 0 && (
                            <p className="mt-0.5 text-[11px] opacity-75">{eventDetailLabels(event).join(' · ')}</p>
                        )}
                    </li>
                ))}
            </ol>
            {lastEvent.durationMs > 0 && <p className="px-3 pb-3 text-[11px] opacity-70 sm:px-4 sm:pb-4">Duration {formatDuration(lastEvent.durationMs)}</p>}
        </details>
    );
}

function IncidentCard({ incident, onSelectStation, onNavigateToDashboard }) {
    const style = SEVERITY_STYLES[incident.severity] || SEVERITY_STYLES.warning;

    return (
        <article className={`relative min-w-0 rounded-md border p-2 text-left transition-shadow hover:shadow-sm ${style}`}>
            <button
                type="button"
                className="absolute inset-0 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                onClick={() => onSelectStation(incident.stationId)}
                aria-label={`View activity for ${incident.stationId || 'unknown kiosk'}: ${incident.summary || incident.type}`}
            />
            <div className="pointer-events-none relative z-10 flex min-w-0 items-center justify-between gap-1.5">
                <button
                    type="button"
                    className="pointer-events-auto truncate text-[11px] font-bold uppercase tracking-wide hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onClick={() => onNavigateToDashboard(incident.stationId)}
                    aria-label={`Show ${incident.stationId || 'unknown kiosk'} on dashboard`}
                >
                    {incident.stationId || 'Unknown'}
                </button>
                <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase">Open</span>
            </div>
            <p className="pointer-events-none relative z-10 mt-1 truncate text-xs font-semibold" title={incident.summary || incident.type}>{incident.summary || incident.type}</p>
            <div className="pointer-events-none relative z-10 mt-1 flex items-center justify-between gap-1 text-[9px] opacity-70">
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
    const [dateRange, setDateRange] = useState('today');
    const [incidents, setIncidents] = useState([]);
    const [events, setEvents] = useState([]);
    const [relatedTimelineEvents, setRelatedTimelineEvents] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const [referenceTime, setReferenceTime] = useState(() => new Date().toISOString());
    const [seenActivity, setSeenActivity] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) || '{}');
        } catch {
            return {};
        }
    });

    const allowedStationKey = allStationsData
        .filter((station) => isKioskActive(station, referenceTime))
        .map((station) => String(station.stationid || '').trim())
        .filter(Boolean)
        .sort()
        .join('\u0000');
    const allowedStationIds = useMemo(() => new Set(
        allowedStationKey ? allowedStationKey.split('\u0000') : []
    ), [allowedStationKey]);
    const stationOptions = useMemo(() => [...allowedStationIds].sort(), [allowedStationIds]);
    const stationsById = useMemo(() => new Map(
        allStationsData
            .filter((station) => isKioskActive(station, referenceTime))
            .map((station) => [String(station.stationid || '').trim(), station])
    ), [allStationsData, referenceTime]);
    const selectedStationSurface = useMemo(() => {
        const selectedKiosk = allStationsData.find((station) => (
            String(station.stationid || '').trim() === selectedStation
        ));
        return kioskInteractionSurface(selectedKiosk);
    }, [allStationsData, selectedStation]);
    const historyStartMs = useMemo(() => {
        const days = DATE_RANGES.find(([value]) => value === dateRange)?.[2] || 1;
        const start = new Date(referenceTime);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (days - 1));
        return start.getTime();
    }, [dateRange, referenceTime]);

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
        if (allStationsData.length > 0 && selectedStation && !allowedStationIds.has(selectedStation)) {
            selectStation('');
        }
    }, [allStationsData.length, allowedStationIds, selectStation, selectedStation]);

    useEffect(() => {
        const timer = window.setInterval(() => setReferenceTime(new Date().toISOString()), 30_000);
        return () => window.clearInterval(timer);
    }, []);

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
            setRelatedTimelineEvents([]);
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
            constraints.push(where('occurredAt', '>=', new Date(historyStartMs)));
            constraints.push(orderBy('occurredAt', 'desc'));
            if (after) constraints.push(startAfter(after));
            constraints.push(limit(PAGE_SIZE));
            const snapshot = await getDocs(query(collection(db, 'kioskEvents'), ...constraints));
            const nextEvents = snapshot.docs
                .map((document) => ({ id: document.id, ...document.data() }))
                .filter((event) => allowedStationIds.has(event.stationId))
                .map((event) => normalizeActivityEvent(event, selectedStationSurface));
            const returnTransactionIds = [...new Set(nextEvents
                .filter((event) => event.type === 'charger_returned')
                .map((event) => event.transactionId)
                .filter(Boolean))]
                .slice(0, 30);
            let nextRelatedEvents = [];
            if (returnTransactionIds.length > 0) {
                try {
                    const relatedSnapshot = await getDocs(query(
                        collection(db, 'kioskEvents'),
                        where('transactionId', 'in', returnTransactionIds),
                    ));
                    nextRelatedEvents = relatedSnapshot.docs
                        .map((document) => ({ id: document.id, ...document.data() }))
                        .map((event) => normalizeActivityEvent(event, selectedStationSurface));
                } catch (timelineError) {
                    console.warn('Unable to enrich returned rental timelines', timelineError);
                }
            }
            setEvents((previous) => append ? [...previous, ...nextEvents] : nextEvents);
            setRelatedTimelineEvents((previous) => append
                ? uniqueTimelineEvents([...previous, ...nextRelatedEvents])
                : nextRelatedEvents);
            setCursor(snapshot.docs.at(-1) || null);
            setHasMore(snapshot.size === PAGE_SIZE);
        } catch (loadError) {
            console.error('Unable to load kiosk activity history', loadError);
            setError('Activity history is temporarily unavailable.');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [allowedStationIds, historyStartMs, selectedStation, selectedStationSurface]);

    useEffect(() => {
        setEvents([]);
        setRelatedTimelineEvents([]);
        setCursor(null);
        loadEvents();
    }, [loadEvents]);

    const operationalIncidents = useMemo(() => {
        const byStation = new Map();
        incidents.forEach((incident) => {
            const stationIncidents = byStation.get(incident.stationId) || [];
            stationIncidents.push(incident);
            byStation.set(incident.stationId, stationIncidents);
        });

        return [...byStation.entries()].flatMap(([stationId, stationIncidents]) => {
            const kiosk = stationsById.get(stationId);
            const hasV2ModuleDisconnect = stationIncidents.some((incident) => (
                incident.kioskGeneration === 'v2' && incident.type === 'module_disconnected'
            ));
            if (hasV2ModuleDisconnect) {
                return stationIncidents.filter((incident) => ![
                    TELEMETRY_OVERDUE_TYPE,
                    MQTT_DISCONNECTED_TYPE,
                    'module_telemetry_overdue',
                ].includes(incident.type));
            }
            const telemetryIncident = stationIncidents.find((incident) => incident.type === TELEMETRY_OVERDUE_TYPE);
            if (!kiosk || !telemetryIncident || isKioskOnline(kiosk, referenceTime)) return stationIncidents;

            const offlineAt = kiosk.lastUpdated || telemetryIncident.openedAt;
            const offlineDate = offlineAt?.toDate?.() || new Date(offlineAt);
            const offlineDurationMs = Number.isFinite(offlineDate.getTime())
                ? Math.max(0, new Date(referenceTime).getTime() - offlineDate.getTime())
                : telemetryIncident.durationMs;
            const otherIncidents = stationIncidents.filter((incident) => (
                incident.type !== TELEMETRY_OVERDUE_TYPE && incident.type !== MQTT_DISCONNECTED_TYPE
            ));

            return [{
                ...telemetryIncident,
                type: 'kiosk_offline',
                category: 'connectivity',
                summary: 'Kiosk offline',
                openedAt: offlineAt,
                durationMs: offlineDurationMs,
            }, ...otherIncidents];
        });
    }, [incidents, referenceTime, stationsById]);

    const visibleIncidents = useMemo(() => operationalIncidents
        .filter((incident) => !selectedStation || incident.stationId === selectedStation)
        .sort((left, right) => Number(eventTime(right)) - Number(eventTime(left))), [operationalIncidents, selectedStation]);
    const visibleEvents = useMemo(() => collapseRelatedModuleStates(collapseRepeatedStates([...events].sort((left, right) => (
        timeValue(eventTime(right)) - timeValue(eventTime(left)) ||
        interactionSequence(left) - interactionSequence(right)
    ))))
        .filter((event) => matchesFilter(event, filter)), [events, filter]);
    const visibleActivityItems = useMemo(() => groupInteractionEvents(
        visibleEvents,
        relatedTimelineEvents,
    ), [relatedTimelineEvents, visibleEvents]);
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
                        <p className="hidden text-xs text-slate-500 sm:block">Operational incidents and kiosk interactions</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => onNavigateToDashboard()} className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300" title="Back to dashboard" aria-label="Home">
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
                            {visibleIncidents.map((incident) => <IncidentCard key={incident.id} incident={incident} onSelectStation={selectStation} onNavigateToDashboard={onNavigateToDashboard} />)}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">No open incidents in this view.</div>
                    )}
                </section>

                {selectedStation && <section>
                    <div className="mb-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-base font-bold">Activity history{selectedStation ? ` · ${selectedStation}` : ''}</h2>
                            <div className="flex rounded-lg bg-white p-1 shadow-sm" aria-label="Activity date range">
                                {DATE_RANGES.map(([value, label]) => (
                                    <button key={value} type="button" onClick={() => setDateRange(value)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${dateRange === value ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-1 overflow-x-auto pb-1 sm:justify-end">
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
                    ) : visibleActivityItems.length > 0 ? (
                        <div className="space-y-3">
                            {visibleActivityItems.map((item) => item.type === 'interaction'
                                ? <InteractionCard key={`interaction:${item.key}`} events={item.events} cardEvent={item.cardEvent} cardKind={item.cardKind} onNavigateToDashboard={onNavigateToDashboard} />
                                : <ActivityRow key={item.key} event={item.event} onNavigateToDashboard={onNavigateToDashboard} />)}
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
