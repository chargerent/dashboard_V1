/* eslint-env node */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  ALLOWED_OPERATIONS,
  HIGH_IMPACT_OPERATIONS,
  authenticateDeviceRequest,
  canAccessKiosk,
  canResumeEnrollment,
  completedCommandScreenUpdate,
  canonicalCommandPayload,
  canonicalJson,
  controllerPublicKeyBase64,
  createEnrollmentCode,
  createTurnIceConfiguration,
  deviceIdFromPublicKey,
  encryptCommandSecret,
  enrollmentHash,
  hasPhoneControlAccess,
  normalizeArguments,
  normalizeAppUpdateArguments,
  normalizeConnectWifiArguments,
  normalizeHotspotArguments,
  normalizeSystemUpdateArguments,
  normalizeUpdatePolicyArguments,
  normalizePaymentLaunchArguments,
  normalizeTerminalLockdownArguments,
  normalizeWebRtcStartArguments,
  normalizeDeviceId,
  normalizeEnrollmentCode,
  normalizeScreenUpdate,
  normalizeStationId,
  provisionTerminalConfigForKiosk,
  signCommand,
  terminalCommandArguments,
  terminalConfigForKiosk,
  terminalStateAfterAppRestrictions,
} = require("./phoneControl");

test("allowlists fixed remote screen and tethering controls", () => {
  assert.equal(ALLOWED_OPERATIONS.has("UI_SWIPE"), true);
  assert.equal(ALLOWED_OPERATIONS.has("OPEN_TETHER_SETTINGS"), true);
  assert.equal(ALLOWED_OPERATIONS.has("SET_ALWAYS_ON_HOTSPOT"), true);
  assert.equal(ALLOWED_OPERATIONS.has("SET_HOTSPOT_ENABLED"), true);
  assert.equal(ALLOWED_OPERATIONS.has("SCAN_WIFI_NETWORKS"), true);
  assert.equal(ALLOWED_OPERATIONS.has("CONNECT_WIFI"), true);
  assert.equal(ALLOWED_OPERATIONS.has("OPEN_CAPTIVE_PORTAL"), true);
  assert.equal(ALLOWED_OPERATIONS.has("START_WEBRTC_SCREEN"), true);
  assert.equal(ALLOWED_OPERATIONS.has("SET_WEBRTC_PROFILE"), true);
  assert.equal(ALLOWED_OPERATIONS.has("STOP_WEBRTC_SCREEN"), true);
  assert.equal(ALLOWED_OPERATIONS.has("WAKE_AND_UNLOCK"), true);
  assert.equal(ALLOWED_OPERATIONS.has("SET_TERMINAL_LOCKDOWN"), true);
  assert.equal(ALLOWED_OPERATIONS.has("LAUNCH_PAYMENT_APP"), true);
  assert.equal(ALLOWED_OPERATIONS.has("POWER_OFF"), true);
  assert.equal(HIGH_IMPACT_OPERATIONS.has("POWER_OFF"), true);
  assert.equal(HIGH_IMPACT_OPERATIONS.has("INSTALL_SYSTEM_UPDATE"), true);
  assert.equal(HIGH_IMPACT_OPERATIONS.has("SET_UPDATE_POLICY"), true);
});

test("validates controlled Android update windows and policies", () => {
  assert.deepEqual(normalizeSystemUpdateArguments({}), {timeoutHours: 24});
  assert.deepEqual(normalizeSystemUpdateArguments({timeoutHours: 12}), {timeoutHours: 12});
  assert.throws(() => normalizeSystemUpdateArguments({timeoutHours: 0}), /1 to 72 hours/);
  assert.throws(() => normalizeSystemUpdateArguments({contentUri: "content://untrusted"}),
      /managed Android update window/i);

  assert.deepEqual(normalizeUpdatePolicyArguments({mode: "postponed"}), {mode: "POSTPONED"});
  assert.deepEqual(normalizeUpdatePolicyArguments({
    mode: "windowed",
    startMinutes: 120,
    endMinutes: 240,
  }), {mode: "WINDOWED", startMinutes: 120, endMinutes: 240});
  assert.throws(() => normalizeUpdatePolicyArguments({mode: "later"}), /valid Android update policy/);
  assert.throws(() => normalizeUpdatePolicyArguments({
    mode: "windowed",
    startMinutes: -1,
    endMinutes: 240,
  }), /minutes from midnight/);
});

test("derives payment-app lockdown from the assigned terminal", () => {
  assert.deepEqual(normalizeTerminalLockdownArguments({enabled: false}, {
    terminal: {enabled: true, packageName: "com.chargerent.kiosk"},
  }), {
    enabled: false,
    packageName: "com.chargerent.kiosk",
  });
  assert.throws(() => normalizeTerminalLockdownArguments({enabled: true}, {
    terminal: {enabled: false},
  }), /Enable the Stripe terminal assignment/);
  assert.throws(() => normalizeTerminalLockdownArguments({enabled: "true"}, {
    terminal: {enabled: true},
  }), /enabled value/);
});

test("derives payment-app launch from the assigned terminal", () => {
  assert.deepEqual(normalizePaymentLaunchArguments({
    terminal: {enabled: true, packageName: "com.chargerent.kiosk.test.debug"},
  }), {packageName: "com.chargerent.kiosk.test.debug"});
  assert.throws(() => normalizePaymentLaunchArguments({
    terminal: {enabled: false},
  }), /Enable the Stripe terminal assignment/);
});

test("does not downgrade a confirmed terminal when provisioning completes", () => {
  const updatedAt = {serverTimestamp: true};
  const confirmed = terminalStateAfterAppRestrictions({
    enabled: true,
    state: "ready",
    confirmedAt: 1786850619169,
    message: "Payment app confirmed CA8019 configuration.",
  }, {
    status: "completed",
    requestedEnabled: true,
    lockdownActive: false,
    errorMessage: "",
    updatedAt,
  });
  assert.equal(confirmed.state, "ready");
  assert.equal(confirmed.message, "Payment app confirmed CA8019 configuration.");
  assert.equal(confirmed.lockdownState, "locking");
  assert.equal(confirmed.updatedAt, updatedAt);

  const waiting = terminalStateAfterAppRestrictions({
    enabled: true,
    state: "provisioning",
  }, {
    status: "completed",
    requestedEnabled: true,
    lockdownActive: true,
    errorMessage: "",
    updatedAt,
  });
  assert.equal(waiting.state, "awaiting_app_confirmation");
  assert.equal(waiting.lockdownState, "locked");
});

test("encrypts Wi-Fi credentials for only the enrolled phone", () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
  const publicKeyBase64 = publicKey.export({type: "spki", format: "der"}).toString("base64");
  const normalized = normalizeConnectWifiArguments({
    ssid: "Chargerent Test",
    security: "wpa3",
    passphrase: "private-password",
  }, publicKeyBase64);

  assert.equal(normalized.ssid, "Chargerent Test");
  assert.equal(normalized.security, "wpa3");
  assert.equal(Object.hasOwn(normalized, "passphrase"), false);
  assert.equal(JSON.stringify(normalized).includes("private-password"), false);
  const plaintext = crypto.privateDecrypt({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, Buffer.from(normalized.encryptedCredentials.ciphertext, "base64"));
  assert.deepEqual(JSON.parse(plaintext.toString("utf8")), {passphrase: "private-password"});

  assert.deepEqual(normalizeConnectWifiArguments({
    ssid: "Guest Wi-Fi",
    security: "open",
  }, ""), {ssid: "Guest Wi-Fi", security: "open"});
  assert.throws(() => normalizeConnectWifiArguments({
    ssid: "Secure Wi-Fi",
    security: "wpa2",
    passphrase: "short",
  }, publicKeyBase64), /8 to 63/);
});

test("builds encrypted CA8019 terminal provisioning without persisting the token", () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
  const publicKeyBase64 = publicKey.export({type: "spki", format: "der"}).toString("base64");
  const config = terminalConfigForKiosk("CA8019", {
    id: "id-9987807816",
    data: () => ({
      info: {
        address: "4514 Conchita Way",
        city: "Tarzana",
        state: "CA",
        zip: "91356",
        country: "US",
        location: "Test Kiosk",
      },
      hardware: {gateway: "STRIPE", gatewayoptions: "FULLPRICE"},
      pricing: {
        text: "LEASE - SIMPLE DAILY",
        currency: "US",
        symbol: "$",
        kioskmode: "PURCHASE",
        initialperiod: 24,
        authamount: 1,
        dailyprice: 1,
        buyprice: 1,
        overdue: 30,
      },
      modules: [{
        moduleid: "100049231111490591",
        slots: [{position: 1}, {position: 2}, {position: 3}],
      }],
    }),
  });
  assert.equal(config.packageName, "com.chargerent.kiosk.test.debug");
  assert.equal(config.stripeAccountCountry, "US");
  assert.equal(config.stripeLocationId, "");
  assert.deepEqual(config.stripeLocationAddress, {
    line1: "4514 Conchita Way",
    city: "Tarzana",
    postal_code: "91356",
    country: "US",
    state: "CA",
  });
  assert.equal(config.moduleId, "100049231111490591");
  assert.deepEqual(config.slotNumbers, [1, 2, 3]);

  const installationToken = "installation-token-that-must-not-be-persisted";
  const encryptedSecrets = encryptCommandSecret({installationToken}, publicKeyBase64);
  const arguments_ = terminalCommandArguments({
    ...config,
    stripeLocationId: "tml_us_test",
  }, encryptedSecrets);
  assert.equal(JSON.stringify(arguments_).includes(installationToken), false);
  assert.equal(arguments_.restrictions.terminal_enabled, true);
  assert.equal(arguments_.restrictions.provision_id, "id-9987807816");
  assert.equal(arguments_.restrictions.stripe_account_country, "US");
  assert.equal(arguments_.restrictions.stripe_location_id, "tml_us_test");
  const plaintext = crypto.privateDecrypt({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, Buffer.from(arguments_.encryptedSecrets.ciphertext, "base64"));
  assert.deepEqual(JSON.parse(plaintext.toString("utf8")), {installationToken});
});

test("creates and reuses a Stripe Terminal location from the kiosk address", async () => {
  const created = [];
  const kioskData = {
    info: {
      address: "4514 Conchita Way",
      city: "Tarzana",
      state: "CA",
      zip: "91356",
      country: "US",
      location: "Tarzana Pilot",
    },
    hardware: {gateway: "STRIPE", gatewayoptions: "FULLPRICE"},
    pricing: {
      text: "LEASE - SIMPLE DAILY",
      currency: "US",
      kioskmode: "PURCHASE",
      initialperiod: 24,
      authamount: 1,
      dailyprice: 1,
      buyprice: 1,
      overdue: 30,
    },
    modules: [{moduleid: "module-us", slots: [{position: 1}]}],
  };
  const kiosk = {
    id: "id-us-terminal",
    data: () => kioskData,
  };
  const options = {
    getStripeClient: ({accountCountry, mode}) => {
      assert.equal(accountCountry, "US");
      assert.equal(mode, "test");
      return {
        accounts: {
          retrieve: async () => ({country: "US"}),
        },
        terminal: {
          locations: {
            create: async (body, requestOptions) => {
              created.push({body, requestOptions});
              return {id: "tml_us_test"};
            },
            retrieve: async (id) => ({id, address: {country: "US"}}),
          },
        },
      };
    },
  };
  const config = await provisionTerminalConfigForKiosk("CA8019", kiosk, options);
  assert.equal(config.stripeAccountCountry, "US");
  assert.equal(config.stripeLocationId, "tml_us_test");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].body.address, {
    line1: "4514 Conchita Way",
    city: "Tarzana",
    postal_code: "91356",
    country: "US",
    state: "CA",
  });
  assert.equal(created[0].body.metadata.chargerent_station_id, "CA8019");
  assert.match(created[0].requestOptions.idempotencyKey, /^chargerent-terminal-location-test-US-/);

  kioskData.paymentTerminal = {
    stripeLocations: {
      test_US: {
        locationId: config.stripeLocationId,
        addressHash: config.stripeLocationAddressHash,
        accountCountry: "US",
        stripeMode: "test",
      },
    },
  };
  const reused = await provisionTerminalConfigForKiosk("CA8019", kiosk, options);
  assert.equal(reused.stripeLocationId, "tml_us_test");
  assert.equal(created.length, 1);

  const wrongAccountOptions = {
    getStripeClient: () => ({
      accounts: {retrieve: async () => ({country: "CA"})},
      terminal: {locations: {create: async () => ({id: "tml_wrong_account"})}},
    }),
  };
  await assert.rejects(
      provisionTerminalConfigForKiosk("CA8019", kiosk, wrongAccountOptions),
      /address, but the configured Stripe test account is CA/,
  );
});

test("uses only the address country and rejects unsupported or incomplete addresses", () => {
  const kiosk = (country, address = "1 Main Street") => ({
    id: "id-terminal",
    data: () => ({
      info: {address, city: "Paris", zip: "75001", country},
      hardware: {gateway: "STRIPE", gatewayoptions: "FULLPRICE"},
      pricing: {
        text: "LEASE - SIMPLE DAILY",
        currency: "FR",
        kioskmode: "PURCHASE",
        initialperiod: 24,
        authamount: 1,
        dailyprice: 1,
        buyprice: 1,
        overdue: 30,
      },
      modules: [{moduleid: "module-1", slots: [{position: 1}]}],
    }),
  });
  assert.throws(() => terminalConfigForKiosk("GB8009", kiosk("GB")), /unsupported GB/);
  assert.equal(terminalConfigForKiosk("US8009", kiosk("FR")).stripeAccountCountry, "FR");
  assert.throws(() => terminalConfigForKiosk("CA8009", kiosk("")), /country in its physical address/);
  assert.throws(() => terminalConfigForKiosk("FR8009", kiosk("FR", "")), /complete physical address/);
});

test("provisions French test terminals in USD while using the shared account", () => {
  const config = terminalConfigForKiosk("FR8011", {
    id: "id-fr-terminal",
    data: () => ({
      info: {
        address: "212 Rue de Rivoli",
        city: "Paris",
        state: "FR",
        zip: "75001",
        country: "FR",
      },
      hardware: {gatewayoptions: "FULLPRICE"},
      pricing: {
        text: "PURCHASE - SIMPLE DAILY",
        currency: "FR",
        symbol: "€",
        kioskmode: "PURCHASE",
        initialperiod: 24,
        authamount: 2,
        dailyprice: 4,
        buyprice: 30,
        overdue: 30,
      },
      modules: [{moduleid: "module-fr", slots: [{position: 1}]}],
    }),
  });

  assert.equal(config.stripeAccountCountry, "FR");
  assert.equal(config.stripeMode, "test");
  assert.equal(config.currency, "usd");
  assert.equal(config.amountCents, 3000);
});

test("requires a boolean always-on hotspot setting", () => {
  assert.deepEqual(normalizeHotspotArguments({enabled: true}), {enabled: true});
  assert.throws(() => normalizeHotspotArguments({enabled: "true"}), /enabled value/);
});

test("requires the Chargerent relay before starting a WebRTC screen", () => {
  const normalized = normalizeWebRtcStartArguments({
    sessionId: "webrtc-test-session",
    offerSdp: "v=0",
    iceServers: [
      {urls: ["stun:stun.l.google.com:19302", "stun:untrusted.example:19302"]},
      {
        urls: ["turns:turn.chargerentstations.com:5349?transport=tcp"],
        username: "1700000600:operator:nonce",
        credential: "short-lived-credential",
      },
    ],
  });
  assert.deepEqual(normalized.iceServers[0].urls, ["stun:stun.l.google.com:19302"]);
  assert.equal(normalized.iceServers[1].username, "1700000600:operator:nonce");
  assert.throws(
      () => normalizeWebRtcStartArguments({
        sessionId: "webrtc-stale-session",
        offerSdp: "v=0",
        iceServers: [{urls: ["stun:stun.l.google.com:19302"]}],
      }),
      /dashboard is out of date/,
  );
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

test("creates short-lived authenticated TURN credentials", () => {
  const now = 1_700_000_000_000;
  const result = createTurnIceConfiguration(
      "partner:user",
      "test-turn-secret",
      now,
      "fixednonce",
  );
  const username = "1700000600:partner_user:fixednonce";
  const expectedCredential = crypto.createHmac("sha1", "test-turn-secret")
      .update(username)
      .digest("base64");

  assert.equal(result.expiresAt, 1_700_000_600_000);
  assert.deepEqual(result.iceServers[0].urls, [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
  ]);
  assert.deepEqual(result.iceServers[1], {
    urls: [
      "turns:turn.chargerentstations.com:5349?transport=tcp",
      "turns:turn.chargerentstations.com:5349?transport=udp",
    ],
    username,
    credential: expectedCredential,
  });
  assert.throws(
      () => createTurnIceConfiguration("partner", "", now, "fixednonce"),
      /relay is not configured/,
  );
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
