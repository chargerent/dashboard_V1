/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CALL_CONTENT_RETENTION_DAYS,
  callTicketId,
  createSupportTelephonyService,
  deliveryStatus,
  inboundMessagingChannel,
  normalizeE164,
  normalizeSupportNumbers,
  normalizeCustomerAddress,
  normalizeDeliveryMode,
  normalizeStaffInput,
  normalizeVoiceRoutingMode,
  phoneTicketId,
  splitRoutingStaff,
  staffSupportNumbers,
  supportLineForCall,
  voiceIdentityFor,
  WELCOME_AUTO_REPLY_BODY,
} = require("./supportTelephony");

function createFakeStore() {
  const deleteField = Symbol("delete-field");
  const tickets = new Map();
  const messages = new Map();
  const staff = new Map();
  const users = new Map();
  const config = new Map();
  const callLogs = new Map();
  const routes = new Map();
  let generatedMessageId = 0;

  const snapshot = (value) => ({exists: value !== undefined, data: () => value});
  const messageRef = (ticketId, id = `generated-${++generatedMessageId}`) => ({
    kind: "message",
    id,
    ticketId,
    async set(data, options = {}) {
      const key = `${ticketId}:${id}`;
      messages.set(key, options.merge ? {...messages.get(key), ...data} : data);
    },
  });
  const ticketRef = (id) => ({
    kind: "ticket",
    id,
    async get() {
      return snapshot(tickets.get(id));
    },
    collection(name) {
      assert.equal(name, "messages");
      return {doc: (messageId) => messageRef(id, messageId)};
    },
  });
  const staffRef = (id) => ({
    kind: "staff",
    id,
    async get() {
      return snapshot(staff.get(id));
    },
    async set(data, options = {}) {
      staff.set(id, options.merge ? {...staff.get(id), ...data} : data);
    },
  });
  const configRef = (id) => ({
    kind: "config",
    id,
    async get() {
      return snapshot(config.get(id));
    },
    async set(data, options = {}) {
      config.set(id, options.merge ? {...config.get(id), ...data} : data);
    },
  });
  const callLogRef = (id) => ({
    kind: "callLog",
    id,
    async get() {
      return snapshot(callLogs.get(id));
    },
    async set(data, options = {}) {
      callLogs.set(id, options.merge ? {...callLogs.get(id), ...data} : data);
    },
  });
  const routeRef = (id) => ({
    kind: "route",
    id,
    async get() {
      return snapshot(routes.get(id));
    },
    async set(data, options = {}) {
      routes.set(id, options.merge ? {...routes.get(id), ...data} : data);
    },
  });
  const valueFor = (ref) => {
    if (ref.kind === "ticket") return tickets.get(ref.id);
    if (ref.kind === "staff") return staff.get(ref.id);
    if (ref.kind === "config") return config.get(ref.id);
    if (ref.kind === "callLog") return callLogs.get(ref.id);
    if (ref.kind === "route") return routes.get(ref.id);
    return messages.get(`${ref.ticketId}:${ref.id}`);
  };
  const write = (operation, ref, data, options = {}) => {
    const current = valueFor(ref);
    const next = operation === "set" && !options.merge ? {...data} : {...current, ...data};
    for (const [key, value] of Object.entries(next)) {
      if (value === deleteField) delete next[key];
    }
    if (ref.kind === "ticket") tickets.set(ref.id, next);
    else if (ref.kind === "staff") staff.set(ref.id, next);
    else if (ref.kind === "config") config.set(ref.id, next);
    else if (ref.kind === "callLog") callLogs.set(ref.id, next);
    else if (ref.kind === "route") routes.set(ref.id, next);
    else messages.set(`${ref.ticketId}:${ref.id}`, next);
  };

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
                    const docs = [...tickets]
                        .sort((left, right) => String(right[1].lastActivityAtIso || "")
                            .localeCompare(String(left[1].lastActivityAtIso || "")))
                        .slice(0, resultLimit)
                        .map(([id, data]) => ({id, data: () => data}));
                    return {docs};
                  },
                };
              },
            };
          },
        };
      }
      if (name === "supportTelephonyStaff") {
        return {
          doc: staffRef,
          async get() {
            return {
              docs: [...staff].map(([id, data]) => ({id, data: () => data})),
            };
          },
        };
      }
      if (name === "users") {
        return {
          async get() {
            return {
              docs: [...users].map(([id, data]) => ({id, data: () => data})),
            };
          },
        };
      }
      if (name === "supportTelephonyConfig") return {doc: configRef};
      if (name === "supportCallLogs") {
        return {
          doc: callLogRef,
          where(field, operator, value) {
            assert.equal(operator, "<=");
            return {
              limit(resultLimit) {
                return {
                  async get() {
                    const docs = [...callLogs]
                        .filter(([, data]) => String(data[field] || "") <= String(value))
                        .filter(([, data]) => Boolean(data[field]))
                        .slice(0, resultLimit)
                        .map(([id, data]) => ({id, data: () => data}));
                    return {docs};
                  },
                };
              },
            };
          },
          orderBy(field, direction) {
            assert.equal(field, "createdAtIso");
            assert.equal(direction, "desc");
            return {
              limit(resultLimit) {
                return {
                  async get() {
                    const docs = [...callLogs]
                        .sort((left, right) => String(right[1].createdAtIso || "")
                            .localeCompare(String(left[1].createdAtIso || "")))
                        .slice(0, resultLimit)
                        .map(([id, data]) => ({id, data: () => data}));
                    return {docs};
                  },
                };
              },
            };
          },
        };
      }
      if (name === "supportCallRoutes") return {doc: routeRef};
      throw new Error(`Unexpected collection ${name}`);
    },
    async runTransaction(callback) {
      return callback({
        get: async (ref) => snapshot(valueFor(ref)),
        set: (ref, data, options) => write("set", ref, data, options),
        update: (ref, data) => write("update", ref, data),
      });
    },
    batch() {
      const pending = [];
      return {
        set: (ref, data, options) => pending.push(() => write("set", ref, data, options)),
        update: (ref, data) => pending.push(() => write("update", ref, data)),
        async commit() {
          pending.forEach((operation) => operation());
        },
      };
    },
  };
  const admin = {
    firestore: {FieldValue: {
      delete: () => deleteField,
      serverTimestamp: () => "server-time",
    }},
  };
  return {admin, callLogs, config, db, messages, routes, staff, tickets, users};
}

test("phone numbers are stored in E.164 form", () => {
  assert.equal(normalizeE164("(818) 996-0996"), "+18189960996");
  assert.equal(normalizeE164("+1 818 996 0996"), "+18189960996");
  assert.throws(() => normalizeE164("555-0100"), /country code/);
  assert.equal(normalizeCustomerAddress("rcs:+18189960996"), "+18189960996");
  assert.equal(inboundMessagingChannel({ChannelMetadata: JSON.stringify({type: "rcs"})}), "rcs");
});

test("staff routing supports primary and backup groups", () => {
  const normalized = normalizeStaffInput({
    name: "George",
    phone: "+1 818 996 0996",
    routingGroup: "primary",
    routingOrder: 1,
  });
  assert.deepEqual(normalized, {
    name: "George",
    phoneE164: "+18189960996",
    deliveryMode: "phone",
    userUid: "",
    twilioIdentity: "",
    routingGroup: "primary",
    routingOrder: 1,
    enabled: true,
  });

  const groups = splitRoutingStaff([
    {...normalized, id: "george"},
    {...normalized, id: "backup", name: "Backup", routingGroup: "backup"},
    {...normalized, id: "disabled", name: "Disabled", enabled: false},
  ]);
  assert.deepEqual(groups.primary.map((member) => member.id), ["george"]);
  assert.deepEqual(groups.backup.map((member) => member.id), ["backup"]);
});

test("staff support-number assignments normalize and preserve legacy fallback", () => {
  assert.deepEqual(
      normalizeSupportNumbers("+1 917 993 9355, +33 1 87 65 43 21"),
      ["+19179939355", "+33187654321"],
  );
  assert.deepEqual(
      staffSupportNumbers({supportNumbers: ["+1 917 993 9355"]}, "+16465550123"),
      ["+19179939355"],
  );
  assert.deepEqual(staffSupportNumbers({}, "+1 917 993 9355"), ["+19179939355"]);
  assert.deepEqual(staffSupportNumbers({supportNumbers: []}, "+1 917 993 9355"), []);
  assert.equal(supportLineForCall({
    direction: "inbound",
    from: "+18185550123",
    to: "+19179939355",
  }), "+19179939355");
  assert.equal(supportLineForCall({
    direction: "outbound",
    from: "+16465550123",
    to: "+18185550123",
  }), "+16465550123");
});

test("app routing requires an assigned user and only includes available identities", () => {
  assert.equal(normalizeDeliveryMode("APP"), "app");
  assert.equal(voiceIdentityFor("User-123"), "staff_user_123");
  assert.throws(() => normalizeStaffInput({name: "No user", deliveryMode: "app"}), /Choose a Chargerent user/);

  const george = normalizeStaffInput({
    name: "George",
    deliveryMode: "app",
    userUid: "User-123",
    routingGroup: "primary",
    routingOrder: 1,
  });
  assert.equal(george.phoneE164, "");
  assert.equal(george.twilioIdentity, "staff_user_123");

  const groups = splitRoutingStaff([
    {...george, id: "george", available: true},
    {...george, id: "offline", userUid: "User-456", twilioIdentity: "staff_user_456", available: false},
  ], {deliveryMode: "app", requireAvailable: true});
  assert.deepEqual(groups.primary.map((member) => member.id), ["george"]);
});

test("active admin and partner dashboard accounts are automatic app staff", async () => {
  const store = createFakeStore();
  store.users.set("admin-1", {
    username: "george",
    role: "admin",
    active: true,
    contact: {name: "George"},
  });
  store.users.set("partner-1", {
    username: "venue",
    role: "partner",
    active: true,
    supportPhoneNumbers: ["+1 917 993 9355"],
  });
  store.users.set("user-1", {
    username: "client",
    role: "user",
    active: true,
  });
  const service = createSupportTelephonyService({db: store.db, admin: store.admin});

  const staff = await service.listRoutingStaff();
  const adminMember = staff.find((member) => member.userUid === "admin-1");
  const partnerMember = staff.find((member) => member.userUid === "partner-1");
  assert.equal(adminMember.allSupportNumbers, true);
  assert.equal(adminMember.deliveryMode, "app");
  assert.deepEqual(partnerMember.supportNumbers, ["+19179939355"]);
  assert.equal(staff.some((member) => member.userUid === "user-1"), false);
  assert.equal((await service.voiceStaffForUser("partner-1")).twilioIdentity, "staff_partner_1");

  await service.setVoiceAvailability(true, {
    uid: "partner-1",
    profile: {username: "venue", role: "partner"},
  });
  assert.equal(store.staff.get("USER-partner-1").available, true);
});

test("profile subscriptions override a legacy partner staff line", async () => {
  const store = createFakeStore();
  store.users.set("partner-1", {
    username: "venue",
    role: "partner",
    supportPhoneNumbers: ["+33 1 87 65 43 21"],
  });
  store.staff.set("legacy-partner", {
    name: "Venue",
    deliveryMode: "app",
    userUid: "partner-1",
    twilioIdentity: "old-identity",
    supportNumbers: ["+19179939355"],
    routingGroup: "backup",
    routingOrder: 3,
    available: true,
  });
  const service = createSupportTelephonyService({db: store.db, admin: store.admin});
  const member = await service.voiceStaffForUser("partner-1");

  assert.equal(member.id, "legacy-partner");
  assert.equal(member.twilioIdentity, "staff_partner_1");
  assert.deepEqual(member.supportNumbers, ["+33187654321"]);
  assert.equal(member.routingGroup, "backup");
  assert.equal(member.available, true);
});

test("routing staff can be added, edited, disabled, and protected from duplicates", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({db: store.db, admin: store.admin});
  const authState = {uid: "admin-1", profile: {username: "george"}};
  const created = await service.upsertRoutingStaff({
    name: "George",
    phoneE164: "+1 818 996 0996",
    routingGroup: "primary",
    routingOrder: 1,
  }, authState);

  assert.equal(store.staff.get(created.staffId).phoneE164, "+18189960996");
  assert.equal(store.staff.get(created.staffId).createdBy, "george");

  await service.upsertRoutingStaff({
    staffId: created.staffId,
    name: "George",
    phoneE164: "+1 818 996 0996",
    routingGroup: "backup",
    routingOrder: 2,
    enabled: false,
  }, authState);
  assert.equal(store.staff.get(created.staffId).routingGroup, "backup");
  assert.equal(store.staff.get(created.staffId).enabled, false);

  await assert.rejects(() => service.upsertRoutingStaff({
    name: "Duplicate",
    phoneE164: "+18189960996",
    routingGroup: "primary",
    routingOrder: 1,
  }, authState), /already assigned/);
});

test("Twilio delivery states map to dashboard states", () => {
  assert.equal(deliveryStatus("queued"), "sending");
  assert.equal(deliveryStatus("sent"), "sent");
  assert.equal(deliveryStatus("delivered"), "delivered");
  assert.equal(deliveryStatus("undelivered"), "failed");
});

test("voice routing mode defaults to phone and can be switched by an admin", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({db: store.db, admin: store.admin});
  const authState = {uid: "admin-1", profile: {username: "george"}};

  assert.equal(await service.voiceRoutingMode(), "phone");
  assert.equal(normalizeVoiceRoutingMode("APP"), "app");
  await assert.rejects(() => service.setVoiceRoutingMode("invalid", authState), /Choose app or phone/);

  const result = await service.setVoiceRoutingMode("app", authState);
  assert.deepEqual(result, {ok: true, routingMode: "app"});
  assert.equal(await service.voiceRoutingMode(), "app");
  assert.equal(store.config.get("voice").updatedBy, "george");
});

test("inbound SMS creates one phone conversation and deduplicates retries", async () => {
  const store = createFakeStore();
  const sent = [];
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T01:00:00.000Z"),
    sendMessage: async (message) => {
      sent.push(message);
      return {sid: "SM-welcome-1", status: "queued"};
    },
  });
  const payload = {
    MessageSid: "SM-test-1",
    From: "+18185550123",
    To: "+19179939355",
    Body: "I need help with a rental.",
    NumMedia: "0",
  };

  const first = await service.importInboundSms(payload);
  const retry = await service.importInboundSms(payload);

  assert.equal(first.ticketId, phoneTicketId(payload.From, payload.To));
  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(store.tickets.size, 1);
  assert.equal(store.messages.size, 2);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    from: "+19179939355",
    to: "+18185550123",
    body: WELCOME_AUTO_REPLY_BODY,
  });
  const ticket = store.tickets.get(first.ticketId);
  assert.equal(ticket.source, "sms");
  assert.equal(ticket.status, "in_progress");
  assert.equal(ticket.welcomeAutoReplyStatus, "sent");
  assert.equal(ticket.customer.phoneE164, "+18185550123");
  assert.equal(ticket.replyChannel, "sms");
});

test("the same customer has separate text cases on different support lines", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({db: store.db, admin: store.admin});
  const us = await service.importInboundSms({
    MessageSid: "SM-us",
    From: "+18185550123",
    To: "+19179939355",
    Body: "US line",
  });
  const france = await service.importInboundSms({
    MessageSid: "SM-fr",
    From: "+18185550123",
    To: "+33187654321",
    Body: "France line",
  });

  assert.notEqual(us.ticketId, france.ticketId);
  assert.equal(store.tickets.get(us.ticketId).details.twilioSupportAddress, "+19179939355");
  assert.equal(store.tickets.get(france.ticketId).details.twilioSupportAddress, "+33187654321");
});

test("staff can resolve only cases assigned to their support numbers", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T02:00:00.000Z"),
  });
  const inbound = await service.importInboundSms({
    MessageSid: "SM-resolve-1",
    From: "+18185550123",
    To: "+19179939355",
    Body: "Please help",
  });

  const resolved = await service.resolveCase({ticketId: inbound.ticketId}, {
    uid: "staff-1",
    profile: {username: "george"},
  }, {supportNumbers: ["+19179939355"]});

  assert.equal(resolved.ok, true);
  assert.equal(resolved.ticket.status, "resolved");
  assert.equal(store.tickets.get(inbound.ticketId).unread, false);
  assert.equal(store.tickets.get(inbound.ticketId).resolvedBy, "george");
  await assert.rejects(() => service.resolveCase({ticketId: inbound.ticketId}, {}, {
    supportNumbers: ["+33187654321"],
  }), /not assigned/);
});

test("each inbound call creates its own case without requiring voicemail", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T01:00:00.000Z"),
  });
  const imported = await service.importInboundCall({
    CallSid: "CA-test-1",
    CallStatus: "ringing",
    From: "+18185550123",
    To: "+19179939355",
  });
  const secondCall = await service.importInboundCall({
    CallSid: "CA-test-2",
    CallStatus: "ringing",
    From: "+18185550123",
    To: "+19179939355",
  });

  assert.equal(imported.ticketId, callTicketId("CA-test-1"));
  assert.equal(secondCall.ticketId, callTicketId("CA-test-2"));
  assert.notEqual(imported.ticketId, secondCall.ticketId);
  assert.equal(store.tickets.size, 2);
  assert.equal(store.tickets.get(imported.ticketId).source, "phone");
  assert.equal(store.tickets.get(imported.ticketId).needsCaseMatch, true);
  const callMessage = store.messages.get(`${imported.ticketId}:${imported.messageId}`);
  assert.equal(callMessage.type, "call");
  assert.equal(callMessage.disposition, "ringing");
  assert.equal(callMessage.recordingSid, undefined);
  const firstCallLog = [...store.callLogs.values()].find((entry) => entry.ticketId === imported.ticketId);
  assert.equal(firstCallLog.disposition, "ringing");
  assert.equal(firstCallLog.recordingSid, undefined);
});

test("answering an inbound call assigns and opens its fresh case", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T01:00:00.000Z"),
  });
  const imported = await service.importInboundCall({
    CallSid: "CA-answered-1",
    CallStatus: "ringing",
    From: "+18185550123",
    To: "+19179939355",
  });

  await service.updateCall({
    ticketId: imported.ticketId,
    callSid: "CA-answered-1",
    disposition: "answered",
    acceptedByName: "George",
  });

  const ticket = store.tickets.get(imported.ticketId);
  assert.equal(ticket.status, "in_progress");
  assert.equal(ticket.unread, false);
  assert.equal(ticket.assignedTo, "George");
  assert.equal(ticket.needsCaseMatch, true);
});

test("unanswered callers can create a high-priority callback case at their caller ID", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T01:00:00.000Z"),
  });
  const imported = await service.importInboundCall({
    CallSid: "CA-callback-1",
    CallStatus: "ringing",
    From: "+18185550123",
    To: "+19179939355",
  });

  await service.updateCall({
    ticketId: imported.ticketId,
    callSid: "CA-callback-1",
    disposition: "unanswered",
  });
  const result = await service.requestCallback({
    ticketId: imported.ticketId,
    callSid: "CA-callback-1",
  });

  const ticket = store.tickets.get(imported.ticketId);
  const callMessage = [...store.messages.values()][0];
  const callLog = [...store.callLogs.values()][0];
  assert.equal(result.callbackPhone, "+18185550123");
  assert.equal(ticket.requestType, "callback");
  assert.equal(ticket.callback.status, "requested");
  assert.equal(ticket.status, "new");
  assert.equal(ticket.priority, "high");
  assert.equal(ticket.unread, true);
  assert.equal(callMessage.disposition, "callback_requested");
  assert.equal(callLog.callbackRequested, true);
});

test("outbound app calls create a linked customer call-log entry", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T01:00:00.000Z"),
  });

  const result = await service.importOutboundCall({
    callSid: "CA-outbound-1",
    from: "+19179939355",
    to: "+18189960996",
    staffId: "STAFF-george-app",
    staffName: "George",
    staffIdentity: "staff_george",
  });
  await service.updateCall({
    ticketId: result.ticketId,
    callSid: "CA-outbound-1",
    disposition: "answered",
    dialCallDuration: "42",
  });

  const ticket = store.tickets.get(result.ticketId);
  const callMessage = [...store.messages.values()][0];
  const callLog = [...store.callLogs.values()][0];
  assert.equal(ticket.status, "in_progress");
  assert.equal(callMessage.direction, "outbound");
  assert.equal(callLog.direction, "outbound");
  assert.equal(callLog.staffName, "George");
  assert.equal(callLog.disposition, "answered");
  assert.equal(callLog.dialCallDuration, "42");
});

test("mobile call log returns canonical calls newest first with safe fields", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({db: store.db, admin: store.admin});
  store.callLogs.set("older", {
    callSid: "CA-secret-provider-id",
    ticketId: "PHONE-older",
    direction: "inbound",
    from: "+18185550123",
    to: "+19179939355",
    disposition: "callback_requested",
    callbackRequested: true,
    callbackPhone: "+18185550123",
    createdAtIso: "2026-09-28T01:00:00.000Z",
  });
  store.callLogs.set("newer", {
    ticketId: "PHONE-newer",
    direction: "outbound",
    from: "+19179939355",
    to: "+18189960996",
    disposition: "answered",
    dialCallDuration: "42",
    recordingSid: "RE-private-recording-id",
    recordingStatus: "completed",
    transcriptStatus: "ready",
    transcriptText: "Agent: Hello\nCustomer: I need help",
    transcriptSegmentCount: 2,
    staffName: "George",
    createdAtIso: "2026-09-28T02:00:00.000Z",
    internalOnly: "not returned",
  });
  store.callLogs.set("other-line-newest", {
    ticketId: "PHONE-other-line",
    direction: "inbound",
    from: "+18185550999",
    to: "+16465550123",
    disposition: "answered",
    createdAtIso: "2026-09-28T03:00:00.000Z",
  });

  const calls = await service.listCallLogs(1, ["+19179939355"]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "newer");
  assert.equal(calls[0].to, "+18189960996");
  assert.equal(calls[0].dialCallDuration, "42");
  assert.equal(calls[0].hasRecording, true);
  assert.equal(calls[0].recordingStatus, "completed");
  assert.equal(calls[0].transcriptStatus, "ready");
  assert.match(calls[0].transcriptPreview, /Customer: I need help/);
  assert.equal(calls[0].transcriptSegmentCount, 2);
  assert.equal(calls[0].recordingSid, undefined);
  assert.equal(calls[0].internalOnly, undefined);
  assert.equal(calls[0].callSid, undefined);
});

test("final speaker-labelled transcription is attached to the call case and deduplicated", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T02:30:00.000Z"),
  });
  const imported = await service.importInboundCall({
    CallSid: "CA-transcript-1",
    CallStatus: "ringing",
    From: "+18185550123",
    To: "+19179939355",
  });

  await service.recordTranscriptionEvent({
    ticketId: imported.ticketId,
    callSid: "CA-transcript-1",
    TranscriptionEvent: "transcription-started",
    TranscriptionSid: "GT-transcript-1",
  });
  const customerSegment = {
    ticketId: imported.ticketId,
    callSid: "CA-transcript-1",
    TranscriptionEvent: "transcription-content",
    TranscriptionSid: "GT-transcript-1",
    Track: "outbound_track",
    SequenceId: "2",
    Timestamp: "2.5",
    Final: "true",
    TranscriptionData: JSON.stringify({transcript: "My charger did not release.", confidence: 0.96}),
  };
  await service.recordTranscriptionEvent(customerSegment);
  await service.recordTranscriptionEvent(customerSegment);
  await service.recordTranscriptionEvent({
    ticketId: imported.ticketId,
    callSid: "CA-transcript-1",
    TranscriptionEvent: "transcription-content",
    TranscriptionSid: "GT-transcript-1",
    Track: "inbound_track",
    SequenceId: "1",
    Timestamp: "1.0",
    Final: true,
    TranscriptionData: JSON.stringify({transcript: "Chargerent support, how can I help?"}),
  });
  await service.recordTranscriptionEvent({
    ticketId: imported.ticketId,
    callSid: "CA-transcript-1",
    TranscriptionEvent: "transcription-stopped",
    TranscriptionSid: "GT-transcript-1",
  });

  const callLog = [...store.callLogs.values()][0];
  const callMessage = store.messages.get(`${imported.ticketId}:${imported.messageId}`);
  assert.equal(callLog.transcriptStatus, "ready");
  assert.equal(callLog.transcriptSegmentCount, 2);
  assert.equal(callMessage.transcriptStatus, "ready");
  assert.equal(callMessage.transcriptSegments[0].speaker, "Agent");
  assert.equal(callMessage.transcriptSegments[1].speaker, "Customer");
  assert.match(callMessage.transcriptText, /^Agent: Chargerent support/m);
  assert.match(callMessage.transcriptText, /Customer: My charger did not release\./);
});

test("recordings and transcripts expire after 30 days across every linked case", async () => {
  const store = createFakeStore();
  let now = new Date("2026-01-01T12:00:00.000Z");
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => now,
  });
  const imported = await service.importInboundCall({
    CallSid: "CA-retention-1",
    CallStatus: "ringing",
    From: "+18185550123",
    To: "+19179939355",
  });
  await service.updateCall({
    ticketId: imported.ticketId,
    callSid: "CA-retention-1",
    recordingSid: "RE-retention-1",
    recordingUrl: "https://api.twilio.test/recording-retention-1",
    recordingStatus: "completed",
  });
  await service.recordTranscriptionEvent({
    ticketId: imported.ticketId,
    callSid: "CA-retention-1",
    TranscriptionEvent: "transcription-content",
    TranscriptionSid: "GT-retention-1",
    Track: "outbound_track",
    SequenceId: "1",
    Final: "true",
    TranscriptionData: JSON.stringify({transcript: "Please help with my rental."}),
  });
  const callLogId = [...store.callLogs.keys()][0];
  const initialLog = store.callLogs.get(callLogId);
  assert.equal(CALL_CONTENT_RETENTION_DAYS, 30);
  assert.equal(initialLog.sensitiveContentExpiresAtIso, "2026-01-31T12:00:00.000Z");

  store.tickets.set("CS-RETENTION", {
    ticketNumber: "CS-RETENTION",
    status: "in_progress",
    customer: {phoneE164: "+18185550123"},
  });
  await service.linkCallToCase({
    callLogId,
    ticketId: "CS-RETENTION",
    action: "link",
  }, {uid: "admin-1", profile: {username: "george"}});

  now = new Date("2026-02-01T12:00:00.000Z");
  const deletedRecordings = [];
  const summary = await service.purgeExpiredCallContent({
    deleteRecording: async (recordingSid) => deletedRecordings.push(recordingSid),
  });

  assert.deepEqual(summary, {checked: 1, purged: 1, retrying: 0});
  assert.deepEqual(deletedRecordings, ["RE-retention-1"]);
  const purgedLog = store.callLogs.get(callLogId);
  assert.equal(purgedLog.recordingSid, undefined);
  assert.equal(purgedLog.recordingUrl, undefined);
  assert.equal(purgedLog.transcriptText, undefined);
  assert.equal(purgedLog.transcriptSegments, undefined);
  assert.equal(purgedLog.recordingStatus, "purged");
  assert.equal(purgedLog.transcriptStatus, "purged");
  assert.equal(purgedLog.sensitiveContentExpiresAtIso, undefined);
  assert.equal(store.tickets.has(imported.ticketId), true);
  assert.equal(store.tickets.has("CS-RETENTION"), true);
  const caseMessages = [...store.messages.entries()]
      .filter(([key]) => key.startsWith(`${imported.ticketId}:`) || key.startsWith("CS-RETENTION:"))
      .map(([, message]) => message);
  assert.equal(caseMessages.length, 2);
  assert.equal(caseMessages.every((message) => message.recordingSid === undefined), true);
  assert.equal(caseMessages.every((message) => message.transcriptText === undefined), true);
});

test("a failed Twilio deletion purges the transcript and retries the recording later", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-02-01T12:00:00.000Z"),
  });
  const imported = await service.importInboundCall({
    CallSid: "CA-retention-retry",
    CallStatus: "ringing",
    From: "+18185550123",
    To: "+19179939355",
  });
  const callLogId = [...store.callLogs.keys()][0];
  store.callLogs.set(callLogId, {
    ...store.callLogs.get(callLogId),
    recordingSid: "RE-retention-retry",
    recordingUrl: "https://api.twilio.test/recording-retention-retry",
    transcriptText: "Customer: Sensitive call text.",
    transcriptSegments: [{id: "1", speaker: "Customer", text: "Sensitive call text."}],
    sensitiveContentExpiresAtIso: "2026-01-31T12:00:00.000Z",
  });
  const originalMessage = store.messages.get(`${imported.ticketId}:${imported.messageId}`);
  store.messages.set(`${imported.ticketId}:${imported.messageId}`, {
    ...originalMessage,
    recordingSid: "RE-retention-retry",
    transcriptText: "Customer: Sensitive call text.",
  });

  const summary = await service.purgeExpiredCallContent({
    deleteRecording: async () => {
      throw new Error("temporary Twilio failure");
    },
  });

  assert.deepEqual(summary, {checked: 1, purged: 0, retrying: 1});
  const callLog = store.callLogs.get(callLogId);
  assert.equal(callLog.recordingSid, "RE-retention-retry");
  assert.equal(callLog.transcriptText, undefined);
  assert.equal(callLog.transcriptStatus, "purged");
  assert.match(callLog.recordingPurgeError, /temporary Twilio failure/);
  assert.equal(callLog.sensitiveContentExpiresAtIso, "2026-01-31T12:00:00.000Z");
});

test("server-side call routing advances to backup and only lets one agent claim the caller", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T01:00:00.000Z"),
  });
  const primary = {
    id: "primary-1",
    name: "Primary",
    twilioIdentity: "staff_primary",
    routingGroup: "primary",
  };
  const backup = {
    id: "backup-1",
    name: "Backup",
    twilioIdentity: "staff_backup",
    routingGroup: "backup",
  };
  await service.beginCallRouting({
    ticketId: "PHONE-test",
    callSid: "CA-route-1",
    queueName: "support-CA-route-1",
    routingMode: "app",
    customerPhone: "+18185550123",
    supportNumber: "+19179939355",
    primary: [primary],
    backup: [backup],
  });

  const primaryStart = await service.startRoutingGroup({
    callSid: "CA-route-1",
    group: "primary",
  });
  assert.equal(primaryStart.start, true);
  assert.equal(primaryStart.customerPhone, "+18185550123");
  assert.equal(primaryStart.supportNumber, "+19179939355");
  await service.recordRoutingAttempt({
    callSid: "CA-route-1",
    group: "primary",
    staffId: primary.id,
    agentCallSid: "CA-agent-primary",
    status: "initiated",
  });
  const failedPrimary = await service.recordRoutingAttempt({
    callSid: "CA-route-1",
    group: "primary",
    staffId: primary.id,
    agentCallSid: "CA-agent-primary",
    status: "no-answer",
  });
  assert.equal(failedPrimary.nextGroup, "backup");

  const backupStart = await service.startRoutingGroup({
    callSid: "CA-route-1",
    group: "backup",
  });
  assert.equal(backupStart.start, true);
  await service.recordRoutingAttempt({
    callSid: "CA-route-1",
    group: "backup",
    staffId: backup.id,
    agentCallSid: "CA-agent-backup",
    status: "ringing",
  });
  const firstClaim = await service.claimCallRouting({
    callSid: "CA-route-1",
    staffId: backup.id,
    agentCallSid: "CA-agent-backup",
  });
  const secondClaim = await service.claimCallRouting({
    callSid: "CA-route-1",
    staffId: primary.id,
    agentCallSid: "CA-agent-primary",
  });
  assert.equal(firstClaim.won, true);
  assert.equal(firstClaim.queueName, "support-CA-route-1");
  assert.equal(secondClaim.won, false);
});

test("mobile cases include only call cases for assigned support numbers", async () => {
  const store = createFakeStore();
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T03:00:00.000Z"),
  });
  const imported = await service.importInboundCall({
    CallSid: "CA-case-1",
    CallStatus: "ringing",
    From: "+18185550123",
    To: "+19179939355",
  });
  store.tickets.set("CS-EXISTING", {
    ticketNumber: "CS-EXISTING",
    displayTicketNumber: "CS-EXISTING",
    subject: "Existing rental issue",
    status: "in_progress",
    priority: "high",
    source: "email",
    category: "customer_support",
    customer: {name: "Guest", phoneE164: "+18185550123"},
    message: "Guest needs help.",
    createdAtIso: "2026-09-28T02:00:00.000Z",
    lastActivityAtIso: "2026-09-28T02:30:00.000Z",
  });
  const otherLine = await service.importInboundCall({
    CallSid: "CA-case-other-line",
    CallStatus: "ringing",
    From: "+18185550999",
    To: "+16465550123",
  });
  const cases = await service.listActiveCases(10, ["+19179939355"]);
  assert.equal(cases.some((ticket) => ticket.id === imported.ticketId), true);
  assert.equal(cases.some((ticket) => ticket.id === "CS-EXISTING"), false);
  assert.equal(cases.some((ticket) => ticket.id === otherLine.ticketId), false);
  await assert.rejects(
      () => service.assertCaseAccess(otherLine.ticketId, ["+19179939355"]),
      /not assigned to one of your support numbers/,
  );

  await service.updateCall({
    ticketId: imported.ticketId,
    callSid: "CA-case-1",
    recordingSid: "RE-case-1",
    recordingStatus: "completed",
  });
  await service.recordTranscriptionEvent({
    ticketId: imported.ticketId,
    callSid: "CA-case-1",
    TranscriptionEvent: "transcription-content",
    TranscriptionSid: "GT-case-1",
    Track: "inbound_track",
    SequenceId: "1",
    Final: "true",
    TranscriptionData: JSON.stringify({transcript: "Let me look up your rental."}),
  });

  const callLogId = [...store.callLogs.keys()][0];
  const linked = await service.linkCallToCase({
    callLogId,
    ticketId: "CS-EXISTING",
    action: "link",
  }, {uid: "admin-1", profile: {username: "george"}});
  assert.equal(linked.ticket.id, "CS-EXISTING");
  assert.equal(store.callLogs.get(callLogId).ticketId, "CS-EXISTING");
  assert.deepEqual(store.tickets.get("CS-EXISTING").callSupportLines, ["+19179939355"]);
  assert.equal([...store.messages.keys()].some((key) => key.startsWith("CS-EXISTING:")), true);
  assert.equal(
      (await service.listActiveCases(10, ["+19179939355"]))
          .some((ticket) => ticket.id === "CS-EXISTING"),
      true,
  );

  await service.updateCall({
    ticketId: imported.ticketId,
    callSid: "CA-case-1",
    recordingDuration: "33",
  });
  await service.recordTranscriptionEvent({
    ticketId: imported.ticketId,
    callSid: "CA-case-1",
    TranscriptionEvent: "transcription-content",
    TranscriptionSid: "GT-case-1",
    Track: "outbound_track",
    SequenceId: "2",
    Final: "true",
    TranscriptionData: JSON.stringify({transcript: "It was station CA8008."}),
  });
  await service.recordTranscriptionEvent({
    ticketId: imported.ticketId,
    callSid: "CA-case-1",
    TranscriptionEvent: "transcription-stopped",
    TranscriptionSid: "GT-case-1",
  });
  const linkedMessage = [...store.messages.entries()]
      .find(([key]) => key.startsWith("CS-EXISTING:"))[1];
  assert.equal(linkedMessage.recordingSid, "RE-case-1");
  assert.equal(linkedMessage.recordingDuration, "33");
  assert.equal(linkedMessage.transcriptStatus, "ready");
  assert.match(linkedMessage.transcriptText, /Agent: Let me look up your rental\./);
  assert.match(linkedMessage.transcriptText, /Customer: It was station CA8008\./);
  const casesWithTranscript = await service.listActiveCases(10, ["+19179939355"]);
  const linkedCase = casesWithTranscript.find((ticket) => ticket.id === "CS-EXISTING");
  assert.equal(linkedCase.callTranscript.status, "ready");
  assert.equal(linkedCase.callTranscript.segmentCount, 2);
  assert.match(linkedCase.callTranscript.text, /Agent: Let me look up your rental\./);
  assert.match(linkedCase.callTranscript.text, /Customer: It was station CA8008\./);
  assert.match(linkedCase.callTranscript.contentExpiresAtIso, /^2026-/);
});

test("outbound SMS records the reviewed reply and callback identity", async () => {
  const store = createFakeStore();
  const sent = [];
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    clock: () => new Date("2026-09-28T01:00:00.000Z"),
    sendMessage: async (message) => {
      sent.push(message);
      return {sid: "SM-outbound-1", status: "queued"};
    },
  });
  const inbound = await service.importInboundSms({
    MessageSid: "SM-inbound-1",
    From: "+18185550123",
    To: "+19179939355",
    Body: "Hello",
  });

  const result = await service.sendSmsReply({
    ticketId: inbound.ticketId,
    body: "How can we help?",
  }, {uid: "admin-1", profile: {username: "george"}}, {
    fromNumber: "+19179939355",
    statusCallbackUrl: ({ticketId, messageDocId}) =>
      `https://example.test/sms?ticketId=${ticketId}&messageDocId=${messageDocId}`,
  });

  assert.equal(result.messageId, "SM-outbound-1");
  assert.equal(sent.length, 2);
  assert.equal(sent[1].from, "+19179939355");
  assert.equal(sent[1].to, "+18185550123");
  assert.match(sent[1].statusCallback, /messageDocId=generated-/);
  assert.equal(store.tickets.get(inbound.ticketId).status, "in_progress");
  await assert.rejects(() => service.sendSmsReply({
    ticketId: inbound.ticketId,
    body: "x".repeat(1601),
  }, {}, {fromNumber: "+19179939355"}), /1600 characters or fewer/);
});

test("RCS rich replies use a Messaging Service and Content template with SMS fallback", async () => {
  const store = createFakeStore();
  const sent = [];
  const service = createSupportTelephonyService({
    db: store.db,
    admin: store.admin,
    sendMessage: async (message) => {
      sent.push(message);
      return {sid: "SM-rcs-1", status: "queued"};
    },
  });
  const inbound = await service.importInboundSms({
    MessageSid: "SM-inbound-rcs",
    From: "rcs:+18185550123",
    To: "rcs:chargerent_support",
    Body: "Rental help",
    ButtonText: "Rental help",
    ButtonPayload: "rental_help",
    ChannelMetadata: JSON.stringify({type: "rcs"}),
  });

  await service.sendSmsReply({
    ticketId: inbound.ticketId,
    body: "How can we help?",
    templateId: "support-actions",
  }, {uid: "admin-1"}, {
    fromNumber: "+19179939355",
    messagingServiceSid: `MG${"a".repeat(32)}`,
    richTemplate: {id: "support-actions", contentSid: `HX${"b".repeat(32)}`},
  });

  assert.equal(store.tickets.get(inbound.ticketId).source, "rcs");
  assert.equal(sent[0].from, undefined);
  assert.match(sent[0].messagingServiceSid, /^MG/);
  assert.equal(sent[0].fallbackFrom, "+19179939355");
  assert.match(sent[0].contentSid, /^HX/);
  assert.deepEqual(JSON.parse(sent[0].contentVariables), {"1": "How can we help?"});
  assert.equal(sent[0].body, undefined);
  assert.equal(deliveryStatus("read"), "read");
});
