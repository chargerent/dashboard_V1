/* eslint-env node */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {assignDevice, recordCommandResult} = require("./phoneControl");

const DEVICE_ID = "abcdef1234567890";
const OLD_INSTALLATION = "a".repeat(64);
const APP_PACKAGE = "com.chargerent.media.lab";
const rsa = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
const identity = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"});
const DELETE = Symbol("delete");

function database(initial) {
  const documents = new Map(Object.entries(initial));
  const snapshot = (ref) => ({exists: documents.has(ref.path), id: ref.id, ref,
    data: () => documents.get(ref.path)});
  const write = (ref, value, merge) => {
    const next = {...(merge ? documents.get(ref.path) || {} : {}), ...value};
    for (const key of Object.keys(next)) if (next[key] === DELETE) delete next[key];
    documents.set(ref.path, next);
  };
  const collection = (name) => {
    const query = (filters = [], maximum = Infinity) => ({
      where: (field, operator, expected) => query([...filters, {field, operator, expected}], maximum),
      limit: (value) => query(filters, value),
      get: async () => {
        const docs = [...documents.keys()].filter((path) => path.startsWith(`${name}/`))
            .map((path) => snapshot({path, id: path.split("/")[1]}))
            .filter((item) => filters.every(({field, operator, expected}) => {
              assert.equal(operator, "==");
              return item.data()?.[field] === expected;
            })).slice(0, maximum);
        return {empty: !docs.length, docs};
      },
    });
    return {...query(), doc: (id) => {
      const ref = {id, path: `${name}/${id}`};
      ref.get = async () => snapshot(ref);
      return ref;
    }};
  };
  return {documents, db: {collection, runTransaction: async (callback) => callback({
    get: async (ref) => ref.get ? ref.get() : snapshot(ref),
    set: (ref, value, options) => write(ref, value, options?.merge),
    update: (ref, value) => {
      assert.ok(documents.has(ref.path), `Update target exists: ${ref.path}`);
      write(ref, value, true);
    },
    create: (ref, value) => {
      assert.ok(!documents.has(ref.path), `Create target is new: ${ref.path}`);
      write(ref, value, false);
    },
    delete: (ref) => documents.delete(ref.path),
  })}};
}

function kiosk(stationId) {
  return {stationid: stationId,
    info: {address: "1 Rue de Rivoli", city: "Paris", zip: "75001", country: "FR"},
    hardware: {gateway: "STRIPE", gatewayoptions: "FULLPRICE"},
    pricing: {text: "LEASE - SIMPLE DAILY", currency: "FR", kioskmode: "LEASE",
      initialperiod: 24, authamount: 30, dailyprice: 0, buyprice: 30, overdue: 24,
      rate: [{time: 1440, price: 0}]},
    modules: [{moduleid: "v2-fixture", slots: [{position: 1}, {position: 2}]}]};
}

function fixture({from, to = from, authority, mode = "live", managedPhone = false}) {
  const packageName = managedPhone ? "com.chargerent.kiosk.test.debug" : APP_PACKAGE;
  const terminal = {enabled: true, state: "ready", stationId: from,
    installationId: OLD_INSTALLATION, provisionId: from, moduleId: "v2-fixture",
    stripeLocationId: "tml_old", stripeMode: mode, stripeAccountCountry: "FR",
    stripeReaderType: "bbpos_wisepad3", packageName, confirmedAt: Date.now()};
  const device = {deviceId: DEVICE_ID, stationId: from, enrollmentState: "enrolled",
    deviceKind: managedPhone ? "managed_phone" : "integrated_kiosk", terminal,
    publicKey: identity.publicKey.export({type: "spki", format: "der"}).toString("base64"),
    inventoryAt: Date.now(), inventory: {agentVersionCode: 43, agentStationId: from,
      commandEncryptionPublicKey: rsa.publicKey.export({type: "spki", format: "der"}).toString("base64"),
      media: {checkoutBusy: false}, stripeTerminal: {configured: true,
        installationId: OLD_INSTALLATION, stationId: from, provisionId: from,
        moduleId: "v2-fixture", stripeLocationId: "tml_old", stripeMode: mode,
        readerType: "bbpos_wisepad3"}}};
  const previous = {deviceId: DEVICE_ID, stationId: from, active: true,
    confirmationState: "confirmed", stripeMode: mode};
  if (authority === "installation") previous.billingOwner = "amazon_v2";
  if (authority === "device") device.billingOwner = "amazon_v2";
  if (authority === "terminal") terminal.billingOwner = "amazon_v2";
  const state = database({
    [`phoneDevices/${DEVICE_ID}`]: device,
    [`kioskInstallations/${OLD_INSTALLATION}`]: previous,
    [`phoneKioskAssignments/${from}`]: {stationId: from, deviceId: DEVICE_ID, terminalEnabled: true, terminal},
    [`kiosks/${from}`]: kiosk(from), [`kiosks/${to}`]: kiosk(to),
  });
  const selections = [];
  const stripe = {
    accounts: {retrieve: async () => ({id: "acct_fixture", country: "FR",
      details_submitted: true, charges_enabled: true})},
    terminal: {locations: {create: async () => ({id: "tml_selected_account"})}},
  };
  return {...state, to, mode, selections, dependencies: {db: state.db,
    admin: {firestore: {FieldValue: {serverTimestamp: () => Date.now(), delete: () => DELETE}}},
    privateKeyPem: rsa.privateKey.export({type: "pkcs8", format: "pem"}),
    getStripeClient: (selection) => { selections.push(selection); return stripe; }}};
}

function authenticatedRequest(body) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = String(Date.now());
  const nonce = "ownership-fixture-nonce";
  const signed = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), rawBody]);
  const headers = {"X-Phone-Device": DEVICE_ID, "X-Phone-Timestamp": timestamp,
    "X-Phone-Nonce": nonce,
    "X-Phone-Signature": crypto.sign("sha256", signed, identity.privateKey).toString("base64")};
  return {body, rawBody, get: (header) => headers[header]};
}

async function assignAndConfirm(f, expectedOwner) {
  const result = await assignDevice({deviceId: DEVICE_ID, stationId: f.to,
    terminalEnabled: true, stripeMode: f.mode, forceReprovision: true,
    billingOwner: "amazon_v2"}, {uid: "fixture-admin"}, f.dependencies);
  const assigned = f.documents.get(`phoneDevices/${DEVICE_ID}`);
  const pending = assigned.pendingAssignment;
  const terminal = pending?.terminal || assigned.terminal;
  const newInstallation = f.documents.get(`kioskInstallations/${terminal.installationId}`);
  assert.notEqual(terminal.installationId, OLD_INSTALLATION);
  assert.equal(terminal.billingOwner, expectedOwner);
  assert.equal(assigned.billingOwner, expectedOwner);
  assert.equal(newInstallation.billingOwner, expectedOwner);
  assert.equal(newInstallation.stripeMode, f.mode);
  assert.equal(newInstallation.stripeLocationId, "tml_selected_account");
  assert.deepEqual(f.selections, [{accountCountry: "FR", mode: f.mode}]);
  const command = f.documents.get(`phoneDeviceCommands/${terminal.commandId}`);
  assert.equal(command.arguments.restrictions.billingOwner, undefined);
  assert.equal(command.arguments.restrictions.billing_owner, undefined);
  assert.equal(command.arguments.restrictions.stripe_mode, f.mode);
  if (pending) {
    assert.equal(result.pending, true);
    assert.equal(newInstallation.active, false);
    assert.equal(f.documents.get(`kioskInstallations/${OLD_INSTALLATION}`).active, true);
    pending.heartbeatAt = Date.now();
  }
  command.status = "delivered";
  const body = {commandId: command.id, status: "completed", result: {
    applied: true, packageName: terminal.packageName,
    terminal: {configured: true, installationId: terminal.installationId,
      stationId: f.to, provisionId: terminal.provisionId, moduleId: terminal.moduleId,
      slotCount: command.arguments.restrictions.slot_count, currency: "eur",
      stripeMode: f.mode, stripeAccountCountry: "FR", readerType: "bbpos_wisepad3",
      stripeLocationId: terminal.stripeLocationId},
  }};
  if (command.arguments.restrictions.checkout_execution === "local") Object.assign(body.result.terminal, {
    hardwareVendor: command.arguments.restrictions.hardware_vendor, checkoutExecution: "local",
    serialPort: command.arguments.restrictions.serial_port, boardCount: command.arguments.restrictions.board_count,
    slotsPerBoard: command.arguments.restrictions.slots_per_board,
  });
  if (command.arguments.restrictions.station_brand) body.result.terminal.stationBrand = command.arguments.restrictions.station_brand;
  await recordCommandResult(body, authenticatedRequest(body), f.dependencies);
  const confirmed = f.documents.get(`phoneDevices/${DEVICE_ID}`);
  assert.equal(confirmed.stationId, f.to);
  assert.equal(confirmed.terminal.state, "ready");
  assert.equal(confirmed.billingOwner, expectedOwner);
  assert.equal(confirmed.terminal.billingOwner, expectedOwner);
  const installation = f.documents.get(`kioskInstallations/${terminal.installationId}`);
  assert.equal(installation.billingOwner, expectedOwner);
  assert.equal(installation.confirmationState, "confirmed");
  assert.equal(f.documents.get(`phoneKioskAssignments/${f.to}`).terminal.billingOwner, expectedOwner);
  if (pending) assert.equal(installation.active, true);
}

test("FR8012 same-device replacement persists Amazon ownership through the existing confirmation", async () => {
  await assignAndConfirm(fixture({from: "FR8012"}), "amazon_v2");
});

test("replacement at a different owned station retains previous installation authority", async () => {
  await assignAndConfirm(fixture({from: "FR8013", authority: "installation"}), "amazon_v2");
});

for (const authority of ["installation", "device", "terminal"]) {
  test(`reassignment preserves Amazon ${authority} authority through device confirmation`, async () => {
    await assignAndConfirm(fixture({from: "FR8013", to: "FR8014", authority}), "amazon_v2");
  });
}

test("unrelated integrated test assignment keeps its mode and ignores client-supplied owner", async () => {
  await assignAndConfirm(fixture({from: "FR8011", mode: "test"}), undefined);
});

test("unrelated managed-phone test assignment retains its existing confirmation behavior", async () => {
  await assignAndConfirm(fixture({from: "FR8011", mode: "test", managedPhone: true}), undefined);
});

test("explicit local provisioning replaces station billing ownership only for the new installation", async () => {
  const f = fixture({from: "FR8013", authority: "installation"});
  f.documents.get(`phoneDevices/${DEVICE_ID}`).inventory.agentVersionCode = 79;
  Object.assign(f.documents.get("kiosks/FR8013").hardware, {vendor: "lita", checkoutExecution: "local", billingOwner: "local_station_v1", boardCount: 1, slotsPerBoard: 2});
  await assignAndConfirm(f, "local_station_v1");
  assert.equal(f.documents.get(`kioskInstallations/${OLD_INSTALLATION}`).billingOwner, "amazon_v2");
});

test("local serial provisioning rejects an app predating local checkout before queuing a device command", async () => {
  const f = fixture({from: "FR8013", mode: "test"});
  Object.assign(f.documents.get("kiosks/FR8013").hardware, {vendor: "lita", checkoutExecution: "local", billingOwner: "local_station_v1", boardCount: 1, slotsPerBoard: 2});
  await assert.rejects(assignDevice({deviceId: DEVICE_ID, stationId: f.to,
    terminalEnabled: true, stripeMode: "test", forceReprovision: true}, {uid: "fixture-admin"}, f.dependencies), /Update the integrated kiosk app/);
  assert.equal([...f.documents.keys()].filter(path => path.startsWith("phoneDeviceCommands/")).length, 0);
});

test("brand assignment requires app capability and preserves existing billing ownership", async () => {
  const old = fixture({from: "FR8013", authority: "installation"});
  old.documents.get("kiosks/FR8013").stationBrand = "eventcharging";
  await assert.rejects(assignDevice({deviceId: DEVICE_ID, stationId: old.to,
    terminalEnabled: true, stripeMode: old.mode, forceReprovision: true}, {uid: "fixture-admin"}, old.dependencies), /Update/);
  assert.equal(old.selections.length, 0, 'an unsupported brand is rejected before Stripe provisioning');
  for (const brand of ['eventcharging', 'chargedrops']) {
    const f = fixture({from: "FR8013", authority: "installation"});
    f.documents.get("kiosks/FR8013").stationBrand = brand;
    f.documents.get(`phoneDevices/${DEVICE_ID}`).inventory.stripeTerminal.supportsStationBrand = true;
    await assignAndConfirm(f, "amazon_v2");
    const terminal = f.documents.get(`phoneDevices/${DEVICE_ID}`).terminal;
    assert.equal(terminal.stationBrand, brand);
    assert.equal(f.documents.get(`phoneDeviceCommands/${terminal.commandId}`).arguments.restrictions.station_brand, brand);
  }
});
