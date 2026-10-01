/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSupportTicketService,
  inferChatbotCategory,
  inferEmailCategory,
  normalizeChatbotEvent,
  normalizePublicSubmission,
  normalizeTicketChanges,
  requestCategory,
  resolveReplySender,
  secretsMatch,
  supportTicketDisplayNumber,
  ticketTokenFromSubject,
} = require("./supportTickets");

function createFakeChatbotStore() {
  const tickets = new Map();
  const messages = new Map();
  const reference = (kind, id, ticketId = "") => ({kind, id, ticketId});
  const db = {
    collection(name) {
      assert.equal(name, "supportTickets");
      return {
        doc(ticketId) {
          const ticketRef = reference("ticket", ticketId);
          return {
            ...ticketRef,
            collection(collectionName) {
              assert.equal(collectionName, "messages");
              return {doc: (messageId) => reference("message", messageId, ticketId)};
            },
          };
        },
      };
    },
    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          const record = ref.kind === "ticket" ? tickets.get(ref.id) : messages.get(`${ref.ticketId}:${ref.id}`);
          return {exists: Boolean(record), data: () => record};
        },
        set(ref, data) {
          if (ref.kind === "ticket") tickets.set(ref.id, data);
          else messages.set(`${ref.ticketId}:${ref.id}`, data);
        },
        update(ref, data) {
          assert.equal(ref.kind, "ticket");
          tickets.set(ref.id, {...tickets.get(ref.id), ...data});
        },
      };
      return callback(transaction);
    },
  };
  const admin = {
    firestore: {FieldValue: {serverTimestamp: () => "server-time"}},
  };
  return {admin, db, messages, tickets};
}

function createFakeSupportStore(ticket) {
  const directWrites = [];
  const committedBatches = [];
  const messageRef = {
    id: "message-1",
    async set(data) {
      directWrites.push({operation: "set", target: "message", data});
    },
  };
  const ticketRef = {
    id: "ticket-1",
    async get() {
      return {exists: true, data: () => ticket};
    },
    collection(name) {
      assert.equal(name, "messages");
      return {doc: () => messageRef};
    },
  };
  const db = {
    collection(name) {
      assert.equal(name, "supportTickets");
      return {doc: () => ticketRef};
    },
    batch() {
      const writes = [];
      return {
        update(ref, data) {
          writes.push({operation: "update", target: ref === messageRef ? "message" : "ticket", data});
        },
        async commit() {
          committedBatches.push(writes);
        },
      };
    },
  };
  const admin = {
    firestore: {FieldValue: {serverTimestamp: () => "server-time"}},
  };
  return {admin, committedBatches, db, directWrites};
}

function createFakeInboundEmailStore() {
  const tickets = new Map();
  const messages = new Map();
  const reference = (kind, id, ticketId = "") => ({kind, id, ticketId});
  const emptyQuery = {
    limit() {
      return this;
    },
    async get() {
      return {docs: []};
    },
  };
  const db = {
    collection(name) {
      assert.equal(name, "supportTickets");
      return {
        doc(ticketId) {
          const ticketRef = reference("ticket", ticketId);
          return {
            ...ticketRef,
            collection(collectionName) {
              assert.equal(collectionName, "messages");
              return {doc: (messageId) => reference("message", messageId, ticketId)};
            },
          };
        },
        where() {
          return emptyQuery;
        },
      };
    },
    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          const record = ref.kind === "ticket" ? tickets.get(ref.id) : messages.get(`${ref.ticketId}:${ref.id}`);
          return {exists: Boolean(record), data: () => record};
        },
        set(ref, data) {
          if (ref.kind === "ticket") tickets.set(ref.id, data);
          else messages.set(`${ref.ticketId}:${ref.id}`, data);
        },
      };
      return callback(transaction);
    },
  };
  const admin = {
    firestore: {FieldValue: {serverTimestamp: () => "server-time"}},
  };
  return {admin, db, messages, tickets};
}

test("website request types map to support queue categories", () => {
  assert.equal(requestCategory("other"), "customer_support");
  assert.equal(requestCategory("event"), "sales");
  assert.equal(requestCategory("venue"), "sales");
  assert.equal(requestCategory("vending"), "partnership");
  assert.equal(requestCategory("unknown"), "general");
});

test("public customer-service submission keeps only the last four card digits", () => {
  const normalized = normalizePublicSubmission({
    source: "charge.rent",
    quoteId: "Q-test-123",
    submittedAt: "2026-09-23T12:00:00.000Z",
    lead: {
      requestType: "other",
      name: "Test Customer",
      email: "CUSTOMER@example.com",
      phone: "+1 555 0100",
      rentalLocation: "Terminal 3",
      rentalDate: "2026-09-22",
      cardLastFour: "1234",
      message: "I was charged after returning the charger.",
      locale: "en",
    },
  }, {createdAt: "server-time", createdAtIso: "2026-09-23T12:00:00.000Z"});

  assert.equal(normalized.id, "Q-test-123");
  assert.equal(normalized.ticket.category, "customer_support");
  assert.equal(normalized.ticket.displayTicketNumber, "CS-TEST12");
  assert.equal(normalized.ticket.customer.email, "customer@example.com");
  assert.equal(normalized.ticket.payment.cardLastFour, "1234");
  assert.equal(normalized.ticket.details.cardLastFour, "1234");
  assert.equal(normalized.ticket.status, "new");
  assert.equal(normalized.ticket.replyAddress, "support@charge.rent");
});

test("support ticket display numbers are short, stable, and category-specific", () => {
  assert.equal(
      supportTicketDisplayNumber("Q-da162054-9e41-4cec-a306-9b7dc11380fd", "customer_support"),
      "CS-DA1620",
  );
  assert.equal(supportTicketDisplayNumber("Q-56507e7b-test", "sales"), "SL-56507E");
});

test("email subjects expose only explicit Chargerent ticket tokens", () => {
  assert.equal(ticketTokenFromSubject("Re: Return question [CS-ABC123]"), "CS-ABC123");
  assert.equal(ticketTokenFromSubject("Order ABC123"), "");
});

test("new inbox messages receive a useful initial category", () => {
  assert.equal(inferEmailCategory("Refund question", "I returned the charger"), "customer_support");
  assert.equal(inferEmailCategory("Event quote", "We need chargers at our venue"), "sales");
  assert.equal(inferEmailCategory("Distributor partnership", "Revenue share"), "partnership");
  assert.equal(inferEmailCategory("Hello", "Can someone contact me?"), "general");
});

test("a free-form message to the sales address creates a Sales case", async () => {
  const store = createFakeInboundEmailStore();
  const service = createSupportTicketService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-29T12:00:00.000Z"),
  });

  const result = await service.importInboundEmail({
    messageId: "gmail-sales-lead-1",
    threadId: "gmail-sales-thread-1",
    rfcMessageId: "<sales-lead-1@example.com>",
    from: "roza@example.com",
    fromName: "Roza Prospect",
    to: "sales@charge.rent",
    originalRecipient: "sales@charge.rent",
    inboundMailbox: "george@charge.rent",
    category: "sales",
    subject: "Event in Sunnyvale",
    body: "We are hosting a summit and would like portable power banks.",
    receivedAt: "2026-09-29T12:00:00.000Z",
  });

  assert.equal(result.created, true);
  const ticket = store.tickets.get(result.ticketId);
  assert.equal(ticket.category, "sales");
  assert.match(ticket.displayTicketNumber, /^SL-/);
  assert.equal(ticket.customer.email, "roza@example.com");
  assert.equal(ticket.originalRecipient, "sales@charge.rent");
  assert.equal(ticket.inboundMailbox, "george@charge.rent");
  assert.equal(ticket.replyAddress, "support@charge.rent");
  const message = [...store.messages.values()][0];
  assert.equal(message.body, "We are hosting a summit and would like portable power banks.");
  assert.equal(message.originalRecipient, "sales@charge.rent");
});

test("chatbot events normalize into customer-service cases without storing full card data", () => {
  const normalized = normalizeChatbotEvent({
    provider: "partner-chatbot",
    conversationId: "conversation-123",
    messageId: "message-123",
    eventType: "human_handoff_requested",
    occurredAt: "2026-09-24T12:00:00.000Z",
    intent: "charge_concern",
    customer: {
      name: "Camille Client",
      email: "CAMILLE@example.com",
      locale: "fr",
    },
    rental: {
      location: "Paris Gare du Nord",
      date: "2026-09-23",
      cardLastFour: "2577",
    },
    message: "Je souhaite parler à une personne au sujet d’un débit.",
  }, {createdAt: "server-time", createdAtIso: "2026-09-24T12:00:00.000Z"});

  assert.match(normalized.id, /^CHAT-[a-f0-9]{20}$/);
  assert.equal(normalized.ticket.source, "chatbot");
  assert.equal(normalized.ticket.channel, "chatbot");
  assert.equal(normalized.ticket.category, "customer_support");
  assert.equal(normalized.ticket.customer.email, "camille@example.com");
  assert.equal(normalized.ticket.payment.cardLastFour, "2577");
  assert.equal(normalized.ticket.details.locale, "fr");
  assert.equal(normalized.message.externalThreadId, "conversation-123");
  assert.equal(normalized.message.externalMessageId, "message-123");
  assert.equal(inferChatbotCategory("partnership", "", ""), "partnership");
  assert.equal(inferChatbotCategory("event", "", ""), "sales");

  assert.throws(() => normalizeChatbotEvent({
    conversationId: "conversation-unsafe",
    messageId: "message-unsafe",
    message: "Card details",
    rental: {cardLastFour: "4111111111111111"},
  }), /exactly the last four digits/);
});

test("Arthur's Disney chatbot submission maps into a complete customer-service case", () => {
  const normalized = normalizeChatbotEvent({
    reason: "faulty_powerbank",
    station_id: "S07",
    payment_method: "physical_card",
    card_last4: "4521",
    amount_requested: 10.00,
    guest_email: "guest@example.com",
    reason_detail: "The cable was broken",
    language: "fr",
    session_id: "sess_1727385600000_x4k2p9a",
    submitted_at: "2026-09-27T14:32:00.000Z",
  }, {createdAt: "server-time", createdAtIso: "2026-09-27T14:32:00.000Z"});

  assert.match(normalized.id, /^CHAT-[a-f0-9]{20}$/);
  assert.equal(normalized.externalMessageId, "submission:sess_1727385600000_x4k2p9a");
  assert.equal(normalized.ticket.category, "customer_support");
  assert.equal(normalized.ticket.chatbotProvider, "disney-chatbot");
  assert.equal(normalized.ticket.customer.email, "guest@example.com");
  assert.equal(normalized.ticket.payment.cardLastFour, "4521");
  assert.equal(normalized.ticket.details.chatbotReason, "faulty_powerbank");
  assert.equal(normalized.ticket.details.chatbotReasonLabel, "Faulty charger");
  assert.equal(normalized.ticket.details.chatbotStationId, "S07");
  assert.equal(normalized.ticket.details.paymentMethod, "physical_card");
  assert.equal(normalized.ticket.details.amountRequested, 10);
  assert.equal(normalized.ticket.details.amountCurrency, "EUR");
  assert.equal(normalized.ticket.details.submittedLanguage, "fr");
  assert.equal(normalized.ticket.details.locale, "fr");
  assert.equal(normalized.ticket.details.rentalDate, "2026-09-27");
  assert.equal(normalized.ticket.message, "The cable was broken");
  assert.equal(normalized.message.createdAtIso, "2026-09-27T14:32:00.000Z");
});

test("Disney chatbot submissions derive the rental date and accept an explicit override", () => {
  const validSubmission = {
    reason: "double_charge",
    station_id: "S20",
    payment_method: "apple_pay",
    card_last4: "1234",
    amount_requested: 30,
    guest_email: null,
    reason_detail: "",
    language: "en",
    session_id: "sess_1727385600000_abcdefghi",
    submitted_at: "2026-09-27T14:32:00.000Z",
    rental_date: "2026-09-26",
  };
  const normalized = normalizeChatbotEvent(validSubmission);
  assert.equal(normalized.ticket.details.rentalDate, "2026-09-26");
  assert.equal(normalized.ticket.replyChannel, "chatbot");
  assert.equal(normalized.ticket.message, "Double charge");

  const derivedDate = normalizeChatbotEvent({...validSubmission, rental_date: undefined});
  assert.equal(derivedDate.ticket.details.rentalDate, "2026-09-27");

  for (const [field, value, expectedMessage] of [
    ["reason", "unknown_reason", /reason is invalid/],
    ["station_id", "S99", /station ID is invalid/],
    ["payment_method", "cash", /payment method is invalid/],
    ["card_last4", "4111111111111111", /exactly the last four digits/],
    ["amount_requested", 12, /requested amount is invalid/],
    ["language", "xx", /language is invalid/],
    ["rental_date", "09-26-2026", /must use YYYY-MM-DD/],
  ]) {
    assert.throws(
        () => normalizeChatbotEvent({...validSubmission, [field]: value}),
        expectedMessage,
    );
  }
});

test("chatbot ingestion creates one case per conversation and deduplicates retried messages", async () => {
  const store = createFakeChatbotStore();
  const service = createSupportTicketService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-24T12:00:00.000Z"),
  });
  const firstEvent = {
    provider: "partner-chatbot",
    conversationId: "conversation-123",
    messageId: "message-1",
    intent: "charge_concern",
    customer: {name: "Camille Client", email: "camille@example.com", locale: "fr"},
    rental: {location: "Paris Gare du Nord", date: "2026-09-23", cardLastFour: "2577"},
    message: "I need help with a charge.",
  };

  const created = await service.importChatbotEvent(firstEvent);
  const duplicate = await service.importChatbotEvent(firstEvent);
  const appended = await service.importChatbotEvent({
    provider: "partner-chatbot",
    conversationId: "conversation-123",
    messageId: "message-2",
    eventType: "message.created",
    message: "The rental was yesterday.",
  });

  assert.equal(created.created, true);
  assert.equal(created.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(appended.created, false);
  assert.equal(appended.ticketId, created.ticketId);
  assert.equal(store.tickets.size, 1);
  assert.equal(store.messages.size, 2);
  const storedTicket = store.tickets.get(created.ticketId);
  assert.equal(storedTicket.source, "chatbot");
  assert.equal(storedTicket.customer.name, "Camille Client");
  assert.equal(storedTicket.customer.email, "camille@example.com");
  assert.equal(storedTicket.replyChannel, "email");
  assert.equal(storedTicket.lastInboundChatbotMessageId, "message-2");
});

test("retried Disney chatbot submissions create one case and one activity entry", async () => {
  const store = createFakeChatbotStore();
  const service = createSupportTicketService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-27T14:32:00.000Z"),
  });
  const submission = {
    reason: "no_unit_dispensed",
    station_id: "S01",
    payment_method: "google_pay",
    card_last4: "9876",
    amount_requested: 5,
    guest_email: "guest@example.com",
    reason_detail: "Nothing came out",
    language: "en",
    session_id: "sess_1727385600000_retrytest",
    submitted_at: "2026-09-27T14:32:00.000Z",
    rental_date: "2026-09-27",
  };

  const created = await service.importChatbotEvent(submission);
  const duplicate = await service.importChatbotEvent(submission);

  assert.equal(created.created, true);
  assert.equal(created.duplicate, false);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.tickets.size, 1);
  assert.equal(store.messages.size, 1);
});

test("public submission rejects card data that is not exactly four digits", () => {
  assert.throws(() => normalizePublicSubmission({
    quoteId: "Q-test-invalid",
    lead: {
      requestType: "other",
      name: "Test Customer",
      email: "customer@example.com",
      cardLastFour: "4111111111111111",
    },
  }), /exactly the last four digits/);
});

test("ticket updates accept only supported workflow fields", () => {
  assert.deepEqual(normalizeTicketChanges({
    status: "in_progress",
    priority: "high",
    assignedTo: "george",
    unread: false,
  }), {
    status: "in_progress",
    priority: "high",
    assignedTo: "george",
    unread: false,
  });
  assert.throws(() => normalizeTicketChanges({status: "deleted"}), /Unsupported ticket status/);
  assert.throws(() => normalizeTicketChanges({customer: {email: "changed@example.com"}}), /No supported ticket changes/);
});

test("webhook secrets use exact constant-time-compatible comparison", () => {
  assert.equal(secretsMatch("same-secret", "same-secret"), true);
  assert.equal(secretsMatch("same-secret", "different-secret"), false);
  assert.equal(secretsMatch("", ""), false);
});

test("reply senders are restricted by inquiry category", () => {
  assert.deepEqual(resolveReplySender("customer_support", "support"), {
    key: "support",
    name: "Chargerent Customer Support",
    email: "support@charge.rent",
    categories: ["customer_support", "general"],
  });
  assert.equal(resolveReplySender("sales", "").key, "george");
  assert.equal(resolveReplySender("partnership", "arthur").email, "arthur@charge.rent");
  assert.throws(
      () => resolveReplySender("sales", "support"),
      /selected sender cannot reply to sales inquiries/i,
  );
  assert.throws(
      () => resolveReplySender("customer_support", "george"),
      /selected sender cannot reply to customer support inquiries/i,
  );
});

test("a confirmed email is recorded as sent and marks the case pending", async () => {
  const store = createFakeSupportStore({
    ticketNumber: "Q-test-123",
    category: "customer_support",
    customer: {email: "customer@example.com"},
  });
  const sent = [];
  const times = [
    new Date("2026-09-23T12:00:00.000Z"),
    new Date("2026-09-23T12:00:01.000Z"),
  ];
  const service = createSupportTicketService({
    db: store.db,
    admin: store.admin,
    clock: () => times.shift(),
    sendEmail: async (message) => {
      sent.push(message);
      return {messageId: "gmail-message-1", threadId: "gmail-thread-1"};
    },
  });

  const result = await service.sendReply({
    ticketId: "ticket-1",
    subject: "More information needed",
    body: "Please confirm the wallet last four.",
    senderKey: "support",
  }, {uid: "admin-1", profile: {username: "george"}});

  assert.equal(result.messageId, "gmail-message-1");
  assert.equal(sent.length, 1);
  assert.equal(store.directWrites[0].data.deliveryStatus, "sending");
  assert.match(store.directWrites[0].data.subject, /\[CS-TEST12\]/);
  assert.equal(store.committedBatches.length, 1);
  const sentActivity = store.committedBatches[0].find((write) => write.target === "message");
  const ticketUpdate = store.committedBatches[0].find((write) => write.target === "ticket");
  assert.equal(sentActivity.data.deliveryStatus, "sent");
  assert.equal(sentActivity.data.externalMessageId, "gmail-message-1");
  assert.equal(sentActivity.data.externalThreadId, "gmail-thread-1");
  assert.equal(ticketUpdate.data.status, "waiting_customer");
  assert.equal(ticketUpdate.data.gmailThreadId, "gmail-thread-1");
  assert.equal(ticketUpdate.data.lastReplyAtIso, "2026-09-23T12:00:01.000Z");
});

test("a rejected email remains visible as a failed activity without marking the case pending", async () => {
  const store = createFakeSupportStore({
    ticketNumber: "Q-test-123",
    category: "customer_support",
    customer: {email: "customer@example.com"},
  });
  const times = [
    new Date("2026-09-23T12:00:00.000Z"),
    new Date("2026-09-23T12:00:01.000Z"),
  ];
  const service = createSupportTicketService({
    db: store.db,
    admin: store.admin,
    clock: () => times.shift(),
    sendEmail: async () => {
      throw new Error("SMTP rejected");
    },
  });

  await assert.rejects(() => service.sendReply({
    ticketId: "ticket-1",
    subject: "More information needed",
    body: "Please confirm the wallet last four.",
    senderKey: "support",
  }, {uid: "admin-1", profile: {username: "george"}}), /SMTP rejected/);

  const failedActivity = store.committedBatches[0].find((write) => write.target === "message");
  const ticketUpdate = store.committedBatches[0].find((write) => write.target === "ticket");
  assert.equal(failedActivity.data.deliveryStatus, "failed");
  assert.equal(ticketUpdate.data.status, undefined);
  assert.equal(ticketUpdate.data.lastActivityAtIso, "2026-09-23T12:00:01.000Z");
});
