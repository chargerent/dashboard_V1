/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSupportMobileService,
  linkedRentalPayload,
  mobileRentalSummary,
  normalizeChargerId,
  normalizeMessagingConfig,
  normalizeLastFour,
  rentalStationCountry,
  supportNumberCountry,
} = require("./supportMobile");

function createFakeStore() {
  const tickets = new Map();
  const rentals = new Map();
  const messages = new Map();
  const kiosks = new Map();
  const config = new Map();
  const snapshot = (value) => ({exists: value !== undefined, data: () => value});
  const messageCollection = (ticketId) => ({
    orderBy(field, direction) {
      assert.equal(field, "createdAtIso");
      assert.equal(direction, "asc");
      return {
        limit(resultLimit) {
          return {
            async get() {
              return {
                docs: [...messages]
                    .filter(([key]) => key.startsWith(`${ticketId}:`))
                    .sort((left, right) => String(left[1].createdAtIso).localeCompare(String(right[1].createdAtIso)))
                    .slice(0, resultLimit)
                    .map(([key, data]) => ({id: key.split(":")[1], data: () => data})),
              };
            },
          };
        },
      };
    },
  });
  const ticketRef = (id) => ({
    id,
    async get() { return snapshot(tickets.get(id)); },
    async set(data, options = {}) {
      tickets.set(id, options.merge ? {...tickets.get(id), ...data} : data);
    },
    collection(name) {
      assert.equal(name, "messages");
      return messageCollection(id);
    },
  });
  const rentalRef = (id) => ({
    id,
    async get() { return snapshot(rentals.get(id)); },
  });
  const db = {
    collection(name) {
      if (name === "supportTickets") {
        return {
          doc: ticketRef,
          orderBy(field, direction) {
            assert.equal(field, "lastActivityAtIso");
            assert.equal(direction, "desc");
            return {
              limit(resultLimit) {
                return {
                  async get() {
                    return {
                      docs: [...tickets]
                          .sort((left, right) => String(right[1].lastActivityAtIso)
                              .localeCompare(String(left[1].lastActivityAtIso)))
                          .slice(0, resultLimit)
                          .map(([id, data]) => ({id, data: () => data})),
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (name === "rentals") {
        return {
          doc: rentalRef,
          where(field, operator, value) {
            assert.ok(["card_last4", "sn", "chargerid"].includes(field));
            assert.equal(operator, "==");
            const matchingDocuments = () => [...rentals]
                .filter(([, rental]) => rental[field] === value)
                .map(([id, data]) => ({id, data: () => data}));
            return {
              async get() {
                return {docs: matchingDocuments()};
              },
              limit(resultLimit) {
                return {
                  async get() {
                    return {
                      docs: matchingDocuments().slice(0, resultLimit),
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (name === "kiosks") {
        return {
          where(field, operator, value) {
            assert.equal(field, "stationid");
            assert.equal(operator, "==");
            return {
              limit(resultLimit) {
                return {
                  async get() {
                    return {
                      docs: [...kiosks]
                          .filter(([, kiosk]) => kiosk.stationid === value)
                          .slice(0, resultLimit)
                          .map(([id, data]) => ({id, data: () => data})),
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (name === "supportTelephonyConfig") {
        return {
          doc: (id) => ({
            async get() { return snapshot(config.get(id)); },
          }),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };
  const admin = {firestore: {FieldValue: {serverTimestamp: () => "server-time"}}};
  return {admin, config, db, kiosks, messages, rentals, tickets};
}

test("last-four searches accept exactly four digits", () => {
  assert.equal(normalizeLastFour("12 34"), "1234");
  assert.throws(() => normalizeLastFour("123"), /last four/);
  assert.throws(() => normalizeLastFour("12345"), /last four/);
});

test("charger searches accept normalized identifiers", () => {
  assert.equal(normalizeChargerId(" 40823366 "), "40823366");
  assert.equal(normalizeChargerId("cr-fr_42"), "CR-FR_42");
  assert.throws(() => normalizeChargerId("1"), /valid charger ID/);
});

test("support numbers and kiosk station IDs resolve to supported countries", () => {
  assert.equal(supportNumberCountry("+19179939355"), "US");
  assert.equal(supportNumberCountry("+14165550123"), "CA");
  assert.equal(supportNumberCountry("+33123456789"), "FR");
  assert.equal(rentalStationCountry({rentalStationid: "US8001"}), "US");
  assert.equal(rentalStationCountry({rentalStationid: "CA8001"}), "CA");
  assert.equal(rentalStationCountry({rentalStationid: "FR8001"}), "FR");
});

test("mobile rental summaries expose only the support card fields", () => {
  const summary = mobileRentalSummary("rental-1", {
    orderid: "order-1",
    card_last4: 2577,
    rentalStationid: "CA8008",
    status: "returned",
    totalCharged: "12.50",
    privateProcessorPayload: {secret: true},
  });
  assert.equal(summary.cardLastFour, "2577");
  assert.equal(summary.totalCharged, 12.5);
  assert.equal(summary.privateProcessorPayload, undefined);
  assert.equal(linkedRentalPayload("rental-1", {card_last4: "2577"}).documentId, "rental-1");
});

test("open rentals preserve numeric charger IDs without showing the purchase price", () => {
  const summary = mobileRentalSummary("pi-oct-2", {
    orderid: "pi-oct-2",
    card_last4: "7037",
    rentalStationid: "CA8001",
    rentalLocation: "YYZ",
    rentalTime: "2026-10-02T01:50:20.853Z",
    status: "rented",
    sn: 40823366,
    chargerid: 40823366,
    totalCharged: null,
    buyprice: 35,
    symbol: "$",
  });

  assert.equal(summary.chargerId, "40823366");
  assert.equal(summary.totalCharged, null);
});

test("completed rentals use the same charged-amount fallback as dashboard cards", () => {
  assert.equal(mobileRentalSummary("returned", {
    status: "returned",
    totalCharged: 7.25,
    buyprice: 35,
  }).totalCharged, 7.25);
  assert.equal(mobileRentalSummary("purchased", {
    status: "purchased",
    buyprice: 35,
  }).totalCharged, 35);
});

test("messaging config only enables approved-looking RCS resources", () => {
  const disabled = normalizeMessagingConfig({
    rcsEnabled: true,
    messagingServiceSid: "not-a-service",
    richTemplates: [{id: "actions", name: "Actions", contentSid: "bad"}],
  });
  assert.equal(disabled.rcsEnabled, false);
  assert.equal(disabled.templates.length, 0);

  const enabled = normalizeMessagingConfig({
    brandName: "Chargerent Support",
    logoConfigured: true,
    rcsEnabled: true,
    messagingServiceSid: `MG${"a".repeat(32)}`,
    richTemplates: [{
      id: "actions",
      name: "Support actions",
      contentSid: `HX${"b".repeat(32)}`,
    }],
  });
  assert.equal(enabled.rcsEnabled, true);
  assert.equal(enabled.templates.length, 1);
});

test("search saves last four and matching persists the selected rental", async () => {
  const store = createFakeStore();
  store.tickets.set("CALL-1", {
    ticketNumber: "CALL-1",
    customer: {phoneE164: "+18185550123"},
    payment: {cardLastFour: ""},
    details: {twilioSupportNumber: "+14165550123"},
  });
  store.rentals.set("rental-1", {
    orderid: "order-1",
    card_last4: "2577",
    rentalStationid: "CA8008",
    rentalLocation: "Airport",
    rentalTime: "2026-09-28T12:00:00.000Z",
    status: "returned",
    totalCharged: 8,
  });
  store.kiosks.set("kiosk-1", {
    stationid: "CA8008",
    hardware: {gateway: "payter"},
  });
  let matchedChanges;
  const service = createSupportMobileService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-29T01:00:00.000Z"),
    ticketService: {
      async updateTicket(data) {
        matchedChanges = data.changes;
        store.tickets.set(data.ticketId, {...store.tickets.get(data.ticketId), ...data.changes});
      },
    },
    telephonyService: {
      assertCaseAccess: async () => ({ticket: {}}),
      sendSmsReply: async () => ({ok: true}),
    },
  });

  const search = await service.searchRentals({ticketId: "CALL-1", cardLastFour: "2577"}, {
    uid: "staff-1",
    profile: {username: "george"},
  });
  assert.equal(search.rentals.length, 1);
  assert.equal(search.rentals[0].gateway, "payter");
  assert.equal(store.tickets.get("CALL-1").payment.cardLastFour, "2577");
  assert.equal(store.tickets.get("CALL-1").needsCaseMatch, true);

  const match = await service.matchRental({ticketId: "CALL-1", rentalId: "rental-1"}, {
    uid: "staff-1",
    profile: {username: "george"},
  });
  assert.equal(match.rental.id, "rental-1");
  assert.equal(matchedChanges.linkedRental.documentId, "rental-1");
  assert.equal(store.tickets.get("CALL-1").needsCaseMatch, false);
});

test("rental search filters by the dialed number country and sorts newest rental first", async () => {
  const store = createFakeStore();
  store.tickets.set("CALL-US", {
    ticketNumber: "CALL-US",
    callSupportLines: ["+19179939355"],
    customer: {phoneE164: "+18185550123"},
    payment: {cardLastFour: ""},
    details: {twilioSupportNumber: "+19179939355"},
  });
  store.rentals.set("us-older-returned-later", {
    card_last4: "7037",
    rentalStationid: "US8001",
    rentalTime: "2026-10-01T12:00:00.000Z",
    returnTime: "2026-10-03T12:00:00.000Z",
    status: "returned",
  });
  store.rentals.set("us-newer", {
    card_last4: "7037",
    rentalStationid: "US8002",
    rentalTime: "2026-10-02T12:00:00.000Z",
    status: "rented",
  });
  store.rentals.set("ca-newest", {
    card_last4: "7037",
    rentalStationid: "CA8001",
    rentalTime: "2026-10-04T12:00:00.000Z",
    status: "rented",
  });
  const service = createSupportMobileService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-10-05T01:00:00.000Z"),
    ticketService: {updateTicket: async () => {}},
    telephonyService: {
      assertCaseAccess: async () => ({ticket: {}}),
      sendSmsReply: async () => ({ok: true}),
    },
  });

  const search = await service.searchRentals({
    ticketId: "CALL-US",
    cardLastFour: "7037",
  }, {uid: "staff-1"});

  assert.deepEqual(search.rentals.map((rental) => rental.id), [
    "us-newer",
    "us-older-returned-later",
  ]);
  await assert.rejects(
      () => service.matchRental({ticketId: "CALL-US", rentalId: "ca-newest"}, {uid: "staff-1"}),
      /not from a kiosk in the country/,
  );
});

test("rental search can use charger ID and matching verifies the saved charger", async () => {
  const store = createFakeStore();
  store.tickets.set("CALL-CHARGER", {
    ticketNumber: "CALL-CHARGER",
    customer: {phoneE164: "+18185550123"},
    payment: {cardLastFour: ""},
    details: {twilioSupportNumber: "+19179939355"},
  });
  store.rentals.set("matching-rental", {
    card_last4: "7037",
    sn: 40823366,
    chargerid: 40823366,
    rentalStationid: "US8002",
    rentalTime: "2026-10-02T12:00:00.000Z",
    status: "returned",
  });
  store.rentals.set("wrong-country", {
    sn: 40823366,
    rentalStationid: "CA8002",
    rentalTime: "2026-10-03T12:00:00.000Z",
    status: "returned",
  });
  let matchedChanges;
  const service = createSupportMobileService({
    db: store.db,
    admin: store.admin,
    ticketService: {
      async updateTicket(data) {
        matchedChanges = data.changes;
      },
    },
    telephonyService: {
      assertCaseAccess: async () => ({ticket: {}}),
      sendSmsReply: async () => ({ok: true}),
    },
  });

  const search = await service.searchRentals({
    ticketId: "CALL-CHARGER",
    searchMode: "charger_id",
    chargerId: "40823366",
  }, {uid: "staff-1"});

  assert.equal(search.searchMode, "charger_id");
  assert.equal(search.cardLastFour, "");
  assert.equal(search.chargerId, "40823366");
  assert.deepEqual(search.rentals.map((rental) => rental.id), ["matching-rental"]);
  assert.equal(store.tickets.get("CALL-CHARGER").details.chargerId, "40823366");
  const matched = await service.matchRental({
    ticketId: "CALL-CHARGER",
    rentalId: "matching-rental",
  }, {uid: "staff-1"});
  assert.equal(matched.rental.chargerId, "40823366");
  assert.equal(matchedChanges.linkedRental.documentId, "matching-rental");
});

test("text threads return only SMS activity and mark the conversation read", async () => {
  const store = createFakeStore();
  store.tickets.set("PHONE-1", {
    ticketNumber: "PHONE-1",
    source: "sms",
    channel: "sms",
    replyChannel: "sms",
    unread: true,
    customer: {phoneE164: "+18185550123"},
    lastActivityAtIso: "2026-09-29T01:00:00.000Z",
  });
  store.messages.set("PHONE-1:sms-1", {
    channel: "sms",
    direction: "inbound",
    body: "Help",
    createdAtIso: "2026-09-29T01:00:00.000Z",
  });
  store.messages.set("PHONE-1:call-1", {
    channel: "phone",
    direction: "inbound",
    body: "Call",
    createdAtIso: "2026-09-29T01:01:00.000Z",
  });
  store.tickets.set("CALL-ONLY", {
    ticketNumber: "CALL-ONLY",
    source: "phone",
    channel: "phone",
    replyChannel: "sms",
    customer: {phoneE164: "+18185550999"},
    lastActivityAtIso: "2026-09-29T01:02:00.000Z",
  });
  store.messages.set("CALL-ONLY:call-2", {
    channel: "phone",
    direction: "inbound",
    body: "Incoming customer call.",
    createdAtIso: "2026-09-29T01:02:00.000Z",
  });
  const service = createSupportMobileService({
    db: store.db,
    admin: store.admin,
    ticketService: {updateTicket: async () => ({ok: true})},
    telephonyService: {
      assertCaseAccess: async () => ({ticket: {}}),
      sendSmsReply: async () => ({ok: true}),
    },
  });

  const conversations = await service.listTextConversations(20);
  const thread = await service.listTextMessages({ticketId: "PHONE-1"});
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].id, "PHONE-1");
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].body, "Help");
  assert.equal(store.tickets.get("PHONE-1").unread, false);
});

test("text conversations are limited to the partner's subscribed support line", async () => {
  const store = createFakeStore();
  store.tickets.set("PHONE-US", {
    source: "sms",
    channel: "sms",
    customer: {phoneE164: "+18185550123"},
    details: {twilioSupportAddress: "+19179939355"},
    lastActivityAtIso: "2026-09-29T02:00:00.000Z",
  });
  store.tickets.set("PHONE-FR", {
    source: "sms",
    channel: "sms",
    customer: {phoneE164: "+33612345678"},
    details: {twilioSupportAddress: "+33187654321"},
    lastActivityAtIso: "2026-09-29T03:00:00.000Z",
  });
  store.messages.set("PHONE-US:us-message", {
    channel: "sms",
    direction: "inbound",
    from: "+18185550123",
    to: "+19179939355",
    body: "US help",
    createdAtIso: "2026-09-29T02:00:00.000Z",
  });
  store.messages.set("PHONE-US:legacy-other-line", {
    channel: "sms",
    direction: "inbound",
    from: "+18185550123",
    to: "+33187654321",
    body: "France help",
    createdAtIso: "2026-09-29T02:01:00.000Z",
  });
  const service = createSupportMobileService({
    db: store.db,
    admin: store.admin,
    ticketService: {updateTicket: async () => ({ok: true})},
    telephonyService: {
      assertCaseAccess: async () => ({ticket: {}}),
      sendSmsReply: async () => ({ok: true}),
    },
  });

  const conversations = await service.listTextConversations(20, ["+19179939355"]);
  const thread = await service.listTextMessages(
      {ticketId: "PHONE-US"},
      ["+19179939355"],
  );
  assert.deepEqual(conversations.map((conversation) => conversation.id), ["PHONE-US"]);
  assert.equal(conversations[0].lastMessage, "");
  assert.deepEqual(thread.messages.map((message) => message.body), ["US help"]);
});

test("RCS conversations, rich replies, and safe capabilities are supported", async () => {
  const store = createFakeStore();
  store.config.set("messaging", {
    brandName: "Chargerent Support",
    logoConfigured: true,
    rcsEnabled: true,
    messagingServiceSid: `MG${"a".repeat(32)}`,
    senderStatus: "test",
    richTemplates: [{
      id: "support-actions",
      name: "Support choices",
      description: "Adds reply buttons.",
      contentSid: `HX${"b".repeat(32)}`,
    }],
  });
  store.tickets.set("PHONE-RCS", {
    source: "rcs",
    channel: "rcs",
    replyChannel: "rcs",
    customer: {phoneE164: "+18185550123"},
    lastActivityAtIso: "2026-09-29T01:00:00.000Z",
  });
  store.messages.set("PHONE-RCS:rcs-1", {
    channel: "rcs",
    direction: "inbound",
    body: "Rental help",
    buttonText: "Rental help",
    buttonPayload: "rental_help",
    createdAtIso: "2026-09-29T01:00:00.000Z",
  });
  let sentOptions;
  const service = createSupportMobileService({
    db: store.db,
    admin: store.admin,
    ticketService: {updateTicket: async () => ({ok: true})},
    telephonyService: {
      assertCaseAccess: async () => ({ticket: {}}),
      async sendSmsReply(data, authState, options) {
        sentOptions = options;
        return {ok: true};
      },
    },
  });

  const capabilities = await service.messagingCapabilities();
  const conversations = await service.listTextConversations(20);
  const thread = await service.listTextMessages({ticketId: "PHONE-RCS"});
  await service.sendText({ticketId: "PHONE-RCS", body: "Choose one", templateId: "support-actions"});

  assert.equal(capabilities.rcsEnabled, true);
  assert.equal(capabilities.templates[0].contentSid, undefined);
  assert.equal(conversations.length, 1);
  assert.equal(thread.messages[0].channel, "rcs");
  assert.equal(thread.messages[0].buttonPayload, "rental_help");
  assert.match(sentOptions.messagingServiceSid, /^MG/);
  assert.equal(sentOptions.richTemplate.id, "support-actions");
});
