/* eslint-env node */
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const AUTH_MAPPING_DOMAIN = "auth.charge.rent";
const STATION_SEQUENCE_START = 8000;
const DEFAULT_KIOSK_POWER_THRESHOLD = 80;
const DEFAULT_MARKETING_OPTIONS = {
  active: false,
  title: "Get the Rogers app",
  offerText: "Manage your account, pay your bill and get exclusive offers all in one place.",
  buttonText: "Download now",
  buttonUrl: "https://www.rogers.com/support/apps",
};
const DEFAULT_ANALYTICS_OPTIONS = {
  active: false,
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

  if (authState.isAdmin || features.binding === true || commands.binding === true) {
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

  if (authState.isAdmin || features.binding === true || commands.binding === true) {
    return authState;
  }

  throw new functions.https.HttpsError(
      "permission-denied",
      "Not allowed to manage bindings",
  );
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

function findNextStationId(docSnaps, country) {
  const prefix = prefixForCountry(country);
  let next = STATION_SEQUENCE_START;

  docSnaps.forEach((docSnap) => {
    const stationid = extractStationId(docSnap);
    const match = stationid.match(new RegExp(`^${prefix}(\\d{4})$`));
    if (match) {
      next = Math.max(next, Number(match[1]) + 1);
    }
  });

  return `${prefix}${String(next).padStart(4, "0")}`;
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
  const allowedSections = new Set(["info", "formoptions", "marketingoptions", "analyticsoptions", "hardware", "pricing", "ui"]);

  if (!stationid) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "stationid required",
    );
  }

  if (!allowedSections.has(section)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "section must be one of info, formoptions, marketingoptions, analyticsoptions, hardware, pricing, ui",
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

    transaction.set(docRef, updateData, {merge: true});

    const message = geocoded ?
      `${section} updated for ${stationid}. Address geocoded.` :
      `${section} updated for ${stationid}.`;

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
    marketingoptions: {
      active: templateKiosk?.marketingoptions?.active === true,
      title: String(templateKiosk?.marketingoptions?.title ?? DEFAULT_MARKETING_OPTIONS.title).trim(),
      offerText: String(templateKiosk?.marketingoptions?.offerText ?? DEFAULT_MARKETING_OPTIONS.offerText).trim(),
      buttonText: String(templateKiosk?.marketingoptions?.buttonText ?? DEFAULT_MARKETING_OPTIONS.buttonText).trim(),
      buttonUrl: String(templateKiosk?.marketingoptions?.buttonUrl ?? DEFAULT_MARKETING_OPTIONS.buttonUrl).trim(),
    },
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
  const stationid = findNextStationId(snapshot.docs, country);

  return {
    ok: true,
    country,
    stationid,
    qrUrl: buildQrUrl(stationid),
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

  const snapshot = await db.collection("kiosks").get();
  const nextStationid = findNextStationId(snapshot.docs, country);
  const provisionid = findNextProvisionId(snapshot.docs);
  const stationid = requestedStationId || nextStationid;

  if (stationid !== nextStationid) {
    throw new functions.https.HttpsError(
        "failed-precondition",
        `Station ${stationid} is no longer available. Next station is ${nextStationid}.`,
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

  const nextStationid = findNextStationId(
      snapshot.docs,
      requestedCountry || getCountryFromStationId(stationid) || "US",
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

  const nextStationid = createNewStation ?
    findNextStationId(snapshot.docs, destinationCountry) :
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
        `Station ${destinationStationid} is no longer available. Next station is ${nextStationid}.`,
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
