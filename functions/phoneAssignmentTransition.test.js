/* eslint-env node */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  assignDevice,
  deviceIdFromPublicKey,
  expirePendingAssignments,
  pollDeviceCommand,
  recordCommandResult,
  recordHeartbeat,
} = require("./phoneControl");

const DELETED = Symbol("Firestore delete");
const OLD_INSTALLATION_ID = "a".repeat(64);
const admin = {firestore: {FieldValue: {
  serverTimestamp: () => new Date(),
  delete: () => DELETED,
}}};

function database(initial) {
  const documents = new Map(Object.entries(initial));
  const snapshot = (ref) => ({
    id: ref.id,
    ref,
    exists: documents.has(ref.path),
    data: () => documents.get(ref.path),
  });
  const querySnapshot = (query) => ({
    docs: [...documents.keys()]
        .filter((path) => path.startsWith(`${query.collection}/`))
        .map((path) => ({path, id: path.slice(query.collection.length + 1)}))
        .filter((item) => {
          const field = query.field.split(".").reduce((value, key) => value?.[key], documents.get(item.path));
          return query.operator === "==" ? field === query.value : field <= query.value;
        })
        .slice(0, query.maxResults || Infinity)
        .map((item) => snapshot({path: item.path, id: item.id})),
  });
  const read = async (value) => value.kind === "query" ? querySnapshot(value) : snapshot(value);
  const applyFields = (current, fields, merge) => {
    const next = merge ? {...current} : {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === DELETED) delete next[key];
      else next[key] = value;
    }
    return next;
  };
  const db = {
    collection(name) {
      return {
        doc(id) {
          const ref = {id, path: `${name}/${id}`};
          ref.get = () => read(ref);
          return ref;
        },
        where(field, operator, value) {
          assert.ok(["==", "<="].includes(operator));
          const query = {kind: "query", collection: name, field, operator, value};
          query.get = () => read(query);
          query.limit = (count) => {
            query.maxResults = count;
            return query;
          };
          return query;
        },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        get: read,
        set: (ref, fields, options = {}) => writes.push(() => documents.set(
            ref.path, applyFields(documents.get(ref.path), fields, options.merge === true))),
        update: (ref, fields) => writes.push(() => {
          assert.equal(documents.has(ref.path), true, `${ref.path} must exist`);
          const next = structuredClone(documents.get(ref.path));
          for (const [path, value] of Object.entries(fields)) {
            const keys = path.split(".");
            const leaf = keys.pop();
            let target = next;
            for (const key of keys) target = target[key] ||= {};
            if (value === DELETED) delete target[leaf];
            else target[leaf] = value;
          }
          documents.set(ref.path, next);
        }),
        create: (ref, fields) => writes.push(() => {
          assert.equal(documents.has(ref.path), false, `${ref.path} must be new`);
          documents.set(ref.path, applyFields({}, fields, false));
        }),
        delete: (ref) => writes.push(() => documents.delete(ref.path)),
      });
      for (const write of writes) write();
      return result;
    },
  };
  return {db, documents};
}

function kiosk(stationId) {
  return {
    stationid: stationId,
    info: {address: "1 Rue de Rivoli", city: "Paris", zip: "75001", country: "FR"},
    hardware: {gateway: "STRIPE", gatewayoptions: "FULLPRICE"},
    pricing: {
      text: "LEASE - SIMPLE DAILY", currency: "FR", initialperiod: 24,
      authamount: 2, dailyprice: 3, buyprice: 30, overdue: 30,
    },
    modules: [{moduleid: `module-${stationId}`, slots: [{position: 1}]}],
    paymentTerminal: {stripeMode: "live", readerType: "bbpos_wisepad3"},
  };
}

function fixture({checkoutBusy = false, reservation = false} = {}) {
  const agent = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const controller = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  const encryption = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
  const publicKey = agent.publicKey.export({type: "spki", format: "der"}).toString("base64");
  const deviceId = deviceIdFromPublicKey(publicKey);
  const terminal = {
    enabled: true, state: "ready", stationId: "FR8011", installationId: OLD_INSTALLATION_ID,
    stripeMode: "live", packageName: "com.chargerent.media.lab", confirmedAt: new Date(),
  };
  const initial = {
    [`phoneDevices/${deviceId}`]: {
      deviceId, publicKey, enrollmentState: "enrolled", deviceKind: "integrated_kiosk",
      packageName: "com.chargerent.media.lab", stationId: "FR8011", assignmentState: "assigned",
      terminal, inventory: {
        media: {checkoutBusy},
        agentStationId: "FR8011",
        stripeTerminal: {configured: true, stationId: "FR8011", installationId: OLD_INSTALLATION_ID,
          stripeMode: "live"},
        commandEncryptionPublicKey: encryption.publicKey.export({type: "spki", format: "der"}).toString("base64"),
      },
      inventoryAt: new Date(),
    },
    "phoneKioskAssignments/FR8011": {stationId: "FR8011", deviceId, terminalEnabled: true, terminal},
    [`kioskInstallations/${OLD_INSTALLATION_ID}`]: {
      active: true, confirmationState: "confirmed", deviceId, stationId: "FR8011",
    },
    "kiosks/FR8011": kiosk("FR8011"),
    "kiosks/FR8012": kiosk("FR8012"),
  };
  if (reservation) initial["kioskTerminalReservations/active-lock"] = {
    installationId: OLD_INSTALLATION_ID, expiresAt: new Date(Date.now() + 60000),
  };
  const {db, documents} = database(initial);
  const dependencies = {
    db, admin,
    privateKeyPem: controller.privateKey.export({type: "pkcs8", format: "pem"}),
    getStripeClient: () => ({
      accounts: {retrieve: async () => ({country: "FR", details_submitted: true, charges_enabled: true})},
      terminal: {locations: {create: async (input) => ({
        id: `tml_${input.metadata.chargerent_station_id}123456`,
      })}},
    }),
  };
  function signedRequest(data) {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const rawBody = Buffer.from(JSON.stringify({data}));
    const signature = crypto.sign("sha256",
        Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), rawBody]),
        agent.privateKey).toString("base64");
    const headers = {
      "x-phone-device": deviceId,
      "x-phone-timestamp": String(timestamp),
      "x-phone-nonce": nonce,
      "x-phone-signature": signature,
    };
    return {rawBody, body: {data}, get: (name) => headers[String(name).toLowerCase()] || ""};
  }
  const doc = (collection, id) => documents.get(`${collection}/${id}`);
  return {deviceId, documents, dependencies, signedRequest, doc};
}

function disableTerminal(f) {
  const device = f.doc("phoneDevices", f.deviceId);
  device.terminal = {enabled: false, state: "disabled", stationId: "FR8011",
    packageName: "com.chargerent.media.lab"};
  device.inventory.stripeTerminal = {configured: false};
  device.inventory.m2Terminal = {configured: false};
  device.inventory.agentStationId = "FR8011";
  device.inventoryAt = new Date();
  f.doc("phoneKioskAssignments", "FR8011").terminalEnabled = false;
  f.documents.delete(`kioskInstallations/${OLD_INSTALLATION_ID}`);
}

function profileHeartbeatFixture() {
  const f = fixture();
  f.doc("kiosks", "FR8011").ui = {profileSections: {chargerentApp: {
    profileId: "gartner", profileVersion: 3, appliedAt: "2026-10-15T10:38:42.418Z",
  }}};
  const inventory = {
    agentStationId: "FR8011",
    media: {available: true, identityReady: true, lastError: null,
      clientProfileId: "gartner", clientProfileVersion: 3},
  };
  return {...f, inventory,
    heartbeat: () => recordHeartbeat({inventory}, f.signedRequest({inventory}), f.dependencies)};
}

test("signed loaded-profile heartbeats confirm the editor without requiring a new app or branding capability", async () => {
  const f = profileHeartbeatFixture();
  const {profileDeviceStatus} = await import("../src/utils/profileDevices.js");
  const kiosk = f.doc("kiosks", "FR8011");
  kiosk.reportedUiProfile = {status: "applied", profileId: "legacy",
    sections: {kiosk: {status: "applied", profileId: "legacy", profileVersion: 4}}};
  const previous = structuredClone(kiosk.reportedUiProfile);
  const beforeTerminal = structuredClone(f.doc("phoneDevices", f.deviceId).terminal);
  assert.equal(profileDeviceStatus(kiosk, "chargerentApp", {id: "gartner"}),
      "Published · awaiting confirmation");
  await f.heartbeat();
  const updated = f.doc("kiosks", "FR8011");
  const report = updated.reportedUiProfile.sections.chargerentApp;
  assert.equal(profileDeviceStatus(updated, "chargerentApp", {id: "gartner"}), "Confirmed loaded");
  assert.equal(report.deviceId, f.deviceId);
  assert.equal(report.profileVersion, 3);
  assert.equal(report.publicationAppliedAt, kiosk.ui.profileSections.chargerentApp.appliedAt);
  assert.ok(Number.isFinite(Date.parse(report.reportedAt)));
  assert.deepEqual(updated.reportedUiProfile.sections.kiosk, previous.sections.kiosk);
  assert.equal(updated.reportedUiProfile.profileId, "legacy");
  assert.deepEqual(f.doc("phoneDevices", f.deviceId).terminal, beforeTerminal);
  await f.heartbeat();
  assert.equal(f.doc("kiosks", "FR8011").reportedUiProfile.sections.chargerentApp, report,
      "repeated heartbeats must not rewrite an unchanged acknowledgment");
});

test("a publication is pending until the signed heartbeat reports its exact loaded version", async () => {
  const f = profileHeartbeatFixture();
  const {profileDeviceStatus} = await import("../src/utils/profileDevices.js");
  await f.heartbeat();
  f.doc("kiosks", "FR8011").ui.profileSections.chargerentApp.profileVersion = 4;
  await f.heartbeat();
  assert.equal(profileDeviceStatus(f.doc("kiosks", "FR8011"), "chargerentApp", {id: "gartner"}),
      "Published · awaiting confirmation");
  f.inventory.media.clientProfileVersion = 4;
  await f.heartbeat();
  assert.equal(profileDeviceStatus(f.doc("kiosks", "FR8011"), "chargerentApp", {id: "gartner"}),
      "Confirmed loaded");
});

test("profile confirmations reject mismatched, failed and incomplete media reports", async () => {
  for (const change of [
    (f) => { f.inventory.media.clientProfileVersion = 2; },
    (f) => { f.inventory.media.clientProfileVersion = "3"; },
    (f) => { f.inventory.media.clientProfileVersion = 0; },
    (f) => { f.inventory.media.clientProfileId = "another-client"; },
    (f) => { f.inventory.media.lastError = "Profile could not load"; },
    (f) => { f.inventory.media.available = false; },
    (f) => { delete f.inventory.media.identityReady; },
    (f) => { f.inventory.media.identityReady = false; },
    (f) => { delete f.inventory.media; },
    (f) => { delete f.doc("kiosks", "FR8011").ui; },
  ]) {
    const f = profileHeartbeatFixture();
    change(f);
    await f.heartbeat();
    assert.equal(f.doc("kiosks", "FR8011").reportedUiProfile, undefined, change.toString());
    assert.ok(f.doc("phoneDevices", f.deviceId).lastSeenAt, "heartbeat must still succeed");
  }
});

test("profile confirmations require the unique current station and settled device assignment", async () => {
  for (const change of [
    (f) => { f.inventory.agentStationId = "FR8012"; },
    (f) => { f.inventory.assignmentTransitionPending = true; },
    (f) => { f.doc("phoneDevices", f.deviceId).deviceKind = "managed_phone"; },
    (f) => { f.doc("phoneDevices", f.deviceId).pendingAssignment = {
      commandId: "move", toStationId: "FR8012"}; },
    (f) => { f.doc("phoneDevices", f.deviceId).assignmentTransitionOutcome = {
      commandId: "move", state: "rolled_back", stationId: "FR8011"}; },
    (f) => { f.doc("phoneKioskAssignments", "FR8011").deviceId = "another-device"; },
    (f) => { f.doc("phoneKioskAssignments", "FR8011").pendingDeviceId = "another-device"; },
    (f) => { f.documents.delete("phoneKioskAssignments/FR8011"); },
    (f) => { f.documents.set("kiosks/duplicate", structuredClone(f.doc("kiosks", "FR8011"))); },
  ]) {
    const f = profileHeartbeatFixture();
    change(f);
    await f.heartbeat();
    assert.equal(f.doc("kiosks", "FR8011").reportedUiProfile, undefined, change.toString());
    assert.equal(f.doc("kiosks", "FR8012").reportedUiProfile, undefined);
  }
});

test("profile acknowledgment retries recheck the latest publication before writing", async () => {
  const f = profileHeartbeatFixture();
  const originalTransaction = f.dependencies.db.runTransaction;
  f.dependencies.db.runTransaction = async (callback) => {
    await originalTransaction((transaction) => callback({...transaction, set: () => {}, update: () => {}}));
    f.doc("kiosks", "FR8011").ui.profileSections.chargerentApp.profileVersion = 4;
    return originalTransaction(callback);
  };
  await f.heartbeat();
  assert.equal(f.doc("kiosks", "FR8011").reportedUiProfile, undefined);
});

test('authenticated heartbeats refresh branding only for the settled screen station binding', async () => {
  const f = fixture();
  const kiosk = f.doc('kiosks', 'FR8011');
  kiosk.hardware.screen = '32in';
  kiosk.stationBrand = 'eventcharging';
  const inventory = structuredClone(f.doc('phoneDevices', f.deviceId).inventory);
  inventory.stripeTerminal.supportsStationBrand = true;
  inventory.stripeTerminal.supportsStationBrandRefresh = true;
  const beforeTerminal = structuredClone(f.doc('phoneDevices', f.deviceId).terminal);
  const heartbeat = () => recordHeartbeat({inventory}, f.signedRequest({inventory}), f.dependencies);
  assert.deepEqual((await heartbeat()).stationBrandConfiguration, {stationId: 'FR8011', brand: 'eventcharging'});
  kiosk.stationBrand = 'chargedrops';
  assert.equal((await heartbeat()).stationBrandConfiguration.brand, 'chargedrops');
  assert.deepEqual(f.doc('phoneDevices', f.deviceId).terminal, beforeTerminal);
  inventory.stripeTerminal.configured = false;
  assert.equal((await heartbeat()).stationBrandConfiguration.brand, 'chargedrops');
  for (const screen of ['no screen', '0', undefined]) {
    kiosk.hardware.screen = screen;
    assert.equal((await heartbeat()).stationBrandConfiguration, undefined);
  }
  kiosk.hardware.screen = '32';
  inventory.stripeTerminal.supportsStationBrandRefresh = false;
  assert.equal((await heartbeat()).stationBrandConfiguration, undefined);
  inventory.stripeTerminal.supportsStationBrandRefresh = true;
  inventory.agentStationId = 'FR8012';
  assert.equal((await heartbeat()).stationBrandConfiguration, undefined);
  inventory.agentStationId = 'FR8011';
  inventory.assignmentTransitionPending = true;
  assert.equal((await heartbeat()).stationBrandConfiguration, undefined);
  inventory.assignmentTransitionPending = false;
  f.doc('phoneKioskAssignments', 'FR8011').deviceId = 'different-device';
  assert.equal((await heartbeat()).stationBrandConfiguration, undefined);
  f.doc('phoneKioskAssignments', 'FR8011').deviceId = f.deviceId;
  const device = f.doc('phoneDevices', f.deviceId);
  device.pendingAssignment = {commandId: 'pending-fixture', fromStationId: 'FR8011', toStationId: 'FR8012'};
  assert.equal((await heartbeat()).stationBrandConfiguration, undefined);
  delete device.pendingAssignment;
  device.assignmentTransitionOutcome = {commandId: 'rollback-fixture', state: 'rolled_back', stationId: 'FR8011'};
  assert.equal((await heartbeat()).stationBrandConfiguration, undefined);
});

test('heartbeat transaction retries cannot return stale transitions or recreate a resolved assignment', async () => {
  for (const field of ['pendingAssignment', 'assignmentTransitionOutcome']) {
    const f = fixture();
    const device = f.doc('phoneDevices', f.deviceId);
    device[field] = field === 'pendingAssignment'
      ? {commandId: 'retry-fixture', fromStationId: 'FR8011', toStationId: 'FR8011'}
      : {commandId: 'retry-fixture', state: 'rolled_back', stationId: 'FR8011'};
    const inventory = structuredClone(device.inventory);
    inventory.assignmentTransitionPending = field === 'pendingAssignment';
    inventory.assignmentTransitionCommandId = 'retry-fixture';
    const originalTransaction = f.dependencies.db.runTransaction;
    f.dependencies.db.runTransaction = async (callback) => {
      // First attempt loses its read version; discard writes as Firestore does.
      await originalTransaction((transaction) => callback({...transaction, set: () => {}, update: () => {}}));
      delete device[field];
      return originalTransaction(callback);
    };
    const result = await recordHeartbeat({inventory}, f.signedRequest({inventory}), f.dependencies);
    assert.equal(result.assignmentTransition, undefined);
    assert.equal(result.assignmentTransitionOutcome, undefined);
    assert.equal(f.doc('phoneDevices', f.deviceId)[field], undefined);
  }
});

async function stageMove(f) {
  return assignDevice({deviceId: f.deviceId, stationId: "FR8012", terminalEnabled: true, stripeMode: "live"},
      {uid: "operator", isAdmin: true}, f.dependencies);
}

async function deliverPendingCommand(f, pending) {
  const before = {agentStationId: pending.fromStationId};
  await recordHeartbeat({inventory: before}, f.signedRequest({inventory: before}), f.dependencies);
  const attested = {agentStationId: pending.toStationId, assignmentTransitionPending: true,
    assignmentTransitionCommandId: pending.commandId};
  await recordHeartbeat({inventory: attested}, f.signedRequest({inventory: attested}), f.dependencies);
  const {command} = await pollDeviceCommand({}, f.signedRequest({}), f.dependencies);
  assert.equal(command.id, pending.commandId);
}

function confirmedResult(pending) {
  const terminal = pending.terminal;
  return {
    applied: true, packageName: terminal.packageName,
    terminal: {
      configured: true, installationId: terminal.installationId,
      stationId: terminal.stationId, provisionId: terminal.provisionId,
      moduleId: terminal.moduleId, slotCount: 1, currency: "eur",
      stripeMode: terminal.stripeMode, stripeAccountCountry: terminal.stripeAccountCountry,
      readerType: terminal.stripeReaderType, stripeLocationId: terminal.stripeLocationId,
    },
    lockdown: {active: false},
  };
}

test("staged move commits station, payment installation, and assignment only after a matching device ACK", async () => {
  const f = fixture();
  const staged = await stageMove(f);
  assert.equal(staged.pending, true);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
  assert.equal(f.doc("kioskInstallations", pending.installationId).active, false);
  assert.equal(f.doc("phoneKioskAssignments", "FR8012").pendingDeviceId, f.deviceId);

  const first = await recordHeartbeat({inventory: {agentStationId: "FR8011"}},
      f.signedRequest({inventory: {agentStationId: "FR8011"}}), f.dependencies);
  assert.equal(first.stationId, "FR8012");
  assert.equal(first.assignmentTransition.commandId, pending.commandId);
  assert.equal((await pollDeviceCommand({}, f.signedRequest({}), f.dependencies)).command, null);

  const attested = {agentStationId: "FR8012", assignmentTransitionPending: true,
    assignmentTransitionCommandId: pending.commandId};
  await recordHeartbeat({inventory: attested}, f.signedRequest({inventory: attested}), f.dependencies);
  const {command} = await pollDeviceCommand({}, f.signedRequest({}), f.dependencies);
  assert.equal(command.id, pending.commandId);
  await recordCommandResult({commandId: command.id, status: "completed", result: confirmedResult(pending)},
      f.signedRequest({commandId: command.id}), f.dependencies);

  const device = f.doc("phoneDevices", f.deviceId);
  assert.equal(device.stationId, "FR8012");
  assert.equal(device.pendingAssignment, undefined);
  assert.equal(device.terminal.state, "ready");
  assert.equal(f.doc("phoneKioskAssignments", "FR8011"), undefined);
  assert.equal(f.doc("phoneKioskAssignments", "FR8012").deviceId, f.deviceId);
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, false);
  assert.equal(f.doc("kioskInstallations", pending.installationId).active, true);
});

test("first assignment with payment provisioning reserves and commits its target", async () => {
  const f = fixture();
  const device = f.doc("phoneDevices", f.deviceId);
  device.stationId = null;
  device.assignmentState = "unassigned";
  device.terminal = {enabled: false, state: "disabled", packageName: "com.chargerent.media.lab"};
  device.inventory.stripeTerminal = {configured: false};
  device.inventory.agentStationId = "";
  device.inventoryAt = new Date();
  f.documents.delete("phoneKioskAssignments/FR8011");
  f.documents.delete(`kioskInstallations/${OLD_INSTALLATION_ID}`);
  const staged = await assignDevice({deviceId: f.deviceId, stationId: "FR8011",
    terminalEnabled: true, stripeMode: "live"}, {uid: "operator"}, f.dependencies);
  assert.equal(staged.pending, true);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  assert.equal(pending.fromStationId, "");
  assert.equal(f.doc("phoneKioskAssignments", "FR8011").pendingDeviceId, f.deviceId);
  await deliverPendingCommand(f, pending);
  await recordCommandResult({commandId: pending.commandId, status: "completed", result: confirmedResult(pending)},
      f.signedRequest({commandId: pending.commandId}), f.dependencies);
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("phoneKioskAssignments", "FR8011").deviceId, f.deviceId);
  assert.equal(f.doc("kioskInstallations", pending.installationId).active, true);
});

test("moving a disabled kiosk waits for signed disable confirmation before changing station", async () => {
  const f = fixture();
  disableTerminal(f);
  const staged = await assignDevice({deviceId: f.deviceId, stationId: "FR8012",
    terminalEnabled: false}, {uid: "operator"}, f.dependencies);
  assert.equal(staged.pending, true);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  const command = f.doc("phoneDeviceCommands", pending.commandId);
  assert.equal(command.arguments.packageName, "com.chargerent.media.lab");
  assert.deepEqual(command.arguments.restrictions, {terminal_enabled: false});
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("phoneKioskAssignments", "FR8011").deviceId, f.deviceId);
  await deliverPendingCommand(f, pending);
  await recordCommandResult({commandId: pending.commandId, status: "completed", result: {
    applied: true, packageName: "com.chargerent.media.lab", terminal: {configured: false},
  }}, f.signedRequest({commandId: pending.commandId}), f.dependencies);
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8012");
  assert.equal(f.doc("phoneDevices", f.deviceId).terminal.enabled, false);
  assert.equal(f.doc("phoneKioskAssignments", "FR8011"), undefined);
  assert.equal(f.doc("phoneKioskAssignments", "FR8012").deviceId, f.deviceId);
});

test("same-station disabled no-op requires fresh local terminal-off inventory", async () => {
  const healthy = fixture();
  disableTerminal(healthy);
  const unchanged = await assignDevice({deviceId: healthy.deviceId, stationId: "FR8011",
    terminalEnabled: false}, {uid: "operator"}, healthy.dependencies);
  assert.equal(unchanged.unchanged, true);
  assert.equal(healthy.doc("phoneDevices", healthy.deviceId).pendingAssignment, undefined);

  const stale = fixture();
  disableTerminal(stale);
  stale.doc("phoneDevices", stale.deviceId).inventoryAt = new Date(Date.now() - 4 * 60 * 1000);
  await assert.rejects(() => assignDevice({deviceId: stale.deviceId, stationId: "FR8011",
    terminalEnabled: false}, {uid: "operator"}, stale.dependencies),
  /payment state does not match the disabled assignment/);
  assert.equal(stale.doc("phoneDevices", stale.deviceId).stationId, "FR8011");
  assert.equal(stale.doc("phoneDevices", stale.deviceId).pendingAssignment, undefined);
});

test("a disabled server assignment cannot stage over configured local payment credentials", async () => {
  const f = fixture();
  disableTerminal(f);
  const device = f.doc("phoneDevices", f.deviceId);
  device.inventory.stripeTerminal = {configured: true, stationId: "FR8011",
    installationId: OLD_INSTALLATION_ID};
  await assert.rejects(() => assignDevice({deviceId: f.deviceId, stationId: "FR8012",
    terminalEnabled: false}, {uid: "operator"}, f.dependencies),
  /payment state does not match the disabled assignment/);
  assert.equal(device.stationId, "FR8011");
  assert.equal(device.pendingAssignment, undefined);
  assert.equal(f.doc("phoneKioskAssignments", "FR8011").deviceId, f.deviceId);
  assert.equal(f.doc("phoneKioskAssignments", "FR8012"), undefined);
});

test("failed move restores old assignment and keeps its confirmed installation active", async () => {
  const f = fixture();
  await stageMove(f);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  await recordCommandResult({commandId: pending.commandId, status: "failed", error: "Device rejected target"},
      f.signedRequest({commandId: pending.commandId}), f.dependencies);
  const device = f.doc("phoneDevices", f.deviceId);
  assert.equal(device.stationId, "FR8011");
  assert.equal(device.terminal.installationId, OLD_INSTALLATION_ID);
  assert.equal(device.pendingAssignment, undefined);
  assert.equal(device.assignmentError.stationId, "FR8012");
  assert.equal(f.doc("phoneKioskAssignments", "FR8011").deviceId, f.deviceId);
  assert.equal(f.doc("phoneKioskAssignments", "FR8012"), undefined);
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
  assert.equal(f.doc("kioskInstallations", pending.installationId).active, false);
  await recordCommandResult({commandId: pending.commandId, status: "completed", result: confirmedResult(pending)},
      f.signedRequest({commandId: pending.commandId}), f.dependencies);
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("phoneKioskAssignments", "FR8012"), undefined);
  assert.equal(f.doc("phoneDeviceCommands", pending.commandId).status, "failed");
});

test("a completed command with mismatched device settings cannot commit a move", async () => {
  const f = fixture();
  await stageMove(f);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  const mismatched = confirmedResult(pending);
  mismatched.terminal.stationId = "FR8011";
  await deliverPendingCommand(f, pending);
  await recordCommandResult({commandId: pending.commandId, status: "completed", result: mismatched},
      f.signedRequest({commandId: pending.commandId}), f.dependencies);
  assert.equal(f.doc("phoneDeviceCommands", pending.commandId).status, "failed");
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
  assert.equal(f.doc("phoneKioskAssignments", "FR8012"), undefined);
});

test("a result received before the attested command delivery cannot commit a move", async () => {
  const f = fixture();
  await stageMove(f);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  await recordCommandResult({commandId: pending.commandId, status: "completed", result: confirmedResult(pending)},
      f.signedRequest({commandId: pending.commandId}), f.dependencies);
  assert.equal(f.doc("phoneDeviceCommands", pending.commandId).status, "failed");
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("phoneKioskAssignments", "FR8012"), undefined);
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
});

test("an expired pending command rolls back its reservation without revoking the old installation", async () => {
  const f = fixture();
  await stageMove(f);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  f.doc("phoneDeviceCommands", pending.commandId).expiresAt = Date.now() - 1;
  const result = await pollDeviceCommand({}, f.signedRequest({}), f.dependencies);
  assert.equal(result.command, null);
  assert.equal(f.doc("phoneDevices", f.deviceId).pendingAssignment, undefined);
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("phoneKioskAssignments", "FR8012"), undefined);
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
  assert.equal(f.doc("phoneDeviceCommands", pending.commandId).status, "expired");
});

test("offline pending assignment expires without another device poll", async () => {
  const f = fixture();
  await stageMove(f);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  const command = f.doc("phoneDeviceCommands", pending.commandId);
  assert.equal(command.expiresAt - command.issuedAt, 5 * 60 * 1000);
  assert.equal(pending.expiresAt, command.expiresAt);
  assert.equal((await expirePendingAssignments({...f.dependencies,
    now: () => command.issuedAt + 3 * 60 * 1000})).expired, 0);
  const result = await expirePendingAssignments({...f.dependencies,
    now: () => command.expiresAt + 1});
  assert.equal(result.expired, 1);
  assert.equal(f.doc("phoneDevices", f.deviceId).pendingAssignment, undefined);
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("phoneKioskAssignments", "FR8012"), undefined);
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
  assert.equal(f.doc("phoneDeviceCommands", pending.commandId).status, "expired");
  assert.equal((await expirePendingAssignments({...f.dependencies})).expired, 0);
});

test("saving the same station and payment mode is idempotent", async () => {
  const f = fixture();
  const before = f.documents.size;
  const result = await assignDevice({deviceId: f.deviceId, stationId: "FR8011",
    terminalEnabled: true, stripeMode: "live"}, {uid: "operator"}, f.dependencies);
  assert.equal(result.unchanged, true);
  assert.equal(f.documents.size, before);
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
  assert.equal(f.doc("phoneDevices", f.deviceId).pendingAssignment, undefined);
});

test("same-station terminal reprovision resolves with an authoritative committed outcome", async () => {
  const f = fixture();
  const staged = await assignDevice({deviceId: f.deviceId, stationId: "FR8011",
    terminalEnabled: true, stripeMode: "live", forceReprovision: true},
  {uid: "operator"}, f.dependencies);
  assert.equal(staged.pending, true);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  assert.equal(pending.fromStationId, "FR8011");
  assert.equal(pending.toStationId, "FR8011");
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
  await deliverPendingCommand(f, pending);
  await recordCommandResult({commandId: pending.commandId, status: "completed", result: confirmedResult(pending)},
      f.signedRequest({commandId: pending.commandId}), f.dependencies);
  assert.equal(f.doc("phoneDevices", f.deviceId).stationId, "FR8011");
  assert.equal(f.doc("phoneDevices", f.deviceId).terminal.installationId, pending.installationId);
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, false);
  assert.equal(f.doc("kioskInstallations", pending.installationId).active, true);
  const response = await recordHeartbeat({inventory: {agentStationId: "FR8011"}},
      f.signedRequest({inventory: {agentStationId: "FR8011"}}), f.dependencies);
  assert.equal(response.assignmentTransition, undefined);
  assert.deepEqual(response.assignmentTransitionOutcome,
      {commandId: pending.commandId, state: "committed", stationId: "FR8011",
        terminalEnabled: true, installationId: pending.installationId});
});

test("same-station failed reprovision resolves with an authoritative rollback outcome", async () => {
  const f = fixture();
  await assignDevice({deviceId: f.deviceId, stationId: "FR8011",
    terminalEnabled: true, stripeMode: "live", forceReprovision: true},
  {uid: "operator"}, f.dependencies);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  await deliverPendingCommand(f, pending);
  await recordCommandResult({commandId: pending.commandId, status: "failed", error: "Device rejected target"},
      f.signedRequest({commandId: pending.commandId}), f.dependencies);
  assert.equal(f.doc("phoneDevices", f.deviceId).terminal.installationId, OLD_INSTALLATION_ID);
  assert.equal(f.doc("kioskInstallations", OLD_INSTALLATION_ID).active, true);
  assert.equal(f.doc("kioskInstallations", pending.installationId).active, false);
  const response = await recordHeartbeat({inventory: {agentStationId: "FR8011"}},
      f.signedRequest({inventory: {agentStationId: "FR8011"}}), f.dependencies);
  assert.equal(response.assignmentTransition, undefined);
  assert.deepEqual(response.assignmentTransitionOutcome,
      {commandId: pending.commandId, state: "rolled_back", stationId: "FR8011",
        terminalEnabled: true, installationId: OLD_INSTALLATION_ID});
});

test("another Save waits for signed local rollback resolution and exact installation identity", async () => {
  const f = fixture();
  await stageMove(f);
  const pending = f.doc("phoneDevices", f.deviceId).pendingAssignment;
  await recordCommandResult({commandId: pending.commandId, status: "failed", error: "Device rejected target"},
      f.signedRequest({commandId: pending.commandId}), f.dependencies);
  await assert.rejects(() => stageMove(f), /finish the previous assignment/);

  const commandEncryptionPublicKey = f.doc("phoneDevices", f.deviceId).inventory.commandEncryptionPublicKey;
  const wrong = {agentStationId: "FR8011", assignmentTransitionPending: false,
    assignmentTransitionResolvedCommandId: pending.commandId,
    assignmentTransitionResolvedState: "rolled_back",
    commandEncryptionPublicKey,
    stripeTerminal: {configured: true, stationId: "FR8011", stripeMode: "live",
      installationId: "wrong-installation"}};
  const unresolved = await recordHeartbeat({inventory: wrong},
      f.signedRequest({inventory: wrong}), f.dependencies);
  assert.deepEqual(unresolved.assignmentTransitionOutcome,
      {commandId: pending.commandId, state: "rolled_back", stationId: "FR8011",
        terminalEnabled: true, installationId: OLD_INSTALLATION_ID});
  await assert.rejects(() => stageMove(f), /finish the previous assignment/);

  const restored = {...wrong, stripeTerminal: {
    configured: true, stationId: "FR8011", stripeMode: "live",
    installationId: OLD_INSTALLATION_ID}};
  const resolved = await recordHeartbeat({inventory: restored},
      f.signedRequest({inventory: restored}), f.dependencies);
  assert.equal(resolved.assignmentTransitionOutcome, undefined);
  assert.equal(f.doc("phoneDevices", f.deviceId).assignmentTransitionOutcome, undefined);
  assert.equal((await stageMove(f)).pending, true);
});

test("a revoked prior installation requires repair before same-station Save", async () => {
  const f = fixture();
  f.doc("kioskInstallations", OLD_INSTALLATION_ID).active = false;
  await assert.rejects(() => assignDevice({deviceId: f.deviceId, stationId: "FR8011",
    terminalEnabled: true, stripeMode: "live"}, {uid: "operator"}, f.dependencies),
  /current payment installation is not confirmed/);
  assert.equal(f.doc("phoneDevices", f.deviceId).pendingAssignment, undefined);
});

test("a move cannot start when old local payment credentials are mismatched or stale", async () => {
  const mismatched = fixture();
  mismatched.doc("phoneDevices", mismatched.deviceId).inventory.stripeTerminal.installationId = "b".repeat(64);
  await assert.rejects(() => stageMove(mismatched), /current payment installation is not confirmed/);
  assert.equal(mismatched.doc("phoneDevices", mismatched.deviceId).stationId, "FR8011");
  assert.equal(mismatched.doc("phoneKioskAssignments", "FR8012"), undefined);

  const stale = fixture();
  stale.doc("phoneDevices", stale.deviceId).inventoryAt = new Date(Date.now() - 4 * 60 * 1000);
  await assert.rejects(() => stageMove(stale), /current payment installation is not confirmed/);
  assert.equal(stale.doc("phoneDevices", stale.deviceId).pendingAssignment, undefined);
});

test("assignment cannot interrupt checkout or a live charger reservation", async () => {
  const busy = fixture({checkoutBusy: true});
  await assert.rejects(() => stageMove(busy), /Finish the current checkout/);
  assert.equal(busy.doc("phoneDevices", busy.deviceId).pendingAssignment, undefined);
  const reserved = fixture({reservation: true});
  await assert.rejects(() => stageMove(reserved), /Finish the current checkout/);
  assert.equal(reserved.doc("phoneDevices", reserved.deviceId).pendingAssignment, undefined);
});

test("a duplicate target assignment record cannot be staged over", async () => {
  const f = fixture();
  f.documents.set("phoneKioskAssignments/FR8012", {stationId: "FR8012", deviceId: f.deviceId});
  await assert.rejects(() => stageMove(f), /existing assignment record/);
  assert.equal(f.doc("phoneDevices", f.deviceId).pendingAssignment, undefined);
  assert.equal(f.doc("phoneKioskAssignments", "FR8011").deviceId, f.deviceId);
});
