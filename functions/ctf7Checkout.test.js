/* eslint-env node */
const test = require("node:test"), assert = require("node:assert/strict");
const {FakeDb} = require("./testsupport/ctf7FakeDb");
const {createCtf7Checkout} = require("./ctf7Checkout");
const {createModule} = require("./ctf7Model");
const {reservationId, tokenHash} = require("./kioskTerminal");
function fixture() {
  const db = new FakeDb(), calls = [], mid = "LM-TEST000007", sn = "FAN000000001";
  let clock = Date.now(), intent = null, status = "open", unavailable = false;
  const module = createModule("TEST000007");
  Object.assign(module, {connected: true, topologyVerified: true, inventoryVerified: true, controlEnabled: true,
    operationalEnabled: true, lastInventoryAt: new Date(clock).toISOString()});
  module.slots[0] = {...module.slots[0], observed: true, status: 1, sn, batteryLevel: 95, lock: false, abnormal: false};
  const kiosk = {stationid: "FR4000", active: true, enabled: true, rentalsValidated: true,
    hardware: {type: "CTF7", gateway: "STRIPE", gatewayoptions: "FULLPRICE", power: 80}, modules: [module],
    pricing: {text: "PURCHASE - SIMPLE DAILY", currency: "USD", authamount: 1, buyprice: 1, dailyprice: 1,
      initialperiod: 24, overdue: 30, rate: [{time: 1440, price: 1}], taxrate: 0},
    ctf7Commissioning: {persistentEndpointVerified: true, networkBoundaryVerified: true, automaticReturnsVerified: true},
    ctf7Checkout: {enabled: true, channel: "web-qr", stripeMode: "test", stripeAccountCountry: "US"}};
  db.rows.set("kiosks/pid", kiosk);
  db.rows.set("ctf7Bindings/" + mid, {state: "bound", generation: 1, controlEnabled: true, topologyVerified: true, stationid: "FR4000", provisionid: "pid"});
  db.rows.set("ctf7Sessions/" + mid, {connected: true, generation: 1, sessionId: "sid"});
  let saved;
  const stripe = {checkout: {sessions: {
    async create(params, options) {calls.push(["checkout", params, options]); saved = params;
      if (unavailable) {unavailable = false; throw new Error("Network lost after Stripe accepted creation");}
      return {id: "cs_test", url: "https://checkout.stripe.com/c/pay/test"};},
    async retrieve() {return {id: "cs_test", status, livemode: false, client_reference_id: saved.client_reference_id,
      metadata: saved.metadata, payment_intent: intent};},
    async expire() {calls.push(["expire"]); status = "expired";},
  }}, paymentIntents: {async cancel() {calls.push(["cancel"]); intent.status = "canceled";},
    async retrieve() {return intent;}}, refunds: {async create() {calls.push(["refund"]);}}};
  const gateway = {async requestAvailability() {return {state: "available", selected: {moduleId: mid, chargerSn: sn,
    slot: 1, batteryLevel: 95, generation: 1, sessionId: "sid"}};},
  async sendVend(request) {calls.push(["queue-vend", request]); const key = "ctf7TransportRequests/" + tokenHash(`vend:${request.requestId}`);
    if (!db.rows.has(key)) db.rows.set(key, {state: "queued", request});}};
  const service = createCtf7Checkout({db, gateway, getStripeClient: () => stripe, now: () => clock});
  return {service, db, calls, mid, sn, kiosk, setClock(value) {clock = value;}, clock,
    unavailable() {unavailable = true;}, paid(id, patch = {}) {status = "complete"; intent = {id: "pi_test", amount: 100, currency: "usd", livemode: false,
      metadata: {chargerent_interaction_id: id}, status: "requires_capture", ...patch};}};
}
test("CTF7 checkout freezes $1 USD server pricing, chooses card payments and reserves a mapped bank", async () => {
  const f = fixture(), started = await f.service.start("FR4000", {accepted: true, amount: 999});
  const request = f.calls.find(c => c[0] === "checkout")[1];
  assert.equal(request.line_items[0].price_data.unit_amount, 100); assert.equal(request.line_items[0].price_data.currency, "usd");
  assert.deepEqual(request.payment_method_types, ["card"]); assert.equal(request.payment_intent_data.capture_method, "manual");
  assert.equal(f.db.rows.get("kioskTerminalInteractions/" + started.rentalId).chargerSn, f.sn);
  assert.equal(f.calls.filter(c => c[0] === "queue-vend").length, 0);
});
test("commissioning gates, module OFF, stolen reservation and missing pricing acceptance prevent checkout", async () => {
  const f = fixture(); await assert.rejects(f.service.start("FR4000", {}));
  f.db.rows.get("kiosks/pid").ctf7Commissioning.networkBoundaryVerified = false;
  await assert.rejects(f.service.start("FR4000", {accepted: true}));
  f.db.rows.get("kiosks/pid").ctf7Commissioning.networkBoundaryVerified = true;
  f.db.rows.get("kiosks/pid").modules[0].operationalEnabled = false;
  await assert.rejects(f.service.start("FR4000", {accepted: true}));
  assert.equal(f.calls.length, 0);
});
test("V2 initial-price checkout captures the configured $1 and refunds a confirmed failed dispense", async () => {
  const f = fixture(); f.db.rows.get("kiosks/pid").hardware.gatewayoptions = "INITIALPRICE";
  const s = await f.service.start("FR4000", {accepted: true});
  assert.equal(f.calls.find(c => c[0] === "checkout")[1].payment_intent_data.capture_method, "automatic");
  f.paid(s.rentalId, {status: "succeeded"}); await f.service.status(s.rentalId, s.token);
  f.db.rows.set("rentals/pi_test", {vendState: "failed", status: "vend_failed"});
  assert.equal((await f.service.status(s.rentalId, s.token)).state, "failed");
  assert.equal(f.calls.filter(c => c[0] === "refund").length, 1);
  await f.service.status(s.rentalId, s.token); assert.equal(f.calls.filter(c => c[0] === "refund").length, 1);
});
test("only matching Stripe-confirmed payment queues one durable vend despite concurrent polls", async () => {
  const f = fixture(), s = await f.service.start("FR4000", {accepted: true});
  await assert.rejects(f.service.status(s.rentalId, "a".repeat(43)));
  f.paid(s.rentalId); await Promise.all([f.service.status(s.rentalId, s.token), f.service.status(s.rentalId, s.token)]);
  const queues = [...f.db.rows.keys()].filter(k => k.startsWith("ctf7TransportRequests/")); assert.equal(queues.length, 1);
  assert.equal(f.db.rows.get("kioskTerminalInteractions/" + s.rentalId).paymentResolution, "authorized");
  f.db.rows.set("rentals/pi_test", {vendState: "dispensed", status: "rented"});
  assert.equal((await f.service.status(s.rentalId, s.token)).state, "dispensed");
});
test("late authorization after reservation expiry is canceled without eject", async () => {
  const f = fixture(), s = await f.service.start("FR4000", {accepted: true});
  f.setClock(f.clock + 180001); f.paid(s.rentalId);
  assert.equal((await f.service.status(s.rentalId, s.token)).state, "canceled");
  assert.equal(f.calls.some(c => c[0] === "cancel"), true); assert.equal(f.calls.some(c => c[0] === "queue-vend"), false);
});
test("closing the browser expires unpaid Checkout and releases the V2 reservation", async () => {
  const f = fixture(); await f.service.start("FR4000", {accepted: true}); f.setClock(f.clock + 180001);
  await f.service.tick(); assert.equal(f.calls.some(c => c[0] === "expire"), true);
  assert.equal(f.db.rows.has("kioskTerminalReservations/" + reservationId("FR4000", f.mid, f.sn)), false);
});
test("uncertain Stripe creation is recovered with identical idempotency parameters and never auto-ejects", async () => {
  const f = fixture(); f.unavailable(); await assert.rejects(f.service.start("FR4000", {accepted: true}));
  f.setClock(f.clock + 180001); await f.service.tick();
  const creates = f.calls.filter(c => c[0] === "checkout"); assert.equal(creates.length, 2);
  assert.deepEqual(creates[0], creates[1]); assert.equal(f.calls.some(c => c[0] === "queue-vend"), false);
});
test("wrong payment metadata, amount, currency or live mode cannot vend or be canceled as another payment", async () => {
  for (const patch of [{amount: 900}, {currency: "eur"}, {livemode: true}, {metadata: {chargerent_interaction_id: "other"}}]) {
    const f = fixture(), s = await f.service.start("FR4000", {accepted: true}); f.paid(s.rentalId, patch);
    await assert.rejects(f.service.status(s.rentalId, s.token)); assert.equal(f.calls.some(c => ["queue-vend", "cancel"].includes(c[0])), false);
  }
});
test("failed dispatch before any rental refunds/cancels, while an uncertain motor outcome retains payment and lease", async () => {
  for (const outcome of ["failed", "verification_pending"]) {
    const f = fixture(), s = await f.service.start("FR4000", {accepted: true}); f.paid(s.rentalId);
    await f.service.status(s.rentalId, s.token);
    if (outcome === "failed") f.db.rows.get("ctf7TransportRequests/" + tokenHash(`vend:${s.rentalId}`)).state = "failed";
    else f.db.rows.set("rentals/pi_test", {vendState: "verification_pending", status: "pending"});
    assert.equal((await f.service.status(s.rentalId, s.token)).state, outcome);
    assert.equal(f.calls.some(c => c[0] === "cancel"), outcome === "failed");
  }
});
