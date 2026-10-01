/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSupportMobileService,
  linkedRentalPayload,
  mobileRentalSummary,
  normalizeMessagingConfig,
  normalizeLastFour,
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
            assert.equal(field, "card_last4");
            assert.equal(operator, "==");
            return {
              limit(resultLimit) {
                return {
                  async get() {
                    return {
                      docs: [...rentals]
                          .filter(([, rental]) => rental.card_last4 === value)
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

test("mobile rental summaries expose only the support card fields", () => {
  const summary = mobileRentalSummary("rental-1", {
    orderid: "order-1",
    card_last4: 2577,
    rentalStationid: "CA8008",
    totalCharged: "12.50",
    privateProcessorPayload: {secret: true},
  });
  assert.equal(summary.cardLastFour, "2577");
  assert.equal(summary.totalCharged, 12.5);
  assert.equal(summary.privateProcessorPayload, undefined);
  assert.equal(linkedRentalPayload("rental-1", {card_last4: "2577"}).documentId, "rental-1");
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
    details: {},
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
    telephonyService: {sendSmsReply: async () => ({ok: true})},
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
    telephonyService: {sendSmsReply: async () => ({ok: true})},
  });

  const conversations = await service.listTextConversations(20);
  const thread = await service.listTextMessages({ticketId: "PHONE-1"});
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].id, "PHONE-1");
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].body, "Help");
  assert.equal(store.tickets.get("PHONE-1").unread, false);
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
