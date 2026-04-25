/* eslint-env node */
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const crypto = require("node:crypto");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const STORAGE_BUCKET = "node-red-alerts.firebasestorage.app";
const STORAGE_BUCKET_CANDIDATES = Array.from(new Set([
  STORAGE_BUCKET,
  "chargerent-backup",
  "node-red-alerts.appspot.com",
]));

const AUTH_MAPPING_DOMAIN = "auth.charge.rent";
const STATION_SEQUENCE_START = 8000;
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

function normalizeAiBoothTopic(topic, index) {
  if (!isPlainObject(topic)) {
    return {
      id: `topic-${index + 1}`,
      title: `Topic ${index + 1}`,
      summary: "",
      notes: "",
      checklistText: "",
    };
  }

  const title = cleanAiBoothText(topic.title, 120);
  return {
    id: cleanAiBoothText(topic.id, 160) || `topic-${index + 1}`,
    title: title || `Topic ${index + 1}`,
    summary: cleanAiBoothText(topic.summary, 2000),
    notes: cleanAiBoothText(topic.notes, 8000),
    checklistText: cleanAiBoothText(topic.checklistText, 4000),
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

  return {
    id: String(snapshot?.id || data.id || "").trim(),
    general: {
      eventName: cleanAiBoothText(general.eventName, 140),
      address: cleanAiBoothText(general.address, 300),
      wifiUsername: cleanAiBoothText(general.wifiUsername, 120),
      wifiPassword: cleanAiBoothText(general.wifiPassword, 120),
      startDate: cleanAiBoothText(general.startDate, 32),
      endDate: cleanAiBoothText(general.endDate, 32),
      openingHours: cleanAiBoothText(general.openingHours, 32),
      closingHours: cleanAiBoothText(general.closingHours, 32),
      notes: cleanAiBoothText(general.notes, 8000),
    },
    boothStationIds: Array.isArray(data.boothStationIds) ?
      data.boothStationIds
          .map((value) => cleanAiBoothText(value, 80))
          .filter(Boolean) :
      [],
    topics: Array.isArray(data.topics) ?
      data.topics.map((topic, index) => normalizeAiBoothTopic(topic, index)) :
      [],
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
    active: asset.active !== false,
    createdAt: serializeFirestoreTimestamp(asset.createdAt),
    updatedAt: serializeFirestoreTimestamp(asset.updatedAt),
    targetType: String(asset.targetType || "CK48"),
  };
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
  if (value === "CA" || value === "CAN") return "CA";
  if (value === "FR" || value === "EUR") return "FR";
  return "US";
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

function findNextStationId(docSnaps, country, reservedStationIds = []) {
  const prefix = prefixForCountry(country);
  let next = STATION_SEQUENCE_START;
  const occupiedNumbers = buildReservedStationSequenceSet(
      reservedStationIds,
      prefix,
  );

  docSnaps.forEach((docSnap) => {
    const stationid = extractStationId(docSnap);
    const match = stationid.match(new RegExp(`^${prefix}(\\d{4})$`));
    if (match) {
      const stationNumber = Number(match[1]);
      occupiedNumbers.add(stationNumber);
      next = Math.max(next, stationNumber + 1);
    }
  });

  while (occupiedNumbers.has(next)) {
    next += 1;
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

  return {
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

  if (!assetId || !fileName || !storagePath) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "assetId, fileName, and storagePath are required",
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

function getDefaultBoundKioskHardware(templateKiosk = null) {
  const templateHardware = clonePlain(templateKiosk?.hardware) || {};
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

  delete hardware.type;

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
    hardware: getDefaultBoundKioskHardware(templateKiosk),
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

async function aiBoothsListEventsImpl() {
  const snapshot = await db.collection("aiBoothEvents").get();
  const events = snapshot.docs
      .map((docSnapshot) => serializeAiBoothEvent(docSnapshot))
      .sort(compareAiBoothEvents);

  return {events};
}

async function aiBoothsSaveEventImpl(data, authState) {
  const eventInput = isPlainObject(data?.event) ? data.event : null;
  if (!eventInput) {
    throw new functions.https.HttpsError("invalid-argument", "event is required");
  }

  const generalInput = isPlainObject(eventInput.general) ? eventInput.general : {};
  const eventName = cleanAiBoothText(generalInput.eventName, 140);
  if (!eventName) {
    throw new functions.https.HttpsError("invalid-argument", "event name is required");
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

  const cleanEvent = {
    general: {
      eventName,
      address: cleanAiBoothText(generalInput.address, 300),
      wifiUsername: cleanAiBoothText(generalInput.wifiUsername, 120),
      wifiPassword: cleanAiBoothText(generalInput.wifiPassword, 120),
      startDate: cleanAiBoothText(generalInput.startDate, 32),
      endDate: cleanAiBoothText(generalInput.endDate, 32),
      openingHours: cleanAiBoothText(generalInput.openingHours, 32),
      closingHours: cleanAiBoothText(generalInput.closingHours, 32),
      notes: cleanAiBoothText(generalInput.notes, 8000),
    },
    boothStationIds,
    topics,
    boothCount: boothStationIds.length,
    topicCount: topics.length,
    updatedBy: actor,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const requestedId = cleanAiBoothText(data?.eventId || eventInput.id, 160)
      .replace(/[^a-zA-Z0-9_-]/g, "");
  const eventRef = requestedId ?
    db.collection("aiBoothEvents").doc(requestedId) :
    db.collection("aiBoothEvents").doc();
  const existingSnapshot = await eventRef.get();

  if (!existingSnapshot.exists) {
    cleanEvent.createdBy = actor;
    cleanEvent.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await eventRef.set(cleanEvent, {merge: true});

  const savedSnapshot = await eventRef.get();
  return {
    ok: true,
    event: serializeAiBoothEvent(savedSnapshot),
  };
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
  const snapshot = await db.collection("kiosks").get();
  const reservations = await getActiveStationReservations(country);
  const stationid = findNextStationId(
      snapshot.docs,
      country,
      buildReservedStationIdSet(reservations),
  );

  return {
    ok: true,
    country,
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
  );
  const provisionid = findNextProvisionId(snapshot.docs);
  const stationid = requestedStationId || nextStationid;

  if (stationid !== nextStationid) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        buildStationReservationConflictMessage(
            stationid,
            nextStationid,
            reservations,
        ),
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
    const stationSnap = await transaction.get(docRef);
    if (stationSnap.exists) {
      throw new functions.https.HttpsError(
          "already-exists",
          `Station ${stationid} already exists.`,
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
        }),
        {merge: true},
    );
    transaction.delete(pendingRef);
  });

  const followingStation = findNextStationId(
      [...snapshot.docs, {id: stationid, data: () => ({stationid})}],
      country,
      reservedStationIds,
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

  if (createNewStation && destinationStationid !== nextStationid) {
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

    const [sourceSnap, pendingSnap, destinationSnap] = await Promise.all(reads);

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
      if (destinationSnap?.exists) {
        throw new functions.https.HttpsError(
            "already-exists",
            `Station ${destinationStationid} already exists.`,
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

exports.aiBooths_saveEvent = functions.https.onCall(async (data, context) => {
  const authState = await assertCanManageAiBoothsFromContext(context);
  return aiBoothsSaveEventImpl(data, authState);
});

exports.aiBooths_httpSaveEvent = handleHttpFunction(async (data, req) => {
  const authState = await assertCanManageAiBooths(req, data);
  return aiBoothsSaveEventImpl(data, authState);
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
