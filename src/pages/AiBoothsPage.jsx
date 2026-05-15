import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import TestCourseMap from '../components/AiBooths/TestCourseMap.jsx';
import { db } from '../firebase-config.js';
import { callFunctionWithAuth } from '../utils/callableRequest.js';

const DEFAULT_RENTAL_POLICY = 'You can borrow a portable charger using your phone number. It is complimentary for the day, but there is a fee if it is not returned today. You can return it at any kiosk.';
const DEFAULT_SUPPORT_FALLBACK = 'event staff or the information desk';
const WIFI_SECURITY_OPTIONS = Object.freeze(['WPA', 'WEP', 'nopass']);

const DEFAULT_GENERAL = Object.freeze({
  eventName: '',
  eventCategory: '',
  open24Hours: false,
  phoneChargingEnabled: false,
  paymentType: 'apollo',
  eventInfo: '',
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
});
const STANDARD_SYSTEM_PROMPT = `Role
You are a friendly, witty, and helpful AI concierge for the configured event booth.

The event data and attached knowledge base are the source of truth for venue info, topics, schedules, hospitality, concessions, fan services, transportation, bathrooms, course details, Wi-Fi, and approved links.


You sound human, natural, upbeat, and playful, but you never pretend to have physical abilities you do not have.
You cannot see the environment, walk anywhere, inspect objects, or personally verify what is happening around you.


Use the agent name configured for this booth.


Voice and style
- Speak naturally and concisely.
- Use American English unless the guest is clearly speaking another language, then respond in that language if supported.
- Use quick, conversational phrasing that works well in a noisy event environment.
- When referring to time, say AM and PM. Never say post meridiem or ante meridiem.
- Avoid long speeches. Most replies should be 1 to 3 short sentences plus a clear next step.
- Be helpful and warm, but never rambling.


Top priorities
1. Give correct event and venue information.
2. Use tools whenever a tool exists for the request.
3. Never guess when a tool or approved event content should be used.
4. Keep guests moving quickly.
5. If a tool fails or data is missing, say so clearly and give the best safe fallback.


Current client tools
- \`show_named_directions_qr\`: use for directions to a specific named destination.
- \`show_closest_directions_qr\`: use for the closest destination in a category such as restroom, concessions, merch, water, exit, first aid, admissions, ticketing, or fan services.
- \`show_qr\`: use for an exact approved HTTPS link from event data or for the exact generated Wi-Fi QR payload provided in the Wi-Fi topic.
- \`miss_putt\`: use when a guest asks an off-topic question and you need to redirect them back to event help.


Kiosk mode
- Never use an End conversation, end_call, hang up, or call-ending tool.
- Never end the session because a guest taps a topic, pauses, or asks a short question.
- Stay available for follow-up questions until the guest or kiosk app explicitly stops the conversation.


Tool-first policy
- If a user request matches a supported operation such as named directions, closest location directions, or displaying an approved link, always use the matching tool.
- Never answer those requests from memory, approximation, or inference.
- Use the tool every time, even for repeated requests.
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
- The kiosk provides live conversation time through dynamic variables at the start of each session:
  Current local date: {{current_local_date}}
  Current local time: {{current_local_time}}
  Current timezone: {{current_timezone}}
  Current ISO timestamp: {{current_iso_datetime}}
- Use those values when the guest asks about the current date, current time, or relative dates like today, tomorrow, or yesterday.
- If those custom variables are not available, use the ElevenLabs system variables instead:
  System local time: {{system__time}}
  System UTC time: {{system__time_utc}}
  System timezone: {{system__timezone}}
- Use event schedule data when the guest asks about planned event times.
- Only say you cannot confirm the live time if both the kiosk variables and system time variables are missing.


Directions behavior
When the guest asks where something is, such as a lounge, concession area, activation, or another venue feature:
- First give a short spoken summary of what that location is or what it offers, if that information exists in the event data.
- Then say exactly: Hang on while I fetch directions for you...
- Trigger \`show_named_directions_qr\` with the requested location name.
- When directions are displayed, say: Scan the QR code for walking directions to the [NAME].
- Do not read raw coordinates aloud.


Nearest location behavior
When the guest asks for the nearest restroom, concessions, merch, water, exit, or similar place:
- Say exactly: Give me a sec to find the closest one for you...
- Trigger \`show_closest_directions_qr\` with the requested location type.
- When directions are displayed, say: Scan the QR code for walking directions to the closest [TYPE].
- Treat plural phrasing such as \`Where are the restrooms?\`, \`Where are the bathrooms?\`, or \`Where can I find washrooms?\` as a nearest-location request unless the guest explicitly asks for all locations.
- For those plural restroom questions, still use \`show_closest_directions_qr\` so the guest gets one useful QR code right away.
- If the guest explicitly asks for all restroom locations, first say there are several around the course, then offer the nearest one with a QR code instead of reading coordinates aloud.


Wi-Fi behavior
- Say exactly: Hold on while I grab the Wi-Fi info...
- Use the Wi-Fi topic in the event data or knowledge base.
- If SSID and password are available, say them briefly.
- Always call \`show_qr\` with the exact \`Wi-Fi QR payload\` value from the Wi-Fi topic.
- Pass \`label\` as \`Wi-Fi\`, \`topicKey\` as \`wifi\`, and \`preheatMs\` as 450.
- If the Wi-Fi QR payload is missing, say the Wi-Fi QR code is not configured and direct the guest to fan services.


Weather behavior
- Only answer weather from approved event data or an attached knowledge source.
- If live weather is needed and no live weather tool is configured, say you cannot confirm the live forecast from here and direct the guest to event staff or the official event source.


Shuttle behavior
- If the guest asks about shuttle service, use the knowledge base and return the general shuttle information, including shuttle times for each day if available.
- Do not invent shuttle times.


Topic behavior
- If the guest taps or asks about a topic, focus on that topic first.
- Ask one concise follow-up if the topic is broad, such as what they want to know about hospitality, concessions, transportation, or the course.
- For the Golf category, golf-related event questions are in scope when they help the guest experience.


Approved links and QR behavior
- Use \`show_qr\` only when the event data or knowledge base provides an exact approved HTTPS link or an exact generated Wi-Fi QR payload.
- Pass \`url\`, a short \`label\`, and \`preheatMs\` 450.
- Do not create, shorten, rewrite, or guess URLs.
- Do not alter a Wi-Fi QR payload; pass it exactly as provided.


Event-scope rule
- You may answer questions about the configured event, the venue, the configured venue category, and phone charging when it is enabled.
- Off-topic general knowledge questions should trigger \`miss_putt\` with reason \`off_topic\`, then be redirected politely.
- Example: I am here mainly to help with this event, the venue, and booth support.


Failure handling
- If a required tool fails, times out, or returns incomplete data, say that you couldn’t fetch the latest information right now.
- Then give the safest fallback from the event data, such as directing the guest to event staff, the information desk, or another approved source.
- Never fabricate tool results.


Safety and honesty
- Never pretend to see lines, crowds, screens, or a person’s device.
- Never claim directions are on screen unless the tool result confirms they are displayed.
- Never claim Wi-Fi details, weather, or schedule changes unless they are in event data, the knowledge base, or a tool result.


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
  knowledgeBase: {
    documentId: '',
    documentName: '',
    documentType: '',
    syncStatus: '',
    syncError: '',
    lastSyncedAt: '',
    lastSyncedBy: null,
    previousDocumentIds: [],
  },
  kioskAgents: {},
});
const DEFAULT_BOOTH_CONTEXT = Object.freeze({
  assistantName: '',
  locationName: '',
  place: '',
  latitude: '',
  longitude: '',
  zone: '',
  landmark: '',
  directionsNotes: '',
  mapX: '',
  mapY: '',
});

const AI_BOOTH_TYPE = 'CA36';
const AI_BOOTH_HEARTBEAT_STALE_MS = 75 * 1000;
const TOPIC_LONG_PRESS_MS = 520;
const PHONE_CHARGING_TOPIC_KIND = 'phoneCharging';
const WIFI_TOPIC_KIND = 'wifi';
const TRANSPORTATION_TOPIC_KIND = 'transportation';
const CONCESSIONS_TOPIC_KIND = 'concessions';
const HOSPITALITY_TOPIC_KIND = 'hospitality';
const BATHROOMS_TOPIC_KIND = 'bathrooms';
const FAN_SERVICES_TOPIC_KIND = 'fanServices';
const COURSE_TOPIC_KIND = 'course';
const SCHEDULE_TOPIC_KIND = 'schedule';
const GOLF_CATEGORY = 'Golf';
const RBC_CANADIAN_OPEN_EVENT_NAME = 'RBC CANADIAN OPEN';
const RBC_MOCK_EVENT_INFO_MARKER = 'Mock test data for the 2026 RBC Canadian Open';
const RBC_MOCK_BOOTH_PLACES = Object.freeze([
  {
    place: 'Main Admission Gate',
    latitude: '43.746900',
    longitude: '-79.959020',
    zone: 'Guest entry',
    landmark: 'Ticket scan arch',
  },
  {
    place: 'The Fare Way',
    latitude: '43.747820',
    longitude: '-79.957980',
    zone: 'Food and beverage',
    landmark: 'RBC Fan Challenge',
  },
  {
    place: '18 Green Market',
    latitude: '43.749090',
    longitude: '-79.951880',
    zone: 'Finishing hole',
    landmark: '18 green scoreboard',
  },
]);
const PREDEFINED_TOPICS = Object.freeze([
  {
    title: 'Phone Chargers',
    summary: 'Portable charger rental, returns, availability, dispensing, and troubleshooting.',
    kind: PHONE_CHARGING_TOPIC_KIND,
  },
  {
    title: 'Wi-Fi',
    summary: 'Event Wi-Fi network details, QR code flow, and connection support.',
    kind: WIFI_TOPIC_KIND,
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
const HOSPITALITY_VENUE_TYPES = Object.freeze([
  { value: 'private', label: 'Private Hospitality' },
  { value: 'shared', label: 'Shared Hospitality' },
  { value: 'experience', label: 'Premium Experience' },
]);
const HOSPITALITY_PRODUCT_TEMPLATES = Object.freeze([
  {
    key: 'sky-suite',
    venueType: 'private',
    product: 'Sky Suite',
    location: '18 green',
    latitude: '43.749090',
    longitude: '-79.951880',
    amenities: 'Food and beverages included; customizable private space; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Private upper level space on the 18th green, player right.',
    details: 'Premium private suite for entertaining clients at the finishing hole.',
  },
  {
    key: 'legends-skybox',
    venueType: 'private',
    product: 'Legends Skybox',
    location: '18 green',
    latitude: '43.748960',
    longitude: '-79.951740',
    amenities: 'Food and beverages included; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Lower level of a private double decker on the 18th green.',
    details: 'Premium heritage-themed skybox with close views of championship finish.',
  },
  {
    key: 'lodges-14-tee',
    venueType: 'private',
    product: 'Lodges',
    location: '14 tee',
    latitude: '43.751210',
    longitude: '-79.953400',
    amenities: 'Food and beverages included; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Private lodge near the 14th tee at The Rink.',
    details: 'Private on-course hosting location beside the signature rink hole.',
  },
  {
    key: 'lodges-17-green',
    venueType: 'private',
    product: 'Lodges',
    location: '17 green',
    latitude: '43.750300',
    longitude: '-79.952720',
    amenities: 'Food and beverages included; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Private lodge near the 17th green.',
    details: 'Private hosting beside late-round play.',
  },
  {
    key: 'osprey-club',
    venueType: 'private',
    product: 'Osprey Club',
    location: '16 green',
    latitude: '43.750050',
    longitude: '-79.954800',
    amenities: 'Private hosting and viewing space; food and beverages included; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Premium location at the 16th green.',
    details: 'Large private hospitality space for client groups.',
  },
  {
    key: 'par-v',
    venueType: 'private',
    product: 'Par-V',
    location: '15 green',
    latitude: '43.749260',
    longitude: '-79.955500',
    amenities: 'Indoor and outdoor seating; rooftop viewing deck; food and beverages included; private washrooms; TV broadcast; customizable space.',
    accessNotes: 'Private venue by the ropes at the 15th green.',
    details: 'Hybrid indoor/outdoor hospitality with close green-side views.',
  },
  {
    key: 'club-seats',
    venueType: 'private',
    product: 'Club Seats',
    location: '15 green',
    latitude: '43.749360',
    longitude: '-79.955380',
    amenities: 'Reserved premium seats; food and beverages included; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Assigned seats on the 15th green.',
    details: 'Reserved premium seating for a smaller client group.',
  },
  {
    key: 'players-club',
    venueType: 'private',
    product: 'Players Club',
    location: '14 green',
    latitude: '43.751010',
    longitude: '-79.953920',
    amenities: 'Private hosting near the 14th green; food and beverages included; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Private hosting at The Rink near the 14th green.',
    details: 'Intimate private hosting with views of the signature rink hole.',
  },
  {
    key: 'champions-club',
    venueType: 'private',
    product: 'Champions Club',
    location: '14 green',
    latitude: '43.751120',
    longitude: '-79.953760',
    amenities: 'Covered table and shared outdoor viewing; food and beverages included; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Presented by BDO at the 14th green.',
    details: 'All-inclusive hospitality overlooking The Rink.',
  },
  {
    key: 'heritage-skybox',
    venueType: 'private',
    product: 'Heritage Skybox',
    location: '14 green',
    latitude: '43.751240',
    longitude: '-79.953650',
    amenities: 'Food and beverages included; reserved washrooms; TVs with championship broadcast.',
    accessNotes: 'Behind the 14th green at The Rink.',
    details: 'Private skybox with green-side view of the signature Par 3.',
  },
  {
    key: 'penalty-box-platinum',
    venueType: 'private',
    product: 'Penalty Box Platinum',
    location: '14 tee',
    latitude: '43.751320',
    longitude: '-79.953240',
    amenities: 'Dedicated penalty box area; Trophy Club access; views of the 14th tee; food and beverages included; reserved washrooms.',
    accessNotes: 'Private box below Trophy Club near the 14th tee.',
    details: 'Small-group private hospitality with shared Trophy Club access.',
  },
  {
    key: 'turkish-airlines-lounge',
    venueType: 'shared',
    product: 'Turkish Airlines Lounge',
    location: '18 green',
    latitude: '43.748820',
    longitude: '-79.951620',
    amenities: 'Premium food and beverages included; indoor washrooms; TVs with championship broadcast; shared viewing deck and outdoor patio.',
    accessNotes: 'Shared lounge overlooking the 18th green.',
    details: 'Premium shared hospitality experience with elevated dining.',
  },
  {
    key: 'trophy-club',
    venueType: 'shared',
    product: 'Trophy Club',
    location: '13 green and 14 tee',
    latitude: '43.750820',
    longitude: '-79.953980',
    amenities: 'Views of 13 green and 14 tee; food and beverages included; reserved washrooms; TVs with championship coverage.',
    accessNotes: 'Shared venue between the 13th green and 14th tee at The Rink.',
    details: 'Shared hospitality near one of the loudest viewing areas.',
  },
  {
    key: 'championship-pro-am',
    venueType: 'experience',
    product: 'Championship Pro-Am',
    location: 'Championship course',
    latitude: '43.746900',
    longitude: '-79.956800',
    amenities: 'Four amateurs per team; two PGA TOUR professionals; Pro-Am Draw Party invitations; clubhouse passes Thursday - Sunday; gift packages.',
    accessNotes: 'Team experience; exact operational details should be confirmed with event staff.',
    details: 'Premium playing experience on the championship course.',
  },
  {
    key: 'insider-seats',
    venueType: 'experience',
    product: 'Insider Seats',
    location: '14 tee',
    latitude: '43.751300',
    longitude: '-79.953330',
    amenities: 'Inside-the-ropes reserved seating at 14 tee; drinks in seats; Trophy Club food and beverage access; transferable badge.',
    accessNotes: 'Inside-the-ropes access at the signature rink hole.',
    details: 'Premium viewing seats for two guests.',
  },
  {
    key: 'honorary-observer',
    venueType: 'experience',
    product: 'Honorary Observer',
    location: 'Course routing',
    latitude: '43.747800',
    longitude: '-79.954900',
    amenities: 'Walk inside the ropes for 18 holes; official hat and lanyard; Turkish Airlines Lounge access before or after tee time.',
    accessNotes: 'Exact tee time and pairing confirmed 24 to 48 hours before scheduled day.',
    details: 'Premium walking experience following a PGA TOUR group.',
  },
  {
    key: 'play-n-watch',
    venueType: 'experience',
    product: "Play N' Watch",
    location: 'Heathlands Clubhouse',
    latitude: '43.743870',
    longitude: '-79.958420',
    amenities: 'Onsite parking; green fees and shared power cart; beverage cart; post-round food and beverages; grounds ticket.',
    accessNotes: 'Arrival at Heathlands Clubhouse; golf and post-round lunch before tournament access.',
    details: 'Play-and-watch package with a morning golf round and tournament access.',
  },
]);
const HOSPITALITY_PRODUCT_MAP = new Map(
  HOSPITALITY_PRODUCT_TEMPLATES.map((template) => [template.key, template])
);
const EVENT_TOPIC_TEMPLATES = Object.freeze({
  [GOLF_CATEGORY]: [
    {
      title: 'WIFI',
      kind: WIFI_TOPIC_KIND,
      summary: '',
    },
    {
      title: 'Transportation',
      kind: TRANSPORTATION_TOPIC_KIND,
      summary: '',
    },
    {
      title: 'Players',
      summary: '',
    },
    {
      title: 'Concessions',
      kind: CONCESSIONS_TOPIC_KIND,
      summary: '',
    },
    {
      title: 'Hospitality',
      kind: HOSPITALITY_TOPIC_KIND,
      summary: '',
    },
    {
      title: 'Bathrooms',
      kind: BATHROOMS_TOPIC_KIND,
      summary: '',
    },
    {
      title: 'Activations',
      summary: '',
    },
    {
      title: 'Schedule',
      kind: SCHEDULE_TOPIC_KIND,
      summary: '',
    },
    {
      title: 'Merch',
      summary: '',
    },
    {
      title: 'Course',
      kind: COURSE_TOPIC_KIND,
      summary: '',
    },
    {
      title: 'Fan Services',
      kind: FAN_SERVICES_TOPIC_KIND,
      summary: '',
    },
  ],
});
const SCREEN_UI_PREVIEW_BASE_URL = import.meta.env.VITE_AI_BOOTH_PREVIEW_URL || (
  import.meta.env.DEV ? 'http://127.0.0.1:3000/' : '/booth-preview/'
);
const SCREEN_UI_PREVIEW_WIDTH = 340;
const SCREEN_UI_PREVIEW_HEIGHT = 1209;
const SCREEN_UI_PREVIEW_SCALE = 0.52;
const SCREEN_UI_PREVIEW_EXPANDED_SCALE = 0.62;
const EVENT_INFO_TOPIC_KEY = 'eventInfo';
const CUSTOM_SCREEN_UI_PALETTES_STORAGE_KEY = 'aiBoothCustomScreenUiPalettes';
const SCREEN_UI_TOPIC_PALETTE = ['#b4a6ff', '#f2ff48', '#ffaac6', '#9ab4ff', '#5cf4b0', '#ec9eff', '#9cff56'];
const SCREEN_UI_VISUAL_MODES = Object.freeze([
  {
    id: 'knowledge-web',
    label: 'Original UI',
    description: 'Topic circles orbit around the selected knowledge topic.',
  },
  {
    id: 'golf-scorecard',
    label: 'Golf UI',
    description: 'A golf scorecard and ball scene where QR codes appear printed on the ball.',
  },
  {
    id: 'southwest-heart',
    label: 'Southwest Heart',
    description: 'A blue Southwest-inspired heart visual that pulses while the AI is active and flips for QR codes.',
  },
]);
const SCREEN_UI_GOLF_QR_MODES = Object.freeze([
  {
    id: 'rotate-ball',
    label: 'Rotate Ball',
    description: 'The center ball turns to reveal the QR code printed on its face.',
  },
  {
    id: 'cup-putt',
    label: 'Putt Into Hole',
    description: 'The ball rolls into the cup, then the QR code appears inside the hole.',
  },
]);
const SCREEN_UI_PRESETS = Object.freeze([
  {
    id: 'midnight',
    label: 'Original',
    theme: {
      background: '#060606',
      backgroundAlt: '#111216',
      glow: '#568aff',
      secondaryGlow: '#94ffb5',
      primary: '#5cf4b0',
      accent: '#ec7c92',
      agentButton: '#182434',
      agentListening: '#00a2ff',
      agentSpeaking: '#ff9f30',
      topicColors: {
        [EVENT_INFO_TOPIC_KEY]: '#38bdf8',
      },
      topicPalette: SCREEN_UI_TOPIC_PALETTE,
    },
  },
  {
    id: 'championship',
    label: 'Championship',
    theme: {
      background: '#03140b',
      backgroundAlt: '#122016',
      glow: '#16a34a',
      secondaryGlow: '#f5d76e',
      primary: '#f8d85a',
      accent: '#38bdf8',
      agentButton: '#18351f',
      agentListening: '#38bdf8',
      agentSpeaking: '#f59e0b',
      topicColors: {
        [EVENT_INFO_TOPIC_KEY]: '#facc15',
      },
      topicPalette: ['#7dd3fc', '#fef08a', '#86efac', '#93c5fd', '#c084fc', '#fb923c'],
    },
  },
  {
    id: 'eighties',
    label: '80s',
    theme: {
      background: '#090018',
      backgroundAlt: '#1a0638',
      glow: '#00e5ff',
      secondaryGlow: '#ff2bd6',
      primary: '#39ff14',
      accent: '#ffb000',
      agentButton: '#24114c',
      agentListening: '#00e5ff',
      agentSpeaking: '#ff2bd6',
      topicColors: {
        [EVENT_INFO_TOPIC_KEY]: '#00e5ff',
      },
      topicPalette: ['#ff2bd6', '#39ff14', '#ffb000', '#7c3aed', '#00e5ff', '#ff6b35'],
    },
  },
  {
    id: 'summer',
    label: 'Summer',
    theme: {
      background: '#062d42',
      backgroundAlt: '#0f766e',
      glow: '#67e8f9',
      secondaryGlow: '#fde047',
      primary: '#f97316',
      accent: '#facc15',
      agentButton: '#075985',
      agentListening: '#22d3ee',
      agentSpeaking: '#fb7185',
      topicColors: {
        [EVENT_INFO_TOPIC_KEY]: '#facc15',
      },
      topicPalette: ['#fb7185', '#2dd4bf', '#f97316', '#a3e635', '#38bdf8', '#fef08a'],
    },
  },
  {
    id: 'corporate',
    label: 'Corporate',
    theme: {
      background: '#f8fafc',
      backgroundAlt: '#dbeafe',
      glow: '#2563eb',
      secondaryGlow: '#14b8a6',
      primary: '#0f766e',
      accent: '#f97316',
      agentButton: '#1e3a8a',
      agentListening: '#2563eb',
      agentSpeaking: '#f97316',
      topicColors: {
        [EVENT_INFO_TOPIC_KEY]: '#2563eb',
      },
      topicPalette: ['#0f766e', '#f97316', '#7c3aed', '#64748b', '#0891b2', '#ca8a04'],
    },
  },
  {
    id: 'redline',
    label: 'Red',
    theme: {
      background: '#160406',
      backgroundAlt: '#3f0a12',
      glow: '#ef4444',
      secondaryGlow: '#f97316',
      primary: '#facc15',
      accent: '#fb7185',
      agentButton: '#4c0519',
      agentListening: '#fb7185',
      agentSpeaking: '#facc15',
      topicColors: {
        [EVENT_INFO_TOPIC_KEY]: '#ef4444',
      },
      topicPalette: ['#facc15', '#fb7185', '#f97316', '#dc2626', '#fda4af', '#fde68a'],
    },
  },
]);
const SCREEN_UI_FEATURES = Object.freeze([
  {
    key: 'showConversationControls',
    label: 'Conversation controls',
    description: 'Show the start conversation button on the booth screen.',
  },
  {
    key: 'showStopButton',
    label: 'Stop button',
    description: 'Allow staff to end an active conversation from the booth screen.',
  },
  {
    key: 'qrDisplay',
    label: 'QR display',
    description: 'Allow agent tools and preview commands to animate QR codes.',
  },
  {
    key: 'keyboardShortcuts',
    label: 'Keyboard shortcuts',
    description: 'Enable local booth shortcuts for QA and field testing.',
  },
  {
    key: 'showVisualSwitcher',
    label: 'Visual switcher',
    description: 'Expose the visual-mode switcher on the booth screen.',
  },
  {
    key: 'demoTalk',
    label: 'Demo voice motion',
    description: 'Run a gentle simulated voice level for screen previews.',
  },
  {
    key: 'debugOverlay',
    label: 'Debug overlay',
    description: 'Show audio and visual diagnostics on the booth canvas.',
  },
]);
const DEFAULT_SCREEN_UI = Object.freeze({
  preset: 'midnight',
  visualMode: 'knowledge-web',
  golfQrMode: 'rotate-ball',
  theme: SCREEN_UI_PRESETS[0].theme,
  features: {
    showConversationControls: true,
    showStopButton: true,
    qrDisplay: true,
    keyboardShortcuts: true,
    showVisualSwitcher: false,
    demoTalk: false,
    debugOverlay: false,
  },
});
const COUNTRY_OPTIONS = Object.freeze([
  { value: 'US', label: 'US' },
  { value: 'CA', label: 'Canada' },
  { value: 'FR', label: 'France' },
]);
const CATEGORY_OPTIONS = Object.freeze([
  { value: 'Golf', label: 'Golf' },
  { value: 'Airport', label: 'Airport' },
  { value: 'Poker', label: 'Poker' },
  { value: 'Amusement Park', label: 'Amusement Park' },
  { value: 'City', label: 'City' },
]);
const PAYMENT_TYPE_OPTIONS = Object.freeze([
  { value: 'apollo', label: 'Apollo' },
  { value: 'stripe', label: 'Stripe' },
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

function normalizeHexColor(value, fallback) {
  const raw = String(value || '').trim();

  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }

  return fallback;
}

function createDefaultScreenUi() {
  return JSON.parse(JSON.stringify(DEFAULT_SCREEN_UI));
}

function normalizeScreenUiVisualMode(value, fallback = DEFAULT_SCREEN_UI.visualMode) {
  const raw = String(value || '').trim();
  const normalized = {
    original: 'knowledge-web',
    'golf-green': 'golf-scorecard',
    'golf-3d': 'golf-scorecard',
    golf: 'golf-scorecard',
    southwest: 'southwest-heart',
    'southwest-airlines': 'southwest-heart',
    heart: 'southwest-heart',
  }[raw] || raw;
  return SCREEN_UI_VISUAL_MODES.some((mode) => mode.id === normalized) ? normalized : fallback;
}

function normalizeScreenUiGolfQrMode(value, fallback = DEFAULT_SCREEN_UI.golfQrMode) {
  const raw = String(value || '').trim();
  const normalized = {
    ball: 'rotate-ball',
    rotate: 'rotate-ball',
    'printed-ball': 'rotate-ball',
    cup: 'cup-putt',
    hole: 'cup-putt',
    putt: 'cup-putt',
    'putt-cup': 'cup-putt',
  }[raw] || raw;
  return SCREEN_UI_GOLF_QR_MODES.some((mode) => mode.id === normalized) ? normalized : fallback;
}

function normalizeScreenUi(screenUi) {
  const source = screenUi && typeof screenUi === 'object' ? screenUi : {};
  const themeSource = source.theme && typeof source.theme === 'object' ? source.theme : {};
  const topicColorSource = themeSource.topicColors && typeof themeSource.topicColors === 'object' ? themeSource.topicColors : {};
  const featureSource = source.features && typeof source.features === 'object' ? source.features : {};
  const defaults = createDefaultScreenUi();
  const extraTopicColors = Object.entries(topicColorSource).reduce((colors, [key, color]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      return colors;
    }

    const normalizedColor = normalizeHexColor(color, '');
    if (!normalizedColor) {
      return colors;
    }

    return {
      ...colors,
      [normalizedKey]: normalizedColor,
    };
  }, {});

  return {
    preset: String(source.preset || defaults.preset),
    visualMode: normalizeScreenUiVisualMode(source.visualMode || source.mode, defaults.visualMode),
    golfQrMode: normalizeScreenUiGolfQrMode(source.golfQrMode || source.qrVisualization, defaults.golfQrMode),
    theme: {
      background: normalizeHexColor(themeSource.background, defaults.theme.background),
      backgroundAlt: normalizeHexColor(themeSource.backgroundAlt, defaults.theme.backgroundAlt),
      glow: normalizeHexColor(themeSource.glow, defaults.theme.glow),
      secondaryGlow: normalizeHexColor(themeSource.secondaryGlow, defaults.theme.secondaryGlow),
      primary: normalizeHexColor(themeSource.primary, defaults.theme.primary),
      accent: normalizeHexColor(themeSource.accent, defaults.theme.accent),
      agentButton: normalizeHexColor(themeSource.agentButton, defaults.theme.agentButton),
      agentListening: normalizeHexColor(themeSource.agentListening, defaults.theme.agentListening),
      agentSpeaking: normalizeHexColor(themeSource.agentSpeaking, defaults.theme.agentSpeaking),
      topicColors: {
        ...extraTopicColors,
        [EVENT_INFO_TOPIC_KEY]: normalizeHexColor(
          topicColorSource[EVENT_INFO_TOPIC_KEY],
          defaults.theme.topicColors[EVENT_INFO_TOPIC_KEY]
        ),
      },
    },
    features: Object.entries(defaults.features).reduce((features, [key, defaultValue]) => ({
      ...features,
      [key]: typeof featureSource[key] === 'boolean' ? featureSource[key] : defaultValue,
    }), {}),
  };
}

function normalizeScreenUiByStationId(value, boothStationIds = [], fallbackScreenUi = null) {
  const source = value && typeof value === 'object' ? value : {};
  const fallback = normalizeScreenUi(fallbackScreenUi);

  return boothStationIds.reduce((screenUiByStationId, stationId) => ({
    ...screenUiByStationId,
    [stationId]: normalizeScreenUi(source[stationId] || fallback),
  }), {});
}

function normalizeScreenUiPresetTheme(theme, fallbackTheme = SCREEN_UI_PRESETS[0].theme) {
  const themeSource = theme && typeof theme === 'object' ? theme : {};
  const fallbackTopicPalette = Array.isArray(fallbackTheme.topicPalette) ? fallbackTheme.topicPalette : SCREEN_UI_TOPIC_PALETTE;
  const topicPaletteSource = Array.isArray(themeSource.topicPalette) ? themeSource.topicPalette : fallbackTopicPalette;
  const screenUi = normalizeScreenUi({ theme: themeSource });
  const topicPalette = topicPaletteSource
    .map((color) => normalizeHexColor(color, ''))
    .filter(Boolean);

  return {
    ...screenUi.theme,
    topicColors: {
      [EVENT_INFO_TOPIC_KEY]: screenUi.theme.topicColors[EVENT_INFO_TOPIC_KEY],
    },
    topicPalette: topicPalette.length > 0 ? topicPalette : fallbackTopicPalette,
  };
}

function normalizeCustomScreenUiPalette(palette, index = 0) {
  const source = palette && typeof palette === 'object' ? palette : {};
  const rawId = String(source.id || `custom-${index + 1}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const label = String(source.label || `Saved Palette ${index + 1}`).trim();

  if (!rawId || !label) {
    return null;
  }

  return {
    id: rawId.startsWith('custom-') ? rawId : `custom-${rawId}`,
    label: label.slice(0, 40),
    custom: true,
    theme: normalizeScreenUiPresetTheme(source.theme),
  };
}

function loadCustomScreenUiPalettes() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_SCREEN_UI_PALETTES_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((palette, index) => normalizeCustomScreenUiPalette(palette, index))
      .filter(Boolean);
  } catch (error) {
    console.warn('Failed to load saved screen UI palettes.', error);
    return [];
  }
}

function persistCustomScreenUiPalettes(palettes) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(CUSTOM_SCREEN_UI_PALETTES_STORAGE_KEY, JSON.stringify(palettes));
  } catch (error) {
    console.warn('Failed to save screen UI palettes.', error);
  }
}

function createCustomScreenUiPalette(screenUi, topics, index = 0) {
  const normalizedScreenUi = normalizeScreenUi(screenUi);
  const topicPalette = getScreenUiTopicRows(topics)
    .filter((topicRow) => topicRow.colorIndex >= 0)
    .map((topicRow) => getScreenUiTopicColor(normalizedScreenUi, topicRow));

  return normalizeCustomScreenUiPalette({
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: `Saved Palette ${index + 1}`,
    theme: {
      ...normalizedScreenUi.theme,
      topicColors: {
        [EVENT_INFO_TOPIC_KEY]: normalizedScreenUi.theme.topicColors[EVENT_INFO_TOPIC_KEY],
      },
      topicPalette: topicPalette.length > 0 ? topicPalette : SCREEN_UI_TOPIC_PALETTE,
    },
  }, index);
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

function createDefaultTransportationDetails() {
  return {
    shuttle: { locations: [] },
    rideShare: { locations: [] },
    parking: { locations: [] },
  };
}

function createDefaultTransportationLocation() {
  return {
    id: createLocalId('transportation-location'),
    location: '',
    latitude: '',
    longitude: '',
    hours: '',
    startTime: '',
    endTime: '',
    frequency: '',
    details: '',
  };
}

function hasTransportationLocationData(source) {
  return [
    source.location,
    source.pickup,
    source.area,
    source.place,
    source.latitude,
    source.lat,
    source.longitude,
    source.lng,
    source.lon,
    source.hours,
    source.openHours,
    source.startTime,
    source.from,
    source.endTime,
    source.to,
    source.frequency,
    source.details,
    source.instructions,
    source.notes,
  ].some((value) => String(value || '').trim());
}

function normalizeTransportationLocation(location, index = 0) {
  const source = location && typeof location === 'object' ? location : {};

  return {
    id: String(source.id || `transportation-location-${index + 1}`).trim(),
    location: String(source.location || source.pickup || source.area || source.place || ''),
    latitude: String(source.latitude || source.lat || ''),
    longitude: String(source.longitude || source.lng || source.lon || ''),
    hours: String(source.hours || source.openHours || ''),
    startTime: String(source.startTime || source.from || source.start || ''),
    endTime: String(source.endTime || source.to || source.end || ''),
    frequency: String(source.frequency || source.interval || ''),
    details: String(source.details || source.instructions || source.notes || ''),
  };
}

function normalizeTransportationSection(value) {
  const source = value && typeof value === 'object' ? value : {};
  const rawLocations = Array.isArray(source.locations)
    ? source.locations
    : Array.isArray(source.stops)
      ? source.stops
      : [];

  return {
    locations: rawLocations.length > 0
      ? rawLocations.map(normalizeTransportationLocation)
      : hasTransportationLocationData(source)
        ? [normalizeTransportationLocation(source)]
        : [],
  };
}

function normalizeTransportationDetails(value) {
  const defaults = createDefaultTransportationDetails();
  const source = value && typeof value === 'object' ? value : {};

  return {
    shuttle: normalizeTransportationSection(source.shuttle || defaults.shuttle),
    rideShare: normalizeTransportationSection(source.rideShare || source.rideshare || defaults.rideShare),
    parking: normalizeTransportationSection(source.parking || defaults.parking),
  };
}

function createDefaultFanZoneActivation(index = 0) {
  return {
    id: createLocalId('fan-activation'),
    name: `Activation ${index + 1}`,
    sponsor: '',
    location: '',
    hours: '',
    details: '',
  };
}

function normalizeFanZoneActivation(activation, index = 0) {
  const source = activation && typeof activation === 'object' ? activation : {};
  const name = String(source.name || '').trim();

  return {
    id: String(source.id || createLocalId('fan-activation')).trim(),
    name: name || `Activation ${index + 1}`,
    sponsor: String(source.sponsor || ''),
    location: String(source.location || ''),
    hours: String(source.hours || source.openHours || ''),
    details: String(source.details || source.description || source.instructions || ''),
  };
}

function createDefaultFanZone(index = 0) {
  return {
    id: createLocalId('fan-zone'),
    name: `Fan Zone ${index + 1}`,
    latitude: '',
    longitude: '',
    openHours: '',
    details: '',
    activations: [],
  };
}

function normalizeFanZone(zone, index = 0) {
  const source = zone && typeof zone === 'object' ? zone : {};
  const name = String(source.name || '').trim();

  return {
    id: String(source.id || createLocalId('fan-zone')).trim(),
    name: name || `Fan Zone ${index + 1}`,
    latitude: String(source.latitude || source.lat || ''),
    longitude: String(source.longitude || source.lng || source.lon || ''),
    openHours: String(source.openHours || source.hours || ''),
    details: String(source.details || source.description || source.notes || ''),
    activations: Array.isArray(source.activations)
      ? source.activations.map(normalizeFanZoneActivation)
      : [],
  };
}

function normalizeFanZones(value) {
  return Array.isArray(value) ? value.map(normalizeFanZone) : [];
}

function getHospitalityProductTemplate(productKey) {
  return HOSPITALITY_PRODUCT_MAP.get(String(productKey || '').trim()) || HOSPITALITY_PRODUCT_TEMPLATES[0];
}

function getHospitalityVenueTypeLabel(venueType) {
  return HOSPITALITY_VENUE_TYPES.find((option) => option.value === venueType)?.label || venueType;
}

function createDefaultHospitalityClient(index = 0) {
  return {
    id: createLocalId('hospitality-client'),
    clientName: `Client ${index + 1}`,
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    hostName: '',
    credentialNotes: '',
    arrivalNotes: '',
    specialRequests: '',
  };
}

function normalizeHospitalityClient(client, index = 0) {
  const source = client && typeof client === 'object' ? client : {};
  const clientName = String(source.clientName || source.name || source.company || '').trim();

  return {
    id: String(source.id || createLocalId('hospitality-client')).trim(),
    clientName: clientName || `Client ${index + 1}`,
    contactName: String(source.contactName || source.contact || ''),
    contactPhone: String(source.contactPhone || source.phone || ''),
    contactEmail: String(source.contactEmail || source.email || ''),
    hostName: String(source.hostName || source.host || ''),
    credentialNotes: String(source.credentialNotes || source.credentials || ''),
    arrivalNotes: String(source.arrivalNotes || source.arrival || ''),
    specialRequests: String(source.specialRequests || source.requests || source.notes || ''),
  };
}

function normalizeHospitalityClients(value) {
  return Array.isArray(value) ? value.map(normalizeHospitalityClient) : [];
}

function createHospitalityLocationFromTemplate(productKey, index = 0, overrides = {}) {
  const template = getHospitalityProductTemplate(productKey);

  return {
    id: createLocalId('hospitality-location'),
    name: template.product || `Hospitality Location ${index + 1}`,
    venueType: template.venueType,
    location: template.location,
    latitude: template.latitude,
    longitude: template.longitude,
    amenities: template.amenities,
    accessNotes: template.accessNotes,
    details: template.details,
    clients: [],
    ...overrides,
  };
}

function createDefaultHospitalityLocation(index = 0) {
  const template = HOSPITALITY_PRODUCT_TEMPLATES[index % HOSPITALITY_PRODUCT_TEMPLATES.length];
  return createHospitalityLocationFromTemplate(template.key, index);
}

function normalizeHospitalityLocation(location, index = 0) {
  const source = location && typeof location === 'object' ? location : {};
  const template = getHospitalityProductTemplate(source.templateKey || source.productKey || source.productId || source.type);
  const venueType = String(source.venueType || template.venueType || HOSPITALITY_VENUE_TYPES[0].value).trim();
  const name = String(source.name || source.product || template.product || '').trim();

  return {
    id: String(source.id || createLocalId('hospitality-location')).trim(),
    name: name || `Hospitality Location ${index + 1}`,
    venueType,
    location: String(source.location || source.place || template.location || ''),
    latitude: String(source.latitude || source.lat || template.latitude || ''),
    longitude: String(source.longitude || source.lng || source.lon || template.longitude || ''),
    amenities: String(source.amenities || source.includes || template.amenities || ''),
    accessNotes: String(source.accessNotes || source.access || source.credentials || template.accessNotes || ''),
    details: String(source.details || source.description || source.notes || template.details || ''),
    clients: normalizeHospitalityClients(source.clients || source.assignedClients),
  };
}

function normalizeHospitalityLocations(value) {
  return Array.isArray(value) ? value.map(normalizeHospitalityLocation) : [];
}

function createDefaultBathroomLocation(index = 0) {
  return {
    id: createLocalId('bathroom-location'),
    place: `Bathroom ${index + 1}`,
    latitude: '',
    longitude: '',
  };
}

function normalizeBathroomLocation(location, index = 0) {
  const source = location && typeof location === 'object' ? location : {};
  const place = String(source.place || source.name || source.location || '').trim();

  return {
    id: String(source.id || createLocalId('bathroom-location')).trim(),
    place: place || `Bathroom ${index + 1}`,
    latitude: String(source.latitude || source.lat || ''),
    longitude: String(source.longitude || source.lng || source.lon || ''),
  };
}

function normalizeBathroomLocations(value) {
  return Array.isArray(value) ? value.map(normalizeBathroomLocation) : [];
}

const DEFAULT_FAN_SERVICE_NAMES = Object.freeze([
  'First aid',
  'Lost and found',
  'Accessibility help',
]);

function createDefaultFanService(index = 0, name = '') {
  return {
    id: createLocalId('fan-service'),
    name: name || `Service ${index + 1}`,
    location: '',
    latitude: '',
    longitude: '',
  };
}

function createDefaultFanServices() {
  return DEFAULT_FAN_SERVICE_NAMES.map((name, index) => createDefaultFanService(index, name));
}

function normalizeFanService(service, index = 0) {
  const source = service && typeof service === 'object' ? service : {};
  const name = String(source.name || '').trim();

  return {
    id: String(source.id || createLocalId('fan-service')).trim(),
    name: name || `Service ${index + 1}`,
    location: String(source.location || source.place || ''),
    latitude: String(source.latitude || source.lat || ''),
    longitude: String(source.longitude || source.lng || source.lon || ''),
  };
}

function normalizeFanServices(value, includeDefaults = false) {
  const services = Array.isArray(value) ? value.map(normalizeFanService) : [];
  return includeDefaults && services.length === 0 ? createDefaultFanServices() : services;
}

function createDefaultCourseHole(index = 0) {
  return {
    id: `hole-${index + 1}`,
    holeNumber: index + 1,
    teeLatitude: '',
    teeLongitude: '',
    greenLatitude: '',
    greenLongitude: '',
  };
}

function createDefaultCourseHoles() {
  return Array.from({ length: 18 }, (_, index) => createDefaultCourseHole(index));
}

function normalizeCourseHole(hole, index = 0) {
  const source = hole && typeof hole === 'object' ? hole : {};
  const holeNumber = Number(source.holeNumber || source.number || index + 1);

  return {
    id: String(source.id || `hole-${index + 1}`).trim(),
    holeNumber: Number.isFinite(holeNumber) ? holeNumber : index + 1,
    teeLatitude: String(source.teeLatitude || source.teeLat || source.tee?.latitude || source.tee?.lat || ''),
    teeLongitude: String(source.teeLongitude || source.teeLng || source.teeLon || source.tee?.longitude || source.tee?.lng || source.tee?.lon || ''),
    greenLatitude: String(source.greenLatitude || source.greenLat || source.green?.latitude || source.green?.lat || ''),
    greenLongitude: String(source.greenLongitude || source.greenLng || source.greenLon || source.green?.longitude || source.green?.lng || source.green?.lon || ''),
  };
}

function normalizeCourseHoles(value, includeDefaults = false) {
  const holes = Array.isArray(value) ? value.map(normalizeCourseHole) : [];
  const byHoleNumber = new Map(holes.map((hole) => [hole.holeNumber, hole]));

  if (!includeDefaults) {
    return holes;
  }

  return createDefaultCourseHoles().map((defaultHole) => ({
    ...defaultHole,
    ...(byHoleNumber.get(defaultHole.holeNumber) || {}),
  }));
}

function createDefaultScheduleEvent(dayIndex = 0, eventIndex = 0) {
  return {
    id: createLocalId(`schedule-event-${dayIndex + 1}`),
    title: `Schedule Item ${eventIndex + 1}`,
    category: '',
    startTime: '',
    endTime: '',
    location: '',
    audience: '',
    details: '',
    sourceNote: '',
    needsReview: false,
  };
}

function normalizeScheduleEvent(scheduleEvent, dayIndex = 0, eventIndex = 0) {
  const source = scheduleEvent && typeof scheduleEvent === 'object' ? scheduleEvent : {};
  const title = String(source.title || source.name || '').trim();

  return {
    id: String(source.id || `schedule-event-${dayIndex + 1}-${eventIndex + 1}`).trim(),
    title: title || `Schedule Item ${eventIndex + 1}`,
    category: String(source.category || source.type || ''),
    startTime: String(source.startTime || source.start || ''),
    endTime: String(source.endTime || source.end || ''),
    location: String(source.location || source.place || ''),
    audience: String(source.audience || source.access || ''),
    details: String(source.details || source.description || source.notes || ''),
    sourceNote: String(source.sourceNote || source.warning || ''),
    needsReview: source.needsReview === true,
  };
}

function createDefaultScheduleDay(index = 0) {
  return {
    id: createLocalId('schedule-day'),
    date: '',
    dayLabel: `Day ${index + 1}`,
    publicStatus: '',
    theme: '',
    gatesOpen: '',
    gatesClose: '',
    dailyNotes: '',
    events: [],
  };
}

function normalizeScheduleDay(day, index = 0) {
  const source = day && typeof day === 'object' ? day : {};
  const dayLabel = String(source.dayLabel || source.label || '').trim();
  const events = Array.isArray(source.events || source.items)
    ? (source.events || source.items).map((event, eventIndex) => normalizeScheduleEvent(event, index, eventIndex))
    : [];

  return {
    id: String(source.id || createLocalId('schedule-day')).trim(),
    date: String(source.date || ''),
    dayLabel: dayLabel || `Day ${index + 1}`,
    publicStatus: String(source.publicStatus || source.status || ''),
    theme: String(source.theme || source.title || ''),
    gatesOpen: String(source.gatesOpen || source.gates?.open || ''),
    gatesClose: String(source.gatesClose || source.gates?.close || ''),
    dailyNotes: String(source.dailyNotes || source.notes || ''),
    events,
  };
}

function normalizeScheduleDays(value) {
  return Array.isArray(value) ? value.map(normalizeScheduleDay) : [];
}

function createRbcCanadianOpenSampleScheduleDays() {
  return [
    {
      id: createLocalId('schedule-day'),
      date: '2026-06-08',
      dayLabel: 'Monday, June 8, 2026',
      publicStatus: 'Closed to public',
      theme: 'Celebrity Pro-Am',
      gatesOpen: '',
      gatesClose: '',
      dailyNotes: 'Closed-to-public activity before tournament gates open to guests.',
      events: [
        {
          ...createDefaultScheduleEvent(0, 0),
          title: 'Golf Canada Foundation Celebrity Pro-Am',
          category: 'Pro-Am',
          startTime: '10:00 pm',
          endTime: '6:00 pm',
          audience: 'Closed to public',
          details: 'Celebrity Pro-Am listed on the source schedule.',
          sourceNote: 'Source page shows 10:00 pm - 6:00 pm; this may be a typo and should be verified.',
          needsReview: true,
        },
      ],
    },
    {
      id: createLocalId('schedule-day'),
      date: '2026-06-09',
      dayLabel: 'Tuesday, June 9, 2026',
      publicStatus: 'Closed to public',
      theme: 'Practice Rounds',
      gatesOpen: '',
      gatesClose: '',
      dailyNotes: 'Closed-to-public practice day with school field trip programming.',
      events: [
        {
          ...createDefaultScheduleEvent(1, 0),
          title: 'Practice Rounds',
          category: 'Practice',
          startTime: '7:00 am',
          endTime: '5:00 pm',
          audience: 'Closed to public',
          details: 'Player practice rounds.',
        },
        {
          ...createDefaultScheduleEvent(1, 1),
          title: 'First Tee School Field Trip Day',
          category: 'Youth Program',
          startTime: '9:30 am',
          endTime: '1:30 pm',
          audience: 'School groups',
          details: 'Educational field trip programming.',
        },
      ],
    },
    {
      id: createLocalId('schedule-day'),
      date: '2026-06-10',
      dayLabel: 'Wednesday, June 10, 2026',
      publicStatus: 'Public event day',
      theme: 'RBC Championship Pro-Am',
      gatesOpen: '7:00 am',
      gatesClose: '',
      dailyNotes: 'Opening public event day with Pro-Am and opening ceremonies.',
      events: [
        {
          ...createDefaultScheduleEvent(2, 0),
          title: 'RBC Championship Pro-Am',
          category: 'Pro-Am',
          startTime: '6:30 am',
          endTime: '5:00 pm',
          details: 'Pro-Am play window.',
        },
        {
          ...createDefaultScheduleEvent(2, 1),
          title: 'Opening Ceremonies',
          category: 'Ceremony',
          startTime: '3:30 pm',
          endTime: '',
          details: 'Opening ceremony start time.',
        },
      ],
    },
    {
      id: createLocalId('schedule-day'),
      date: '2026-06-11',
      dayLabel: 'Thursday, June 11, 2026',
      publicStatus: 'Public event day',
      theme: 'Round 1',
      gatesOpen: '6:30 am',
      gatesClose: '',
      dailyNotes: 'First round tournament play.',
      events: [
        {
          ...createDefaultScheduleEvent(3, 0),
          title: 'First Round Play',
          category: 'Tournament Round',
          startTime: '7:00 am',
          endTime: '7:30 pm',
          details: 'Round 1 play window.',
        },
      ],
    },
    {
      id: createLocalId('schedule-day'),
      date: '2026-06-12',
      dayLabel: 'Friday, June 12, 2026',
      publicStatus: 'Public event day',
      theme: 'Round 2 - Red & White Day',
      gatesOpen: '6:30 am',
      gatesClose: '',
      dailyNotes: 'Second round tournament play and Red & White Day programming.',
      events: [
        {
          ...createDefaultScheduleEvent(4, 0),
          title: 'Second Round Play',
          category: 'Tournament Round',
          startTime: '7:00 am',
          endTime: '7:30 pm',
          details: 'Round 2 play window.',
        },
      ],
    },
    {
      id: createLocalId('schedule-day'),
      date: '2026-06-13',
      dayLabel: 'Saturday, June 13, 2026',
      publicStatus: 'Public event day',
      theme: 'Round 3',
      gatesOpen: '7:00 am',
      gatesClose: '',
      dailyNotes: 'Third round tournament play.',
      events: [
        {
          ...createDefaultScheduleEvent(5, 0),
          title: 'Third Round Play',
          category: 'Tournament Round',
          startTime: '8:00 am',
          endTime: '6:00 pm',
          details: 'Round 3 play window.',
        },
      ],
    },
    {
      id: createLocalId('schedule-day'),
      date: '2026-06-14',
      dayLabel: 'Sunday, June 14, 2026',
      publicStatus: 'Public event day',
      theme: 'Championship Sunday',
      gatesOpen: '7:00 am',
      gatesClose: '',
      dailyNotes: 'Championship round and closing ceremony.',
      events: [
        {
          ...createDefaultScheduleEvent(6, 0),
          title: 'Championship Round',
          category: 'Tournament Round',
          startTime: '8:00 am',
          endTime: '6:00 pm',
          details: 'Final round play window.',
        },
        {
          ...createDefaultScheduleEvent(6, 1),
          title: 'Closing Ceremony',
          category: 'Ceremony',
          startTime: '6:00 pm',
          endTime: '7:00 pm',
          details: 'Closing ceremony programming.',
        },
      ],
    },
  ];
}

function createTopicDraft(index = 0) {
  return {
    id: createLocalId('topic'),
    title: `Topic ${index + 1}`,
    kind: '',
    summary: '',
    notes: '',
    checklistText: '',
    wifiSsid: '',
    wifiPassword: '',
    wifiSecurity: 'WPA',
    wifiHidden: false,
    transportation: createDefaultTransportationDetails(),
    fanZones: [],
    hospitalityLocations: [],
    bathroomLocations: [],
    fanServices: [],
    courseHoles: [],
    scheduleDays: [],
  };
}

function createPresetTopicDraft(preset, index = 0) {
  const kind = String(preset.kind || '');

  return {
    ...createTopicDraft(index),
    title: preset.title,
    kind,
    summary: preset.summary,
    bathroomLocations: kind === BATHROOMS_TOPIC_KIND ? [] : [],
    hospitalityLocations: kind === HOSPITALITY_TOPIC_KIND ? [] : [],
    fanServices: kind === FAN_SERVICES_TOPIC_KIND ? createDefaultFanServices() : [],
    courseHoles: kind === COURSE_TOPIC_KIND ? createDefaultCourseHoles() : [],
    scheduleDays: kind === SCHEDULE_TOPIC_KIND ? createRbcCanadianOpenSampleScheduleDays() : [],
  };
}

function getTopicTemplateKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function createMissingTemplateTopics(currentTopics, category) {
  const template = EVENT_TOPIC_TEMPLATES[String(category || '').trim()] || [];
  const existingKeys = new Set(
    currentTopics.map((topic) => getTopicTemplateKey(topic.title || topic.kind))
  );
  const topicsToAdd = [];

  template.forEach((topicTemplate) => {
    const key = getTopicTemplateKey(topicTemplate.title || topicTemplate.kind);
    if (!key || existingKeys.has(key)) {
      return;
    }

    const nextTopic = createPresetTopicDraft(
      topicTemplate,
      currentTopics.length + topicsToAdd.length
    );
    topicsToAdd.push(nextTopic);
    existingKeys.add(key);
  });

  return topicsToAdd;
}

function createEmptyEventDraft() {
  return {
    id: '',
    general: createDefaultGeneral(),
    agent: createDefaultAgent(),
    boothContexts: {},
    boothStationIds: [],
    screenUi: createDefaultScreenUi(),
    screenUiByStationId: {},
    topics: [],
    activations: [],
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
  };
}

function createMockRbcTopic(index, overrides) {
  return {
    ...createTopicDraft(index),
    ...overrides,
    id: createLocalId('topic'),
  };
}

function createMockRbcCourseHoles() {
  return Array.from({ length: 18 }, (_, index) => {
    const rowOffset = Math.floor(index / 6) * 0.0032;
    const columnOffset = (index % 6) * 0.0024;
    const teeLatitude = 43.7445 + rowOffset + (index % 2) * 0.0004;
    const teeLongitude = -79.955 + columnOffset;

    return {
      id: `hole-${index + 1}`,
      holeNumber: index + 1,
      teeLatitude: teeLatitude.toFixed(6),
      teeLongitude: teeLongitude.toFixed(6),
      greenLatitude: (teeLatitude + 0.0012).toFixed(6),
      greenLongitude: (teeLongitude + 0.001).toFixed(6),
    };
  });
}

function createMockRbcHospitalityClient(index, overrides = {}) {
  const clients = [
    {
      clientName: 'RBC Executive Guests',
      contactName: 'Amanda Blake',
      contactPhone: '416-555-0184',
      contactEmail: 'amanda.blake@example.com',
      hostName: 'RBC Hosting Team',
      credentialNotes: 'Sky Suite wristbands and 18 green access credentials.',
      arrivalNotes: 'Meet host at Clubhouse and Hospitality Gate.',
      specialRequests: 'Two dietary restrictions; confirm reserved washroom access.',
    },
    {
      clientName: 'Golf Canada Partners',
      contactName: 'Michael Chen',
      contactPhone: '647-555-0112',
      contactEmail: 'michael.chen@example.com',
      hostName: 'Golf Canada Hospitality',
      credentialNotes: 'Partner badges required at entry checkpoint.',
      arrivalNotes: 'Guests arrive between 10:00 AM and noon.',
      specialRequests: 'Direct guests to nearest shuttle after play.',
    },
    {
      clientName: 'BDO Client Group',
      contactName: 'Sophie Martin',
      contactPhone: '905-555-0138',
      contactEmail: 'sophie.martin@example.com',
      hostName: 'BDO Host Desk',
      credentialNotes: 'Champions Club credentials.',
      arrivalNotes: 'Use The Rink hospitality checkpoint near 14 green.',
      specialRequests: 'Keep directions short and send guests to host desk for upgrades.',
    },
    {
      clientName: 'Turkish Airlines VIP Guests',
      contactName: 'David Kapoor',
      contactPhone: '416-555-0146',
      contactEmail: 'david.kapoor@example.com',
      hostName: 'Turkish Airlines Lounge Concierge',
      credentialNotes: 'Daily lounge ticket and shared deck access.',
      arrivalNotes: 'Access from 18 green hospitality entrance.',
      specialRequests: 'Remind guests lounge tickets are per day.',
    },
  ];

  return {
    ...createDefaultHospitalityClient(index),
    ...clients[index % clients.length],
    ...overrides,
    id: createLocalId('hospitality-client'),
  };
}

function createMockRbcHospitalityLocations() {
  const mockProducts = [
    'sky-suite',
    'legends-skybox',
    'osprey-club',
    'par-v',
    'players-club',
    'champions-club',
    'turkish-airlines-lounge',
    'trophy-club',
    'championship-pro-am',
    'insider-seats',
    'play-n-watch',
  ];

  return mockProducts.map((productKey, index) => {
    const template = getHospitalityProductTemplate(productKey);

    return createHospitalityLocationFromTemplate(productKey, index, {
      name: template.product,
      clients: [
        createMockRbcHospitalityClient(index, {
          credentialNotes: `${template.product} credentials. ${template.accessNotes}`,
        }),
      ],
    });
  });
}

function createMockRbcCanadianOpenTopics() {
  return [
    createMockRbcTopic(0, {
      title: 'WIFI',
      kind: WIFI_TOPIC_KIND,
      summary: 'Guest Wi-Fi is available around major fan zones, hospitality areas, and the clubhouse. Use the public network first; direct guests to fan services if coverage is weak.',
      wifiSsid: 'RBCOpenGuest',
      wifiPassword: 'golf2026',
      wifiSecurity: 'WPA',
      wifiHidden: false,
    }),
    createMockRbcTopic(1, {
      title: 'Transportation',
      kind: TRANSPORTATION_TOPIC_KIND,
      summary: 'Main guest movement is handled by shuttle loops, designated ride share zones, and numbered parking lots around TPC Toronto.',
      transportation: {
        shuttle: {
          locations: [
            {
              id: createLocalId('transportation-location'),
              location: 'North Parking Shuttle Hub',
              latitude: '43.748950',
              longitude: '-79.963900',
              startTime: '6:00 AM',
              endTime: '9:30 PM',
              frequency: 'Every 8 minutes',
              details: 'Primary shuttle loop from North Parking to the Main Admission Gate. Accessible shuttles are available at the front of the queue.',
            },
            {
              id: createLocalId('transportation-location'),
              location: 'Osprey Valley Resort Shuttle Stop',
              latitude: '43.743870',
              longitude: '-79.958420',
              startTime: '7:00 AM',
              endTime: '8:30 PM',
              frequency: 'Every 15 minutes',
              details: 'Connects resort guests and hospitality credentials to the Clubhouse Gate.',
            },
            {
              id: createLocalId('transportation-location'),
              location: 'Volunteer and Staff Shuttle',
              latitude: '43.739710',
              longitude: '-79.951860',
              startTime: '5:00 AM',
              endTime: '10:00 PM',
              frequency: 'Every 20 minutes',
              details: 'Credentialed staff only. Direct guests without staff credentials to North Parking Shuttle Hub.',
            },
          ],
        },
        rideShare: {
          locations: [
            {
              id: createLocalId('transportation-location'),
              location: 'Ride Share Lot A',
              latitude: '43.747350',
              longitude: '-79.960610',
              hours: '6:00 AM - 10:00 PM',
              details: 'Guest pickup and drop-off for Uber, Lyft, taxis, and private cars. Follow signs for Ride Share Lot A near the Main Admission Gate.',
            },
            {
              id: createLocalId('transportation-location'),
              location: 'Accessible Drop-Off',
              latitude: '43.746410',
              longitude: '-79.957220',
              hours: '6:00 AM - 9:00 PM',
              details: 'Accessible drop-off for guests with mobility needs. Volunteers can call cart support from this location.',
            },
          ],
        },
        parking: {
          locations: [
            {
              id: createLocalId('transportation-location'),
              location: 'Lot N - General Parking',
              latitude: '43.750110',
              longitude: '-79.965330',
              hours: '5:30 AM - 10:00 PM',
              details: 'Largest public parking lot. Guests should board the North Parking Shuttle to reach the Main Admission Gate.',
            },
            {
              id: createLocalId('transportation-location'),
              location: 'Lot C - Clubhouse and Hospitality',
              latitude: '43.742930',
              longitude: '-79.956180',
              hours: '6:00 AM - 9:00 PM',
              details: 'Credentialed parking for clubhouse, suites, sponsors, and hospitality guests.',
            },
            {
              id: createLocalId('transportation-location'),
              location: 'Lot V - Volunteer Parking',
              latitude: '43.739100',
              longitude: '-79.950980',
              hours: '4:45 AM - 10:30 PM',
              details: 'Volunteer and operations parking. Not available for public guest parking.',
            },
            {
              id: createLocalId('transportation-location'),
              location: 'Accessible Parking Row',
              latitude: '43.746080',
              longitude: '-79.958070',
              hours: '6:00 AM - 9:00 PM',
              details: 'Accessible permit parking. Guests can request cart support at the accessible services tent near this row.',
            },
          ],
        },
      },
    }),
    createMockRbcTopic(2, {
      title: 'Players',
      summary: 'Player information, tee times, practice areas, and leaderboard help.',
      notes: 'Mock player field for testing: defending champion, top Canadian contenders, international major champions, sponsor exemptions, and amateur invitees. Guests can ask where to watch featured groups, where the practice range is, or how to check tee times. Direct real-time leaderboard requests to official tournament scoring sources once integrated.',
      checklistText: 'Featured groups rotate daily\nPractice range is near the clubhouse side\nDo not guess live scores\nRefer uncertain tee times to official tournament app',
    }),
    createMockRbcTopic(3, {
      title: 'Concessions',
      kind: CONCESSIONS_TOPIC_KIND,
      summary: 'Food, beverage, fan zones, and sponsor experiences around the course.',
      notes: 'Most public food and beverage is concentrated in The Fare Way, the 18 Green Market, and the Family Fairway. Cashless payment is preferred throughout the venue.',
      fanZones: [
        {
          id: createLocalId('fan-zone'),
          name: 'The Fare Way',
          latitude: '43.747820',
          longitude: '-79.957980',
          openHours: '9:00 AM - 8:00 PM',
          details: 'Large food and beverage destination with local restaurants, picnic seating, shaded areas, and big-screen tournament coverage.',
          activations: [
            {
              id: createLocalId('fan-activation'),
              name: 'RBC Fan Challenge',
              sponsor: 'RBC',
              location: 'Center of The Fare Way',
              hours: '10:00 AM - 6:00 PM',
              details: 'Guests can play a short putting challenge and scan a QR code for prizes.',
            },
            {
              id: createLocalId('fan-activation'),
              name: 'Local Chef Pop-Up',
              sponsor: 'Golf Canada',
              location: 'East tent row',
              hours: '11:00 AM - 7:00 PM',
              details: 'Rotating local restaurant feature with daily menu specials.',
            },
          ],
        },
        {
          id: createLocalId('fan-zone'),
          name: 'Family Fairway',
          latitude: '43.745260',
          longitude: '-79.954700',
          openHours: '10:00 AM - 6:00 PM',
          details: 'Family-friendly area with games, water refill stations, shaded seating, and youth golf activities.',
          activations: [
            {
              id: createLocalId('fan-activation'),
              name: 'Junior Golf Skills Zone',
              sponsor: 'First Tee',
              location: 'Family Fairway activity lawn',
              hours: '10:00 AM - 5:00 PM',
              details: 'Putting, chipping, and basic golf skills activities for kids.',
            },
            {
              id: createLocalId('fan-activation'),
              name: 'Photo Trophy Wall',
              sponsor: 'RBC',
              location: 'Family Fairway entrance',
              hours: '10:00 AM - 6:00 PM',
              details: 'Photo moment with mock trophy display and tournament backdrop.',
            },
          ],
        },
        {
          id: createLocalId('fan-zone'),
          name: '18 Green Market',
          latitude: '43.749090',
          longitude: '-79.951880',
          openHours: '9:00 AM - 7:30 PM',
          details: 'Premium concessions and beverage area near the finishing hole, with quick access to the 18th green viewing areas.',
          activations: [
            {
              id: createLocalId('fan-activation'),
              name: 'Championship Patio Sampling',
              sponsor: 'Partner Beverage Brand',
              location: 'North patio',
              hours: '12:00 PM - 6:00 PM',
              details: 'Age-restricted sampling area. Guests must show valid ID.',
            },
          ],
        },
      ],
    }),
    createMockRbcTopic(4, {
      title: 'Hospitality',
      kind: HOSPITALITY_TOPIC_KIND,
      summary: 'Suites, lounges, sponsor areas, and premium guest wayfinding.',
      notes: 'Hospitality data is based on the 2026 RBC Canadian Open VIP Hospitality, Pro-Am, and Experiences PDF. Confirm final venue locations, client rosters, and credentials before production.',
      hospitalityLocations: createMockRbcHospitalityLocations(),
    }),
    createMockRbcTopic(5, {
      title: 'Bathrooms',
      kind: BATHROOMS_TOPIC_KIND,
      summary: 'Restroom and washroom locations around the course and fan areas.',
      bathroomLocations: [
        { id: createLocalId('bathroom-location'), place: 'Main Admission Gate Restrooms', latitude: '43.746980', longitude: '-79.959150' },
        { id: createLocalId('bathroom-location'), place: 'The Fare Way Restrooms', latitude: '43.747510', longitude: '-79.957610' },
        { id: createLocalId('bathroom-location'), place: 'Family Fairway Restrooms', latitude: '43.745010', longitude: '-79.954310' },
        { id: createLocalId('bathroom-location'), place: '18 Green Restrooms', latitude: '43.748790', longitude: '-79.951480' },
        { id: createLocalId('bathroom-location'), place: 'Clubhouse Level Restrooms', latitude: '43.743440', longitude: '-79.956020' },
        { id: createLocalId('bathroom-location'), place: 'Accessible Restrooms near First Aid', latitude: '43.746120', longitude: '-79.956930' },
        { id: createLocalId('bathroom-location'), place: '10 Tee Restroom Cluster', latitude: '43.751210', longitude: '-79.953400' },
        { id: createLocalId('bathroom-location'), place: 'Volunteer Village Restrooms', latitude: '43.739500', longitude: '-79.951220' },
      ],
    }),
    createMockRbcTopic(6, {
      title: 'Activations',
      summary: 'Sponsor and guest-facing experiences around the venue.',
      notes: 'Mock activations: RBC Fan Challenge at The Fare Way, First Tee Junior Skills Zone at Family Fairway, Trophy Photo Wall near Family Fairway, Partner Beverage Patio near 18 Green Market, Official Merchandise personalization booth near the main shop, and daily autograph windows near the practice range. Guests should check posted signage for final times.',
      checklistText: 'RBC Fan Challenge: 10 AM - 6 PM\nJunior Golf Skills Zone: 10 AM - 5 PM\nTrophy Photo Wall: all public hours\nBeverage Patio: 12 PM - 6 PM, age restricted\nMerch personalization: 11 AM - 5 PM',
    }),
    createMockRbcTopic(7, {
      title: 'Schedule',
      kind: SCHEDULE_TOPIC_KIND,
      summary: 'Tournament week schedule, public access, gates, rounds, ceremonies, and daily programming.',
      notes: 'Mock schedule based on RBC Canadian Open sample data. Verify all times before publishing to a live event.',
      scheduleDays: createRbcCanadianOpenSampleScheduleDays(),
    }),
    createMockRbcTopic(8, {
      title: 'Merch',
      summary: 'Official merchandise, shop locations, hours, and guest purchase support.',
      notes: 'Main merchandise shop is near the Main Admission Gate and secondary merchandise tents are near The Fare Way and 18 Green Market. Mock hours: 8:00 AM - 7:00 PM on public days. Popular items include tournament hats, polos, umbrellas, pin flags, youth apparel, and RBC Canadian Open collectibles. Cashless payment preferred.',
      checklistText: 'Main merch shop: Main Admission Gate\nSecondary tent: The Fare Way\nSecondary tent: 18 Green Market\nPersonalization booth: Main shop, 11 AM - 5 PM\nReturns handled at main shop only',
    }),
    createMockRbcTopic(9, {
      title: 'Course',
      kind: COURSE_TOPIC_KIND,
      summary: '18-hole course coordinate test data for tee and green wayfinding.',
      courseHoles: createMockRbcCourseHoles(),
    }),
    createMockRbcTopic(10, {
      title: 'Fan Services',
      kind: FAN_SERVICES_TOPIC_KIND,
      summary: 'Guest support, first aid, lost and found, accessibility help, and information desks.',
      fanServices: [
        { id: createLocalId('fan-service'), name: 'First aid', location: 'Medical tent near Accessible Services', latitude: '43.746010', longitude: '-79.956720' },
        { id: createLocalId('fan-service'), name: 'Lost and found', location: 'Main Fan Services tent', latitude: '43.746760', longitude: '-79.958740' },
        { id: createLocalId('fan-service'), name: 'Accessibility help', location: 'Accessible Services tent near Main Gate', latitude: '43.746210', longitude: '-79.957050' },
        { id: createLocalId('fan-service'), name: 'Information desk', location: 'Main Admission Gate', latitude: '43.746900', longitude: '-79.959020' },
        { id: createLocalId('fan-service'), name: 'Water refill station', location: 'Family Fairway', latitude: '43.745390', longitude: '-79.954520' },
      ],
    }),
  ];
}

function createMockRbcBoothContext(index = 0, existingContext = {}) {
  const source = existingContext && typeof existingContext === 'object' ? existingContext : {};
  const mockPlace = RBC_MOCK_BOOTH_PLACES[index % RBC_MOCK_BOOTH_PLACES.length];

  return {
    ...createDefaultBoothContext(),
    ...source,
    assistantName: source.assistantName || 'RBC Open Concierge',
    locationName: source.locationName || mockPlace.place,
    place: source.place || mockPlace.place,
    latitude: source.latitude || mockPlace.latitude,
    longitude: source.longitude || mockPlace.longitude,
    zone: source.zone || mockPlace.zone,
    landmark: source.landmark || mockPlace.landmark,
    directionsNotes: source.directionsNotes || 'Use the configured booth place as the walking-directions origin.',
  };
}

function createMockRbcBoothContexts(currentDraft, boothStationIds) {
  return boothStationIds.reduce((contexts, stationId, index) => ({
    ...contexts,
    [stationId]: createMockRbcBoothContext(index, currentDraft.boothContexts?.[stationId]),
  }), {});
}

function isRbcCanadianOpenMockDraft(event) {
  const general = event?.general || {};

  return String(general.eventName || '').trim().toUpperCase() === RBC_CANADIAN_OPEN_EVENT_NAME &&
    String(general.eventInfo || '').includes(RBC_MOCK_EVENT_INFO_MARKER);
}

function createBoothContextForEvent(event, stationIndex = 0) {
  if (isRbcCanadianOpenMockDraft(event)) {
    return createMockRbcBoothContext(stationIndex);
  }

  return createDefaultBoothContext();
}

function createMockRbcCanadianOpenDraft(currentDraft = createEmptyEventDraft()) {
  const boothStationIds = Array.isArray(currentDraft.boothStationIds) ? currentDraft.boothStationIds : [];
  const championshipPreset = SCREEN_UI_PRESETS.find((preset) => preset.id === 'championship') || SCREEN_UI_PRESETS[0];
  const screenUi = normalizeScreenUi({
    preset: championshipPreset.id,
    theme: championshipPreset.theme,
    features: {
      ...createDefaultScreenUi().features,
      qrDisplay: true,
      keyboardShortcuts: true,
      demoTalk: true,
    },
  });

  return normalizeEvent({
    ...createEmptyEventDraft(),
    general: {
      ...createDefaultGeneral(),
      eventName: RBC_CANADIAN_OPEN_EVENT_NAME,
      eventCategory: GOLF_CATEGORY,
      eventInfo: 'Mock test data for the 2026 RBC Canadian Open at TPC Toronto at Osprey Valley. Use this draft to test AI booth event info, transportation, concessions, fan zones, bathrooms, hospitality, schedule, course coordinates, and fan services before entering final production data.',
      address: '18821 Main Street',
      city: 'Caledon',
      zipCode: 'L7K 1R1',
      country: 'CA',
      startDate: '2026-06-10',
      endDate: '2026-06-14',
      rentalPolicy: DEFAULT_RENTAL_POLICY,
      supportFallback: 'the RBC Canadian Open fan services team',
    },
    agent: {
      ...createDefaultAgent(),
      ...(currentDraft.agent || {}),
      name: 'RBC Canadian Open Concierge',
      firstMessage: 'Welcome to the RBC Canadian Open. How can I help you?',
      systemPrompt: currentDraft.agent?.systemPrompt || STANDARD_SYSTEM_PROMPT,
      kioskAgents: currentDraft.agent?.kioskAgents || {},
    },
    boothStationIds,
    boothContexts: createMockRbcBoothContexts(currentDraft, boothStationIds),
    screenUi,
    screenUiByStationId: normalizeScreenUiByStationId(
      currentDraft.screenUiByStationId,
      boothStationIds,
      screenUi
    ),
    topics: createMockRbcCanadianOpenTopics(),
  });
}

function normalizeWifiSecurity(value, password = '') {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'NOPASS' || raw === 'NONE' || raw === 'OPEN') {
    return 'nopass';
  }
  if (raw === 'WEP') {
    return 'WEP';
  }
  return password ? 'WPA' : 'nopass';
}

function cloneEvent(event) {
  return JSON.parse(JSON.stringify(event));
}

function normalizeTopic(topic, index) {
  const title = String(topic?.title || '').trim();
  const rawKind = String(topic?.kind || '').trim();
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const kind = rawKind ||
    (title.toLowerCase() === 'phone chargers' ? PHONE_CHARGING_TOPIC_KIND : '') ||
    (normalizedTitle === 'wifi' ? WIFI_TOPIC_KIND : '') ||
    (normalizedTitle === 'transportation' ? TRANSPORTATION_TOPIC_KIND : '') ||
    (normalizedTitle === 'concessions' ? CONCESSIONS_TOPIC_KIND : '') ||
    (normalizedTitle === 'hospitality' ? HOSPITALITY_TOPIC_KIND : '') ||
    (normalizedTitle === 'bathrooms' ? BATHROOMS_TOPIC_KIND : '') ||
    (normalizedTitle === 'fanservices' ? FAN_SERVICES_TOPIC_KIND : '') ||
    (normalizedTitle === 'course' ? COURSE_TOPIC_KIND : '') ||
    (normalizedTitle === 'schedule' ? SCHEDULE_TOPIC_KIND : '');

  return {
    id: String(topic?.id || createLocalId('topic')).trim(),
    title: title || `Topic ${index + 1}`,
    kind,
    summary: String(topic?.summary || ''),
    notes: String(topic?.notes || ''),
    checklistText: String(topic?.checklistText || ''),
    wifiSsid: String(topic?.wifiSsid || topic?.wifi?.ssid || ''),
    wifiPassword: String(topic?.wifiPassword || topic?.wifi?.password || ''),
    wifiSecurity: normalizeWifiSecurity(
      topic?.wifiSecurity || topic?.wifi?.security,
      topic?.wifiPassword || topic?.wifi?.password
    ),
    wifiHidden: topic?.wifiHidden === true || topic?.wifi?.hidden === true,
    transportation: normalizeTransportationDetails(topic?.transportation),
    fanZones: normalizeFanZones(topic?.fanZones || topic?.zones),
    hospitalityLocations: normalizeHospitalityLocations(
      topic?.hospitalityLocations || topic?.hospitality || topic?.venues || (
        kind === HOSPITALITY_TOPIC_KIND ? topic?.locations : []
      )
    ),
    bathroomLocations: normalizeBathroomLocations(
      topic?.bathroomLocations || (kind === BATHROOMS_TOPIC_KIND ? topic?.locations : [])
    ),
    fanServices: normalizeFanServices(topic?.fanServices || topic?.services, kind === FAN_SERVICES_TOPIC_KIND),
    courseHoles: normalizeCourseHoles(topic?.courseHoles || topic?.holes, kind === COURSE_TOPIC_KIND),
    scheduleDays: normalizeScheduleDays(topic?.scheduleDays || topic?.schedule || topic?.days),
  };
}

function isPhoneChargingTopic(topic) {
  return String(topic?.kind || '').trim() === PHONE_CHARGING_TOPIC_KIND;
}

function isWifiTopic(topic) {
  const kind = String(topic?.kind || '').trim();
  const normalizedTitle = String(topic?.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return kind === WIFI_TOPIC_KIND || normalizedTitle === 'wifi';
}

function isTransportationTopic(topic) {
  const kind = String(topic?.kind || '').trim();
  const normalizedTitle = String(topic?.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return kind === TRANSPORTATION_TOPIC_KIND || normalizedTitle === 'transportation';
}

function isConcessionsTopic(topic) {
  const kind = String(topic?.kind || '').trim();
  const normalizedTitle = String(topic?.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return kind === CONCESSIONS_TOPIC_KIND || normalizedTitle === 'concessions';
}

function isHospitalityTopic(topic) {
  const kind = String(topic?.kind || '').trim();
  const normalizedTitle = String(topic?.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return kind === HOSPITALITY_TOPIC_KIND || normalizedTitle === 'hospitality';
}

function isBathroomsTopic(topic) {
  const kind = String(topic?.kind || '').trim();
  const normalizedTitle = String(topic?.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return kind === BATHROOMS_TOPIC_KIND || normalizedTitle === 'bathrooms';
}

function isFanServicesTopic(topic) {
  const kind = String(topic?.kind || '').trim();
  const normalizedTitle = String(topic?.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return kind === FAN_SERVICES_TOPIC_KIND || normalizedTitle === 'fanservices';
}

function isCourseTopic(topic) {
  const kind = String(topic?.kind || '').trim();
  const normalizedTitle = String(topic?.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return kind === COURSE_TOPIC_KIND || normalizedTitle === 'course';
}

function isScheduleTopic(topic) {
  const kind = String(topic?.kind || '').trim();
  const normalizedTitle = String(topic?.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return kind === SCHEDULE_TOPIC_KIND || normalizedTitle === 'schedule';
}

function normalizeActivation(activation, index) {
  const source = activation && typeof activation === 'object' ? activation : {};
  const name = String(source.name || '').trim();

  return {
    id: String(source.id || createLocalId('activation')).trim(),
    name: name || `Activation ${index + 1}`,
    sponsor: String(source.sponsor || ''),
    category: String(source.category || ''),
    location: String(source.location || ''),
    hours: String(source.hours || ''),
    description: String(source.description || ''),
    guestInstructions: String(source.guestInstructions || source.instructions || ''),
  };
}

function normalizeAgentKnowledgeBase(value) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    documentId: String(source.documentId || source.documentationId || ''),
    documentName: String(source.documentName || source.name || ''),
    documentType: String(source.documentType || source.type || ''),
    syncStatus: String(source.syncStatus || ''),
    syncError: String(source.syncError || ''),
    lastSyncedAt: normalizeTimestampValue(source.lastSyncedAt),
    lastSyncedBy: source.lastSyncedBy || null,
    previousDocumentIds: Array.isArray(source.previousDocumentIds)
      ? source.previousDocumentIds.map((documentId) => String(documentId || '').trim()).filter(Boolean)
      : [],
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
    knowledgeBase: normalizeAgentKnowledgeBase(source.knowledgeBase),
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
    place: String(source.place || ''),
    latitude: String(source.latitude ?? source.lat ?? ''),
    longitude: String(source.longitude ?? source.lon ?? ''),
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

function normalizePaymentTypeValue(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();

  return normalizedValue === 'stripe' ? 'stripe' : 'apollo';
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
      open24Hours: generalSource.open24Hours === true,
      phoneChargingEnabled: typeof generalSource.phoneChargingEnabled === 'boolean'
        ? generalSource.phoneChargingEnabled
        : false,
      paymentType: normalizePaymentTypeValue(generalSource.paymentType),
      eventInfo: String(generalSource.eventInfo || generalSource.basicEventInfo || ''),
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
    },
    agent: normalizeAgent(event?.agent),
    boothStationIds,
    boothContexts: normalizeBoothContexts(event?.boothContexts, boothStationIds),
    screenUi: normalizeScreenUi(event?.screenUi),
    screenUiByStationId: normalizeScreenUiByStationId(
      event?.screenUiByStationId,
      boothStationIds,
      event?.screenUi
    ),
    topics: Array.isArray(event?.topics) ? event.topics.map(normalizeTopic) : [],
    activations: Array.isArray(event?.activations) ? event.activations.map(normalizeActivation) : [],
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

function parseAiBoothRuntimeTimestamp(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  if (typeof value?.seconds === 'number') {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
  }

  return null;
}

function formatAiBoothRuntimeAge(timestampMs, nowMs) {
  if (!timestampMs) return 'Never reported';

  const elapsedSeconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.round(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
}

const AI_BOOTH_RUNTIME_CHECK_LABELS = Object.freeze({
  eventAssigned: 'event assigned',
  eventMatches: 'event config current',
  agentSynced: 'agent synced',
  agentMatches: 'agent id current',
  configCurrent: 'latest config loaded',
  serverReady: 'local server ready',
  pageLoaded: 'screen loaded',
  stationAssigned: 'station assigned',
});

function getAiBoothFailedCheckLabels(runtime) {
  const failedChecks = Array.isArray(runtime?.failedChecks)
    ? runtime.failedChecks
    : Object.entries(runtime?.checks || {})
      .filter(([, value]) => value !== true)
      .map(([key]) => key);

  return failedChecks.map((key) => AI_BOOTH_RUNTIME_CHECK_LABELS[key] || key);
}

function getAiBoothRuntimeHealth(kiosk, nowMs) {
  const runtime = kiosk?.aiBoothRuntime && typeof kiosk.aiBoothRuntime === 'object'
    ? kiosk.aiBoothRuntime
    : null;

  if (!runtime) {
    return {
      tone: 'slate',
      label: 'No heartbeat',
      detail: 'The booth app has not reported in yet.',
    };
  }

  const heartbeatMs = parseAiBoothRuntimeTimestamp(runtime.lastHeartbeatAtIso || runtime.lastHeartbeatAt);
  const ageLabel = formatAiBoothRuntimeAge(heartbeatMs, nowMs);

  if (!heartbeatMs || nowMs - heartbeatMs > AI_BOOTH_HEARTBEAT_STALE_MS) {
    return {
      tone: 'rose',
      label: 'Offline',
      detail: `Last heartbeat ${ageLabel}.`,
    };
  }

  if (runtime.state === 'running' && runtime.runtimeReady !== false) {
    return {
      tone: 'emerald',
      label: 'Running',
      detail: `Configured and reporting. Last heartbeat ${ageLabel}.`,
    };
  }

  if (runtime.state === 'registration') {
    return {
      tone: 'cyan',
      label: 'Registration',
      detail: `Booth app is waiting for provisioning. Last heartbeat ${ageLabel}.`,
    };
  }

  const failedLabels = getAiBoothFailedCheckLabels(runtime);
  return {
    tone: 'amber',
    label: 'Needs config',
    detail: failedLabels.length > 0
      ? `Missing: ${failedLabels.join(', ')}. Last heartbeat ${ageLabel}.`
      : `Booth is reporting but not ready. Last heartbeat ${ageLabel}.`,
  };
}

function getAiBoothHealthBadgeClasses(tone) {
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700';
  if (tone === 'amber') return 'bg-amber-50 text-amber-700';
  if (tone === 'rose') return 'bg-rose-50 text-rose-700';
  if (tone === 'cyan') return 'bg-cyan-50 text-cyan-700';
  return 'bg-white text-slate-600';
}

function getScreenUiTopicRows(topics = []) {
  return [
    { key: EVENT_INFO_TOPIC_KEY, label: 'Venue Info', colorIndex: -1 },
    ...topics.map((topic, index) => ({
      key: topic.id,
      label: topic.title || `Topic ${index + 1}`,
      colorIndex: index,
    })),
  ];
}

function getDefaultScreenUiTopicColor(colorIndex) {
  if (colorIndex < 0) {
    return DEFAULT_SCREEN_UI.theme.topicColors[EVENT_INFO_TOPIC_KEY];
  }

  return SCREEN_UI_TOPIC_PALETTE[colorIndex % SCREEN_UI_TOPIC_PALETTE.length];
}

function getScreenUiTopicColor(screenUi, topicRow) {
  const normalizedScreenUi = normalizeScreenUi(screenUi);
  return normalizeHexColor(
    normalizedScreenUi.theme.topicColors[topicRow.key],
    getDefaultScreenUiTopicColor(topicRow.colorIndex)
  );
}

function getStationScreenUi(event, stationId) {
  const screenUiByStationId = event?.screenUiByStationId && typeof event.screenUiByStationId === 'object'
    ? event.screenUiByStationId
    : {};

  return normalizeScreenUi((stationId && screenUiByStationId[stationId]) || event?.screenUi);
}

function buildScreenUiPreviewUrl({ eventId = '', stationId = '', agentId = '' } = {}) {
  const url = new URL(SCREEN_UI_PREVIEW_BASE_URL, window.location.origin);

  if (eventId) {
    url.searchParams.set('eventId', eventId);
  }

  if (stationId) {
    url.searchParams.set('stationId', stationId);
  }

  if (agentId) {
    url.searchParams.set('agentId', agentId);
  }

  url.searchParams.set('preview', '1');
  url.searchParams.set('trustedOrigins', window.location.origin);
  return url.toString();
}

function getScreenUiPreviewOrigin(previewUrl) {
  try {
    return new URL(previewUrl).origin;
  } catch {
    return '*';
  }
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

function GeneralField({ label, type = 'text', value, onChange, placeholder, className = '' }) {
  const fieldValue = value ?? '';

  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={fieldValue}
          onChange={onChange}
          placeholder={placeholder}
          rows={5}
          className={`${FIELD_CLASSES} resize-y`}
        />
      ) : (
        <input
          type={type}
          value={fieldValue}
          onChange={onChange}
          placeholder={placeholder}
          className={FIELD_CLASSES}
        />
      )}
    </label>
  );
}

function AddPanelButton({ label, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-3 rounded-lg border border-dashed border-sky-300 bg-sky-50 px-4 py-5 text-sm font-semibold text-sky-800 transition hover:border-sky-400 hover:bg-sky-100 ${className}`}
    >
      <span className="text-2xl leading-none">+</span>
      <span>{label}</span>
    </button>
  );
}

function TransportationSectionEditor({
  title,
  description,
  details,
  locationLabel = 'Location',
  detailsLabel = 'Details',
  useTimeRange = false,
  onAddLocation,
  onLocationFieldChange,
  onDeleteLocation,
}) {
  const sectionDetails = normalizeTransportationSection(details);
  const locations = sectionDetails.locations;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>

      <div className="mt-4 space-y-4">
        {locations.map((location, index) => (
          <div key={location.id} className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    {location.location || `${title} Location ${index + 1}`}
                  </h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Add the guest-facing place, coordinates, hours, and instructions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteLocation(location.id)}
                  className="self-start rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  Delete
                </button>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <GeneralField
                  label={locationLabel}
                  value={location.location}
                  onChange={(event) => onLocationFieldChange(location.id, 'location', event.target.value)}
                  placeholder="Pickup point, lot, gate, or zone"
                  className={useTimeRange ? 'md:col-span-2' : ''}
                />
                {useTimeRange ? (
                  <div className="grid gap-4 md:col-span-2 md:grid-cols-3">
                    <GeneralField
                      label="From"
                      value={location.startTime}
                      onChange={(event) => onLocationFieldChange(location.id, 'startTime', event.target.value)}
                      placeholder="7:00 AM"
                    />
                    <GeneralField
                      label="To"
                      value={location.endTime}
                      onChange={(event) => onLocationFieldChange(location.id, 'endTime', event.target.value)}
                      placeholder="11:00 PM"
                    />
                    <GeneralField
                      label="Frequency"
                      value={location.frequency}
                      onChange={(event) => onLocationFieldChange(location.id, 'frequency', event.target.value)}
                      placeholder="Every 15 minutes"
                    />
                  </div>
                ) : (
                  <GeneralField
                    label="Hours"
                    value={location.hours}
                    onChange={(event) => onLocationFieldChange(location.id, 'hours', event.target.value)}
                    placeholder="Daily hours or service window"
                  />
                )}
                <GeneralField
                  label="Latitude"
                  value={location.latitude}
                  onChange={(event) => onLocationFieldChange(location.id, 'latitude', event.target.value)}
                  placeholder="43.6532"
                />
                <GeneralField
                  label="Longitude"
                  value={location.longitude}
                  onChange={(event) => onLocationFieldChange(location.id, 'longitude', event.target.value)}
                  placeholder="-79.3832"
                />
                <GeneralField
                  label={detailsLabel}
                  type="textarea"
                  value={location.details}
                  onChange={(event) => onLocationFieldChange(location.id, 'details', event.target.value)}
                  placeholder="Guest instructions, route details, accessibility notes, or fallback directions."
                  className="md:col-span-2"
                />
              </div>
            </div>
          </div>
        ))}
        <AddPanelButton label={`Add ${title} Location`} onClick={() => onAddLocation()} />
      </div>
    </div>
  );
}

function FanZoneEditor({
  zone,
  onFieldChange,
  onDelete,
  onAddActivation,
  onActivationFieldChange,
  onDeleteActivation,
}) {
  const normalizedZone = normalizeFanZone(zone);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{normalizedZone.name}</h3>
          <p className="mt-1 text-sm text-slate-600">
            Add the zone coordinates, guest hours, and activations inside this fan zone.
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
        >
          Delete Zone
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GeneralField
          label="Fan Zone Name"
          value={normalizedZone.name}
          onChange={(event) => onFieldChange('name', event.target.value)}
          placeholder="Fan Zone"
        />
        <GeneralField
          label="Open Hours"
          value={normalizedZone.openHours}
          onChange={(event) => onFieldChange('openHours', event.target.value)}
          placeholder="10 AM - 7 PM"
        />
        <GeneralField
          label="Latitude"
          value={normalizedZone.latitude}
          onChange={(event) => onFieldChange('latitude', event.target.value)}
          placeholder="43.6414"
        />
        <GeneralField
          label="Longitude"
          value={normalizedZone.longitude}
          onChange={(event) => onFieldChange('longitude', event.target.value)}
          placeholder="-79.3894"
        />
        <GeneralField
          label="Zone Details"
          type="textarea"
          value={normalizedZone.details}
          onChange={(event) => onFieldChange('details', event.target.value)}
          placeholder="Food options, seating, entertainment, accessibility, sponsor info, or wayfinding notes."
          className="md:col-span-2"
        />
      </div>

      <div className="mt-5 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Activations</h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Add each experience, booth, sponsor stop, or activity inside this zone.
            </p>
          </div>
        </div>

        {normalizedZone.activations.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-slate-600">
            No activations added for this fan zone yet.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {normalizedZone.activations.map((activation) => (
              <div key={activation.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{activation.name}</p>
                  <button
                    type="button"
                    onClick={() => onDeleteActivation(activation.id)}
                    className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                  >
                    Delete
                  </button>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <GeneralField
                    label="Activation Name"
                    value={activation.name}
                    onChange={(event) => onActivationFieldChange(activation.id, 'name', event.target.value)}
                    placeholder="Sponsor Experience"
                  />
                  <GeneralField
                    label="Sponsor"
                    value={activation.sponsor}
                    onChange={(event) => onActivationFieldChange(activation.id, 'sponsor', event.target.value)}
                    placeholder="Sponsor or operator"
                  />
                  <GeneralField
                    label="Location"
                    value={activation.location}
                    onChange={(event) => onActivationFieldChange(activation.id, 'location', event.target.value)}
                    placeholder="Inside fan zone, booth number, or landmark"
                  />
                  <GeneralField
                    label="Hours"
                    value={activation.hours}
                    onChange={(event) => onActivationFieldChange(activation.id, 'hours', event.target.value)}
                    placeholder="Activation hours"
                  />
                  <GeneralField
                    label="Details"
                    type="textarea"
                    value={activation.details}
                    onChange={(event) => onActivationFieldChange(activation.id, 'details', event.target.value)}
                    placeholder="What guests can do, eligibility, prizes, staff notes, or instructions."
                    className="md:col-span-2"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <AddPanelButton label="Add Activation" onClick={onAddActivation} className="mt-4" />
      </div>
    </div>
  );
}

function HospitalityClientEditor({ client, onFieldChange, onDelete }) {
  const normalizedClient = normalizeHospitalityClient(client);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{normalizedClient.clientName}</p>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
        >
          Delete
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GeneralField
          label="Client / Company"
          value={normalizedClient.clientName}
          onChange={(event) => onFieldChange('clientName', event.target.value)}
          placeholder="Client company or guest group"
        />
        <GeneralField
          label="Host Name"
          value={normalizedClient.hostName}
          onChange={(event) => onFieldChange('hostName', event.target.value)}
          placeholder="On-site host or concierge"
        />
        <GeneralField
          label="Contact Name"
          value={normalizedClient.contactName}
          onChange={(event) => onFieldChange('contactName', event.target.value)}
          placeholder="Primary contact"
        />
        <GeneralField
          label="Contact Phone"
          value={normalizedClient.contactPhone}
          onChange={(event) => onFieldChange('contactPhone', event.target.value)}
          placeholder="416-555-0100"
        />
        <GeneralField
          label="Contact Email"
          type="email"
          value={normalizedClient.contactEmail}
          onChange={(event) => onFieldChange('contactEmail', event.target.value)}
          placeholder="host@example.com"
        />
        <GeneralField
          label="Credential Notes"
          type="textarea"
          value={normalizedClient.credentialNotes}
          onChange={(event) => onFieldChange('credentialNotes', event.target.value)}
          placeholder="Credential type, wristband, badge, ticket scan, or access requirement."
          className="md:col-span-2"
        />
        <GeneralField
          label="Arrival Notes"
          type="textarea"
          value={normalizedClient.arrivalNotes}
          onChange={(event) => onFieldChange('arrivalNotes', event.target.value)}
          placeholder="Gate, checkpoint, arrival window, or host desk instructions."
        />
        <GeneralField
          label="Special Requests"
          type="textarea"
          value={normalizedClient.specialRequests}
          onChange={(event) => onFieldChange('specialRequests', event.target.value)}
          placeholder="Dietary needs, accessibility, VIP requests, or operational notes."
        />
      </div>
    </div>
  );
}

function HospitalityLocationEditor({
  location,
  onFieldChange,
  onVenueTypeChange,
  onDelete,
  onAddClient,
  onClientFieldChange,
  onDeleteClient,
}) {
  const normalizedLocation = normalizeHospitalityLocation(location);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{normalizedLocation.name}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {getHospitalityVenueTypeLabel(normalizedLocation.venueType)} at {normalizedLocation.location || 'unassigned location'}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
        >
          Delete Location
        </button>
      </div>

      <div className="mt-4">
        <span className="text-sm font-semibold text-slate-700">Venue Type</span>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {HOSPITALITY_VENUE_TYPES.map((option) => {
            const selected = normalizedLocation.venueType === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onVenueTypeChange(option.value)}
                className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                  selected
                    ? 'border-cyan-300 bg-cyan-50 text-cyan-900'
                    : 'border-gray-200 bg-white text-slate-700 hover:border-cyan-200'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GeneralField
          label="Name"
          value={normalizedLocation.name}
          onChange={(event) => onFieldChange('name', event.target.value)}
          placeholder="RBC Sky Suite"
        />
        <GeneralField
          label="Location"
          value={normalizedLocation.location}
          onChange={(event) => onFieldChange('location', event.target.value)}
          placeholder="18 green"
        />
        <GeneralField
          label="Latitude"
          value={normalizedLocation.latitude}
          onChange={(event) => onFieldChange('latitude', event.target.value)}
          placeholder="43.6414"
        />
        <GeneralField
          label="Longitude"
          value={normalizedLocation.longitude}
          onChange={(event) => onFieldChange('longitude', event.target.value)}
          placeholder="-79.3894"
        />
        <GeneralField
          label="Amenities"
          type="textarea"
          value={normalizedLocation.amenities}
          onChange={(event) => onFieldChange('amenities', event.target.value)}
          placeholder="Food and beverages, washrooms, TVs, shared deck, host desk, or other inclusions."
          className="md:col-span-2"
        />
        <GeneralField
          label="Access Notes"
          type="textarea"
          value={normalizedLocation.accessNotes}
          onChange={(event) => onFieldChange('accessNotes', event.target.value)}
          placeholder="Credential, wristband, ticket scan, gate, or checkpoint instructions."
        />
        <GeneralField
          label="Details"
          type="textarea"
          value={normalizedLocation.details}
          onChange={(event) => onFieldChange('details', event.target.value)}
          placeholder="Guest-facing venue description or staff notes."
        />
      </div>

      <div className="mt-5 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Assigned Clients</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Add each client group, contact, credential details, guest count, and arrival notes.
          </p>
        </div>

        {normalizedLocation.clients.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-slate-600">
            No clients assigned to this hospitality location yet.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {normalizedLocation.clients.map((client) => (
              <HospitalityClientEditor
                key={client.id}
                client={client}
                onFieldChange={(field, value) => onClientFieldChange(client.id, field, value)}
                onDelete={() => onDeleteClient(client.id)}
              />
            ))}
          </div>
        )}
        <AddPanelButton label="Add Client" onClick={onAddClient} className="mt-4" />
      </div>
    </div>
  );
}

function BathroomLocationEditor({ location, onFieldChange, onDelete }) {
  const normalizedLocation = normalizeBathroomLocation(location);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{normalizedLocation.place}</p>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
        >
          Delete
        </button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <GeneralField
          label="Place"
          value={normalizedLocation.place}
          onChange={(event) => onFieldChange('place', event.target.value)}
          placeholder="Near hole 4, clubhouse, main gate"
        />
        <GeneralField
          label="Latitude"
          value={normalizedLocation.latitude}
          onChange={(event) => onFieldChange('latitude', event.target.value)}
          placeholder="43.6414"
        />
        <GeneralField
          label="Longitude"
          value={normalizedLocation.longitude}
          onChange={(event) => onFieldChange('longitude', event.target.value)}
          placeholder="-79.3894"
        />
      </div>
    </div>
  );
}

function FanServiceEditor({ service, onFieldChange, onDelete }) {
  const normalizedService = normalizeFanService(service);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{normalizedService.name}</p>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
        >
          Delete
        </button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GeneralField
          label="Name"
          value={normalizedService.name}
          onChange={(event) => onFieldChange('name', event.target.value)}
          placeholder="First aid"
        />
        <GeneralField
          label="Location"
          value={normalizedService.location}
          onChange={(event) => onFieldChange('location', event.target.value)}
          placeholder="Medical tent, guest services desk, gate A"
        />
        <GeneralField
          label="Latitude"
          value={normalizedService.latitude}
          onChange={(event) => onFieldChange('latitude', event.target.value)}
          placeholder="43.6414"
        />
        <GeneralField
          label="Longitude"
          value={normalizedService.longitude}
          onChange={(event) => onFieldChange('longitude', event.target.value)}
          placeholder="-79.3894"
        />
      </div>
    </div>
  );
}

function CourseHoleEditor({ hole, onFieldChange }) {
  const normalizedHole = normalizeCourseHole(hole);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">Hole {normalizedHole.holeNumber}</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GeneralField
          label="Tee Latitude"
          value={normalizedHole.teeLatitude}
          onChange={(event) => onFieldChange('teeLatitude', event.target.value)}
          placeholder="43.6414"
        />
        <GeneralField
          label="Tee Longitude"
          value={normalizedHole.teeLongitude}
          onChange={(event) => onFieldChange('teeLongitude', event.target.value)}
          placeholder="-79.3894"
        />
        <GeneralField
          label="Green Latitude"
          value={normalizedHole.greenLatitude}
          onChange={(event) => onFieldChange('greenLatitude', event.target.value)}
          placeholder="43.6421"
        />
        <GeneralField
          label="Green Longitude"
          value={normalizedHole.greenLongitude}
          onChange={(event) => onFieldChange('greenLongitude', event.target.value)}
          placeholder="-79.3901"
        />
      </div>
    </div>
  );
}

function ScheduleEventEditor({ scheduleEvent, onFieldChange, onDelete }) {
  const normalizedEvent = normalizeScheduleEvent(scheduleEvent);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{normalizedEvent.title}</p>
          <p className="mt-1 text-xs text-slate-500">
            {[normalizedEvent.startTime, normalizedEvent.endTime].filter(Boolean).join(' - ') || 'No time set'}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
        >
          Delete
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GeneralField
          label="Item Name"
          value={normalizedEvent.title}
          onChange={(event) => onFieldChange('title', event.target.value)}
          placeholder="First Round Play"
        />
        <GeneralField
          label="Category"
          value={normalizedEvent.category}
          onChange={(event) => onFieldChange('category', event.target.value)}
          placeholder="Tournament Round, Pro-Am, Ceremony, Practice, Youth Program"
        />
        <GeneralField
          label="Start Time"
          value={normalizedEvent.startTime}
          onChange={(event) => onFieldChange('startTime', event.target.value)}
          placeholder="7:00 am"
        />
        <GeneralField
          label="End Time"
          value={normalizedEvent.endTime}
          onChange={(event) => onFieldChange('endTime', event.target.value)}
          placeholder="7:30 pm"
        />
        <GeneralField
          label="Location"
          value={normalizedEvent.location}
          onChange={(event) => onFieldChange('location', event.target.value)}
          placeholder="Main stage, first tee, full course"
        />
        <GeneralField
          label="Audience / Access"
          value={normalizedEvent.audience}
          onChange={(event) => onFieldChange('audience', event.target.value)}
          placeholder="Public, closed to public, VIP, school groups"
        />
        <GeneralField
          label="Details"
          type="textarea"
          value={normalizedEvent.details}
          onChange={(event) => onFieldChange('details', event.target.value)}
          placeholder="Guest-facing description, operational notes, or what the booth should tell guests."
          className="md:col-span-2"
        />
        <GeneralField
          label="Source Note"
          type="textarea"
          value={normalizedEvent.sourceNote}
          onChange={(event) => onFieldChange('sourceNote', event.target.value)}
          placeholder="Use this for source warnings, TBD info, or known typos."
          className="md:col-span-2"
        />
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 md:col-span-2">
          <input
            type="checkbox"
            checked={normalizedEvent.needsReview}
            onChange={(event) => onFieldChange('needsReview', event.target.checked)}
            className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
          />
          Needs review before publishing
        </label>
      </div>
    </div>
  );
}

function ScheduleDayEditor({
  day,
  onFieldChange,
  onDelete,
  onAddEvent,
  onEventFieldChange,
  onDeleteEvent,
}) {
  const normalizedDay = normalizeScheduleDay(day);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{normalizedDay.dayLabel}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {[normalizedDay.publicStatus, normalizedDay.theme].filter(Boolean).join(' - ') || 'Tournament schedule day'}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
        >
          Delete Day
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <GeneralField
          label="Date"
          type="date"
          value={normalizedDay.date}
          onChange={(event) => onFieldChange('date', event.target.value)}
        />
        <GeneralField
          label="Day Label"
          value={normalizedDay.dayLabel}
          onChange={(event) => onFieldChange('dayLabel', event.target.value)}
          placeholder="Thursday, June 11, 2026"
        />
        <GeneralField
          label="Status / Access"
          value={normalizedDay.publicStatus}
          onChange={(event) => onFieldChange('publicStatus', event.target.value)}
          placeholder="Public event day, closed to public, VIP only"
        />
        <GeneralField
          label="Theme"
          value={normalizedDay.theme}
          onChange={(event) => onFieldChange('theme', event.target.value)}
          placeholder="Round 1, Championship Sunday"
        />
        <GeneralField
          label="Gates Open"
          value={normalizedDay.gatesOpen}
          onChange={(event) => onFieldChange('gatesOpen', event.target.value)}
          placeholder="6:30 am"
        />
        <GeneralField
          label="Gates Close"
          value={normalizedDay.gatesClose}
          onChange={(event) => onFieldChange('gatesClose', event.target.value)}
          placeholder="Optional"
        />
        <GeneralField
          label="Daily Notes"
          type="textarea"
          value={normalizedDay.dailyNotes}
          onChange={(event) => onFieldChange('dailyNotes', event.target.value)}
          placeholder="Daily guest-facing context, weather contingencies, policy notes, or source caveats."
          className="md:col-span-2"
        />
      </div>

      <div className="mt-5 space-y-4">
        {normalizedDay.events.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-300 bg-white px-4 py-5 text-sm text-slate-600">
            No schedule items have been added for this day yet.
          </div>
        ) : (
          normalizedDay.events.map((scheduleEvent) => (
            <ScheduleEventEditor
              key={scheduleEvent.id}
              scheduleEvent={scheduleEvent}
              onFieldChange={(field, value) => onEventFieldChange(scheduleEvent.id, field, value)}
              onDelete={() => onDeleteEvent(scheduleEvent.id)}
            />
          ))
        )}
        <AddPanelButton label="Add Item" onClick={onAddEvent} />
      </div>
    </div>
  );
}

function ScreenUiColorField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="mt-2 flex items-center gap-3 rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
          aria-label={`${label} color`}
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-sm text-slate-900 outline-none"
          aria-label={`${label} hex value`}
        />
      </div>
    </label>
  );
}

function ScreenUiToggle({ label, description, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-cyan-200">
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <span className={`relative mt-1 inline-flex h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-cyan-600' : 'bg-slate-300'}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="sr-only"
        />
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
      </span>
    </label>
  );
}

function EventInfoToggle({ label, description, checked, onChange, className = '' }) {
  return (
    <label className={`flex min-h-[78px] cursor-pointer items-center justify-between gap-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 transition hover:border-cyan-200 ${className}`}>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-cyan-600' : 'bg-slate-300'}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="sr-only"
        />
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
      </span>
    </label>
  );
}

function PaymentTypeSwitch({ value, onChange, disabled = false, className = '' }) {
  const selectedValue = normalizePaymentTypeValue(value);

  return (
    <fieldset className={`block ${disabled ? 'opacity-50' : ''} ${className}`}>
      <legend className="text-sm font-semibold text-slate-700">Payment Type</legend>
      <div className="mt-2 grid grid-cols-2 rounded-md bg-gray-100 p-1 shadow-inner">
        {PAYMENT_TYPE_OPTIONS.map((option) => {
          const isSelected = selectedValue === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                if (!disabled) {
                  onChange(option.value);
                }
              }}
              disabled={disabled}
              className={`min-h-[42px] rounded-md px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed ${
                isSelected
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white hover:text-gray-900 disabled:hover:bg-transparent disabled:hover:text-gray-600'
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

function CategoryField({ category, onCategoryChange, className = '' }) {
  const selectedCategory = String(category || '').trim();
  const hasLegacyCategory = selectedCategory && !CATEGORY_OPTIONS.some((option) => option.value === selectedCategory);

  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-semibold text-slate-700">Category</span>
      <select
        value={selectedCategory}
        onChange={(event) => onCategoryChange(event.target.value)}
        className={FIELD_CLASSES}
      >
        <option value="">Select category</option>
        {CATEGORY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {hasLegacyCategory && (
          <option value={selectedCategory}>{selectedCategory}</option>
        )}
      </select>
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
  const [selectedScreenUiStationId, setSelectedScreenUiStationId] = useState('');
  const [screenUiPreviewExpanded, setScreenUiPreviewExpanded] = useState(false);
  const [customScreenUiPalettes, setCustomScreenUiPalettes] = useState(loadCustomScreenUiPalettes);
  const [elevenLabsAgents, setElevenLabsAgents] = useState([]);
  const [elevenLabsAgentsLoading, setElevenLabsAgentsLoading] = useState(false);
  const [elevenLabsAgentsError, setElevenLabsAgentsError] = useState('');
  const [healthNowMs, setHealthNowMs] = useState(() => Date.now());
  const topicLongPressTimerRef = useRef(null);
  const topicLongPressTriggeredRef = useRef(false);
  const boothPreviewFrameRef = useRef(null);

  useEffect(() => () => {
    if (topicLongPressTimerRef.current) {
      window.clearTimeout(topicLongPressTimerRef.current);
    }
  }, []);

  useEffect(() => {
    persistCustomScreenUiPalettes(customScreenUiPalettes);
  }, [customScreenUiPalettes]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setHealthNowMs(Date.now());
    }, 15000);

    return () => window.clearInterval(intervalId);
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
      setSelectedScreenUiStationId(nextEvents[0]?.boothStationIds?.[0] || '');
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

  useEffect(() => {
    if (selectedScreenUiStationId && eventDraft.boothStationIds.includes(selectedScreenUiStationId)) {
      return;
    }

    setSelectedScreenUiStationId(eventDraft.boothStationIds[0] || '');
  }, [eventDraft.boothStationIds, selectedScreenUiStationId]);

  const allAiBooths = useMemo(() => {
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

  const selectedBoothSet = useMemo(() => new Set(eventDraft.boothStationIds), [eventDraft.boothStationIds]);

  const availableBooths = useMemo(() => {
    return allAiBooths.filter((booth) => !selectedBoothSet.has(booth.stationid));
  }, [allAiBooths, selectedBoothSet]);

  const availableBoothMap = useMemo(() => {
    return new Map(allAiBooths.map((booth) => [booth.stationid, booth]));
  }, [allAiBooths]);

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

  const activeScreenUiStationId = selectedBoothSet.has(selectedScreenUiStationId)
    ? selectedScreenUiStationId
    : eventDraft.boothStationIds[0] || '';
  const activeScreenUi = useMemo(() => (
    getStationScreenUi(eventDraft, activeScreenUiStationId)
  ), [activeScreenUiStationId, eventDraft]);

  const eventLastUpdated = eventDraft.updatedAt || eventDraft.createdAt;
  const syncedKioskAgentCount = eventDraft.boothStationIds.filter((stationId) => (
    eventDraft.agent?.kioskAgents?.[stationId]?.syncStatus === 'synced'
  )).length;
  const previewStationId = activeScreenUiStationId;
  const previewAgentId = eventDraft.agent?.kioskAgents?.[previewStationId]?.agentId || eventDraft.agent?.agentId || '';
  const screenUiPreviewUrl = buildScreenUiPreviewUrl({
    eventId: selectedEventId || eventDraft.id,
    stationId: previewStationId,
    agentId: previewAgentId,
  });
  const screenUiPreviewOrigin = getScreenUiPreviewOrigin(screenUiPreviewUrl);
  const screenUiTopicRows = useMemo(() => getScreenUiTopicRows(eventDraft.topics), [eventDraft.topics]);
  const screenUiPaletteOptions = useMemo(() => (
    [...SCREEN_UI_PRESETS, ...customScreenUiPalettes]
  ), [customScreenUiPalettes]);

  useEffect(() => {
    if (activeWorkspaceTab !== 'screen') {
      return;
    }

    postScreenUiToPreview();
  }, [activeWorkspaceTab, activeScreenUi, eventDraft.topics, screenUiPreviewOrigin]);

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
    setSelectedScreenUiStationId(nextEvent?.boothStationIds?.[0] || '');
    setScreenUiPreviewExpanded(false);
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

  function handleFillMockGolfData() {
    const shouldReplace = !dirty || window.confirm(
      'Replace the current event form with RBC Canadian Open mock data? Existing booth assignments, screen UI station links, and agent IDs will be kept.'
    );

    if (!shouldReplace) {
      return;
    }

    const mockEvent = createMockRbcCanadianOpenDraft(eventDraft);
    setSelectedEventId('');
    setEventDraft(mockEvent);
    setActiveWorkspaceTab('event');
    setActiveTabId('general');
    setSelectedScreenUiStationId(mockEvent.boothStationIds[0] || '');
    setDirty(true);
    setStatus({
      state: 'success',
      message: 'RBC Canadian Open mock golf data loaded. Review it, then save when ready.',
    });
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

  function handleCategoryChange(value) {
    const normalizedValue = String(value || '').trim();
    const templateTopics = createMissingTemplateTopics(eventDraft.topics, normalizedValue);

    setEventDraft((current) => {
      const currentTemplateTopics = current.topics === eventDraft.topics ?
        templateTopics :
        createMissingTemplateTopics(current.topics, normalizedValue);

      return {
        ...current,
        general: {
          ...current.general,
          eventCategory: normalizedValue,
        },
        topics: currentTemplateTopics.length > 0 ?
          [...current.topics, ...currentTemplateTopics] :
          current.topics,
      };
    });

    if (templateTopics[0]) {
      setActiveTabId('general');
      setStatus({
        state: 'success',
        message: `${normalizedValue} template added ${templateTopics.length} topic tabs.`,
      });
    }

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

  function addTransportationLocation(topicId, section) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        const transportation = normalizeTransportationDetails(topic.transportation);
        const sectionDetails = normalizeTransportationSection(transportation[section]);
        const nextLocation = createDefaultTransportationLocation();

        return {
          ...topic,
          transportation: {
            ...transportation,
            [section]: {
              ...sectionDetails,
              locations: [...sectionDetails.locations, nextLocation],
            },
          },
        };
      }),
    }));
    markDirty();
  }

  function updateTransportationLocationField(topicId, section, locationId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        const transportation = normalizeTransportationDetails(topic.transportation);
        const sectionDetails = normalizeTransportationSection(transportation[section]);

        return {
          ...topic,
          transportation: {
            ...transportation,
            [section]: {
              ...sectionDetails,
              locations: sectionDetails.locations.map((location) => (
                location.id === locationId ? { ...location, [field]: value } : location
              )),
            },
          },
        };
      }),
    }));
    markDirty();
  }

  function deleteTransportationLocation(topicId, section, locationId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        const transportation = normalizeTransportationDetails(topic.transportation);
        const sectionDetails = normalizeTransportationSection(transportation[section]);

        return {
          ...topic,
          transportation: {
            ...transportation,
            [section]: {
              ...sectionDetails,
              locations: sectionDetails.locations.filter((location) => location.id !== locationId),
            },
          },
        };
      }),
    }));
    markDirty();
  }

  function addFanZone(topicId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        const fanZones = normalizeFanZones(topic.fanZones);

        return {
          ...topic,
          fanZones: [
            ...fanZones,
            createDefaultFanZone(fanZones.length),
          ],
        };
      }),
    }));
    markDirty();
  }

  function updateFanZoneField(topicId, zoneId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          fanZones: normalizeFanZones(topic.fanZones).map((zone) => (
            zone.id === zoneId ? { ...zone, [field]: value } : zone
          )),
        };
      }),
    }));
    markDirty();
  }

  function deleteFanZone(topicId, zoneId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? { ...topic, fanZones: normalizeFanZones(topic.fanZones).filter((zone) => zone.id !== zoneId) }
          : topic
      )),
    }));
    markDirty();
  }

  function addFanZoneActivation(topicId, zoneId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          fanZones: normalizeFanZones(topic.fanZones).map((zone) => {
            if (zone.id !== zoneId) {
              return zone;
            }

            return {
              ...zone,
              activations: [
                ...zone.activations,
                createDefaultFanZoneActivation(zone.activations.length),
              ],
            };
          }),
        };
      }),
    }));
    markDirty();
  }

  function updateFanZoneActivationField(topicId, zoneId, activationId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          fanZones: normalizeFanZones(topic.fanZones).map((zone) => {
            if (zone.id !== zoneId) {
              return zone;
            }

            return {
              ...zone,
              activations: zone.activations.map((activation) => (
                activation.id === activationId ? { ...activation, [field]: value } : activation
              )),
            };
          }),
        };
      }),
    }));
    markDirty();
  }

  function deleteFanZoneActivation(topicId, zoneId, activationId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          fanZones: normalizeFanZones(topic.fanZones).map((zone) => (
            zone.id === zoneId
              ? {
                  ...zone,
                  activations: zone.activations.filter((activation) => activation.id !== activationId),
                }
              : zone
          )),
        };
      }),
    }));
    markDirty();
  }

  function addHospitalityLocation(topicId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        const hospitalityLocations = normalizeHospitalityLocations(topic.hospitalityLocations || topic.hospitality || topic.venues);

        return {
          ...topic,
          hospitalityLocations: [
            ...hospitalityLocations,
            createDefaultHospitalityLocation(hospitalityLocations.length),
          ],
        };
      }),
    }));
    markDirty();
  }

  function applyHospitalityLocationVenueType(topicId, locationId, venueType) {
    updateHospitalityLocationField(topicId, locationId, 'venueType', venueType);
  }

  function updateHospitalityLocationField(topicId, locationId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              hospitalityLocations: normalizeHospitalityLocations(topic.hospitalityLocations || topic.hospitality || topic.venues).map((location) => (
                location.id === locationId ? { ...location, [field]: value } : location
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function deleteHospitalityLocation(topicId, locationId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              hospitalityLocations: normalizeHospitalityLocations(topic.hospitalityLocations || topic.hospitality || topic.venues).filter((location) => (
                location.id !== locationId
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function addHospitalityClient(topicId, locationId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          hospitalityLocations: normalizeHospitalityLocations(topic.hospitalityLocations || topic.hospitality || topic.venues).map((location) => {
            if (location.id !== locationId) {
              return location;
            }

            return {
              ...location,
              clients: [
                ...location.clients,
                createDefaultHospitalityClient(location.clients.length),
              ],
            };
          }),
        };
      }),
    }));
    markDirty();
  }

  function updateHospitalityClientField(topicId, locationId, clientId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          hospitalityLocations: normalizeHospitalityLocations(topic.hospitalityLocations || topic.hospitality || topic.venues).map((location) => {
            if (location.id !== locationId) {
              return location;
            }

            return {
              ...location,
              clients: location.clients.map((client) => (
                client.id === clientId ? { ...client, [field]: value } : client
              )),
            };
          }),
        };
      }),
    }));
    markDirty();
  }

  function deleteHospitalityClient(topicId, locationId, clientId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          hospitalityLocations: normalizeHospitalityLocations(topic.hospitalityLocations || topic.hospitality || topic.venues).map((location) => (
            location.id === locationId
              ? {
                  ...location,
                  clients: location.clients.filter((client) => client.id !== clientId),
                }
              : location
          )),
        };
      }),
    }));
    markDirty();
  }

  function addBathroomLocation(topicId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        const bathroomLocations = normalizeBathroomLocations(topic.bathroomLocations || topic.locations);

        return {
          ...topic,
          bathroomLocations: [
            ...bathroomLocations,
            createDefaultBathroomLocation(bathroomLocations.length),
          ],
        };
      }),
    }));
    markDirty();
  }

  function updateBathroomLocationField(topicId, locationId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              bathroomLocations: normalizeBathroomLocations(topic.bathroomLocations || topic.locations).map((location) => (
                location.id === locationId ? { ...location, [field]: value } : location
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function deleteBathroomLocation(topicId, locationId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              bathroomLocations: normalizeBathroomLocations(topic.bathroomLocations || topic.locations).filter((location) => (
                location.id !== locationId
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function addFanService(topicId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        const fanServices = normalizeFanServices(topic.fanServices || topic.services, isFanServicesTopic(topic));

        return {
          ...topic,
          fanServices: [
            ...fanServices,
            createDefaultFanService(fanServices.length),
          ],
        };
      }),
    }));
    markDirty();
  }

  function updateFanServiceField(topicId, serviceId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              fanServices: normalizeFanServices(topic.fanServices || topic.services, isFanServicesTopic(topic)).map((service) => (
                service.id === serviceId ? { ...service, [field]: value } : service
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function deleteFanService(topicId, serviceId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              fanServices: normalizeFanServices(topic.fanServices || topic.services, isFanServicesTopic(topic)).filter((service) => (
                service.id !== serviceId
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function updateCourseHoleField(topicId, holeNumber, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              courseHoles: normalizeCourseHoles(topic.courseHoles || topic.holes, true).map((hole) => (
                hole.holeNumber === holeNumber ? { ...hole, [field]: value } : hole
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function addScheduleDay(topicId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        const scheduleDays = normalizeScheduleDays(topic.scheduleDays || topic.schedule || topic.days);

        return {
          ...topic,
          scheduleDays: [
            ...scheduleDays,
            createDefaultScheduleDay(scheduleDays.length),
          ],
        };
      }),
    }));
    markDirty();
  }

  function loadSampleSchedule(topicId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? { ...topic, scheduleDays: createRbcCanadianOpenSampleScheduleDays() }
          : topic
      )),
    }));
    markDirty();
  }

  function updateScheduleDayField(topicId, dayId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              scheduleDays: normalizeScheduleDays(topic.scheduleDays || topic.schedule || topic.days).map((day) => (
                day.id === dayId ? { ...day, [field]: value } : day
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function deleteScheduleDay(topicId, dayId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => (
        topic.id === topicId
          ? {
              ...topic,
              scheduleDays: normalizeScheduleDays(topic.scheduleDays || topic.schedule || topic.days).filter((day) => (
                day.id !== dayId
              )),
            }
          : topic
      )),
    }));
    markDirty();
  }

  function addScheduleEvent(topicId, dayId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          scheduleDays: normalizeScheduleDays(topic.scheduleDays || topic.schedule || topic.days).map((day, dayIndex) => {
            if (day.id !== dayId) {
              return day;
            }

            return {
              ...day,
              events: [
                ...day.events,
                createDefaultScheduleEvent(dayIndex, day.events.length),
              ],
            };
          }),
        };
      }),
    }));
    markDirty();
  }

  function updateScheduleEventField(topicId, dayId, eventId, field, value) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          scheduleDays: normalizeScheduleDays(topic.scheduleDays || topic.schedule || topic.days).map((day) => {
            if (day.id !== dayId) {
              return day;
            }

            return {
              ...day,
              events: day.events.map((scheduleEvent) => (
                scheduleEvent.id === eventId ? { ...scheduleEvent, [field]: value } : scheduleEvent
              )),
            };
          }),
        };
      }),
    }));
    markDirty();
  }

  function deleteScheduleEvent(topicId, dayId, eventId) {
    setEventDraft((current) => ({
      ...current,
      topics: current.topics.map((topic) => {
        if (topic.id !== topicId) {
          return topic;
        }

        return {
          ...topic,
          scheduleDays: normalizeScheduleDays(topic.scheduleDays || topic.schedule || topic.days).map((day) => (
            day.id === dayId
              ? { ...day, events: day.events.filter((scheduleEvent) => scheduleEvent.id !== eventId) }
              : day
          )),
        };
      }),
    }));
    markDirty();
  }

  function updateActiveStationScreenUi(updater) {
    setEventDraft((current) => {
      const stationId = activeScreenUiStationId;
      const currentScreenUi = getStationScreenUi(current, stationId);
      const nextScreenUi = normalizeScreenUi(updater(currentScreenUi, current));

      if (!stationId) {
        return {
          ...current,
          screenUi: nextScreenUi,
        };
      }

      return {
        ...current,
        screenUiByStationId: {
          ...normalizeScreenUiByStationId(
            current.screenUiByStationId,
            current.boothStationIds,
            current.screenUi
          ),
          [stationId]: nextScreenUi,
        },
      };
    });
    markDirty();
  }

  function updateScreenUiThemeField(field, value) {
    updateActiveStationScreenUi((screenUi) => ({
      ...screenUi,
      preset: 'custom',
      theme: {
        ...screenUi.theme,
        [field]: normalizeHexColor(value, screenUi.theme[field]),
      },
    }));
  }

  function updateScreenUiTopicColor(topicKey, value) {
    updateActiveStationScreenUi((screenUi) => ({
      ...screenUi,
      preset: 'custom',
      theme: {
        ...screenUi.theme,
        topicColors: {
          ...screenUi.theme.topicColors,
          [topicKey]: normalizeHexColor(value, screenUi.theme.topicColors[topicKey]),
        },
      },
    }));
  }

  function updateScreenUiFeature(featureKey, value) {
    updateActiveStationScreenUi((screenUi) => ({
      ...screenUi,
      features: {
        ...screenUi.features,
        [featureKey]: value === true,
      },
    }));
  }

  function updateScreenUiVisualMode(visualMode) {
    updateActiveStationScreenUi((screenUi) => ({
      ...screenUi,
      visualMode: normalizeScreenUiVisualMode(visualMode, screenUi.visualMode),
    }));
  }

  function updateScreenUiGolfQrMode(golfQrMode) {
    updateActiveStationScreenUi((screenUi) => ({
      ...screenUi,
      golfQrMode: normalizeScreenUiGolfQrMode(golfQrMode, screenUi.golfQrMode),
    }));
  }

  function applyScreenUiPreset(preset) {
    updateActiveStationScreenUi((screenUi, current) => {
      const topicRows = getScreenUiTopicRows(current.topics);
      const topicColors = topicRows.reduce((colors, topicRow) => ({
        ...colors,
        [topicRow.key]: normalizeHexColor(
          topicRow.colorIndex < 0
            ? preset.theme.topicColors?.[EVENT_INFO_TOPIC_KEY]
            : preset.theme.topicPalette?.[topicRow.colorIndex % (preset.theme.topicPalette?.length || 1)],
          getDefaultScreenUiTopicColor(topicRow.colorIndex)
        ),
      }), {});

      return normalizeScreenUi({
        ...screenUi,
        preset: preset.id,
        theme: {
          ...preset.theme,
          topicColors,
        },
      });
    });
  }

  function handleSaveScreenUiPalette() {
    const nextPalette = createCustomScreenUiPalette(
      activeScreenUi,
      eventDraft.topics,
      customScreenUiPalettes.length
    );

    if (!nextPalette) {
      setStatus({ state: 'error', message: 'Unable to save this screen palette.' });
      return;
    }

    setCustomScreenUiPalettes((current) => [
      nextPalette,
      ...current.filter((palette) => palette.id !== nextPalette.id),
    ].slice(0, 12));
    updateActiveStationScreenUi((screenUi) => ({
      ...screenUi,
      preset: nextPalette.id,
    }));
    setStatus({ state: 'success', message: `${nextPalette.label} saved as a reusable screen palette.` });
  }

  function postScreenUiToPreview(extraPayload = {}) {
    const frameWindow = boothPreviewFrameRef.current?.contentWindow;
    if (!frameWindow) {
      return;
    }

    frameWindow.postMessage({
      command: 'screen_ui',
      screenUi: activeScreenUi,
      topics: eventDraft.topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
      })),
      eventName: eventDraft.general?.eventName || '',
      stationId: activeScreenUiStationId,
      ...extraPayload,
    }, screenUiPreviewOrigin);
  }

  function handlePreviewLoaded() {
    postScreenUiToPreview();
  }

  function handleSendPreviewQr() {
    postScreenUiToPreview({
      payload: {
        command: 'show_qr',
        url: 'https://charge.rent',
        label: 'Demo QR',
        preheatMs: 200,
      },
    });

    const frameWindow = boothPreviewFrameRef.current?.contentWindow;
    if (frameWindow) {
      frameWindow.postMessage({
        command: 'show_qr',
        url: 'https://charge.rent',
        label: 'Demo QR',
        preheatMs: 200,
      }, screenUiPreviewOrigin);
    }
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
    const nextTopic = createPresetTopicDraft(preset, eventDraft.topics.length);

    if (nextTopic.kind !== PHONE_CHARGING_TOPIC_KIND) {
      addTopic(nextTopic);
      return;
    }

    const existingPhoneChargingTopic = eventDraft.topics.find(isPhoneChargingTopic);
    const nextActiveTabId = existingPhoneChargingTopic?.id || nextTopic.id;
    setEventDraft((current) => {
      const existingTopic = current.topics.find(isPhoneChargingTopic);

      if (existingTopic) {
        return {
          ...current,
          general: {
            ...current.general,
            phoneChargingEnabled: true,
          },
        };
      }

      return {
        ...current,
        general: {
          ...current.general,
          phoneChargingEnabled: true,
          paymentType: normalizePaymentTypeValue(current.general.paymentType),
        },
        topics: [...current.topics, nextTopic],
      };
    });
    setActiveTabId(nextActiveTabId);
    markDirty();
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

    setEventDraft((current) => {
      const removedTopic = current.topics.find((topic) => topic.id === topicId);

      return {
        ...current,
        general: isPhoneChargingTopic(removedTopic)
          ? {
              ...current.general,
              phoneChargingEnabled: false,
            }
          : current.general,
        topics: current.topics.filter((topic) => topic.id !== topicId),
      };
    });
    setActiveTabId('general');
    markDirty();
  }

  function toggleBoothAssignment(stationId) {
    setEventDraft((current) => {
      const selectedIds = new Set(current.boothStationIds);
      const nextBoothContexts = { ...(current.boothContexts || {}) };
      const nextKioskAgents = { ...(current.agent?.kioskAgents || {}) };
      const nextScreenUiByStationId = {
        ...normalizeScreenUiByStationId(
          current.screenUiByStationId,
          current.boothStationIds,
          current.screenUi
        ),
      };
      if (selectedIds.has(stationId)) {
        selectedIds.delete(stationId);
        delete nextBoothContexts[stationId];
        delete nextKioskAgents[stationId];
        delete nextScreenUiByStationId[stationId];
      } else {
        selectedIds.add(stationId);
        nextBoothContexts[stationId] = nextBoothContexts[stationId] || createBoothContextForEvent(
          current,
          current.boothStationIds.length
        );
        nextScreenUiByStationId[stationId] = nextScreenUiByStationId[stationId] || normalizeScreenUi(current.screenUi);
      }

      return {
        ...current,
        agent: {
          ...current.agent,
          kioskAgents: nextKioskAgents,
        },
        boothStationIds: [...selectedIds].sort(),
        boothContexts: nextBoothContexts,
        screenUiByStationId: nextScreenUiByStationId,
      };
    });
    markDirty();
  }

  async function saveEventDraft({ sendingMessage = 'Saving AI booth event...', successMessage = 'AI booth event saved.' } = {}) {
    const trimmedEventName = String(eventDraft.general.eventName || '').trim();

    if (!trimmedEventName) {
      setActiveWorkspaceTab('event');
      setActiveTabId('general');
      setStatus({ state: 'error', message: 'Event name is required before saving.' });
      return null;
    }

    setStatus({ state: 'sending', message: sendingMessage });

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
      if (successMessage) {
        setStatus({ state: 'success', message: successMessage });
      }
      return savedEvent;
    } catch (error) {
      console.error(error);
      if (isFunctionEndpointUnavailable(error)) {
        setStatus({
          state: 'error',
          message: 'AI booth save endpoint is unavailable. Deploy the AI booth functions, then try saving again.',
        });
        return null;
      }

      setStatus({ state: 'error', message: error?.message || 'Failed to save AI booth event.' });
      return null;
    }
  }

  async function handleSaveEvent() {
    await saveEventDraft();
  }

  async function handlePublishAgent() {
    const templateAgentId = String(eventDraft.agent?.templateAgentId || '').trim();

    if (eventDraft.boothStationIds.length === 0) {
      setStatus({ state: 'error', message: 'Assign at least one CA36 booth before creating kiosk agents.' });
      return;
    }

    if (!templateAgentId) {
      setStatus({ state: 'error', message: 'Template agent ID is required before creating kiosk agents.' });
      return;
    }

    let eventForPublish = eventDraft;
    let eventId = selectedEventId || eventDraft.id;

    if (!eventId || dirty) {
      const savedEvent = await saveEventDraft({
        sendingMessage: 'Saving event before syncing kiosk agents...',
        successMessage: '',
      });

      if (!savedEvent) {
        return;
      }

      eventForPublish = savedEvent;
      eventId = savedEvent.id;
    }

    if (!eventId) {
      setStatus({ state: 'error', message: 'Unable to create kiosk agents because the event was not saved.' });
      return;
    }

    setStatus({
      state: 'sending',
      message: `Building knowledge base and syncing ${eventForPublish.boothStationIds.length} kiosk agents...`,
    });

    try {
      const response = await callFunctionWithAuth('aiBooths_publishAgent', { eventId });
      const savedEvent = normalizeEvent(response?.event || {});
      const syncedCount = Number(response?.syncedCount || 0);
      const failedCount = Number(response?.failedCount || 0);
      const firstAgentError = (Array.isArray(response?.results) ? response.results : [])
        .map((result) => String(result?.error || '').trim())
        .find(Boolean);

      setEvents((current) => sortEvents([savedEvent, ...current.filter((item) => item.id !== savedEvent.id)]));
      setSelectedEventId(savedEvent.id);
      setEventDraft(cloneEvent(savedEvent));
      setDirty(false);

      if (failedCount > 0) {
        setStatus({
          state: syncedCount > 0 ? 'pending' : 'error',
          message: firstAgentError
            ? `Knowledge base created. Kiosk agents synced: ${syncedCount}, failed: ${failedCount}. ${firstAgentError}`
            : `Knowledge base created. Kiosk agents synced: ${syncedCount}, failed: ${failedCount}.`,
        });
        return;
      }

      setStatus({ state: 'success', message: `Knowledge base created. Kiosk agents synced: ${syncedCount}.` });
    } catch (error) {
      console.error(error);
      setStatus({ state: 'error', message: error?.message || 'Failed to create kiosk agents.' });
    }
  }

  const screenUiPreviewScale = screenUiPreviewExpanded ? SCREEN_UI_PREVIEW_EXPANDED_SCALE : SCREEN_UI_PREVIEW_SCALE;
  const screenUiPreviewDisplayWidth = SCREEN_UI_PREVIEW_WIDTH * screenUiPreviewScale;
  const screenUiPreviewDisplayHeight = SCREEN_UI_PREVIEW_HEIGHT * screenUiPreviewScale;

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
            { id: 'screen', label: 'Booth UI' },
            { id: 'map', label: 'Map' },
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
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end">
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
                onClick={handleFillMockGolfData}
                className="rounded-md bg-emerald-100 px-5 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-200"
              >
                Fill Mock Golf Data
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
                <p className="mt-1 text-xs text-gray-500">{eventDraft.topics.length} custom topic tabs</p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex flex-col gap-6">
            <div className="order-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md">
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
                    Venue Info
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
                    className="inline-flex h-11 select-none items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
                    title="Add topic. Long press for presets."
                  >
                    <span className="text-xl font-light leading-none">+</span>
                    <span>ADD TOPIC</span>
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
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Venue Info</p>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="grid gap-5 md:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,260px)]">
                        <GeneralField
                          label="Event Name"
                          value={eventDraft.general.eventName}
                          onChange={(event) => updateGeneralField('eventName', event.target.value)}
                          placeholder="CES 2027"
                        />
                        <CountrySwitch
                          value={eventDraft.general.country}
                          onChange={(value) => updateGeneralField('country', value)}
                        />
                      </div>
                      <CategoryField
                        category={eventDraft.general.eventCategory}
                        onCategoryChange={handleCategoryChange}
                        className="md:col-span-2"
                      />
                      <GeneralField
                        label="General Event Info"
                        type="textarea"
                        value={eventDraft.general.eventInfo}
                        onChange={(event) => updateGeneralField('eventInfo', event.target.value)}
                        placeholder="Basic guest-facing event details, highlights, policies, access notes, or important context."
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
                      <div className="grid gap-5 md:col-span-2 md:grid-cols-2">
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
                      </div>
                    </div>
                  </div>
                ) : activeTopic && isPhoneChargingTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Phone charging details</h2>
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
                        placeholder="Phone Chargers"
                        className="md:col-span-2"
                      />
                      <EventInfoToggle
                        label="Phone Charging"
                        description={eventDraft.general.phoneChargingEnabled ? 'Guests can rent chargers from assigned booths.' : 'Charger rental flow is turned off for this event.'}
                        checked={eventDraft.general.phoneChargingEnabled}
                        onChange={(checked) => updateGeneralField('phoneChargingEnabled', checked)}
                        className="md:col-span-2"
                      />
                      <PaymentTypeSwitch
                        value={eventDraft.general.paymentType}
                        onChange={(value) => updateGeneralField('paymentType', value)}
                        disabled={!eventDraft.general.phoneChargingEnabled}
                        className="md:col-span-2"
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
                  </div>
                ) : activeTopic && isWifiTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Wi-Fi details</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Add the guest network credentials and connection instructions for the booth agent.
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
                        placeholder="Wi-Fi"
                      />
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm font-semibold text-slate-700">Circle preview</p>
                        <div className="mt-4 flex items-center gap-4">
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-100 text-center text-xs font-bold text-cyan-800 shadow-sm">
                            {shortenLabel(activeTopic.title, 10) || 'Wi-Fi'}
                          </div>
                          <p className="text-sm text-slate-600">
                            This label is what appears on the booth screen topic node.
                          </p>
                        </div>
                      </div>
                      <GeneralField
                        label="SSID"
                        value={activeTopic.wifiSsid}
                        onChange={(event) => updateTopicField(activeTopic.id, 'wifiSsid', event.target.value)}
                        placeholder="Guest Wi-Fi network"
                      />
                      <GeneralField
                        label="Password"
                        value={activeTopic.wifiPassword}
                        onChange={(event) => updateTopicField(activeTopic.id, 'wifiPassword', event.target.value)}
                        placeholder="Network password"
                      />
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">Security</span>
                          <select
                            value={activeTopic.wifiSecurity || 'WPA'}
                            onChange={(event) => updateTopicField(activeTopic.id, 'wifiSecurity', event.target.value)}
                            className={FIELD_CLASSES}
                          >
                            {WIFI_SECURITY_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option === 'nopass' ? 'Open' : option}
                              </option>
                            ))}
                          </select>
                        </label>
                        <EventInfoToggle
                          label="Hidden network"
                          description="Include hidden-network mode in the generated Wi-Fi QR code."
                          checked={activeTopic.wifiHidden === true}
                          onChange={(checked) => updateTopicField(activeTopic.id, 'wifiHidden', checked)}
                        />
                      </div>
                    </div>

                    <GeneralField
                      label="Instructions"
                      type="textarea"
                      value={activeTopic.summary}
                      onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                      placeholder="Connection steps, QR flow, coverage areas, or fallback support instructions."
                    />
                  </div>
                ) : activeTopic && isTransportationTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Transportation details</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Add guest-facing shuttle, ride share, and parking guidance for this event.
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
                        placeholder="Transportation"
                      />
                      <GeneralField
                        label="Summary"
                        value={activeTopic.summary}
                        onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                        placeholder="Quick transportation overview."
                      />
                    </div>

                    <TransportationSectionEditor
                      title="Shuttle"
                      description="Service windows, pickup areas, route notes, and shuttle instructions."
                      details={activeTopic.transportation?.shuttle}
                      locationLabel="Pickup Location"
                      detailsLabel="Shuttle Details"
                      useTimeRange
                      onAddLocation={() => addTransportationLocation(activeTopic.id, 'shuttle')}
                      onLocationFieldChange={(locationId, field, value) => updateTransportationLocationField(
                        activeTopic.id,
                        'shuttle',
                        locationId,
                        field,
                        value,
                      )}
                      onDeleteLocation={(locationId) => deleteTransportationLocation(
                        activeTopic.id,
                        'shuttle',
                        locationId,
                      )}
                    />
                    <TransportationSectionEditor
                      title="Ride Share"
                      description="Designated ride share pickup and drop-off guidance."
                      details={activeTopic.transportation?.rideShare}
                      locationLabel="Ride Share Location"
                      detailsLabel="Ride Share Details"
                      onAddLocation={() => addTransportationLocation(activeTopic.id, 'rideShare')}
                      onLocationFieldChange={(locationId, field, value) => updateTransportationLocationField(
                        activeTopic.id,
                        'rideShare',
                        locationId,
                        field,
                        value,
                      )}
                      onDeleteLocation={(locationId) => deleteTransportationLocation(
                        activeTopic.id,
                        'rideShare',
                        locationId,
                      )}
                    />
                    <TransportationSectionEditor
                      title="Parking"
                      description="Parking lots, permit notes, accessible parking, and exit guidance."
                      details={activeTopic.transportation?.parking}
                      locationLabel="Parking Location"
                      detailsLabel="Parking Details"
                      onAddLocation={() => addTransportationLocation(activeTopic.id, 'parking')}
                      onLocationFieldChange={(locationId, field, value) => updateTransportationLocationField(
                        activeTopic.id,
                        'parking',
                        locationId,
                        field,
                        value,
                      )}
                      onDeleteLocation={(locationId) => deleteTransportationLocation(
                        activeTopic.id,
                        'parking',
                        locationId,
                      )}
                    />
                  </div>
                ) : activeTopic && isConcessionsTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Concessions and fan zones</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Add concession notes, fan zones, coordinates, open hours, and activations.
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
                        placeholder="Concessions"
                      />
                      <GeneralField
                        label="Summary"
                        value={activeTopic.summary}
                        onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                        placeholder="Quick concession overview."
                      />
                      <GeneralField
                        label="Concession Details"
                        type="textarea"
                        value={activeTopic.notes}
                        onChange={(event) => updateTopicField(activeTopic.id, 'notes', event.target.value)}
                        placeholder="Food and beverage options, payment notes, allergy guidance, or restrictions."
                        className="md:col-span-2"
                      />
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div>
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">Fan Zones</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            Each fan zone can include coordinates, open hours, and its own activations.
                          </p>
                        </div>
                      </div>

                      {normalizeFanZones(activeTopic.fanZones).length === 0 ? (
                        <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-slate-600">
                          No fan zones have been added yet.
                        </div>
                      ) : (
                        <div className="mt-5 space-y-5">
                          {normalizeFanZones(activeTopic.fanZones).map((zone) => (
                            <FanZoneEditor
                              key={zone.id}
                              zone={zone}
                              onFieldChange={(field, value) => (
                                updateFanZoneField(activeTopic.id, zone.id, field, value)
                              )}
                              onDelete={() => deleteFanZone(activeTopic.id, zone.id)}
                              onAddActivation={() => addFanZoneActivation(activeTopic.id, zone.id)}
                              onActivationFieldChange={(activationId, field, value) => (
                                updateFanZoneActivationField(activeTopic.id, zone.id, activationId, field, value)
                              )}
                              onDeleteActivation={(activationId) => (
                                deleteFanZoneActivation(activeTopic.id, zone.id, activationId)
                              )}
                            />
                          ))}
                        </div>
                      )}
                      <AddPanelButton label="Add Fan Zone" onClick={() => addFanZone(activeTopic.id)} className="mt-5" />
                    </div>
                  </div>
                ) : activeTopic && isHospitalityTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Hospitality locations</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Add private hospitality, shared lounges, premium experiences, coordinates, and assigned client details.
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
                        placeholder="Hospitality"
                      />
                      <GeneralField
                        label="Summary"
                        value={activeTopic.summary}
                        onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                        placeholder="Suites, lounges, sponsor areas, and premium guest wayfinding."
                      />
                      <GeneralField
                        label="Hospitality Notes"
                        type="textarea"
                        value={activeTopic.notes}
                        onChange={(event) => updateTopicField(activeTopic.id, 'notes', event.target.value)}
                        placeholder="General hospitality policies, credentials, contact numbers, or final review notes."
                        className="md:col-span-2"
                      />
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">Locations</h3>
                          <p className="mt-1 text-sm text-slate-600">
                          Each hospitality location can have coordinates, venue type, guest details, and assigned clients.
                          </p>
                      </div>

                      {normalizeHospitalityLocations(activeTopic.hospitalityLocations || activeTopic.hospitality || activeTopic.venues).length === 0 ? (
                        <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-slate-600">
                          No hospitality locations have been added yet.
                        </div>
                      ) : (
                        <div className="mt-5 space-y-5">
                          {normalizeHospitalityLocations(activeTopic.hospitalityLocations || activeTopic.hospitality || activeTopic.venues).map((location) => (
                            <HospitalityLocationEditor
                              key={location.id}
                              location={location}
                              onFieldChange={(field, value) => (
                                updateHospitalityLocationField(activeTopic.id, location.id, field, value)
                              )}
                              onVenueTypeChange={(venueType) => (
                                applyHospitalityLocationVenueType(activeTopic.id, location.id, venueType)
                              )}
                              onDelete={() => deleteHospitalityLocation(activeTopic.id, location.id)}
                              onAddClient={() => addHospitalityClient(activeTopic.id, location.id)}
                              onClientFieldChange={(clientId, field, value) => (
                                updateHospitalityClientField(activeTopic.id, location.id, clientId, field, value)
                              )}
                              onDeleteClient={(clientId) => (
                                deleteHospitalityClient(activeTopic.id, location.id, clientId)
                              )}
                            />
                          ))}
                        </div>
                      )}
                      <AddPanelButton label="Add Hospitality Location" onClick={() => addHospitalityLocation(activeTopic.id)} className="mt-5" />
                    </div>
                  </div>
                ) : activeTopic && isBathroomsTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Bathroom locations</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Add restroom places and coordinates so the booth can give precise directions.
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
                        placeholder="Bathrooms"
                      />
                      <GeneralField
                        label="Summary"
                        value={activeTopic.summary}
                        onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                        placeholder="Quick bathroom and restroom overview."
                      />
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div>
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">Locations</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            Each location needs a place label and coordinates.
                          </p>
                        </div>
                      </div>

                      {normalizeBathroomLocations(activeTopic.bathroomLocations || activeTopic.locations).length === 0 ? (
                        <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-slate-600">
                          No bathroom locations have been added yet.
                        </div>
                      ) : (
                        <div className="mt-5 space-y-4">
                          {normalizeBathroomLocations(activeTopic.bathroomLocations || activeTopic.locations).map((location) => (
                            <BathroomLocationEditor
                              key={location.id}
                              location={location}
                              onFieldChange={(field, value) => (
                                updateBathroomLocationField(activeTopic.id, location.id, field, value)
                              )}
                              onDelete={() => deleteBathroomLocation(activeTopic.id, location.id)}
                            />
                          ))}
                        </div>
                      )}
                      <AddPanelButton label="Add Location" onClick={() => addBathroomLocation(activeTopic.id)} className="mt-5" />
                    </div>
                  </div>
                ) : activeTopic && isFanServicesTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Fan services</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Manage guest support services, their locations, and coordinates.
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
                        placeholder="Fan Services"
                      />
                      <GeneralField
                        label="Summary"
                        value={activeTopic.summary}
                        onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                        placeholder="Quick fan services overview."
                      />
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div>
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">Services</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            First aid, lost and found, and accessibility help are added by default.
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 space-y-4">
                        {normalizeFanServices(activeTopic.fanServices || activeTopic.services, true).map((service) => (
                          <FanServiceEditor
                            key={service.id}
                            service={service}
                            onFieldChange={(field, value) => (
                              updateFanServiceField(activeTopic.id, service.id, field, value)
                            )}
                            onDelete={() => deleteFanService(activeTopic.id, service.id)}
                          />
                        ))}
                      </div>
                      <AddPanelButton label="Add Service" onClick={() => addFanService(activeTopic.id)} className="mt-5" />
                    </div>
                  </div>
                ) : activeTopic && isScheduleTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Tournament schedule</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Build tournament days, gate windows, rounds, pro-ams, and ceremonies. Fan zone, concession, and activation hours belong in their own sections.
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
                        placeholder="Schedule"
                      />
                      <GeneralField
                        label="Summary"
                        value={activeTopic.summary}
                        onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                        placeholder="Tournament week, public days, gates, rounds, and programming overview."
                      />
                      <GeneralField
                        label="Schedule Notes"
                        type="textarea"
                        value={activeTopic.notes}
                        onChange={(event) => updateTopicField(activeTopic.id, 'notes', event.target.value)}
                        placeholder="General schedule caveats, weather notes, source URLs, or update instructions."
                        className="md:col-span-2"
                      />
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">Schedule Days</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            Each day can include public status, theme, gate hours, and unlimited schedule items.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => loadSampleSchedule(activeTopic.id)}
                          className="rounded-md border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 shadow-sm transition hover:bg-cyan-50"
                        >
                          Load Sample
                        </button>
                      </div>

                      {normalizeScheduleDays(activeTopic.scheduleDays || activeTopic.schedule || activeTopic.days).length === 0 ? (
                        <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-slate-600">
                          No schedule days have been added yet.
                        </div>
                      ) : (
                        <div className="mt-5 space-y-5">
                          {normalizeScheduleDays(activeTopic.scheduleDays || activeTopic.schedule || activeTopic.days).map((day) => (
                            <ScheduleDayEditor
                              key={day.id}
                              day={day}
                              onFieldChange={(field, value) => (
                                updateScheduleDayField(activeTopic.id, day.id, field, value)
                              )}
                              onDelete={() => deleteScheduleDay(activeTopic.id, day.id)}
                              onAddEvent={() => addScheduleEvent(activeTopic.id, day.id)}
                              onEventFieldChange={(eventId, field, value) => (
                                updateScheduleEventField(activeTopic.id, day.id, eventId, field, value)
                              )}
                              onDeleteEvent={(eventId) => deleteScheduleEvent(activeTopic.id, day.id, eventId)}
                            />
                          ))}
                        </div>
                      )}
                      <AddPanelButton label="Add Day" onClick={() => addScheduleDay(activeTopic.id)} className="mt-5" />
                    </div>
                  </div>
                ) : activeTopic && isCourseTopic(activeTopic) ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Tab</p>
                        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Course map</h2>
                        <p className="mt-2 text-sm text-slate-600">
                          Add tee and green coordinates for all 18 holes.
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
                        placeholder="Course"
                      />
                      <GeneralField
                        label="Summary"
                        value={activeTopic.summary}
                        onChange={(event) => updateTopicField(activeTopic.id, 'summary', event.target.value)}
                        placeholder="Quick course overview."
                      />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      {normalizeCourseHoles(activeTopic.courseHoles || activeTopic.holes, true).map((hole) => (
                        <CourseHoleEditor
                          key={hole.id}
                          hole={hole}
                          onFieldChange={(field, value) => (
                            updateCourseHoleField(activeTopic.id, hole.holeNumber, field, value)
                          )}
                        />
                      ))}
                    </div>
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
                            This label is what appears on the booth screen topic node.
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

            <div className="order-1 rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Booth Assignment</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Assign booths to this event</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Available AI booths.
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
                  {allAiBooths.length === 0 ? (
                    <>
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
                    </>
                  ) : (
                    <p>All available AI booths are already assigned to this event.</p>
                  )}
                </div>
              ) : (
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {availableBooths.map((booth) => {
                    const isSelected = selectedBoothSet.has(booth.stationid);
                    const boothHealth = getAiBoothRuntimeHealth(booth, healthNowMs);

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
                            <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${getAiBoothHealthBadgeClasses(boothHealth.tone)}`}>
                              {boothHealth.label}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm text-slate-700">{getBoothLocationLabel(booth)}</p>
                          {getBoothSecondaryLabel(booth) && (
                            <p className="mt-1 text-xs text-slate-500">{getBoothSecondaryLabel(booth)}</p>
                          )}
                          <p className="mt-2 text-xs font-medium text-slate-500">{boothHealth.detail}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 border-t border-gray-200 pt-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Assigned Booths</p>
                    <h3 className="mt-2 text-xl font-semibold text-slate-900">Current assigned booths</h3>
                  </div>
                  <div className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600">
                    {assignedBooths.length} assigned
                  </div>
                </div>

                {assignedBooths.length === 0 ? (
                  <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 px-5 py-6 text-sm text-gray-600">
                    No booths assigned yet.
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {assignedBooths.map((booth) => {
                      const kioskAgent = eventDraft.agent?.kioskAgents?.[booth.stationid] || null;
                      const boothContext = eventDraft.boothContexts?.[booth.stationid] || createDefaultBoothContext();
                      const boothHealth = getAiBoothRuntimeHealth(booth, healthNowMs);

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
                            <div className="flex shrink-0 flex-col items-end gap-2">
                              <span className={`rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${
                                kioskAgent?.syncStatus === 'synced'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : kioskAgent?.syncStatus === 'error'
                                    ? 'bg-rose-50 text-rose-700'
                                    : 'bg-white text-slate-600'
                              }`}
                              >
                                {kioskAgent?.syncStatus === 'synced'
                                  ? 'Agent synced'
                                  : kioskAgent?.syncStatus === 'error'
                                    ? 'Agent error'
                                    : (getBoothType(booth) || 'Stored')}
                              </span>
                              <span className={`rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${getAiBoothHealthBadgeClasses(boothHealth.tone)}`}>
                                {boothHealth.label}
                              </span>
                            </div>
                          </div>
                          {kioskAgent?.syncStatus === 'error' && kioskAgent?.syncError && (
                            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                              {kioskAgent.syncError}
                            </p>
                          )}
                          <p className={`mt-3 rounded-md px-3 py-2 text-xs font-semibold ${
                            boothHealth.tone === 'emerald'
                              ? 'bg-emerald-50 text-emerald-700'
                              : boothHealth.tone === 'rose'
                                ? 'bg-rose-50 text-rose-700'
                                : boothHealth.tone === 'amber'
                                  ? 'bg-amber-50 text-amber-700'
                                  : boothHealth.tone === 'cyan'
                                    ? 'bg-cyan-50 text-cyan-700'
                                    : 'bg-white text-slate-600'
                          }`}
                          >
                            {boothHealth.detail}
                          </p>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <GeneralField
                              label="Place at event"
                              value={boothContext.place}
                              onChange={(event) => updateBoothContextField(booth.stationid, 'place', event.target.value)}
                              placeholder="Main gate / Fan services"
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <GeneralField
                                label="Latitude"
                                type="number"
                                value={boothContext.latitude}
                                onChange={(event) => updateBoothContextField(booth.stationid, 'latitude', event.target.value)}
                                placeholder="34.1526589"
                              />
                              <GeneralField
                                label="Longitude"
                                type="number"
                                value={boothContext.longitude}
                                onChange={(event) => updateBoothContextField(booth.stationid, 'longitude', event.target.value)}
                                placeholder="-118.5588832"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
        </>
        ) : activeWorkspaceTab === 'screen' ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.55fr)] md:items-end">
                  <label className="block min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Saved Events</span>
                    <select
                      value={selectedEventId}
                      onChange={handleSelectEvent}
                      className="mt-2 w-full min-w-0 truncate rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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

                  <label className="block min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Screen Kiosk</span>
                    <select
                      value={activeScreenUiStationId}
                      onChange={(event) => setSelectedScreenUiStationId(event.target.value)}
                      disabled={assignedBooths.length === 0}
                      className="mt-2 w-full min-w-0 truncate rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      {assignedBooths.length === 0 ? (
                        <option value="">Assign a kiosk first</option>
                      ) : (
                        assignedBooths.map((booth) => (
                          <option key={booth.stationid} value={booth.stationid}>
                            {booth.stationid}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
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
                    Save Screen UI
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Visualization</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Knowledge base view</h2>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {SCREEN_UI_VISUAL_MODES.map((mode) => {
                  const isSelected = activeScreenUi.visualMode === mode.id;
                  const isGolfMode = mode.id === 'golf-scorecard';

                  if (!isGolfMode) {
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => updateScreenUiVisualMode(mode.id)}
                        aria-pressed={isSelected}
                        className={`rounded-md border px-4 py-4 text-left shadow-sm transition ${
                          isSelected
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-gray-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/40'
                        }`}
                      >
                        <span className="text-sm font-semibold">{mode.label}</span>
                        <span className="mt-2 block text-xs leading-5 text-slate-600">{mode.description}</span>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={mode.id}
                      className={`rounded-md border px-4 py-4 text-left shadow-sm transition ${
                        isSelected
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                          : 'border-gray-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => updateScreenUiVisualMode(mode.id)}
                        aria-pressed={isSelected}
                        className="block w-full text-left"
                      >
                        <span className="text-sm font-semibold">{mode.label}</span>
                        <span className="mt-2 block text-xs leading-5 text-slate-600">{mode.description}</span>
                      </button>

                      {isSelected && (
                        <div className="mt-4 border-t border-emerald-200/80 pt-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                            QR Animation
                          </p>
                          <div className="mt-3 grid gap-2">
                            {SCREEN_UI_GOLF_QR_MODES.map((qrMode) => {
                              const isQrSelected = activeScreenUi.golfQrMode === qrMode.id;

                              return (
                                <button
                                  key={qrMode.id}
                                  type="button"
                                  onClick={() => updateScreenUiGolfQrMode(qrMode.id)}
                                  aria-pressed={isQrSelected}
                                  className={`rounded-md border px-3 py-2 text-left text-xs font-semibold shadow-sm transition ${
                                    isQrSelected
                                      ? 'border-emerald-400 bg-white text-emerald-950'
                                      : 'border-emerald-100 bg-white/70 text-emerald-800 hover:border-emerald-300'
                                  }`}
                                  title={qrMode.description}
                                >
                                  {qrMode.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Color Template</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">Booth screen palette</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveScreenUiPalette}
                    className="rounded-md border border-cyan-200 bg-white px-3 py-2 text-xs font-semibold text-cyan-800 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50"
                  >
                    Save New Palette
                  </button>
                  <div className="rounded-md bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                    {dirty ? 'Unsaved changes' : 'Saved draft'}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {screenUiPaletteOptions.map((preset) => {
                  const isSelected = activeScreenUi.preset === preset.id;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyScreenUiPreset(preset)}
                      className={`rounded-md border px-3 py-3 text-left shadow-sm transition ${
                        isSelected
                          ? 'border-cyan-300 bg-cyan-50 text-cyan-900'
                          : 'border-gray-200 bg-white text-slate-700 hover:border-cyan-200'
                      }`}
                    >
                      <span className="flex gap-1">
                        {[preset.theme.background, preset.theme.primary, preset.theme.accent].map((color) => (
                          <span
                            key={color}
                            className="h-5 w-5 rounded-full border border-white shadow ring-1 ring-slate-200"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                      <span className="mt-3 flex items-center justify-between gap-2 text-sm font-semibold">
                        <span>{preset.label}</span>
                        {preset.custom && (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                            Saved
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <ScreenUiColorField
                  label="Background"
                  value={activeScreenUi.theme.background}
                  onChange={(value) => updateScreenUiThemeField('background', value)}
                />
                <ScreenUiColorField
                  label="Background Alt"
                  value={activeScreenUi.theme.backgroundAlt}
                  onChange={(value) => updateScreenUiThemeField('backgroundAlt', value)}
                />
                <ScreenUiColorField
                  label="Primary"
                  value={activeScreenUi.theme.primary}
                  onChange={(value) => updateScreenUiThemeField('primary', value)}
                />
                <ScreenUiColorField
                  label="Accent / QR"
                  value={activeScreenUi.theme.accent}
                  onChange={(value) => updateScreenUiThemeField('accent', value)}
                />
                <ScreenUiColorField
                  label="Glow"
                  value={activeScreenUi.theme.glow}
                  onChange={(value) => updateScreenUiThemeField('glow', value)}
                />
                <ScreenUiColorField
                  label="Secondary Glow"
                  value={activeScreenUi.theme.secondaryGlow}
                  onChange={(value) => updateScreenUiThemeField('secondaryGlow', value)}
                />
                <ScreenUiColorField
                  label="Agent Button"
                  value={activeScreenUi.theme.agentButton}
                  onChange={(value) => updateScreenUiThemeField('agentButton', value)}
                />
                <ScreenUiColorField
                  label="Agent Listening"
                  value={activeScreenUi.theme.agentListening}
                  onChange={(value) => updateScreenUiThemeField('agentListening', value)}
                />
                <ScreenUiColorField
                  label="Agent Speaking"
                  value={activeScreenUi.theme.agentSpeaking}
                  onChange={(value) => updateScreenUiThemeField('agentSpeaking', value)}
                />
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Topic Nodes</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {screenUiTopicRows.map((topic) => (
                  <ScreenUiColorField
                    key={topic.key}
                    label={topic.label}
                    value={getScreenUiTopicColor(activeScreenUi, topic)}
                    onChange={(value) => updateScreenUiTopicColor(topic.key, value)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Live Preview</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">AI booth screen</h2>
                  <p className="mt-2 max-w-xl break-words text-sm leading-5 text-slate-600">
                    {selectedEventId || eventDraft.id ? getEventLabel(eventDraft) : 'Save the event to publish this screen UI to Firebase.'}
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Portrait preview {SCREEN_UI_PREVIEW_WIDTH} x {SCREEN_UI_PREVIEW_HEIGHT}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setScreenUiPreviewExpanded((current) => !current)}
                    aria-pressed={screenUiPreviewExpanded}
                    className="rounded-md bg-cyan-100 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-200"
                  >
                    {screenUiPreviewExpanded ? 'Exit Full Page' : 'Full Page'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSendPreviewQr}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    Test QR
                  </button>
                </div>
              </div>

              <div
                className={
                  screenUiPreviewExpanded
                    ? 'fixed inset-0 z-50 flex flex-col bg-slate-950 p-4'
                    : 'mt-5'
                }
              >
                {screenUiPreviewExpanded && (
                  <div className="mb-3 flex items-center justify-between gap-3 text-white">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Full Page Preview</p>
                      <p className="mt-1 text-sm font-semibold">{previewStationId || 'No booth selected'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScreenUiPreviewExpanded(false)}
                      className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-50"
                    >
                      Exit Full Page
                    </button>
                  </div>
                )}
                <div className={screenUiPreviewExpanded ? 'flex min-h-0 flex-1 items-center justify-center gap-4 overflow-hidden' : 'mt-5 grid items-start justify-center gap-4 sm:grid-cols-[auto_190px]'}>
                  <div
                    className="relative shrink-0 overflow-hidden bg-black"
                    style={{
                      height: `${screenUiPreviewDisplayHeight}px`,
                      width: `${screenUiPreviewDisplayWidth}px`,
                    }}
                  >
                    <iframe
                      ref={boothPreviewFrameRef}
                      src={screenUiPreviewUrl}
                      title="AI booth screen preview"
                      onLoad={handlePreviewLoaded}
                      allow="microphone; camera; autoplay; clipboard-write"
                      className="absolute left-0 top-0 block border-0 bg-black"
                      style={{
                        height: `${SCREEN_UI_PREVIEW_HEIGHT}px`,
                        transform: `scale(${screenUiPreviewScale})`,
                        transformOrigin: 'top left',
                        width: `${SCREEN_UI_PREVIEW_WIDTH}px`,
                      }}
                    />
                  </div>
                  <div className={screenUiPreviewExpanded ? 'w-48 space-y-3 text-white' : 'space-y-3 sm:w-48'}>
                    <div className={screenUiPreviewExpanded ? 'rounded-md bg-white/10 p-4' : 'rounded-md bg-gray-50 p-4'}>
                      <p className={screenUiPreviewExpanded ? 'text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200' : 'text-xs font-semibold uppercase tracking-[0.2em] text-gray-500'}>Preview Booth</p>
                      <p className={screenUiPreviewExpanded ? 'mt-2 text-sm font-semibold text-white' : 'mt-2 text-sm font-semibold text-gray-900'}>
                        {previewStationId || 'No booth selected'}
                      </p>
                    </div>
                    <div className={screenUiPreviewExpanded ? 'rounded-md bg-white/10 p-4' : 'rounded-md bg-gray-50 p-4'}>
                      <p className={screenUiPreviewExpanded ? 'text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200' : 'text-xs font-semibold uppercase tracking-[0.2em] text-gray-500'}>Viewport</p>
                      <p className={screenUiPreviewExpanded ? 'mt-2 text-sm font-semibold text-white' : 'mt-2 text-sm font-semibold text-gray-900'}>
                        {SCREEN_UI_PREVIEW_WIDTH} x {SCREEN_UI_PREVIEW_HEIGHT}
                      </p>
                    </div>
                    <div className={screenUiPreviewExpanded ? 'rounded-md bg-white/10 p-4' : 'rounded-md bg-gray-50 p-4'}>
                      <p className={screenUiPreviewExpanded ? 'text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200' : 'text-xs font-semibold uppercase tracking-[0.2em] text-gray-500'}>Kiosk Screen Doc</p>
                      <p className={screenUiPreviewExpanded ? 'mt-2 break-all font-mono text-xs font-semibold text-white' : 'mt-2 break-all font-mono text-xs font-semibold text-gray-900'}>
                        {previewStationId || 'Pending kiosk id'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-md sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Screen Features</p>
              <div className="mt-5 space-y-3">
                {SCREEN_UI_FEATURES.map((feature) => (
                  <ScreenUiToggle
                    key={feature.key}
                    label={feature.label}
                    description={feature.description}
                    checked={activeScreenUi.features[feature.key]}
                    onChange={(value) => updateScreenUiFeature(feature.key, value)}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
        ) : activeWorkspaceTab === 'map' ? (
        <TestCourseMap eventLabel={getEventLabel(eventDraft)} />
        ) : (
        <section className="space-y-6">
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
                  placeholder="Welcome to the event. How can I help you?"
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
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                <div className="rounded-md bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Knowledge</p>
                  <p className="mt-3 text-sm font-semibold capitalize text-gray-900">
                    {eventDraft.agent?.knowledgeBase?.syncStatus || 'Not synced'}
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-gray-500">
                    {eventDraft.agent?.knowledgeBase?.documentId || 'No document'}
                  </p>
                </div>
              </div>
            </div>
        </section>
        )}
      </main>
    </div>
  );
}
