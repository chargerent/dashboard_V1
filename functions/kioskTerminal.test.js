/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createFirestoreKioskTerminalStore,
  createKioskTerminalHandler,
  createKioskTerminalService,
  KioskTerminalError,
  besiterRentalOutcome,
  resolveKioskOffer,
  tokenHash,
  validateInstallation,
} = require("./kioskTerminal");
const {createReceiptService} = require("./rentalReceipt");
const {V2AmazonGatewayError, createV2AmazonGateway} = require("./v2AmazonGateway");

test("Event Simple shows the free day while preserving the card hold and elapsed-time billing", () => {
  const {returnCharge} = require("./ctf7Rental");
  const pricing = {text: "EVENT - SIMPLE", currency: "US", symbol: "$", kioskmode: "LEASE",
    initialperiod: 24, authamount: 1, dailyprice: 1, buyprice: 1, overdue: 30, taxrate: 0,
    rate: [{time: 1440, price: 0}, {time: 2880, price: 1}]};
  const offer = resolveKioskOffer({stationId: "US6000", stripeMode: "test", stripeAccountCountry: "US"},
      {hardware: {gatewayoptions: "FULLPRICE"}, pricing});
  assert.deepEqual(offer.pricingLines, [
    "Free if returned by end of day (first 24 hours)",
    "$1.00 for each additional 24-hour period",
    "$1.00 if not returned after 30 days",
  ]);
  assert.equal(offer.paymentAmountCents, 100);
  assert.equal(offer.gatewayOption, "FULLPRICE");
  assert.match(offer.paymentTerms[0], /\$1\.00 temporary card authorization/);
  assert.deepEqual(offer.pricingSnapshot.rate, pricing.rate);
  assert.equal(returnCharge(offer.pricingSnapshot, 24 * 3600000).totalCharged, 0);
  assert.equal(returnCharge(offer.pricingSnapshot, 24 * 3600000 + 60000).totalCharged, 1);
});

function reservationStoreForDevice(deviceData) {
  const writes = [];
  const snapshot = (ref) => {
    if (ref.name === "phoneDevices" && deviceData !== null) {
      return {exists: true, data: () => deviceData};
    }
    if (ref.name === "kioskInstallations" && ref.id === INSTALLATION.id) {
      return {exists: true, data: () => ({...INSTALLATION, deviceId: "device-1"})};
    }
    return {exists: false, data: () => undefined};
  };
  const db = {
    doc(path) {
      const [name, id] = path.split("/");
      return this.collection(name).doc(id);
    },
    collection(name) {
      return {doc(id) {
        const ref = {name, id};
        ref.get = async () => snapshot(ref);
        return ref;
      }};
    },
    async runTransaction(action) {
      return action({
        async get(ref) { return snapshot(ref); },
        set(ref, value) { writes.push({kind: "set", ref, value}); },
        create(ref, value) { writes.push({kind: "create", ref, value}); },
      });
    },
  };
  return {store: createFirestoreKioskTerminalStore(db), writes};
}

async function reserveForAssignmentTest(store) {
  return store.reserveInteraction({
    id: "interaction-assignment-test",
    installationId: "installation-assignment-test",
    stationId: "FR8012",
  }, {
    moduleId: "module-1", chargerSn: "charger-1", slot: 1, batteryLevel: 90,
  }, new Date("2026-10-08T10:05:00Z"), new Date("2026-10-08T10:00:00Z"), "device-1");
}

const INSTALL_TOKEN = "test-installation-token-with-at-least-32-characters";
const INSTALLATION = {
  id: tokenHash(INSTALL_TOKEN),
  active: true,
  stationId: "CA8019",
  provisionId: "id-9987807816",
  moduleId: "100049231111490591",
  stripeMode: "test",
  stripeAccountCountry: "US",
  stripeLocationId: "tml_test_location",
  amountCents: 777,
  currency: "usd",
  slotNumbers: [1, 2, 3],
};

const KIOSK = {
  stationid: "CA8019",
  hardware: {gateway: "STRIPE", gatewayoptions: "FULLPRICE", power: 80},
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
    id: "100049231111490591",
    slots: [{position: 1}, {position: 2}, {position: 3}],
  }],
};

function request({
  method = "POST",
  path = "/",
  body = {},
  token = INSTALL_TOKEN,
  stationId = "CA8019",
} = {}) {
  return {
    method,
    path,
    body,
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "x-chargerent-station": stationId,
    },
  };
}

function createFakeStore(kiosk = KIOSK, installation = INSTALLATION, v2Config = null) {
  const interactions = new Map();
  const returnSessions = new Map();
  const rentals = new Map();
  let returnedRental = null;
  const stationLocks = new Map();
  return {
    interactions,
    returnSessions,
    rentals,
    stationLocks,
    async getV2CheckoutConfig() { return v2Config; },
    async claimStationAvailability(stationId, requestId) {
      if (stationLocks.has(stationId)) throw new KioskTerminalError(
          409, "station-operation-pending", "This station is verifying its current charger operation.");
      stationLocks.set(stationId, requestId);
    },
    async claimV2VendDispatch(interaction) {
      const current = interactions.get(interaction.id);
      if (current.vendDispatchState || current.outcome !== "pending") return {claimed: false, interaction: current};
      if (stationLocks.has(interaction.stationId)) throw new Error("station-operation-pending");
      interactions.set(interaction.id, {...current, vendDispatchState: "claimed"});
      stationLocks.set(interaction.stationId, interaction.id);
      return {claimed: true};
    },
    async releaseStationOperation(stationId, operationId) {
      if (stationLocks.get(stationId) === operationId) stationLocks.delete(stationId);
    },
    async finishV2VendDispatch(interactionId, patch) {
      if (interactions.get(interactionId).outcome === "pending") {
        interactions.set(interactionId, {...interactions.get(interactionId), ...patch});
      }
    },
    setReturnedRental(value) {
      returnedRental = value;
    },
    kioskVerified: 0,
    confirmations: [],
    released: [],
    extended: [],
    async getInstallation(id) {
      return id === installation.id ? {...installation} : null;
    },
    async confirmInstallation(installation, report) {
      this.confirmations.push({installation, report});
    },
    async verifyKiosk() {
      this.kioskVerified += 1;
      return structuredClone(kiosk);
    },
    async reserveInteraction(interaction, candidate, expiresAt) {
      const saved = {
        ...interaction,
        moduleId: candidate.moduleId,
        chargerSn: candidate.chargerSn,
        reservedSlot: candidate.slot,
        batteryLevel: candidate.batteryLevel,
        reservationExpiresAt: expiresAt,
      };
      interactions.set(saved.id, saved);
      return saved;
    },
    async getInteraction(id) {
      return interactions.get(id) || null;
    },
    async getInteractionByPaymentIntentId(paymentIntentId) {
      return [...interactions.values()].find((interaction) => (
        interaction.paymentIntentId === paymentIntentId
      )) || null;
    },
    async updateInteraction(id, patch) {
      interactions.set(id, {...interactions.get(id), ...patch});
    },
    async extendReservation(interaction, expiresAt) {
      this.extended.push(interaction.id);
      interactions.set(interaction.id, {
        ...interactions.get(interaction.id),
        reservationExpiresAt: expiresAt,
      });
    },
    async releaseReservation(interaction) {
      this.released.push(interaction.id);
    },
    async createReturnSession(session) {
      returnSessions.set(session.id, session);
    },
    async getReturnSession(id) {
      return returnSessions.get(id) || null;
    },
    async updateReturnSession(id, patch) {
      returnSessions.set(id, {...returnSessions.get(id), ...patch});
    },
    async findReturnSince() {
      return returnedRental;
    },
    async getBesiterRental(id) {
      return rentals.get(id) || null;
    },
    async updateBesiterRental(id, patch) {
      rentals.set(id, {...rentals.get(id), ...patch});
    },
  };
}

function createFakeBesiter(stationId = "CA8019") {
  const calls = {availability: [], vends: []};
  return {
    calls,
    async requestAvailability(request_) {
      calls.availability.push(request_);
      return {
        action: "status",
        stationid: stationId,
        requestId: request_.requestId,
        status: [41807101, 41807102],
        moduleid: "100049231111490591",
        vendbattery: {sn: 41807101, slot: 2, powerlevel: 96},
        timeresponded: Date.parse("2026-08-15T10:00:00.000Z"),
      };
    },
    async sendVend(request_) {
      calls.vends.push(request_);
    },
  };
}

function createFakeStripe() {
  const intents = new Map();
  const calls = {
    connectionTokens: 0,
    creates: [],
    captures: [],
    captureRequests: [],
    cancels: [],
    refunds: [],
  };
  return {
    calls,
    intents,
    accounts: {retrieve: async () => ({id: "acct_existingBillingFixture", country: "FR"})},
    paymentMethods: {retrieve: async (id) => ({id, type: "card_present"})},
    terminal: {
      connectionTokens: {
        async create() {
          calls.connectionTokens += 1;
          return {secret: "pst_test_connection_secret"};
        },
      },
    },
    paymentIntents: {
      async create(params, options) {
        calls.creates.push({params, options});
        const intent = {
          id: "pi_test_8019",
          client_secret: "pi_test_8019_secret_client",
          status: "requires_payment_method",
          amount: params.amount,
          currency: params.currency,
          capture_method: params.capture_method,
          livemode: true,
          metadata: params.metadata,
        };
        intents.set(intent.id, intent);
        return intent;
      },
      async retrieve(id) {
        return intents.get(id);
      },
      async cancel(id) {
        calls.cancels.push(id);
        const intent = intents.get(id);
        intent.status = "canceled";
        return intent;
      },
      async capture(id, params = {}, options = {}) {
        calls.captures.push(id);
        calls.captureRequests.push({id, params, options});
        intents.get(id).status = "succeeded";
        intents.get(id).amount_received = params.amount_to_capture ?? intents.get(id).amount;
      },
    },
    refunds: {
      async create(params, options) {
        calls.refunds.push({params, options});
        return {id: "re_test_8019"};
      },
    },
  };
}

function createFixture({kiosk = KIOSK, receiptService = null, ctf7Gateway = null,
  installation = INSTALLATION, v2Config = null, v2AmazonGateway = null} = {}) {
  const store = createFakeStore(kiosk, installation, v2Config);
  const stripe = createFakeStripe();
  const besiter = createFakeBesiter(installation.stationId);
  const stripeSelections = [];
  let idCounter = 0;
  const service = createKioskTerminalService({
    store,
    getStripeClient: (selection) => {
      stripeSelections.push(selection);
      return stripe;
    },
    besiterGateway: besiter,
    ctf7Gateway,
    receiptService,
    v2AmazonGateway,
    now: () => new Date("2026-08-15T10:00:00.000Z"),
    randomUUID: () => `test-id-${++idCounter}`,
  });
  return {service, store, stripe, besiter, stripeSelections};
}

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function createAmazonV2Fixture(sendVend, {receiptService = null} = {}) {
  const installation = {...INSTALLATION, stationId: "FR8012", stripeMode: "live",
    stripeAccountCountry: "FR", stripeReaderType: "bbpos_wisepad3", packageName: "com.chargerent.media.lab"};
  const kiosk = {...KIOSK, stationid: "FR8012", pricing: {...KIOSK.pricing,
    profile: "DEFAULT", currency: "FR", kioskmode: "LEASE", authamount: 30, buyprice: 30,
    dailyprice: 0, overdue: 1, rate: [{time: 1440, price: 0}]}};
  const fixture = createFixture({installation, kiosk, receiptService,
    v2Config: {enabled: true, stationIds: ["FR8012"], stripeMode: "live",
      stripeAccountId: "acct_existingBillingFixture", paymentProfile: "VERIFIED_FR_LIVE", paymentProfileVerified: true},
    v2AmazonGateway: {sendVend}});
  const req = request({stationId: "FR8012", body: {intent: "rent", provisionId: installation.provisionId}});
  const result = await fixture.service.createInteraction(req);
  const id = result.body.interactionId;
  await fixture.service.createPaymentIntent(request({stationId: "FR8012"}), id);
  const pi = fixture.stripe.intents.get("pi_test_8019");
  pi.status = "requires_capture";
  pi.payment_method = "pm_card_present_fixture";
  const processedRequest = request({stationId: "FR8012", body: {paymentIntentId: pi.id}});
  return {...fixture, id, processedRequest};
}

test("original reader and online card metadata survives one V2 vend and rental completion", async () => {
  for (const type of ["card_present", "card"]) {
    const vends = [];
    const {service, store, stripe, id, processedRequest} = await createAmazonV2Fixture(
        async (payload) => vends.push(payload),
    );
    const retrieved = [];
    stripe.paymentMethods.retrieve = async (paymentMethodId) => {
      retrieved.push(paymentMethodId);
      return {id: paymentMethodId, type, [type]: {last4: "0626", brand: "mastercard"}};
    };
    await service.paymentProcessed(processedRequest, id);
    await service.paymentProcessed(processedRequest, id);
    assert.deepEqual(retrieved, ["pm_card_present_fixture"]);
    assert.equal(vends.length, 1);
    assert.equal(vends[0].transactionid, "pi_test_8019");
    assert.equal(vends[0].paymentMethodId, "pm_card_present_fixture");
    assert.equal(vends[0].card_last4, "0626");
    assert.equal(vends[0].card_type, "mastercard");
    assert.equal(store.interactions.get(id).card_last4, "0626");
    const rental = {paymentIntentId: "pi_test_8019", rentalStationid: "FR8012",
      status: "rented", vendState: "dispensed", vendConfirmationSource: "popup_sn",
      rentalSlotid: 2, rentalModuleid: INSTALLATION.moduleId, chargerid: 41807101};
    store.rentals.set("pi_test_8019", rental);
    assert.equal((await service.getInteraction(request({stationId: "FR8012"}), id)).body.outcome,
        "vend_succeeded");
    assert.equal(store.rentals.get("pi_test_8019").card_type, "mastercard");
    assert.equal(store.rentals.get("pi_test_8019").card_last4, "0626");
    // A completed read can restore display metadata without revisiting payments or dispensing again.
    store.rentals.set("pi_test_8019", {...rental, status: "returned"});
    stripe.paymentIntents.retrieve = async () => { throw new Error("Unexpected payment lookup"); };
    await service.getInteraction(request({stationId: "FR8012"}), id);
    assert.equal(store.rentals.get("pi_test_8019").status, "returned");
    assert.equal(store.rentals.get("pi_test_8019").card_last4, "0626");
    assert.equal(vends.length, 1);
    assert.equal(stripe.calls.captures.length + stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
  }
});

test("V2 pending and failed rental records retain card metadata without changing billing", async () => {
  for (const status of ["vend_requested", "vend_failed"]) {
    const {service, store, stripe, id, processedRequest} = await createAmazonV2Fixture(async () => {});
    stripe.paymentMethods.retrieve = async (paymentMethodId) => ({id: paymentMethodId,
      type: "card_present", card_present: {last4: "6263", brand: "mastercard"}});
    await service.paymentProcessed(processedRequest, id);
    const rental = {paymentIntentId: "pi_test_8019", rentalStationid: "FR8012", status};
    store.rentals.set("pi_test_8019", rental);
    const result = await service.getInteraction(request({stationId: "FR8012"}), id);
    assert.equal(result.body.outcome, status === "vend_failed" ? "vend_failed" : "pending");
    assert.deepEqual(store.rentals.get("pi_test_8019"),
        {...rental, card_last4: "6263", card_type: "mastercard"});
    assert.equal(stripe.calls.captures.length + stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
  }
});

test("V2 metadata never creates a rental or modifies another station or payment", async () => {
  const {service, store, stripe, id, processedRequest} = await createAmazonV2Fixture(async () => {});
  stripe.paymentMethods.retrieve = async (paymentMethodId) => ({id: paymentMethodId,
    type: "card_present", card_present: {last4: "6263", brand: "mastercard"}});
  await service.paymentProcessed(processedRequest, id);
  await service.getInteraction(request({stationId: "FR8012"}), id);
  assert.equal(store.rentals.size, 0);
  for (const mismatch of [{rentalStationid: "FR8011"}, {paymentIntentId: "pi_another"}]) {
    const rental = {paymentIntentId: "pi_test_8019", rentalStationid: "FR8012",
      status: "vend_requested", ...mismatch};
    store.rentals.set("pi_test_8019", rental);
    await service.getInteraction(request({stationId: "FR8012"}), id);
    assert.deepEqual(store.rentals.get("pi_test_8019"), rental);
  }
});

test("missing or malformed Stripe card details never persist full card data", async () => {
  for (const details of [undefined, {last4: 6263, brand: 123},
    {last4: "1234567890123456", brand: "<invalid>"}]) {
    const vends = [];
    const {service, store, stripe, id, processedRequest} = await createAmazonV2Fixture(
        async (payload) => vends.push(payload),
    );
    stripe.paymentMethods.retrieve = async (paymentMethodId) => ({id: paymentMethodId,
      type: "card_present", card_present: details});
    await service.paymentProcessed(processedRequest, id);
    assert.equal(vends.length, 1);
    assert.equal(vends[0].card_last4, undefined);
    assert.equal(vends[0].card_type, undefined);
    assert.equal(store.interactions.get(id).card_last4, undefined);
    assert.equal(store.interactions.get(id).card_type, undefined);
  }
});

test("rental metadata store updates only an existing document", async () => {
  let updates = 0;
  const store = createFirestoreKioskTerminalStore({collection(name) {
    assert.equal(name, "rentals");
    return {doc(id) {
      assert.equal(id, "pi_existing");
      return {async update(patch) {
        assert.deepEqual(patch, {card_last4: "6263"});
        updates += 1;
        throw new Error("NOT_FOUND");
      }, set() { throw new Error("A rental must not be created"); }};
    }};
  }});
  await assert.rejects(store.updateBesiterRental("pi_existing", {card_last4: "6263"}), /NOT_FOUND/);
  assert.equal(updates, 1);
});

test("duplicate processed-payment requests dispatch one normal V2 vend and await physical proof", async () => {
  let start;
  let finish;
  const started = new Promise((resolve) => { start = resolve; });
  const held = new Promise((resolve) => { finish = resolve; });
  const vends = [];
  const fixture = await createAmazonV2Fixture(async (payload) => {
    vends.push(payload); start(); await held;
  });
  const {service, store, stripe, besiter, id, processedRequest} = fixture;
  const first = service.paymentProcessed(processedRequest, id);
  await started;
  const duplicate = await service.paymentProcessed(processedRequest, id);
  assert.equal(duplicate.status, 202);
  assert.equal(vends.length, 1);
  finish(); await first;
  assert.equal(besiter.calls.vends.length, 0);
  assert.equal(vends[0].paymentMethodId, "pm_card_present_fixture");
  assert.deepEqual(vends[0].pricing.rate, [{time: 1440, price: 0}]);
  assert.equal(store.interactions.get(id).stripeAccountId, "acct_existingBillingFixture");
  assert.equal((await service.getInteraction(request({stationId: "FR8012"}), id)).body.outcome, "pending");
  store.rentals.set("pi_test_8019", {status: "rented", vendState: "dispensed",
    vendConfirmationSource: "popup_sn", rentalSlotid: 2, rentalModuleid: INSTALLATION.moduleId,
    chargerid: 41807101});
  const completed = await service.getInteraction(request({stationId: "FR8012"}), id);
  assert.equal(completed.body.outcome, "vend_succeeded");
  assert.equal(store.rentals.get("pi_test_8019").stripeAccountId, "acct_existingBillingFixture");
  assert.equal(store.rentals.get("pi_test_8019").billingOwner, "amazon_v2");
  assert.equal(store.stationLocks.size, 0);
  assert.equal(stripe.calls.captures.length + stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
});

test("config-first recovery reads an active vend without releasing its lock or dispatching again", async () => {
  let vends = 0;
  const {service, store, stripe, besiter, id, processedRequest} = await createAmazonV2Fixture(
      async () => { vends += 1; },
  );
  await service.paymentProcessed(processedRequest, id);
  const availabilityRequests = besiter.calls.availability.length;
  const handler = createKioskTerminalHandler(service);
  const config = responseRecorder();
  await handler(request({method: "GET", path: "/v1/config", stationId: "FR8012"}), config);
  assert.equal(config.statusCode, 200);
  assert.equal(config.payload.pricing.paymentAmountCents, 3000);
  assert.equal(config.payload.availability.state, "busy");
  assert.equal(config.payload.availability.availableCount, 0);
  assert.equal(config.payload.availability.selected, null);
  assert.equal(store.stationLocks.get("FR8012"), id);
  assert.equal(besiter.calls.availability.length, availabilityRequests);
  assert.equal((await service.getInteraction(request({stationId: "FR8012"}), id)).body.outcome, "pending");
  store.rentals.set("pi_test_8019", {status: "rented", vendState: "dispensed",
    vendConfirmationSource: "popup_sn", rentalSlotid: 2, rentalModuleid: INSTALLATION.moduleId,
    chargerid: 41807101});
  const status = responseRecorder();
  await handler(request({method: "GET", path: `/v1/interactions/${id}`, stationId: "FR8012"}), status);
  assert.equal(status.statusCode, 200);
  assert.equal(status.payload.outcome, "vend_succeeded");
  assert.equal(status.payload.state, "complete");
  assert.equal(store.stationLocks.size, 0);
  assert.equal((await service.getConfig(request({stationId: "FR8012"}))).body.availability.state, "available");
  await service.paymentProcessed(processedRequest, id);
  assert.equal(vends, 1);
  assert.equal(besiter.calls.vends.length, 0);
  assert.equal(stripe.calls.captures.length + stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
});

test("config propagates availability errors other than a pending station operation", async () => {
  const {service, store} = await createAmazonV2Fixture(async () => {});
  store.claimStationAvailability = async () => {
    throw new KioskTerminalError(503, "kiosk-offline", "The station is offline.");
  };
  await assert.rejects(service.getConfig(request({stationId: "FR8012"})),
      (error) => error.code === "kiosk-offline" && error.status === 503);
});

test("an Amazon return before first kiosk poll completes retained physical vend proof without financial writes", async () => {
  let vends = 0;
  const receiptService = createReceiptService({store: {async getRental() { return null; }},
    signingKey: "local-test-receipt-key-with-32-bytes", publicBaseUrl: "https://chargerentstations.com/media-kiosk"});
  const {service, store, stripe, id, processedRequest} = await createAmazonV2Fixture(
      async () => { vends += 1; }, {receiptService},
  );
  await service.paymentProcessed(processedRequest, id);
  const intent = stripe.intents.get("pi_test_8019");
  intent.status = "canceled";
  intent.amount_received = 0;
  const returned = {id: intent.id, paymentIntentId: intent.id, rentalStationid: "FR8012",
    status: "returned", vendState: "dispensed", vendConfirmationSource: "popup_sn",
    rentalSlotid: 2, rentalModuleid: INSTALLATION.moduleId, chargerid: 41807101,
    rentalTime: "2026-08-15T10:00:00Z", returnTime: "2026-08-15T10:00:01Z"};
  // The unchanged legacy exporter sees closed records as pending, not a new vend.
  assert.equal(besiterRentalOutcome(returned).outcome, "pending");
  store.rentals.set(intent.id, {...returned, vendConfirmationSource: ""});
  assert.equal((await service.getInteraction(request({stationId: "FR8012"}), id)).body.outcome, "pending");
  store.rentals.set(intent.id, {...returned, rentalStationid: "FR8013"});
  assert.equal((await service.getInteraction(request({stationId: "FR8012"}), id)).body.outcome, "pending");
  assert.equal(store.stationLocks.size, 1);
  store.rentals.set(intent.id, returned);
  const completed = (await service.getInteraction(request({stationId: "FR8012"}), id)).body;
  assert.equal(completed.outcome, "vend_succeeded");
  assert.equal(completed.state, "complete");
  assert.equal(completed.paymentResolution, "canceled");
  assert.equal(completed.transactionId, intent.id);
  assert.match(completed.receiptUrl, /\/receipt\/pi_test_8019\?key=/);
  assert.equal(store.stationLocks.size, 0);
  assert.equal(store.released.length, 1);
  assert.equal(store.rentals.get(intent.id).status, "returned");
  assert.equal(stripe.calls.captures.length + stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
  await service.paymentProcessed(processedRequest, id);
  assert.equal(vends, 1);
});

test("an uncertain normal V2 vend holds the station and never retries or cancels the authorization", async () => {
  let vends = 0;
  const {service, store, stripe, besiter, id, processedRequest} = await createAmazonV2Fixture(async () => {
    vends += 1;
    throw new V2AmazonGatewayError("v2-http-result-unknown", "vend");
  });
  assert.equal((await service.paymentProcessed(processedRequest, id)).body.state, "vend_verification_pending");
  store.interactions.set(id, {...store.interactions.get(id), vendRequestedAt: new Date("2020-01-01")});
  await service.paymentProcessed(processedRequest, id);
  assert.equal((await service.getInteraction(request({stationId: "FR8012"}), id)).body.outcome, "pending");
  assert.equal((await service.cancelInteraction(request({stationId: "FR8012"}), id)).body.canceled, false);
  const availabilityRequests = besiter.calls.availability.length;
  const busy = await service.getConfig(request({stationId: "FR8012"}));
  assert.equal(busy.status, 200);
  assert.equal(busy.body.availability.state, "busy");
  assert.equal(busy.body.availability.availableCount, 0);
  assert.equal(busy.body.availability.selected, null);
  assert.equal(besiter.calls.availability.length, availabilityRequests);
  assert.equal(store.stationLocks.get("FR8012"), id);
  await assert.rejects(service.createInteraction(request({stationId: "FR8012",
    body: {intent: "rent", provisionId: INSTALLATION.provisionId}})),
  (error) => error.code === "station-operation-pending" && error.status === 409);
  assert.equal(vends, 1);
  assert.equal(besiter.calls.vends.length, 0);
  assert.equal(stripe.calls.captures.length + stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
});

test("failure before V2 registration retains safe authorization cleanup", async () => {
  const {service, stripe, store, id, processedRequest} = await createAmazonV2Fixture(async () => {
    throw new V2AmazonGatewayError("v2-original-payment-or-pricing-missing", "registration");
  });
  await assert.rejects(service.paymentProcessed(processedRequest, id), /pricing-missing/);
  assert.deepEqual(stripe.calls.cancels, ["pi_test_8019"]);
  assert.equal(store.stationLocks.size, 0);
  assert.equal(store.interactions.get(id).outcome, "vend_failed");
});

test("uncertain Amazon registration transfers cleanup ownership without issuing a vend or Google payment write", async () => {
  const calls = [];
  const gateway = createV2AmazonGateway({fetchImpl: async (url) => {
    calls.push(url);
    if (url.endsWith("/stations/log-transaction")) throw new Error("response lost after SQL insert");
    return {ok: true};
  }});
  const {service, stripe, store, id, processedRequest} = await createAmazonV2Fixture(gateway.sendVend);
  const result = await service.paymentProcessed(processedRequest, id);
  assert.equal(result.body.state, "vend_verification_pending");
  assert.equal(calls.length, 2);
  assert.equal(calls.some((url) => url.endsWith("/stations/vend")), false);
  assert.equal(store.interactions.get(id).amazonHandoffState, "ownership_transferred_or_unknown");
  await service.cancelInteraction(request({stationId: "FR8012"}), id);
  assert.equal(stripe.calls.captures.length + stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
});

test("Amazon-owned physical vend failure reads payment status without Google capture, cancel or refund", async () => {
  for (const [status, resolution] of [["requires_capture", "authorized"], ["canceled", "canceled"], ["succeeded", "captured"]]) {
    const {service, stripe, store, id, processedRequest} = await createAmazonV2Fixture(async () => {});
    await service.paymentProcessed(processedRequest, id);
    const intent = stripe.intents.get("pi_test_8019");
    intent.status = status;
    intent.amount_received = status === "succeeded" ? intent.amount : 0;
    store.rentals.set(intent.id, {status: "vend_failed", vendState: "failed"});
    const result = await service.getInteraction(request({stationId: "FR8012"}), id);
    assert.equal(result.body.outcome, "vend_failed");
    assert.equal(result.body.paymentResolution, resolution);
    assert.equal(stripe.calls.captures.length + stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
    assert.equal(store.stationLocks.size, 0);
  }
});

test("a TEST billing route blocks real-card checkout before creating any PaymentIntent", async () => {
  const {service, stripe, besiter} = createFixture({
    installation: {...INSTALLATION, stationId: "FR8012", stripeAccountCountry: "FR", stripeMode: "test"},
    v2Config: {enabled: true, stationIds: ["FR8012"], stripeMode: "test",
      stripeAccountId: "acct_existingBillingFixture", paymentProfile: "VERIFIED_FR_LIVE", paymentProfileVerified: true},
  });
  await assert.rejects(service.createInteraction(request({stationId: "FR8012",
    body: {intent: "rent", provisionId: INSTALLATION.provisionId}})), /configuration-mismatch/);
  assert.equal(stripe.calls.creates.length, 0);
  assert.equal(besiter.calls.availability.length, 0);
});

test("a different Stripe account blocks normal V2 vending before its dispatch claim", async () => {
  let vends = 0;
  const {service, store, stripe, id, processedRequest} = await createAmazonV2Fixture(async () => { vends += 1; });
  stripe.accounts.retrieve = async () => ({id: "acct_wrongAccount"});
  await assert.rejects(service.paymentProcessed(processedRequest, id), /does not match/);
  assert.equal(vends, 0);
  assert.equal(store.interactions.get(id).vendDispatchState, undefined);
});

test("FR8012 missing, disabled or nonselected V2 config blocks token and checkout without a legacy fallback", async () => {
  const installation = {...INSTALLATION, stationId: "FR8012", stripeMode: "live",
    stripeAccountCountry: "FR", stripeReaderType: "bbpos_wisepad3", packageName: "com.chargerent.media.lab"};
  for (const v2Config of [null, {enabled: false, stationIds: ["FR8012"]},
    {enabled: true, stationIds: ["FR8011"]}]) {
    const {service, stripe, besiter} = createFixture({installation, v2Config});
    await assert.rejects(service.createConnectionToken(request({stationId: "FR8012"})), /required-configuration-missing/);
    await assert.rejects(service.createInteraction(request({stationId: "FR8012",
      body: {intent: "rent", provisionId: INSTALLATION.provisionId}})), /required-configuration-missing/);
    assert.equal(stripe.calls.connectionTokens + stripe.calls.creates.length, 0);
    assert.equal(besiter.calls.availability.length + besiter.calls.vends.length, 0);
  }
});

test("Amazon-owned installation reassignment cannot bypass required V2 configuration", async () => {
  const installation = {...INSTALLATION, stationId: "FR8022", billingOwner: "amazon_v2"};
  const {service, stripe, besiter} = createFixture({installation});
  await assert.rejects(service.createConnectionToken(request({stationId: "FR8022"})), /required-configuration-missing/);
  assert.equal(stripe.calls.connectionTokens + stripe.calls.creates.length, 0);
  assert.equal(besiter.calls.vends.length, 0);
});

test("a preexisting interaction cannot create payment or dispatch after its required route is disabled", async () => {
  let vends = 0;
  const {service, store, stripe, id, processedRequest} = await createAmazonV2Fixture(async () => { vends += 1; });
  store.getV2CheckoutConfig = async () => ({enabled: false, stationIds: ["FR8012"]});
  await assert.rejects(service.createPaymentIntent(request({stationId: "FR8012"}), id), /required-configuration-missing/);
  await assert.rejects(service.paymentProcessed(processedRequest, id), /required-configuration-missing/);
  assert.equal(stripe.calls.creates.length, 1);
  assert.equal(vends, 0);
});

test("the actual PaymentIntent mode must match the explicit V2 billing configuration", async () => {
  let vends = 0;
  const {service, stripe, store, id, processedRequest} = await createAmazonV2Fixture(async () => { vends += 1; });
  stripe.intents.get("pi_test_8019").livemode = false;
  await assert.rejects(service.paymentProcessed(processedRequest, id), /mode does not match/);
  assert.equal(vends, 0);
  assert.equal(store.interactions.get(id).vendDispatchState, undefined);
});

test("a Firestore write failure after accepted V2 vend cannot cancel the authorization", async () => {
  const {service, store, stripe, id, processedRequest} = await createAmazonV2Fixture(async () => {});
  const originalUpdate = store.finishV2VendDispatch;
  store.finishV2VendDispatch = async function(interactionId, patch, at) {
    if (patch.state === "vend_requested") throw new Error("Firestore temporarily unavailable");
    return originalUpdate.call(this, interactionId, patch, at);
  };
  assert.equal((await service.paymentProcessed(processedRequest, id)).body.state, "vend_verification_pending");
  assert.equal(stripe.calls.cancels.length + stripe.calls.refunds.length, 0);
});

test("a late V2 HTTP reply cannot overwrite independently confirmed physical completion", async () => {
  let start;
  let finish;
  const started = new Promise((resolve) => { start = resolve; });
  const held = new Promise((resolve) => { finish = resolve; });
  const {service, store, id, processedRequest} = await createAmazonV2Fixture(async () => { start(); await held; });
  const sending = service.paymentProcessed(processedRequest, id);
  await started;
  store.rentals.set("pi_test_8019", {status: "rented", vendState: "dispensed",
    vendConfirmationSource: "popup_sn", rentalSlotid: 2,
    rentalModuleid: INSTALLATION.moduleId, chargerid: 41807101});
  await service.getInteraction(request({stationId: "FR8012"}), id);
  finish(); await sending;
  assert.equal(store.interactions.get(id).state, "complete");
  assert.equal(store.interactions.get(id).outcome, "vend_succeeded");
});

test("Firestore station dispatch claim excludes duplicate vend and concurrent station operations", async () => {
  const documents = new Map([
    ["kioskTerminalInteractions/one", {id: "one", stationId: "FR8012", paymentIntentId: "pi_one", outcome: "pending"}],
    ["kioskTerminalInteractions/two", {id: "two", stationId: "FR8012", paymentIntentId: "pi_two", outcome: "pending"}],
  ]);
  let queued = Promise.resolve();
  const db = {
    collection: (name) => ({doc: (id) => ({path: `${name}/${id}`})}),
    runTransaction(action) {
      const result = queued.then(() => action({
        get: async (ref) => ({exists: documents.has(ref.path), data: () => documents.get(ref.path)}),
        set: (ref, data, options = {}) => documents.set(ref.path,
            {...(options.merge ? documents.get(ref.path) : {}), ...data}),
        delete: (ref) => documents.delete(ref.path),
      }));
      queued = result.catch(() => {});
      return result;
    },
  };
  const store = createFirestoreKioskTerminalStore(db);
  const at = new Date("2026-10-09T13:00:00Z");
  const one = documents.get("kioskTerminalInteractions/one");
  const two = documents.get("kioskTerminalInteractions/two");
  await store.claimStationAvailability("FR8012", "availability-one", at);
  await assert.rejects(store.claimV2VendDispatch(one, at), /verifying/);
  await store.releaseStationOperation("FR8012", "wrong-request");
  await assert.rejects(store.claimV2VendDispatch(one, at), /verifying/);
  await store.releaseStationOperation("FR8012", "availability-one");
  const claims = await Promise.all([store.claimV2VendDispatch(one, at), store.claimV2VendDispatch(one, at)]);
  assert.equal(claims.filter(({claimed}) => claimed).length, 1);
  await assert.rejects(store.claimV2VendDispatch(two, at), /verifying/);
  await assert.rejects(store.claimStationAvailability("FR8012", "later", new Date("2026-10-10")), /verifying/);
  await store.releaseStationOperation("FR8012", "one");
  assert.equal((await store.claimV2VendDispatch(two, at)).claimed, true);
});

test("handler rejects requests without an installation token", async () => {
  const {service} = createFixture();
  const handler = createKioskTerminalHandler(service);
  const res = responseRecorder();
  await handler(request({
    path: "/v1/terminal/connection-token",
    body: {stationId: "CA8019"},
    token: "",
  }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, "unauthorized");
  assert.match(res.payload.error, /installation token/i);
});

test("connection token is minted from the kiosk country Stripe account", async () => {
  const {service, stripe, stripeSelections} = createFixture();
  const result = await service.createConnectionToken(request({
    path: "/v1/terminal/connection-token",
    body: {stationId: "CA8019"},
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.secret, "pst_test_connection_secret");
  assert.equal(stripe.calls.connectionTokens, 1);
  assert.deepEqual(stripeSelections, [{accountCountry: "US", mode: "test"}]);
});

test("payment app confirms the exact managed kiosk configuration", async () => {
  const {service, store} = createFixture();
  const result = await service.confirmInstallation(request({
    path: "/v1/installation/confirm",
    body: {
      stationId: "CA8019",
      provisionId: "id-9987807816",
      moduleId: "100049231111490591",
      slotCount: 3,
      currency: "usd",
      appVersion: "0.2.3-stripe-test",
    },
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.confirmed, true);
  assert.equal(store.confirmations.length, 1);
  assert.equal(store.confirmations[0].report.stationId, "CA8019");
  assert.equal(store.confirmations[0].report.currency, "usd");
});

test("payment app cannot confirm a stale currency bundle", async () => {
  const {service, store} = createFixture();
  await assert.rejects(
      service.confirmInstallation(request({
        path: "/v1/installation/confirm",
        body: {
          stationId: "CA8019",
          provisionId: "id-9987807816",
          moduleId: "100049231111490591",
          slotCount: 3,
          currency: "eur",
          appVersion: "0.2.3-stripe-test",
        },
      })),
      (error) => error.code === "installation-config-mismatch" && error.status === 409,
  );
  assert.equal(store.confirmations.length, 0);
});

test("config derives pricing and availability from the kiosk and Besiter", async () => {
  const {service, besiter} = createFixture();
  const result = await service.getConfig(request({method: "GET", path: "/v1/config"}));

  assert.equal(result.body.pricing.paymentAmountCents, 100);
  assert.equal(result.body.pricing.currency, "usd");
  assert.deepEqual(result.body.pricing.pricingLines, [
    "Free for the first 24 hours",
    "$1.00 for each additional 24-hour period",
    "$1.00 if not returned after 30 days",
  ]);
  assert.equal(result.body.availability.state, "available");
  assert.equal(result.body.availability.availableCount, 2);
  assert.equal(result.body.availability.selected.slot, 2);
  assert.equal(besiter.calls.availability.length, 1);
});

test("a pending managed-phone assignment pauses new rental reservations", async () => {
  const {store, writes} = reservationStoreForDevice({pendingAssignment: {commandId: "command-1"}});
  await assert.rejects(reserveForAssignmentTest(store), (error) =>
    error.code === "assignment-pending" && error.status === 409);
  assert.equal(writes.length, 0);
});

test("an unresolved assignment outcome also pauses new rental reservations", async () => {
  const {store, writes} = reservationStoreForDevice({
    assignmentTransitionOutcome: {commandId: "command-1", state: "rolled_back"},
  });
  await assert.rejects(reserveForAssignmentTest(store), (error) =>
    error.code === "assignment-pending" && error.status === 409);
  assert.equal(writes.length, 0);
});

test("a managed device cannot rent through a disabled or mismatched installation", async () => {
  for (const terminal of [
    {enabled: false, installationId: "installation-assignment-test"},
    {enabled: true, installationId: "old-installation"},
  ]) {
    const {store, writes} = reservationStoreForDevice({stationId: "FR8012", terminal});
    await assert.rejects(reserveForAssignmentTest(store), (error) =>
      error.code === "installation-reassigned" && error.status === 409);
    assert.equal(writes.length, 0);
  }
});

test("a matching active managed terminal can reserve a charger", async () => {
  const {store, writes} = reservationStoreForDevice({stationId: "FR8012", terminal: {
    enabled: true, installationId: "installation-assignment-test",
  }});
  const reserved = await reserveForAssignmentTest(store);
  assert.equal(reserved.reservedSlot, 1);
  assert.deepEqual(writes.map((write) => write.kind), ["set", "create"]);
});

test("a managed phone with no pending assignment can reserve a charger", async () => {
  const {store, writes} = reservationStoreForDevice({stationId: "FR8012"});
  const reserved = await reserveForAssignmentTest(store);
  assert.equal(reserved.reservedSlot, 1);
  assert.deepEqual(writes.map((write) => write.kind), ["set", "create"]);
});

test("an older active installation without a managed phone record retains rentals", async () => {
  const {store, writes} = reservationStoreForDevice(null);
  const reserved = await reserveForAssignmentTest(store);
  assert.equal(reserved.reservedSlot, 1);
  assert.deepEqual(writes.map((write) => write.kind), ["set", "create"]);
});

test("a disabled managed terminal rejects direct token requests before Stripe", async () => {
  const {store} = reservationStoreForDevice({stationId: "CA8019", terminal: {
    enabled: false, installationId: INSTALLATION.id,
  }});
  const stripe = createFakeStripe();
  const service = createKioskTerminalService({
    store, getStripeClient: () => stripe, besiterGateway: createFakeBesiter(),
  });
  await assert.rejects(service.createConnectionToken(request({
    path: "/v1/terminal/connection-token", body: {stationId: "CA8019"},
  })), (error) => error.code === "installation-reassigned" && error.status === 409);
  assert.equal(stripe.calls.connectionTokens, 0);
});

test("matching managed and orphan legacy installations retain token access", async () => {
  for (const deviceData of [
    {stationId: "CA8019", terminal: {enabled: true, installationId: INSTALLATION.id}},
    null,
  ]) {
    const {store} = reservationStoreForDevice(deviceData);
    const stripe = createFakeStripe();
    const service = createKioskTerminalService({
      store, getStripeClient: () => stripe, besiterGateway: createFakeBesiter(),
    });
    const response = await service.createConnectionToken(request({
      path: "/v1/terminal/connection-token", body: {stationId: "CA8019"},
    }));
    assert.equal(response.status, 200);
    assert.equal(stripe.calls.connectionTokens, 1);
  }
});

test("French test terminals retain the configured EUR currency", () => {
  const offer = resolveKioskOffer({
    stationId: "FR8011",
    stripeMode: "test",
    stripeAccountCountry: "FR",
  }, {
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
  });

  assert.equal(offer.currency, "eur");
  assert.equal(offer.kioskCurrency, "FR");
  assert.equal(offer.configuredCurrency, "eur");
  assert.equal(offer.configuredKioskCurrency, "FR");
  assert.equal(offer.testCurrencyOverride, false);
  assert.equal(offer.symbol, "€");
  assert.equal(offer.paymentAmount, "€30.00");
  assert.deepEqual(offer.pricingLines, [
    "€4.00 per 24-hour period",
    "€30.00 if not returned after 30 days",
  ]);
});

test("US-address test terminals keep USD when kiosk pricing is still French", () => {
  const offer = resolveKioskOffer({
    stationId: "FR8011",
    stripeMode: "test",
    stripeAccountCountry: "US",
  }, {
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
  });

  assert.equal(offer.currency, "usd");
  assert.equal(offer.kioskCurrency, "US");
  assert.equal(offer.configuredCurrency, "eur");
  assert.equal(offer.testCurrencyOverride, true);
  assert.equal(offer.symbol, "$");
});

test("French live terminals retain the configured EUR currency", () => {
  const offer = resolveKioskOffer({
    stationId: "FR8011",
    stripeMode: "live",
    stripeAccountCountry: "FR",
  }, {
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
  });

  assert.equal(offer.currency, "eur");
  assert.equal(offer.kioskCurrency, "FR");
  assert.equal(offer.testCurrencyOverride, false);
  assert.equal(offer.symbol, "€");
});

test("accepts only the approved French WisePad integrated app in live mode", () => {
  const installation = validateInstallation({
    ...INSTALLATION,
    stationId: "FR8011",
    stripeMode: "live",
    stripeAccountCountry: "FR",
    stripeReaderType: "bbpos_wisepad3",
    packageName: "com.chargerent.media.lab",
  });
  assert.equal(installation.stripeMode, "live");
  assert.equal(installation.stripeAccountCountry, "FR");

  assert.throws(() => validateInstallation({
    ...installation,
    stripeAccountCountry: "US",
  }), /approved only for the French integrated kiosk app with WisePad 3/);
  assert.throws(() => validateInstallation({
    ...installation,
    stripeReaderType: "stripe_m2",
  }), /approved only for the French integrated kiosk app with WisePad 3/);
  assert.throws(() => validateInstallation({
    ...installation,
    packageName: "com.chargerent.kiosk",
  }), /approved only for the French integrated kiosk app with WisePad 3/);
});

test("FULLPRICE creates a buy-price manual-capture card-present authorization", async () => {
  const {service, store, stripe, besiter} = createFixture();
  const created = await service.createInteraction(request({
    path: "/v1/interactions",
    body: {
      stationId: "CA8019",
      provisionId: "id-9987807816",
      moduleId: "100049231111490591",
      intent: "rent",
    },
  }));
  assert.equal(created.body.interactionId, "test-id-2");
  assert.equal(created.body.reservedSlot, 2);
  assert.equal(created.body.amountCents, 100);
  assert.equal(store.kioskVerified, 1);
  assert.equal(store.interactions.get("test-id-2").stripeAccountCountry, "US");
  assert.equal(store.interactions.get("test-id-2").pricingSnapshot.initialperiod, 24);
  assert.equal(store.interactions.get("test-id-2").pricingSnapshot.dailyprice, 1);
  assert.equal(store.interactions.get("test-id-2").pricingSnapshot.currency, "US");

  const payment = await service.createPaymentIntent(
      request({path: "/v1/interactions/test-id-1/payment-intent"}),
      "test-id-2",
  );
  assert.equal(payment.body.paymentIntentId, "pi_test_8019");
  assert.equal(stripe.calls.creates.length, 1);
  const createCall = stripe.calls.creates[0];
  assert.equal(createCall.params.amount, 100);
  assert.equal(createCall.params.currency, "usd");
  assert.deepEqual(createCall.params.payment_method_types, ["card_present"]);
  assert.equal(createCall.params.capture_method, "manual");
  assert.equal(createCall.params.metadata.chargerent_interaction_id, "test-id-2");
  assert.equal(createCall.options.idempotencyKey, "kiosk-payment-test-id-2");
  assert.deepEqual(store.extended, ["test-id-2"]);

  stripe.intents.get("pi_test_8019").status = "requires_capture";
  const processed = await service.paymentProcessed(request({
    path: "/v1/interactions/test-id-2/payment-processed",
    body: {paymentIntentId: "pi_test_8019"},
  }), "test-id-2");
  assert.equal(processed.status, 202);
  assert.equal(processed.body.paymentResolution, "authorized");
  assert.equal(store.interactions.get("test-id-2").state, "vend_requested");
  assert.deepEqual(store.extended, ["test-id-2", "test-id-2"]);
  assert.equal(stripe.calls.captures.length, 0, "authorization must not be captured before a physical vend");
  assert.equal(besiter.calls.vends.length, 1);
  assert.equal(besiter.calls.vends[0].chargerid, 41807101);
  assert.equal(besiter.calls.vends[0].slotid, 2);
  assert.equal(besiter.calls.vends[0].paymentIntentId, "pi_test_8019");
  assert.equal(besiter.calls.vends[0].stripeAccountCountry, "US");
  assert.deepEqual(besiter.calls.vends[0].pricing,
      store.interactions.get("test-id-2").pricingSnapshot);

  const status = await service.getInteraction(
      request({method: "GET", path: "/v1/interactions/test-id-1"}),
      "test-id-2",
  );
  assert.equal(status.body.outcome, "pending");
  assert.equal(status.body.slot, 2);
});

test("FULLPRICE remains authorized after Besiter records physical dispense proof", async () => {
  const {service, store, stripe} = createFixture();
  await service.createInteraction(request({
    body: {
      stationId: "CA8019",
      provisionId: "id-9987807816",
      moduleId: "bootstrap-only",
      intent: "rent",
    },
  }));
  await service.createPaymentIntent(request(), "test-id-2");
  stripe.intents.get("pi_test_8019").status = "requires_capture";
  await service.paymentProcessed(request({body: {paymentIntentId: "pi_test_8019"}}), "test-id-2");

  store.rentals.set("pi_test_8019", {
    status: "rented",
    vendState: "dispensed",
    rentalModuleid: "100049231111490591",
    rentalSlotid: 2,
    chargerid: 41807101,
    vendConfirmationSource: "popup_sn",
    vendAttempts: [{exitStatus: 1, solenoidStatus: 2}],
  });
  const result = await service.getInteraction(request({method: "GET"}), "test-id-2");

  assert.equal(result.body.outcome, "vend_succeeded");
  assert.equal(result.body.slot, 2);
  assert.equal(result.body.paymentResolution, "authorized");
  assert.deepEqual(stripe.calls.captures, []);
  assert.deepEqual(store.released, ["test-id-2"]);
});

test("INITIALPRICE captures the configured initial amount before vending", async () => {
  const kiosk = structuredClone(KIOSK);
  kiosk.hardware.gatewayoptions = "INITIALPRICE";
  kiosk.pricing.kioskmode = "LEASE";
  kiosk.pricing.authamount = 2;
  kiosk.pricing.buyprice = 30;
  const {service, store, stripe} = createFixture({kiosk});

  const created = await service.createInteraction(request({
    body: {
      stationId: "CA8019",
      provisionId: "id-9987807816",
      moduleId: "100049231111490591",
      intent: "rent",
    },
  }));
  assert.equal(created.body.amountCents, 200);
  assert.equal(created.body.gatewayOption, "INITIALPRICE");

  await service.createPaymentIntent(request(), "test-id-2");
  assert.equal(stripe.calls.creates[0].params.amount, 200);
  assert.equal(stripe.calls.creates[0].params.capture_method, "automatic");
  stripe.intents.get("pi_test_8019").status = "succeeded";
  stripe.intents.get("pi_test_8019").amount_received = 200;

  const processed = await service.paymentProcessed(
      request({body: {paymentIntentId: "pi_test_8019"}}),
      "test-id-2",
  );
  assert.equal(processed.body.paymentResolution, "captured");
  assert.equal(store.interactions.get("test-id-2").paymentResolution, "captured");
});

test("canceling an authorized interaction releases the slot without capture", async () => {
  const {service, store, stripe} = createFixture();
  await service.createInteraction(request({
    path: "/v1/interactions",
    body: {
      stationId: "CA8019",
      provisionId: "id-9987807816",
      moduleId: "100049231111490591",
      intent: "rent",
    },
  }));
  await service.createPaymentIntent(request(), "test-id-2");
  stripe.intents.get("pi_test_8019").status = "requires_capture";

  const result = await service.cancelInteraction(request(), "test-id-2");
  assert.equal(result.body.paymentResolution, "canceled");
  assert.deepEqual(stripe.calls.cancels, ["pi_test_8019"]);
  assert.equal(stripe.calls.captures.length, 0);
  assert.deepEqual(store.released, ["test-id-2"]);
});

test("a station header mismatch is rejected before Stripe is called", async () => {
  const {service, stripe} = createFixture();
  await assert.rejects(
      service.createConnectionToken(request({stationId: "US0118"})),
      (error) => error.code === "station-mismatch" && error.status === 403,
  );
  assert.equal(stripe.calls.connectionTokens, 0);
});

for (const gatewayOption of ["FULLPRICE", "INITIALPRICE"]) {
test(`${gatewayOption} return observation displays the backend result without settling payment`, async () => {
  const {service, store, stripe, stripeSelections} = createFixture();
  const opened = await service.createReturnSession(request({
    body: {stationId: "CA8019", moduleId: "100049231111490591"},
  }));
  const returnSessionId = opened.body.returnSessionId;

  let status = await service.getReturnSession(request({method: "GET"}), returnSessionId);
  assert.equal(status.body.outcome, "pending");

  const returnedRental = {
    id: "pi_returned",
    status: "returned",
    gateway: "STRIPE",
    gatewayOption,
    totalCharged: 4,
    chargerid: 41807109,
    returnStationid: "CA8019",
    returnModuleid: "100049231111490591",
    returnSlotid: 1,
    returnTime: "2026-08-15T10:00:01.000Z",
  };
  store.setReturnedRental(returnedRental);
  store.rentals.set(returnedRental.id, structuredClone(returnedRental));
  status = await service.getReturnSession(request({method: "GET"}), returnSessionId);

  assert.equal(status.body.outcome, "received");
  assert.equal(status.body.returnSlot, 1);
  assert.equal(store.returnSessions.get(returnSessionId).state, "besiter_return_confirmed");
  assert.equal(store.returnSessions.get(returnSessionId).chargerSn, 41807109);
  assert.deepEqual(stripeSelections, []);
  assert.deepEqual(stripe.calls.captures, []);
  assert.deepEqual(stripe.calls.cancels, []);
  assert.deepEqual(stripe.calls.refunds, []);
  assert.deepEqual(store.rentals.get(returnedRental.id), returnedRental);
});
}

test("managed token rejection prevents receipt lookup and issuance", async () => {
  let receiptCalls = 0;
  const {service, store} = createFixture({receiptService: {
    link() { receiptCalls += 1; return {}; },
  }});
  let rentalReads = 0;
  store.getBesiterRental = async () => { rentalReads += 1; return null; };
  for (const code of ["assignment-pending", "installation-reassigned"]) {
    store.assertInstallationAuthority = async () => {
      throw Object.assign(new Error("Assignment authority rejected"), {status: 409, code});
    };
    await assert.rejects(service.getInteraction(request({method: "GET"}), "test-id-2"),
        (error) => error.code === code && error.status === 409);
  }
  assert.equal(receiptCalls, 0);
  assert.equal(rentalReads, 0);
});

test("terminal sends receipt identity only after physical vend and reuses it on rental return", async () => {
  const receiptService = createReceiptService({store: {async getRental() {return null;}}, signingKey: "local-test-receipt-key-with-32-bytes", publicBaseUrl: "https://chargerentstations.com/media-kiosk"});
  const {service, store, stripe} = createFixture({receiptService});
  await service.createInteraction(request({body: {stationId: "CA8019", provisionId: "id-9987807816", moduleId: "bootstrap-only", intent: "rent"}}));
  await service.createPaymentIntent(request(), "test-id-2");
  stripe.intents.get("pi_test_8019").status = "requires_capture";
  await service.paymentProcessed(request({body: {paymentIntentId: "pi_test_8019"}}), "test-id-2");
  const pending = (await service.getInteraction(request({method: "GET"}), "test-id-2")).body;
  assert.equal(pending.receiptUrl, undefined); assert.equal(pending.transactionId, undefined);
  const rental = {id: "pi_test_8019", paymentIntentId: "pi_test_8019", rentalStationid: "CA8019", status: "rented", vendState: "dispensed", rentalModuleid: "100049231111490591", rentalSlotid: 2, chargerid: 41807101, vendConfirmationSource: "popup_sn", rentalTime: "2026-08-15T10:00:00Z"};
  store.rentals.set(rental.id, rental);
  const completed = (await service.getInteraction(request({method: "GET"}), "test-id-2")).body;
  assert.equal(completed.outcome, "vend_succeeded"); assert.equal(completed.transactionId, "pi_test_8019"); assert.match(completed.receiptUrl, /\/receipt\/pi_test_8019\?key=/);
  const opened = await service.createReturnSession(request({body: {stationId: "CA8019", moduleId: "100049231111490591"}}));
  const returnedRental = {...rental, status: "returned", returnTime: "2026-08-15T10:01:00Z", returnStationid: "CA8019", returnSlotid: 3};
  store.setReturnedRental(returnedRental); store.rentals.set(rental.id, returnedRental);
  const returned = (await service.getReturnSession(request({method: "GET"}), opened.body.returnSessionId)).body;
  assert.equal(returned.outcome, "received"); assert.equal(returned.receiptUrl, completed.receiptUrl); assert.equal(returned.transactionId, completed.transactionId);
  assert.equal((await service.getReturnSession(request({method: "GET"}), opened.body.returnSessionId)).body.receiptUrl, completed.receiptUrl);
});


test("CTF7 uses the same reserve/pay/vend lifecycle and preserves twelve-byte bank serials", async () => {
  const kiosk = {...structuredClone(KIOSK), active: true, enabled: true, rentalsValidated: true,
    hardware: {...KIOSK.hardware, type: "CTF7"},
    ctf7Commissioning: {persistentEndpointVerified: true, networkBoundaryVerified: true, automaticReturnsVerified: true}};
  const vends = [];
  const ctf7Gateway = {async requestAvailability() { return {action: "status", stationid: INSTALLATION.stationId,
    transport: "ctf7", state: "available", availableCount: 1,
    selected: {moduleId: "LM-TEST000007", slot: 3, chargerSn: "G6C82102258D", batteryLevel: 100, generation: 1, sessionId: "sid"}}; },
  async sendVend(value) { vends.push(value); }};
  const fixture = createFixture({kiosk, ctf7Gateway});
  fixture.store.getInstallation = async () => ({...INSTALLATION, moduleId: "LM-TEST000007", ctf7Validated: true});
  const result = await fixture.service.createInteraction(request({body: {intent: "rent", provisionId: INSTALLATION.provisionId}}));
  const id = result.body.interactionId;
  await fixture.service.createPaymentIntent(request(), id);
  const intent = fixture.stripe.intents.get("pi_test_8019"); intent.status = "requires_capture";
  await fixture.service.paymentProcessed(request({body: {paymentIntentId: intent.id}}), id);
  assert.equal(vends.length, 1); assert.equal(vends[0].sn, "G6C82102258D"); assert.equal(fixture.besiter.calls.vends.length, 0);
  fixture.store.rentals.set(intent.id, {transport: "ctf7", status: "rented", vendState: "dispensed", vendConfirmationSource: "ctf7_correlated_fresh_absence",
    sn: "G6C82102258D", rentalModuleid: "LM-TEST000007", rentalSlotid: 3});
  const final = await fixture.service.getInteraction(request(), id);
  assert.equal(final.body.outcome, "vend_succeeded");
  assert.equal(fixture.store.interactions.get(id).chargerSn, "G6C82102258D");
});
test("CTF7 commissioning gates reject before any payment request", () => {
  assert.throws(() => resolveKioskOffer(INSTALLATION, {...KIOSK, hardware: {...KIOSK.hardware, type: "CTF7"}}), /awaiting hardware/);
  assert.throws(() => validateInstallation({...INSTALLATION, moduleId: "LM-TEST000007"}), /awaiting hardware/);
});
