/* eslint-env node */
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {rbcOpenApi} = require("./rbcOpenRouting/api");

admin.initializeApp();
const db = admin.firestore();
const ELEVENLABS_API_KEY = defineSecret("ELEVENLABS_API_KEY");
const EVENT_INTAKE_SECRET = defineSecret("EVENT_INTAKE_SECRET");
const SLASH_GOLF_RAPIDAPI_KEY = defineSecret("SLASH_GOLF_RAPIDAPI_KEY");
const STORAGE_BUCKET = "node-red-alerts.firebasestorage.app";
const STORAGE_BUCKET_CANDIDATES = Array.from(new Set([
  STORAGE_BUCKET,
  "chargerent-backup",
  "node-red-alerts.appspot.com",
]));

const AUTH_MAPPING_DOMAIN = "auth.charge.rent";
const STATION_SEQUENCE_START = 8000;
const AI_BOOTH_STATION_SEQUENCE_START = 9000;
const AI_BOOTH_KIOSK_TYPE = "CA36";
const DEFAULT_AI_BOOTH_INTAKE_MAX_FILES = 8;
const DEFAULT_AI_BOOTH_INTAKE_MAX_FILE_SIZE_MB = 20;
const AI_BOOTH_EVENTS_COLLECTION = "aiBoothEvents";
const AI_BOOTH_INSTALLS_COLLECTION = "aiBoothInstalls";
const EVENT_INTAKE_SUBMISSIONS_COLLECTION = "eventIntakeSubmissions";
const EVENT_INTAKE_STATUSES = new Set([
  "draft",
  "submitted",
  "under_review",
  "needs_changes",
  "approved",
  "rejected",
]);
const STATION_RESERVATIONS_COLLECTION = "stationIdReservations";
const DEFAULT_KIOSK_POWER_THRESHOLD = 80;
const MAX_MEDIA_UPLOAD_BYTES = 250 * 1024 * 1024;
const DEFAULT_MARKETING_OPTIONS = {
  active: true,
  title: {
    english: "Get the Rogers app",
    french: "Obtenez l'application Rogers",
    spanish: "Obtén la aplicación Rogers",
    german: "Holen Sie sich die Rogers App",
    italian: "Scarica l'app Rogers",
    portuguese: "Baixe o aplicativo Rogers",
  },
  offerText: {
    english: "Manage your account, pay your bill and get exclusive offers all in one place.",
    french: "Gérez votre compte, payez votre facture et profitez d'offres exclusives en un seul endroit.",
    spanish: "Administra tu cuenta, paga tu factura y obtén ofertas exclusivas en un solo lugar.",
    german: "Verwalten Sie Ihr Konto, bezahlen Sie Ihre Rechnung und erhalten Sie exklusive Angebote an einem Ort.",
    italian: "Gestisci il tuo account, paga la bolletta e accedi a offerte esclusive in un unico posto.",
    portuguese: "Gerencie sua conta, pague sua fatura e acesse ofertas exclusivas em um só lugar.",
  },
  buttonText: {
    english: "Download now",
    french: "Télécharger maintenant",
    spanish: "Descargar ahora",
    german: "Jetzt herunterladen",
    italian: "Scarica ora",
    portuguese: "Baixar agora",
  },
  buttonUrl: "https://www.rogers.com/support/apps",
};
const DEFAULT_ANALYTICS_OPTIONS = {
  active: false,
};
const DEFAULT_AI_BOOTH_RENTAL_POLICY =
  "You can borrow a portable charger using your phone number. It is complimentary for the day, " +
  "but there is a fee if it is not returned today. You can return it at any kiosk.";
const DEFAULT_AI_BOOTH_SUPPORT_FALLBACK = "event staff or the information desk";
const DEFAULT_AI_BOOTH_PHONE_CHARGING_ENABLED = false;
const DEFAULT_AI_BOOTH_PAYMENT_TYPE = "apollo";
const AI_BOOTH_MISS_PUTT_TOOL_NAME = "miss_putt";
const AI_BOOTH_PHONE_CHARGING_TOPIC_KIND = "phoneCharging";
const AI_BOOTH_WIFI_TOPIC_KIND = "wifi";
const AI_BOOTH_TRANSPORTATION_TOPIC_KIND = "transportation";
const AI_BOOTH_CONCESSIONS_TOPIC_KIND = "concessions";
const AI_BOOTH_HOSPITALITY_TOPIC_KIND = "hospitality";
const AI_BOOTH_BATHROOMS_TOPIC_KIND = "bathrooms";
const AI_BOOTH_FAN_SERVICES_TOPIC_KIND = "fanServices";
const AI_BOOTH_COURSE_TOPIC_KIND = "course";
const AI_BOOTH_SCHEDULE_TOPIC_KIND = "schedule";
const DEFAULT_SLASH_GOLF_API_BASE_URL = "https://live-golf-data.p.rapidapi.com";
const DEFAULT_SLASH_GOLF_API_HOST = "live-golf-data.p.rapidapi.com";
const DEFAULT_SLASH_GOLF_ORG_ID = "1";
const DEFAULT_SLASH_GOLF_TOUR = "pga";
const DEFAULT_AI_BOOTH_SCREEN_TOPIC_COLORS = {
  eventInfo: "#38bdf8",
};
const DEFAULT_AI_BOOTH_SCREEN_UI = {
  preset: "midnight",
  visualMode: "knowledge-web",
  golfQrMode: "rotate-ball",
  theme: {
    background: "#060606",
    backgroundAlt: "#111216",
    glow: "#568aff",
    secondaryGlow: "#94ffb5",
    primary: "#5cf4b0",
    accent: "#ec7c92",
    agentButton: "#182434",
    agentListening: "#00a2ff",
    agentSpeaking: "#ff9f30",
    topicColors: DEFAULT_AI_BOOTH_SCREEN_TOPIC_COLORS,
  },
  features: {
    showConversationControls: true,
    showStopButton: true,
    qrDisplay: true,
    keyboardShortcuts: true,
    showVisualSwitcher: false,
    demoTalk: false,
    debugOverlay: false,
  },
};
const STANDARD_AI_BOOTH_SYSTEM_PROMPT = `Role
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
const DEFAULT_MEDIA_OPTIONS = {
  active: false,
  assetIds: [],
  playlist: [],
  loop: true,
};
const NEW_KIOSK_TYPES = new Set(["CT3", "CT4", "CT8", "CT12", "CK48"]);
const GOOGLE_MAPS_SECRET = "GOOGLE_MAPS_API_KEY";
const COUNTRY_PREFIXES = {
  CA: "CA",
  CAN: "CA",
  FR: "FR",
  EUR: "FR",
  US: "US",
  USA: "US",
};

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeLocalizedMarketingValue(value, defaults) {
  if (typeof value === "string") {
    return {...defaults, english: value};
  }

  if (isPlainObject(value)) {
    return {...defaults, ...value};
  }

  return {...defaults};
}

function normalizeMarketingOptions(marketingoptions) {
  const source = isPlainObject(marketingoptions) ? marketingoptions : {};

  return {
    active: source.active == null ? DEFAULT_MARKETING_OPTIONS.active : source.active === true,
    title: mergeLocalizedMarketingValue(source.title, DEFAULT_MARKETING_OPTIONS.title),
    offerText: mergeLocalizedMarketingValue(source.offerText, DEFAULT_MARKETING_OPTIONS.offerText),
    buttonText: mergeLocalizedMarketingValue(source.buttonText, DEFAULT_MARKETING_OPTIONS.buttonText),
    buttonUrl: source.buttonUrl ?? DEFAULT_MARKETING_OPTIONS.buttonUrl,
  };
}

function normalizeMediaOptions(media) {
  const source = isPlainObject(media) ? media : {};
  const playlist = Array.isArray(source.playlist) ?
    source.playlist.filter((item) => isPlainObject(item)) :
    [];
  const assetIds = Array.isArray(source.assetIds) ?
    source.assetIds
        .map((value) => String(value || "").trim())
        .filter(Boolean) :
    playlist
        .map((item) => String(item?.assetId || "").trim())
        .filter(Boolean);

  return {
    ...DEFAULT_MEDIA_OPTIONS,
    ...source,
    active: source.active === true && playlist.length > 0,
    assetIds,
    playlist,
    loop: source.loop !== false,
  };
}

function detectMediaKind(contentType) {
  const normalizedContentType = String(contentType || "").trim().toLowerCase();
  if (normalizedContentType.startsWith("image/")) return "image";
  if (normalizedContentType.startsWith("video/")) return "video";
  if (normalizedContentType === "application/pdf") return "pdf";
  return "other";
}

function isSupportedMediaContentType(contentType) {
  const normalizedContentType = String(contentType || "").trim().toLowerCase();
  return (
    normalizedContentType.startsWith("image/") ||
    normalizedContentType.startsWith("video/") ||
    normalizedContentType === "application/pdf"
  );
}

function sanitizeFileName(fileName) {
  const normalized = String(fileName || "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

  return normalized || `upload-${Date.now()}`;
}

function getStorageBucketCandidates(requestedBucketName = "") {
  const normalizedRequested = String(requestedBucketName || "").trim();
  return Array.from(new Set([
    normalizedRequested,
    ...STORAGE_BUCKET_CANDIDATES,
  ].filter(Boolean)));
}

function getStorageBucket(bucketName = "") {
  const normalizedBucketName = String(bucketName || "").trim() || STORAGE_BUCKET;
  return admin.storage().bucket(normalizedBucketName);
}

function buildHttpsCompat(runtimeOptions = null) {
  return {
    HttpsError,
    onCall(handler) {
      if (runtimeOptions) {
        return onCall(runtimeOptions, async (request) => handler(request.data, request));
      }

      return onCall(async (request) => handler(request.data, request));
    },
    onRequest(handler) {
      if (runtimeOptions) {
        return onRequest(runtimeOptions, handler);
      }

      return onRequest(handler);
    },
  };
}

const functions = {
  https: buildHttpsCompat(),
  runWith(runtimeOptions) {
    return {
      https: buildHttpsCompat(runtimeOptions),
    };
  },
};

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function getRequestData(req) {
  const body = req.body || {};
  if (body && typeof body === "object" && body.data && typeof body.data === "object") {
    return body.data;
  }
  return body;
}

async function getAuthorizedProfileFromRequest(req, data) {
  let uid = "";
  const authorization = String(req.headers.authorization || "").trim();

  if (authorization.startsWith("Bearer ")) {
    const idToken = authorization.slice("Bearer ".length).trim();

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      uid = String(decodedToken?.uid || "").trim();
    } catch {
      uid = "";
    }
  }

  if (!uid) {
    const idToken = String(data?.__authToken || "").trim();

    if (idToken) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        uid = String(decodedToken?.uid || "").trim();
      } catch {
        uid = "";
      }
    }
  }

  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Not signed in");
  }

  const snap = await db.collection("users").doc(uid).get();

  if (!snap.exists) {
    throw new functions.https.HttpsError("permission-denied", "No profile");
  }

  const profile = snap.data() || {};
  const isAdmin = profile.role === "admin" || profile.username === "chargerent";

  return {uid, profile, isAdmin};
}

async function getAuthorizedProfileFromContext(context) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Not signed in");
  }

  const uid = String(context.auth.uid || "").trim();
  const snap = await db.collection("users").doc(uid).get();

  if (!snap.exists) {
    throw new functions.https.HttpsError("permission-denied", "No profile");
  }

  const profile = snap.data() || {};
  const isAdmin = profile.role === "admin" || profile.username === "chargerent";

  return {uid, profile, isAdmin};
}

async function assertAdmin(req, data) {
  const {uid, profile, isAdmin} = await getAuthorizedProfileFromRequest(req, data);
  if (!isAdmin) {
    throw new functions.https.HttpsError("permission-denied", "Not admin");
  }

  return {uid, profile};
}

async function assertAdminFromContext(context) {
  const {uid, profile, isAdmin} = await getAuthorizedProfileFromContext(context);
  if (!isAdmin) {
    throw new functions.https.HttpsError("permission-denied", "Not admin");
  }

  return {uid, profile};
}

async function assertCanManageBindings(req, data) {
  const authState = await getAuthorizedProfileFromRequest(req, data);
  const features = authState.profile.features || {};
  const commands = authState.profile.commands || {};
  const username = normalizeUsername(authState.profile.username);

  if (username === "chargerent" || features.binding === true || commands.binding === true) {
    return authState;
  }

  throw new functions.https.HttpsError(
      "permission-denied",
      "Not allowed to manage bindings",
  );
}

async function assertCanManageBindingsFromContext(context) {
  const authState = await getAuthorizedProfileFromContext(context);
  const features = authState.profile.features || {};
  const commands = authState.profile.commands || {};
  const username = normalizeUsername(authState.profile.username);

  if (username === "chargerent" || features.binding === true || commands.binding === true) {
    return authState;
  }

  throw new functions.https.HttpsError(
      "permission-denied",
      "Not allowed to manage bindings",
  );
}

function hasMediaFeature(authState) {
  const username = normalizeUsername(authState?.profile?.username);
  if (username === "chargerent" || authState?.isAdmin) {
    return true;
  }

  return authState?.profile?.features?.media === true;
}

async function assertCanManageMedia(req, data) {
  const authState = await getAuthorizedProfileFromRequest(req, data);
  if (hasMediaFeature(authState)) {
    return authState;
  }

  throw new functions.https.HttpsError(
      "permission-denied",
      "Not allowed to manage media",
  );
}

async function assertCanManageMediaFromContext(context) {
  const authState = await getAuthorizedProfileFromContext(context);
  if (hasMediaFeature(authState)) {
    return authState;
  }

  throw new functions.https.HttpsError(
      "permission-denied",
      "Not allowed to manage media",
  );
}

function hasAiBoothsFeature(authState) {
  const username = normalizeUsername(authState?.profile?.username);
  if (username === "chargerent" || authState?.isAdmin) {
    return true;
  }

  const features = authState?.profile?.features || {};
  const commands = authState?.profile?.commands || {};
  return features.media === true || commands["client edit"] === true;
}

async function assertCanManageAiBooths(req, data) {
  const authState = await getAuthorizedProfileFromRequest(req, data);
  if (hasAiBoothsFeature(authState)) {
    return authState;
  }

  throw new functions.https.HttpsError(
      "permission-denied",
      "Not allowed to manage AI booths",
  );
}

async function assertCanManageAiBoothsFromContext(context) {
  const authState = await getAuthorizedProfileFromContext(context);
  if (hasAiBoothsFeature(authState)) {
    return authState;
  }

  throw new functions.https.HttpsError(
      "permission-denied",
      "Not allowed to manage AI booths",
  );
}

function cleanAiBoothText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeAiBoothIntakeCode(value) {
  return cleanAiBoothText(value, 32)
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
}

function maskAiBoothIntakeCode(value) {
  const code = normalizeAiBoothIntakeCode(value).replace(/-/g, "");

  if (code.length <= 4) {
    return code;
  }

  return `${code.slice(0, 2)}...${code.slice(-2)}`;
}

function getEventIntakeSecret() {
  return String(
      process.env.EVENT_INTAKE_SECRET ||
      process.env.DEMO_SESSION_SECRET ||
      "obailix-local-intake-secret",
  );
}

function hashAiBoothIntakeValue(kind, value, eventId = "") {
  return crypto
      .createHash("sha256")
      .update(
          `${getEventIntakeSecret()}:${kind}:${eventId}:` +
          normalizeAiBoothIntakeCode(value),
      )
      .digest("hex");
}

function escapeAiBoothWifiQrValue(value) {
  return cleanAiBoothText(value, 512).replace(/([\\;,:"])/g, "\\$1");
}

function normalizeAiBoothWifiSecurity(value, password) {
  const raw = cleanAiBoothText(value, 40).toUpperCase();
  if (raw === "NOPASS" || raw === "NONE" || raw === "OPEN") {
    return "nopass";
  }
  if (raw === "WEP") {
    return "WEP";
  }
  return password ? "WPA" : "nopass";
}

function buildAiBoothWifiQrPayload(topic) {
  const ssid = cleanAiBoothText(topic?.wifiSsid || topic?.wifi?.ssid, 240);
  if (!ssid) {
    return "";
  }

  const password = cleanAiBoothText(topic?.wifiPassword || topic?.wifi?.password, 240);
  const security = normalizeAiBoothWifiSecurity(
      topic?.wifiSecurity || topic?.wifi?.security,
      password,
  );
  const hidden = topic?.wifiHidden === true || topic?.wifi?.hidden === true;

  return [
    "WIFI:",
    `T:${security};`,
    `S:${escapeAiBoothWifiQrValue(ssid)};`,
    password ? `P:${escapeAiBoothWifiQrValue(password)};` : "",
    `H:${hidden ? "true" : "false"};`,
    ";",
  ].join("");
}

function normalizeAiBoothHexColor(value, fallback) {
  const raw = cleanAiBoothText(value, 16).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) {
    return raw;
  }

  return fallback;
}

function cloneDefaultAiBoothScreenUi() {
  return JSON.parse(JSON.stringify(DEFAULT_AI_BOOTH_SCREEN_UI));
}

function normalizeAiBoothVisualMode(value, fallback = DEFAULT_AI_BOOTH_SCREEN_UI.visualMode) {
  const raw = cleanAiBoothText(value, 60);
  const normalized = {
    original: "knowledge-web",
    "golf-green": "golf-scorecard",
    "golf-3d": "golf-scorecard",
    golf: "golf-scorecard",
    southwest: "southwest-heart",
    "southwest-airlines": "southwest-heart",
    heart: "southwest-heart",
    airport: "airport-departure",
    departures: "airport-departure",
    "airport-board": "airport-departure",
    "departure-board": "airport-departure",
    terminal: "airport-departure",
  }[raw] || raw;
  return ["knowledge-web", "golf-scorecard", "southwest-heart", "airport-departure"].includes(normalized) ? normalized : fallback;
}

function normalizeAiBoothGolfQrMode(value, fallback = DEFAULT_AI_BOOTH_SCREEN_UI.golfQrMode) {
  const raw = cleanAiBoothText(value, 60);
  const normalized = {
    ball: "rotate-ball",
    rotate: "rotate-ball",
    "printed-ball": "rotate-ball",
    cup: "cup-putt",
    hole: "cup-putt",
    putt: "cup-putt",
    "putt-cup": "cup-putt",
  }[raw] || raw;
  return ["rotate-ball", "cup-putt"].includes(normalized) ? normalized : fallback;
}

function normalizeAiBoothScreenUi(value) {
  const source = isPlainObject(value) ? value : {};
  const themeSource = isPlainObject(source.theme) ? source.theme : {};
  const featuresSource = isPlainObject(source.features) ? source.features : {};
  const topicColorSource = isPlainObject(themeSource.topicColors) ? themeSource.topicColors : {};
  const defaults = cloneDefaultAiBoothScreenUi();
  const extraTopicColors = Object.entries(topicColorSource).reduce((colors, [key, color]) => {
    const normalizedKey = cleanAiBoothText(key, 160);
    if (!normalizedKey) {
      return colors;
    }

    const normalizedColor = normalizeAiBoothHexColor(color, "");
    if (!normalizedColor) {
      return colors;
    }

    return {
      ...colors,
      [normalizedKey]: normalizedColor,
    };
  }, {});

  return {
    preset: cleanAiBoothText(source.preset, 40) || defaults.preset,
    visualMode: normalizeAiBoothVisualMode(source.visualMode || source.mode, defaults.visualMode),
    golfQrMode: normalizeAiBoothGolfQrMode(source.golfQrMode || source.qrVisualization, defaults.golfQrMode),
    theme: {
      background: normalizeAiBoothHexColor(themeSource.background, defaults.theme.background),
      backgroundAlt: normalizeAiBoothHexColor(themeSource.backgroundAlt, defaults.theme.backgroundAlt),
      glow: normalizeAiBoothHexColor(themeSource.glow, defaults.theme.glow),
      secondaryGlow: normalizeAiBoothHexColor(themeSource.secondaryGlow, defaults.theme.secondaryGlow),
      primary: normalizeAiBoothHexColor(themeSource.primary, defaults.theme.primary),
      accent: normalizeAiBoothHexColor(themeSource.accent, defaults.theme.accent),
      agentButton: normalizeAiBoothHexColor(themeSource.agentButton, defaults.theme.agentButton),
      agentListening: normalizeAiBoothHexColor(themeSource.agentListening, defaults.theme.agentListening),
      agentSpeaking: normalizeAiBoothHexColor(themeSource.agentSpeaking, defaults.theme.agentSpeaking),
      topicColors: {
        ...extraTopicColors,
        eventInfo: normalizeAiBoothHexColor(
            topicColorSource.eventInfo,
            defaults.theme.topicColors.eventInfo,
        ),
      },
    },
    features: Object.entries(defaults.features).reduce((features, [key, defaultValue]) => ({
      ...features,
      [key]: typeof featuresSource[key] === "boolean" ? featuresSource[key] : defaultValue,
    }), {}),
  };
}

function normalizeAiBoothScreenUiByStationId(value, boothStationIds = [], fallbackScreenUi = null) {
  const source = isPlainObject(value) ? value : {};
  const fallback = normalizeAiBoothScreenUi(fallbackScreenUi);
  const stationIds = Array.isArray(boothStationIds) ? boothStationIds : [];

  return stationIds.reduce((screenUiByStationId, stationId) => {
    const normalizedStationId = cleanAiBoothText(stationId, 80);
    if (!normalizedStationId) {
      return screenUiByStationId;
    }

    return {
      ...screenUiByStationId,
      [normalizedStationId]: normalizeAiBoothScreenUi(source[normalizedStationId] || fallback),
    };
  }, {});
}

const AI_BOOTH_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const AI_BOOTH_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeAiBoothDailyHours(value) {
  const source = isPlainObject(value) ? value : {};

  return Object.entries(source).reduce((hoursByDay, [rawKey, rawDaySource]) => {
    const sanitizedKey = cleanAiBoothText(rawKey, 32);
    const dayKey = AI_BOOTH_DATE_KEY_PATTERN.test(sanitizedKey) ?
      sanitizedKey :
      sanitizedKey.toLowerCase();

    if (!AI_BOOTH_DATE_KEY_PATTERN.test(dayKey) && !AI_BOOTH_DAY_KEYS.includes(dayKey)) {
      return hoursByDay;
    }

    const daySource = isPlainObject(rawDaySource) ? rawDaySource : {};

    return {
      ...hoursByDay,
      [dayKey]: {
        openingHours: cleanAiBoothText(daySource.openingHours, 32),
        closingHours: cleanAiBoothText(daySource.closingHours, 32),
      },
    };
  }, {});
}

function normalizeAiBoothTransportationSection(value) {
  const source = isPlainObject(value) ? value : {};
  const rawLocations = Array.isArray(source.locations) ?
    source.locations :
    Array.isArray(source.stops) ? source.stops : [];
  const hasLegacyLocation = [
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
  ].some((entry) => cleanAiBoothText(entry, 4000));

  return {
    locations: rawLocations.length > 0 ?
      rawLocations.map(normalizeAiBoothTransportationLocation) :
      hasLegacyLocation ? [normalizeAiBoothTransportationLocation(source, 0)] : [],
  };
}

function normalizeAiBoothTransportationLocation(location, index) {
  const source = isPlainObject(location) ? location : {};

  return {
    id: cleanAiBoothText(source.id, 160) ||
      `transportation-location-${index + 1}`,
    location: cleanAiBoothText(
        source.location || source.pickup || source.area || source.place,
        500,
    ),
    latitude: cleanAiBoothText(
        pickAiBoothCoordinateValue(source.latitude, source.lat),
        80,
    ),
    longitude: cleanAiBoothText(
        pickAiBoothCoordinateValue(source.longitude, source.lng, source.lon),
        80,
    ),
    hours: cleanAiBoothText(source.hours || source.openHours, 240),
    startTime: cleanAiBoothText(source.startTime || source.from || source.start, 120),
    endTime: cleanAiBoothText(source.endTime || source.to || source.end, 120),
    frequency: cleanAiBoothText(source.frequency || source.interval, 240),
    details: cleanAiBoothText(
        source.details || source.instructions || source.notes,
        4000,
    ),
  };
}

function normalizeAiBoothTransportationDetails(value) {
  const source = isPlainObject(value) ? value : {};

  return {
    shuttle: normalizeAiBoothTransportationSection(source.shuttle),
    rideShare: normalizeAiBoothTransportationSection(source.rideShare || source.rideshare),
    parking: normalizeAiBoothTransportationSection(source.parking),
  };
}

function normalizeAiBoothFanZoneActivation(activation, index) {
  const source = isPlainObject(activation) ? activation : {};
  const name = cleanAiBoothText(source.name, 160);

  return {
    id: cleanAiBoothText(source.id, 160) || `fan-activation-${index + 1}`,
    name: name || `Activation ${index + 1}`,
    sponsor: cleanAiBoothText(source.sponsor, 200),
    location: cleanAiBoothText(source.location, 300),
    hours: cleanAiBoothText(source.hours || source.openHours, 160),
    details: cleanAiBoothText(
        source.details || source.description || source.instructions,
        4000,
    ),
  };
}

function normalizeAiBoothFanZone(zone, index) {
  const source = isPlainObject(zone) ? zone : {};
  const name = cleanAiBoothText(source.name, 160);
  const activations = Array.isArray(source.activations) ?
    source.activations.map(normalizeAiBoothFanZoneActivation) :
    [];

  return {
    id: cleanAiBoothText(source.id, 160) || `fan-zone-${index + 1}`,
    name: name || `Fan Zone ${index + 1}`,
    latitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.latitude, source.lat),
    ),
    longitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.longitude, source.lng, source.lon),
    ),
    openHours: cleanAiBoothText(source.openHours || source.hours, 240),
    details: cleanAiBoothText(source.details || source.description || source.notes, 6000),
    activations,
  };
}

function normalizeAiBoothFanZones(value) {
  return Array.isArray(value) ? value.map(normalizeAiBoothFanZone) : [];
}

function normalizeAiBoothHospitalityClient(client, index) {
  const source = isPlainObject(client) ? client : {};
  const clientName = cleanAiBoothText(
      source.clientName || source.name || source.company,
      240,
  );

  return {
    id: cleanAiBoothText(source.id, 160) || `hospitality-client-${index + 1}`,
    clientName: clientName || `Client ${index + 1}`,
    contactName: cleanAiBoothText(source.contactName || source.contact, 200),
    contactPhone: cleanAiBoothText(source.contactPhone || source.phone, 80),
    contactEmail: cleanAiBoothText(source.contactEmail || source.email, 200),
    hostName: cleanAiBoothText(source.hostName || source.host, 200),
    credentialNotes: cleanAiBoothText(
        source.credentialNotes || source.credentials,
        2000,
    ),
    arrivalNotes: cleanAiBoothText(source.arrivalNotes || source.arrival, 2000),
    specialRequests: cleanAiBoothText(
        source.specialRequests || source.requests || source.notes,
        2000,
    ),
  };
}

function normalizeAiBoothHospitalityClients(value) {
  return Array.isArray(value) ? value.map(normalizeAiBoothHospitalityClient) : [];
}

function normalizeAiBoothHospitalityLocation(location, index) {
  const source = isPlainObject(location) ? location : {};
  const name = cleanAiBoothText(source.name || source.product, 200);

  return {
    id: cleanAiBoothText(source.id, 160) || `hospitality-location-${index + 1}`,
    name: name || `Hospitality Location ${index + 1}`,
    venueType: cleanAiBoothText(source.venueType || source.category, 80),
    location: cleanAiBoothText(source.location || source.place, 300),
    latitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.latitude, source.lat),
    ),
    longitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.longitude, source.lng, source.lon),
    ),
    amenities: cleanAiBoothText(source.amenities || source.includes, 4000),
    accessNotes: cleanAiBoothText(
        source.accessNotes || source.access || source.credentials,
        3000,
    ),
    details: cleanAiBoothText(source.details || source.description || source.notes, 5000),
    clients: normalizeAiBoothHospitalityClients(
        source.clients || source.assignedClients,
    ),
  };
}

function normalizeAiBoothHospitalityLocations(value) {
  return Array.isArray(value) ? value.map(normalizeAiBoothHospitalityLocation) : [];
}

function normalizeAiBoothBathroomLocation(location, index) {
  const source = isPlainObject(location) ? location : {};
  const place = cleanAiBoothText(source.place || source.name || source.location, 240);

  return {
    id: cleanAiBoothText(source.id, 160) || `bathroom-location-${index + 1}`,
    place: place || `Bathroom ${index + 1}`,
    latitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.latitude, source.lat),
    ),
    longitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.longitude, source.lng, source.lon),
    ),
  };
}

function normalizeAiBoothBathroomLocations(value) {
  return Array.isArray(value) ? value.map(normalizeAiBoothBathroomLocation) : [];
}

const DEFAULT_AI_BOOTH_FAN_SERVICE_NAMES = Object.freeze([
  "First aid",
  "Lost and found",
  "Accessibility help",
]);

function createDefaultAiBoothFanServices() {
  return DEFAULT_AI_BOOTH_FAN_SERVICE_NAMES.map((name, index) => ({
    id: `fan-service-${index + 1}`,
    name,
    location: "",
    latitude: "",
    longitude: "",
  }));
}

function normalizeAiBoothFanService(service, index) {
  const source = isPlainObject(service) ? service : {};
  const name = cleanAiBoothText(source.name, 160);

  return {
    id: cleanAiBoothText(source.id, 160) || `fan-service-${index + 1}`,
    name: name || `Service ${index + 1}`,
    location: cleanAiBoothText(source.location || source.place, 300),
    latitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.latitude, source.lat),
    ),
    longitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.longitude, source.lng, source.lon),
    ),
  };
}

function normalizeAiBoothFanServices(value, includeDefaults = false) {
  const services = Array.isArray(value) ? value.map(normalizeAiBoothFanService) : [];
  return includeDefaults && services.length === 0 ? createDefaultAiBoothFanServices() : services;
}

function createDefaultAiBoothCourseHoles() {
  return Array.from({length: 18}, (_, index) => ({
    id: `hole-${index + 1}`,
    holeNumber: index + 1,
    teeLatitude: "",
    teeLongitude: "",
    greenLatitude: "",
    greenLongitude: "",
  }));
}

function normalizeAiBoothCourseHole(hole, index) {
  const source = isPlainObject(hole) ? hole : {};
  const holeNumber = Number(source.holeNumber || source.number || index + 1);

  return {
    id: cleanAiBoothText(source.id, 160) || `hole-${index + 1}`,
    holeNumber: Number.isFinite(holeNumber) ? holeNumber : index + 1,
    teeLatitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(
            source.teeLatitude,
            source.teeLat,
            source.tee?.latitude,
            source.tee?.lat,
        ),
    ),
    teeLongitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(
            source.teeLongitude,
            source.teeLng,
            source.teeLon,
            source.tee?.longitude,
            source.tee?.lng,
            source.tee?.lon,
        ),
    ),
    greenLatitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(
            source.greenLatitude,
            source.greenLat,
            source.green?.latitude,
            source.green?.lat,
        ),
    ),
    greenLongitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(
            source.greenLongitude,
            source.greenLng,
            source.greenLon,
            source.green?.longitude,
            source.green?.lng,
            source.green?.lon,
        ),
    ),
  };
}

function normalizeAiBoothCourseHoles(value, includeDefaults = false) {
  const holes = Array.isArray(value) ? value.map(normalizeAiBoothCourseHole) : [];
  const holesByNumber = new Map(holes.map((hole) => [hole.holeNumber, hole]));

  if (!includeDefaults) {
    return holes;
  }

  return createDefaultAiBoothCourseHoles().map((defaultHole) => ({
    ...defaultHole,
    ...(holesByNumber.get(defaultHole.holeNumber) || {}),
  }));
}

function normalizeAiBoothScheduleEvent(scheduleEvent, dayIndex, eventIndex) {
  const source = isPlainObject(scheduleEvent) ? scheduleEvent : {};
  const title = cleanAiBoothText(source.title || source.name, 220);

  return {
    id: cleanAiBoothText(source.id, 160) || `schedule-event-${dayIndex + 1}-${eventIndex + 1}`,
    title: title || `Schedule Item ${eventIndex + 1}`,
    category: cleanAiBoothText(source.category || source.type, 120),
    startTime: cleanAiBoothText(source.startTime || source.start, 80),
    endTime: cleanAiBoothText(source.endTime || source.end, 80),
    location: cleanAiBoothText(source.location || source.place, 240),
    audience: cleanAiBoothText(source.audience || source.access, 160),
    details: cleanAiBoothText(
        source.details || source.description || source.notes,
        5000,
    ),
    sourceNote: cleanAiBoothText(source.sourceNote || source.warning, 2000),
    needsReview: source.needsReview === true,
  };
}

function normalizeAiBoothScheduleDay(day, index) {
  const source = isPlainObject(day) ? day : {};
  const dayLabel = cleanAiBoothText(source.dayLabel || source.label, 180);
  const events = Array.isArray(source.events || source.items) ?
    (source.events || source.items).map((event, eventIndex) => (
      normalizeAiBoothScheduleEvent(event, index, eventIndex)
    )) :
    [];

  return {
    id: cleanAiBoothText(source.id, 160) || `schedule-day-${index + 1}`,
    date: cleanAiBoothText(source.date, 40),
    dayLabel: dayLabel || `Day ${index + 1}`,
    publicStatus: cleanAiBoothText(source.publicStatus || source.status, 160),
    theme: cleanAiBoothText(source.theme || source.title, 180),
    gatesOpen: cleanAiBoothText(source.gatesOpen || source.gates?.open, 80),
    gatesClose: cleanAiBoothText(source.gatesClose || source.gates?.close, 80),
    dailyNotes: cleanAiBoothText(source.dailyNotes || source.notes, 5000),
    events,
  };
}

function normalizeAiBoothScheduleDays(value) {
  return Array.isArray(value) ? value.map(normalizeAiBoothScheduleDay) : [];
}

function normalizeAiBoothTopic(topic, index) {
  if (!isPlainObject(topic)) {
    return {
      id: `topic-${index + 1}`,
      title: `Topic ${index + 1}`,
      kind: "",
      summary: "",
      notes: "",
      checklistText: "",
      wifiSsid: "",
      wifiPassword: "",
      wifiSecurity: "WPA",
      wifiHidden: false,
      transportation: normalizeAiBoothTransportationDetails({}),
      fanZones: [],
      hospitalityLocations: [],
      bathroomLocations: [],
      fanServices: [],
      courseHoles: [],
      scheduleDays: [],
    };
  }

  const title = cleanAiBoothText(topic.title, 120);
  const rawKind = cleanAiBoothText(topic.kind, 80);
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  let kind = "";
  if (rawKind === AI_BOOTH_PHONE_CHARGING_TOPIC_KIND || title.toLowerCase() === "phone chargers") {
    kind = AI_BOOTH_PHONE_CHARGING_TOPIC_KIND;
  } else if (rawKind === AI_BOOTH_WIFI_TOPIC_KIND || normalizedTitle === "wifi") {
    kind = AI_BOOTH_WIFI_TOPIC_KIND;
  } else if (
    rawKind === AI_BOOTH_TRANSPORTATION_TOPIC_KIND ||
    normalizedTitle === "transportation"
  ) {
    kind = AI_BOOTH_TRANSPORTATION_TOPIC_KIND;
  } else if (
    rawKind === AI_BOOTH_CONCESSIONS_TOPIC_KIND ||
    normalizedTitle === "concessions"
  ) {
    kind = AI_BOOTH_CONCESSIONS_TOPIC_KIND;
  } else if (
    rawKind === AI_BOOTH_HOSPITALITY_TOPIC_KIND ||
    normalizedTitle === "hospitality"
  ) {
    kind = AI_BOOTH_HOSPITALITY_TOPIC_KIND;
  } else if (
    rawKind === AI_BOOTH_BATHROOMS_TOPIC_KIND ||
    normalizedTitle === "bathrooms"
  ) {
    kind = AI_BOOTH_BATHROOMS_TOPIC_KIND;
  } else if (
    rawKind === AI_BOOTH_FAN_SERVICES_TOPIC_KIND ||
    normalizedTitle === "fanservices"
  ) {
    kind = AI_BOOTH_FAN_SERVICES_TOPIC_KIND;
  } else if (
    rawKind === AI_BOOTH_COURSE_TOPIC_KIND ||
    normalizedTitle === "course"
  ) {
    kind = AI_BOOTH_COURSE_TOPIC_KIND;
  } else if (
    rawKind === AI_BOOTH_SCHEDULE_TOPIC_KIND ||
    normalizedTitle === "schedule"
  ) {
    kind = AI_BOOTH_SCHEDULE_TOPIC_KIND;
  }

  return {
    id: cleanAiBoothText(topic.id, 160) || `topic-${index + 1}`,
    title: title || `Topic ${index + 1}`,
    kind,
    summary: cleanAiBoothText(topic.summary, 2000),
    notes: cleanAiBoothText(topic.notes, 8000),
    checklistText: cleanAiBoothText(topic.checklistText, 4000),
    wifiSsid: cleanAiBoothText(topic.wifiSsid || topic.wifi?.ssid, 240),
    wifiPassword: cleanAiBoothText(topic.wifiPassword || topic.wifi?.password, 240),
    wifiSecurity: normalizeAiBoothWifiSecurity(topic.wifiSecurity || topic.wifi?.security, topic.wifiPassword || topic.wifi?.password),
    wifiHidden: topic.wifiHidden === true || topic.wifi?.hidden === true,
    transportation: normalizeAiBoothTransportationDetails(topic.transportation),
    fanZones: normalizeAiBoothFanZones(topic.fanZones || topic.zones),
    hospitalityLocations: normalizeAiBoothHospitalityLocations(
        topic.hospitalityLocations || topic.hospitality || topic.venues || (
          kind === AI_BOOTH_HOSPITALITY_TOPIC_KIND ? topic.locations : []
        ),
    ),
    bathroomLocations: normalizeAiBoothBathroomLocations(
        topic.bathroomLocations || (
          kind === AI_BOOTH_BATHROOMS_TOPIC_KIND ? topic.locations : []
        ),
    ),
    fanServices: normalizeAiBoothFanServices(
        topic.fanServices || topic.services,
        kind === AI_BOOTH_FAN_SERVICES_TOPIC_KIND,
    ),
    courseHoles: normalizeAiBoothCourseHoles(
        topic.courseHoles || topic.holes,
        kind === AI_BOOTH_COURSE_TOPIC_KIND,
    ),
    scheduleDays: normalizeAiBoothScheduleDays(
        topic.scheduleDays || topic.schedule || topic.days,
    ),
  };
}

function normalizeAiBoothActivation(activation, index) {
  const source = isPlainObject(activation) ? activation : {};
  const name = cleanAiBoothText(source.name, 160);

  return {
    id: cleanAiBoothText(source.id, 160) || `activation-${index + 1}`,
    name: name || `Activation ${index + 1}`,
    sponsor: cleanAiBoothText(source.sponsor, 200),
    category: cleanAiBoothText(source.category, 120),
    location: cleanAiBoothText(source.location, 300),
    hours: cleanAiBoothText(source.hours, 160),
    description: cleanAiBoothText(source.description, 4000),
    guestInstructions: cleanAiBoothText(
        source.guestInstructions || source.instructions,
        4000,
    ),
  };
}

function normalizeAiBoothScreenTopic(topic, index) {
  const normalizedTopic = normalizeAiBoothTopic(topic, index);
  return {
    id: normalizedTopic.id,
    title: normalizedTopic.title,
  };
}

function normalizeAiBoothKioskAgent(agent) {
  const source = isPlainObject(agent) ? agent : {};

  return {
    agentId: cleanAiBoothText(source.agentId, 160),
    name: cleanAiBoothText(source.name, 140),
    syncStatus: cleanAiBoothText(source.syncStatus, 80),
    syncError: cleanAiBoothText(source.syncError, 1000),
    lastSyncedAt: serializeTimestamp(source.lastSyncedAt),
    lastSyncedBy: isPlainObject(source.lastSyncedBy) ? source.lastSyncedBy : null,
  };
}

function normalizeAiBoothKioskAgents(value, boothStationIds = []) {
  const source = isPlainObject(value) ? value : {};
  const stationIds = Array.isArray(boothStationIds) ? boothStationIds : [];

  return stationIds.reduce((agentsByStation, stationId) => {
    const normalizedStationId = cleanAiBoothText(stationId, 80);
    if (!normalizedStationId) {
      return agentsByStation;
    }

    return {
      ...agentsByStation,
      [normalizedStationId]: normalizeAiBoothKioskAgent(source[normalizedStationId]),
    };
  }, {});
}

function normalizeAiBoothBoothContext(context) {
  const source = isPlainObject(context) ? context : {};

  return {
    assistantName: cleanAiBoothText(source.assistantName, 120),
    locationName: cleanAiBoothText(source.locationName, 200),
    place: cleanAiBoothText(source.place, 200),
    latitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.latitude, source.lat),
    ),
    longitude: cleanAiBoothCoordinateText(
        pickAiBoothCoordinateValue(source.longitude, source.lng, source.lon),
    ),
    zone: cleanAiBoothText(source.zone, 160),
    landmark: cleanAiBoothText(source.landmark, 240),
    directionsNotes: cleanAiBoothText(source.directionsNotes, 2000),
    mapX: cleanAiBoothText(source.mapX, 40),
    mapY: cleanAiBoothText(source.mapY, 40),
  };
}

function normalizeAiBoothBoothContexts(value, boothStationIds = []) {
  const source = isPlainObject(value) ? value : {};
  const stationIds = Array.isArray(boothStationIds) ? boothStationIds : [];

  return stationIds.reduce((contextsByStation, stationId) => {
    const normalizedStationId = cleanAiBoothText(stationId, 80);
    if (!normalizedStationId) {
      return contextsByStation;
    }

    return {
      ...contextsByStation,
      [normalizedStationId]: normalizeAiBoothBoothContext(source[normalizedStationId]),
    };
  }, {});
}

function parseAiBoothCoordinate(value, min, max) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    return null;
  }

  return coordinate;
}

function cleanAiBoothCoordinateText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim().slice(0, 40);
}

function pickAiBoothCoordinateValue(...values) {
  return values.find((value) => (
    value !== null &&
    value !== undefined &&
    String(value).trim() !== ""
  ));
}

function getAiBoothEventStartYear(general = {}) {
  const startYear = cleanAiBoothText(general?.startDate, 32).slice(0, 4);
  return /^\d{4}$/.test(startYear) ? startYear : "";
}

function normalizeAiBoothGolfConfig(value, general = {}) {
  const source = isPlainObject(value) ? value : {};

  return {
    provider: cleanAiBoothText(source.provider, 80) || "slash-golf",
    orgId: cleanAiBoothText(source.orgId, 24) || DEFAULT_SLASH_GOLF_ORG_ID,
    year: cleanAiBoothText(source.year || source.seasonYear, 12) ||
      getAiBoothEventStartYear(general),
    tournamentName: cleanAiBoothText(source.tournamentName || source.name, 180),
    tournId: cleanAiBoothText(source.tournId || source.tournamentId || source.id, 80),
    tour: cleanAiBoothText(source.tour, 40) || DEFAULT_SLASH_GOLF_TOUR,
  };
}

function normalizeAiBoothKnowledgeBase(value) {
  const source = isPlainObject(value) ? value : {};
  const previousDocumentIds = Array.isArray(source.previousDocumentIds) ?
    source.previousDocumentIds
        .map((documentId) => cleanAiBoothText(documentId, 160))
        .filter(Boolean) :
    [];

  return {
    documentId: cleanAiBoothText(source.documentId || source.documentationId, 160),
    documentName: cleanAiBoothText(source.documentName || source.name, 240),
    documentType: cleanAiBoothText(source.documentType || source.type, 40),
    syncStatus: cleanAiBoothText(source.syncStatus, 80),
    syncError: cleanAiBoothText(source.syncError, 1000),
    lastSyncedAt: serializeTimestamp(source.lastSyncedAt),
    lastSyncedBy: isPlainObject(source.lastSyncedBy) ? source.lastSyncedBy : null,
    previousDocumentIds: Array.from(new Set(previousDocumentIds)).slice(0, 10),
  };
}

function normalizeAiBoothAgent(agent, boothStationIds = []) {
  const source = isPlainObject(agent) ? agent : {};

  return {
    templateAgentId: cleanAiBoothText(source.templateAgentId, 160),
    agentId: cleanAiBoothText(source.agentId, 160),
    name: cleanAiBoothText(source.name, 140),
    firstMessage: cleanAiBoothText(source.firstMessage, 1000),
    systemPrompt: cleanAiBoothText(source.systemPrompt, 20000),
    syncStatus: cleanAiBoothText(source.syncStatus, 80),
    syncError: cleanAiBoothText(source.syncError, 1000),
    lastSyncedAt: serializeTimestamp(source.lastSyncedAt),
    lastSyncedBy: isPlainObject(source.lastSyncedBy) ? source.lastSyncedBy : null,
    knowledgeBase: normalizeAiBoothKnowledgeBase(source.knowledgeBase),
    kioskAgents: normalizeAiBoothKioskAgents(source.kioskAgents, boothStationIds),
  };
}

function normalizeAiBoothIntakeSettings(value, existing, eventId, actor) {
  const source = isPlainObject(value) ? value : {};
  const existingSource = isPlainObject(existing) ? existing : {};
  const submittedCode = normalizeAiBoothIntakeCode(
      source.sharedCode || source.accessCode,
  );
  const existingCode = normalizeAiBoothIntakeCode(
      existingSource.sharedCode || existingSource.accessCode,
  );
  const sharedCode = submittedCode || existingCode;
  const existingHash = cleanAiBoothText(existingSource.accessCodeHash, 160);
  const accessCodeHint = cleanAiBoothText(
      source.accessCodeHint || maskAiBoothIntakeCode(sharedCode),
      80,
  ) || cleanAiBoothText(existingSource.accessCodeHint, 80);
  const maxFiles = Number.isFinite(Number(source.maxFiles)) ?
    Math.max(1, Math.min(20, Number(source.maxFiles))) :
    Number(existingSource.maxFiles || DEFAULT_AI_BOOTH_INTAKE_MAX_FILES);
  const maxFileSizeMb = Number.isFinite(Number(source.maxFileSizeMb)) ?
    Math.max(1, Math.min(100, Number(source.maxFileSizeMb))) :
    Number(
        existingSource.maxFileSizeMb ||
        DEFAULT_AI_BOOTH_INTAKE_MAX_FILE_SIZE_MB,
    );
  const patch = {
    enabled: typeof source.enabled === "boolean" ?
      source.enabled :
      existingSource.enabled === true || Boolean(sharedCode),
    sharedCode,
    accessCodeHint,
    instructions: cleanAiBoothText(
        source.instructions || existingSource.instructions,
        1800,
    ),
    closesAt: cleanAiBoothText(source.closesAt || existingSource.closesAt, 80),
    allowEditsAfterSubmit: typeof source.allowEditsAfterSubmit === "boolean" ?
      source.allowEditsAfterSubmit :
      existingSource.allowEditsAfterSubmit !== false,
    maxFiles,
    maxFileSizeMb,
    updatedBy: cleanAiBoothText(actor?.uid || actor?.username, 128),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (submittedCode) {
    patch.accessCodeHash = hashAiBoothIntakeValue(
        "access-code",
        submittedCode,
        eventId,
    );
  } else if (existingHash) {
    patch.accessCodeHash = existingHash;
  } else if (sharedCode) {
    patch.accessCodeHash = hashAiBoothIntakeValue(
        "access-code",
        sharedCode,
        eventId,
    );
  }

  return patch;
}

function serializeAiBoothIntakeSettings(value) {
  const source = isPlainObject(value) ? value : {};
  const sharedCode = normalizeAiBoothIntakeCode(
      source.sharedCode || source.accessCode,
  );

  return {
    enabled: source.enabled === true,
    sharedCode,
    accessCodeConfigured: Boolean(source.accessCodeHash || sharedCode),
    accessCodeHint: cleanAiBoothText(
        source.accessCodeHint || maskAiBoothIntakeCode(sharedCode),
        80,
    ),
    instructions: cleanAiBoothText(source.instructions, 1800),
    closesAt: cleanAiBoothText(source.closesAt, 80),
    allowEditsAfterSubmit: source.allowEditsAfterSubmit !== false,
    maxFiles: Number.isFinite(Number(source.maxFiles)) ?
      Number(source.maxFiles) :
      DEFAULT_AI_BOOTH_INTAKE_MAX_FILES,
    maxFileSizeMb: Number.isFinite(Number(source.maxFileSizeMb)) ?
      Number(source.maxFileSizeMb) :
      DEFAULT_AI_BOOTH_INTAKE_MAX_FILE_SIZE_MB,
    updatedAt: serializeTimestamp(source.updatedAt),
    updatedBy: source.updatedBy || null,
  };
}

function normalizeAiBoothIntakeStatus(value, fallback = "draft") {
  const status = cleanAiBoothText(value, 80).toLowerCase();
  return EVENT_INTAKE_STATUSES.has(status) ? status : fallback;
}

function serializeAiBoothIntakeFile(file) {
  const source = isPlainObject(file) ? file : {};

  return {
    id: cleanAiBoothText(source.id, 160),
    fileName: cleanAiBoothText(source.fileName, 240),
    contentType: cleanAiBoothText(source.contentType || "application/pdf", 80),
    size: Number.isFinite(Number(source.size)) ? Number(source.size) : 0,
    storagePath: cleanAiBoothText(source.storagePath, 1000),
    extractedTextPath: cleanAiBoothText(source.extractedTextPath, 1000),
    extractedTextPreview: cleanAiBoothText(source.extractedTextPreview, 1200),
    extractedTextBytes: Number.isFinite(Number(source.extractedTextBytes)) ?
      Number(source.extractedTextBytes) :
      0,
    extractionStatus: cleanAiBoothText(source.extractionStatus || "pending", 80),
    extractionError: cleanAiBoothText(source.extractionError, 1000),
    uploadedAt: serializeTimestamp(source.uploadedAt),
  };
}

function normalizeAiBoothIntakeLinks(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
      .map((link) => ({
        label: cleanAiBoothText(link?.label, 160),
        url: cleanAiBoothText(link?.url, 1000),
      }))
      .filter((link) => link.label || link.url)
      .slice(0, 20);
}

function canEditAiBoothIntakeSubmission(data) {
  const status = normalizeAiBoothIntakeStatus(data?.status);
  if (status === "under_review" || status === "approved" || status === "rejected") {
    return false;
  }
  return data?.allowEditsAfterSubmit !== false || status !== "submitted";
}

function serializeAiBoothIntakeSubmission(snapshot) {
  const data = typeof snapshot?.data === "function" ? snapshot.data() : snapshot || {};
  const files = Array.isArray(data.files) ?
    data.files.map(serializeAiBoothIntakeFile).filter((file) => file.id) :
    [];

  return {
    id: cleanAiBoothText(snapshot?.id || data.id, 160),
    eventId: cleanAiBoothText(data.eventId, 160),
    targetType: normalizeAiBoothDeploymentType(data.targetType || (data.installId ? "install" : "event")),
    targetId: cleanAiBoothText(data.targetId || data.installId || data.eventId, 160),
    targetTitle: cleanAiBoothText(data.targetTitle || data.eventTitle, 240),
    eventTitle: cleanAiBoothText(data.eventTitle, 240),
    participantName: cleanAiBoothText(data.participantName, 160),
    organization: cleanAiBoothText(data.organization, 200),
    email: cleanAiBoothText(data.email, 200),
    phone: cleanAiBoothText(data.phone, 80),
    role: cleanAiBoothText(data.role, 160),
    category: cleanAiBoothText(data.category, 160),
    notes: cleanAiBoothText(data.notes, 6000),
    links: normalizeAiBoothIntakeLinks(data.links),
    status: normalizeAiBoothIntakeStatus(data.status),
    canEdit: canEditAiBoothIntakeSubmission(data),
    allowEditsAfterSubmit: data.allowEditsAfterSubmit !== false,
    files,
    fileCount: files.length,
    adminNotes: cleanAiBoothText(data.adminNotes, 4000),
    screeningSummary: cleanAiBoothText(data.screeningSummary, 6000),
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
    submittedAt: serializeTimestamp(data.submittedAt),
    reviewedAt: serializeTimestamp(data.reviewedAt),
    reviewedBy: cleanAiBoothText(data.reviewedBy, 200),
  };
}

function serializeTimestamp(value) {
  if (value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return cleanAiBoothText(value, 120);
}

function serializeAiBoothEvent(snapshot) {
  const data = typeof snapshot?.data === "function" ? snapshot.data() : snapshot || {};
  const general = isPlainObject(data.general) ? data.general : {};
  const boothStationIds = Array.isArray(data.boothStationIds) ?
    data.boothStationIds
        .map((value) => cleanAiBoothText(value, 80))
        .filter(Boolean) :
    [];

  return {
    id: String(snapshot?.id || data.id || "").trim(),
    general: {
      eventName: cleanAiBoothText(general.eventName, 140),
      eventCategory: cleanAiBoothText(general.eventCategory, 120),
      open24Hours: general.open24Hours === true,
      phoneChargingEnabled: typeof general.phoneChargingEnabled === "boolean" ?
        general.phoneChargingEnabled :
        DEFAULT_AI_BOOTH_PHONE_CHARGING_ENABLED,
      paymentType: normalizeAiBoothPaymentType(general.paymentType),
      eventInfo: cleanAiBoothText(general.eventInfo || general.basicEventInfo, 8000),
      address: cleanAiBoothText(general.address, 300),
      city: cleanAiBoothText(general.city, 120),
      zipCode: cleanAiBoothText(general.zipCode || general.zip, 32),
      country: normalizeCountry(general.country),
      startDate: cleanAiBoothText(general.startDate, 32),
      endDate: cleanAiBoothText(general.endDate, 32),
      sameHoursEveryDay: general.sameHoursEveryDay === true,
      openingHours: cleanAiBoothText(general.openingHours, 32),
      closingHours: cleanAiBoothText(general.closingHours, 32),
      dailyHours: normalizeAiBoothDailyHours(general.dailyHours),
      rentalPolicy: cleanAiBoothText(general.rentalPolicy, 2000) ||
        DEFAULT_AI_BOOTH_RENTAL_POLICY,
      supportFallback: cleanAiBoothText(general.supportFallback, 240) ||
        DEFAULT_AI_BOOTH_SUPPORT_FALLBACK,
    },
    boothStationIds,
    boothContexts: normalizeAiBoothBoothContexts(data.boothContexts, boothStationIds),
    screenUi: normalizeAiBoothScreenUi(data.screenUi),
    screenUiByStationId: normalizeAiBoothScreenUiByStationId(
        data.screenUiByStationId,
        boothStationIds,
        data.screenUi,
    ),
    topics: Array.isArray(data.topics) ?
      data.topics.map((topic, index) => normalizeAiBoothTopic(topic, index)) :
      [],
    activations: Array.isArray(data.activations) ?
      data.activations.map((activation, index) => normalizeAiBoothActivation(activation, index)) :
      [],
    golf: normalizeAiBoothGolfConfig(data.golf, general),
    intake: serializeAiBoothIntakeSettings(data.intake),
    agent: normalizeAiBoothAgent(data.agent, boothStationIds),
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
    createdBy: isPlainObject(data.createdBy) ? data.createdBy : null,
    updatedBy: isPlainObject(data.updatedBy) ? data.updatedBy : null,
  };
}

function compareAiBoothEvents(left, right) {
  const leftTime = Date.parse(left.updatedAt || left.createdAt || "") || 0;
  const rightTime = Date.parse(right.updatedAt || right.createdAt || "") || 0;

  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return cleanAiBoothText(left?.general?.eventName, 140)
      .localeCompare(cleanAiBoothText(right?.general?.eventName, 140));
}

function sendFunctionError(res, error) {
  const status = Number(error?.httpErrorCode?.status) || 500;
  const code = String(error?.code || "internal");
  const message = error?.message || "Internal error";

  res.status(status).json({
    error: {
      status: code,
      message,
    },
  });
}

function handleHttpFunction(handler, runtimeOptions = null) {
  const builder = runtimeOptions ? functions.runWith(runtimeOptions) : functions;
  return builder.https.onRequest(async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({
        error: {
          status: "method-not-allowed",
          message: "Method not allowed",
        },
      });
      return;
    }

    const data = getRequestData(req);

    try {
      const result = await handler(data, req);
      res.status(200).json({result});
    } catch (error) {
      sendFunctionError(res, error);
    }
  });
}

function cleanProfile(input) {
  const clean = JSON.parse(JSON.stringify(input || {}));
  delete clean.password;
  delete clean.Password;
  delete clean.Email;
  delete clean.email;
  delete clean.token;
  return clean;
}

function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}

function isValidUsername(u) {
  return /^[a-z0-9._-]+$/.test(u);
}

function buildCustomClaimsFromProfile(profile) {
  const source = profile || {};
  const username = normalizeUsername(source.username);
  const clientId = String(source.clientId || "").trim().toUpperCase();
  const role = String(
      source.role || (username === "chargerent" ? "admin" : "user"),
  ).trim().toLowerCase() || "user";
  const rawCommands = source.commands || source.Commands || {};
  const commands = Object.fromEntries(
      Object.entries(rawCommands).map(([key, value]) => [key, value === true]),
  );

  return {
    username,
    clientId,
    role,
    commands,
  };
}

function getAuthClientId(authState) {
  return String(authState?.profile?.clientId || "").trim().toUpperCase();
}

function canAccessMediaAsset(authState, asset) {
  if (!asset) {
    return false;
  }

  if (authState?.isAdmin) {
    return true;
  }

  if (asset.visibility === "global") {
    return true;
  }

  const authClientId = getAuthClientId(authState);
  const ownerClientId = String(asset.ownerClientId || "").trim().toUpperCase();
  return !!authClientId && ownerClientId === authClientId;
}

function canArchiveMediaAsset(authState, asset) {
  if (!asset) {
    return false;
  }

  if (authState?.isAdmin) {
    return true;
  }

  if (asset.visibility === "global") {
    return false;
  }

  return canAccessMediaAsset(authState, asset);
}

function canManageMediaForKiosk(authState, kiosk) {
  if (authState?.isAdmin) {
    return true;
  }

  if (!hasMediaFeature(authState)) {
    return false;
  }

  const authClientId = getAuthClientId(authState);
  if (!authClientId) {
    return false;
  }

  const kioskClient = String(kiosk?.info?.client || kiosk?.info?.clientId || "").trim().toUpperCase();
  const kioskRep = String(kiosk?.info?.rep || "").trim().toUpperCase();
  return kioskClient === authClientId || kioskRep === authClientId;
}

function resolveMediaModeValue(currentMode) {
  const rawMode = String(currentMode || "").trim();

  if (rawMode && rawMode === rawMode.toLowerCase()) {
    return "media";
  }

  return "MEDIA";
}

function serializeFirestoreTimestamp(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function serializeMediaAssetSnapshot(docSnap) {
  const asset = docSnap.data() || {};

  return {
    id: docSnap.id,
    name: String(asset.name || ""),
    contentType: String(asset.contentType || ""),
    kind: String(asset.kind || "other"),
    size: Number(asset.size || 0),
    visibility: String(asset.visibility || "client"),
    ownerClientId: String(asset.ownerClientId || ""),
    bucketName: String(asset.bucketName || ""),
    storagePath: String(asset.storagePath || ""),
    downloadUrl: String(asset.downloadUrl || ""),
    createdByUid: String(asset.createdByUid || ""),
    createdByUsername: String(asset.createdByUsername || ""),
    clientTag: String(asset.clientTag || ""),
    locationTag: String(asset.locationTag || ""),
    active: asset.active !== false,
    createdAt: serializeFirestoreTimestamp(asset.createdAt),
    updatedAt: serializeFirestoreTimestamp(asset.updatedAt),
    targetType: String(asset.targetType || "CK48"),
  };
}

function normalizeMediaTagValue(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function canEditKiosk(authState, kiosk) {
  if (authState.isAdmin) {
    return true;
  }

  const userClientId = String(authState.profile?.clientId || "").trim();
  if (!userClientId) {
    return false;
  }

  const kioskClient = String(kiosk?.info?.client || kiosk?.info?.clientId || "").trim();
  const kioskRep = String(kiosk?.info?.rep || "").trim();
  const canAccessKiosk = kioskClient === userClientId || kioskRep === userClientId;

  if (!canAccessKiosk) {
    return false;
  }

  const commands = authState.profile?.commands || authState.profile?.Commands || {};
  if (commands["client edit"] !== true) {
    return false;
  }

  return true;
}

function canLockKiosk(authState, kiosk) {
  if (authState.isAdmin) {
    return true;
  }

  const userClientId = String(authState.profile?.clientId || "").trim();
  if (!userClientId) {
    return false;
  }

  const kioskClient = String(kiosk?.info?.client || kiosk?.info?.clientId || "").trim();
  const kioskRep = String(kiosk?.info?.rep || "").trim();
  const canAccessKiosk = kioskClient === userClientId || kioskRep === userClientId;

  if (!canAccessKiosk) {
    return false;
  }

  const commands = authState.profile?.commands || authState.profile?.Commands || {};
  if (commands.lock !== true) {
    return false;
  }

  return true;
}

async function syncCustomClaimsForProfile(uid, profile) {
  const claims = buildCustomClaimsFromProfile(profile);
  await admin.auth().setCustomUserClaims(uid, claims);
  return claims;
}

function normalizeCountry(country) {
  const value = String(country || "").trim().toUpperCase();
  if (value === "CA" || value === "CAN" || value === "CANADA") return "CA";
  if (value === "FR" || value === "FRA" || value === "FRANCE" || value === "EUR") return "FR";
  return "US";
}

function normalizeAiBoothPaymentType(paymentType) {
  return String(paymentType || "").trim().toLowerCase() === "stripe" ?
    "stripe" :
    DEFAULT_AI_BOOTH_PAYMENT_TYPE;
}

function prefixForCountry(country) {
  return COUNTRY_PREFIXES[normalizeCountry(country)] || "US";
}

function buildQrUrl(stationid) {
  return `https://chargerent.online/stations/qr?id=${stationid}`;
}

function extractStationId(docSnap) {
  const data = docSnap.data() || {};
  return String(data.stationid || docSnap.id || "").trim().toUpperCase();
}

function buildReservedStationSequenceSet(reservedStationIds, prefix) {
  const reservedNumbers = new Set();

  (reservedStationIds || []).forEach((stationid) => {
    const normalizedStationid = normalizeStationId(stationid);
    const match = normalizedStationid.match(new RegExp(`^${prefix}(\\d{4})$`));
    if (match) {
      reservedNumbers.add(Number(match[1]));
    }
  });

  return reservedNumbers;
}

function normalizeKioskType(value) {
  return String(value || "").trim().toUpperCase();
}

function isAiBoothKioskType(value) {
  return normalizeKioskType(value) === AI_BOOTH_KIOSK_TYPE;
}

function isAiBoothStationId(stationid) {
  return /^(CA|FR|US)9\d{3}$/.test(normalizeStationId(stationid));
}

function getRequestedKioskType(data, stationid = "") {
  const explicitType = normalizeKioskType(
      data?.kioskType || data?.hardwareType || data?.type,
  );
  if (explicitType) {
    return explicitType;
  }

  return isAiBoothStationId(stationid) ? AI_BOOTH_KIOSK_TYPE : "";
}

function getStationSequenceConfig(options = {}) {
  if (options?.aiBooth === true || isAiBoothKioskType(options?.kioskType)) {
    return {
      label: "AI booth",
      start: AI_BOOTH_STATION_SEQUENCE_START,
      maxExclusive: 10000,
    };
  }

  return {
    label: "standard kiosk",
    start: STATION_SEQUENCE_START,
    maxExclusive: AI_BOOTH_STATION_SEQUENCE_START,
  };
}

function findNextStationId(docSnaps, country, reservedStationIds = [], options = {}) {
  const prefix = prefixForCountry(country);
  const sequence = getStationSequenceConfig(options);
  let next = sequence.start;
  const occupiedNumbers = buildReservedStationSequenceSet(
      reservedStationIds,
      prefix,
  );

  docSnaps.forEach((docSnap) => {
    const stationid = extractStationId(docSnap);
    const match = stationid.match(new RegExp(`^${prefix}(\\d{4})$`));
    if (match) {
      const stationNumber = Number(match[1]);
      if (
        stationNumber < sequence.start ||
        (sequence.maxExclusive && stationNumber >= sequence.maxExclusive)
      ) {
        return;
      }
      occupiedNumbers.add(stationNumber);
      next = Math.max(next, stationNumber + 1);
    }
  });

  while (occupiedNumbers.has(next)) {
    next += 1;
  }

  if (sequence.maxExclusive && next >= sequence.maxExclusive) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        `No ${sequence.label} station IDs are available for ${prefix}.`,
    );
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
}

async function getActiveStationReservations(country = "") {
  const requestedCountry = String(country || "").trim();
  const normalizedCountry = requestedCountry ?
    normalizeCountry(requestedCountry) :
    "";
  const snapshot = await db.collection(STATION_RESERVATIONS_COLLECTION).get();
  const reservations = [];

  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const stationid = normalizeStationId(data.stationid || docSnap.id);
    if (!stationid) return;
    if (data.active === false) return;

    const reservationCountry = normalizeCountry(
        data.country || getCountryFromStationId(stationid) || "US",
    );
    if (normalizedCountry && reservationCountry !== normalizedCountry) return;

    reservations.push({
      stationid,
      country: reservationCountry,
      reason: String(data.reason || "").trim(),
      active: true,
      createdAt: data.createdAt || null,
      createdBy: String(data.createdBy || "").trim(),
      updatedAt: data.updatedAt || null,
      updatedBy: String(data.updatedBy || "").trim(),
    });
  });

  reservations.sort((left, right) => left.stationid.localeCompare(right.stationid));
  return reservations;
}

function buildReservedStationIdSet(reservations) {
  return new Set((reservations || []).map((reservation) => reservation.stationid));
}

function buildStationReservationConflictMessage(
    stationid,
    nextStationid,
    reservations,
) {
  const normalizedStationid = normalizeStationId(stationid);
  const reservation = (reservations || []).find(
      (entry) => entry.stationid === normalizedStationid,
  );

  if (reservation) {
    const reasonSuffix = reservation.reason ?
      ` (${reservation.reason})` :
      "";
    return `Station ${normalizedStationid} is reserved${reasonSuffix}. Next station is ${nextStationid}.`;
  }

  return `Station ${normalizedStationid} is no longer available. Next station is ${nextStationid}.`;
}

function extractProvisionId(docSnap) {
  const data = docSnap.data() || {};
  return String(data.provisionid || docSnap.id || "").trim();
}

function findNextProvisionId(docSnaps) {
  let next = Math.floor(Date.now() / 1000);

  docSnaps.forEach((docSnap) => {
    const provisionid = extractProvisionId(docSnap);
    const match = provisionid.match(/^id-(\d{10})$/);
    if (match) {
      next = Math.max(next, Number(match[1]) + 1);
    }
  });

  return `id-${String(next).padStart(10, "0")}`;
}

function normalizeStationId(stationid) {
  return String(stationid || "").trim().toUpperCase();
}

function getCountryFromStationId(stationid) {
  const normalized = normalizeStationId(stationid);
  if (normalized.startsWith("CA")) return "CA";
  if (normalized.startsWith("FR")) return "FR";
  if (normalized.startsWith("US")) return "US";
  return "";
}

function isBindingStationId(stationid, country = "") {
  const normalizedStationid = normalizeStationId(stationid);
  if (!normalizedStationid) return false;

  if (country) {
    const prefix = prefixForCountry(country);
    return new RegExp(`^${prefix}\\d{4}$`).test(normalizedStationid);
  }

  return /^(CA|FR|US)\d{4}$/.test(normalizedStationid);
}

function buildInvalidStationIdMessage(stationid, country = "") {
  const normalizedStationid = normalizeStationId(stationid);
  const prefix = country ? prefixForCountry(country) : "CA, FR, or US";
  const formatSuffix = country ? `${prefix}####` : "CA####, FR####, or US####";
  return `Station ${normalizedStationid} is invalid. Expected format ${formatSuffix}.`;
}

function normalizeModuleId(moduleId) {
  return String(moduleId || "").trim();
}

function isNewSchemaKioskDocument(kiosk) {
  if (!kiosk) return false;
  if (kiosk.isNewSchema === true) return true;

  const hardwareType = String(kiosk?.hardware?.type || "").trim().toUpperCase();
  if (NEW_KIOSK_TYPES.has(hardwareType)) {
    return true;
  }

  const modules = Array.isArray(kiosk?.modules) ? kiosk.modules : [];
  return modules.some((module) => Array.isArray(module?.slots));
}

function moduleIdsMatch(left, right) {
  const leftId = normalizeModuleId(left);
  const rightId = normalizeModuleId(right);

  if (!leftId || !rightId) {
    return false;
  }

  return leftId === rightId ||
    `1000${leftId}` === rightId ||
    leftId === rightId.replace(/^1000/, "");
}

function isV2ModuleId(moduleId) {
  return /^\d{15,}$/.test(normalizeModuleId(moduleId));
}

function collectV2ModuleIds(modules) {
  const ids = new Set();
  const normalizedModules = Array.isArray(modules) ? modules : [];

  normalizedModules.forEach((module) => {
    const moduleId = normalizeModuleId(module?.id);
    if (!isV2ModuleId(moduleId)) {
      return;
    }

    ids.add(moduleId);
  });

  return Array.from(ids);
}

function recalculateKioskTotals(kiosk) {
  const configuredPower = Number(kiosk?.hardware?.power);
  const fullThreshold = Number.isFinite(configuredPower) ?
    configuredPower :
    DEFAULT_KIOSK_POWER_THRESHOLD;
  const modules = Array.isArray(kiosk?.modules) ? kiosk.modules : [];

  let count = 0;
  let slotscount = 0;
  let lockcount = 0;
  let total = 0;
  let full = 0;
  let empty = 0;
  let slot = 0;
  let charging = 0;

  const normalizedModules = modules.map((module) => {
    const slots = Array.isArray(module?.slots) ? module.slots : [];
    const moduleLockCount = slots.reduce(
        (sum, entry) => sum + (entry?.lock ? 1 : 0),
        0,
    );

    slotscount += slots.length;
    lockcount += moduleLockCount;

    slots.forEach((entry) => {
      const status = Number(entry?.status);
      const batteryLevel = Number(entry?.batteryLevel);
      const chargingCurrent = Number(
          entry?.chargingCurrent ?? entry?.chargeCurrent ?? 0,
      );
      const hasCharger = status === 1 && Number(entry?.sn) !== 0;

      if (status === 1) total += 1;
      if (status === 0) slot += 1;
      if (chargingCurrent > 0) charging += 1;

      if (!hasCharger) return;

      if (batteryLevel >= fullThreshold) {
        full += 1;
        if (!entry?.lock) count += 1;
      } else {
        empty += 1;
      }
    });

    return {
      ...module,
      lock: moduleLockCount,
    };
  });

  const nextKiosk = {
    ...kiosk,
    modules: normalizedModules,
    count,
    slotscount,
    lockcount,
    zerocount: Number(kiosk?.zerocount || 0),
    chargers: count === 0 ? "soldout" : count,
    total,
    full,
    empty,
    slot,
    charging,
  };

  const moduleIds = collectV2ModuleIds(normalizedModules);
  if (moduleIds.length > 0) {
    nextKiosk.moduleIds = moduleIds;
  }

  return nextKiosk;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function buildStorageDownloadUrl(storagePath, downloadToken, bucketName = STORAGE_BUCKET) {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`
  );
}

function getKioskInfoAddress(info) {
  return String(info?.address || info?.stationaddress || "").trim();
}

function normalizeKioskInfoForSchema(info, useAddressField = false) {
  const normalizedInfo = clonePlain(info) || {};
  const address = getKioskInfoAddress(normalizedInfo);

  if (useAddressField) {
    delete normalizedInfo.stationaddress;
    normalizedInfo.address = address;
    return normalizedInfo;
  }

  delete normalizedInfo.address;
  normalizedInfo.stationaddress = address;
  return normalizedInfo;
}

function getGoogleMapsApiKey() {
  return String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
}

async function geocodeKioskAddress(info) {
  const address = getKioskInfoAddress(info);
  const city = String(info?.city || "").trim();
  const state = String(info?.state || "").trim();
  const zip = String(info?.zip || "").trim();
  const country = String(info?.country || "").trim();

  if (!address || !city) {
    return null;
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    console.warn("Google Maps API key is not configured; skipping geocode");
    return null;
  }

  const addressString = [address, city, state, zip, country]
      .filter(Boolean)
      .join(", ");
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?" +
    `address=${encodeURIComponent(addressString)}&key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Geocoding request failed (${response.status})`);
    }

    const payload = await response.json();
    if (payload.status === "OK" && payload.results?.[0]?.geometry?.location) {
      return {
        lat: payload.results[0].geometry.location.lat,
        lon: payload.results[0].geometry.location.lng,
      };
    }

    console.warn("Geocoding request did not return coordinates", {
      status: payload.status,
      error: payload.error_message || null,
    });
    return null;
  } catch (error) {
    console.error("Geocoding request failed", error);
    return null;
  }
}

function hasAddressChanged(existingInfo, nextInfo) {
  return (
    getKioskInfoAddress(nextInfo) !== getKioskInfoAddress(existingInfo) ||
    String(nextInfo?.city || "").trim() !== String(existingInfo?.city || "").trim() ||
    String(nextInfo?.state || "").trim() !== String(existingInfo?.state || "").trim() ||
    String(nextInfo?.zip || "").trim() !== String(existingInfo?.zip || "").trim()
  );
}

async function kioskUpdateSectionImpl(data, authState) {
  const section = String(data?.section || "").trim().toLowerCase();
  const stationid = normalizeStationId(data?.stationid);
  const kioskPatch = clonePlain(data?.kiosk) || {};
  const autoGeocode = data?.autoGeocode === true;
  const requestId = String(data?.requestId || "").trim();
  const allowedSections = new Set(["info", "wifi", "formoptions", "marketingoptions", "analyticsoptions", "hardware", "pricing", "ui", "media"]);

  if (!stationid) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "stationid required",
    );
  }

  if (!allowedSections.has(section)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "section must be one of info, wifi, formoptions, marketingoptions, analyticsoptions, hardware, pricing, ui, media",
      );
  }

  if (!kioskPatch || typeof kioskPatch !== "object") {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "kiosk payload required",
    );
  }

  if (!Object.prototype.hasOwnProperty.call(kioskPatch, section)) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        `kiosk.${section} payload required`,
    );
  }

  console.info("kioskUpdateSection.request", {
    stationid,
    section,
    requestId: requestId || null,
    uid: authState?.uid || null,
    autoGeocode,
    patchKeys: Object.keys(kioskPatch[section] || {}),
    wifiName: section === "wifi" ? String(kioskPatch?.wifi?.name || "") : null,
    wifiPasswordLength: section === "wifi" && typeof kioskPatch?.wifi?.password === "string" ?
      kioskPatch.wifi.password.length :
      null,
  });

  const snapshot = await db.collection("kiosks")
      .where("stationid", "==", stationid)
      .limit(1)
      .get();

  if (snapshot.empty) {
    throw new functions.https.HttpsError(
        "not-found",
        `Kiosk ${stationid} not found.`,
    );
  }

  const docRef = snapshot.docs[0].ref;

  return db.runTransaction(async (transaction) => {
    const liveSnap = await transaction.get(docRef);
    if (!liveSnap.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          `Kiosk ${stationid} no longer exists.`,
      );
    }

    const liveKiosk = liveSnap.data() || {};
    if (!canEditKiosk(authState, liveKiosk)) {
      throw new functions.https.HttpsError(
          "permission-denied",
          "Not allowed to edit this kiosk.",
      );
    }

    if (!isNewSchemaKioskDocument(liveKiosk)) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `${stationid} is not a V2 kiosk.`,
      );
    }

    let nextSectionValue = clonePlain(kioskPatch[section]);
    if (!nextSectionValue || typeof nextSectionValue !== "object") {
      throw new functions.https.HttpsError(
          "invalid-argument",
          `${section} payload must be an object`,
      );
    }

    if (section === "info") {
      nextSectionValue = normalizeKioskInfoForSchema(nextSectionValue, true);
    }

    if (section === "marketingoptions") {
      nextSectionValue = normalizeMarketingOptions(nextSectionValue);
    }

    if (section === "media") {
      nextSectionValue = normalizeMediaOptions(nextSectionValue);
    }

    const mergedKiosk = {
      ...clonePlain(liveKiosk),
      [section]: nextSectionValue,
    };

    if (typeof kioskPatch?.status === "string" && kioskPatch.status.trim()) {
      mergedKiosk.status = kioskPatch.status.trim();
    }

    let geocoded = false;
    if (section === "info" && autoGeocode && hasAddressChanged(liveKiosk.info, mergedKiosk.info)) {
      const coordinates = await geocodeKioskAddress(mergedKiosk.info);
      if (coordinates) {
        mergedKiosk.info = {
          ...mergedKiosk.info,
          lat: coordinates.lat,
          lon: coordinates.lon,
        };
        geocoded = true;
      }
    }

    const recalculatedKiosk = recalculateKioskTotals(mergedKiosk);
    const updateData = {
      [section]: clonePlain(recalculatedKiosk[section]) || {},
      count: Number(recalculatedKiosk.count || 0),
      slotscount: Number(recalculatedKiosk.slotscount || 0),
      lockcount: Number(recalculatedKiosk.lockcount || 0),
      zerocount: Number(recalculatedKiosk.zerocount || 0),
      chargers: recalculatedKiosk.chargers,
      total: Number(recalculatedKiosk.total || 0),
      full: Number(recalculatedKiosk.full || 0),
      empty: Number(recalculatedKiosk.empty || 0),
      slot: Number(recalculatedKiosk.slot || 0),
      charging: Number(recalculatedKiosk.charging || 0),
    };

    if (Object.prototype.hasOwnProperty.call(recalculatedKiosk, "moduleIds")) {
      updateData.moduleIds = clonePlain(recalculatedKiosk.moduleIds) || [];
    }

    if (typeof recalculatedKiosk.status === "string" && recalculatedKiosk.status.trim()) {
      updateData.status = recalculatedKiosk.status.trim();
    }

    console.info("kioskUpdateSection.write", {
      stationid,
      section,
      requestId: requestId || null,
      uid: authState?.uid || null,
      updateKeys: Object.keys(updateData),
      wifiName: section === "wifi" ? String(updateData?.wifi?.name || "") : null,
      wifiPasswordLength: section === "wifi" && typeof updateData?.wifi?.password === "string" ?
        updateData.wifi.password.length :
        null,
    });

    transaction.set(docRef, updateData, {merge: true});

    const message = geocoded ?
      `${section} updated for ${stationid}. Address geocoded.` :
      `${section} updated for ${stationid}.`;

    console.info("kioskUpdateSection.success", {
      stationid,
      section,
      requestId: requestId || null,
      uid: authState?.uid || null,
      geocoded,
      wifiName: section === "wifi" ? String(updateData?.wifi?.name || "") : null,
      wifiPasswordLength: section === "wifi" && typeof updateData?.wifi?.password === "string" ?
        updateData.wifi.password.length :
        null,
    });

    return {
      ok: true,
      stationid,
      section,
      requestId: requestId || null,
      geocoded,
      message,
      kiosk: {
        ...recalculatedKiosk,
        ...updateData,
      },
    };
  });
}

async function kioskUpdateSlotLockImpl(data, authState) {
  const stationid = normalizeStationId(data?.stationid);
  const moduleId = normalizeModuleId(data?.moduleid || data?.moduleId);
  const slotid = Number(data?.slotid ?? data?.slot);
  const requestId = String(data?.requestId || "").trim();
  const action = String(data?.action || "").trim().toLowerCase();
  const lockReasonInput = String(data?.lockReason ?? data?.info ?? "").trim();
  let explicitLock = null;

  if (typeof data?.locked === "boolean") {
    explicitLock = data.locked;
  } else if (action === "lock slot") {
    explicitLock = true;
  } else if (action === "unlock slot") {
    explicitLock = false;
  }

  if (!stationid) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "stationid required",
    );
  }

  if (!moduleId) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "moduleid required",
    );
  }

  if (!Number.isFinite(slotid)) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "slotid must be numeric",
    );
  }

  const snapshot = await db.collection("kiosks")
      .where("stationid", "==", stationid)
      .limit(1)
      .get();

  if (snapshot.empty) {
    throw new functions.https.HttpsError(
        "not-found",
        `Kiosk ${stationid} not found.`,
    );
  }

  const docRef = snapshot.docs[0].ref;

  return db.runTransaction(async (transaction) => {
    const liveSnap = await transaction.get(docRef);
    if (!liveSnap.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          `Kiosk ${stationid} no longer exists.`,
      );
    }

    const liveKiosk = liveSnap.data() || {};
    if (!canLockKiosk(authState, liveKiosk)) {
      throw new functions.https.HttpsError(
          "permission-denied",
          "Not allowed to lock this kiosk.",
      );
    }

    if (!isNewSchemaKioskDocument(liveKiosk)) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `${stationid} is not a V2 kiosk.`,
      );
    }

    const nextKiosk = clonePlain(liveKiosk) || {};
    const modules = Array.isArray(nextKiosk.modules) ? nextKiosk.modules : [];
    const targetModule = modules.find((module) => moduleIdsMatch(module?.id, moduleId));

    if (!targetModule) {
      throw new functions.https.HttpsError(
          "not-found",
          `Module ${moduleId} not found on ${stationid}.`,
      );
    }

    const slots = Array.isArray(targetModule.slots) ? targetModule.slots : [];
    const targetSlot = slots.find((slot) => Number(slot?.position) === slotid);

    if (!targetSlot) {
      throw new functions.https.HttpsError(
          "not-found",
          `Slot ${slotid} not found on module ${moduleId}.`,
      );
    }

    const nextLocked = explicitLock === null ? !targetSlot.lock : explicitLock;
    const nextLockReason = nextLocked ?
      (lockReasonInput || String(targetSlot.lockReason || "").trim()) :
      "";

    targetSlot.lock = nextLocked;
    if (nextLocked) {
      targetSlot.lockReason = nextLockReason;
    } else {
      delete targetSlot.lockReason;
    }

    const recalculatedKiosk = recalculateKioskTotals(nextKiosk);
    const updateData = {
      modules: clonePlain(recalculatedKiosk.modules) || [],
      count: Number(recalculatedKiosk.count || 0),
      slotscount: Number(recalculatedKiosk.slotscount || 0),
      lockcount: Number(recalculatedKiosk.lockcount || 0),
      zerocount: Number(recalculatedKiosk.zerocount || 0),
      chargers: recalculatedKiosk.chargers,
      total: Number(recalculatedKiosk.total || 0),
      full: Number(recalculatedKiosk.full || 0),
      empty: Number(recalculatedKiosk.empty || 0),
      slot: Number(recalculatedKiosk.slot || 0),
      charging: Number(recalculatedKiosk.charging || 0),
    };

    if (Object.prototype.hasOwnProperty.call(recalculatedKiosk, "moduleIds")) {
      updateData.moduleIds = clonePlain(recalculatedKiosk.moduleIds) || [];
    }
    const writeData = {
      ...updateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    transaction.set(docRef, writeData, {merge: true});

    return {
      ok: true,
      stationid,
      moduleid: targetModule.id,
      slotid,
      locked: nextLocked,
      lockReason: nextLocked ? nextLockReason : "",
      requestId: requestId || null,
      message: nextLocked ?
        `Slot ${slotid} locked on ${stationid}.` :
        `Slot ${slotid} unlocked on ${stationid}.`,
      kiosk: {
        ...recalculatedKiosk,
        ...updateData,
      },
    };
  });
}

async function mediaListAssetsImpl(authState, data = {}) {
  const includeArchived = data?.includeArchived === true;
  const snapshot = await db.collection("mediaAssets")
      .orderBy("createdAt", "desc")
      .get();

  const assets = snapshot.docs
      .map((docSnap) => serializeMediaAssetSnapshot(docSnap))
      .filter((asset) => canAccessMediaAsset(authState, asset))
      .filter((asset) => includeArchived || asset.active !== false);

  return {assets};
}

async function mediaCreateUploadUrlImpl(data, authState, req = null) {
  const fileName = String(data?.fileName || "").trim();
  const contentType = String(data?.contentType || "").trim().toLowerCase();
  const size = Number(data?.size || 0);
  const requestedVisibility = String(data?.visibility || "").trim().toLowerCase();

  if (!fileName) {
    throw new functions.https.HttpsError("invalid-argument", "fileName required");
  }

  if (!isSupportedMediaContentType(contentType)) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Only image, video, and PDF uploads are supported",
    );
  }

  if (!Number.isFinite(size) || size <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "size must be a positive number");
  }

  if (size > MAX_MEDIA_UPLOAD_BYTES) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        `Uploads must be ${MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024)} MB or smaller`,
    );
  }

  const assetId = db.collection("mediaAssets").doc().id;
  const visibility = authState.isAdmin && requestedVisibility === "global" ? "global" : "client";
  const storagePath = `dashboard-media/${visibility}/${assetId}/${sanitizeFileName(fileName)}`;
  const expiresAt = Date.now() + (15 * 60 * 1000);
  let uploadUrl = "";
  let uploadMode = "signed";
  let bucketName = STORAGE_BUCKET;
  let lastError = null;

  for (const candidateBucketName of getStorageBucketCandidates()) {
    const bucket = getStorageBucket(candidateBucketName);
    const file = bucket.file(storagePath);

    try {
      [uploadUrl] = await file.getSignedUrl({
        version: "v4",
        action: "write",
        expires: expiresAt,
        contentType,
      });
      bucketName = candidateBucketName;
      uploadMode = "signed";
      break;
    } catch (error) {
      lastError = error;
      console.error("mediaCreateUploadUrl.getSignedUrlFailed", {
        bucket: candidateBucketName,
        storagePath,
        contentType,
        uid: authState?.uid || null,
        code: error?.code || null,
        message: error?.message || String(error),
      });

      try {
        const resumableOptions = {
          metadata: {
            contentType,
          },
        };
        const origin = String(req?.headers?.origin || "").trim();
        if (origin) {
          resumableOptions.origin = origin;
        }

        [uploadUrl] = await file.createResumableUpload(resumableOptions);
        bucketName = candidateBucketName;
        uploadMode = "resumable";
        lastError = null;
        break;
      } catch (resumableError) {
        lastError = resumableError;
        console.error("mediaCreateUploadUrl.createResumableUploadFailed", {
          bucket: candidateBucketName,
          storagePath,
          contentType,
          uid: authState?.uid || null,
          code: resumableError?.code || null,
          message: resumableError?.message || String(resumableError),
        });
      }
    }
  }

  if (!uploadUrl) {
    throw new functions.https.HttpsError(
        "internal",
        lastError?.message || "Unable to create upload URL",
    );
  }

  return {
    assetId,
    storagePath,
    uploadUrl,
    uploadMode,
    bucketName,
    expiresAt: new Date(expiresAt).toISOString(),
    visibility,
  };
}

async function mediaFinalizeUploadImpl(data, authState) {
  const assetId = String(data?.assetId || "").trim();
  const fileName = String(data?.fileName || "").trim();
  const storagePath = String(data?.storagePath || "").trim();
  const requestedBucketName = String(data?.bucketName || "").trim();
  const contentTypeInput = String(data?.contentType || "").trim().toLowerCase();
  const sizeInput = Number(data?.size || 0);
  const requestedVisibility = String(data?.visibility || "").trim().toLowerCase();
  const clientTag = normalizeMediaTagValue(data?.clientTag, 160);
  const locationTag = normalizeMediaTagValue(data?.locationTag, 160);

  if (!assetId || !fileName || !storagePath) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "assetId, fileName, and storagePath are required",
    );
  }

  if (!clientTag || !locationTag) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "clientTag and locationTag are required",
    );
  }

  if (!storagePath.startsWith("dashboard-media/") || !storagePath.includes(`/${assetId}/`)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid storagePath");
  }

  let file = null;
  let metadata = null;
  let resolvedBucketName = "";

  for (const candidateBucketName of getStorageBucketCandidates(requestedBucketName)) {
    const candidateFile = getStorageBucket(candidateBucketName).file(storagePath);
    const [exists] = await candidateFile.exists();
    if (!exists) {
      continue;
    }

    file = candidateFile;
    resolvedBucketName = candidateBucketName;
    [metadata] = await candidateFile.getMetadata();
    break;
  }

  if (!file || !metadata) {
    throw new functions.https.HttpsError("not-found", "Uploaded file not found");
  }
  const contentType = String(metadata?.contentType || contentTypeInput || "").trim().toLowerCase();
  if (!isSupportedMediaContentType(contentType)) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        "Uploaded file must be an image, video, or PDF",
    );
  }

  const visibility = authState.isAdmin && requestedVisibility === "global" ? "global" : "client";
  const downloadToken = crypto.randomUUID();
  await file.setMetadata({
    contentType,
    cacheControl: "public,max-age=3600",
    metadata: {
      ...(metadata?.metadata || {}),
      firebaseStorageDownloadTokens: downloadToken,
    },
  });

  const assetRef = db.collection("mediaAssets").doc(assetId);
  const assetData = {
    name: fileName,
    storagePath,
    contentType,
    kind: detectMediaKind(contentType),
    size: Number(metadata?.size || sizeInput || 0),
    visibility,
    ownerClientId: visibility === "global" ? "" : getAuthClientId(authState),
    createdByUid: authState.uid,
    createdByUsername: normalizeUsername(authState.profile?.username),
    clientTag,
    locationTag,
    bucketName: resolvedBucketName,
    downloadUrl: buildStorageDownloadUrl(storagePath, downloadToken, resolvedBucketName),
    active: true,
    targetType: "CK48",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await assetRef.set(assetData, {merge: true});
  const savedSnap = await assetRef.get();

  return {
    ok: true,
    asset: serializeMediaAssetSnapshot(savedSnap),
  };
}

async function mediaArchiveAssetImpl(data, authState) {
  const assetId = String(data?.assetId || "").trim();
  if (!assetId) {
    throw new functions.https.HttpsError("invalid-argument", "assetId required");
  }

  const assetRef = db.collection("mediaAssets").doc(assetId);
  const assetSnap = await assetRef.get();
  if (!assetSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Asset not found");
  }

  const asset = serializeMediaAssetSnapshot(assetSnap);
  if (!canArchiveMediaAsset(authState, asset)) {
    throw new functions.https.HttpsError("permission-denied", "Not allowed to archive this asset");
  }

  await assetRef.set({
    active: false,
    archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    archivedByUid: authState.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {ok: true, assetId};
}

async function mediaDeleteAssetImpl(data, authState) {
  const assetId = String(data?.assetId || "").trim();
  if (!assetId) {
    throw new functions.https.HttpsError("invalid-argument", "assetId required");
  }

  const assetRef = db.collection("mediaAssets").doc(assetId);
  const assetSnap = await assetRef.get();
  if (!assetSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Asset not found");
  }

  const asset = serializeMediaAssetSnapshot(assetSnap);
  if (!canArchiveMediaAsset(authState, asset)) {
    throw new functions.https.HttpsError("permission-denied", "Not allowed to delete this asset");
  }

  const assignedKioskSnapshot = await db.collection("kiosks")
      .where("media.assetIds", "array-contains", assetId)
      .get();

  const updatedStationIds = [];
  let batch = db.batch();
  let writesInBatch = 0;
  const timestamp = new Date().toISOString();

  for (const docSnap of assignedKioskSnapshot.docs) {
    const kiosk = docSnap.data() || {};
    if (!canManageMediaForKiosk(authState, kiosk)) {
      throw new functions.https.HttpsError(
          "permission-denied",
          `Not allowed to update kiosk ${kiosk.stationid || docSnap.id}`,
      );
    }

    const existingMedia = clonePlain(kiosk.media) || {};
    const nextAssetIds = Array.isArray(existingMedia.assetIds) ?
      existingMedia.assetIds
          .map((value) => String(value || "").trim())
          .filter((value) => value && value !== assetId) :
      [];
    const nextPlaylist = Array.isArray(existingMedia.playlist) ?
      existingMedia.playlist
          .filter((item) => String(item?.assetId || "").trim() !== assetId)
          .map((item, index) => ({
            ...(clonePlain(item) || {}),
            order: index + 1,
          })) :
      [];

    const nextMedia = nextAssetIds.length > 0 ? {
      ...existingMedia,
      active: existingMedia.active !== false && nextPlaylist.length > 0,
      assetIds: nextAssetIds,
      playlist: nextPlaylist,
      updatedAt: timestamp,
      updatedByUid: authState.uid,
      updatedByUsername: normalizeUsername(authState.profile?.username),
    } : {
      ...DEFAULT_MEDIA_OPTIONS,
      active: false,
      updatedAt: timestamp,
      updatedByUid: authState.uid,
      updatedByUsername: normalizeUsername(authState.profile?.username),
      clearedAt: timestamp,
    };

    batch.set(docSnap.ref, {media: nextMedia}, {merge: true});
    writesInBatch += 1;
    updatedStationIds.push(normalizeStationId(kiosk.stationid || docSnap.id));

    if (writesInBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      writesInBatch = 0;
    }
  }

  if (writesInBatch > 0) {
    await batch.commit();
  }

  if (asset.storagePath) {
    const bucketCandidates = getStorageBucketCandidates(asset.bucketName);
    let deletedStorageObject = false;

    for (const bucketName of bucketCandidates) {
      try {
        await getStorageBucket(bucketName).file(asset.storagePath).delete({ignoreNotFound: true});
        deletedStorageObject = true;
        break;
      } catch (error) {
        console.error("mediaDeleteAsset.deleteStorageFailed", {
          assetId,
          bucket: bucketName,
          storagePath: asset.storagePath,
          message: error?.message || String(error),
        });
      }
    }

    if (!deletedStorageObject) {
      console.warn("mediaDeleteAsset.storageObjectNotDeleted", {
        assetId,
        storagePath: asset.storagePath,
      });
    }
  }

  await assetRef.delete();

  return {
    ok: true,
    assetId,
    removedFromStations: updatedStationIds.length,
    updatedStationIds,
  };
}

async function mediaAssignPlaylistImpl(data, authState) {
  const requestedStationIds = Array.isArray(data?.stationids) ? data.stationids : [];
  const stationids = Array.from(new Set(
      requestedStationIds
          .map((value) => normalizeStationId(value))
          .filter(Boolean),
  ));
  const requestedAssetIds = Array.isArray(data?.assetIds) ? data.assetIds : [];
  const assetIds = Array.from(new Set(
      requestedAssetIds
          .map((value) => String(value || "").trim())
          .filter(Boolean),
  ));
  const active = data?.active !== false && assetIds.length > 0;
  const loop = data?.loop !== false;
  const setUiMode = data?.setUiMode !== false;

  if (stationids.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "stationids required");
  }

  const assetDocsById = new Map();
  if (assetIds.length > 0) {
    for (const assetId of assetIds) {
      const assetSnap = await db.collection("mediaAssets").doc(assetId).get();
      if (!assetSnap.exists) {
        throw new functions.https.HttpsError("not-found", `Asset ${assetId} not found`);
      }

      const asset = serializeMediaAssetSnapshot(assetSnap);
      if (!canAccessMediaAsset(authState, asset)) {
        throw new functions.https.HttpsError(
            "permission-denied",
            `Not allowed to use asset ${assetId}`,
        );
      }
      if (asset.active === false) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            `Asset ${asset.name || assetId} is archived`,
        );
      }

      assetDocsById.set(assetId, asset);
    }
  }

  const playlist = assetIds.map((assetId, index) => {
    const asset = assetDocsById.get(assetId);
    return {
      assetId,
      order: index + 1,
      name: asset?.name || "",
      kind: asset?.kind || "other",
      contentType: asset?.contentType || "",
      size: Number(asset?.size || 0),
      downloadUrl: asset?.downloadUrl || "",
      storagePath: asset?.storagePath || "",
    };
  });

  const kioskDocsByStationId = new Map();
  for (const chunk of chunkArray(stationids, 10)) {
    const kioskSnapshot = await db.collection("kiosks")
        .where("stationid", "in", chunk)
        .get();

    kioskSnapshot.docs.forEach((docSnap) => {
      const kiosk = docSnap.data() || {};
      kioskDocsByStationId.set(normalizeStationId(kiosk.stationid), docSnap);
    });
  }

  const failures = [];
  const validUpdates = [];

  stationids.forEach((stationid) => {
    const docSnap = kioskDocsByStationId.get(stationid);
    if (!docSnap) {
      failures.push({stationid, reason: "Kiosk not found"});
      return;
    }

    const kiosk = docSnap.data() || {};
    if (!canManageMediaForKiosk(authState, kiosk)) {
      failures.push({stationid, reason: "Not allowed to manage this kiosk"});
      return;
    }

    if (!isNewSchemaKioskDocument(kiosk) ||
        String(kiosk?.hardware?.type || "").trim().toUpperCase() !== "CK48") {
      failures.push({stationid, reason: "Only V2 CK48 kiosks are supported"});
      return;
    }

    validUpdates.push({stationid, docSnap, kiosk});
  });

  if (validUpdates.length === 0) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        failures[0]?.reason || "No eligible kiosks selected",
    );
  }

  const updatedStationIds = [];
  let batch = db.batch();
  let writesInBatch = 0;
  const timestamp = new Date().toISOString();

  for (const entry of validUpdates) {
    const nextMedia = active ? {
      active: true,
      loop,
      assetIds,
      playlist,
      targetType: "CK48",
      updatedAt: timestamp,
      updatedByUid: authState.uid,
      updatedByUsername: normalizeUsername(authState.profile?.username),
      assignedAt: timestamp,
    } : {
      ...DEFAULT_MEDIA_OPTIONS,
      active: false,
      updatedAt: timestamp,
      updatedByUid: authState.uid,
      updatedByUsername: normalizeUsername(authState.profile?.username),
      clearedAt: timestamp,
    };

    const updateData = {media: nextMedia};
    if (active && setUiMode) {
      updateData.ui = {
        ...(clonePlain(entry.kiosk.ui) || {}),
        mode: resolveMediaModeValue(entry.kiosk?.ui?.mode),
      };
    }

    batch.set(entry.docSnap.ref, updateData, {merge: true});
    writesInBatch += 1;
    updatedStationIds.push(entry.stationid);

    if (writesInBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      writesInBatch = 0;
    }
  }

  if (writesInBatch > 0) {
    await batch.commit();
  }

  return {
    ok: true,
    updatedCount: updatedStationIds.length,
    updatedStationIds,
    failures,
    assetCount: assetIds.length,
    active,
    setUiMode,
  };
}

const DEFAULT_BOUND_KIOSK_INFO_BY_COUNTRY = {
  US: {
    location: "HQ",
    place: "OFFICE",
    locationtype: "HQ",
    address: "4514 Conchita Way",
    city: "Tarzana",
    state: "CA",
    zip: "91356-4904",
    group: "OCHARGELLC",
    lat: 34.1526589,
    lon: -118.5588832,
  },
  FR: {
    location: "PARIS HQ",
    place: "OFFICE",
    locationtype: "HQ",
    address: "212 RUE DE RIVOLI",
    city: "PARIS",
    state: "FR",
    zip: "75001",
    group: "OCHARGELLC",
    lat: 48.8648056,
    lon: 2.3298865,
  },
  CA: {
    location: "CANADA HQ",
    place: "OFFICE 2",
    locationtype: "OFFICE",
    address: "700 THIRD LINE",
    city: "OAKVILLE",
    state: "ON",
    zip: "L6L 4B1.",
    group: "OCHARGELLC",
    lat: 43.4203071,
    lon: -79.7213897,
  },
};

function getDefaultCurrencyConfig(country) {
  const normalizedCountry = normalizeCountry(country);
  if (normalizedCountry === "FR") {
    return {currency: "EUR", symbol: "€"};
  }
  if (normalizedCountry === "CA") {
    return {currency: "CAN", symbol: "$"};
  }
  return {currency: "US", symbol: "$"};
}

function getDefaultBoundKioskInfo(country) {
  const normalizedCountry = normalizeCountry(country);
  const countryDefaults = DEFAULT_BOUND_KIOSK_INFO_BY_COUNTRY[normalizedCountry] ||
    DEFAULT_BOUND_KIOSK_INFO_BY_COUNTRY.US;

  const info = {
    location: "",
    place: "",
    locationtype: "event",
    city: "",
    state: "",
    zip: "",
    country: normalizedCountry,
    lat: null,
    lon: null,
    autoGeocode: true,
    client: "BESITER",
    account: "",
    group: "",
    rep: "",
    accountpercent: 0,
    reppercent: 0,
    address: "",
    ...countryDefaults,
  };

  info.country = normalizedCountry;
  info.address = countryDefaults.address || "";

  return info;
}

function mergeDefinedProvisionFields(target, source) {
  const next = isPlainObject(target) ? {...target} : {};
  const input = isPlainObject(source) ? source : {};

  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (typeof value === "string" && value.trim() === "") {
      return;
    }

    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = mergeDefinedProvisionFields(next[key], value);
      return;
    }

    next[key] = value;
  });

  return next;
}

function getDefaultBoundKioskHardware(templateKiosk = null, kioskType = "") {
  const templateHardware = clonePlain(templateKiosk?.hardware) || {};
  const normalizedKioskType = normalizeKioskType(kioskType);
  const hardware = {
    gateway: "",
    gatewayoptions: "",
    quarantine: {
      time: 0,
      unit: "min",
    },
    audio: "on",
    ...templateHardware,
  };
  const configuredPower = Number(templateHardware?.power);

  hardware.quarantine = {
    time: Number(templateHardware?.quarantine?.time || 0),
    unit: String(templateHardware?.quarantine?.unit || "min").trim() || "min",
  };
  hardware.power = Number.isFinite(configuredPower) ?
    configuredPower :
    DEFAULT_KIOSK_POWER_THRESHOLD;

  if (normalizedKioskType) {
    hardware.type = normalizedKioskType;
  } else {
    delete hardware.type;
  }

  return hardware;
}

function createBoundKioskDocument({
  provisionid,
  stationid,
  moduleId,
  country,
  actorUid,
  moduleData = null,
  templateKiosk = null,
  kioskType = "",
}) {
  const normalizedCountry = normalizeCountry(country);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const {currency, symbol} = getDefaultCurrencyConfig(normalizedCountry);
  const initialModule = moduleData ? {
    ...clonePlain(moduleData),
    id: moduleId,
  } : {
    id: moduleId,
    total: 0,
    full: 0,
    slot: 0,
    empty: 0,
    lock: 0,
    slots: [],
    lastUpdated: null,
    charging: 0,
  };

  const templateWifi = clonePlain(templateKiosk?.wifi) || {};

  const kiosk = {
    stationid,
    provisionid,
    active: true,
    enabled: true,
    status: "PENDING",
    timestamp: null,
    lastUpdate: null,
    info: getDefaultBoundKioskInfo(normalizedCountry),
    wifi: {
      name: String(templateWifi?.name || "chargerent").trim() || "chargerent",
      password: String(templateWifi?.password || "Charger33").trim() || "Charger33",
    },
    formoptions: {
      active: templateKiosk?.formoptions?.active === true,
    },
    marketingoptions: normalizeMarketingOptions(templateKiosk?.marketingoptions),
    analyticsoptions: {
      active: templateKiosk?.analyticsoptions?.active === true || DEFAULT_ANALYTICS_OPTIONS.active,
    },
    hardware: getDefaultBoundKioskHardware(templateKiosk, kioskType),
    pricing: clonePlain(templateKiosk?.pricing) || {
      authamount: 0,
      dailyprice: 0,
      initialperiod: 24,
      buyprice: 0,
      taxrate: 0,
      overdue: 30,
      profile: "DEFAULT",
      kioskmode: "PURCHASE",
      webapp: true,
      mobileapp: true,
      text: "PURCHASE - SIMPLE DAILY",
      rate: [
        {time: 1440, price: 0},
        {time: 2880, price: 0},
        {time: 4320, price: 0},
      ],
      currency,
      symbol,
    },
    modules: [initialModule],
    vendslot: String(templateKiosk?.vendslot || "0.1"),
    total: 0,
    full: 0,
    slot: 0,
    empty: 0,
    charging: 0,
    count: 0,
    slotscount: 0,
    lockcount: 0,
    zerocount: 0,
    chargers: "soldout",
    binding: {
      state: "bound",
      boundAt: timestamp,
      boundBy: actorUid,
    },
    updatedAt: timestamp,
    createdAt: timestamp,
  };

  return recalculateKioskTotals(kiosk);
}

function normalizeAiBoothProvisionId(value) {
  const provisionid = cleanAiBoothText(value, 32).toLowerCase();
  return /^aid-\d{10,13}$/.test(provisionid) ? provisionid : "";
}

function hashAiBoothDeviceSecret(value) {
  const secret = cleanAiBoothText(value, 256);
  if (secret.length < 24) {
    return "";
  }

  return crypto.createHash("sha256").update(secret).digest("hex");
}

function buildPendingAiBoothRegistrationDocument({
  provisionid,
  deviceSecretHash,
  appVersion = "",
  platform = "",
  hostname = "",
  existingData = {},
}) {
  const nowIso = new Date().toISOString();
  const registrationSource = isPlainObject(existingData.registration) ?
    existingData.registration :
    {};

  return {
    provisionid,
    status: "pending-provision",
    active: false,
    enabled: false,
    source: "ai-booth-electron",
    timestamp: nowIso,
    lastUpdated: nowIso,
    kioskType: AI_BOOTH_KIOSK_TYPE,
    hardware: {
      ...(isPlainObject(existingData.hardware) ? existingData.hardware : {}),
      type: AI_BOOTH_KIOSK_TYPE,
      mode: "AI",
      modules: 12,
      screen: "49",
      audio: existingData.hardware?.audio || "on",
      power: existingData.hardware?.power || DEFAULT_KIOSK_POWER_THRESHOLD,
    },
    info: {
      country: "US",
      autoGeocode: true,
      location: "",
      place: "",
      address: "",
      stationaddress: "",
      city: "",
      state: "",
      zip: "",
      locationtype: "EVENT",
      client: "",
      account: "",
      group: "",
      rep: "",
      ...(isPlainObject(existingData.info) ? existingData.info : {}),
    },
    pricing: isPlainObject(existingData.pricing) ? existingData.pricing : {
      currency: "US",
      symbol: "$",
      kioskmode: "LEASE",
      text: "EVENT - SIMPLE",
      authamount: 0,
      dailyprice: 0,
      buyprice: 0,
      taxrate: 0,
      initialperiod: 24,
      overdue: 30,
      profile: "AI-BOOTH",
      online: true,
      webapp: false,
      mobileapp: false,
      rate: [],
    },
    ui: isPlainObject(existingData.ui) ? existingData.ui : {
      colors: {
        bcolor1: "#000000",
        bcolor2: "#38bdf8",
      },
      idletime: 20,
      defaultlanguage: "ENGLISH",
      mode: "media",
    },
    modules: isPlainObject(existingData.modules) ? existingData.modules : {},
    registration: {
      ...registrationSource,
      deviceSecretHash,
      appVersion: cleanAiBoothText(appVersion, 80),
      platform: cleanAiBoothText(platform, 80),
      hostname: cleanAiBoothText(hostname, 160),
      firstSeen: registrationSource.firstSeen || admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    },
    createdAt: existingData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function aiBoothsRegisterPendingKioskImpl(data) {
  const provisionid = normalizeAiBoothProvisionId(data?.provisionid);
  const deviceSecretHash = hashAiBoothDeviceSecret(data?.deviceSecret);

  if (!provisionid) {
    throw new functions.https.HttpsError("invalid-argument", "valid aid provisionid required");
  }

  if (!deviceSecretHash) {
    throw new functions.https.HttpsError("invalid-argument", "valid device secret required");
  }

  const docRef = db.collection("kiosks").doc(provisionid);

  await db.runTransaction(async (transaction) => {
    const docSnap = await transaction.get(docRef);
    const existingData = docSnap.exists ? docSnap.data() || {} : {};
    const existingStatus = cleanAiBoothText(existingData.status, 80).toLowerCase();
    const existingSecretHash = cleanAiBoothText(existingData.registration?.deviceSecretHash, 128);

    if (docSnap.exists && existingStatus && existingStatus !== "pending-provision") {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `${provisionid} is already provisioned.`,
      );
    }

    if (existingSecretHash && existingSecretHash !== deviceSecretHash) {
      throw new functions.https.HttpsError(
          "permission-denied",
          `${provisionid} belongs to another device.`,
      );
    }

    transaction.set(docRef, buildPendingAiBoothRegistrationDocument({
      provisionid,
      deviceSecretHash,
      appVersion: data?.appVersion,
      platform: data?.platform,
      hostname: data?.hostname,
      existingData,
    }), {merge: true});
  });

  return {
    ok: true,
    provisionid,
    message: `${provisionid} added to the AI booth pending list.`,
  };
}

async function aiBoothsDeletePendingKioskRegistrationImpl(data) {
  const provisionid = normalizeAiBoothProvisionId(data?.provisionid);
  const deviceSecretHash = hashAiBoothDeviceSecret(data?.deviceSecret);

  if (!provisionid) {
    throw new functions.https.HttpsError("invalid-argument", "valid aid provisionid required");
  }

  if (!deviceSecretHash) {
    throw new functions.https.HttpsError("invalid-argument", "valid device secret required");
  }

  const docRef = db.collection("kiosks").doc(provisionid);

  await db.runTransaction(async (transaction) => {
    const docSnap = await transaction.get(docRef);
    if (!docSnap.exists) {
      return;
    }

    const existingData = docSnap.data() || {};
    const existingStatus = cleanAiBoothText(existingData.status, 80).toLowerCase();
    const existingSecretHash = cleanAiBoothText(existingData.registration?.deviceSecretHash, 128);

    if (existingStatus !== "pending-provision") {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `${provisionid} is not pending provisioning.`,
      );
    }

    if (existingSecretHash && existingSecretHash !== deviceSecretHash) {
      throw new functions.https.HttpsError(
          "permission-denied",
          `${provisionid} belongs to another device.`,
      );
    }

    transaction.delete(docRef);
  });

  return {
    ok: true,
    provisionid,
    message: `${provisionid} deleted from the AI booth pending list.`,
  };
}

function buildProvisionedAiBoothKioskDocument({
  provisionid,
  stationid,
  country,
  actorUid,
  existingData = {},
  kioskInput = {},
}) {
  const normalizedCountry = normalizeCountry(country);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const {currency, symbol} = getDefaultCurrencyConfig(normalizedCountry);
  const defaultInfo = getDefaultBoundKioskInfo(normalizedCountry);
  const submittedInfo = isPlainObject(kioskInput.info) ? kioskInput.info : {};
  const existingInfo = isPlainObject(existingData.info) ? existingData.info : {};
  const mergedInfo = mergeDefinedProvisionFields(
      {
        ...defaultInfo,
        stationaddress: defaultInfo.address,
        account: defaultInfo.account || "OCHARGELLC",
        rep: normalizedCountry === "CA" ? "WADE" : "OCHARGELLC",
      },
      existingInfo,
  );
  const provisionInfo = mergeDefinedProvisionFields(mergedInfo, submittedInfo);
  if (String(provisionInfo.locationtype || "").trim().toUpperCase() === "EVENT") {
    provisionInfo.locationtype = defaultInfo.locationtype;
  }
  const info = normalizeKioskInfoForSchema(
      {
        ...provisionInfo,
        country: normalizedCountry,
      },
      true,
  );

  const existingHardware = isPlainObject(existingData.hardware) ? existingData.hardware : {};
  const submittedHardware = isPlainObject(kioskInput.hardware) ? kioskInput.hardware : {};
  const hardware = mergeDefinedProvisionFields(
      {
        type: AI_BOOTH_KIOSK_TYPE,
        mode: "AI",
        modules: 12,
        screen: "49",
        hrate: "20",
        cpu: "C4",
        gateway: "PAYTERP68",
        gatewayoptions: "INITIALPRICE",
        port: "1884",
        server: "chargerent.io",
        audio: "on",
        power: DEFAULT_KIOSK_POWER_THRESHOLD,
        quarantine: {time: 0, unit: "min"},
      },
      existingHardware,
  );
  Object.assign(hardware, mergeDefinedProvisionFields(hardware, submittedHardware));
  hardware.type = AI_BOOTH_KIOSK_TYPE;
  hardware.mode = "AI";
  hardware.modules = Number(hardware.modules || 12);
  hardware.screen = String(hardware.screen || "49").trim() || "49";
  delete hardware.modversion;

  const existingPricing = isPlainObject(existingData.pricing) ? existingData.pricing : {};
  const submittedPricing = isPlainObject(kioskInput.pricing) ? kioskInput.pricing : {};
  const pricing = mergeDefinedProvisionFields(
      {
        currency,
        symbol,
        kioskmode: "LEASE",
        text: "EVENT - SIMPLE",
        authamount: 0,
        dailyprice: 0,
        buyprice: 0,
        taxrate: 0,
        initialperiod: 24,
        overdue: 30,
        profile: "AI-BOOTH",
        online: true,
        webapp: false,
        mobileapp: false,
        rate: [],
      },
      existingPricing,
  );
  Object.assign(pricing, mergeDefinedProvisionFields(pricing, submittedPricing));

  const existingUi = isPlainObject(existingData.ui) ? existingData.ui : {};
  const submittedUi = isPlainObject(kioskInput.ui) ? kioskInput.ui : {};
  const ui = mergeDefinedProvisionFields(existingUi, submittedUi);
  const registration = isPlainObject(existingData.registration) ? existingData.registration : {};
  const modules = Array.isArray(kioskInput.modules) ?
    kioskInput.modules :
    (Array.isArray(existingData.modules) ? existingData.modules : []);
  const nextKiosk = {
    ...existingData,
    ...clonePlain(kioskInput),
    provisionid,
    stationid,
    active: true,
    enabled: true,
    status: "PENDING",
    source: existingData.source || "ai-booth-electron",
    kioskType: AI_BOOTH_KIOSK_TYPE,
    info,
    hardware,
    pricing,
    ui,
    modules,
    total: 0,
    full: 0,
    slot: 0,
    empty: 0,
    charging: 0,
    count: 0,
    slotscount: 0,
    lockcount: 0,
    zerocount: 0,
    chargers: "soldout",
    binding: {
      state: "bound",
      boundAt: timestamp,
      boundBy: actorUid,
    },
    registration: {
      ...registration,
      provisionedAt: timestamp,
      provisionedBy: actorUid,
    },
    updatedAt: timestamp,
    createdAt: existingData.createdAt || timestamp,
  };

  return recalculateKioskTotals(nextKiosk);
}

async function aiBoothsProvisionPendingKioskImpl(data, authState) {
  const provisionid = normalizeAiBoothProvisionId(data?.provisionid || data?.kiosk?.provisionid);
  const stationid = normalizeStationId(data?.stationid || data?.kiosk?.stationid);
  const country = normalizeCountry(
      data?.country ||
      data?.kiosk?.info?.country ||
      getCountryFromStationId(stationid),
  );
  const stationCountry = getCountryFromStationId(stationid);

  if (!provisionid) {
    throw new functions.https.HttpsError("invalid-argument", "valid aid provisionid required");
  }

  if (!stationid) {
    throw new functions.https.HttpsError("invalid-argument", "stationid required");
  }

  if (!isBindingStationId(stationid, country) || stationCountry !== country) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        buildInvalidStationIdMessage(stationid, country),
    );
  }

  if (!isAiBoothStationId(stationid)) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "AI booth station IDs must use the 9000 sequence.",
    );
  }

  const docRef = db.collection("kiosks").doc(provisionid);
  const reservationRef = db.collection(STATION_RESERVATIONS_COLLECTION).doc(stationid);
  const kioskInput = clonePlain(data?.kiosk) || {};

  return db.runTransaction(async (transaction) => {
    const [docSnap, existingStationSnap, reservationSnap] = await Promise.all([
      transaction.get(docRef),
      transaction.get(
          db.collection("kiosks").where("stationid", "==", stationid).limit(1),
      ),
      transaction.get(reservationRef),
    ]);

    if (!docSnap.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          `${provisionid} is not in the AI booth pending list.`,
      );
    }

    const existingData = docSnap.data() || {};
    const existingStatus = cleanAiBoothText(existingData.status, 80).toLowerCase();

    if (existingStatus !== "pending-provision") {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `${provisionid} is not pending provisioning.`,
      );
    }

    const stationConflict = existingStationSnap.docs.find((stationDoc) => stationDoc.id !== provisionid);
    if (stationConflict) {
      throw new functions.https.HttpsError(
          "already-exists",
          `Station ${stationid} already exists.`,
      );
    }

    const reservationData = reservationSnap.exists ? reservationSnap.data() || {} : {};
    if (reservationSnap.exists && reservationData.active !== false) {
      throw new functions.https.HttpsError(
          "failed-precondition",
          `Station ${stationid} is reserved.`,
      );
    }

    const nextKiosk = buildProvisionedAiBoothKioskDocument({
      provisionid,
      stationid,
      country,
      actorUid: authState.uid,
      existingData,
      kioskInput,
    });

    transaction.set(docRef, nextKiosk, {merge: true});

    return {
      ok: true,
      provisionid,
      stationid,
      status: "PENDING",
      qrUrl: buildQrUrl(stationid),
      message: "AI booth provisioned on server",
    };
  });
}

async function getAiBoothRuntimeConfigForStation(stationid) {
  const stationId = normalizeStationId(stationid);
  if (!stationId) {
    return {
      stationId: "",
      stationid: "",
      eventId: "",
      eventName: "",
      agentId: "",
      agentName: "",
      agentSyncStatus: "",
      knowledgeBaseDocumentId: "",
      knowledgeBaseDocumentName: "",
      eventUpdatedAt: "",
      agentUpdatedAt: "",
      screenUiUpdatedAt: "",
      configVersion: "",
      screenUi: normalizeAiBoothScreenUi(),
    };
  }

  const [eventSnapshot, installSnapshot, screenUiSnapshot] = await Promise.all([
    db.collection(AI_BOOTH_EVENTS_COLLECTION)
        .where("boothStationIds", "array-contains", stationId)
        .get(),
    db.collection(AI_BOOTH_INSTALLS_COLLECTION)
        .where("boothStationIds", "array-contains", stationId)
        .get(),
    db.collection("aiBoothScreenUi").doc(stationId).get(),
  ]);
  const events = eventSnapshot.docs
      .map((docSnapshot) => serializeAiBoothEvent(docSnapshot))
      .sort(compareAiBoothEvents);
  const installs = installSnapshot.docs
      .map((docSnapshot) => serializeAiBoothEvent(docSnapshot))
      .sort(compareAiBoothEvents);
  const screenUiData = screenUiSnapshot.exists ? screenUiSnapshot.data() || {} : {};
  const screenUiDeploymentType = cleanAiBoothText(screenUiData.deploymentType, 40);
  const screenUiDeploymentId = cleanAiBoothText(screenUiData.deploymentId || screenUiData.installId || screenUiData.eventId, 160);
  const screenUiMatchedEvent = events.find((item) => item.id === screenUiDeploymentId);
  const screenUiMatchedInstall = installs.find((item) => item.id === screenUiDeploymentId);
  const event = screenUiDeploymentType === "install" ?
    (screenUiMatchedInstall || installs[0] || events[0] || null) :
    (screenUiMatchedEvent || events[0] || screenUiMatchedInstall || installs[0] || null);
  const deploymentType = event && installs.some((item) => item.id === event.id) ? "install" : "event";
  const deploymentId = cleanAiBoothText(event?.id || screenUiDeploymentId, 160);
  const eventId = deploymentType === "event" ? deploymentId : "";
  const installId = deploymentType === "install" ? deploymentId : "";
  const screenUiTopics = Array.isArray(screenUiData.topics) ?
    screenUiData.topics.map(normalizeAiBoothScreenTopic) :
    Array.isArray(event?.topics) ?
      event.topics.map(normalizeAiBoothScreenTopic) :
      [];
  const screenUi = {
    ...normalizeAiBoothScreenUi(screenUiData.screenUi || event?.screenUi),
    topics: screenUiTopics,
  };
  const stationIds = Array.isArray(event?.boothStationIds) ? event.boothStationIds : [];
  const agentConfig = normalizeAiBoothAgent(event?.agent, stationIds);
  const kioskAgent = normalizeAiBoothKioskAgent(agentConfig.kioskAgents?.[stationId]);
  const knowledgeBase = normalizeAiBoothKnowledgeBase(agentConfig.knowledgeBase);
  const agentId = kioskAgent.agentId || agentConfig.agentId;
  const agentUpdatedAt = kioskAgent.lastSyncedAt || agentConfig.lastSyncedAt;
  const screenUiUpdatedAt = serializeTimestamp(screenUiData.updatedAt);
  const eventUpdatedAt = event?.updatedAt || event?.createdAt || "";
  const configVersion = [
    stationId,
    deploymentType,
    deploymentId,
    eventUpdatedAt,
    agentId,
    agentUpdatedAt,
    screenUiUpdatedAt,
  ].filter(Boolean).join("|");

  return {
    stationId,
    stationid: stationId,
    eventId,
    installId,
    deploymentType,
    deploymentId,
    eventName: cleanAiBoothText(event?.general?.eventName, 140),
    installName: deploymentType === "install" ? cleanAiBoothText(event?.general?.eventName, 140) : "",
    agentId,
    agentName: kioskAgent.name || agentConfig.name,
    agentSyncStatus: kioskAgent.syncStatus || agentConfig.syncStatus,
    knowledgeBaseDocumentId: knowledgeBase.documentId,
    knowledgeBaseDocumentName: knowledgeBase.documentName,
    eventUpdatedAt,
    agentUpdatedAt,
    screenUiUpdatedAt,
    configVersion,
    screenUi,
  };
}

async function aiBoothsGetDeviceConfigImpl(data) {
  const provisionid = normalizeAiBoothProvisionId(data?.provisionid);
  const deviceSecretHash = hashAiBoothDeviceSecret(data?.deviceSecret);

  if (!provisionid) {
    throw new functions.https.HttpsError("invalid-argument", "valid aid provisionid required");
  }

  if (!deviceSecretHash) {
    throw new functions.https.HttpsError("invalid-argument", "valid device secret required");
  }

  const docSnapshot = await db.collection("kiosks").doc(provisionid).get();
  if (!docSnapshot.exists) {
    throw new functions.https.HttpsError(
        "not-found",
        `${provisionid} is not registered.`,
    );
  }

  const kiosk = docSnapshot.data() || {};
  const existingSecretHash = cleanAiBoothText(kiosk.registration?.deviceSecretHash, 128);
  if (!existingSecretHash || existingSecretHash !== deviceSecretHash) {
    throw new functions.https.HttpsError(
        "permission-denied",
        `${provisionid} belongs to another device.`,
    );
  }

  const status = cleanAiBoothText(kiosk.status, 80);
  const normalizedStatus = status.toLowerCase();
  const stationId = normalizeStationId(kiosk.stationid);

  if (normalizedStatus === "pending-provision" || !stationId) {
    return {
      ok: true,
      state: "pending",
      provisionid,
      stationId: "",
      stationid: "",
      status: status || "pending-provision",
      active: kiosk.active === true,
      enabled: kiosk.enabled === true,
      runtimeReady: false,
    };
  }

  const runtimeConfig = await getAiBoothRuntimeConfigForStation(stationId);

  return {
    ok: true,
    state: "provisioned",
    provisionid,
    status,
    active: kiosk.active === true,
    enabled: kiosk.enabled !== false,
    kioskType: cleanAiBoothText(kiosk.kioskType || kiosk.hardware?.type, 80),
    runtimeReady: Boolean(runtimeConfig.agentId),
    ...runtimeConfig,
  };
}

function buildAiBoothDeviceRuntimeChecks({
  reportedEventId,
  reportedDeploymentId,
  reportedAgentId,
  reportedConfigVersion,
  serverReady,
  pageLoaded,
  runtimeConfig,
}) {
  const expectedDeploymentId = cleanAiBoothText(runtimeConfig?.deploymentId || runtimeConfig?.eventId || runtimeConfig?.installId, 160);
  const reportedTargetId = cleanAiBoothText(reportedDeploymentId || reportedEventId, 160);
  const expectedAgentId = cleanAiBoothText(runtimeConfig?.agentId, 160);
  const expectedConfigVersion = cleanAiBoothText(runtimeConfig?.configVersion, 1000);

  return {
    eventAssigned: Boolean(expectedDeploymentId),
    eventMatches: Boolean(expectedDeploymentId && reportedTargetId === expectedDeploymentId),
    agentSynced: Boolean(expectedAgentId && runtimeConfig?.agentSyncStatus === "synced"),
    agentMatches: Boolean(expectedAgentId && reportedAgentId === expectedAgentId),
    configCurrent: Boolean(expectedConfigVersion && reportedConfigVersion === expectedConfigVersion),
    serverReady: serverReady === true,
    pageLoaded: pageLoaded === true,
  };
}

function getAiBoothFailedRuntimeChecks(checks) {
  return Object.entries(checks || {})
      .filter(([, value]) => value !== true)
      .map(([key]) => key);
}

async function aiBoothsDeviceHeartbeatImpl(data) {
  const provisionid = normalizeAiBoothProvisionId(data?.provisionid);
  const deviceSecretHash = hashAiBoothDeviceSecret(data?.deviceSecret);

  if (!provisionid) {
    throw new functions.https.HttpsError("invalid-argument", "valid aid provisionid required");
  }

  if (!deviceSecretHash) {
    throw new functions.https.HttpsError("invalid-argument", "valid device secret required");
  }

  const docRef = db.collection("kiosks").doc(provisionid);
  const docSnapshot = await docRef.get();
  if (!docSnapshot.exists) {
    throw new functions.https.HttpsError(
        "not-found",
        `${provisionid} is not registered.`,
    );
  }

  const kiosk = docSnapshot.data() || {};
  const existingSecretHash = cleanAiBoothText(kiosk.registration?.deviceSecretHash, 128);
  if (!existingSecretHash || existingSecretHash !== deviceSecretHash) {
    throw new functions.https.HttpsError(
        "permission-denied",
        `${provisionid} belongs to another device.`,
    );
  }

  const stationId = normalizeStationId(kiosk.stationid || data?.stationId || data?.stationid);
  const reportedEventId = cleanAiBoothText(data?.eventId, 160);
  const reportedDeploymentId = cleanAiBoothText(data?.deploymentId || data?.installId, 160);
  const reportedAgentId = cleanAiBoothText(data?.agentId, 160);
  const reportedConfigVersion = cleanAiBoothText(data?.configVersion, 1000);
  const mode = cleanAiBoothText(data?.mode, 40) || (stationId ? "runtime" : "registration");
  const serverReady = data?.serverReady === true;
  const pageLoaded = data?.pageLoaded === true;
  const nowIso = new Date().toISOString();
  const runtimeConfig = stationId ?
    await getAiBoothRuntimeConfigForStation(stationId) :
    null;
  const checks = stationId ?
    buildAiBoothDeviceRuntimeChecks({
      reportedEventId,
      reportedDeploymentId,
      reportedAgentId,
      reportedConfigVersion,
      serverReady,
      pageLoaded,
      runtimeConfig,
    }) :
    {registered: true, stationAssigned: false};
  const failedChecks = getAiBoothFailedRuntimeChecks(checks);
  const runtimeReady = stationId && failedChecks.length === 0;
  const state = runtimeReady ?
    "running" :
    stationId ? "needs-attention" : "registration";

  await docRef.set({
    aiBoothRuntime: {
      state,
      runtimeReady: Boolean(runtimeReady),
      checks,
      failedChecks,
      lastHeartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
      lastHeartbeatAtIso: nowIso,
      provisionid,
      stationId,
      mode,
      appVersion: cleanAiBoothText(data?.appVersion, 80),
      platform: cleanAiBoothText(data?.platform, 80),
      hostname: cleanAiBoothText(data?.hostname, 160),
      pageUrl: cleanAiBoothText(data?.pageUrl, 500),
      lastError: cleanAiBoothText(data?.lastError, 1000),
      kioskMode: data?.kioskMode === true,
      fullscreen: data?.fullscreen === true,
      reportedEventId,
      reportedDeploymentId,
      expectedEventId: cleanAiBoothText(runtimeConfig?.eventId, 160),
      expectedDeploymentId: cleanAiBoothText(runtimeConfig?.deploymentId || runtimeConfig?.eventId || runtimeConfig?.installId, 160),
      deploymentType: cleanAiBoothText(runtimeConfig?.deploymentType, 40),
      reportedAgentId,
      expectedAgentId: cleanAiBoothText(runtimeConfig?.agentId, 160),
      reportedConfigVersion,
      expectedConfigVersion: cleanAiBoothText(runtimeConfig?.configVersion, 1000),
      eventName: cleanAiBoothText(runtimeConfig?.eventName, 140),
      agentName: cleanAiBoothText(runtimeConfig?.agentName, 140),
    },
    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    online: true,
    timestamp: nowIso,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {
    ok: true,
    state,
    runtimeReady: Boolean(runtimeReady),
    checks,
    failedChecks,
    expectedConfigVersion: cleanAiBoothText(runtimeConfig?.configVersion, 1000),
  };
}

async function aiBoothsListEventsImpl() {
  const snapshot = await db.collection(AI_BOOTH_EVENTS_COLLECTION).get();
  const events = snapshot.docs
      .map((docSnapshot) => serializeAiBoothEvent(docSnapshot))
      .sort(compareAiBoothEvents);

  return {events};
}

async function aiBoothsListInstallsImpl() {
  const snapshot = await db.collection(AI_BOOTH_INSTALLS_COLLECTION).get();
  const installs = snapshot.docs
      .map((docSnapshot) => ({
        ...serializeAiBoothEvent(docSnapshot),
        deploymentType: "install",
      }))
      .sort(compareAiBoothEvents);

  return {installs};
}

function getSlashGolfRapidApiKey() {
  let secretValue = "";
  try {
    secretValue = typeof SLASH_GOLF_RAPIDAPI_KEY.value === "function" ?
      SLASH_GOLF_RAPIDAPI_KEY.value() :
      "";
  } catch {
    secretValue = "";
  }

  const apiKey = cleanAiBoothText(
      secretValue ||
      process.env.SLASH_GOLF_RAPIDAPI_KEY ||
      process.env.SLASH_GOLF_API_KEY ||
      process.env.RAPIDAPI_KEY,
      400,
  );

  if (!apiKey) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        "Slash Golf RapidAPI key is not configured",
    );
  }

  return apiKey;
}

function firstSlashGolfText(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function firstSlashGolfValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function getSlashGolfArrayPayload(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function findSlashGolfScheduleRows(payload, depth = 0) {
  if (!payload || depth > 3) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload;
  }

  const directRows = getSlashGolfArrayPayload(payload, [
    "schedule",
    "schedules",
    "events",
    "tournaments",
    "results",
    "data",
  ]);
  if (directRows.length > 0) {
    return directRows;
  }

  if (isPlainObject(payload)) {
    for (const value of Object.values(payload)) {
      const nestedRows = findSlashGolfScheduleRows(value, depth + 1);
      if (nestedRows.length > 0) {
        return nestedRows;
      }
    }
  }

  return [];
}

function parseSlashGolfDateMillis(value) {
  if (Number.isFinite(value)) {
    return Number(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  if (value.$date !== undefined) {
    return parseSlashGolfDateMillis(value.$date);
  }
  if (value.$numberLong !== undefined) {
    return parseSlashGolfDateMillis(value.$numberLong);
  }
  return null;
}

function formatSlashGolfIsoDate(value) {
  const millis = parseSlashGolfDateMillis(value);
  if (!Number.isFinite(millis)) {
    return cleanAiBoothText(value, 40);
  }
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizeSlashGolfTournament(row = {}, fallbackYear = "", orgId = DEFAULT_SLASH_GOLF_ORG_ID) {
  const date = isPlainObject(row.date) ? row.date : {};
  const tournId = firstSlashGolfText(row, ["tournId", "tournamentId", "id"]);
  const name = firstSlashGolfText(row, ["name", "tournamentName", "eventName"]);
  const startDate = formatSlashGolfIsoDate(
      firstSlashGolfValue(date, ["startDate", "start", "firstRoundDate", "startMs"]) ||
      firstSlashGolfValue(row, ["startDate", "start", "firstRoundDate", "startMs", "date"]),
  );
  const endDate = formatSlashGolfIsoDate(
      firstSlashGolfValue(date, ["endDate", "end", "finalRoundDate", "endMs"]) ||
      firstSlashGolfValue(row, ["endDate", "end", "finalRoundDate", "endMs"]),
  );

  return {
    provider: "slash-golf",
    orgId,
    tournId,
    year: firstSlashGolfText(row, ["year", "seasonYear"]) || fallbackYear,
    name,
    startDate,
    endDate,
    weekNumber: firstSlashGolfValue(date, ["weekNumber"]) ?? firstSlashGolfValue(row, ["weekNumber"]),
    tour: firstSlashGolfText(row, ["tour"]) || DEFAULT_SLASH_GOLF_TOUR,
    course:
      firstSlashGolfText(row, ["course", "courseName"]) ||
      firstSlashGolfText(row?.courses?.[0], ["course", "courseName", "name"]),
    city: firstSlashGolfText(row, ["city"]),
    state: firstSlashGolfText(row, ["state", "province"]),
    country: firstSlashGolfText(row, ["country"]),
  };
}

async function aiBoothsListSlashGolfTournamentsImpl(data = {}) {
  const apiKey = getSlashGolfRapidApiKey();
  const year = cleanAiBoothText(data?.year, 12) || String(new Date().getFullYear());
  const orgId = cleanAiBoothText(data?.orgId, 24) || DEFAULT_SLASH_GOLF_ORG_ID;
  const search = cleanAiBoothText(data?.search, 120).toLowerCase();
  const apiBaseUrl = cleanAiBoothText(process.env.SLASH_GOLF_API_BASE_URL, 240) ||
    DEFAULT_SLASH_GOLF_API_BASE_URL;
  const apiHost = cleanAiBoothText(process.env.SLASH_GOLF_API_HOST, 160) ||
    DEFAULT_SLASH_GOLF_API_HOST;
  const url = new URL("/schedule", apiBaseUrl);
  url.searchParams.set("orgId", orgId);
  url.searchParams.set("year", year);

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": apiHost,
      "x-rapidapi-key": apiKey,
    },
  });
  const responseText = await response.text();
  let payload = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = {message: responseText};
    }
  }

  if (!response.ok) {
    throw new functions.https.HttpsError(
        "internal",
        payload?.message || `Slash Golf schedule request failed (${response.status})`,
    );
  }

  const tournaments = findSlashGolfScheduleRows(payload)
      .map((row) => normalizeSlashGolfTournament(row, year, orgId))
      .filter((row) => row.tournId && row.name)
      .filter((row) => !search || row.name.toLowerCase().includes(search));

  return {
    ok: true,
    provider: "slash-golf",
    year,
    orgId,
    count: tournaments.length,
    tournaments,
  };
}

function intakeSubmissionSortTime(submission) {
  return Date.parse(
      submission.updatedAt ||
      submission.submittedAt ||
      submission.createdAt ||
      "",
  ) || 0;
}

async function _assertAiBoothEventExists(eventId) {
  const normalizedEventId = cleanAiBoothText(eventId, 160)
      .replace(/[^a-zA-Z0-9_-]/g, "");
  if (!normalizedEventId) {
    throw new functions.https.HttpsError("invalid-argument", "eventId is required");
  }

  const eventSnapshot = await db.collection(AI_BOOTH_EVENTS_COLLECTION)
      .doc(normalizedEventId)
      .get();
  if (!eventSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "AI booth event not found");
  }

  return normalizedEventId;
}

function normalizeAiBoothDeploymentType(value) {
  return cleanAiBoothText(value, 40).toLowerCase() === "install" ? "install" : "event";
}

function getAiBoothDeploymentCollection(targetType) {
  return normalizeAiBoothDeploymentType(targetType) === "install" ?
    AI_BOOTH_INSTALLS_COLLECTION :
    AI_BOOTH_EVENTS_COLLECTION;
}

async function assertAiBoothDeploymentExists(targetId, targetType = "event") {
  const normalizedTargetId = cleanAiBoothText(targetId, 160)
      .replace(/[^a-zA-Z0-9_-]/g, "");
  const normalizedTargetType = normalizeAiBoothDeploymentType(targetType);
  if (!normalizedTargetId) {
    throw new functions.https.HttpsError("invalid-argument", "targetId is required");
  }

  const snapshot = await db.collection(getAiBoothDeploymentCollection(normalizedTargetType))
      .doc(normalizedTargetId)
      .get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError("not-found", "AI booth deployment not found");
  }

  return {
    targetId: normalizedTargetId,
    targetType: normalizedTargetType,
    snapshot,
  };
}

async function aiBoothsListIntakeSubmissionsImpl(data) {
  const targetType = normalizeAiBoothDeploymentType(data?.targetType);
  const targetIdInput = data?.targetId || data?.installId || data?.eventId;
  const {targetId} = await assertAiBoothDeploymentExists(targetIdInput, targetType);
  const snapshot = await db.collection(EVENT_INTAKE_SUBMISSIONS_COLLECTION)
      .where(targetType === "install" ? "targetId" : "eventId", "==", targetId)
      .limit(500)
      .get();
  const submissions = snapshot.docs
      .map((docSnapshot) => serializeAiBoothIntakeSubmission(docSnapshot))
      .filter((submission) => targetType !== "install" || submission.targetType === "install")
      .sort((left, right) => (
        intakeSubmissionSortTime(right) - intakeSubmissionSortTime(left)
      ));

  return {eventId: targetType === "event" ? targetId : "", targetId, targetType, submissions};
}

async function getAiBoothIntakeSubmissionSnapshot(submissionId) {
  const normalizedSubmissionId = cleanAiBoothText(submissionId, 160)
      .replace(/[^a-zA-Z0-9_-]/g, "");
  if (!normalizedSubmissionId) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "submissionId is required",
    );
  }

  const submissionRef = db.collection(EVENT_INTAKE_SUBMISSIONS_COLLECTION)
      .doc(normalizedSubmissionId);
  const submissionSnapshot = await submissionRef.get();
  if (!submissionSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Intake submission not found");
  }

  return {submissionRef, submissionSnapshot};
}

async function aiBoothsUpdateIntakeSubmissionImpl(data, authState) {
  const {submissionRef, submissionSnapshot} =
    await getAiBoothIntakeSubmissionSnapshot(data?.submissionId);
  const existing = submissionSnapshot.data() || {};
  await assertAiBoothDeploymentExists(
      existing.targetId || existing.installId || existing.eventId,
      existing.targetType || (existing.installId ? "install" : "event"),
  );
  const requestedStatus = data?.status === undefined ?
    normalizeAiBoothIntakeStatus(existing.status) :
    normalizeAiBoothIntakeStatus(data.status, "");
  if (!requestedStatus) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Submission status is invalid",
    );
  }

  const actor = cleanAiBoothText(
      authState?.profile?.email ||
      authState?.profile?.username ||
      authState?.uid,
      200,
  );
  const patch = {
    status: requestedStatus,
    adminNotes: data?.adminNotes === undefined ?
      cleanAiBoothText(existing.adminNotes, 4000) :
      cleanAiBoothText(data.adminNotes, 4000),
    screeningSummary: data?.screeningSummary === undefined ?
      cleanAiBoothText(existing.screeningSummary, 6000) :
      cleanAiBoothText(data.screeningSummary, 6000),
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: actor,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (requestedStatus === "approved") {
    patch.approvedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await submissionRef.set(patch, {merge: true});
  const savedSnapshot = await submissionRef.get();
  return {submission: serializeAiBoothIntakeSubmission(savedSnapshot)};
}

async function deleteAiBoothIntakeSubmissionFiles(files) {
  const bucket = getStorageBucket();
  const paths = Array.from(new Set(
      (Array.isArray(files) ? files : [])
          .flatMap((file) => [
            cleanAiBoothText(file?.storagePath, 1000),
            cleanAiBoothText(file?.extractedTextPath, 1000),
          ])
          .filter(Boolean),
  ));

  await Promise.all(paths.map((storagePath) => (
    bucket.file(storagePath).delete({ignoreNotFound: true})
  )));
}

async function aiBoothsDeleteIntakeSubmissionImpl(data) {
  const {submissionRef, submissionSnapshot} =
    await getAiBoothIntakeSubmissionSnapshot(data?.submissionId);
  const existing = submissionSnapshot.data() || {};
  await assertAiBoothDeploymentExists(
      existing.targetId || existing.installId || existing.eventId,
      existing.targetType || (existing.installId ? "install" : "event"),
  );
  await deleteAiBoothIntakeSubmissionFiles(existing.files);
  await submissionRef.delete();

  return {
    deleted: true,
    submissionId: submissionSnapshot.id,
  };
}

function responseDispositionFileName(fileName) {
  return cleanAiBoothText(fileName || "upload.pdf", 240)
      .replace(/["\\\r\n]/g, "_");
}

async function aiBoothsCreateIntakeFileReadUrlImpl(data) {
  const {submissionSnapshot} =
    await getAiBoothIntakeSubmissionSnapshot(data?.submissionId);
  const submission = submissionSnapshot.data() || {};
  await assertAiBoothDeploymentExists(
      submission.targetId || submission.installId || submission.eventId,
      submission.targetType || (submission.installId ? "install" : "event"),
  );
  const fileId = cleanAiBoothText(data?.fileId, 160);
  const text = data?.text === true;
  const files = Array.isArray(submission.files) ? submission.files : [];
  const file = files.find((item) => cleanAiBoothText(item?.id, 160) === fileId);
  if (!file) {
    throw new functions.https.HttpsError("not-found", "Uploaded PDF was not found");
  }

  const storagePath = cleanAiBoothText(
      text ? file.extractedTextPath : file.storagePath,
      1000,
  );
  if (!storagePath) {
    throw new functions.https.HttpsError(
        "not-found",
        text ? "Extracted text is not available" : "Uploaded PDF is not available",
    );
  }

  const [url] = await getStorageBucket().file(storagePath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
    responseDisposition: `inline; filename="${responseDispositionFileName(
        text ? `${file.fileName || "upload.pdf"}.txt` : file.fileName,
    )}"`,
    responseType: text ? "text/plain; charset=utf-8" : "application/pdf",
  });

  return {url, expiresInSeconds: 15 * 60};
}

function buildAiBoothEventKioskInfoUpdate(eventId, general, boothContext, actor, deploymentType = "event") {
  const normalizedDeploymentType = normalizeAiBoothDeploymentType(deploymentType);
  const eventName = cleanAiBoothText(general?.eventName, 140);
  const context = normalizeAiBoothBoothContext(boothContext);
  const place = cleanAiBoothText(context.place || context.locationName || general?.place, 200);
  const address = cleanAiBoothText(general?.address, 300);
  const city = cleanAiBoothText(general?.city, 120);
  const zipCode = cleanAiBoothText(general?.zipCode || general?.zip, 32);
  const country = normalizeCountry(general?.country);
  const latitude = parseAiBoothCoordinate(
      pickAiBoothCoordinateValue(context.latitude, general?.latitude, general?.lat),
      -90,
      90,
  );
  const longitude = parseAiBoothCoordinate(
      pickAiBoothCoordinateValue(
          context.longitude,
          general?.longitude,
          general?.lng,
          general?.lon,
      ),
      -180,
      180,
  );
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  return {
    "info.location": eventName,
    "info.place": place,
    "info.address": address,
    "info.stationaddress": address,
    "info.city": city,
    "info.zip": zipCode,
    "info.country": country,
    "info.lat": latitude,
    "info.lon": longitude,
    "info.locationtype": normalizedDeploymentType === "install" ? "PERMANENT_INSTALL" : "EVENT",
    ...(normalizedDeploymentType === "install" ? {
      "ui.defaultlanguage": "FRENCH",
    } : {}),
    aiBoothEvent: {
      eventId,
      eventName,
      installId: normalizedDeploymentType === "install" ? eventId : "",
      deploymentType: normalizedDeploymentType,
      deploymentId: eventId,
      assignedAt: timestamp,
      assignedBy: actor,
    },
    updatedAt: timestamp,
    updatedBy: actor,
  };
}

async function syncAiBoothEventKioskInfo({
  eventId,
  deploymentType = "event",
  general,
  boothContexts,
  boothStationIds,
  actor,
}) {
  const stationIds = Array.from(new Set(
      (Array.isArray(boothStationIds) ? boothStationIds : [])
          .map((stationId) => cleanAiBoothText(stationId, 80))
          .filter(Boolean),
  ));

  if (stationIds.length === 0) {
    return {updatedStationIds: [], missingStationIds: []};
  }

  const updatedStationIds = [];
  const foundStationIds = new Set();
  const commitPromises = [];
  let batch = db.batch();
  let writes = 0;

  for (const stationChunk of chunkArray(stationIds, 10)) {
    const snapshot = await db.collection("kiosks")
        .where("stationid", "in", stationChunk)
        .get();

    snapshot.docs.forEach((docSnap) => {
      const kiosk = docSnap.data() || {};
      const stationId = cleanAiBoothText(kiosk.stationid || docSnap.id, 80);
      if (!stationId || foundStationIds.has(stationId)) {
        return;
      }

      foundStationIds.add(stationId);
      updatedStationIds.push(stationId);
      const updates = buildAiBoothEventKioskInfoUpdate(
          eventId,
          general,
          boothContexts?.[stationId],
          actor,
          deploymentType,
      );
      batch.update(docSnap.ref, updates);
      writes += 1;

      if (writes >= 450) {
        commitPromises.push(batch.commit());
        batch = db.batch();
        writes = 0;
      }
    });
  }

  if (writes > 0) {
    commitPromises.push(batch.commit());
  }

  await Promise.all(commitPromises);

  return {
    updatedStationIds,
    missingStationIds: stationIds.filter((stationId) => !foundStationIds.has(stationId)),
  };
}

async function aiBoothsSaveEventImpl(data, authState, options = {}) {
  const deploymentType = normalizeAiBoothDeploymentType(options.deploymentType);
  const collectionName = options.collectionName || getAiBoothDeploymentCollection(deploymentType);
  const inputKey = options.inputKey || "event";
  const idKey = options.idKey || "eventId";
  const entityLabel = options.entityLabel || (deploymentType === "install" ? "install" : "event");
  const eventInput = isPlainObject(data?.[inputKey]) ?
    data[inputKey] :
    isPlainObject(data?.event) ? data.event : null;
  if (!eventInput) {
    throw new functions.https.HttpsError("invalid-argument", `${entityLabel} is required`);
  }

  const generalInput = isPlainObject(eventInput.general) ? eventInput.general : {};
  const eventName = cleanAiBoothText(generalInput.eventName, 140);
  if (!eventName) {
    throw new functions.https.HttpsError("invalid-argument", `${entityLabel} name is required`);
  }

  const actor = {
    uid: cleanAiBoothText(authState?.uid, 128),
    username: cleanAiBoothText(authState?.profile?.username, 120),
  };
  const boothStationIds = Array.isArray(eventInput.boothStationIds) ?
    Array.from(new Set(
        eventInput.boothStationIds
            .map((value) => cleanAiBoothText(value, 80))
            .filter(Boolean),
    )).sort() :
    [];
  const topics = Array.isArray(eventInput.topics) ?
    eventInput.topics.map((topic, index) => normalizeAiBoothTopic(topic, index)) :
    [];
  const activations = Array.isArray(eventInput.activations) ?
    eventInput.activations.map((activation, index) => normalizeAiBoothActivation(activation, index)) :
    [];
  const boothContexts = normalizeAiBoothBoothContexts(eventInput.boothContexts, boothStationIds);
  const screenUi = normalizeAiBoothScreenUi(eventInput.screenUi);
  const screenUiByStationId = normalizeAiBoothScreenUiByStationId(
      eventInput.screenUiByStationId,
      boothStationIds,
      screenUi,
  );
  const golf = normalizeAiBoothGolfConfig(eventInput.golf, generalInput);
  const agent = normalizeAiBoothAgent(eventInput.agent, boothStationIds);
  const requestedId = cleanAiBoothText(data?.[idKey] || data?.eventId || eventInput.id, 160)
      .replace(/[^a-zA-Z0-9_-]/g, "");
  const eventRef = requestedId ?
    db.collection(collectionName).doc(requestedId) :
    db.collection(collectionName).doc();
  const existingSnapshot = await eventRef.get();
  const existingData = existingSnapshot.exists ? existingSnapshot.data() || {} : {};
  const previousBoothStationIds = Array.isArray(existingData.boothStationIds) ?
    existingData.boothStationIds
        .map((value) => cleanAiBoothText(value, 80))
        .filter(Boolean) :
    [];
  const intake = normalizeAiBoothIntakeSettings(
      eventInput.intake,
      existingData.intake,
      eventRef.id,
      actor,
  );

  const cleanEvent = {
    deploymentType,
    general: {
      eventName,
      eventCategory: cleanAiBoothText(generalInput.eventCategory, 120),
      open24Hours: generalInput.open24Hours === true,
      phoneChargingEnabled: typeof generalInput.phoneChargingEnabled === "boolean" ?
        generalInput.phoneChargingEnabled :
        DEFAULT_AI_BOOTH_PHONE_CHARGING_ENABLED,
      paymentType: normalizeAiBoothPaymentType(generalInput.paymentType),
      eventInfo: cleanAiBoothText(generalInput.eventInfo || generalInput.basicEventInfo, 8000),
      place: admin.firestore.FieldValue.delete(),
      address: cleanAiBoothText(generalInput.address, 300),
      city: cleanAiBoothText(generalInput.city, 120),
      zipCode: cleanAiBoothText(generalInput.zipCode || generalInput.zip, 32),
      country: normalizeCountry(generalInput.country),
      latitude: admin.firestore.FieldValue.delete(),
      longitude: admin.firestore.FieldValue.delete(),
      startDate: cleanAiBoothText(generalInput.startDate, 32),
      endDate: cleanAiBoothText(generalInput.endDate, 32),
      sameHoursEveryDay: generalInput.sameHoursEveryDay === true,
      openingHours: cleanAiBoothText(generalInput.openingHours, 32),
      closingHours: cleanAiBoothText(generalInput.closingHours, 32),
      dailyHours: normalizeAiBoothDailyHours(generalInput.dailyHours),
      rentalPolicy: cleanAiBoothText(generalInput.rentalPolicy, 2000) ||
        DEFAULT_AI_BOOTH_RENTAL_POLICY,
      supportFallback: cleanAiBoothText(generalInput.supportFallback, 240) ||
        DEFAULT_AI_BOOTH_SUPPORT_FALLBACK,
    },
    boothStationIds,
    boothContexts,
    screenUi,
    screenUiByStationId,
    topics,
    activations,
    golf,
    agent,
    intake,
    boothCount: boothStationIds.length,
    topicCount: topics.length,
    activationCount: activations.length,
    updatedBy: actor,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!existingSnapshot.exists) {
    cleanEvent.createdBy = actor;
    cleanEvent.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await eventRef.set(cleanEvent, {merge: true});

  const screenUiCollection = db.collection("aiBoothScreenUi");
  const screenUiBatch = db.batch();
  const screenUiTopics = topics.map(normalizeAiBoothScreenTopic);
  const currentStationIdSet = new Set(boothStationIds);
  const staleStationIds = Array.from(new Set(previousBoothStationIds))
      .filter((stationId) => !currentStationIdSet.has(stationId));
  const staleSnapshots = await Promise.all(
      staleStationIds.map((stationId) => screenUiCollection.doc(stationId).get()),
  );

  if (!currentStationIdSet.has(eventRef.id)) {
    screenUiBatch.delete(screenUiCollection.doc(eventRef.id));
  }
  boothStationIds.forEach((stationId) => {
    screenUiBatch.set(screenUiCollection.doc(stationId), {
      eventId: eventRef.id,
      installId: deploymentType === "install" ? eventRef.id : "",
      deploymentType,
      deploymentId: eventRef.id,
      stationId,
      boothStationIds: [stationId],
      screenUi: screenUiByStationId[stationId] || screenUi,
      topics: screenUiTopics,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
  staleSnapshots.forEach((stationSnapshot) => {
    const stationData = stationSnapshot.exists ? stationSnapshot.data() || {} : {};
    if (
      stationSnapshot.exists &&
      (
        stationData.deploymentId === eventRef.id ||
        stationData.eventId === eventRef.id ||
        stationData.installId === eventRef.id
      ) &&
      normalizeAiBoothDeploymentType(stationData.deploymentType || (stationData.installId ? "install" : "event")) === deploymentType
    ) {
      screenUiBatch.delete(stationSnapshot.ref);
    }
  });
  await screenUiBatch.commit();

  const kioskSync = await syncAiBoothEventKioskInfo({
    eventId: eventRef.id,
    deploymentType,
    general: {
      ...cleanEvent.general,
      place: cleanAiBoothText(generalInput.place, 200),
      latitude: cleanAiBoothCoordinateText(
          pickAiBoothCoordinateValue(generalInput.latitude, generalInput.lat),
      ),
      longitude: cleanAiBoothCoordinateText(
          pickAiBoothCoordinateValue(
              generalInput.longitude,
              generalInput.lng,
              generalInput.lon,
          ),
      ),
    },
    boothContexts,
    boothStationIds,
    actor,
  });

  const savedSnapshot = await eventRef.get();
  return {
    ok: true,
    event: serializeAiBoothEvent(savedSnapshot),
    install: deploymentType === "install" ? serializeAiBoothEvent(savedSnapshot) : undefined,
    kioskSync,
  };
}

async function aiBoothsSaveInstallImpl(data, authState) {
  return aiBoothsSaveEventImpl(data, authState, {
    deploymentType: "install",
    collectionName: AI_BOOTH_INSTALLS_COLLECTION,
    inputKey: "install",
    idKey: "installId",
    entityLabel: "install",
  });
}

function getElevenLabsApiKey() {
  let fromSecret = "";
  try {
    fromSecret = typeof ELEVENLABS_API_KEY.value === "function" ?
      ELEVENLABS_API_KEY.value() :
      "";
  } catch {
    fromSecret = "";
  }
  const apiKey = cleanAiBoothText(fromSecret || process.env.ELEVENLABS_API_KEY, 400);

  if (!apiKey) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        "ElevenLabs API key is not configured",
    );
  }

  return apiKey;
}

async function elevenLabsRequest(path, options = {}) {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": getElevenLabsApiKey(),
    },
    ...(options.body ? {body: JSON.stringify(options.body)} : {}),
  });

  const responseText = await response.text();
  let payload = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = {message: responseText};
    }
  }

  if (!response.ok) {
    throw new functions.https.HttpsError(
        "internal",
        payload?.detail?.message || payload?.message || `ElevenLabs request failed (${response.status})`,
    );
  }

  return payload;
}

function normalizeElevenLabsAgentSummary(agent) {
  const source = isPlainObject(agent) ? agent : {};
  const accessInfo = isPlainObject(source.access_info) ? source.access_info : {};

  return {
    agentId: cleanAiBoothText(source.agent_id || source.agentId, 160),
    name: cleanAiBoothText(source.name, 200) || "Untitled agent",
    tags: Array.isArray(source.tags) ?
      source.tags.map((tag) => cleanAiBoothText(tag, 80)).filter(Boolean) :
      [],
    createdAtUnixSecs: Number(source.created_at_unix_secs || 0) || null,
    archived: source.archived === true,
    access: {
      isCreator: accessInfo.is_creator === true,
      role: cleanAiBoothText(accessInfo.role, 80),
      creatorName: cleanAiBoothText(accessInfo.creator_name, 160),
      creatorEmail: cleanAiBoothText(accessInfo.creator_email, 200),
    },
  };
}

async function aiBoothsListElevenLabsAgentsImpl(data = {}) {
  getElevenLabsApiKey();

  const search = cleanAiBoothText(data?.search, 120);
  const cursor = cleanAiBoothText(data?.cursor, 240);
  const agents = [];
  let nextCursor = cursor;
  let hasMore = true;

  for (let pageIndex = 0; pageIndex < 5 && hasMore; pageIndex += 1) {
    const params = new URLSearchParams({
      page_size: "100",
      archived: "false",
      sort_by: "name",
      sort_direction: "asc",
    });

    if (search) {
      params.set("search", search);
    }

    if (nextCursor) {
      params.set("cursor", nextCursor);
    }

    const payload = await elevenLabsRequest(`/v1/convai/agents?${params.toString()}`);
    const pageAgents = Array.isArray(payload.agents) ?
      payload.agents.map(normalizeElevenLabsAgentSummary).filter((agent) => agent.agentId) :
      [];

    agents.push(...pageAgents);
    hasMore = payload.has_more === true && Boolean(payload.next_cursor);
    nextCursor = hasMore ? cleanAiBoothText(payload.next_cursor, 240) : "";
  }

  return {
    ok: true,
    agents,
    hasMore,
    nextCursor,
  };
}

async function findElevenLabsAgentIdByName(agentName) {
  const search = cleanAiBoothText(agentName, 120);
  if (!search) {
    return "";
  }

  const params = new URLSearchParams({
    page_size: "100",
    archived: "false",
    search,
  });
  const payload = await elevenLabsRequest(`/v1/convai/agents?${params.toString()}`);
  const matchingAgent = (Array.isArray(payload.agents) ? payload.agents : [])
      .map(normalizeElevenLabsAgentSummary)
      .find((agent) => agent.name === search);

  return matchingAgent?.agentId || "";
}

function normalizeElevenLabsToolSummary(tool) {
  const toolConfig = isPlainObject(tool?.tool_config) ?
    tool.tool_config :
    isPlainObject(tool?.toolConfig) ?
      tool.toolConfig :
      tool;

  return {
    toolId: cleanAiBoothText(
        tool?.id || tool?.tool_id || tool?.toolId || toolConfig?.id || toolConfig?.tool_id,
        160,
    ),
    name: cleanAiBoothText(
        tool?.name || tool?.tool_name || tool?.toolName || toolConfig?.name,
        160,
    ),
  };
}

function getElevenLabsToolsFromPayload(payload) {
  if (Array.isArray(payload?.tools)) {
    return payload.tools;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

async function findElevenLabsToolIdByName(toolName) {
  const search = cleanAiBoothText(toolName, 120);
  if (!search) {
    return "";
  }

  let cursor = "";
  for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
    const params = new URLSearchParams({page_size: "100"});
    if (cursor) {
      params.set("cursor", cursor);
    }
    const payload = await elevenLabsRequest(`/v1/convai/tools?${params.toString()}`);
    const matchingTool = getElevenLabsToolsFromPayload(payload)
        .map(normalizeElevenLabsToolSummary)
        .find((tool) => tool.name === search);

    if (matchingTool?.toolId) {
      return matchingTool.toolId;
    }

    if (payload?.has_more !== true || !payload?.next_cursor) {
      break;
    }
    cursor = cleanAiBoothText(payload.next_cursor, 240);
  }

  return "";
}

function buildElevenLabsMissPuttToolConfig() {
  return {
    type: "client",
    name: AI_BOOTH_MISS_PUTT_TOOL_NAME,
    description:
      "Animate the golf ball missing the cup when a guest asks something outside the event scope.",
    response_timeout_secs: 10,
    disable_interruptions: false,
    force_pre_tool_speech: false,
    pre_tool_speech: "auto",
    assignments: [],
    tool_call_sound: null,
    tool_call_sound_behavior: "auto",
    parameters: {
      type: "object",
      required: [],
      properties: {
        reason: {
          type: "string",
          description: "Short reason for the miss animation. Use off_topic for unrelated questions.",
        },
        topicKey: {
          type: "string",
          description: "Optional booth topic key to highlight before the miss animation.",
        },
      },
    },
    expects_response: true,
    dynamic_variables: {dynamic_variable_placeholders: {}},
    execution_mode: "immediate",
  };
}

async function createElevenLabsMissPuttTool() {
  const payload = await elevenLabsRequest("/v1/convai/tools", {
    method: "POST",
    body: {tool_config: buildElevenLabsMissPuttToolConfig()},
  });
  const summary = normalizeElevenLabsToolSummary(payload?.tool || payload);
  return summary.toolId;
}

async function ensureElevenLabsMissPuttToolId() {
  const existingToolId = await findElevenLabsToolIdByName(AI_BOOTH_MISS_PUTT_TOOL_NAME);
  if (existingToolId) {
    return existingToolId;
  }
  return createElevenLabsMissPuttTool();
}

function mergeElevenLabsPromptToolIds(promptConfig, extraToolIds = []) {
  const toolIds = [
    ...(Array.isArray(promptConfig?.tool_ids) ? promptConfig.tool_ids : []),
    ...(Array.isArray(promptConfig?.toolIds) ? promptConfig.toolIds : []),
    ...extraToolIds,
  ].map((toolId) => cleanAiBoothText(toolId, 160)).filter(Boolean);

  return Array.from(new Set(toolIds));
}

function appendElevenLabsMissPuttInlineTool(tools) {
  const existingTools = Array.isArray(tools) ? tools : [];
  if (existingTools.some((tool) => getElevenLabsToolIdentifier(tool) === AI_BOOTH_MISS_PUTT_TOOL_NAME)) {
    return existingTools;
  }
  return [...existingTools, buildElevenLabsMissPuttToolConfig()];
}

function buildAiBoothAgentName(event, stationId = "") {
  const eventName = cleanAiBoothText(event?.general?.eventName, 80) || "AI Booth Event";
  const stationSuffix = cleanAiBoothText(stationId, 80);
  return stationSuffix ? `${eventName} - ${stationSuffix}` : eventName;
}

function formatAiBoothSchedule(general) {
  if (general?.open24Hours) {
    return "Open 24 hours every event day.";
  }

  if (general?.sameHoursEveryDay) {
    return `Every event day: ${general.openingHours || "unset"} to ${general.closingHours || "unset"}`;
  }

  const dailyHours = isPlainObject(general?.dailyHours) ? general.dailyHours : {};
  const rows = Object.entries(dailyHours).map(([dateKey, hours]) => (
    `${dateKey}: ${cleanAiBoothText(hours?.openingHours, 32) || "unset"} to ${cleanAiBoothText(hours?.closingHours, 32) || "unset"}`
  ));

  return rows.length > 0 ? rows.join("\n") : "No opening hours set.";
}

function formatAiBoothKnowledgeLine(label, value, fallback = "Not set") {
  return `- ${label}: ${cleanAiBoothText(value, 8000) || fallback}`;
}

function formatAiBoothKnowledgeBlock(label, value, fallback = "Not set") {
  return [
    `### ${label}`,
    cleanAiBoothText(value, 12000) || fallback,
  ].join("\n");
}

function buildAiBoothTransportationLocationKnowledge(location, index) {
  const normalizedLocation = normalizeAiBoothTransportationLocation(
      location,
      index,
  );
  const timeWindow = [
    normalizedLocation.startTime,
    normalizedLocation.endTime,
  ].filter(Boolean).join(" - ");
  const hours = timeWindow || normalizedLocation.hours;
  const heading = normalizedLocation.location ||
    `Location ${index + 1}`;

  return [
    `##### ${heading}`,
    formatAiBoothKnowledgeLine("Location", normalizedLocation.location),
    formatAiBoothKnowledgeLine("Hours", hours),
    formatAiBoothKnowledgeLine("Frequency", normalizedLocation.frequency),
    [
      "Details:",
      normalizedLocation.details || "Not set",
    ].join("\n"),
  ].join("\n\n");
}

function buildAiBoothTransportationSectionKnowledge(label, section) {
  const normalizedSection = normalizeAiBoothTransportationSection(section);
  const locations = normalizedSection.locations.length > 0 ?
    normalizedSection.locations
        .map(buildAiBoothTransportationLocationKnowledge)
        .join("\n\n") :
    "No locations configured.";

  return [
    `#### ${label}`,
    locations,
  ].join("\n\n");
}

function buildAiBoothFanZoneActivationKnowledge(activation, index) {
  const normalizedActivation = normalizeAiBoothFanZoneActivation(activation, index);

  return [
    `##### ${normalizedActivation.name}`,
    formatAiBoothKnowledgeLine("Activation ID", normalizedActivation.id),
    formatAiBoothKnowledgeLine("Sponsor", normalizedActivation.sponsor),
    formatAiBoothKnowledgeLine("Location", normalizedActivation.location),
    formatAiBoothKnowledgeLine("Hours", normalizedActivation.hours),
    formatAiBoothKnowledgeBlock("Details", normalizedActivation.details),
  ].join("\n\n");
}

function buildAiBoothFanZoneKnowledge(zone, index) {
  const normalizedZone = normalizeAiBoothFanZone(zone, index);
  const activations = normalizedZone.activations.length > 0 ?
    normalizedZone.activations.map(buildAiBoothFanZoneActivationKnowledge).join("\n\n") :
    "No activations configured.";

  return [
    `#### ${normalizedZone.name}`,
    formatAiBoothKnowledgeLine("Fan Zone ID", normalizedZone.id),
    formatAiBoothKnowledgeLine("Open Hours", normalizedZone.openHours),
    formatAiBoothKnowledgeBlock("Details", normalizedZone.details),
    `#### Activations\n${activations}`,
  ].join("\n\n");
}

function buildAiBoothHospitalityClientKnowledge(client, index) {
  const normalizedClient = normalizeAiBoothHospitalityClient(client, index);

  return [
    `##### ${normalizedClient.clientName}`,
    formatAiBoothKnowledgeLine("Client ID", normalizedClient.id),
    formatAiBoothKnowledgeLine("Contact name", normalizedClient.contactName),
    formatAiBoothKnowledgeLine("Contact phone", normalizedClient.contactPhone),
    formatAiBoothKnowledgeLine("Contact email", normalizedClient.contactEmail),
    formatAiBoothKnowledgeLine("Host name", normalizedClient.hostName),
    formatAiBoothKnowledgeBlock("Credential notes", normalizedClient.credentialNotes),
    formatAiBoothKnowledgeBlock("Arrival notes", normalizedClient.arrivalNotes),
    formatAiBoothKnowledgeBlock("Special requests", normalizedClient.specialRequests),
  ].join("\n\n");
}

function buildAiBoothHospitalityLocationKnowledge(location, index) {
  const normalizedLocation = normalizeAiBoothHospitalityLocation(location, index);
  const clients = normalizedLocation.clients.length > 0 ?
    normalizedLocation.clients.map(buildAiBoothHospitalityClientKnowledge).join("\n\n") :
    "No clients assigned.";

  return [
    `#### ${normalizedLocation.name}`,
    formatAiBoothKnowledgeLine("Location ID", normalizedLocation.id),
    formatAiBoothKnowledgeLine("Venue type", normalizedLocation.venueType),
    formatAiBoothKnowledgeLine("Location", normalizedLocation.location),
    formatAiBoothKnowledgeBlock("Amenities", normalizedLocation.amenities),
    formatAiBoothKnowledgeBlock("Access notes", normalizedLocation.accessNotes),
    formatAiBoothKnowledgeBlock("Details", normalizedLocation.details),
    `#### Assigned Clients\n${clients}`,
  ].join("\n\n");
}

function buildAiBoothBathroomLocationKnowledge(location, index) {
  const normalizedLocation = normalizeAiBoothBathroomLocation(location, index);

  return [
    `#### ${normalizedLocation.place}`,
    formatAiBoothKnowledgeLine("Location ID", normalizedLocation.id),
  ].join("\n\n");
}

function buildAiBoothFanServiceKnowledge(service, index) {
  const normalizedService = normalizeAiBoothFanService(service, index);

  return [
    `#### ${normalizedService.name}`,
    formatAiBoothKnowledgeLine("Service ID", normalizedService.id),
    formatAiBoothKnowledgeLine("Location", normalizedService.location),
  ].join("\n\n");
}

function buildAiBoothCourseHoleKnowledge(hole, index) {
  const normalizedHole = normalizeAiBoothCourseHole(hole, index);

  return [
    `#### Hole ${normalizedHole.holeNumber}`,
  ].join("\n\n");
}

function buildAiBoothScheduleEventKnowledge(scheduleEvent, dayIndex, eventIndex) {
  const normalizedEvent = normalizeAiBoothScheduleEvent(scheduleEvent, dayIndex, eventIndex);
  const timeWindow = [normalizedEvent.startTime, normalizedEvent.endTime]
      .filter(Boolean)
      .join(" - ");

  return [
    `#### ${normalizedEvent.title}`,
    formatAiBoothKnowledgeLine("Schedule item ID", normalizedEvent.id),
    formatAiBoothKnowledgeLine("Category", normalizedEvent.category),
    formatAiBoothKnowledgeLine("Time", timeWindow),
    formatAiBoothKnowledgeLine("Location", normalizedEvent.location),
    formatAiBoothKnowledgeLine("Audience / access", normalizedEvent.audience),
    formatAiBoothKnowledgeLine("Needs review", normalizedEvent.needsReview ? "Yes" : "No"),
    formatAiBoothKnowledgeBlock("Details", normalizedEvent.details),
    formatAiBoothKnowledgeBlock("Source note", normalizedEvent.sourceNote),
  ].join("\n\n");
}

function buildAiBoothScheduleDayKnowledge(day, index) {
  const normalizedDay = normalizeAiBoothScheduleDay(day, index);
  const gateWindow = [normalizedDay.gatesOpen, normalizedDay.gatesClose]
      .filter(Boolean)
      .join(" - ");
  const scheduleItems = normalizedDay.events.length > 0 ?
    normalizedDay.events.map((event, eventIndex) => (
      buildAiBoothScheduleEventKnowledge(event, index, eventIndex)
    )).join("\n\n") :
    "No schedule items configured.";

  return [
    `### ${normalizedDay.dayLabel}`,
    formatAiBoothKnowledgeLine("Date", normalizedDay.date),
    formatAiBoothKnowledgeLine("Status / access", normalizedDay.publicStatus),
    formatAiBoothKnowledgeLine("Theme", normalizedDay.theme),
    formatAiBoothKnowledgeLine("Gate window", gateWindow),
    formatAiBoothKnowledgeBlock("Daily notes", normalizedDay.dailyNotes),
    `### Schedule Items\n${scheduleItems}`,
  ].join("\n\n");
}

function buildAiBoothTopicKnowledge(topic, index) {
  const normalizedTopic = normalizeAiBoothTopic(topic, index);

  if (normalizedTopic.kind === AI_BOOTH_WIFI_TOPIC_KIND) {
    const wifiQrPayload = buildAiBoothWifiQrPayload(normalizedTopic);

    return [
      `### ${normalizedTopic.title}`,
      formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
      formatAiBoothKnowledgeLine("Type", "Wi-Fi"),
      formatAiBoothKnowledgeLine("SSID", normalizedTopic.wifiSsid),
      formatAiBoothKnowledgeLine("Password", normalizedTopic.wifiPassword),
      formatAiBoothKnowledgeLine("Security", normalizedTopic.wifiSecurity),
      formatAiBoothKnowledgeLine("Hidden network", normalizedTopic.wifiHidden ? "Yes" : "No"),
      formatAiBoothKnowledgeLine("Wi-Fi QR payload", wifiQrPayload),
      formatAiBoothKnowledgeBlock("Instructions", normalizedTopic.summary),
    ].join("\n\n");
  }

  if (normalizedTopic.kind === AI_BOOTH_TRANSPORTATION_TOPIC_KIND) {
    return [
      `### ${normalizedTopic.title}`,
      formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
      formatAiBoothKnowledgeLine("Type", "Transportation"),
      formatAiBoothKnowledgeBlock("Summary", normalizedTopic.summary),
      buildAiBoothTransportationSectionKnowledge(
          "Shuttle",
          normalizedTopic.transportation.shuttle,
      ),
      buildAiBoothTransportationSectionKnowledge(
          "Ride Share",
          normalizedTopic.transportation.rideShare,
      ),
      buildAiBoothTransportationSectionKnowledge(
          "Parking",
          normalizedTopic.transportation.parking,
      ),
    ].join("\n\n");
  }

  if (normalizedTopic.kind === AI_BOOTH_CONCESSIONS_TOPIC_KIND) {
    const fanZones = normalizedTopic.fanZones.length > 0 ?
      normalizedTopic.fanZones.map(buildAiBoothFanZoneKnowledge).join("\n\n") :
      "No fan zones configured.";

    return [
      `### ${normalizedTopic.title}`,
      formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
      formatAiBoothKnowledgeLine("Type", "Concessions"),
      formatAiBoothKnowledgeBlock("Summary", normalizedTopic.summary),
      formatAiBoothKnowledgeBlock("Concession Details", normalizedTopic.notes),
      `### Fan Zones\n${fanZones}`,
    ].join("\n\n");
  }

  if (normalizedTopic.kind === AI_BOOTH_HOSPITALITY_TOPIC_KIND) {
    const hospitalityLocations = normalizedTopic.hospitalityLocations.length > 0 ?
      normalizedTopic.hospitalityLocations
          .map(buildAiBoothHospitalityLocationKnowledge)
          .join("\n\n") :
      "No hospitality locations configured.";

    return [
      `### ${normalizedTopic.title}`,
      formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
      formatAiBoothKnowledgeLine("Type", "Hospitality"),
      formatAiBoothKnowledgeBlock("Summary", normalizedTopic.summary),
      formatAiBoothKnowledgeBlock("Hospitality Notes", normalizedTopic.notes),
      `### Hospitality Locations\n${hospitalityLocations}`,
    ].join("\n\n");
  }

  if (normalizedTopic.kind === AI_BOOTH_BATHROOMS_TOPIC_KIND) {
    const bathroomLocations = normalizedTopic.bathroomLocations.length > 0 ?
      normalizedTopic.bathroomLocations.map(buildAiBoothBathroomLocationKnowledge).join("\n\n") :
      "No bathroom locations configured.";

    return [
      `### ${normalizedTopic.title}`,
      formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
      formatAiBoothKnowledgeLine("Type", "Bathrooms"),
      formatAiBoothKnowledgeBlock("Summary", normalizedTopic.summary),
      `### Bathroom Locations\n${bathroomLocations}`,
    ].join("\n\n");
  }

  if (normalizedTopic.kind === AI_BOOTH_FAN_SERVICES_TOPIC_KIND) {
    const fanServices = normalizedTopic.fanServices.length > 0 ?
      normalizedTopic.fanServices.map(buildAiBoothFanServiceKnowledge).join("\n\n") :
      "No fan services configured.";

    return [
      `### ${normalizedTopic.title}`,
      formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
      formatAiBoothKnowledgeLine("Type", "Fan Services"),
      formatAiBoothKnowledgeBlock("Summary", normalizedTopic.summary),
      `### Services\n${fanServices}`,
    ].join("\n\n");
  }

  if (normalizedTopic.kind === AI_BOOTH_COURSE_TOPIC_KIND) {
    const holes = normalizedTopic.courseHoles.length > 0 ?
      normalizedTopic.courseHoles.map(buildAiBoothCourseHoleKnowledge).join("\n\n") :
      "No course holes configured.";

    return [
      `### ${normalizedTopic.title}`,
      formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
      formatAiBoothKnowledgeLine("Type", "Course"),
      formatAiBoothKnowledgeBlock("Summary", normalizedTopic.summary),
      `### Holes\n${holes}`,
    ].join("\n\n");
  }

  if (normalizedTopic.kind === AI_BOOTH_SCHEDULE_TOPIC_KIND) {
    const scheduleDays = normalizedTopic.scheduleDays.length > 0 ?
      normalizedTopic.scheduleDays.map(buildAiBoothScheduleDayKnowledge).join("\n\n") :
      "No tournament schedule days configured.";

    return [
      `### ${normalizedTopic.title}`,
      formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
      formatAiBoothKnowledgeLine("Type", "Tournament Schedule"),
      formatAiBoothKnowledgeBlock("Summary", normalizedTopic.summary),
      formatAiBoothKnowledgeBlock("Schedule Notes", normalizedTopic.notes),
      `### Tournament Days\n${scheduleDays}`,
    ].join("\n\n");
  }

  return [
    `### ${normalizedTopic.title}`,
    formatAiBoothKnowledgeLine("Topic ID", normalizedTopic.id),
    formatAiBoothKnowledgeLine("Type", normalizedTopic.kind || "General"),
    formatAiBoothKnowledgeBlock("Summary", normalizedTopic.summary),
    formatAiBoothKnowledgeBlock("Detailed Notes", normalizedTopic.notes),
    formatAiBoothKnowledgeBlock("Checklist", normalizedTopic.checklistText),
  ].join("\n\n");
}

function buildAiBoothActivationKnowledge(activation, index) {
  const normalizedActivation = normalizeAiBoothActivation(activation, index);

  return [
    `### ${normalizedActivation.name}`,
    formatAiBoothKnowledgeLine("Activation ID", normalizedActivation.id),
    formatAiBoothKnowledgeLine("Sponsor", normalizedActivation.sponsor),
    formatAiBoothKnowledgeLine("Category", normalizedActivation.category),
    formatAiBoothKnowledgeLine("Location", normalizedActivation.location),
    formatAiBoothKnowledgeLine("Hours", normalizedActivation.hours),
    formatAiBoothKnowledgeBlock("Description", normalizedActivation.description),
    formatAiBoothKnowledgeBlock(
        "Guest Instructions",
        normalizedActivation.guestInstructions,
    ),
  ].join("\n\n");
}

async function readAiBoothStorageText(storagePath) {
  const normalizedPath = cleanAiBoothText(storagePath, 1000);
  if (!normalizedPath) {
    return "";
  }

  try {
    const [buffer] = await getStorageBucket().file(normalizedPath).download();
    return cleanAiBoothText(buffer.toString("utf8"), 80000);
  } catch (error) {
    console.warn("[AI Booths] Unable to read intake extracted text", normalizedPath, error);
    return "";
  }
}

function formatAiBoothApprovedIntakeLinks(links) {
  const normalizedLinks = normalizeAiBoothIntakeLinks(links);
  if (normalizedLinks.length === 0) {
    return "";
  }

  return normalizedLinks
      .map((link) => (
        link.url ? `${link.label || "Link"} (${link.url})` : link.label
      ))
      .join("; ");
}

async function buildApprovedAiBoothIntakeSubmissionKnowledge(submission) {
  const title = submission.organization ||
    submission.participantName ||
    "Event Participant";
  const fileSections = [];
  const files = Array.isArray(submission.files) ? submission.files : [];
  const approvedLinks = formatAiBoothApprovedIntakeLinks(submission.links);

  for (const file of files) {
    const extractedText = await readAiBoothStorageText(file.extractedTextPath) ||
      cleanAiBoothText(file.extractedTextPreview, 80000);
    if (!extractedText) {
      continue;
    }

    fileSections.push([
      `### Source PDF: ${file.fileName || "Uploaded PDF"}`,
      extractedText,
    ].join("\n"));
  }

  const header = [
    `## ${title}`,
    submission.participantName ?
      formatAiBoothKnowledgeLine("Contact", submission.participantName) :
      "",
    submission.role ? formatAiBoothKnowledgeLine("Role", submission.role) : "",
    submission.category ?
      formatAiBoothKnowledgeLine("Category", submission.category) :
      "",
    submission.email ? formatAiBoothKnowledgeLine("Email", submission.email) : "",
    approvedLinks ? formatAiBoothKnowledgeLine("Approved links", approvedLinks) : "",
    submission.notes ?
      formatAiBoothKnowledgeBlock("Submitted notes", submission.notes) :
      "",
  ].filter(Boolean);

  return header.concat(fileSections).join("\n\n").trim();
}

async function buildApprovedAiBoothIntakeKnowledge(targetId, targetType = "event") {
  const normalizedTargetId = cleanAiBoothText(targetId, 160)
      .replace(/[^a-zA-Z0-9_-]/g, "");
  const normalizedTargetType = normalizeAiBoothDeploymentType(targetType);
  if (!normalizedTargetId) {
    return {
      documentCount: 0,
      combinedText: "",
    };
  }

  const snapshot = await db.collection(EVENT_INTAKE_SUBMISSIONS_COLLECTION)
      .where(normalizedTargetType === "install" ? "targetId" : "eventId", "==", normalizedTargetId)
      .limit(500)
      .get();
  const approvedSubmissions = snapshot.docs
      .map((docSnapshot) => serializeAiBoothIntakeSubmission(docSnapshot))
      .filter((submission) => normalizedTargetType !== "install" || submission.targetType === "install")
      .filter((submission) => submission.status === "approved");
  const documents = [];

  for (const submission of approvedSubmissions) {
    const content = await buildApprovedAiBoothIntakeSubmissionKnowledge(
        submission,
    );
    if (content) {
      documents.push({
        id: submission.id,
        title: submission.organization ||
          submission.participantName ||
          "Event Participant",
        content,
      });
    }
  }

  return {
    documentCount: documents.length,
    combinedText: documents
        .map((document) => document.content)
        .join("\n\n")
        .trim(),
  };
}

function buildAiBoothKnowledgeBaseMarkdown(
    event,
    kiosksByStationId = new Map(),
    approvedIntakeKnowledge = null,
) {
  void kiosksByStationId;
  const general = event.general || {};
  const deploymentType = normalizeAiBoothDeploymentType(event.deploymentType);
  const deploymentLabel = deploymentType === "install" ? "permanent location" : "event";
  const eventName = cleanAiBoothText(general.eventName, 140) ||
    (deploymentType === "install" ? "AI Booth Install" : "AI Booth Event");
  const eventCategory = cleanAiBoothText(general.eventCategory, 120);
  const eventInfo = cleanAiBoothText(general.eventInfo || general.basicEventInfo, 8000);
  const phoneChargingEnabled = general.phoneChargingEnabled === true;
  const paymentType = normalizeAiBoothPaymentType(general.paymentType);
  const address = [general.address, general.city, general.zipCode, general.country]
      .filter(Boolean)
      .join(", ");
  const weatherLocation = [general.city, general.country].filter(Boolean).join(", ") ||
    address;
  const golf = normalizeAiBoothGolfConfig(event.golf, general);
  const hasLiveGolfConfig = Boolean(golf.tournId || golf.tournamentName || golf.year);
  const boothStationIds = Array.isArray(event.boothStationIds) ? event.boothStationIds : [];
  const topics = Array.isArray(event.topics) ? event.topics : [];
  const activations = Array.isArray(event.activations) ? event.activations : [];
  const topicText = topics.length > 0 ?
    topics.map(buildAiBoothTopicKnowledge).join("\n\n") :
    "No additional topics have been configured.";
  const activationText = activations.length > 0 ?
    activations.map(buildAiBoothActivationKnowledge).join("\n\n") :
    "No event activations have been configured.";
  const intakeText = cleanAiBoothText(
      approvedIntakeKnowledge?.combinedText,
      100000,
  ) || "No approved participant intake submissions have been added.";
  const intakeCount = Number(approvedIntakeKnowledge?.documentCount || 0);

  return cleanAiBoothText([
    `# ${eventName} AI Booth Knowledge`,
    "",
    `This document is generated from the Firebase ${deploymentLabel} configuration.`,
    `Use it as the source of truth for ${deploymentLabel} facts, activations, topics, and booth guidance.`,
    "",
    "## Venue Info",
    formatAiBoothKnowledgeLine(deploymentType === "install" ? "Location name" : "Event name", eventName),
    formatAiBoothKnowledgeLine("Category", eventCategory),
    formatAiBoothKnowledgeBlock("General event info", eventInfo),
    formatAiBoothKnowledgeLine("Address", address),
    formatAiBoothKnowledgeLine("Weather lookup location", weatherLocation),
    formatAiBoothKnowledgeLine("Start date", general.startDate),
    formatAiBoothKnowledgeLine("End date", general.endDate),
    "",
    "## Live Golf Feed",
    hasLiveGolfConfig ?
      [
        formatAiBoothKnowledgeLine("Provider", golf.provider),
        formatAiBoothKnowledgeLine("Tournament", golf.tournamentName),
        formatAiBoothKnowledgeLine("Slash tournId", golf.tournId),
        formatAiBoothKnowledgeLine("Season year", golf.year),
        formatAiBoothKnowledgeLine("Tour", golf.tour),
        formatAiBoothKnowledgeLine("Slash orgId", golf.orgId),
      ].filter(Boolean).join("\n") :
      "No live golf feed has been assigned.",
    "",
    "## Opening Hours",
    formatAiBoothSchedule(general),
    "",
    "## Phone Charging",
    formatAiBoothKnowledgeLine("Enabled", phoneChargingEnabled ? "Yes" : "No"),
    formatAiBoothKnowledgeLine("Payment type", phoneChargingEnabled ? paymentType : "Not active"),
    formatAiBoothKnowledgeBlock(
        "Rental policy",
        phoneChargingEnabled ?
          general.rentalPolicy || DEFAULT_AI_BOOTH_RENTAL_POLICY :
          `Phone charging is disabled for this ${deploymentLabel}.`,
    ),
    formatAiBoothKnowledgeLine(
        "Guest support fallback",
        general.supportFallback || DEFAULT_AI_BOOTH_SUPPORT_FALLBACK,
    ),
    "",
    "## Assigned Booths",
    boothStationIds.length > 0 ? boothStationIds.join(", ") : "No assigned booths.",
    "",
    "## Topics",
    topicText,
    "",
    deploymentType === "install" ? "## Temporary Notices / Activations" : "## Event Activations",
    activationText,
    "",
    deploymentType === "install" ? "## Approved Client Maintenance Intake" : "## Approved Participant Intake",
    formatAiBoothKnowledgeLine("Approved submission count", String(intakeCount)),
    "",
    intakeText,
    "",
  ].join("\n"), 250000);
}

function buildAiBoothSystemPrompt(event, basePrompt = STANDARD_AI_BOOTH_SYSTEM_PROMPT) {
  const deploymentType = normalizeAiBoothDeploymentType(event.deploymentType);
  const deploymentLabel = deploymentType === "install" ? "permanent location" : "event";

  return cleanAiBoothText(`${basePrompt || STANDARD_AI_BOOTH_SYSTEM_PROMPT}

Knowledge source
- The attached knowledge base is generated from Firebase and is the only source of truth for ${deploymentLabel} facts.
- Use the knowledge base for venue details, topics, schedules, activations, services, Wi-Fi, approved links, QR payloads, and booth guidance.
- Do not rely on hardcoded facts in this prompt for guest-facing answers.`, 20000);
}

function stripAiBoothGeneratedPromptContext(value) {
  const text = cleanAiBoothText(value, 20000);
  const markers = [
    "\n\nKnowledge source\n",
    "\n\nDeployment data:\n",
    "\n\nEvent data:\n",
    "\n\nPhysical kiosk context:\n",
  ];
  const markerIndexes = markers
      .map((marker) => text.indexOf(marker))
      .filter((index) => index >= 0);
  const firstMarkerIndex = markerIndexes.length > 0 ? Math.min(...markerIndexes) : -1;

  return firstMarkerIndex >= 0 ? text.slice(0, firstMarkerIndex).trim() : text;
}

function buildAiBoothFirstMessage(event) {
  const eventName = event?.general?.eventName || "the event";
  return cleanAiBoothText(`Welcome to ${eventName}. How can I help you?`, 1000);
}

function buildAiBoothKioskSystemPrompt(event, stationId, boothContext, kiosk, basePrompt) {
  void event;
  void stationId;
  void boothContext;
  void kiosk;
  return cleanAiBoothText(basePrompt, 20000);
}

async function getAiBoothKiosksByStationId(stationIds) {
  const kioskMap = new Map();
  const normalizedStationIds = Array.from(new Set(
      (Array.isArray(stationIds) ? stationIds : [])
          .map((stationId) => cleanAiBoothText(stationId, 80))
          .filter(Boolean),
  ));

  for (const stationChunk of chunkArray(normalizedStationIds, 10)) {
    const snapshot = await db.collection("kiosks")
        .where("stationid", "in", stationChunk)
        .get();

    snapshot.docs.forEach((docSnap) => {
      const kiosk = docSnap.data() || {};
      const stationId = cleanAiBoothText(kiosk.stationid || docSnap.id, 80);
      if (stationId) {
        kioskMap.set(stationId, kiosk);
      }
    });
  }

  return kioskMap;
}

function getElevenLabsKnowledgeBaseDocumentId(document) {
  return cleanAiBoothText(
      document?.id || document?.documentation_id || document?.document_id,
      160,
  );
}

function normalizeElevenLabsPromptKnowledgeBase(value) {
  return (Array.isArray(value) ? value : [])
      .filter(isPlainObject)
      .map((document) => ({...document}));
}

function mergeElevenLabsPromptKnowledgeBase(
    currentKnowledgeBase,
    knowledgeBaseEntry,
    managedDocumentIds = [],
) {
  const nextDocumentId = getElevenLabsKnowledgeBaseDocumentId(knowledgeBaseEntry);
  const managedIds = new Set(
      [...managedDocumentIds, nextDocumentId]
          .map((documentId) => cleanAiBoothText(documentId, 160))
          .filter(Boolean),
  );
  const preservedKnowledgeBase = normalizeElevenLabsPromptKnowledgeBase(currentKnowledgeBase)
      .filter((document) => !managedIds.has(getElevenLabsKnowledgeBaseDocumentId(document)));

  if (!nextDocumentId) {
    return preservedKnowledgeBase;
  }

  return [
    ...preservedKnowledgeBase,
    {
      ...knowledgeBaseEntry,
      id: nextDocumentId,
      usage_mode: knowledgeBaseEntry?.usage_mode || knowledgeBaseEntry?.usageMode || "auto",
    },
  ];
}

function getElevenLabsToolIdentifier(tool) {
  const candidates = [
    tool?.name,
    tool?.tool_name,
    tool?.toolName,
    tool?.id,
    tool?.type,
    tool?.config?.name,
    tool?.tool_config?.name,
    tool?.toolConfig?.name,
    tool?.function?.name,
  ];
  return cleanAiBoothText(
      candidates.find((candidate) => typeof candidate === "string" && candidate.trim()),
      160,
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isElevenLabsEndConversationTool(tool) {
  const identifier = getElevenLabsToolIdentifier(tool);
  if (!identifier) {
    return false;
  }

  return [
    "end_call",
    "end_conversation",
    "end_session",
    "hang_up",
    "hangup",
    "terminate_call",
  ].includes(identifier);
}

function filterElevenLabsKioskPromptTools(tools) {
  if (!Array.isArray(tools)) {
    return tools;
  }

  return tools.filter((tool) => !isElevenLabsEndConversationTool(tool));
}

function filterElevenLabsKioskBuiltInTools(builtInTools) {
  if (!isPlainObject(builtInTools)) {
    return builtInTools;
  }

  const nextBuiltInTools = {...builtInTools};
  [
    "end_call",
    "end_conversation",
    "end_session",
    "hang_up",
    "hangup",
    "terminate_call",
  ].forEach((toolKey) => {
    if (Object.prototype.hasOwnProperty.call(nextBuiltInTools, toolKey)) {
      nextBuiltInTools[toolKey] = null;
    }
  });

  return nextBuiltInTools;
}

function hasElevenLabsPromptToolIds(promptConfig) {
  return (
    Array.isArray(promptConfig?.tool_ids) && promptConfig.tool_ids.length > 0
  ) || (
    Array.isArray(promptConfig?.toolIds) && promptConfig.toolIds.length > 0
  );
}

function applyElevenLabsKioskToolPolicy(promptConfig) {
  const nextPromptConfig = {...promptConfig};

  if (isPlainObject(nextPromptConfig.built_in_tools)) {
    nextPromptConfig.built_in_tools = filterElevenLabsKioskBuiltInTools(
        nextPromptConfig.built_in_tools,
    );
  }

  if (hasElevenLabsPromptToolIds(nextPromptConfig)) {
    delete nextPromptConfig.tools;
    return nextPromptConfig;
  }

  if (Array.isArray(nextPromptConfig.tools)) {
    nextPromptConfig.tools = filterElevenLabsKioskPromptTools(nextPromptConfig.tools);
  }

  return nextPromptConfig;
}

function buildElevenLabsKioskPlatformSettings(platformSettings) {
  const source = isPlainObject(platformSettings) ? platformSettings : {};
  const overrides = isPlainObject(source.overrides) ? source.overrides : {};
  const conversationOverride = isPlainObject(overrides.conversation_config_override) ?
    overrides.conversation_config_override :
    {};
  const agentOverride = isPlainObject(conversationOverride.agent) ?
    conversationOverride.agent :
    {};

  return {
    ...source,
    overrides: {
      ...overrides,
      conversation_config_override: {
        ...conversationOverride,
        agent: {
          ...agentOverride,
          first_message: true,
        },
      },
    },
  };
}

async function createElevenLabsKnowledgeBaseTextDocument({name, text}) {
  const documentText = cleanAiBoothText(text, 250000);
  if (!documentText) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Knowledge base text is empty",
    );
  }

  const fallbackName = "AI Booth Event Knowledge";
  const documentName = cleanAiBoothText(name, 240) || fallbackName;
  const payload = await elevenLabsRequest("/v1/convai/knowledge-base/text", {
    method: "POST",
    body: {
      name: documentName,
      text: documentText,
    },
  });
  const documentId = getElevenLabsKnowledgeBaseDocumentId(payload);

  if (!documentId) {
    throw new functions.https.HttpsError(
        "internal",
        "ElevenLabs did not return a knowledge base document id",
    );
  }

  return {
    id: documentId,
    name: cleanAiBoothText(payload.name, 240) || documentName,
    type: cleanAiBoothText(payload.type, 40) || "text",
  };
}

async function upsertElevenLabsAgentCopy({
  templateAgentId,
  existingAgentId = "",
  agentName,
  firstMessage,
  systemPrompt,
  knowledgeBaseEntry = null,
  managedKnowledgeBaseDocumentIds = [],
}) {
  let agentId = cleanAiBoothText(existingAgentId, 160);

  if (!agentId) {
    agentId = await findElevenLabsAgentIdByName(agentName);
  }

  if (!agentId) {
    const duplicateResponse = await elevenLabsRequest(
        `/v1/convai/agents/${encodeURIComponent(templateAgentId)}/duplicate`,
        {
          method: "POST",
          body: {name: agentName},
        },
    );
    agentId = cleanAiBoothText(duplicateResponse.agent_id, 160);
  }

  if (!agentId) {
    throw new functions.https.HttpsError("internal", "ElevenLabs did not return an agent id");
  }

  const copiedAgent = await elevenLabsRequest(`/v1/convai/agents/${encodeURIComponent(agentId)}`);
  const platformSettings = isPlainObject(copiedAgent.platform_settings) ?
    copiedAgent.platform_settings :
    {};
  const conversationConfig = isPlainObject(copiedAgent.conversation_config) ?
    copiedAgent.conversation_config :
    {};
  const conversationAgent = isPlainObject(conversationConfig.agent) ?
    conversationConfig.agent :
    {};
  const promptConfig = isPlainObject(conversationAgent.prompt) ?
    conversationAgent.prompt :
    {};
  const kioskPromptConfig = applyElevenLabsKioskToolPolicy(promptConfig);
  let missPuttToolId = "";
  try {
    missPuttToolId = await ensureElevenLabsMissPuttToolId();
  } catch (error) {
    console.warn("Could not ensure ElevenLabs miss_putt tool", {
      message: error?.message || String(error),
    });
  }
  const nextPromptConfig = {
    ...kioskPromptConfig,
    prompt: systemPrompt,
    knowledge_base: mergeElevenLabsPromptKnowledgeBase(
        promptConfig.knowledge_base,
        knowledgeBaseEntry,
        managedKnowledgeBaseDocumentIds,
    ),
  };
  const nextToolIds = mergeElevenLabsPromptToolIds(kioskPromptConfig, [missPuttToolId]);
  const hasPromptToolIds = hasElevenLabsPromptToolIds(kioskPromptConfig);
  if ((hasPromptToolIds || !Array.isArray(nextPromptConfig.tools)) && nextToolIds.length > 0) {
    nextPromptConfig.tool_ids = nextToolIds;
    delete nextPromptConfig.toolIds;
    delete nextPromptConfig.tools;
  } else if (Array.isArray(nextPromptConfig.tools)) {
    nextPromptConfig.tools = appendElevenLabsMissPuttInlineTool(nextPromptConfig.tools);
  }

  try {
    await elevenLabsRequest(`/v1/convai/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      body: {
        name: agentName,
        platform_settings: buildElevenLabsKioskPlatformSettings(platformSettings),
        conversation_config: {
          ...conversationConfig,
          agent: {
            ...conversationAgent,
            first_message: firstMessage,
            prompt: nextPromptConfig,
          },
        },
      },
    });
  } catch (error) {
    error.agentId = agentId;
    throw error;
  }

  return agentId;
}

async function aiBoothsPublishAgentImpl(data, authState, options = {}) {
  const deploymentType = normalizeAiBoothDeploymentType(options.deploymentType || data?.targetType);
  const idKey = options.idKey || (deploymentType === "install" ? "installId" : "eventId");
  const collectionName = options.collectionName || getAiBoothDeploymentCollection(deploymentType);
  const entityLabel = options.entityLabel || (deploymentType === "install" ? "install" : "event");
  const eventId = cleanAiBoothText(data?.[idKey] || data?.targetId || data?.eventId, 160).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!eventId) {
    throw new functions.https.HttpsError("invalid-argument", `${idKey} is required`);
  }

  const eventRef = db.collection(collectionName).doc(eventId);
  const eventSnapshot = await eventRef.get();
  if (!eventSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", `AI booth ${entityLabel} not found`);
  }

  const event = {
    ...serializeAiBoothEvent(eventSnapshot),
    deploymentType,
  };
  const stationIds = Array.isArray(event.boothStationIds) ? event.boothStationIds : [];
  if (stationIds.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Assign at least one booth before creating agents");
  }

  const agentConfig = normalizeAiBoothAgent(event.agent, stationIds);
  const templateAgentId = cleanAiBoothText(agentConfig.templateAgentId || data?.templateAgentId, 160);
  if (!templateAgentId) {
    throw new functions.https.HttpsError("invalid-argument", "templateAgentId is required");
  }

  getElevenLabsApiKey();

  const agentNamePrefix = cleanAiBoothText(agentConfig.name, 120) ||
    buildAiBoothAgentName(event);
  const firstMessage = agentConfig.firstMessage || buildAiBoothFirstMessage(event);
  const agentBaseSystemPrompt = stripAiBoothGeneratedPromptContext(agentConfig.systemPrompt) ||
    STANDARD_AI_BOOTH_SYSTEM_PROMPT;
  const baseSystemPrompt = buildAiBoothSystemPrompt(
      event,
      agentBaseSystemPrompt,
  );
  const kioskMap = await getAiBoothKiosksByStationId(stationIds);
  const approvedIntakeKnowledge = await buildApprovedAiBoothIntakeKnowledge(eventId, deploymentType);
  const previousKnowledgeBase = normalizeAiBoothKnowledgeBase(agentConfig.knowledgeBase);
  const managedKnowledgeBaseDocumentIds = Array.from(new Set([
    previousKnowledgeBase.documentId,
    ...previousKnowledgeBase.previousDocumentIds,
  ].filter(Boolean)));
  const knowledgeBaseDocument = await createElevenLabsKnowledgeBaseTextDocument({
    name: `${agentNamePrefix} ${deploymentType === "install" ? "Install" : "Event"} Knowledge`,
    text: buildAiBoothKnowledgeBaseMarkdown(
        event,
        kioskMap,
        approvedIntakeKnowledge,
    ),
  });
  const knowledgeBaseEntry = {
    type: knowledgeBaseDocument.type || "text",
    name: knowledgeBaseDocument.name,
    id: knowledgeBaseDocument.id,
    usage_mode: "auto",
  };

  const actor = {
    uid: cleanAiBoothText(authState?.uid, 128),
    username: cleanAiBoothText(authState?.profile?.username, 120),
  };
  const nextKioskAgents = {...agentConfig.kioskAgents};
  const results = [];

  for (const stationId of stationIds) {
    const kiosk = kioskMap.get(stationId) || {};
    const boothContext = event.boothContexts?.[stationId] || {};
    const existingKioskAgent = normalizeAiBoothKioskAgent(agentConfig.kioskAgents?.[stationId]);
    const kioskAgentName = cleanAiBoothText(`${agentNamePrefix} - ${stationId}`, 140);
    const kioskSystemPrompt = buildAiBoothKioskSystemPrompt(
        event,
        stationId,
        boothContext,
        kiosk,
        baseSystemPrompt,
    );

    try {
      const agentId = await upsertElevenLabsAgentCopy({
        templateAgentId,
        existingAgentId: existingKioskAgent.agentId,
        agentName: kioskAgentName,
        firstMessage,
        systemPrompt: kioskSystemPrompt,
        knowledgeBaseEntry,
        managedKnowledgeBaseDocumentIds,
      });

      nextKioskAgents[stationId] = {
        agentId,
        name: kioskAgentName,
        syncStatus: "synced",
        syncError: "",
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncedBy: actor,
      };
      results.push({stationId, agentId, ok: true});
    } catch (error) {
      const failedAgentId = cleanAiBoothText(error?.agentId || existingKioskAgent.agentId, 160);
      nextKioskAgents[stationId] = {
        ...existingKioskAgent,
        agentId: failedAgentId,
        name: kioskAgentName,
        syncStatus: "error",
        syncError: cleanAiBoothText(error?.message || "Failed to sync kiosk agent", 1000),
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncedBy: actor,
      };
      results.push({
        stationId,
        agentId: failedAgentId,
        ok: false,
        error: cleanAiBoothText(error?.message || "Failed to sync kiosk agent", 1000),
      });
    }
  }

  const syncedCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - syncedCount;
  const previousDocumentIds = Array.from(new Set([
    ...managedKnowledgeBaseDocumentIds,
    previousKnowledgeBase.documentId,
  ].filter(Boolean)))
      .filter((documentId) => documentId !== knowledgeBaseDocument.id)
      .slice(0, 10);

  await eventRef.set({
    deploymentType,
    agent: {
      ...agentConfig,
      templateAgentId,
      agentId: "",
      name: agentNamePrefix,
      firstMessage,
      systemPrompt: agentBaseSystemPrompt,
      kioskAgents: nextKioskAgents,
      knowledgeBase: {
        documentId: knowledgeBaseDocument.id,
        documentName: knowledgeBaseDocument.name,
        documentType: knowledgeBaseDocument.type || "text",
        syncStatus: failedCount > 0 ? (syncedCount > 0 ? "partial" : "error") : "synced",
        syncError: failedCount > 0 ? `${failedCount} kiosk agents failed to sync` : "",
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncedBy: actor,
        previousDocumentIds,
      },
      syncStatus: failedCount > 0 ? (syncedCount > 0 ? "partial" : "error") : "synced",
      syncError: failedCount > 0 ? `${failedCount} kiosk agents failed to sync` : "",
      lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncedBy: actor,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor,
  }, {merge: true});

  const savedSnapshot = await eventRef.get();
  return {
    ok: failedCount === 0,
    syncedCount,
    failedCount,
    knowledgeBaseDocument,
    results,
    event: serializeAiBoothEvent(savedSnapshot),
    install: deploymentType === "install" ? serializeAiBoothEvent(savedSnapshot) : undefined,
  };
}

async function aiBoothsPublishInstallImpl(data, authState) {
  return aiBoothsPublishAgentImpl(data, authState, {
    deploymentType: "install",
    collectionName: AI_BOOTH_INSTALLS_COLLECTION,
    idKey: "installId",
    entityLabel: "install",
  });
}

async function listUsersImpl() {
  const snap = await db.collection("users").get();
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  return { users };
}

async function deleteUserImpl(data) {
  const uid = String(data?.uid || "").trim();
  if (!uid) throw new functions.https.HttpsError("invalid-argument", "uid required");

  // Delete profile doc (does NOT delete Auth user yet)
  await db.collection("users").doc(uid).delete();
  return { ok: true };
}

async function upsertUserProfileImpl(data) {
  const uid = String(data?.uid || "").trim();
  const profile = data?.profile;

  if (!uid || !profile) {
    throw new functions.https.HttpsError("invalid-argument", "uid and profile required");
  }

  const clean = cleanProfile(profile);
  clean.username = normalizeUsername(clean.username);
  clean.clientId = String(clean.clientId || "").trim().toUpperCase();
  clean.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  if (!clean.createdAt) clean.createdAt = admin.firestore.FieldValue.serverTimestamp();

  await db.collection("users").doc(uid).set(clean, { merge: true });
  await syncCustomClaimsForProfile(uid, clean);
  return { ok: true };
}

async function createAuthUserAndProfileImpl(data) {
  const username = normalizeUsername(data?.username);
  const password = String(data?.password || "");
  const clientId = String(data?.clientId || "").trim().toUpperCase();
  const profileIn = data?.profile || {};

  if (!username || !password || !clientId) {
    throw new functions.https.HttpsError("invalid-argument", "username, password, clientId required");
  }
  if (!isValidUsername(username)) {
    throw new functions.https.HttpsError("invalid-argument", "invalid username");
  }
  if (password.length < 12) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "Password must be at least 12 characters.",
    );
  }

  const email = `${username}@${AUTH_MAPPING_DOMAIN}`;

  // Create Auth user
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: username,
      disabled: false,
    });
  } catch (e) {
    const authCode = String(e?.code || "");
    const authMessage = String(e?.message || "").trim();
    console.error("createAuthUserAndProfileImpl createUser failed", {
      code: authCode,
      message: authMessage,
      username,
      email,
    });

    if (authCode === "auth/email-already-exists") {
      throw new functions.https.HttpsError("already-exists", "User already exists");
    }
    if (authCode === "auth/invalid-password") {
      throw new functions.https.HttpsError(
          "invalid-argument",
          "Password must be at least 12 characters.",
      );
    }
    if (authCode === "auth/invalid-email") {
      throw new functions.https.HttpsError("invalid-argument", "Invalid auth email");
    }
    throw new functions.https.HttpsError(
        "internal",
        authMessage || "Failed to create auth user",
    );
  }

  const uid = userRecord.uid;

  // Create/merge Firestore profile at users/{uid}
  const clean = cleanProfile(profileIn);
  clean.username = username;
  clean.clientId = clientId;
  clean.authEmail = email;
  clean.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  clean.createdAt = admin.firestore.FieldValue.serverTimestamp();

  try {
    await db.collection("users").doc(uid).set(clean, { merge: true });
    await syncCustomClaimsForProfile(uid, clean);
  } catch (e) {
    console.error("createAuthUserAndProfileImpl profile write failed", {
      uid,
      username,
      email,
      message: e?.message || "unknown error",
    });
    try {
      await admin.auth().deleteUser(uid);
    } catch (deleteError) {
      console.error("createAuthUserAndProfileImpl rollback delete failed", {
        uid,
        message: deleteError?.message || "unknown error",
      });
    }
    throw new functions.https.HttpsError(
        "internal",
        "Failed to save user profile",
    );
  }

  return { ok: true, uid, email };
}

async function setUserPasswordImpl(data) {
  const uid = String(data?.uid || "").trim();
  const password = String(data?.password || "");

  if (!uid || !password) {
    throw new functions.https.HttpsError("invalid-argument", "uid and password required");
  }

  await admin.auth().updateUser(uid, { password });
  return { ok: true };
}

async function trackLoginAttemptImpl(data, req = null) {
  const username = normalizeUsername(data?.username);
  const success = data?.success === true;

  if (!username || !isValidUsername(username)) {
    throw new functions.https.HttpsError("invalid-argument", "valid username required");
  }

  const ref = db.collection("loginAttempts").doc(username);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : {};

  const now = new Date();
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
  const ip = forwardedFor || String(req?.ip || "").trim() || null;
  const newLog = {
    timestamp: now.toISOString(),
    success,
    note: success ? "Login successful" : "Login failed",
    ...(ip ? {ip} : {}),
  };

  const logs = [...(existing.logs || []), newLog].slice(-50);

  let update;
  if (success) {
    update = {count: 0, lockedUntil: null, logs};
  } else {
    const newCount = Number(existing.count || 0) + 1;
    const lockedUntil = newCount >= 5 ?
      new Date(now.getTime() + 30 * 60 * 1000).toISOString() :
      null;
    update = {count: newCount, lockedUntil, logs};
  }

  await ref.set(update, {merge: true});
  return {
    ok: true,
    count: Number(update.count || 0),
    lockedUntil: update.lockedUntil || null,
  };
}

async function syncOwnClaimsImpl(authState) {
  const claims = await syncCustomClaimsForProfile(
      authState.uid,
      authState.profile,
  );
  return {
    ok: true,
    claims,
  };
}

async function unlockUserImpl(data) {
  const username = normalizeUsername(data?.username);

  if (!username) {
    throw new functions.https.HttpsError("invalid-argument", "username required");
  }

  const ref = db.collection("loginAttempts").doc(username);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : {};

  const unlockLog = {
    timestamp: new Date().toISOString(),
    success: true,
    note: "Account unlocked by admin",
  };

  const logs = [...(existing.logs || []), unlockLog].slice(-50);
  await ref.set({count: 0, lockedUntil: null, logs}, {merge: true});
  return {ok: true};
}

async function stationBindingGetNextStationImpl(data) {
  const country = normalizeCountry(data?.country);
  const kioskType = getRequestedKioskType(data);
  const snapshot = await db.collection("kiosks").get();
  const reservations = await getActiveStationReservations(country);
  const stationid = findNextStationId(
      snapshot.docs,
      country,
      buildReservedStationIdSet(reservations),
      {kioskType},
  );

  return {
    ok: true,
    country,
    kioskType,
    stationid,
    qrUrl: buildQrUrl(stationid),
    reservations,
  };
}

async function stationBindingListStationReservationsImpl(data) {
  const requestedCountry = String(data?.country || "").trim();
  const activeOnly = data?.activeOnly !== false;
  const snapshot = await db.collection(STATION_RESERVATIONS_COLLECTION).get();
  const reservations = snapshot.docs
      .map((docSnap) => {
        const docData = docSnap.data() || {};
        const stationid = normalizeStationId(docData.stationid || docSnap.id);
        if (!stationid) return null;

        const country = normalizeCountry(
            docData.country || getCountryFromStationId(stationid) || "US",
        );
        if (requestedCountry && country !== normalizeCountry(requestedCountry)) {
          return null;
        }

        const active = docData.active !== false;
        if (activeOnly && !active) {
          return null;
        }

        return {
          stationid,
          country,
          active,
          reason: String(docData.reason || "").trim(),
          createdAt: docData.createdAt || null,
          createdBy: String(docData.createdBy || "").trim(),
          updatedAt: docData.updatedAt || null,
          updatedBy: String(docData.updatedBy || "").trim(),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.stationid.localeCompare(right.stationid));

  return {
    ok: true,
    reservations,
  };
}

async function stationBindingSetStationReservationImpl(data, authState) {
  const stationid = normalizeStationId(data?.stationid);
  const active = data?.active !== false;
  const reason = String(data?.reason || "").trim();
  const country = getCountryFromStationId(stationid);

  if (!stationid) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "stationid required",
    );
  }

  if (!country) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "stationid must start with CA, FR, or US",
    );
  }

  const reservationRef = db.collection(STATION_RESERVATIONS_COLLECTION).doc(stationid);
  const existingSnap = await reservationRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() || {} : {};

  await reservationRef.set({
    stationid,
    country,
    active,
    reason,
    createdAt: existingData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    createdBy: existingData.createdBy || authState.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: authState.uid,
  }, {merge: true});

  const [kioskSnapshot, reservations] = await Promise.all([
    db.collection("kiosks").get(),
    getActiveStationReservations(country),
  ]);
  const nextStationid = findNextStationId(
      kioskSnapshot.docs,
      country,
      buildReservedStationIdSet(reservations),
      {kioskType: getRequestedKioskType(data, stationid)},
  );

  return {
    ok: true,
    stationid,
    country,
    active,
    reason,
    nextStationid,
    nextQrUrl: buildQrUrl(nextStationid),
    message: active ?
      `Station ${stationid} reserved.` :
      `Station ${stationid} reservation cleared.`,
  };
}

async function stationBindingBindModuleImpl(data, authState) {
  const country = normalizeCountry(data?.country);
  const requestedStationId = normalizeStationId(data?.stationid);
  const requestedKioskType = getRequestedKioskType(data, requestedStationId);
  const moduleId = normalizeModuleId(data?.moduleId);

  if (!moduleId) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "moduleId required",
    );
  }

  const [snapshot, reservations] = await Promise.all([
    db.collection("kiosks").get(),
    getActiveStationReservations(country),
  ]);
  const reservedStationIds = buildReservedStationIdSet(reservations);
  const nextStationid = findNextStationId(
      snapshot.docs,
      country,
      reservedStationIds,
      {kioskType: requestedKioskType},
  );
  const provisionid = findNextProvisionId(snapshot.docs);
  const stationid = requestedStationId || nextStationid;

  if (!isBindingStationId(stationid, country)) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        buildInvalidStationIdMessage(stationid, country),
    );
  }

  if (reservedStationIds.has(stationid)) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        buildStationReservationConflictMessage(
            stationid,
            nextStationid,
            reservations,
        ),
    );
  }

  const existingStationDoc = snapshot.docs.find(
      (docSnap) => extractStationId(docSnap) === stationid,
  );

  if (existingStationDoc) {
    throw new functions.https.HttpsError(
        "already-exists",
        `Station ${stationid} already exists.`,
    );
  }

  const duplicateModuleDoc = snapshot.docs.find((docSnap) => {
    const kiosk = docSnap.data() || {};
    const modules = Array.isArray(kiosk.modules) ? kiosk.modules : [];
    return modules.some((module) => moduleIdsMatch(module?.id, moduleId));
  });

  if (duplicateModuleDoc) {
    const existingStation = extractStationId(duplicateModuleDoc);
    throw new functions.https.HttpsError(
        "already-exists",
        `Module ${moduleId} is already bound to ${existingStation}.`,
    );
  }

  const docRef = db.collection("kiosks").doc(provisionid);
  const pendingRef = db.collection("pending").doc(moduleId);

  await db.runTransaction(async (transaction) => {
    const [stationSnap, existingStationSnap] = await Promise.all([
      transaction.get(docRef),
      transaction.get(
          db.collection("kiosks").where("stationid", "==", stationid).limit(1),
      ),
    ]);

    if (!existingStationSnap.empty) {
      throw new functions.https.HttpsError(
          "already-exists",
          `Station ${stationid} already exists.`,
      );
    }

    if (stationSnap.exists) {
      throw new functions.https.HttpsError(
          "aborted",
          `Provision ${provisionid} already exists. Retry binding.`,
      );
    }

    transaction.set(
        docRef,
          createBoundKioskDocument({
            provisionid,
            stationid,
            moduleId,
            country,
            actorUid: authState.uid,
            kioskType: getRequestedKioskType(data, stationid),
          }),
        {merge: true},
    );
    transaction.delete(pendingRef);
  });

  const followingStation = findNextStationId(
      [...snapshot.docs, {id: stationid, data: () => ({stationid})}],
      country,
      reservedStationIds,
      {kioskType: getRequestedKioskType(data, stationid)},
  );

  return {
    ok: true,
    provisionid,
    stationid,
    moduleId,
    qrUrl: buildQrUrl(stationid),
    nextStationid: followingStation,
    nextQrUrl: buildQrUrl(followingStation),
    message: `Module ${moduleId} bound to ${stationid}.`,
  };
}

async function stationBindingUnbindModuleImpl(data, authState) {
  const requestedCountryValue = String(data?.country || "").trim();
  const requestedCountry = requestedCountryValue ?
    normalizeCountry(requestedCountryValue) :
    "";
  const requestedStationId = normalizeStationId(data?.stationid);
  const requestedModuleId = normalizeModuleId(data?.moduleId);

  if (!requestedStationId && !requestedModuleId) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "stationid or moduleId required",
    );
  }

  const snapshot = await db.collection("kiosks").get();
  const stationDoc = requestedStationId ? snapshot.docs.find(
      (docSnap) => extractStationId(docSnap) === requestedStationId,
  ) : null;
  const moduleDoc = requestedModuleId ? snapshot.docs.find((docSnap) => {
    const kiosk = docSnap.data() || {};
    const modules = Array.isArray(kiosk.modules) ? kiosk.modules : [];
    return modules.some((module) => moduleIdsMatch(module?.id, requestedModuleId));
  }) : null;

  if (requestedStationId && !stationDoc) {
    throw new functions.https.HttpsError(
        "not-found",
        `No kiosk binding found for station ${requestedStationId}.`,
    );
  }

  if (requestedModuleId && !moduleDoc) {
    throw new functions.https.HttpsError(
        "not-found",
        `No kiosk binding found for module ${requestedModuleId}.`,
    );
  }

  if (stationDoc && moduleDoc && stationDoc.ref.path !== moduleDoc.ref.path) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        `Station ${requestedStationId} is not bound to module ${requestedModuleId}.`,
    );
  }

  const matchingDoc = moduleDoc || stationDoc;
  if (!matchingDoc) {
    throw new functions.https.HttpsError(
        "not-found",
        "No kiosk binding found.",
    );
  }

  const stationid = extractStationId(matchingDoc);
  const matchingKiosk = matchingDoc.data() || {};
  const boundModules = (Array.isArray(matchingKiosk.modules) ? matchingKiosk.modules : [])
      .filter((module) => normalizeModuleId(module?.id));
  const moduleId = requestedModuleId || normalizeModuleId(boundModules[0]?.id);

  if (!moduleId) {
    throw new functions.https.HttpsError(
        "not-found",
        `Station ${stationid} has no bound modules.`,
    );
  }

  if (!requestedModuleId && boundModules.length > 1) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        `Station ${stationid} has multiple bound modules. Provide moduleId.`,
    );
  }

  const docRef = matchingDoc.ref;
  const pendingRef = db.collection("pending").doc(moduleId);

  await db.runTransaction(async (transaction) => {
    const [stationSnap, pendingSnap] = await Promise.all([
      transaction.get(docRef),
      transaction.get(pendingRef),
    ]);

    if (!stationSnap.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          `Station ${stationid} no longer exists.`,
      );
    }

    const kiosk = stationSnap.data() || {};
    const currentModules = Array.isArray(kiosk.modules) ? kiosk.modules : [];
    if (!currentModules.some((module) => moduleIdsMatch(module?.id, moduleId))) {
      throw new functions.https.HttpsError(
          "not-found",
          `Module ${moduleId} is no longer bound to ${stationid}.`,
      );
    }

    const nextModules = currentModules
        .filter((module) => !moduleIdsMatch(module?.id, moduleId));

    if (nextModules.length === 0) {
      transaction.delete(docRef);
    } else {
      const updatedKiosk = recalculateKioskTotals({
        ...kiosk,
        modules: nextModules,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        binding: {
          ...(kiosk.binding || {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: authState.uid,
        },
      });
      transaction.set(docRef, updatedKiosk, {merge: true});
    }

    const pendingData = pendingSnap.exists ? pendingSnap.data() || {} : {};
    transaction.set(pendingRef, {
      ...pendingData,
      moduleId,
      stationid: "pending",
      active: false,
      firstSeen:
        pendingData.firstSeen || admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      reboundFrom: stationid,
    }, {merge: true});
  });

  const nextStationCountry = requestedCountry || getCountryFromStationId(stationid) || "US";
  const reservations = await getActiveStationReservations(nextStationCountry);
  const nextStationid = findNextStationId(
      snapshot.docs,
      nextStationCountry,
      buildReservedStationIdSet(reservations),
      {kioskType: getRequestedKioskType(data, stationid)},
  );

  return {
    ok: true,
    stationid,
    moduleId,
    nextStationid,
    nextQrUrl: buildQrUrl(nextStationid),
    message: `Module ${moduleId} unbound from ${stationid}.`,
  };
}

async function stationBindingMoveModuleImpl(data, authState) {
  const sourceStationid = normalizeStationId(data?.sourceStationid);
  const moduleId = normalizeModuleId(data?.moduleId);
  const createNewStation = data?.createNewStation === true;
  const destinationCountry = normalizeCountry(
      data?.destinationCountry || data?.country,
  );
  const requestedDestinationStationId = normalizeStationId(
      data?.destinationStationid,
  );

  if (!sourceStationid) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "sourceStationid required",
    );
  }

  if (!moduleId) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "moduleId required",
    );
  }

  if (!createNewStation && !requestedDestinationStationId) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "destinationStationid required",
    );
  }

  const snapshot = await db.collection("kiosks").get();
  const sourceDoc = snapshot.docs.find(
      (docSnap) => extractStationId(docSnap) === sourceStationid,
  );

  if (!sourceDoc) {
    throw new functions.https.HttpsError(
        "not-found",
        `Source station ${sourceStationid} was not found.`,
    );
  }

  const sourceKiosk = sourceDoc.data() || {};
  const requestedKioskType = getRequestedKioskType(data, requestedDestinationStationId);
  const destinationKioskType = requestedKioskType ||
    (createNewStation ? normalizeKioskType(sourceKiosk?.hardware?.type) : "");
  const sourceModules = Array.isArray(sourceKiosk.modules) ?
    sourceKiosk.modules :
    [];
  const sourceModule = sourceModules.find(
      (module) => moduleIdsMatch(module?.id, moduleId),
  );

  if (!sourceModule) {
    throw new functions.https.HttpsError(
        "not-found",
        `Module ${moduleId} was not found in ${sourceStationid}.`,
    );
  }

  const destinationReservations = createNewStation ?
    await getActiveStationReservations(destinationCountry) :
    [];
  const destinationReservedStationIds = buildReservedStationIdSet(
      destinationReservations,
  );
  const nextStationid = createNewStation ?
    findNextStationId(
        snapshot.docs,
        destinationCountry,
        destinationReservedStationIds,
        {kioskType: destinationKioskType},
    ) :
    "";
  const destinationStationid = createNewStation ?
    (requestedDestinationStationId || nextStationid) :
    requestedDestinationStationId;

  if (destinationStationid === sourceStationid) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        "Source and destination stations must be different.",
    );
  }

  if (createNewStation && !isBindingStationId(
      destinationStationid,
      destinationCountry,
  )) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        buildInvalidStationIdMessage(destinationStationid, destinationCountry),
    );
  }

  if (createNewStation && destinationReservedStationIds.has(destinationStationid)) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        buildStationReservationConflictMessage(
            destinationStationid,
            nextStationid,
            destinationReservations,
        ),
    );
  }

  const destinationDoc = snapshot.docs.find(
      (docSnap) => extractStationId(docSnap) === destinationStationid,
  );

  if (createNewStation && destinationDoc) {
    throw new functions.https.HttpsError(
        "already-exists",
        `Station ${destinationStationid} already exists.`,
    );
  }

  if (!createNewStation && !destinationDoc) {
    throw new functions.https.HttpsError(
        "not-found",
        `Destination station ${destinationStationid} was not found.`,
    );
  }

  if (destinationDoc) {
    const destinationModules = Array.isArray(destinationDoc.data()?.modules) ?
      destinationDoc.data().modules :
      [];
    if (destinationModules.some((module) => moduleIdsMatch(module?.id, moduleId))) {
      throw new functions.https.HttpsError(
          "already-exists",
          `Module ${moduleId} is already bound to ${destinationStationid}.`,
      );
    }
  }

  const destinationProvisionid = createNewStation ?
    findNextProvisionId(snapshot.docs) :
    extractProvisionId(destinationDoc);
  const sourceRef = sourceDoc.ref;
  const destinationRef = createNewStation ?
    db.collection("kiosks").doc(destinationProvisionid) :
    destinationDoc.ref;
  const pendingRef = db.collection("pending").doc(moduleId);

  await db.runTransaction(async (transaction) => {
    const reads = [transaction.get(sourceRef), transaction.get(pendingRef)];
    if (createNewStation || destinationRef.path !== sourceRef.path) {
      reads.push(transaction.get(destinationRef));
    }
    if (createNewStation) {
      reads.push(transaction.get(
          db.collection("kiosks")
              .where("stationid", "==", destinationStationid)
              .limit(1),
      ));
    }

    const [sourceSnap, pendingSnap, destinationSnap, destinationStationSnap] =
      await Promise.all(reads);

    if (!sourceSnap.exists) {
      throw new functions.https.HttpsError(
          "not-found",
          `Source station ${sourceStationid} no longer exists.`,
      );
    }

    const liveSource = sourceSnap.data() || {};
    const liveSourceModules = Array.isArray(liveSource.modules) ?
      liveSource.modules :
      [];
    const movedModule = liveSourceModules.find(
        (module) => moduleIdsMatch(module?.id, moduleId),
    );

    if (!movedModule) {
      throw new functions.https.HttpsError(
          "not-found",
          `Module ${moduleId} is no longer attached to ${sourceStationid}.`,
      );
    }

    const remainingModules = liveSourceModules.filter(
        (module) => !moduleIdsMatch(module?.id, moduleId),
    );

    if (createNewStation) {
      if (destinationStationSnap && !destinationStationSnap.empty) {
        throw new functions.https.HttpsError(
            "already-exists",
            `Station ${destinationStationid} already exists.`,
        );
      }

      if (destinationSnap?.exists) {
        throw new functions.https.HttpsError(
            "aborted",
            `Provision ${destinationProvisionid} already exists. Retry move.`,
        );
      }

      transaction.set(
          destinationRef,
          createBoundKioskDocument({
            provisionid: destinationProvisionid,
            stationid: destinationStationid,
            moduleId,
            country: destinationCountry,
            actorUid: authState.uid,
            moduleData: movedModule,
            templateKiosk: liveSource,
            kioskType: destinationKioskType || getRequestedKioskType(data, destinationStationid),
          }),
          {merge: true},
      );
    } else {
      if (!destinationSnap?.exists) {
        throw new functions.https.HttpsError(
            "not-found",
            `Destination station ${destinationStationid} no longer exists.`,
        );
      }

      const liveDestination = destinationSnap.data() || {};
      const destinationModules = Array.isArray(liveDestination.modules) ?
        liveDestination.modules :
        [];

      if (destinationModules.some((module) => moduleIdsMatch(module?.id, moduleId))) {
        throw new functions.https.HttpsError(
            "already-exists",
            `Module ${moduleId} is already bound to ${destinationStationid}.`,
        );
      }

      const updatedDestination = recalculateKioskTotals({
        ...liveDestination,
        modules: [...destinationModules, clonePlain(movedModule)],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        binding: {
          ...(liveDestination.binding || {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: authState.uid,
          movedAt: admin.firestore.FieldValue.serverTimestamp(),
          movedBy: authState.uid,
        },
      });

      transaction.set(destinationRef, updatedDestination, {merge: true});
    }

    if (remainingModules.length === 0) {
      transaction.delete(sourceRef);
    } else {
      const updatedSource = recalculateKioskTotals({
        ...liveSource,
        modules: remainingModules,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        binding: {
          ...(liveSource.binding || {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: authState.uid,
          movedAt: admin.firestore.FieldValue.serverTimestamp(),
          movedBy: authState.uid,
        },
      });
      transaction.set(sourceRef, updatedSource, {merge: true});
    }

    if (pendingSnap?.exists) {
      transaction.delete(pendingRef);
    }
  });

  const followingStation = createNewStation ?
    findNextStationId(
        [...snapshot.docs, {id: destinationStationid, data: () => ({stationid: destinationStationid})}],
        destinationCountry,
        destinationReservedStationIds,
        {kioskType: destinationKioskType || getRequestedKioskType(data, destinationStationid)},
    ) :
    null;

  return {
    ok: true,
    sourceStationid,
    destinationStationid,
    destinationProvisionid,
    moduleId,
    createNewStation,
    qrUrl: buildQrUrl(destinationStationid),
    nextStationid: followingStation,
    nextQrUrl: followingStation ? buildQrUrl(followingStation) : "",
    message: `Module ${moduleId} moved from ${sourceStationid} to ${destinationStationid}.`,
  };
}

exports.admin_listUsers = functions.https.onCall(async (data, context) => {
  await assertAdminFromContext(context);
  return listUsersImpl();
});

exports.admin_deleteUser = functions.https.onCall(async (data, context) => {
  await assertAdminFromContext(context);
  return deleteUserImpl(data);
});

exports.admin_upsertUserProfile = functions.https.onCall(async (data, context) => {
  await assertAdminFromContext(context);
  return upsertUserProfileImpl(data);
});

exports.admin_createAuthUserAndProfile = functions.https.onCall(async (data, context) => {
  await assertAdminFromContext(context);
  return createAuthUserAndProfileImpl(data);
});

exports.admin_setUserPassword = functions.https.onCall(async (data, context) => {
  await assertAdminFromContext(context);
  return setUserPasswordImpl(data);
});

exports.media_listAssets = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageMediaFromContext(context);
  return mediaListAssetsImpl(authState, data);
});

exports.media_httpListAssets = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageMedia(req, data);
  return mediaListAssetsImpl(authState, data);
});

exports.media_createUploadUrl = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageMediaFromContext(context);
  return mediaCreateUploadUrlImpl(data, authState, context?.rawRequest || null);
});

exports.media_httpCreateUploadUrl = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageMedia(req, data);
  return mediaCreateUploadUrlImpl(data, authState, req);
});

exports.media_finalizeUpload = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageMediaFromContext(context);
  return mediaFinalizeUploadImpl(data, authState);
});

exports.media_httpFinalizeUpload = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageMedia(req, data);
  return mediaFinalizeUploadImpl(data, authState);
});

exports.media_archiveAsset = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageMediaFromContext(context);
  return mediaArchiveAssetImpl(data, authState);
});

exports.media_httpArchiveAsset = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageMedia(req, data);
  return mediaArchiveAssetImpl(data, authState);
});

exports.media_deleteAsset = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageMediaFromContext(context);
  return mediaDeleteAssetImpl(data, authState);
});

exports.media_httpDeleteAsset = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageMedia(req, data);
  return mediaDeleteAssetImpl(data, authState);
});

exports.media_assignPlaylist = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageMediaFromContext(context);
  return mediaAssignPlaylistImpl(data, authState);
});

exports.media_httpAssignPlaylist = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageMedia(req, data);
  return mediaAssignPlaylistImpl(data, authState);
});

exports.aiBooths_listEvents = functions.https.onCall(async (data, context) => {
  await assertCanManageAiBoothsFromContext(context);
  return aiBoothsListEventsImpl(data);
});

exports.aiBooths_httpListEvents = handleHttpFunction(async (data, req) => {
  await assertCanManageAiBooths(req, data);
  return aiBoothsListEventsImpl(data);
});

exports.aiBooths_listInstalls = functions.https.onCall(async (data, context) => {
  await assertCanManageAiBoothsFromContext(context);
  return aiBoothsListInstallsImpl(data);
});

exports.aiBooths_httpListInstalls = handleHttpFunction(async (data, req) => {
  await assertCanManageAiBooths(req, data);
  return aiBoothsListInstallsImpl(data);
});

exports.aiBooths_listSlashGolfTournaments = functions.runWith({
  secrets: [SLASH_GOLF_RAPIDAPI_KEY],
}).https.onCall(async (data, context) => {
  await assertCanManageAiBoothsFromContext(context);
  return aiBoothsListSlashGolfTournamentsImpl(data);
});

exports.aiBooths_httpListSlashGolfTournaments = handleHttpFunction(async (data, req) => {
  await assertCanManageAiBooths(req, data);
  return aiBoothsListSlashGolfTournamentsImpl(data);
}, {
  secrets: [SLASH_GOLF_RAPIDAPI_KEY],
});

exports.aiBooths_listIntakeSubmissions = functions.https.onCall(async (data, context) => {
  await assertCanManageAiBoothsFromContext(context);
  return aiBoothsListIntakeSubmissionsImpl(data);
});

exports.aiBooths_httpListIntakeSubmissions = handleHttpFunction(async (data, req) => {
  await assertCanManageAiBooths(req, data);
  return aiBoothsListIntakeSubmissionsImpl(data);
});

exports.aiBooths_updateIntakeSubmission = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageAiBoothsFromContext(context);
  return aiBoothsUpdateIntakeSubmissionImpl(data, authState);
});

exports.aiBooths_httpUpdateIntakeSubmission = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageAiBooths(req, data);
  return aiBoothsUpdateIntakeSubmissionImpl(data, authState);
});

exports.aiBooths_deleteIntakeSubmission = functions.https.onCall(async (data, context) => {
  await assertCanManageAiBoothsFromContext(context);
  return aiBoothsDeleteIntakeSubmissionImpl(data);
});

exports.aiBooths_httpDeleteIntakeSubmission = handleHttpFunction(async (data, req) => {
  await assertCanManageAiBooths(req, data);
  return aiBoothsDeleteIntakeSubmissionImpl(data);
});

exports.aiBooths_createIntakeFileReadUrl = functions.https.onCall(async (data, context) => {
  await assertCanManageAiBoothsFromContext(context);
  return aiBoothsCreateIntakeFileReadUrlImpl(data);
});

exports.aiBooths_httpCreateIntakeFileReadUrl = handleHttpFunction(async (data, req) => {
  await assertCanManageAiBooths(req, data);
  return aiBoothsCreateIntakeFileReadUrlImpl(data);
});

exports.aiBooths_saveEvent = functions.runWith({
  secrets: [EVENT_INTAKE_SECRET],
}).https.onCall(async (data, context) => {
  const authState = await assertCanManageAiBoothsFromContext(context);
  return aiBoothsSaveEventImpl(data, authState);
});

exports.aiBooths_saveInstall = functions.runWith({
  secrets: [EVENT_INTAKE_SECRET],
}).https.onCall(async (data, context) => {
  const authState = await assertCanManageAiBoothsFromContext(context);
  return aiBoothsSaveInstallImpl(data, authState);
});

exports.aiBooths_httpSaveEvent = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageAiBooths(req, data);
  return aiBoothsSaveEventImpl(data, authState);
}, {
  secrets: [EVENT_INTAKE_SECRET],
});

exports.aiBooths_httpSaveInstall = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageAiBooths(req, data);
  return aiBoothsSaveInstallImpl(data, authState);
}, {
  secrets: [EVENT_INTAKE_SECRET],
});

exports.aiBooths_httpRegisterPendingKiosk = handleHttpFunction(async (data) => (
  aiBoothsRegisterPendingKioskImpl(data)
));

exports.aiBooths_httpDeletePendingKioskRegistration = handleHttpFunction(async (data) => (
  aiBoothsDeletePendingKioskRegistrationImpl(data)
));

exports.aiBooths_httpGetDeviceConfig = handleHttpFunction(async (data) => (
  aiBoothsGetDeviceConfigImpl(data)
));

exports.aiBooths_httpDeviceHeartbeat = handleHttpFunction(async (data) => (
  aiBoothsDeviceHeartbeatImpl(data)
));

exports.aiBooths_provisionPendingKiosk = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageAiBoothsFromContext(context);
  return aiBoothsProvisionPendingKioskImpl(data, authState);
});

exports.aiBooths_httpProvisionPendingKiosk = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageAiBooths(req, data);
  return aiBoothsProvisionPendingKioskImpl(data, authState);
});

exports.aiBooths_listElevenLabsAgents = functions.runWith({
  secrets: [ELEVENLABS_API_KEY],
}).https.onCall(async (data, context) => {
  await assertCanManageAiBoothsFromContext(context);
  return aiBoothsListElevenLabsAgentsImpl(data);
});

exports.aiBooths_httpListElevenLabsAgents = handleHttpFunction(async (data, req) => {
  await assertCanManageAiBooths(req, data);
  return aiBoothsListElevenLabsAgentsImpl(data);
}, {
  secrets: [ELEVENLABS_API_KEY],
});

exports.aiBooths_publishAgent = functions.runWith({
  secrets: [ELEVENLABS_API_KEY],
}).https.onCall(async (data, context) => {
  const authState = await assertCanManageAiBoothsFromContext(context);
  return aiBoothsPublishAgentImpl(data, authState);
});

exports.aiBooths_publishInstall = functions.runWith({
  secrets: [ELEVENLABS_API_KEY],
}).https.onCall(async (data, context) => {
  const authState = await assertCanManageAiBoothsFromContext(context);
  return aiBoothsPublishInstallImpl(data, authState);
});

exports.aiBooths_httpPublishAgent = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageAiBooths(req, data);
  return aiBoothsPublishAgentImpl(data, authState);
}, {
  secrets: [ELEVENLABS_API_KEY],
});

exports.aiBooths_httpPublishInstall = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageAiBooths(req, data);
  return aiBoothsPublishInstallImpl(data, authState);
}, {
  secrets: [ELEVENLABS_API_KEY],
});

exports.auth_trackAttempt = functions.https.onCall(async (data, context) => (
  trackLoginAttemptImpl(data, context?.rawRequest || null)
));

exports.auth_syncOwnClaims = functions.https.onCall(async (data, context) => {
  const authState = await getAuthorizedProfileFromContext(context);
  return syncOwnClaimsImpl(authState);
});

exports.admin_unlockUser = functions.https.onCall(async (data, context) => {
  await assertAdminFromContext(context);
  return unlockUserImpl(data);
});

exports.admin_httpListUsers = handleHttpFunction(async (data, req) => {
  await assertAdmin(req, data);
  return listUsersImpl();
});

exports.admin_httpDeleteUser = handleHttpFunction(async (data, req) => {
  await assertAdmin(req, data);
  return deleteUserImpl(data);
});

exports.admin_httpUpsertUserProfile = handleHttpFunction(async (data, req) => {
  await assertAdmin(req, data);
  return upsertUserProfileImpl(data);
});

exports.admin_httpCreateAuthUserAndProfile = handleHttpFunction(async (data, req) => {
  await assertAdmin(req, data);
  return createAuthUserAndProfileImpl(data);
});

exports.admin_httpSetUserPassword = handleHttpFunction(async (data, req) => {
  await assertAdmin(req, data);
  return setUserPasswordImpl(data);
});

exports.auth_httpTrackAttempt = handleHttpFunction(async (data, req) => (
  trackLoginAttemptImpl(data, req)
));

exports.auth_httpSyncOwnClaims = handleHttpFunction(async (data, req) => {
  const authState = await getAuthorizedProfileFromRequest(req, data);
  return syncOwnClaimsImpl(authState);
});

exports.admin_httpUnlockUser = handleHttpFunction(async (data, req) => {
  await assertAdmin(req, data);
  return unlockUserImpl(data);
});

exports.admin_upsertUser = exports.admin_upsertUserProfile;

exports.kiosk_updateSection = functions.runWith({
  secrets: [GOOGLE_MAPS_SECRET],
}).https.onCall(async (data, context) => {
  const authState = await getAuthorizedProfileFromContext(context);
  return kioskUpdateSectionImpl(data, authState);
});

exports.kiosk_httpUpdateSection = handleHttpFunction(
    async (data, req) => {
      const authState = await getAuthorizedProfileFromRequest(req, data);
      return kioskUpdateSectionImpl(data, authState);
    },
    {secrets: [GOOGLE_MAPS_SECRET]},
);

exports.kiosk_updateSlotLock = functions.https.onCall(async (data, context) => {
  const authState = await getAuthorizedProfileFromContext(context);
  return kioskUpdateSlotLockImpl(data, authState);
});

exports.kiosk_httpUpdateSlotLock = handleHttpFunction(async (data, req) => {
  const authState = await getAuthorizedProfileFromRequest(req, data);
  return kioskUpdateSlotLockImpl(data, authState);
});

exports.stationBinding_getNextStation = functions.https.onCall(async (data, context) => {
  await assertCanManageBindingsFromContext(context);
  return stationBindingGetNextStationImpl(data);
});

exports.stationBinding_listStationReservations = functions.https.onCall(async (data, context) => {
  await assertCanManageBindingsFromContext(context);
  return stationBindingListStationReservationsImpl(data);
});

exports.stationBinding_setStationReservation = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageBindingsFromContext(context);
  return stationBindingSetStationReservationImpl(data, authState);
});

exports.stationBinding_bindModule = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageBindingsFromContext(context);
  return stationBindingBindModuleImpl(data, authState);
});

exports.stationBinding_unbindModule = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageBindingsFromContext(context);
  return stationBindingUnbindModuleImpl(data, authState);
});

exports.stationBinding_httpGetNextStation = handleHttpFunction(async (data, req) => {
  await assertCanManageBindings(req, data);
  return stationBindingGetNextStationImpl(data);
});

exports.stationBinding_httpListStationReservations = handleHttpFunction(async (data, req) => {
  await assertCanManageBindings(req, data);
  return stationBindingListStationReservationsImpl(data);
});

exports.stationBinding_httpSetStationReservation = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageBindings(req, data);
  return stationBindingSetStationReservationImpl(data, authState);
});

exports.stationBinding_httpBindModule = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageBindings(req, data);
  return stationBindingBindModuleImpl(data, authState);
});

exports.stationBinding_httpUnbindModule = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageBindings(req, data);
  return stationBindingUnbindModuleImpl(data, authState);
});

exports.stationBinding_moveModule = functions.https.onCall(async (data, context) => {
  const authState = await assertAdminFromContext(context);
  return stationBindingMoveModuleImpl(data, authState);
});

exports.stationBinding_httpMoveModule = handleHttpFunction(async (data, req) => {
  const authState = await assertAdmin(req, data);
  return stationBindingMoveModuleImpl(data, authState);
});

exports.rbcOpenApi = rbcOpenApi;
