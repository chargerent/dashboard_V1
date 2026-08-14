/* eslint-env node */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  ALLOWED_OPERATIONS,
  authenticateDeviceRequest,
  canAccessKiosk,
  canResumeEnrollment,
  completedCommandScreenUpdate,
  canonicalCommandPayload,
  canonicalJson,
  controllerPublicKeyBase64,
  createEnrollmentCode,
  deviceIdFromPublicKey,
  enrollmentHash,
  hasPhoneControlAccess,
  normalizeArguments,
  normalizeAppUpdateArguments,
  normalizeDeviceId,
  normalizeEnrollmentCode,
  normalizeScreenUpdate,
  normalizeStationId,
  signCommand,
} = require("./phoneControl");

test("allowlists fixed remote screen and tethering controls", () => {
  assert.equal(ALLOWED_OPERATIONS.has("UI_SWIPE"), true);
  assert.equal(ALLOWED_OPERATIONS.has("OPEN_TETHER_SETTINGS"), true);
  assert.equal(ALLOWED_OPERATIONS.has("START_WEBRTC_SCREEN"), true);
  assert.equal(ALLOWED_OPERATIONS.has("SET_WEBRTC_PROFILE"), true);
  assert.equal(ALLOWED_OPERATIONS.has("STOP_WEBRTC_SCREEN"), true);
  assert.equal(ALLOWED_OPERATIONS.has("WAKE_AND_UNLOCK"), true);
});

test("normalizes managed phone identifiers", () => {
  assert.equal(normalizeDeviceId(" 06a0b983b8a221fe "), "06a0b983b8a221fe");
  assert.equal(normalizeStationId(" us0118 "), "US0118");
  assert.throws(() => normalizeStationId("kiosk 1"));
});

test("canonical JSON matches the Android sorted-key contract", () => {
  assert.equal(
      canonicalJson({z: [true, null, 4], a: {b: "two", a: 1}}),
      "{\"a\":{\"a\":1,\"b\":\"two\"},\"z\":[true,null,4]}",
  );
  assert.deepEqual(normalizeArguments({enabled: true}), {enabled: true});
  assert.equal(
      canonicalJson({offer: "a=https://example.com/path"}),
      "{\"offer\":\"a=https:\\/\\/example.com\\/path\"}",
  );
});

test("allows only versioned Chargerent Agent update packages", () => {
  const update = normalizeAppUpdateArguments({
    httpsUrl: "https://chargerentstations.com/portal/mdm/remote-agent-v1.2.0.apk",
    sha256: "A".repeat(64),
    versionCode: 15,
    versionName: "1.2.0",
  });
  assert.equal(
      update.httpsUrl,
      "https://chargerentstations.com/portal/mdm/remote-agent-v1.2.0.apk",
  );
  assert.equal(update.sha256, "a".repeat(64));
  assert.throws(() => normalizeAppUpdateArguments({
    ...update,
    httpsUrl: "https://example.com/remote-agent-v1.2.0.apk",
  }), /Only official Chargerent Agent releases/);
  assert.throws(() => normalizeAppUpdateArguments({
    ...update,
    sha256: "not-a-checksum",
  }), /valid Agent package SHA-256/);
});

test("signs a command with an Android-compatible P-256 public key", () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const privateKeyPem = privateKey.export({type: "pkcs8", format: "pem"});
  const command = {
    id: "phone-GET_LOCATION-123456",
    operation: "GET_LOCATION",
    issuedAt: 1730000000000,
    expiresAt: 1730000120000,
    arguments: {},
  };
  const signature = Buffer.from(signCommand(command, privateKeyPem), "base64");
  assert.equal(
      crypto.verify(
          "sha256",
          Buffer.from(canonicalCommandPayload(command), "utf8"),
          publicKey,
          signature,
      ),
      true,
  );
  assert.equal(
      controllerPublicKeyBase64(privateKeyPem),
      publicKey.export({type: "spki", format: "der"}).toString("base64"),
  );
});

test("enrollment codes are stored as deterministic hashes", () => {
  assert.equal(enrollmentHash("ABCD-EFGH"), enrollmentHash("ABCDEFGH"));
  assert.equal(enrollmentHash("ABCDEFGH").length, 64);
});

test("creates short, unambiguous enrollment codes", () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(createEnrollmentCode(), /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  }
});

test("accepts new short codes and pending legacy codes", () => {
  assert.equal(normalizeEnrollmentCode(" abc-def "), "ABCDEF");
  assert.equal(normalizeEnrollmentCode("ABCD-EFGH"), "ABCDEFGH");
  assert.throws(
      () => normalizeEnrollmentCode("AB-CD"),
      /Enter the 6-character enrollment code/,
  );
});

test("allows the same phone to resume a committed enrollment", () => {
  const deviceId = "06a0b983b8a221fe";
  assert.equal(canResumeEnrollment({state: "used", deviceId}, deviceId), true);
  assert.equal(canResumeEnrollment({state: "used", deviceId: "different-phone"}, deviceId), false);
  assert.equal(canResumeEnrollment({state: "pending", deviceId}, deviceId), false);
});

test("authenticates the exact signed request body from an enrolled phone", async () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const publicKeyBase64 = publicKey.export({type: "spki", format: "der"}).toString("base64");
  const deviceId = deviceIdFromPublicKey(publicKeyBase64);
  const timestamp = Date.now();
  const nonce = "0123456789abcdef0123456789abcdef";
  const rawBody = Buffer.from('{"data":{"inventory":{}}}', "utf8");
  const signature = crypto.sign(
      "sha256",
      Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), rawBody]),
      privateKey,
  ).toString("base64");
  const headers = {
    "x-phone-device": deviceId,
    "x-phone-timestamp": String(timestamp),
    "x-phone-nonce": nonce,
    "x-phone-signature": signature,
  };
  const deviceRef = {
    async get() {
      return {
        exists: true,
        data: () => ({enrollmentState: "enrolled", publicKey: publicKeyBase64}),
      };
    },
  };
  const db = {
    collection: () => ({doc: () => deviceRef}),
  };
  const req = {
    rawBody,
    body: JSON.parse(rawBody.toString("utf8")),
    get: (name) => headers[String(name).toLowerCase()] || "",
  };

  const authenticated = await authenticateDeviceRequest(req, {db});
  assert.equal(authenticated.deviceId, deviceId);
  assert.equal(authenticated.deviceRef, deviceRef);
});

test("accepts bounded live JPEG screen updates", () => {
  const expiresAt = Date.now() + 120_000;
  const screen = normalizeScreenUpdate({
    dataUrl: "data:image/jpeg;base64,/9j/2Q==",
    width: 1080,
    height: 2400,
    capturedAt: Date.now(),
    sessionId: "session-12345678",
    sequence: 3,
    live: {active: true, expiresAt, intervalMs: 1200},
  });
  assert.equal(screen.live.active, true);
  assert.equal(screen.live.expiresAt, expiresAt);
  assert.equal(screen.sequence, 3);
  assert.throws(() => normalizeScreenUpdate({
    dataUrl: "https://example.com/frame.jpg",
    sessionId: "session-12345678",
    live: {active: true, expiresAt},
  }));
});

test("accepts bounded WebRTC answers without persisting signaling credentials", () => {
  const expiresAt = Date.now() + 120_000;
  const screen = normalizeScreenUpdate({
    sessionId: "webrtc-session-1234",
    webrtc: {
      sessionId: "webrtc-session-1234",
      state: "connecting",
      expiresAt,
      answerSdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n",
      width: 1080,
      height: 2400,
      rotation: 0,
      inputAvailable: true,
      profile: {longEdge: 720, fps: 24, bitrateKbps: 1800},
    },
  });
  assert.equal(screen.webrtc.state, "connecting");
  assert.equal(screen.webrtc.answerSdp.startsWith("v=0"), true);
  assert.equal(screen.webrtc.inputAvailable, true);
  assert.equal(Object.hasOwn(screen.webrtc, "iceServers"), false);
  assert.throws(() => normalizeScreenUpdate({
    sessionId: "webrtc-session-1234",
    webrtc: {sessionId: "webrtc-session-1234", state: "unknown", expiresAt},
  }));
});

test("preserves the WebRTC SDP line terminator", () => {
  const answerSdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
  const screen = normalizeScreenUpdate({
    sessionId: "webrtc-session-1234",
    webrtc: {
      sessionId: "webrtc-session-1234",
      state: "connecting",
      expiresAt: Date.now() + 120_000,
      answerSdp,
    },
  });
  assert.equal(screen.webrtc.answerSdp, answerSdp);
});

test("a new live session resets the prior frame sequence", () => {
  const nextScreen = completedCommandScreenUpdate(
      "START_LIVE_SCREEN",
      {
        sessionId: "new-session",
        active: true,
        expiresAt: 123456,
        intervalMs: 1200,
      },
      {sessionId: "old-session", sequence: 42, live: {active: false}},
  );
  assert.equal(nextScreen.sessionId, "new-session");
  assert.equal(nextScreen.sequence, 0);
  assert.equal(nextScreen.live.active, true);
});

test("scopes phone control to the account's kiosk relationship", () => {
  const admin = {isAdmin: true, profile: {}};
  const partner = {
    isAdmin: false,
    profile: {role: "partner", clientId: "Partner-A", features: {phone_control: true}},
  };
  const client = {
    isAdmin: false,
    profile: {role: "user", clientId: "Client-A", features: {phone_control: true}},
  };
  const disabled = {
    isAdmin: false,
    profile: {role: "partner", clientId: "Partner-A", features: {}},
  };

  assert.equal(hasPhoneControlAccess(admin), true);
  assert.equal(hasPhoneControlAccess(partner), true);
  assert.equal(hasPhoneControlAccess(disabled), false);
  assert.equal(canAccessKiosk(partner, {info: {rep: "partner-a", client: "other"}}), true);
  assert.equal(canAccessKiosk(partner, {info: {rep: "partner-b"}}), false);
  assert.equal(canAccessKiosk(client, {info: {client: "CLIENT-A"}}), true);
  assert.equal(canAccessKiosk(client, {info: {client: "Client-B"}}), false);
});
