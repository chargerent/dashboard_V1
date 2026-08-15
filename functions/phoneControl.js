/* eslint-env node */
const crypto = require("node:crypto");
const {HttpsError} = require("firebase-functions/v2/https");

const DEVICES_COLLECTION = "phoneDevices";
const COMMANDS_COLLECTION = "phoneDeviceCommands";
const ENROLLMENTS_COLLECTION = "phoneDeviceEnrollments";
const ASSIGNMENTS_COLLECTION = "phoneKioskAssignments";

const COMMAND_TTL_MS = 2 * 60 * 1000;
const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
const ENROLLMENT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ENROLLMENT_CODE_LENGTH = 6;
const LEGACY_ENROLLMENT_CODE_LENGTH = 8;
const AGENT_RELEASE_HOST = "chargerentstations.com";
const DEVICE_REQUEST_CLOCK_SKEW_MS = 2 * 60 * 1000;
const TURN_CREDENTIAL_TTL_SECONDS = 10 * 60;
const TURN_SERVER_HOST = "turn.chargerentstations.com";
const PHONE_WEBRTC_STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];
const PHONE_WEBRTC_TURN_URLS = [
  `turns:${TURN_SERVER_HOST}:5349?transport=tcp`,
  `turns:${TURN_SERVER_HOST}:5349?transport=udp`,
];

const ALLOWED_OPERATIONS = new Set([
  "PING",
  "GET_INVENTORY",
  "GET_LOCATION",
  "SET_LOCATION_ENABLED",
  "SET_WIFI_ENABLED",
  "SCAN_WIFI_NETWORKS",
  "CONNECT_WIFI",
  "OPEN_CAPTIVE_PORTAL",
  "SET_ALWAYS_ON_HOTSPOT",
  "OPEN_TETHER_SETTINGS",
  "SET_BLUETOOTH_ENABLED",
  "LOCK_NOW",
  "WAKE_AND_UNLOCK",
  "REBOOT",
  "SET_UPDATE_POLICY",
  "SET_SCREEN_BRIGHTNESS",
  "SET_SCREEN_TIMEOUT",
  "SET_AUTOMATIC_TIME",
  "SET_TIME_ZONE",
  "SET_KEYGUARD_DISABLED",
  "SET_KIOSK_ALLOWLIST",
  "SET_APP_HIDDEN",
  "SET_APP_SUSPENDED",
  "SET_RUNTIME_PERMISSION",
  "REQUEST_BUGREPORT",
  "SET_NETWORK_LOGGING",
  "SET_SECURITY_LOGGING",
  "UI_TAP",
  "UI_SWIPE",
  "UI_GLOBAL_ACTION",
  "UI_SET_FOCUSED_TEXT",
  "CAPTURE_SCREEN",
  "START_LIVE_SCREEN",
  "STOP_LIVE_SCREEN",
  "START_WEBRTC_SCREEN",
  "SET_WEBRTC_PROFILE",
  "STOP_WEBRTC_SCREEN",
  "INSTALL_SYSTEM_UPDATE",
  "INSTALL_APP_UPDATE",
  "WIPE_DEVICE",
]);

const HIGH_IMPACT_OPERATIONS = new Set([
  "REBOOT",
  "REQUEST_BUGREPORT",
  "INSTALL_SYSTEM_UPDATE",
  "INSTALL_APP_UPDATE",
  "WIPE_DEVICE",
]);

function isPhoneControlAdmin(authState) {
  const username = String(authState?.profile?.username || "").trim().toLowerCase();
  const role = String(authState?.profile?.role || "").trim().toLowerCase();
  return authState?.isAdmin === true || role === "admin" || username === "chargerent";
}

function hasPhoneControlAccess(authState) {
  return isPhoneControlAdmin(authState) || authState?.profile?.features?.phone_control === true;
}

function assertPhoneControlAccess(authState) {
  if (!hasPhoneControlAccess(authState)) {
    throw new HttpsError("permission-denied", "Phone Control is not enabled for this account.");
  }
  return authState;
}

function normalizeAccountId(value) {
  return String(value || "").trim().toLowerCase();
}

function canAccessKiosk(authState, kioskData) {
  if (isPhoneControlAdmin(authState)) return true;
  if (!hasPhoneControlAccess(authState)) return false;

  const clientId = normalizeAccountId(authState?.profile?.clientId);
  if (!clientId) return false;
  const role = String(authState?.profile?.role || "").trim().toLowerCase();
  const isPartner = authState?.profile?.partner === true || role === "partner";
  const kioskOwner = isPartner ? kioskData?.info?.rep : kioskData?.info?.client;
  return normalizeAccountId(kioskOwner) === clientId;
}

function invalidArgument(message) {
  throw new HttpsError("invalid-argument", message);
}

function normalizeDeviceId(value) {
  const deviceId = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(deviceId)) {
    invalidArgument("A valid phone device ID is required.");
  }
  return deviceId;
}

function normalizeStationId(value) {
  const stationId = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{2,4}\d{3,5}$/.test(stationId)) {
    invalidArgument("A valid kiosk station ID is required.");
  }
  return stationId;
}

function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{12,180}$/.test(requestId)) {
    invalidArgument("A valid command request ID is required.");
  }
  return requestId;
}

function normalizeOperation(value) {
  const operation = String(value || "").trim().toUpperCase();
  if (!ALLOWED_OPERATIONS.has(operation)) {
    invalidArgument("This phone operation is not supported.");
  }
  return operation;
}

function normalizeArguments(value, maxBytes = 16 * 1024) {
  const input = value == null ? {} : value;
  if (!input || Array.isArray(input) || typeof input !== "object") {
    invalidArgument("Command arguments must be a JSON object.");
  }

  let clean;
  try {
    clean = JSON.parse(JSON.stringify(input));
  } catch {
    invalidArgument("Command arguments must be valid JSON.");
  }

  if (Buffer.byteLength(JSON.stringify(clean), "utf8") > maxBytes) {
    invalidArgument("Command arguments are too large.");
  }
  return clean;
}

function normalizeWebRtcStartArguments(value) {
  const input = normalizeArguments(value, 128 * 1024);
  const source = Array.isArray(input.iceServers) ? input.iceServers : [];
  let hasTurn = false;
  const iceServers = source.flatMap((server) => {
    if (!server || Array.isArray(server) || typeof server !== "object") return [];
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
        .map((url) => String(url || "").trim())
        .filter((url) => PHONE_WEBRTC_STUN_URLS.includes(url) || PHONE_WEBRTC_TURN_URLS.includes(url));
    if (!urls.length) return [];

    const includesTurn = urls.some((url) => PHONE_WEBRTC_TURN_URLS.includes(url));
    if (!includesTurn) return [{urls}];

    const username = String(server.username || "").trim();
    const credential = String(server.credential || "").trim();
    if (!username || !credential || username.length > 180 || credential.length > 180) return [];
    hasTurn = true;
    return [{urls, username, credential}];
  });

  if (!hasTurn) {
    throw new HttpsError(
        "failed-precondition",
        "This dashboard is out of date. Refresh the page before starting live screen.",
    );
  }
  return {...input, iceServers};
}

function normalizeAppUpdateArguments(value) {
  const input = normalizeArguments(value);
  let packageUrl;
  try {
    packageUrl = new URL(String(input.httpsUrl || "").trim());
  } catch {
    invalidArgument("A valid Agent update URL is required.");
  }
  if (packageUrl.protocol !== "https:" || packageUrl.hostname !== AGENT_RELEASE_HOST ||
      packageUrl.port || packageUrl.username || packageUrl.password || packageUrl.search ||
      packageUrl.hash ||
      !/^\/portal\/mdm\/remote-agent-v\d+\.\d+\.\d+\.apk$/.test(packageUrl.pathname)) {
    invalidArgument("Only official Chargerent Agent releases can be installed.");
  }

  const sha256 = String(input.sha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    invalidArgument("A valid Agent package SHA-256 is required.");
  }
  const versionCode = Number(input.versionCode);
  const versionName = String(input.versionName || "").trim();
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 ||
      !/^\d+\.\d+\.\d+$/.test(versionName)) {
    invalidArgument("A valid Agent release version is required.");
  }
  return {
    httpsUrl: packageUrl.toString(),
    sha256,
    versionCode,
    versionName,
  };
}

function normalizeHotspotArguments(value) {
  const input = normalizeArguments(value);
  if (typeof input.enabled !== "boolean") {
    invalidArgument("Always-on hotspot requires an enabled value.");
  }
  return {enabled: input.enabled};
}

function parseCommandEncryptionPublicKey(publicKeyBase64) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(String(publicKeyBase64 || ""), "base64"),
      type: "spki",
      format: "der",
    });
    const details = publicKey.asymmetricKeyDetails || {};
    if (publicKey.asymmetricKeyType !== "rsa" || Number(details.modulusLength || 0) < 2048) {
      invalidArgument("The phone command-encryption key is invalid.");
    }
    return publicKey;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
        "failed-precondition",
        "Update Agent on this phone before joining Wi-Fi remotely.",
    );
  }
}

function normalizeConnectWifiArguments(value, publicKeyBase64) {
  const input = normalizeArguments(value);
  const ssid = String(input.ssid || "").trim();
  const ssidBytes = Buffer.byteLength(ssid, "utf8");
  if (!ssid || ssidBytes > 32) invalidArgument("Choose a valid Wi-Fi network name.");

  const requestedSecurity = String(input.security || "").trim().toLowerCase();
  const security = requestedSecurity === "wpa2_wpa3" ? "wpa2" : requestedSecurity;
  if (!["open", "wpa2", "wpa3"].includes(security)) {
    invalidArgument("This Wi-Fi security type cannot be joined remotely.");
  }

  const normalized = {ssid, security};
  if (security === "open") return normalized;

  const passphrase = String(input.passphrase || "");
  const passphraseBytes = Buffer.byteLength(passphrase, "utf8");
  if (passphraseBytes < 8 || passphraseBytes > 63) {
    invalidArgument("Wi-Fi passwords must contain 8 to 63 characters.");
  }
  const encrypted = crypto.publicEncrypt({
    key: parseCommandEncryptionPublicKey(publicKeyBase64),
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, Buffer.from(JSON.stringify({passphrase}), "utf8"));
  normalized.encryptedCredentials = {
    algorithm: "RSA-OAEP-256",
    ciphertext: encrypted.toString("base64"),
  };
  return normalized;
}

function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${jsonStringForAndroid(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidArgument("Command arguments contain an invalid number.");
    return String(value);
  }
  return typeof value === "string" ? jsonStringForAndroid(value) : JSON.stringify(value);
}

function jsonStringForAndroid(value) {
  return JSON.stringify(String(value)).replaceAll("/", "\\/");
}

function canonicalCommandPayload(command) {
  return [
    command.id,
    command.operation,
    String(command.issuedAt),
    String(command.expiresAt),
    canonicalJson(command.arguments),
  ].join("\n");
}

function requireSigningKey(privateKeyPem) {
  const value = String(privateKeyPem || "").trim();
  if (!value) {
    throw new HttpsError(
        "failed-precondition",
        "Phone command signing is not configured.",
    );
  }
  return value;
}

function controllerPublicKeyBase64(privateKeyPem) {
  try {
    return crypto.createPublicKey(requireSigningKey(privateKeyPem))
        .export({type: "spki", format: "der"})
        .toString("base64");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "Phone command signing key is invalid.");
  }
}

function signCommand(command, privateKeyPem) {
  try {
    return crypto.sign(
        "sha256",
        Buffer.from(canonicalCommandPayload(command), "utf8"),
        requireSigningKey(privateKeyPem),
    ).toString("base64");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Could not sign the phone command.");
  }
}

function createEnrollmentCode() {
  let code = "";
  for (let index = 0; index < ENROLLMENT_CODE_LENGTH; index += 1) {
    code += ENROLLMENT_ALPHABET[crypto.randomInt(ENROLLMENT_ALPHABET.length)];
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function normalizeEnrollmentCode(value) {
  const normalizedCode = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (![ENROLLMENT_CODE_LENGTH, LEGACY_ENROLLMENT_CODE_LENGTH].includes(normalizedCode.length)) {
    invalidArgument("Enter the 6-character enrollment code shown in the dashboard.");
  }
  return normalizedCode;
}

function enrollmentHash(code) {
  return crypto.createHash("sha256").update(String(code).replace(/-/g, "")).digest("hex");
}

function canResumeEnrollment(enrollment, deviceId) {
  return String(enrollment?.state || "") === "used" &&
    String(enrollment?.deviceId || "").trim().toLowerCase() === deviceId;
}

function deviceIdFromPublicKey(publicKeyBase64) {
  return crypto.createHash("sha256")
      .update(String(publicKeyBase64 || ""), "utf8")
      .digest("hex")
      .slice(0, 16);
}

function parseDevicePublicKey(publicKeyBase64) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(String(publicKeyBase64 || ""), "base64"),
      type: "spki",
      format: "der",
    });
    const details = publicKey.asymmetricKeyDetails || {};
    if (publicKey.asymmetricKeyType !== "ec" || details.namedCurve !== "prime256v1") {
      invalidArgument("The phone identity must use a P-256 EC key.");
    }
    return publicKey;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    invalidArgument("The phone public key is invalid.");
  }
}

function cleanDevicePayload(value, maxBytes = 64 * 1024) {
  return normalizeArguments(value, maxBytes);
}

function normalizeScreenUpdate(value) {
  const input = cleanDevicePayload(value || {}, 400 * 1024);
  const dataUrl = String(input.dataUrl || "").trim();
  if (dataUrl && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    invalidArgument("Screen frames must be base64 JPEG data URLs.");
  }
  if (dataUrl.length > 350 * 1024) {
    invalidArgument("The screen frame is too large.");
  }

  const sessionId = String(input.sessionId || "").trim();
  if (sessionId && !/^[A-Za-z0-9._:-]{8,100}$/.test(sessionId)) {
    invalidArgument("The live screen session ID is invalid.");
  }

  const liveInput = input.live && typeof input.live === "object" && !Array.isArray(input.live) ?
    input.live : {};
  const active = liveInput.active === true;
  if (active && !sessionId) invalidArgument("An active screen stream requires a session ID.");

  const expiresAt = active ? Number(liveInput.expiresAt || 0) : 0;
  if (active && (!Number.isFinite(expiresAt) || expiresAt < Date.now() - 5_000 ||
      expiresAt > Date.now() + 6 * 60 * 1000)) {
    invalidArgument("The live screen expiry is invalid.");
  }

  const intervalMs = Math.max(0, Math.min(Number(liveInput.intervalMs || 0), 10_000));
  const sequence = Math.max(0, Math.min(Number(input.sequence || 0), Number.MAX_SAFE_INTEGER));
  const normalized = {
    sessionId,
    sequence: Number.isFinite(sequence) ? Math.floor(sequence) : 0,
    live: {
      active,
      expiresAt,
      intervalMs: Number.isFinite(intervalMs) ? Math.floor(intervalMs) : 0,
      error: String(liveInput.error || "").trim().slice(0, 500),
    },
  };

  const webRtcInput = input.webrtc && typeof input.webrtc === "object" &&
    !Array.isArray(input.webrtc) ? input.webrtc : null;
  if (webRtcInput) {
    const webRtcSessionId = String(webRtcInput.sessionId || sessionId).trim();
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(webRtcSessionId)) {
      invalidArgument("The WebRTC session ID is invalid.");
    }
    const webRtcState = String(webRtcInput.state || "").trim().toLowerCase();
    const allowedStates = new Set([
      "awaiting_permission", "starting", "connecting", "connected", "disconnected",
      "stopped", "expired", "projection_stopped", "permission_denied", "failed",
    ]);
    if (!allowedStates.has(webRtcState)) invalidArgument("The WebRTC state is invalid.");
    const answerSdp = String(webRtcInput.answerSdp || "");
    if (answerSdp && (!answerSdp.trimStart().startsWith("v=0") ||
        answerSdp.length > 96 * 1024)) {
      invalidArgument("The WebRTC answer is invalid.");
    }
    const webRtcExpiresAt = Number(webRtcInput.expiresAt || 0);
    if (!Number.isFinite(webRtcExpiresAt) || webRtcExpiresAt < 0 ||
        webRtcExpiresAt > Date.now() + 6 * 60 * 1000) {
      invalidArgument("The WebRTC expiry is invalid.");
    }
    const width = Number(webRtcInput.width || 0);
    const height = Number(webRtcInput.height || 0);
    const rotation = Number(webRtcInput.rotation || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0 ||
        width > 10_000 || height > 10_000 || !Number.isInteger(rotation) ||
        rotation < 0 || rotation > 3) {
      invalidArgument("The WebRTC screen dimensions are invalid.");
    }
    const profileInput = webRtcInput.profile && typeof webRtcInput.profile === "object" ?
      webRtcInput.profile : {};
    normalized.webrtc = {
      sessionId: webRtcSessionId,
      state: webRtcState,
      expiresAt: webRtcExpiresAt,
      answerSdp,
      error: String(webRtcInput.error || "").trim().slice(0, 500),
      width: Math.floor(width),
      height: Math.floor(height),
      rotation,
      inputAvailable: webRtcInput.inputAvailable === true,
      profile: {
        longEdge: Math.max(360, Math.min(1440, Math.floor(Number(profileInput.longEdge || 720)))),
        fps: Math.max(5, Math.min(60, Math.floor(Number(profileInput.fps || 24)))),
        bitrateKbps: Math.max(250,
            Math.min(8000, Math.floor(Number(profileInput.bitrateKbps || 1800)))),
      },
      updatedAt: Number.isFinite(Number(webRtcInput.updatedAt)) ?
        Number(webRtcInput.updatedAt) : Date.now(),
    };
  }

  if (dataUrl) {
    const width = Number(input.width || 0);
    const height = Number(input.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) ||
        width < 1 || width > 10_000 || height < 1 || height > 10_000) {
      invalidArgument("The screen dimensions are invalid.");
    }
    normalized.dataUrl = dataUrl;
    normalized.width = Math.floor(width);
    normalized.height = Math.floor(height);
    normalized.capturedAt = Number.isFinite(Number(input.capturedAt)) ?
      Number(input.capturedAt) : Date.now();
    normalized.wokeScreen = input.wokeScreen === true;
  }
  return normalized;
}

function completedCommandScreenUpdate(operation, result, currentScreen = {}) {
  if (operation === "CAPTURE_SCREEN") return result;
  if (operation === "START_LIVE_SCREEN") {
    return {
      ...currentScreen,
      sessionId: String(result.sessionId || ""),
      sequence: 0,
      live: {
        active: result.active === true,
        expiresAt: Number(result.expiresAt || 0),
        intervalMs: Number(result.intervalMs || 0),
        error: "",
      },
    };
  }
  if (operation === "STOP_LIVE_SCREEN") {
    return {
      ...currentScreen,
      live: {
        active: false,
        expiresAt: 0,
        intervalMs: Number(currentScreen.live?.intervalMs || 0),
        error: "",
      },
    };
  }
  if (operation === "START_WEBRTC_SCREEN") {
    return {
      ...currentScreen,
      sessionId: String(result.sessionId || ""),
      webrtc: {
        sessionId: String(result.sessionId || ""),
        state: String(result.state || "awaiting_permission"),
        expiresAt: Number(result.expiresAt || 0),
        answerSdp: "",
        error: "",
        width: 0,
        height: 0,
        rotation: 0,
        inputAvailable: false,
        profile: result.profile && typeof result.profile === "object" ? result.profile : {},
        updatedAt: Date.now(),
      },
    };
  }
  if (operation === "STOP_WEBRTC_SCREEN") {
    return {
      ...currentScreen,
      webrtc: {
        ...(currentScreen.webrtc || {}),
        state: "stopped",
        expiresAt: 0,
        answerSdp: "",
        error: "",
        updatedAt: Date.now(),
      },
    };
  }
  return null;
}

async function findKiosk(db, stationId) {
  const direct = await db.collection("kiosks").doc(stationId).get();
  if (direct.exists) return direct;

  for (const field of ["stationid", "stationId"]) {
    const snapshot = await db.collection("kiosks").where(field, "==", stationId).limit(1).get();
    if (!snapshot.empty) return snapshot.docs[0];
  }
  throw new HttpsError("not-found", `Kiosk ${stationId} was not found.`);
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return value;
}

function safeDeviceData(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    deviceId: String(data.deviceId || snapshot.id),
    stationId: String(data.stationId || "").trim().toUpperCase(),
    displayName: String(data.displayName || "").trim(),
    enrollmentState: String(data.enrollmentState || "pending"),
    inventory: data.inventory && typeof data.inventory === "object" ? data.inventory : {},
    location: data.location && typeof data.location === "object" ? data.location : {},
    screen: data.screen && typeof data.screen === "object" ? data.screen : {},
    lastCommand: data.lastCommand && typeof data.lastCommand === "object" ? data.lastCommand : null,
    lastSeenAt: timestampToMillis(data.lastSeenAt),
    enrolledAt: timestampToMillis(data.enrolledAt),
    updatedAt: timestampToMillis(data.updatedAt),
  };
}

function safeCommandArguments(operation, arguments_) {
  const commandArguments = arguments_ && typeof arguments_ === "object" ? arguments_ : {};
  return operation === "CONNECT_WIFI" ? {
    ssid: String(commandArguments.ssid || ""),
    security: String(commandArguments.security || ""),
  } : commandArguments;
}

function safeCommandData(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    deviceId: String(data.deviceId || ""),
    stationId: String(data.stationId || "").trim().toUpperCase(),
    operation: String(data.operation || ""),
    arguments: safeCommandArguments(data.operation, data.arguments),
    status: String(data.status || "queued"),
    result: data.result && typeof data.result === "object" ? data.result : {},
    error: String(data.error || ""),
    issuedAt: Number(data.issuedAt || 0),
    expiresAt: Number(data.expiresAt || 0),
    createdAt: timestampToMillis(data.createdAt),
    updatedAt: timestampToMillis(data.updatedAt),
    deliveredAt: timestampToMillis(data.deliveredAt),
    completedAt: timestampToMillis(data.completedAt),
  };
}

async function accessibleStationIds(db, authState) {
  assertPhoneControlAccess(authState);
  if (isPhoneControlAdmin(authState)) return null;

  const kioskSnapshot = await db.collection("kiosks").get();
  return new Set(kioskSnapshot.docs
      .filter((snapshot) => canAccessKiosk(authState, snapshot.data() || {}))
      .map((snapshot) => String(
          snapshot.data()?.stationid || snapshot.data()?.stationId || snapshot.id,
      ).trim().toUpperCase())
      .filter(Boolean));
}

async function assertDeviceAccess(db, authState, deviceId) {
  assertPhoneControlAccess(authState);
  const deviceRef = db.collection(DEVICES_COLLECTION).doc(deviceId);
  const deviceSnapshot = await deviceRef.get();
  if (!deviceSnapshot.exists) throw new HttpsError("not-found", "Managed phone was not found.");
  if (isPhoneControlAdmin(authState)) return deviceSnapshot;

  const stationId = String(deviceSnapshot.data()?.stationId || "").trim().toUpperCase();
  if (!stationId) throw new HttpsError("permission-denied", "This phone is not in your kiosk scope.");
  const kioskSnapshot = await findKiosk(db, stationId);
  if (!canAccessKiosk(authState, kioskSnapshot.data() || {})) {
    throw new HttpsError("permission-denied", "This phone is not in your kiosk scope.");
  }
  return deviceSnapshot;
}

async function listDevices(_data, authState, dependencies) {
  const {db} = dependencies;
  const stationIds = await accessibleStationIds(db, authState);
  const snapshot = await db.collection(DEVICES_COLLECTION).get();
  const devices = snapshot.docs
      .map(safeDeviceData)
      .filter((device) => stationIds === null || stationIds.has(device.stationId))
      .sort((left, right) => left.stationId.localeCompare(right.stationId));
  return {ok: true, devices};
}

async function listCommands(data, authState, dependencies) {
  const {db} = dependencies;
  const deviceId = normalizeDeviceId(data?.deviceId);
  await assertDeviceAccess(db, authState, deviceId);
  const snapshot = await db.collection(COMMANDS_COLLECTION)
      .where("deviceId", "==", deviceId)
      .limit(250)
      .get();
  const commands = snapshot.docs
      .map(safeCommandData)
      .sort((left, right) => (
        Number(right.updatedAt || right.createdAt || right.issuedAt || 0) -
        Number(left.updatedAt || left.createdAt || left.issuedAt || 0)
      ))
      .slice(0, 10);
  return {ok: true, commands};
}

async function getScreen(data, authState, dependencies) {
  const {db} = dependencies;
  const deviceId = normalizeDeviceId(data?.deviceId);
  const deviceSnapshot = await assertDeviceAccess(db, authState, deviceId);
  const screen = deviceSnapshot.data()?.screen;
  return {
    ok: true,
    deviceId,
    screen: screen && typeof screen === "object" ? screen : {},
  };
}

function createTurnIceConfiguration(subject, sharedSecret, nowMs = Date.now(), nonce = "") {
  const secret = String(sharedSecret || "").trim();
  if (!secret || Buffer.byteLength(secret, "utf8") > 1024) {
    throw new HttpsError(
        "failed-precondition",
        "Secure live-screen relay is not configured.",
    );
  }
  const safeSubject = String(subject || "controller")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 80) || "controller";
  const credentialNonce = String(nonce || crypto.randomBytes(8).toString("hex"))
      .replace(/[^A-Za-z0-9._-]/g, "")
      .slice(0, 32);
  const expiresAtSeconds = Math.floor(Number(nowMs) / 1000) +
    TURN_CREDENTIAL_TTL_SECONDS;
  const username = `${expiresAtSeconds}:${safeSubject}:${credentialNonce}`;
  const credential = crypto.createHmac("sha1", secret)
      .update(username, "utf8")
      .digest("base64");

  return {
    expiresAt: expiresAtSeconds * 1000,
    iceServers: [
      {urls: PHONE_WEBRTC_STUN_URLS},
      {
        urls: PHONE_WEBRTC_TURN_URLS,
        username,
        credential,
      },
    ],
  };
}

async function getIceServers(data, authState, dependencies) {
  const {db, sharedSecret} = dependencies;
  const deviceId = normalizeDeviceId(data?.deviceId);
  await assertDeviceAccess(db, authState, deviceId);
  return {
    ok: true,
    deviceId,
    ...createTurnIceConfiguration(authState?.uid, sharedSecret),
  };
}

async function createEnrollment(data, authState, dependencies) {
  const {db, admin, privateKeyPem} = dependencies;
  const stationId = normalizeStationId(data?.stationId);
  await findKiosk(db, stationId);

  const assignmentRef = db.collection(ASSIGNMENTS_COLLECTION).doc(stationId);
  const assignment = await assignmentRef.get();
  if (assignment.exists && assignment.data()?.deviceId) {
    throw new HttpsError(
        "already-exists",
        `${stationId} already has a managed phone. Unassign it before enrolling another.`,
    );
  }

  const code = createEnrollmentCode();
  const normalizedCode = code.replace(/-/g, "");
  const now = Date.now();
  const expiresAt = now + ENROLLMENT_TTL_MS;
  await db.collection(ENROLLMENTS_COLLECTION).doc(enrollmentHash(normalizedCode)).set({
    stationId,
    codeLength: normalizedCode.length,
    state: "pending",
    expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: authState.uid,
  });

  return {
    ok: true,
    stationId,
    enrollmentCode: code,
    expiresAt,
    controllerPublicKey: controllerPublicKeyBase64(privateKeyPem),
    message: `Enrollment code created for ${stationId}. It expires in 15 minutes.`,
  };
}

async function assignDevice(data, authState, dependencies) {
  const {db, admin} = dependencies;
  const deviceId = normalizeDeviceId(data?.deviceId);
  const stationId = normalizeStationId(data?.stationId);
  await findKiosk(db, stationId);

  const deviceRef = db.collection(DEVICES_COLLECTION).doc(deviceId);
  const targetRef = db.collection(ASSIGNMENTS_COLLECTION).doc(stationId);

  await db.runTransaction(async (transaction) => {
    const [deviceSnapshot, targetSnapshot] = await Promise.all([
      transaction.get(deviceRef),
      transaction.get(targetRef),
    ]);
    if (!deviceSnapshot.exists) {
      throw new HttpsError("not-found", "Managed phone was not found.");
    }
    const existingDeviceId = String(targetSnapshot.data()?.deviceId || "");
    if (existingDeviceId && existingDeviceId !== deviceId) {
      throw new HttpsError("already-exists", `${stationId} already has another managed phone.`);
    }

    const previousStationId = String(deviceSnapshot.data()?.stationId || "").trim().toUpperCase();
    if (previousStationId && previousStationId !== stationId) {
      const previousRef = db.collection(ASSIGNMENTS_COLLECTION).doc(previousStationId);
      const previousSnapshot = await transaction.get(previousRef);
      if (previousSnapshot.data()?.deviceId === deviceId) transaction.delete(previousRef);
    }

    transaction.set(targetRef, {
      stationId,
      deviceId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: authState.uid,
    });
    transaction.set(deviceRef, {
      stationId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: authState.uid,
    }, {merge: true});
  });

  return {ok: true, stationId, deviceId, message: `Phone assigned to ${stationId}.`};
}

async function sendCommand(data, authState, dependencies) {
  const {db, admin, privateKeyPem} = dependencies;
  assertPhoneControlAccess(authState);
  const deviceId = normalizeDeviceId(data?.deviceId);
  const requestId = normalizeRequestId(data?.requestId);
  const operation = normalizeOperation(data?.operation);
  const confirmed = data?.confirmed === true;
  if (operation === "CONNECT_WIFI" && !isPhoneControlAdmin(authState)) {
    throw new HttpsError(
        "permission-denied",
        "Only Chargerent administrators can join a phone to Wi-Fi.",
    );
  }
  if (HIGH_IMPACT_OPERATIONS.has(operation) && !confirmed) {
    throw new HttpsError("failed-precondition", `${operation} requires explicit confirmation.`);
  }

  const deviceRef = db.collection(DEVICES_COLLECTION).doc(deviceId);
  const authorizedDeviceSnapshot = await assertDeviceAccess(db, authState, deviceId);
  const maxArgumentBytes = operation === "START_WEBRTC_SCREEN" ? 128 * 1024 : 16 * 1024;
  let commandArguments;
  if (operation === "INSTALL_APP_UPDATE") {
    commandArguments = normalizeAppUpdateArguments(data?.arguments);
  } else if (operation === "SET_ALWAYS_ON_HOTSPOT") {
    commandArguments = normalizeHotspotArguments(data?.arguments);
  } else if (operation === "START_WEBRTC_SCREEN") {
    commandArguments = normalizeWebRtcStartArguments(data?.arguments);
  } else if (operation === "CONNECT_WIFI") {
    commandArguments = normalizeConnectWifiArguments(
        data?.arguments,
        authorizedDeviceSnapshot.data()?.inventory?.commandEncryptionPublicKey,
    );
  } else {
    commandArguments = normalizeArguments(data?.arguments, maxArgumentBytes);
  }
  if (HIGH_IMPACT_OPERATIONS.has(operation)) commandArguments.confirmed = true;

  if (operation === "INSTALL_APP_UPDATE") {
    const installedVersionCode = Number(
        authorizedDeviceSnapshot.data()?.inventory?.agentVersionCode || 0,
    );
    if (installedVersionCode > 0 && commandArguments.versionCode <= installedVersionCode) {
      throw new HttpsError("failed-precondition", "This phone already has the current Agent release.");
    }
  }
  const authorizedStationId = String(
      authorizedDeviceSnapshot.data()?.stationId || "",
  ).trim().toUpperCase();
  const commandRef = db.collection(COMMANDS_COLLECTION).doc(requestId);
  const now = Date.now();
  const command = {
    id: requestId,
    deviceId,
    operation,
    arguments: commandArguments,
    issuedAt: now,
    expiresAt: now + COMMAND_TTL_MS,
  };
  command.signature = signCommand(command, privateKeyPem);

  await db.runTransaction(async (transaction) => {
    const [deviceSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(deviceRef),
      transaction.get(commandRef),
    ]);
    if (!deviceSnapshot.exists) {
      throw new HttpsError("not-found", "Managed phone was not found.");
    }
    if (deviceSnapshot.data()?.enrollmentState !== "enrolled") {
      throw new HttpsError("failed-precondition", "This phone is not enrolled.");
    }
    const stationId = String(deviceSnapshot.data()?.stationId || "").trim().toUpperCase();
    if (!stationId) {
      throw new HttpsError("failed-precondition", "Assign this phone to a kiosk first.");
    }
    if (stationId !== authorizedStationId) {
      throw new HttpsError("permission-denied", "The phone kiosk assignment changed.");
    }
    if (commandSnapshot.exists) {
      throw new HttpsError("already-exists", "This command request was already submitted.");
    }
    const activeCommandId = String(deviceSnapshot.data()?.activeCommandId || "").trim();
    if (activeCommandId && activeCommandId !== requestId) {
      const activeCommandRef = db.collection(COMMANDS_COLLECTION).doc(activeCommandId);
      const activeCommandSnapshot = await transaction.get(activeCommandRef);
      if (["queued", "delivered", "running"].includes(activeCommandSnapshot.data()?.status)) {
        throw new HttpsError(
            "failed-precondition",
            "This phone already has a command in progress.",
        );
      }
    }

    transaction.create(commandRef, {
      ...command,
      stationId,
      status: "queued",
      confirmed,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: authState.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(deviceRef, {
      activeCommandId: requestId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });

  return {
    ok: true,
    commandId: requestId,
    status: "queued",
    message: `${operation} queued for the kiosk phone.`,
  };
}

async function enrollDevice(data, dependencies) {
  const {db, admin, privateKeyPem} = dependencies;
  const normalizedCode = normalizeEnrollmentCode(data?.enrollmentCode);

  const publicKeyBase64 = String(data?.publicKey || "").trim();
  parseDevicePublicKey(publicKeyBase64);
  const deviceId = deviceIdFromPublicKey(publicKeyBase64);
  const inventory = cleanDevicePayload(data?.inventory || {});
  const enrollmentRef = db.collection(ENROLLMENTS_COLLECTION).doc(enrollmentHash(normalizedCode));

  let enrolledStationId = "";
  await db.runTransaction(async (transaction) => {
    const enrollmentSnapshot = await transaction.get(enrollmentRef);
    if (!enrollmentSnapshot.exists) {
      throw new HttpsError("not-found", "Enrollment code was not found.");
    }
    const enrollment = enrollmentSnapshot.data() || {};
    enrolledStationId = normalizeStationId(enrollment.stationId);
    const isResume = canResumeEnrollment(enrollment, deviceId);
    if (!isResume &&
        (enrollment.state !== "pending" || Number(enrollment.expiresAt || 0) < Date.now())) {
      throw new HttpsError("failed-precondition", "Enrollment code has expired or was already used.");
    }

    const deviceRef = db.collection(DEVICES_COLLECTION).doc(deviceId);
    const assignmentRef = db.collection(ASSIGNMENTS_COLLECTION).doc(enrolledStationId);
    const [deviceSnapshot, assignmentSnapshot] = await Promise.all([
      transaction.get(deviceRef),
      transaction.get(assignmentRef),
    ]);
    const assignedDeviceId = String(assignmentSnapshot.data()?.deviceId || "");
    if (assignedDeviceId && assignedDeviceId !== deviceId) {
      throw new HttpsError("already-exists", `${enrolledStationId} already has another managed phone.`);
    }
    if (isResume) {
      if (!deviceSnapshot.exists ||
          normalizeStationId(deviceSnapshot.data()?.stationId) !== enrolledStationId) {
        throw new HttpsError("failed-precondition", "The original phone enrollment is incomplete.");
      }
      return;
    }
    const previousStationId = String(deviceSnapshot.data()?.stationId || "").trim().toUpperCase();
    if (previousStationId && previousStationId !== enrolledStationId) {
      throw new HttpsError(
          "failed-precondition",
          `This phone is already assigned to ${previousStationId}.`,
      );
    }

    transaction.set(deviceRef, {
      deviceId,
      stationId: enrolledStationId,
      publicKey: publicKeyBase64,
      inventory,
      enrollmentState: "enrolled",
      enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.set(assignmentRef, {
      stationId: enrolledStationId,
      deviceId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "device-enrollment",
    });
    transaction.set(enrollmentRef, {
      state: "used",
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      deviceId,
    }, {merge: true});
  });

  return {
    ok: true,
    deviceId,
    stationId: enrolledStationId,
    controllerPublicKey: controllerPublicKeyBase64(privateKeyPem),
  };
}

async function authenticateDeviceRequest(req, dependencies) {
  const {db} = dependencies;
  const deviceId = normalizeDeviceId(req.get("X-Phone-Device"));
  const timestamp = Number(req.get("X-Phone-Timestamp"));
  const nonce = String(req.get("X-Phone-Nonce") || "").trim();
  const signature = String(req.get("X-Phone-Signature") || "").trim();
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > DEVICE_REQUEST_CLOCK_SKEW_MS) {
    throw new HttpsError("unauthenticated", "Phone request timestamp is invalid.");
  }
  if (!/^[A-Za-z0-9_-]{16,120}$/.test(nonce) || !signature) {
    throw new HttpsError("unauthenticated", "Phone request authentication is incomplete.");
  }

  const deviceRef = db.collection(DEVICES_COLLECTION).doc(deviceId);
  const deviceSnapshot = await deviceRef.get();
  if (!deviceSnapshot.exists || deviceSnapshot.data()?.enrollmentState !== "enrolled") {
    throw new HttpsError("unauthenticated", "Phone is not enrolled.");
  }

  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}\n${nonce}\n`, "utf8"),
    rawBody,
  ]);
  let valid = false;
  try {
    valid = crypto.verify(
        "sha256",
        signedPayload,
        parseDevicePublicKey(deviceSnapshot.data()?.publicKey),
        Buffer.from(signature, "base64"),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new HttpsError("unauthenticated", "Phone request signature is invalid.");
  return {deviceId, deviceRef, device: deviceSnapshot.data() || {}};
}

async function recordHeartbeat(data, req, dependencies) {
  const {admin} = dependencies;
  const authState = await authenticateDeviceRequest(req, dependencies);
  const inventory = cleanDevicePayload(data?.inventory || {});
  await authState.deviceRef.set({
    inventory,
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, serverTime: Date.now()};
}

async function pollDeviceCommand(_data, req, dependencies) {
  const {db, admin} = dependencies;
  const authState = await authenticateDeviceRequest(req, dependencies);
  let command = null;

  await db.runTransaction(async (transaction) => {
    const deviceSnapshot = await transaction.get(authState.deviceRef);
    const activeCommandId = String(deviceSnapshot.data()?.activeCommandId || "").trim();
    if (!activeCommandId) return;

    const commandRef = db.collection(COMMANDS_COLLECTION).doc(activeCommandId);
    const commandSnapshot = await transaction.get(commandRef);
    if (!commandSnapshot.exists || commandSnapshot.data()?.deviceId !== authState.deviceId) {
      transaction.set(authState.deviceRef, {activeCommandId: null}, {merge: true});
      return;
    }

    const data = commandSnapshot.data() || {};
    if (Number(data.expiresAt || 0) < Date.now()) {
      transaction.set(commandRef, {
        status: "expired",
        arguments: safeCommandArguments(data.operation, data.arguments),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      transaction.set(authState.deviceRef, {activeCommandId: null}, {merge: true});
      return;
    }
    if (!["queued", "delivered", "running"].includes(data.status)) {
      transaction.set(authState.deviceRef, {activeCommandId: null}, {merge: true});
      return;
    }

    command = {
      id: commandSnapshot.id,
      operation: data.operation,
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
      arguments: data.arguments || {},
      signature: data.signature,
    };
    transaction.set(commandRef, {
      status: data.status === "queued" ? "delivered" : data.status,
      deliveredAt: data.deliveredAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.set(authState.deviceRef, {
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });

  return {ok: true, command};
}

async function recordCommandResult(data, req, dependencies) {
  const {db, admin} = dependencies;
  const authState = await authenticateDeviceRequest(req, dependencies);
  const commandId = normalizeRequestId(data?.commandId);
  const status = String(data?.status || "").trim().toLowerCase();
  if (!["completed", "failed", "rejected"].includes(status)) {
    invalidArgument("A valid command result status is required.");
  }
  const result = cleanDevicePayload(data?.result || {}, 700 * 1024);
  const errorMessage = String(data?.error || "").trim().slice(0, 1000);
  const commandRef = db.collection(COMMANDS_COLLECTION).doc(commandId);

  await db.runTransaction(async (transaction) => {
    const [deviceSnapshot, commandSnapshot] = await Promise.all([
      transaction.get(authState.deviceRef),
      transaction.get(commandRef),
    ]);
    if (!commandSnapshot.exists || commandSnapshot.data()?.deviceId !== authState.deviceId) {
      throw new HttpsError("not-found", "Phone command was not found.");
    }
    const commandData = commandSnapshot.data() || {};
    const commandUpdate = {
      status,
      result,
      error: errorMessage || null,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (commandData.operation === "CONNECT_WIFI") {
      commandUpdate.arguments = safeCommandArguments(
          commandData.operation,
          commandData.arguments,
      );
    }
    transaction.set(commandRef, commandUpdate, {merge: true});

    const deviceUpdate = {
      activeCommandId: deviceSnapshot.data()?.activeCommandId === commandId ? null :
        deviceSnapshot.data()?.activeCommandId || null,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastCommand: {id: commandId, operation: commandData.operation, status},
    };
    if (status === "completed" && commandData.operation === "GET_INVENTORY") {
      deviceUpdate.inventory = result;
    }
    if (status === "completed" && ["SCAN_WIFI_NETWORKS", "CONNECT_WIFI"].includes(
        commandData.operation,
    )) {
      const currentInventory = deviceSnapshot.data()?.inventory;
      deviceUpdate.inventory = {
        ...(currentInventory && typeof currentInventory === "object" ? currentInventory : {}),
        ...result,
      };
    }
    if (status === "completed" && commandData.operation === "GET_LOCATION") {
      deviceUpdate.location = {...result, receivedAt: Date.now()};
    }
    if (status === "completed") {
      const screenUpdate = completedCommandScreenUpdate(
          commandData.operation,
          result,
          deviceSnapshot.data()?.screen || {},
      );
      if (screenUpdate) deviceUpdate.screen = screenUpdate;
    }
    transaction.set(authState.deviceRef, deviceUpdate, {merge: true});
  });
  return {ok: true};
}

async function recordScreenUpdate(data, req, dependencies) {
  const {admin, db} = dependencies;
  const authState = await authenticateDeviceRequest(req, dependencies);
  const screenUpdate = normalizeScreenUpdate(data?.screen || {});
  await db.runTransaction(async (transaction) => {
    const deviceSnapshot = await transaction.get(authState.deviceRef);
    const currentScreen = deviceSnapshot.data()?.screen;
    const current = currentScreen && typeof currentScreen === "object" ? currentScreen : {};
    const currentSessionId = String(current.sessionId || "");
    const incomingSessionId = String(screenUpdate.sessionId || "");
    const currentExpiresAt = Number(current.live?.expiresAt || 0);
    const incomingExpiresAt = Number(screenUpdate.live?.expiresAt || 0);
    const sameSession = currentSessionId && currentSessionId === incomingSessionId;
    const staleSequence = sameSession && Number(screenUpdate.sequence || 0) <
      Number(current.sequence || 0);
    const staleSession = current.live?.active === true && !sameSession && (
      screenUpdate.live?.active !== true || incomingExpiresAt < currentExpiresAt
    );
    const currentWebRtc = current.webrtc && typeof current.webrtc === "object" ?
      current.webrtc : {};
    const incomingWebRtc = screenUpdate.webrtc && typeof screenUpdate.webrtc === "object" ?
      screenUpdate.webrtc : null;
    const activeWebRtcStates = new Set([
      "awaiting_permission", "starting", "connecting", "connected", "disconnected",
    ]);
    const staleWebRtcSession = incomingWebRtc && currentWebRtc.sessionId &&
      incomingWebRtc.sessionId !== currentWebRtc.sessionId &&
      activeWebRtcStates.has(String(currentWebRtc.state || "")) &&
      Number(currentWebRtc.expiresAt || 0) > Date.now();
    if ((!incomingWebRtc && (staleSequence || staleSession)) || staleWebRtcSession) return;

    transaction.set(authState.deviceRef, {
      screen: {
        ...current,
        ...screenUpdate,
        receivedAt: Date.now(),
      },
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
  return {ok: true, serverTime: Date.now()};
}

module.exports = {
  ALLOWED_OPERATIONS,
  HIGH_IMPACT_OPERATIONS,
  assertPhoneControlAccess,
  assignDevice,
  canAccessKiosk,
  canResumeEnrollment,
  completedCommandScreenUpdate,
  canonicalCommandPayload,
  canonicalJson,
  controllerPublicKeyBase64,
  createEnrollment,
  createEnrollmentCode,
  createTurnIceConfiguration,
  deviceIdFromPublicKey,
  enrollDevice,
  enrollmentHash,
  getScreen,
  getIceServers,
  hasPhoneControlAccess,
  authenticateDeviceRequest,
  normalizeArguments,
  normalizeAppUpdateArguments,
  normalizeConnectWifiArguments,
  normalizeHotspotArguments,
  normalizeWebRtcStartArguments,
  normalizeDeviceId,
  normalizeEnrollmentCode,
  normalizeScreenUpdate,
  normalizeStationId,
  listCommands,
  listDevices,
  pollDeviceCommand,
  recordCommandResult,
  recordHeartbeat,
  recordScreenUpdate,
  sendCommand,
  signCommand,
};
