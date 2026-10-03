/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");
const {EventEmitter} = require("node:events");
const {CONFIG_PATH, OUTBOX_PATH, ExportError, prepareExport,
  createAmazonTransport, createAmazonExportService} = require("./amazonRentalExport");

const NOW = new Date("2026-10-02T09:00:10Z");
const CONFIG = {enabled: true, enabledAt: new Date("2026-10-02T09:00:00Z"), stationIds: ["FR8011"]};
const RENTAL = {
  gateway: "STRIPE", rentalStationid: "FR8011", rentalTime: "2026-10-02T09:00:01Z",
  paymentIntentId: "pi_export_test", interactionId: "interaction-test",
  status: "rented", vendState: "dispensed", vendConfirmationSource: "popup_sn",
  chargerid: 41667304, rentalModuleid: "864253060991866", rentalSlotid: 2, rentPower: 90,
};
const INTERACTION = {
  id: "interaction-test", paymentIntentId: "pi_export_test", stationId: "FR8011",
  stripeMode: "live", paymentResolution: "authorized", gatewayOption: "FULLPRICE",
  amountCents: 200, currency: "eur", kioskCurrency: "EUR", symbol: "€",
  pricingSnapshot: {kioskmode: "LEASE", initialperiod: 24, dailyprice: 2, buyprice: 2,
    authamount: 1, overdue: 1, taxrate: 0, valid: false, currency: "EUR",
    rate: [{time: 1440, price: 0}]},
};

function prepare(overrides = {}) {
  return prepareExport({rental: structuredClone(RENTAL), rentalId: "pi_export_test",
    interaction: structuredClone(INTERACTION), config: CONFIG, now: NOW, ...overrides});
}

test("confirmed vend maps original snapshot, hold, identity and original event time", () => {
  const row = prepare();
  assert.equal(row.rentalMessage.gatewayoptions, "FULLPRICE");
  assert.equal(row.rentalMessage.rawid, "pi_export_test");
  assert.equal(row.rentalMessage.slotnumber, 2);
  assert.equal(row.rentalMessage.pricing.initialperiod, 24);
  assert.equal(row.rentalMessage.pricing.valid, undefined);
  assert.equal(row.event.paymentstatus, "authorized");
  assert.equal(row.event.capturedAmountCents, 0);
  assert.equal(row.event.authorizedAmountCents, 200);
  assert.equal(row.event.rentalStartedAt, new Date(RENTAL.rentalTime).toISOString());
  assert.equal(row.event.occurredat, new Date(RENTAL.rentalTime).toISOString());
});

test("unconfirmed dispense and failed vend never create an Amazon rental", () => {
  for (const patch of [{status: "vend_pending"}, {vendState: "failed"},
    {vendConfirmationSource: "", vendAttempts: []}]) {
    assert.equal(prepare({rental: {...RENTAL, ...patch}}), null);
  }
});

test("other stations, test mode, historical rentals and disabled config are excluded", () => {
  assert.equal(prepare({rental: {...RENTAL, rentalStationid: "FR8012"}}), null);
  assert.equal(prepare({config: {...CONFIG, enabled: false}}), null);
  assert.equal(prepare({rental: {...RENTAL, rentalTime: "2026-10-02T08:59:00Z"}}), null);
  assert.throws(() => prepare({interaction: {...INTERACTION, stripeMode: "test"}}), /interaction-mismatch/);
});

test("missing frozen prices and amount mismatch block export instead of using current prices", () => {
  assert.throws(() => prepare({interaction: {...INTERACTION, pricingSnapshot: null}}), /missing-original-pricing/);
  assert.throws(() => prepare({interaction: {...INTERACTION, amountCents: 3000}}), /price-payment-mismatch/);
});

test("settlement publishes accurate audit amounts without inserting a second rental", () => {
  const row = prepare({rental: {...RENTAL, status: "returned", paymentStatus: "authorization_released",
    stripeReturnSettlement: {status: "completed", capturedCents: 0, finalChargeCents: 0,
      refundCents: 0, releasedCents: 200, settledAt: NOW}}});
  assert.equal(row.phase, "settlement");
  assert.equal(row.rentalMessage, null);
  assert.equal(row.event.paymentstatus, "authorization_released");
  assert.equal(row.event.releasedAmountCents, 200);
  assert.equal(row.event.finalChargeCents, 0);
});

test("captured initial payment is distinguished from a hold", () => {
  const row = prepare({interaction: {...INTERACTION, paymentResolution: "captured",
    gatewayOption: "INITIALPRICE", amountCents: 100}});
  assert.equal(row.event.capturedAmountCents, 100);
  assert.equal(row.rentalMessage.gatewayoptions, "INITIALPRICE");
});

function transportHarness(onPublish, timeoutMs = 50, onSubscribe = null) {
  const calls = [];
  let client;
  const transport = createAmazonTransport({credentials: {username: "test", password: "test"}, timeoutMs,
    connect(url, options) {
      assert.equal(url, "mqtt://chargerent.io:1884");
      assert.equal(options.reconnectPeriod, 0);
      client = new EventEmitter();
      client.end = () => calls.push("end");
      client.subscribe = (topic, opts, callback) => {
        calls.push("subscribe");
        if (onSubscribe) onSubscribe(callback);
        else callback(null, [{topic, qos: opts.qos}]);
      };
      client.publish = (topic, raw, opts, callback) => {
        calls.push("publish");
        assert.equal(opts.qos, 2);
        assert.equal(opts.retain, false);
        onPublish(client, topic, JSON.parse(raw), callback);
      };
      queueMicrotask(() => client.emit("connect"));
      return client;
    }});
  return {transport, calls};
}

test("subscribes before publishing and requires matching Amazon SQL ACK", async () => {
  const {transport, calls} = transportHarness((client, _topic, payload, callback) => {
    callback(null);
    client.emit("message", "kiosk/ack", JSON.stringify({stationid: "FR8011", transactionid: "other", status: "logged"}));
    client.emit("message", "kiosk/ack", JSON.stringify({stationid: "FR8011", transactionid: payload.rawid, status: "duplicate"}));
  });
  assert.deepEqual(await transport.publishRental(prepare().rentalMessage), {status: "duplicate"});
  assert.deepEqual(calls, ["subscribe", "publish", "end"]);
});

test("broker publish completion without Amazon ACK stays retryable", async () => {
  const {transport} = transportHarness((_client, _topic, _payload, callback) => callback(null), 5);
  await assert.rejects(transport.publishRental(prepare().rentalMessage),
      (e) => e.code === "amazon-ack-timeout" && e.retryable);
});

test("subscription refusal prevents publication", async () => {
  const {transport, calls} = transportHarness(() => assert.fail("must not publish"), 50,
      (callback) => callback(null, [{qos: 128}]));
  await assert.rejects(transport.publishRental(prepare().rentalMessage), /amazon-subscribe-failed/);
  assert.deepEqual(calls, ["subscribe", "end"]);
});

test("broker connectivity probe subscribes without sending business messages", async () => {
  const {transport, calls} = transportHarness(() => assert.fail("probe must not publish"));
  assert.deepEqual(await transport.checkConnection(), {status: "connected"});
  assert.deepEqual(calls, ["subscribe", "end"]);
});

function memoryDb(initial = {}) {
  const rows = new Map(Object.entries(initial));
  let lock = Promise.resolve();
  function doc(path) { return {path, async get() {return snapshot(path);},
    async set(data, options) {rows.set(path, options?.merge ? {...rows.get(path), ...data} : data);}}; }
  function snapshot(path) {return {exists: rows.has(path), data: () => rows.get(path)};}
  function collection(path, predicates = [], max = Infinity) {
    return {doc: (id) => doc(`${path}/${id}`),
      where: (key, op, val) => collection(path, [...predicates, (v) => op === "in" ? val.includes(v[key]) : v[key] === val], max),
      limit: (limit) => collection(path, predicates, limit),
      async get() {
        const docs = [...rows.entries()].filter(([p, v]) => p.startsWith(`${path}/`) &&
          !p.slice(path.length + 1).includes("/") && predicates.every((f) => f(v))).slice(0, max)
            .map(([p, v]) => ({id: p.split("/").pop(), data: () => v}));
        return {empty: docs.length === 0, docs};
      }};
  }
  const db = {rows, doc, collection, runTransaction(work) {
    const next = lock.then(() => work({get: async (ref) => snapshot(ref.path),
      create: (ref, row) => {assert.equal(rows.has(ref.path), false); rows.set(ref.path, row);},
      update: (ref, patch) => rows.set(ref.path, {...rows.get(ref.path), ...patch})}));
    lock = next.catch(() => {});
    return next;
  }};
  return db;
}

test("duplicate trigger and scheduler cannot concurrently publish the same rental", async () => {
  const row = prepare();
  const db = memoryDb({[CONFIG_PATH]: CONFIG, [`${OUTBOX_PATH}/${row.id}`]: row});
  let rentals = 0;
  let events = 0;
  const service = createAmazonExportService({db, now: () => NOW, getTransport: () => ({
    async publishRental() {rentals++; return {status: "logged"};},
    async publishEvent() {events++;},
  })});
  await Promise.all([service.deliver(row.id), service.deliver(row.id)]);
  assert.equal(rentals, 1);
  assert.equal(events, 1);
  assert.equal(db.rows.get(`${OUTBOX_PATH}/${row.id}`).status, "delivered");
});

test("event retry after rental ACK does not republish the rental, even after its time window", async () => {
  const row = prepare();
  const db = memoryDb({[CONFIG_PATH]: CONFIG, [`${OUTBOX_PATH}/${row.id}`]: row});
  let rentals = 0;
  let events = 0;
  let clock = NOW;
  const service = createAmazonExportService({db, now: () => clock, getTransport: () => ({
    async publishRental() {rentals++; return {status: "logged"};},
    async publishEvent() {if (++events === 1) throw new ExportError("amazon-publish-failed", true);},
  })});
  assert.equal((await service.deliver(row.id)).status, "pending");
  clock = new Date(NOW.getTime() + 180_000);
  await service.retryPending();
  assert.equal(rentals, 1);
  assert.equal(events, 2);
  assert.equal(db.rows.get(`${OUTBOX_PATH}/${row.id}`).status, "delivered");
});

test("stale initial imports are blocked rather than silently changing historical rental times", async () => {
  const row = prepare();
  const db = memoryDb({[CONFIG_PATH]: CONFIG, [`${OUTBOX_PATH}/${row.id}`]: row});
  const service = createAmazonExportService({db, now: () => new Date(NOW.getTime() + 180_000),
    getTransport: () => assert.fail("stale rental must not publish")});
  await service.deliver(row.id);
  assert.equal(db.rows.get(`${OUTBOX_PATH}/${row.id}`).status, "blocked");
  assert.equal(db.rows.get(`${OUTBOX_PATH}/${row.id}`).lastErrorCode, "legacy-timestamp-window");
});

test("enqueue is idempotent and freezes pricing before later rental changes", async () => {
  const db = memoryDb({[CONFIG_PATH]: CONFIG,
    "kioskTerminalInteractions/interaction-test": INTERACTION});
  const service = createAmazonExportService({db, now: () => NOW, getTransport: () => null});
  const id = await service.enqueue(RENTAL, "pi_export_test");
  const original = db.rows.get(`${OUTBOX_PATH}/${id}`);
  await service.enqueue({...RENTAL, rentPower: 99}, "pi_export_test");
  assert.equal(db.rows.get(`${OUTBOX_PATH}/${id}`), original);
  assert.equal(original.rentalMessage.batterylevel, 90);
});

test("incomplete new snapshot creates a visible blocked export rather than a malformed rental", async () => {
  const db = memoryDb({[CONFIG_PATH]: CONFIG,
    "kioskTerminalInteractions/interaction-test": {...INTERACTION, pricingSnapshot: null}});
  const service = createAmazonExportService({db, now: () => NOW, getTransport: () => null});
  const id = await service.enqueue(RENTAL, "pi_export_test");
  assert.equal(db.rows.get(`${OUTBOX_PATH}/${id}`).status, "blocked");
  assert.equal(db.rows.get(`${OUTBOX_PATH}/${id}`).lastErrorCode, "missing-original-pricing");
});

test("disabled bridge can verify deployed broker access without importing records", async () => {
  const db = memoryDb({[CONFIG_PATH]: {...CONFIG, enabled: false, connectionCheckRequested: true}});
  const service = createAmazonExportService({db, now: () => NOW, getTransport: () => ({
    async checkConnection() {return {status: "connected"};},
    async publishRental() {assert.fail("disabled bridge cannot publish");},
  })});
  assert.deepEqual(await service.retryPending(), []);
  assert.equal(db.rows.get(CONFIG_PATH).lastBrokerCheck.status, "connected");
  assert.equal(db.rows.get(CONFIG_PATH).connectionCheckRequested, false);
});
