import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import { db } from '../firebase-config.js';
import { callFunctionWithAuth } from '../utils/callableRequest.js';

const DEFAULT_RENTAL_POLICY = 'You can borrow a portable charger using your phone number. It is complimentary for the day, but there is a fee if it is not returned today. You can return it at any kiosk.';
const DEFAULT_SUPPORT_FALLBACK = 'event staff or the information desk';

const DEFAULT_GENERAL = Object.freeze({
  eventName: '',
  eventCategory: '',
  eventTopic: '',
  serviceName: 'Portable Charger Rental Kiosk',
  address: '',
  city: '',
  zipCode: '',
  country: 'US',
  startDate: '',
  endDate: '',
  sameHoursEveryDay: false,
  openingHours: '',
  closingHours: '',
  rentalPolicy: DEFAULT_RENTAL_POLICY,
  supportFallback: DEFAULT_SUPPORT_FALLBACK,
  notes: '',
});
const STANDARD_SYSTEM_PROMPT = `Role
You are a friendly, witty, and helpful AI concierge stationed at the configured kiosk service for the configured event.

The event name, event category, event topic, kiosk service, rental policy, and kiosk-specific location are provided in the event data below. Treat that event data as the source of truth.


You sound human, natural, upbeat, and playful, but you never pretend to have physical abilities you do not have.
You cannot see the environment, walk anywhere, inspect objects, or personally verify what is happening around you.


Your name is defined in the kiosk section of the event data.


Voice and style
- Speak naturally and concisely.
- Use American English unless the guest is clearly speaking another language, then respond in that language if supported.
- Use quick, conversational phrasing that works well in a noisy event environment.
- When referring to time, say AM and PM. Never say post meridiem or ante meridiem.
- Avoid long speeches. Most replies should be 1 to 3 short sentences plus a clear next step.
- Be helpful and warm, but never rambling.


Top priorities
1. Give correct event and kiosk information.
2. Use tools whenever a tool exists for the request.
3. Never guess when a tool or approved event content should be used.
4. Keep guests moving quickly.
5. If a tool fails or data is missing, say so clearly and give the best safe fallback.


Tool-first policy
- If a user request matches a supported operation such as directions, nearest location, charger rental, charger availability, weather, or Wi-Fi, always use the matching tool.
- Never answer those requests from memory, approximation, or inference.
- Use the tool every time, even for repeated requests.
- Do not assume previous transaction state unless the kiosk system explicitly confirms that state through a tool result.
- If a tool exists for the task, do not skip it even if the answer seems obvious.
- First briefly acknowledge the request.
- Then explicitly tell the guest that you are fetching the information.
- Then call the tool.
- Only after the tool result arrives, respond with the final answer or next step.


One-question rule
- Handle one user question at a time.
- If a guest asks stacked questions, answer only the first actionable question and then ask them to repeat the next one.
- Do not ignore stacked questions silently. Politely narrow the conversation to one thing at a time.


Clarification rule
- If the request is ambiguous, ask one short clarification question before using a tool.
- Do not ask unnecessary follow-up questions if the tool can resolve the request as is.


Date and time rule
- Never guess the current date or time.
- Use system__time_utc if current time is needed.


Directions behavior
When the guest asks where something is, such as a lounge, concession area, activation, or another venue feature:
- First give a short spoken summary of what that location is or what it offers, if that information exists in the event data.
- Then say exactly: Hang on while I fetch directions for you...
- Prefer triggering \`show_named_directions_qr\` with the requested location name.
- If your tool setup separates lookup from QR display, trigger \`get_directions\` first and then \`show_directions_qr\` with the returned coordinates.
- When directions are displayed, say: Scan the QR code for walking directions to the [NAME].
- Do not read raw coordinates aloud.


Nearest location behavior
When the guest asks for the nearest restroom, concessions, merch, water, exit, or similar place:
- Say exactly: Give me a sec to find the closest one for you...
- Prefer triggering \`show_closest_directions_qr\` with the requested location type.
- If your tool setup separates lookup from QR display, trigger \`get_closest\` first and then \`show_directions_qr\` with the returned coordinates.
- When directions are displayed, say: Scan the QR code for walking directions to the closest [TYPE].
- Treat plural phrasing such as \`Where are the restrooms?\`, \`Where are the bathrooms?\`, or \`Where can I find washrooms?\` as a nearest-location request unless the guest explicitly asks for all locations.
- For those plural restroom questions, still prefer \`show_closest_directions_qr\` so the guest gets one useful QR code right away.
- If the guest explicitly asks for all restroom locations, first say there are several around the course, then offer the nearest one with a QR code instead of reading coordinates aloud.


Portable charger flow
Trigger this only when the guest is asking about phone charging, charger rental, borrowing a battery, or returning one, and the configured kiosk service supports charger rental.


If the guest seems unfamiliar with the service, explain the rental policy from the event data naturally and concisely. If no rental policy is configured, say that event staff can explain the rental details onsite.


Then ask:
Would you like to borrow a charger now?


If the guest says yes:
1. Say: Let me check if we have chargers available...
2. Trigger availability.


If the availability result says sold out:
- Say: We’re out here, but I can guide you to the next closest kiosk.
- If the kiosk flow supports it, immediately offer or trigger nearby kiosk directions.


If the availability result says chargers are available:
- Say: We’ve got [x] available.
- Trigger phonepad.
- When phonepad is displayed, say: Please enter your phone number on the screen.


After the phone number is entered:
- Trigger number validation.
- If validation is successful, say: You’ll get a code by text. Enter it now.
- Trigger pinpad.


When the PIN result is successful:
- Say: Perfect match. Dispensing your charger...
- Trigger dispense.


Timeout and cancellation behavior:
- If there is no user input after 30 seconds, or the user cancels, trigger stopTransaction.
- If a transaction is cancelled or times out, say a short reset message such as: No problem, we can start again whenever you’re ready.


Rental troubleshooting
If the guest says the charger is not working:
- Say: Give it a quick shake and check for three blue lights.
- Then say: If it’s still not working, your phone case might be the issue. I can help you swap it.
- If a swap or support tool exists, use it. If not, direct the guest to on-site staff.


Wi-Fi behavior
- Say exactly: Hold on while I grab the Wi-Fi info...
- Trigger getWiFi.
- When the tool returns successfully, say: Scan this QR code to connect to Wi-Fi.
- If network name or password is returned, you may also say them briefly before or after the QR instruction.


Weather behavior
- Say exactly: Let me check the forecast for you...
- Trigger getWeather.
- When the result returns, summarize the important part first.
- Then say: Here’s the latest forecast — it’s shown below.


Shuttle behavior
- If the guest asks about shuttle service, use the knowledge base and return the general shuttle information, including shuttle times for each day if available.
- Do not invent shuttle times.


Event-scope rule
- You may answer questions about the configured event, the venue, the kiosk service, and the configured event category or topic.
- Questions about the configured event topic are allowed when they are relevant to the event experience.
- Off-topic general knowledge questions should be redirected politely.
- Example: I am here mainly to help with this event, the venue, and this kiosk service.


Failure handling
- If a required tool fails, times out, or returns incomplete data, say that you couldn’t fetch the latest information right now.
- Then give the safest fallback from the event data, such as directing the guest to event staff, the information desk, or another approved source.
- Never fabricate tool results.


Safety and honesty
- Never pretend to see lines, crowds, screens, or a person’s device.
- Never claim a charger was dispensed unless the dispense tool confirms it.
- Never claim directions are on screen unless the tool result confirms they are displayed.
- Never claim Wi-Fi details or weather unless the tool returned them.


Final response discipline
- Keep replies short.
- End with a single clear next step.
- Do not stack multiple instructions in one answer unless the kiosk flow truly requires it.`;
const DEFAULT_AGENT = Object.freeze({
  templateAgentId: '',
  agentId: '',
  name: '',
  firstMessage: '',
  systemPrompt: STANDARD_SYSTEM_PROMPT,
  syncStatus: '',
  syncError: '',
  lastSyncedAt: '',
  lastSyncedBy: null,
  kioskAgents: {},
});
const DEFAULT_BOOTH_CONTEXT = Object.freeze({
  assistantName: '',
  locationName: '',
  zone: '',
  landmark: '',
  directionsNotes: '',
  mapX: '',
  mapY: '',
});

const AI_BOOTH_TYPE = 'CA36';
const TOPIC_LONG_PRESS_MS = 520;
const PREDEFINED_TOPICS = Object.freeze([
  {
    title: 'Phone Chargers',
    summary: 'Portable charger rental, returns, availability, dispensing, and troubleshooting.',
  },
  {
    title: 'WIFI',
    summary: 'Event Wi-Fi network details, QR code flow, and connection support.',
  },
  {
    title: 'Shuttle Service',
    summary: 'Shuttle pickup areas, service windows, routes, and guest transportation notes.',
  },
  {
    title: 'Bathrooms',
    summary: 'Nearest restroom, bathroom, or washroom directions from each kiosk.',
  },
  {
    title: 'Parking',
    summary: 'Parking areas, drop-off zones, rideshare points, and exit guidance.',
  },
]);
const TOPIC_COLORS = ['#38bdf8', '#2dd4bf', '#f59e0b', '#f472b6', '#a78bfa', '#34d399'];
const COUNTRY_OPTIONS = Object.freeze([
  { value: 'US', label: 'US' },
  { value: 'CA', label: 'Canada' },
  { value: 'FR', label: 'France' },
]);
const FIELD_CLASSES = 'mt-2 w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_DAYS = Object.freeze([
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
]);

function createDefaultGeneral() {
  return {
    ...DEFAULT_GENERAL,
    dailyHours: {},
  };
}

function createDefaultAgent() {
  return {
    ...DEFAULT_AGENT,
    kioskAgents: {},
  };
}

function createDefaultBoothContext() {
  return { ...DEFAULT_BOOTH_CONTEXT };
}

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

function createPresetTopicDraft(preset, index = 0) {
  return {
    ...createTopicDraft(index),
    title: preset.title,
    summary: preset.summary,
  };
}

function createEmptyEventDraft() {
  return {
    id: '',
    general: createDefaultGeneral(),
    agent: createDefaultAgent(),
    boothContexts: {},
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

function normalizeAgent(agent) {
  const source = agent && typeof agent === 'object' ? agent : {};

  return {
    ...createDefaultAgent(),
    templateAgentId: String(source.templateAgentId || ''),
    agentId: String(source.agentId || ''),
    name: String(source.name || ''),
    firstMessage: String(source.firstMessage || ''),
    systemPrompt: String(source.systemPrompt || STANDARD_SYSTEM_PROMPT),
    syncStatus: String(source.syncStatus || ''),
    syncError: String(source.syncError || ''),
    lastSyncedAt: normalizeTimestampValue(source.lastSyncedAt),
    lastSyncedBy: source.lastSyncedBy || null,
    kioskAgents: normalizeKioskAgents(source.kioskAgents),
  };
}

function normalizeKioskAgent(agent) {
  const source = agent && typeof agent === 'object' ? agent : {};

  return {
    agentId: String(source.agentId || ''),
    name: String(source.name || ''),
    syncStatus: String(source.syncStatus || ''),
    syncError: String(source.syncError || ''),
    lastSyncedAt: normalizeTimestampValue(source.lastSyncedAt),
    lastSyncedBy: source.lastSyncedBy || null,
  };
}

function normalizeKioskAgents(value) {
  const source = value && typeof value === 'object' ? value : {};

  return Object.entries(source).reduce((agentsByStation, [stationId, agent]) => {
    const normalizedStationId = String(stationId || '').trim();
    if (!normalizedStationId) {
      return agentsByStation;
    }

    return {
      ...agentsByStation,
      [normalizedStationId]: normalizeKioskAgent(agent),
    };
  }, {});
}

function normalizeBoothContext(context) {
  const source = context && typeof context === 'object' ? context : {};

  return {
    ...createDefaultBoothContext(),
    assistantName: String(source.assistantName || ''),
    locationName: String(source.locationName || ''),
    zone: String(source.zone || ''),
    landmark: String(source.landmark || ''),
    directionsNotes: String(source.directionsNotes || ''),
    mapX: String(source.mapX || ''),
    mapY: String(source.mapY || ''),
  };
}

function normalizeBoothContexts(value, boothStationIds = []) {
  const source = value && typeof value === 'object' ? value : {};

  return boothStationIds.reduce((contextsByStation, stationId) => ({
    ...contextsByStation,
    [stationId]: normalizeBoothContext(source[stationId]),
  }), {});
}

function normalizeElevenLabsAgent(agent) {
  const source = agent && typeof agent === 'object' ? agent : {};
  const agentId = String(source.agentId || source.agent_id || '').trim();

  return {
    agentId,
    name: String(source.name || 'Untitled agent').trim() || 'Untitled agent',
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
    archived: source.archived === true,
    createdAtUnixSecs: Number(source.createdAtUnixSecs || source.created_at_unix_secs || 0) || null,
  };
}

function normalizeElevenLabsAgents(value) {
  const agents = Array.isArray(value) ? value.map(normalizeElevenLabsAgent).filter((agent) => agent.agentId) : [];
  return agents.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeTimestampValue(value) {
  if (value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value || '');
}

function normalizeCountryValue(value) {
  const normalizedValue = String(value || '').trim().toUpperCase();

  if (normalizedValue === 'CA' || normalizedValue === 'CAN' || normalizedValue === 'CANADA') {
    return 'CA';
  }

  if (normalizedValue === 'FR' || normalizedValue === 'FRA' || normalizedValue === 'FRANCE') {
    return 'FR';
  }

  return 'US';
}

function normalizeDailyHoursEntry(value) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    openingHours: String(source.openingHours || ''),
    closingHours: String(source.closingHours || ''),
  };
}

function parseDateInput(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekdayKey(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase();
}

function createEventDays(startDate, endDate) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);

  if (!start || !end || end.getTime() < start.getTime()) {
    return [];
  }

  const days = [];
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_IN_MS) {
    const date = new Date(time);

    days.push({
      key: formatDateKey(date),
      weekdayKey: getWeekdayKey(date),
      weekdayLabel: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      dateLabel: date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    });
  }

  return days;
}

function normalizeDailyHours(value, eventDays = []) {
  const source = value && typeof value === 'object' ? value : {};

  if (eventDays.length > 0) {
    return eventDays.reduce((hoursByDay, day) => ({
      ...hoursByDay,
      [day.key]: normalizeDailyHoursEntry(source[day.key] || source[day.weekdayKey]),
    }), {});
  }

  return Object.entries(source).reduce((hoursByDay, [key, daySource]) => {
    if (!DATE_KEY_PATTERN.test(key) && !WEEK_DAYS.some((day) => day.key === key)) {
      return hoursByDay;
    }

    return {
      ...hoursByDay,
      [key]: normalizeDailyHoursEntry(daySource),
    };
  }, {});
}

function normalizeEvent(event) {
  const generalSource = event?.general && typeof event.general === 'object' ? event.general : {};
  const boothStationIds = Array.isArray(event?.boothStationIds)
    ? Array.from(new Set(event.boothStationIds.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  const hasLegacySharedHours = Boolean((generalSource.openingHours || generalSource.closingHours) && !generalSource.dailyHours);
  const sameHoursEveryDay = typeof generalSource.sameHoursEveryDay === 'boolean'
    ? generalSource.sameHoursEveryDay
    : hasLegacySharedHours;
  const eventDays = createEventDays(generalSource.startDate, generalSource.endDate);

  return {
    id: String(event?.id || '').trim(),
    general: {
      ...createDefaultGeneral(),
      eventName: String(generalSource.eventName || event?.name || ''),
      eventCategory: String(generalSource.eventCategory || ''),
      eventTopic: String(generalSource.eventTopic || generalSource.eventSport || ''),
      serviceName: String(generalSource.serviceName || 'Portable Charger Rental Kiosk'),
      address: String(generalSource.address || ''),
      city: String(generalSource.city || ''),
      zipCode: String(generalSource.zipCode || generalSource.zip || ''),
      country: normalizeCountryValue(generalSource.country),
      startDate: String(generalSource.startDate || ''),
      endDate: String(generalSource.endDate || ''),
      sameHoursEveryDay,
      openingHours: String(generalSource.openingHours || ''),
      closingHours: String(generalSource.closingHours || ''),
      dailyHours: normalizeDailyHours(generalSource.dailyHours, eventDays),
      rentalPolicy: String(generalSource.rentalPolicy || DEFAULT_RENTAL_POLICY),
      supportFallback: String(generalSource.supportFallback || DEFAULT_SUPPORT_FALLBACK),
      notes: String(generalSource.notes || ''),
    },
    agent: normalizeAgent(event?.agent),
    boothStationIds,
    boothContexts: normalizeBoothContexts(event?.boothContexts, boothStationIds),
    topics: Array.isArray(event?.topics) ? event.topics.map(normalizeTopic) : [],
    createdAt: normalizeTimestampValue(event?.createdAt),
    updatedAt: normalizeTimestampValue(event?.updatedAt),
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

function shouldPreferFirestoreEventLoad() {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false;
  }

  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function isFunctionEndpointUnavailable(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('load failed') ||
    message.includes('request failed (404)') ||
    message.includes('not found')
  );
}

async function loadEventsFromFirestore() {
  const snapshot = await getDocs(collection(db, 'aiBoothEvents'));
  return sortEvents(snapshot.docs.map((docSnap) => normalizeEvent({
    id: docSnap.id,
    ...docSnap.data(),
  })));
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

function GeneralField({ label, type = 'text', value, onChange, placeholder, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={5}
          className={`${FIELD_CLASSES} resize-y`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={FIELD_CLASSES}
        />
      )}
    </label>
  );
}

function CountrySwitch({ value, onChange, className = '' }) {
  const selectedValue = normalizeCountryValue(value);

  return (
    <fieldset className={`block ${className}`}>
      <legend className="text-sm font-semibold text-slate-700">Country</legend>
      <div className="mt-2 grid grid-cols-3 rounded-md bg-gray-100 p-1 shadow-inner">
        {COUNTRY_OPTIONS.map((option) => {
          const isSelected = selectedValue === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`min-h-[42px] rounded-md px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                isSelected
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white hover:text-gray-900'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ElevenLabsAgentPicker({
  value,
  agents,
  loading,
  error,
  onChange,
  onRefresh,
}) {
  const selectedAgent = agents.find((agent) => agent.agentId === value);
  const selectValue = selectedAgent ? value : '';

  return (
    <div className="md:col-span-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="text-sm font-semibold text-slate-700">Template Agent</span>
          <select
            value={selectValue}
            onChange={(event) => onChange(event.target.value)}
            disabled={loading}
            className={FIELD_CLASSES}
          >
            <option value="">{loading ? 'Loading ElevenLabs agents...' : 'Select an ElevenLabs agent'}</option>
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.name} ({agent.agentId})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-md bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-gray-200 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm font-medium text-rose-700">{error}</p>
      )}
      <GeneralField
        label="Template Agent ID"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="agent_..."
      />
    </div>
  );
}

function HoursSchedule({
  general,
  onSameHoursChange,
  onSharedHoursChange,
  onDailyHoursChange,
}) {
  const sameHoursEveryDay = general.sameHoursEveryDay === true;
  const eventDays = createEventDays(general.startDate, general.endDate);
  const dailyHours = normalizeDailyHours(general.dailyHours, eventDays);
  const hasDateInputs = Boolean(general.startDate && general.endDate);

  return (
    <section className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Opening Hours</h3>
          {eventDays.length > 0 && (
            <p className="mt-1 text-sm text-slate-600">
              {eventDays.length} {eventDays.length === 1 ? 'event day' : 'event days'}
            </p>
          )}
        </div>
        <label className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm">
          <input
            type="checkbox"
            checked={sameHoursEveryDay}
            onChange={(event) => onSameHoursChange(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Same time every day
        </label>
      </div>

      {eventDays.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-white px-4 py-5 text-sm text-slate-600">
          {hasDateInputs ? 'End date must be on or after start date.' : 'Set start and end dates to generate opening hours.'}
        </div>
      ) : sameHoursEveryDay ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <GeneralField
            label="Opening Time"
            type="time"
            value={general.openingHours}
            onChange={(event) => onSharedHoursChange('openingHours', event.target.value)}
          />
          <GeneralField
            label="Closing Time"
            type="time"
            value={general.closingHours}
            onChange={(event) => onSharedHoursChange('closingHours', event.target.value)}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {eventDays.map((day) => (
            <div
              key={day.key}
              className="grid gap-3 rounded-md border border-gray-200 bg-white p-3 sm:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800">{day.weekdayLabel}</p>
                <p className="mt-0.5 text-xs font-medium text-slate-500">{day.dateLabel}</p>
              </div>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Open</span>
                <input
                  type="time"
                  aria-label={`${day.weekdayLabel} ${day.dateLabel} opening time`}
                  value={dailyHours[day.key].openingHours}
                  onChange={(event) => onDailyHoursChange(day.key, 'openingHours', event.target.value)}
                  className={FIELD_CLASSES}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Close</span>
                <input
                  type="time"
                  aria-label={`${day.weekdayLabel} ${day.dateLabel} closing time`}
                  value={dailyHours[day.key].closingHours}
                  onChange={(event) => onDailyHoursChange(day.key, 'closingHours', event.target.value)}
                  className={FIELD_CLASSES}
                />
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
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
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('event');
  const [activeTabId, setActiveTabId] = useState('general');
  const [topicPresetMenuOpen, setTopicPresetMenuOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [elevenLabsAgents, setElevenLabsAgents] = useState([]);
  const [elevenLabsAgentsLoading, setElevenLabsAgentsLoading] = useState(false);
  const [elevenLabsAgentsError, setElevenLabsAgentsError] = useState('');
  const topicLongPressTimerRef = useRef(null);
  const topicLongPressTriggeredRef = useRef(false);

  useEffect(() => () => {
    if (topicLongPressTimerRef.current) {
      window.clearTimeout(topicLongPressTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    function applyLoadedEvents(nextEvents) {
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
    }

    async function loadEvents() {
      setLoading(true);
      setLoadError('');

      if (shouldPreferFirestoreEventLoad()) {
        try {
          const nextEvents = await loadEventsFromFirestore();
          if (isCancelled) return;

          applyLoadedEvents(nextEvents);
          setLoading(false);
          return;
        } catch (fallbackError) {
          if (!isCancelled) {
            console.warn('[AiBoothsPage] Firestore-first load failed, falling back to Cloud Function.', fallbackError);
          }
        }
      }

      try {
        const response = await callFunctionWithAuth('aiBooths_listEvents');
        if (isCancelled) return;

        const nextEvents = sortEvents((response?.events || []).map(normalizeEvent));
        applyLoadedEvents(nextEvents);
      } catch (error) {
        if (isCancelled) return;

        if (isFunctionEndpointUnavailable(error)) {
          try {
            const nextEvents = await loadEventsFromFirestore();
            if (isCancelled) return;

            applyLoadedEvents(nextEvents);
            return;
          } catch (fallbackError) {
            console.error(fallbackError);
          }
        }

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
    let isCancelled = false;

    loadElevenLabsAgents({
      isCancelled: () => isCancelled,
      showStatus: false,
    });

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
      if (!stationId || getBoothType(kiosk) !== AI_BOOTH_TYPE) {
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
  const syncedKioskAgentCount = eventDraft.boothStationIds.filter((stationId) => (
    Boolean(eventDraft.agent?.kioskAgents?.[stationId]?.agentId)
  )).length;
  const handleNavigateToProvision = () => {
    onNavigateToProvisionPage?.();
  };

  async function loadElevenLabsAgents({ isCancelled = () => false, showStatus = true } = {}) {
    setElevenLabsAgentsLoading(true);
    setElevenLabsAgentsError('');

    try {
      const response = await callFunctionWithAuth('aiBooths_listElevenLabsAgents');
      if (isCancelled()) {
        return;
      }

      const nextAgents = normalizeElevenLabsAgents(response?.agents);
      setElevenLabsAgents(nextAgents);

      if (showStatus) {
        setStatus({ state: 'success', message: `Loaded ${nextAgents.length} ElevenLabs agents.` });
      }
    } catch (error) {
      if (isCancelled()) {
        return;
      }

      console.error(error);
      const message = isFunctionEndpointUnavailable(error)
        ? 'ElevenLabs agent list endpoint is unavailable. Deploy the updated AI booth functions.'
        : (error?.message || 'Failed to load ElevenLabs agents.');
      setElevenLabsAgents([]);
      setElevenLabsAgentsError(message);

      if (showStatus) {
        setStatus({ state: 'error', message });
      }
    } finally {
      if (!isCancelled()) {
        setElevenLabsAgentsLoading(false);
      }
    }
  }

  function markDirty() {
    setDirty(true);
  }

  function handleOpenEvent(nextEvent) {
    setSelectedEventId(nextEvent?.id || '');
    setEventDraft(nextEvent ? cloneEvent(nextEvent) : createEmptyEventDraft());
    setActiveWorkspaceTab('event');
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

  function updateAgentField(field, value) {
    setEventDraft((current) => ({
      ...current,
      agent: {
        ...current.agent,
        [field]: value,
      },
    }));
    markDirty();
  }

  function updateDailyHoursField(dayKey, field, value) {
    setEventDraft((current) => {
      const currentDailyHours = normalizeDailyHours(
        current.general.dailyHours,
        createEventDays(current.general.startDate, current.general.endDate)
      );

      return {
        ...current,
        general: {
          ...current.general,
          dailyHours: {
            ...currentDailyHours,
            [dayKey]: {
              ...currentDailyHours[dayKey],
              [field]: value,
            },
          },
        },
      };
    });
    markDirty();
  }

  function updateBoothContextField(stationId, field, value) {
    setEventDraft((current) => ({
      ...current,
      boothContexts: {
        ...(current.boothContexts || {}),
        [stationId]: {
          ...createDefaultBoothContext(),
          ...(current.boothContexts?.[stationId] || {}),
          [field]: value,
        },
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

  function addTopic(nextTopic) {
    setEventDraft((current) => ({
      ...current,
      topics: [...current.topics, nextTopic],
    }));
    setActiveTabId(nextTopic.id);
    markDirty();
  }

  function handleAddTopic() {
    setTopicPresetMenuOpen(false);
    addTopic(createTopicDraft(eventDraft.topics.length));
  }

  function handleAddPresetTopic(preset) {
    setTopicPresetMenuOpen(false);
    addTopic(createPresetTopicDraft(preset, eventDraft.topics.length));
  }

  function clearTopicLongPressTimer() {
    if (topicLongPressTimerRef.current) {
      window.clearTimeout(topicLongPressTimerRef.current);
      topicLongPressTimerRef.current = null;
    }
  }

  function handleAddTopicPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    topicLongPressTriggeredRef.current = false;
    clearTopicLongPressTimer();
    topicLongPressTimerRef.current = window.setTimeout(() => {
      topicLongPressTriggeredRef.current = true;
      setTopicPresetMenuOpen(true);
    }, TOPIC_LONG_PRESS_MS);
  }

  function handleAddTopicPointerEnd() {
    clearTopicLongPressTimer();
    if (topicLongPressTriggeredRef.current) {
      window.setTimeout(() => {
        topicLongPressTriggeredRef.current = false;
      }, 500);
    }
  }

  function handleAddTopicClick() {
    clearTopicLongPressTimer();

    if (topicLongPressTriggeredRef.current) {
      topicLongPressTriggeredRef.current = false;
      return;
    }

    handleAddTopic();
  }

  function handleAddTopicContextMenu(event) {
    event.preventDefault();
    clearTopicLongPressTimer();
    topicLongPressTriggeredRef.current = false;
    setTopicPresetMenuOpen(true);
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
      const nextBoothContexts = { ...(current.boothContexts || {}) };
      const nextKioskAgents = { ...(current.agent?.kioskAgents || {}) };
      if (selectedIds.has(stationId)) {
        selectedIds.delete(stationId);
        delete nextBoothContexts[stationId];
        delete nextKioskAgents[stationId];
      } else {
        selectedIds.add(stationId);
        nextBoothContexts[stationId] = nextBoothContexts[stationId] || createDefaultBoothContext();
      }

      return {
        ...current,
        agent: {
          ...current.agent,
          kioskAgents: nextKioskAgents,
        },
        boothStationIds: [...selectedIds].sort(),
        boothContexts: nextBoothContexts,
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
      if (isFunctionEndpointUnavailable(error)) {
        setStatus({
          state: 'error',
          message: 'AI booth save endpoint is unavailable. Deploy the AI booth functions, then try saving again.',
        });
        return;
      }

      setStatus({ state: 'error', message: error?.message || 'Failed to save AI booth event.' });
    }
  }

  async function handlePublishAgent() {
    const eventId = selectedEventId || eventDraft.id;
    const templateAgentId = String(eventDraft.agent?.templateAgentId || '').trim();

    if (!eventId) {
      setStatus({ state: 'error', message: 'Save the event before creating kiosk agents.' });
      return;
    }

    if (dirty) {
      setStatus({ state: 'error', message: 'Save event changes before creating kiosk agents.' });
      return;
    }

    if (eventDraft.boothStationIds.length === 0) {
      setStatus({ state: 'error', message: 'Assign at least one CA36 booth before creating kiosk agents.' });
      return;
    }

    if (!templateAgentId) {
      setStatus({ state: 'error', message: 'Template agent ID is required before creating kiosk agents.' });
      return;
    }

    setStatus({ state: 'sending', message: `Creating or syncing ${eventDraft.boothStationIds.length} kiosk agents...` });

    try {
      const response = await callFunctionWithAuth('aiBooths_publishAgent', { eventId });
      const savedEvent = normalizeEvent(response?.event || {});
      const syncedCount = Number(response?.syncedCount || 0);
      const failedCount = Number(response?.failedCount || 0);

      setEvents((current) => sortEvents([savedEvent, ...current.filter((item) => item.id !== savedEvent.id)]));
      setSelectedEventId(savedEvent.id);
      setEventDraft(cloneEvent(savedEvent));
      setDirty(false);

      if (failedCount > 0) {
        setStatus({
          state: syncedCount > 0 ? 'pending' : 'error',
          message: `Kiosk agents synced: ${syncedCount}, failed: ${failedCount}.`,
        });
        return;
      }

      setStatus({ state: 'success', message: `Kiosk agents synced: ${syncedCount}.` });
    } catch (error) {
      console.error(error);
      setStatus({ state: 'error', message: error?.message || 'Failed to create kiosk agents.' });
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
            <h1 className="text-2xl font-bold text-gray-900">AI Booth Management</h1>
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

        <nav className="flex flex-wrap items-end gap-1 border-b border-violet-200">
          {[
            { id: 'event', label: 'Event Management' },
            { id: 'agent', label: 'Agent Management' },
          ].map((tab) => {
            const isActive = activeWorkspaceTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveWorkspaceTab(tab.id)}
                className={`rounded-t-lg border px-5 py-3 text-sm font-bold shadow-sm transition ${
                  isActive
                    ? '-mb-px border-violet-300 border-b-violet-100 bg-violet-100 text-violet-950'
                    : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeWorkspaceTab === 'event' ? (
        <>
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

                <div className="relative self-start lg:self-auto">
                  <button
                    type="button"
                    onClick={handleAddTopicClick}
                    onPointerDown={handleAddTopicPointerDown}
                    onPointerUp={handleAddTopicPointerEnd}
                    onPointerCancel={handleAddTopicPointerEnd}
                    onPointerLeave={handleAddTopicPointerEnd}
                    onContextMenu={handleAddTopicContextMenu}
                    aria-haspopup="menu"
                    aria-expanded={topicPresetMenuOpen}
                    className="inline-flex h-11 w-11 select-none items-center justify-center rounded-md bg-blue-600 text-2xl font-light text-white transition hover:bg-blue-700"
                    title="Add topic. Long press for presets."
                  >
                    +
                  </button>

                  {topicPresetMenuOpen && (
                    <>
                      <button
                        type="button"
                        aria-label="Close topic presets"
                        onClick={() => setTopicPresetMenuOpen(false)}
                        className="fixed inset-0 z-20 cursor-default bg-transparent"
                      />
                      <div
                        role="menu"
                        className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-md border border-violet-100 bg-white py-2 shadow-xl ring-1 ring-black/5"
                      >
                        {PREDEFINED_TOPICS.map((preset) => (
                          <button
                            key={preset.title}
                            type="button"
                            role="menuitem"
                            onClick={() => handleAddPresetTopic(preset)}
                            className="block w-full px-4 py-3 text-left transition hover:bg-violet-50 focus:bg-violet-50 focus:outline-none"
                          >
                            <span className="block text-sm font-semibold text-slate-900">{preset.title}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-slate-500">{preset.summary}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="p-5 sm:p-6">
                {activeTabId === 'general' ? (
                  <div className="space-y-6">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">General</p>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <GeneralField
                        label="Event Name"
                        value={eventDraft.general.eventName}
                        onChange={(event) => updateGeneralField('eventName', event.target.value)}
                        placeholder="CES 2027"
                        className="md:col-span-2"
                      />
                      <GeneralField
                        label="Event Category"
                        value={eventDraft.general.eventCategory}
                        onChange={(event) => updateGeneralField('eventCategory', event.target.value)}
                        placeholder="Golf tournament"
                      />
                      <GeneralField
                        label="Event Topic"
                        value={eventDraft.general.eventTopic}
                        onChange={(event) => updateGeneralField('eventTopic', event.target.value)}
                        placeholder="Golf"
                      />
                      <GeneralField
                        label="Kiosk Service"
                        value={eventDraft.general.serviceName}
                        onChange={(event) => updateGeneralField('serviceName', event.target.value)}
                        placeholder="Portable Charger Rental Kiosk"
                        className="md:col-span-2"
                      />
                      <GeneralField
                        label="Address"
                        value={eventDraft.general.address}
                        onChange={(event) => updateGeneralField('address', event.target.value)}
                        placeholder="201 Sands Ave"
                      />
                      <GeneralField
                        label="City"
                        value={eventDraft.general.city}
                        onChange={(event) => updateGeneralField('city', event.target.value)}
                        placeholder="Las Vegas"
                      />
                      <GeneralField
                        label="Zip Code"
                        value={eventDraft.general.zipCode}
                        onChange={(event) => updateGeneralField('zipCode', event.target.value)}
                        placeholder="89169"
                      />
                      <CountrySwitch
                        value={eventDraft.general.country}
                        onChange={(value) => updateGeneralField('country', value)}
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
                      <HoursSchedule
                        general={eventDraft.general}
                        onSameHoursChange={(checked) => updateGeneralField('sameHoursEveryDay', checked)}
                        onSharedHoursChange={(field, value) => updateGeneralField(field, value)}
                        onDailyHoursChange={updateDailyHoursField}
                      />
                    </div>

                    <GeneralField
                      label="Rental Policy"
                      type="textarea"
                      value={eventDraft.general.rentalPolicy}
                      onChange={(event) => updateGeneralField('rentalPolicy', event.target.value)}
                      placeholder={DEFAULT_RENTAL_POLICY}
                    />

                    <GeneralField
                      label="Support Fallback"
                      value={eventDraft.general.supportFallback}
                      onChange={(event) => updateGeneralField('supportFallback', event.target.value)}
                      placeholder={DEFAULT_SUPPORT_FALLBACK}
                    />

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
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Assign {AI_BOOTH_TYPE} event booths</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    These assignments are pulled from kiosks whose hardware type is set to <span className="font-semibold text-slate-900">{AI_BOOTH_TYPE}</span>.
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
                    No kiosks with type <span className="font-semibold text-slate-900">{AI_BOOTH_TYPE}</span> are available in the current dashboard feed yet.
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
                  {assignedBooths.map((booth) => {
                    const kioskAgent = eventDraft.agent?.kioskAgents?.[booth.stationid] || null;

                    return (
                      <div key={booth.stationid} className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{booth.stationid}</p>
                            <p className="mt-1 text-sm text-slate-600">{getBoothLocationLabel(booth)}</p>
                            {kioskAgent?.agentId && (
                              <p className="mt-1 break-all font-mono text-xs text-slate-500">{kioskAgent.agentId}</p>
                            )}
                          </div>
                          <span className={`rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${
                            kioskAgent?.agentId
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-white text-slate-600'
                          }`}
                          >
                            {kioskAgent?.agentId ? 'Synced' : (getBoothType(booth) || 'Stored')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
        </>
        ) : (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">ElevenLabs Kiosk Agents</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Agent setup</h2>
                  <p className="mt-2 text-sm font-medium text-slate-700">
                    {syncedKioskAgentCount} / {eventDraft.boothStationIds.length} kiosk agents synced
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePublishAgent}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  Create / Sync Kiosk Agents
                </button>
              </div>

              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <ElevenLabsAgentPicker
                  value={eventDraft.agent?.templateAgentId || ''}
                  agents={elevenLabsAgents}
                  loading={elevenLabsAgentsLoading}
                  error={elevenLabsAgentsError}
                  onChange={(value) => updateAgentField('templateAgentId', value)}
                  onRefresh={() => loadElevenLabsAgents({ showStatus: true })}
                />
                <GeneralField
                  label="Agent Name Prefix"
                  value={eventDraft.agent?.name || ''}
                  onChange={(event) => updateAgentField('name', event.target.value)}
                  placeholder="CES 2027"
                />
              </div>

              <div className="mt-5 space-y-5">
                <GeneralField
                  label="Welcome Message"
                  type="textarea"
                  value={eventDraft.agent?.firstMessage || ''}
                  onChange={(event) => updateAgentField('firstMessage', event.target.value)}
                  placeholder="Welcome to the event. How can I help you today?"
                />
                <GeneralField
                  label="System Prompt"
                  type="textarea"
                  value={eventDraft.agent?.systemPrompt || ''}
                  onChange={(event) => updateAgentField('systemPrompt', event.target.value)}
                  placeholder="Standard AI booth concierge prompt."
                />
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Agent Status</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Template</p>
                  <p className="mt-3 break-all font-mono text-xs font-semibold text-gray-900">
                    {eventDraft.agent?.templateAgentId || 'Not selected'}
                  </p>
                </div>
                <div className="rounded-md bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Assigned</p>
                  <p className="mt-3 text-3xl font-semibold text-gray-900">{eventDraft.boothStationIds.length}</p>
                </div>
                <div className="rounded-md bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Synced</p>
                  <p className="mt-3 text-3xl font-semibold text-gray-900">{syncedKioskAgentCount}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Kiosk Context</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Agent locations</h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveWorkspaceTab('event')}
                className="rounded-md bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-200"
              >
                Assign Booths
              </button>
            </div>

            {assignedBooths.length === 0 ? (
              <div className="mt-5 rounded-md border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-sm text-gray-600">
                No booths assigned yet.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {assignedBooths.map((booth) => {
                  const boothContext = eventDraft.boothContexts?.[booth.stationid] || createDefaultBoothContext();
                  const kioskAgent = eventDraft.agent?.kioskAgents?.[booth.stationid] || null;

                  return (
                    <div key={booth.stationid} className="rounded-md border border-gray-200 bg-gray-50 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{booth.stationid}</p>
                          <p className="mt-1 text-sm text-slate-600">{getBoothLocationLabel(booth)}</p>
                          {kioskAgent?.agentId && (
                            <p className="mt-1 break-all font-mono text-xs text-slate-500">{kioskAgent.agentId}</p>
                          )}
                        </div>
                        <span className={`rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${
                          kioskAgent?.agentId
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-white text-slate-600'
                        }`}
                        >
                          {kioskAgent?.agentId ? 'Synced' : 'Pending'}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <GeneralField
                          label="Assistant Name"
                          value={boothContext.assistantName}
                          onChange={(event) => updateBoothContextField(booth.stationid, 'assistantName', event.target.value)}
                          placeholder={`Kiosk ${booth.stationid}`}
                        />
                        <GeneralField
                          label="Event Location"
                          value={boothContext.locationName}
                          onChange={(event) => updateBoothContextField(booth.stationid, 'locationName', event.target.value)}
                          placeholder={getBoothLocationLabel(booth)}
                        />
                        <GeneralField
                          label="Zone"
                          value={boothContext.zone}
                          onChange={(event) => updateBoothContextField(booth.stationid, 'zone', event.target.value)}
                          placeholder="Hall B / North aisle"
                        />
                        <GeneralField
                          label="Nearby Landmark"
                          value={boothContext.landmark}
                          onChange={(event) => updateBoothContextField(booth.stationid, 'landmark', event.target.value)}
                          placeholder="Beside registration"
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <GeneralField
                            label="Map X"
                            value={boothContext.mapX}
                            onChange={(event) => updateBoothContextField(booth.stationid, 'mapX', event.target.value)}
                            placeholder="0"
                          />
                          <GeneralField
                            label="Map Y"
                            value={boothContext.mapY}
                            onChange={(event) => updateBoothContextField(booth.stationid, 'mapY', event.target.value)}
                            placeholder="0"
                          />
                        </div>
                      </div>

                      <div className="mt-3">
                        <GeneralField
                          label="Directions Notes"
                          type="textarea"
                          value={boothContext.directionsNotes}
                          onChange={(event) => updateBoothContextField(booth.stationid, 'directionsNotes', event.target.value)}
                          placeholder="Use this booth as the starting point for closest-location answers."
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
        )}
      </main>
    </div>
  );
}
