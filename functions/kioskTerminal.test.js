/* eslint-env node */
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createKioskTerminalHandler,
  createKioskTerminalService,
  resolveKioskOffer,
  settleStripeReturn,
  tokenHash,
} = require("./kioskTerminal");

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

function createFakeStore() {
  const interactions = new Map();
  const returnSessions = new Map();
  const rentals = new Map();
  let returnedRental = null;
  return {
    interactions,
    returnSessions,
    rentals,
    setReturnedRental(value) {
      returnedRental = value;
    },
    kioskVerified: 0,
    confirmations: [],
    released: [],
    extended: [],
    async getInstallation(id) {
      return id === INSTALLATION.id ? {...INSTALLATION} : null;
    },
    async confirmInstallation(installation, report) {
      this.confirmations.push({installation, report});
    },
    async verifyKiosk() {
      this.kioskVerified += 1;
      return {...KIOSK};
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

function createFakeBesiter() {
  const calls = {availability: [], vends: []};
  return {
    calls,
    async requestAvailability(request_) {
      calls.availability.push(request_);
      return {
        action: "status",
        stationid: "CA8019",
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
    cancels: [],
    refunds: [],
  };
  return {
    calls,
    intents,
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
      async capture(id) {
        calls.captures.push(id);
        intents.get(id).status = "succeeded";
        intents.get(id).amount_received = intents.get(id).amount;
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

function createFixture() {
  const store = createFakeStore();
  const stripe = createFakeStripe();
  const besiter = createFakeBesiter();
  const stripeSelections = [];
  let idCounter = 0;
  const service = createKioskTerminalService({
    store,
    getStripeClient: (selection) => {
      stripeSelections.push(selection);
      return stripe;
    },
    besiterGateway: besiter,
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

test("French shared-account test terminals use USD consistently", () => {
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

  assert.equal(offer.currency, "usd");
  assert.equal(offer.kioskCurrency, "US");
  assert.equal(offer.configuredCurrency, "eur");
  assert.equal(offer.configuredKioskCurrency, "FR");
  assert.equal(offer.testCurrencyOverride, true);
  assert.equal(offer.symbol, "$");
  assert.equal(offer.paymentAmount, "$30.00");
  assert.deepEqual(offer.pricingLines, [
    "$4.00 per 24-hour period",
    "$30.00 if not returned after 30 days",
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

test("rental creates a kiosk-priced manual-capture card-present payment", async () => {
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
  assert.equal(store.interactions.get("test-id-2").state, "vend_requested");
  assert.deepEqual(store.extended, ["test-id-2", "test-id-2"]);
  assert.equal(stripe.calls.captures.length, 0, "authorization must not be captured before a physical vend");
  assert.equal(besiter.calls.vends.length, 1);
  assert.equal(besiter.calls.vends[0].chargerid, 41807101);
  assert.equal(besiter.calls.vends[0].slotid, 2);
  assert.equal(besiter.calls.vends[0].paymentIntentId, "pi_test_8019");
  assert.equal(besiter.calls.vends[0].stripeAccountCountry, "US");

  const status = await service.getInteraction(
      request({method: "GET", path: "/v1/interactions/test-id-1"}),
      "test-id-2",
  );
  assert.equal(status.body.outcome, "pending");
  assert.equal(status.body.slot, 2);
});

test("Stripe is captured only after Besiter records physical dispense proof", async () => {
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
  assert.deepEqual(stripe.calls.captures, ["pi_test_8019"]);
  assert.deepEqual(store.released, ["test-id-2"]);
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

test("return completes only after the Besiter return writer records the charger", async () => {
  const {service, store} = createFixture();
  const opened = await service.createReturnSession(request({
    body: {stationId: "CA8019", moduleId: "100049231111490591"},
  }));
  const returnSessionId = opened.body.returnSessionId;

  let status = await service.getReturnSession(request({method: "GET"}), returnSessionId);
  assert.equal(status.body.outcome, "pending");

  store.setReturnedRental({
    id: "pi_returned",
    status: "returned",
    chargerid: 41807109,
    returnStationid: "CA8019",
    returnModuleid: "100049231111490591",
    returnSlotid: 1,
    returnTime: "2026-08-15T10:00:01.000Z",
  });
  status = await service.getReturnSession(request({method: "GET"}), returnSessionId);

  assert.equal(status.body.outcome, "received");
  assert.equal(store.returnSessions.get(returnSessionId).state, "besiter_return_confirmed");
  assert.equal(store.returnSessions.get(returnSessionId).chargerSn, 41807109);
});

test("a free on-time Stripe return refunds the captured kiosk deposit", async () => {
  const store = createFakeStore();
  const stripe = createFakeStripe();
  const stripeSelections = [];
  stripe.intents.set("pi_test_return", {
    id: "pi_test_return",
    status: "succeeded",
    amount: 100,
    amount_received: 100,
    currency: "usd",
  });
  store.rentals.set("pi_test_return", {
    orderid: "pi_test_return",
    paymentIntentId: "pi_test_return",
    gateway: "STRIPE",
    status: "returned",
    totalCharged: 0,
    rentalStationid: "CA8019",
    returnStationid: "CA8019",
  });
  store.interactions.set("interaction-return", {
    id: "interaction-return",
    paymentIntentId: "pi_test_return",
    stationId: "CA8019",
    stripeAccountCountry: "US",
    stripeMode: "test",
  });

  const result = await settleStripeReturn({
    rental: store.rentals.get("pi_test_return"),
    rentalId: "pi_test_return",
    getStripeClient: (selection) => {
      stripeSelections.push(selection);
      return stripe;
    },
    store,
    now: () => new Date("2026-08-15T10:15:00.000Z"),
  });

  assert.equal(result.refundCents, 100);
  assert.equal(stripe.calls.refunds.length, 1);
  assert.equal(stripe.calls.refunds[0].params.amount, 100);
  assert.equal(stripe.calls.refunds[0].options.idempotencyKey, "kiosk-return-refund-pi_test_return");
  assert.equal(store.rentals.get("pi_test_return").stripeReturnSettlement.status, "completed");
  assert.deepEqual(stripeSelections, [{accountCountry: "US", mode: "test"}]);
  assert.equal(
      store.rentals.get("pi_test_return").stripeReturnSettlement.stripeAccountCountry,
      "US",
  );
});
