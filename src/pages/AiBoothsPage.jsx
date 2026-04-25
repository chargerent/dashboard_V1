import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';

const DEFAULT_GENERAL = Object.freeze({
  eventName: '',
  address: '',
  wifiUsername: '',
  wifiPassword: '',
  startDate: '',
  endDate: '',
  openingHours: '',
  closingHours: '',
  notes: '',
});

const TOPIC_COLORS = ['#38bdf8', '#2dd4bf', '#f59e0b', '#f472b6', '#a78bfa', '#34d399'];

function createLocalId(prefix = 'local') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createTopicDraft(index = 0) {
  return {
    id: createLocalId('topic'),
    title: `Topic ${index + 1}`,
    summary: '',
    notes: '',
    checklistText: '',
  };
}

function createEmptyEventDraft() {
  return {
    id: '',
    general: { ...DEFAULT_GENERAL },
    boothStationIds: [],
    topics: [],
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
  };
}

function cloneEvent(event) {
  return JSON.parse(JSON.stringify(event));
}

function normalizeTopic(topic, index) {
  const title = String(topic?.title || '').trim();

  return {
    id: String(topic?.id || createLocalId('topic')).trim(),
    title: title || `Topic ${index + 1}`,
    summary: String(topic?.summary || ''),
    notes: String(topic?.notes || ''),
    checklistText: String(topic?.checklistText || ''),
  };
}

function normalizeEvent(event) {
  const generalSource = event?.general && typeof event.general === 'object' ? event.general : {};
  const boothStationIds = Array.isArray(event?.boothStationIds)
    ? Array.from(new Set(event.boothStationIds.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];

  return {
    id: String(event?.id || '').trim(),
    general: {
      ...DEFAULT_GENERAL,
      eventName: String(generalSource.eventName || event?.name || ''),
      address: String(generalSource.address || ''),
      wifiUsername: String(generalSource.wifiUsername || ''),
      wifiPassword: String(generalSource.wifiPassword || ''),
      startDate: String(generalSource.startDate || ''),
      endDate: String(generalSource.endDate || ''),
      openingHours: String(generalSource.openingHours || ''),
      closingHours: String(generalSource.closingHours || ''),
      notes: String(generalSource.notes || ''),
    },
    boothStationIds,
    topics: Array.isArray(event?.topics) ? event.topics.map(normalizeTopic) : [],
    createdAt: String(event?.createdAt || ''),
    updatedAt: String(event?.updatedAt || ''),
    createdBy: event?.createdBy || null,
    updatedBy: event?.updatedBy || null,
  };
}

function getEventLabel(event) {
  return event?.general?.eventName?.trim() || 'Untitled event';
}

function sortEvents(events) {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left?.updatedAt || left?.createdAt || '') || 0;
    const rightTime = Date.parse(right?.updatedAt || right?.createdAt || '') || 0;

    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return getEventLabel(left).localeCompare(getEventLabel(right));
  });
}

function shortenLabel(value, maxLength = 12) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function getBoothType(kiosk) {
  return String(
    kiosk?.hardware?.type ||
    kiosk?.hardware?.kioskType ||
    kiosk?.info?.kioskType ||
    kiosk?.info?.kiosktype ||
    kiosk?.type ||
    ''
  ).trim().toUpperCase();
}

function getBoothLocationLabel(kiosk) {
  return kiosk?.info?.location || kiosk?.info?.place || kiosk?.stationid || 'Unknown booth';
}

function getBoothSecondaryLabel(kiosk) {
  return [kiosk?.info?.city, kiosk?.info?.country].filter(Boolean).join(', ');
}

function TopicWebPreview({ topics, activeTabId, onSelectTab }) {
  const nodes = useMemo(() => {
    const count = topics.length;
    const radius = count > 6 ? 36 : count > 3 ? 32 : 28;

    return topics.map((topic, index) => {
      const angle = ((Math.PI * 2) / Math.max(count, 1)) * index - Math.PI / 2;
      return {
        ...topic,
        x: 50 + Math.cos(angle) * radius,
        y: 50 + Math.sin(angle) * radius,
        color: TOPIC_COLORS[index % TOPIC_COLORS.length],
      };
    });
  }, [topics]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700">Topic Web</p>
          <h3 className="mt-2 text-xl font-semibold text-gray-900">Event conversation map</h3>
          <p className="mt-2 text-sm text-gray-600">
            Every tab becomes a circle here so the team can jump between the event&apos;s key topics.
          </p>
        </div>
        <div className="rounded-md bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          {topics.length + 1} nodes
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_45%),linear-gradient(160deg,_rgba(15,23,42,0.96),_rgba(17,24,39,0.94))] p-4">
        <svg viewBox="0 0 100 100" className="mx-auto block aspect-square w-full max-w-md">
          <defs>
            <radialGradient id="generalGlow" cx="50%" cy="50%" r="65%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0.95" />
            </radialGradient>
          </defs>

          {nodes.map((node) => (
            <line
              key={`line-${node.id}`}
              x1="50"
              y1="50"
              x2={node.x}
              y2={node.y}
              stroke={activeTabId === node.id ? node.color : 'rgba(148, 163, 184, 0.45)'}
              strokeWidth={activeTabId === node.id ? 1.6 : 1}
            />
          ))}

          {nodes.map((node) => {
            const isActive = activeTabId === node.id;

            return (
              <g
                key={node.id}
                className="cursor-pointer"
                onClick={() => onSelectTab(node.id)}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isActive ? 9.6 : 8.5}
                  fill={isActive ? node.color : '#0f172a'}
                  stroke={node.color}
                  strokeWidth={isActive ? 1.8 : 1.2}
                />
                <text
                  x={node.x}
                  y={node.y + 0.8}
                  textAnchor="middle"
                  fontSize="3"
                  fontWeight="700"
                  fill="#f8fafc"
                >
                  {shortenLabel(node.title, 10)}
                </text>
              </g>
            );
          })}

          <g className="cursor-pointer" onClick={() => onSelectTab('general')}>
            <circle
              cx="50"
              cy="50"
              r={activeTabId === 'general' ? 13.8 : 12.6}
              fill="url(#generalGlow)"
              stroke={activeTabId === 'general' ? '#67e8f9' : '#bae6fd'}
              strokeWidth={activeTabId === 'general' ? 2 : 1.4}
            />
            <text x="50" y="48.5" textAnchor="middle" fontSize="4.2" fontWeight="800" fill="#f8fafc">
              General
            </text>
            <text x="50" y="53.8" textAnchor="middle" fontSize="2.8" fill="#dbeafe">
              Core setup
            </text>
          </g>
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelectTab('general')}
          className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
            activeTabId === 'general'
              ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
              : 'border-gray-200 bg-white text-gray-600 hover:border-cyan-200 hover:text-cyan-800'
          }`}
        >
          General
        </button>
        {topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => onSelectTab(topic.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
              activeTabId === topic.id
                ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                : 'border-gray-200 bg-white text-gray-600 hover:border-cyan-200 hover:text-cyan-800'
            }`}
          >
            {topic.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function GeneralField({ label, type = 'text', value, onChange, placeholder }) {
  const sharedClasses = 'mt-2 w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';

  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={5}
          className={`${sharedClasses} resize-y`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={sharedClasses}
        />
      )}
    </label>
  );
}

export default function AiBoothsPage({
  onNavigateToDashboard,
  onNavigateToAdmin,
  onNavigateToProvisionPage,
  onLogout,
  allStationsData,
  t,
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [eventDraft, setEventDraft] = useState(createEmptyEventDraft);
  const [activeTabId, setActiveTabId] = useState('general');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadEvents() {
      setLoading(true);
      setLoadError('');

      try {
        const response = await callFunctionWithAuth('aiBooths_listEvents');
        if (isCancelled) return;

        const nextEvents = sortEvents((response?.events || []).map(normalizeEvent));
        setEvents(nextEvents);

        if (nextEvents.length > 0) {
          setSelectedEventId(nextEvents[0].id);
          setEventDraft(cloneEvent(nextEvents[0]));
        } else {
          setSelectedEventId('');
          setEventDraft(createEmptyEventDraft());
        }

        setActiveTabId('general');
        setDirty(false);
      } catch (error) {
        if (isCancelled) return;

        console.error(error);
        setEvents([]);
        setSelectedEventId('');
        setEventDraft(createEmptyEventDraft());
        setLoadError(error?.message || 'Failed to load AI booth events.');
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadEvents();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTabId === 'general') {
      return;
    }

    if (!eventDraft.topics.some((topic) => topic.id === activeTabId)) {
      setActiveTabId('general');
    }
  }, [activeTabId, eventDraft.topics]);

  const availableBooths = useMemo(() => {
    const byStationId = new Map();

    (Array.isArray(allStationsData) ? allStationsData : []).forEach((kiosk) => {
      const stationId = String(kiosk?.stationid || '').trim();
      if (!stationId || getBoothType(kiosk) !== 'CA32') {
        return;
      }

      if (!byStationId.has(stationId)) {
        byStationId.set(stationId, kiosk);
      }
    });

    return [...byStationId.values()].sort((left, right) => left.stationid.localeCompare(right.stationid));
  }, [allStationsData]);

  const availableBoothMap = useMemo(() => {
    return new Map(availableBooths.map((booth) => [booth.stationid, booth]));
  }, [availableBooths]);

  const assignedBooths = useMemo(() => {
    return eventDraft.boothStationIds.map((stationId) => {
      const matchingKiosk = availableBoothMap.get(stationId);
      if (matchingKiosk) {
        return matchingKiosk;
      }

      return {
        stationid: stationId,
        info: {
          location: 'Booth not currently in kiosk feed',
          country: '',
          city: '',
        },
      };
    });
  }, [availableBoothMap, eventDraft.boothStationIds]);

  const activeTopic = useMemo(() => {
    return eventDraft.topics.find((topic) => topic.id === activeTabId) || null;
  }, [activeTabId, eventDraft.topics]);

  const selectedBoothSet = useMemo(() => new Set(eventDraft.boothStationIds), [eventDraft.boothStationIds]);

  const eventLastUpdated = eventDraft.updatedAt || eventDraft.createdAt;
  const handleNavigateToProvision = () => {
    onNavigateToProvisionPage?.();
  };

  function markDirty() {
    setDirty(true);
  }

  function handleOpenEvent(nextEvent) {
    setSelectedEventId(nextEvent?.id || '');
    setEventDraft(nextEvent ? cloneEvent(nextEvent) : createEmptyEventDraft());
    setActiveTabId('general');
    setDirty(false);
    setLoadError('');
  }

  function confirmDiscardChanges() {
    if (!dirty) {
      return true;
    }

    return window.confirm('You have unsaved changes. Continue without saving this event?');
  }

  function handleSelectEvent(event) {
    const nextEventId = String(event.target.value || '').trim();

    if (!confirmDiscardChanges()) {
      return;
    }

    if (!nextEventId) {
      handleOpenEvent(null);
      return;
    }

    const matchingEvent = events.find((item) => item.id === nextEventId);
    if (matchingEvent) {
      handleOpenEvent(matchingEvent);
    }
  }

  function handleCreateNewEvent() {
    if (!confirmDiscardChanges()) {
      return;
    }

    handleOpenEvent(null);
  }

  function updateGeneralField(field, value) {
    setEventDraft((current) => ({
      ...current,
      general: {
        ...current.general,
        [field]: value,
      },
    }));
    markDirty();
  }

  function updateTopicField(topicId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId ? { ...topic, [field]: value } : topic
      )),
    }));
    markDirty();
  }

  function handleAddTopic() {
    const nextTopic = createTopicDraft(eventDraft.topics.length);

    setEventDraft((current) => ({
      ...current,
      topics: [...current.topics, nextTopic],
    }));
    setActiveTabId(nextTopic.id);
    markDirty();
  }

  function handleDeleteTopic(topicId) {
    if (!window.confirm('Remove this topic from the event?')) {
      return;
    }

    setEventDraft((current) => ({
      ...current,
      topics: current.topics.filter((topic) => topic.id !== topicId),
    }));
    setActiveTabId('general');
    markDirty();
  }

  function toggleBoothAssignment(stationId) {
    setEventDraft((current) => {
      const selectedIds = new Set(current.boothStationIds);
      if (selectedIds.has(stationId)) {
        selectedIds.delete(stationId);
      } else {
        selectedIds.add(stationId);
      }

      return {
        ...current,
        boothStationIds: [...selectedIds].sort(),
      };
    });
    markDirty();
  }

  async function handleSaveEvent() {
    const trimmedEventName = String(eventDraft.general.eventName || '').trim();

    if (!trimmedEventName) {
      setActiveTabId('general');
      setStatus({ state: 'error', message: 'Event name is required before saving.' });
      return;
    }

    setStatus({ state: 'sending', message: 'Saving AI booth event...' });

    try {
      const response = await callFunctionWithAuth('aiBooths_saveEvent', {
        eventId: selectedEventId || eventDraft.id,
        event: eventDraft,
      });

      const savedEvent = normalizeEvent(response?.event || {});
      setEvents((current) => sortEvents([savedEvent, ...current.filter((item) => item.id !== savedEvent.id)]));
      setSelectedEventId(savedEvent.id);
      setEventDraft(cloneEvent(savedEvent));
      setDirty(false);
      setStatus({ state: 'success', message: 'AI booth event saved.' });
    } catch (error) {
      console.error(error);
      setStatus({ state: 'error', message: error?.message || 'Failed to save AI booth event.' });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="mx-auto flex min-h-screen max-w-screen-xl items-center justify-center px-4">
          <LoadingSpinner t={t} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <CommandStatusToast status={status} onDismiss={() => setStatus(null)} />

      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-700">AI Booths</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Event setup workspace</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Pick an event, assign its CA32 booths, and build out each topic as a tab that appears in the topic web.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onNavigateToDashboard}
              className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300"
              title={t('back_to_dashboard')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onNavigateToAdmin}
              className="p-2 rounded-md bg-orange-100 text-orange-700 hover:bg-orange-200"
              title={t('admin_tools')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleNavigateToProvision}
              className="p-2 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200"
              title={t('provision_kiosk')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600"
              title={t('logout')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        {loadError && (
          <div className="bg-red-100 text-red-700 p-3 rounded-md shadow-sm">
            {loadError}
          </div>
        )}

        <section className="bg-white p-6 rounded-lg shadow-md">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Saved Events</span>
                <select
                  value={selectedEventId}
                  onChange={handleSelectEvent}
                  className="mt-2 w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="" className="text-slate-900">
                    New unsaved event
                  </option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id} className="text-slate-900">
                      {getEventLabel(event)}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={handleCreateNewEvent}
                className="rounded-md bg-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-300"
              >
                New Event
              </button>

              <button
                type="button"
                onClick={handleSaveEvent}
                className="rounded-md bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Save Event
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Status</p>
                <p className="mt-3 text-lg font-semibold text-gray-900">{dirty ? 'Unsaved changes' : 'Saved draft'}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {dirty ? 'Save to publish the latest booth assignments and tabs.' : 'Everything on screen matches the stored event.'}
                </p>
              </div>
              <div className="rounded-md bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Booths</p>
                <p className="mt-3 text-3xl font-semibold text-gray-900">{eventDraft.boothStationIds.length}</p>
                <p className="mt-1 text-xs text-gray-500">Assigned event booths</p>
              </div>
              <div className="rounded-md bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Last Saved</p>
                <p className="mt-3 text-lg font-semibold text-gray-900">
                  {eventLastUpdated ? new Date(eventLastUpdated).toLocaleString() : 'Not saved yet'}
                </p>
                <p className="mt-1 text-xs text-gray-500">{eventDraft.topics.length} extra topic tabs</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
          <div className="space-y-6">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md">
              <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTabId('general')}
                    className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
                      activeTabId === 'general'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    General
                  </button>
                  {eventDraft.topics.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => setActiveTabId(topic.id)}
                      className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
                        activeTabId === topic.id
                          ? 'bg-cyan-100 text-cyan-800'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {topic.title}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleAddTopic}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-blue-600 text-2xl font-light text-white transition hover:bg-blue-700"
                  title="Add topic"
                >
                  +
                </button>
              </div>

              <div className="p-5 sm:p-6">
                {activeTabId === 'general' ? (
                  <div className="space-y-6">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">General</p>
                      <h2 className="mt-2 text-2xl font-semibold text-slate-900">Core event information</h2>
                      <p className="mt-2 text-sm text-slate-600">
                        This tab carries the operational basics the booth team needs before they arrive onsite.
                      </p>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <GeneralField
                        label="Event Name"
                        value={eventDraft.general.eventName}
                        onChange={(event) => updateGeneralField('eventName', event.target.value)}
                        placeholder="CES 2027"
                      />
                      <GeneralField
                        label="Address"
                        value={eventDraft.general.address}
                        onChange={(event) => updateGeneralField('address', event.target.value)}
                        placeholder="201 Sands Ave, Las Vegas, NV"
                      />
                      <GeneralField
                        label="Wi-Fi Username"
                        value={eventDraft.general.wifiUsername}
                        onChange={(event) => updateGeneralField('wifiUsername', event.target.value)}
                        placeholder="Event Wi-Fi user"
                      />
                      <GeneralField
                        label="Wi-Fi Password"
                        value={eventDraft.general.wifiPassword}
                        onChange={(event) => updateGeneralField('wifiPassword', event.target.value)}
                        placeholder="Event Wi-Fi password"
                      />
                      <GeneralField
                        label="Start Date"
                        type="date"
                        value={eventDraft.general.startDate}
                        onChange={(event) => updateGeneralField('startDate', event.target.value)}
                      />
                      <GeneralField
                        label="End Date"
                        type="date"
                        value={eventDraft.general.endDate}
                        onChange={(event) => updateGeneralField('endDate', event.target.value)}
                      />
                      <GeneralField
                        label="Opening Hours"
                        type="time"
                        value={eventDraft.general.openingHours}
                        onChange={(event) => updateGeneralField('openingHours', event.target.value)}
                      />
                      <GeneralField
                        label="Closing Hours"
                        type="time"
                        value={eventDraft.general.closingHours}
                        onChange={(event) => updateGeneralField('closingHours', event.target.value)}
                      />
                    </div>

                    <GeneralField
                      label="General Notes"
                      type="textarea"
                      value={eventDraft.general.notes}
                      onChange={(event) => updateGeneralField('notes', event.target.value)}
                      placeholder="Load-in notes, venue access, sponsor reminders, or anything the field team should know."
                    />
                  </div>
                ) : activeTopic ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">{activeTopic.title}</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Rename the topic and capture the notes that should live in its circle.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteTopic(activeTopic.id)}
                        className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                      >
                        Delete Topic
                      </button>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <GeneralField
                        label="Topic Name"
                        value={activeTopic.title}
                        onChange={(event) => updateTopicField(activeTopic.id, 'title', event.target.value)}
                        placeholder="Opening Script"
                      />
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm font-semibold text-slate-700">Circle preview</p>
                        <div className="mt-4 flex items-center gap-4">
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-100 text-center text-xs font-bold text-cyan-800 shadow-sm">
                            {shortenLabel(activeTopic.title, 10) || 'Topic'}
                          </div>
                          <p className="text-sm text-slate-600">
                            This label is what appears in the topic web for this tab.
                          </p>
                        </div>
                      </div>
                    </div>

                    <GeneralField
                      label="Summary"
                      type="textarea"
                      value={activeTopic.summary}
                      onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                      placeholder="Quick overview of what this topic covers."
                    />

                    <GeneralField
                      label="Details / Notes"
                      type="textarea"
                      value={activeTopic.notes}
                      onChange={(event) => updateTopicField(activeTopic.id, 'notes', event.target.value)}
                      placeholder="Talking points, staffing notes, setup sequence, escalation details, or training copy."
                    />

                    <GeneralField
                      label="Checklist"
                      type="textarea"
                      value={activeTopic.checklistText}
                      onChange={(event) => updateTopicField(activeTopic.id, 'checklistText', event.target.value)}
                      placeholder={'One checklist item per line\nPower on booth\nConfirm microphone check\nRun welcome prompt demo'}
                    />
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-sm text-gray-600">
                    Select a tab or add a new topic to continue.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Booth Assignment</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Assign CA32 event booths</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    These assignments are pulled from kiosks whose hardware type is set to <span className="font-semibold text-slate-900">CA32</span>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700">
                    {eventDraft.boothStationIds.length} selected
                  </div>
                  <button
                    type="button"
                    onClick={handleNavigateToProvision}
                    className="rounded-md bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-200"
                  >
                    Provision Booth
                  </button>
                </div>
              </div>

              {availableBooths.length === 0 ? (
                <div className="mt-5 rounded-md border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-sm text-gray-600">
                  <p>
                    No kiosks with type <span className="font-semibold text-slate-900">CA32</span> are available in the current dashboard feed yet.
                  </p>
                  <button
                    type="button"
                    onClick={handleNavigateToProvision}
                    className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Open Provisioning
                  </button>
                </div>
              ) : (
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {availableBooths.map((booth) => {
                    const isSelected = selectedBoothSet.has(booth.stationid);

                    return (
                      <label
                        key={booth.stationid}
                        className={`flex cursor-pointer items-start gap-4 rounded-lg border px-4 py-4 transition ${
                          isSelected
                            ? 'border-cyan-300 bg-cyan-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleBoothAssignment(booth.stationid)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-semibold text-slate-900">{booth.stationid}</span>
                            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                              {getBoothType(booth)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-700">{getBoothLocationLabel(booth)}</p>
                          {getBoothSecondaryLabel(booth) && (
                            <p className="mt-1 text-xs text-slate-500">{getBoothSecondaryLabel(booth)}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <TopicWebPreview topics={eventDraft.topics} activeTabId={activeTabId} onSelectTab={setActiveTabId} />

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Assigned Booths</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">Current event booth list</h3>
              <p className="mt-2 text-sm text-slate-600">
                Keep an eye on the exact booth lineup that will travel with this event.
              </p>

              {assignedBooths.length === 0 ? (
                <div className="mt-5 rounded-md border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-sm text-gray-600">
                  No booths assigned yet.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {assignedBooths.map((booth) => (
                    <div key={booth.stationid} className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{booth.stationid}</p>
                          <p className="mt-1 text-sm text-slate-600">{getBoothLocationLabel(booth)}</p>
                        </div>
                        <span className="rounded-md bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                          {getBoothType(booth) || 'Stored'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
