/* eslint-env node */
const crypto = require("node:crypto");
const {supportTicketDisplayNumber} = require("./supportTickets");

const ROUTING_GROUPS = new Set(["primary", "backup"]);
const DELIVERY_MODES = new Set(["phone", "app"]);
const TERMINAL_TICKET_STATUSES = new Set(["resolved", "closed"]);
const MAX_SMS_BODY_LENGTH = 1600;
const WELCOME_AUTO_REPLY_VERSION = "v1";
const WELCOME_AUTO_REPLY_MESSAGE_ID = "automatic-welcome-v1";
const WELCOME_AUTO_REPLY_BODY = [
  "Thank you for contacting Chargerent, how can I help you?",
  "",
  "For return locations please visit: https://charge.rent/en/station-finder.",
].join("\n");
const VOICE_ROUTING_MODES = new Set(["app", "phone"]);
const ROUTING_TERMINAL_STATUSES = new Set([
  "busy", "canceled", "completed", "failed", "no-answer",
]);
const ACTIVE_TICKET_STATUSES = new Set(["new", "in_progress", "waiting_customer"]);
const ROUTING_MAX_WAIT_MS = 45000;
const MAX_TRANSCRIPT_SEGMENTS = 400;
const MAX_TRANSCRIPT_SEGMENT_LENGTH = 500;
const MAX_TRANSCRIPT_TEXT_LENGTH = 200000;
const CALL_CONTENT_RETENTION_DAYS = 30;
const CALL_CONTENT_RETENTION_MS = CALL_CONTENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function cleanText(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseTranscriptionData(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(cleanText(value, 12000) || "{}");
  } catch {
    return {};
  }
}

function transcriptionSpeaker(track) {
  const normalized = cleanText(track, 40).toLowerCase();
  if (normalized.includes("inbound")) return "Agent";
  if (normalized.includes("outbound")) return "Customer";
  return "Speaker";
}

function transcriptTextFor(segments = []) {
  return segments.map((segment) => `${segment.speaker}: ${segment.text}`)
      .join("\n")
      .slice(0, MAX_TRANSCRIPT_TEXT_LENGTH);
}

function contentExpiryIso(now) {
  return new Date(now.getTime() + CALL_CONTENT_RETENTION_MS).toISOString();
}

function normalizeE164(value, {allowEmpty = false} = {}) {
  const raw = cleanText(value, 80);
  if (!raw && allowEmpty) return "";
  let digits = raw.replace(/[^0-9]/g, "");
  if (!raw.startsWith("+") && digits.length === 10) digits = `1${digits}`;
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Enter a phone number with a country code, such as +18185550123.");
  }
  return `+${digits}`;
}

function normalizeSupportNumbers(value, {allowEmpty = true} = {}) {
  const entries = Array.isArray(value) ? value :
    (typeof value === "string" ? value.split(/[\n,;]+/) : []);
  const numbers = [...new Set(entries
      .map((entry) => cleanText(entry, 80))
      .filter(Boolean)
      .map((entry) => normalizeE164(entry)))];
  if (!allowEmpty && !numbers.length) {
    throw new Error("Assign at least one incoming support number.");
  }
  return numbers;
}

function staffSupportNumbers(member = {}, fallbackNumber = "") {
  const hasExplicitAssignment = Object.prototype.hasOwnProperty.call(member, "supportNumbers") ||
    Object.prototype.hasOwnProperty.call(member, "supportNumber");
  if (hasExplicitAssignment) {
    return normalizeSupportNumbers(member.supportNumbers ?? member.supportNumber);
  }
  return normalizeSupportNumbers(fallbackNumber);
}

function supportProfileRole(profile = {}) {
  const username = cleanText(profile.username, 160).toLowerCase();
  const role = cleanText(profile.role, 40).toLowerCase();
  if (username === "chargerent" || role === "admin") return "admin";
  if (role === "partner" || profile.partner === true) return "partner";
  return role || "user";
}

function isSupportAppProfile(profile = {}) {
  const role = supportProfileRole(profile);
  return profile.active !== false && (role === "admin" || role === "partner");
}

function profileSupportNumbers(profile = {}) {
  const nestedSupport = profile.support && typeof profile.support === "object" ?
    profile.support : {};
  return normalizeSupportNumbers(
      profile.supportPhoneNumbers ?? nestedSupport.phoneNumbers ?? nestedSupport.supportNumbers,
  );
}

function automaticStaffId(uid) {
  return `USER-${cleanDocumentId(uid, "User")}`;
}

function automaticRoutingStaff(uid, profile = {}, existing = null) {
  const role = supportProfileRole(profile);
  const profileNumbers = profileSupportNumbers(profile);
  const hasProfileNumbers = Object.prototype.hasOwnProperty.call(profile, "supportPhoneNumbers") ||
    Object.prototype.hasOwnProperty.call(profile.support || {}, "phoneNumbers") ||
    Object.prototype.hasOwnProperty.call(profile.support || {}, "supportNumbers");
  const existingNumbers = existing ? staffSupportNumbers(existing, "") : [];
  const supportNumbers = role === "admin" ? existingNumbers :
    (hasProfileNumbers ? profileNumbers : existingNumbers);
  return {
    ...(existing || {}),
    id: existing?.id || automaticStaffId(uid),
    name: cleanText(
        profile.displayName || profile.name || profile.contact?.name ||
        profile.username || existing?.name || "Support staff",
        100,
    ),
    deliveryMode: "app",
    userUid: uid,
    twilioIdentity: voiceIdentityFor(uid),
    routingGroup: existing?.routingGroup === "backup" ? "backup" : "primary",
    routingOrder: Number(existing?.routingOrder) || 1,
    enabled: existing?.enabled !== false,
    available: existing?.available === true,
    accountRole: role,
    allSupportNumbers: role === "admin",
    ...(role !== "admin" || Object.prototype.hasOwnProperty.call(existing || {}, "supportNumbers") ?
      {supportNumbers} : {}),
  };
}

function memberCanReceiveSupportNumber(member = {}, supportNumber = "", fallbackNumber = "") {
  if (member.allSupportNumbers === true) return true;
  const normalizedNumber = normalizeE164(supportNumber);
  return staffSupportNumbers(member, fallbackNumber).includes(normalizedNumber);
}

function safeE164(value) {
  try {
    return normalizeE164(value, {allowEmpty: true});
  } catch {
    return "";
  }
}

function supportLineForCall(call = {}) {
  const direction = cleanText(call.direction, 20).toLowerCase();
  return safeE164(call.supportLine || (direction === "outbound" ? call.from : call.to));
}

function ticketCallSupportNumbers(ticket = {}) {
  const details = ticket.details && typeof ticket.details === "object" ? ticket.details : {};
  return [...new Set([
    ...normalizeSupportNumbers(ticket.callSupportLines),
    safeE164(details.twilioSupportNumber),
    safeE164(details.twilioSupportAddress),
  ].filter(Boolean))];
}

function isCallCase(ticket = {}) {
  return [ticket.source, ticket.channel, ticket.requestType]
      .some((value) => cleanText(value, 40).toLowerCase() === "phone") ||
    ticketCallSupportNumbers(ticket).length > 0;
}

function normalizedSupportScope(value) {
  return value === undefined || value === null ? null : normalizeSupportNumbers(value);
}

function callMatchesSupportScope(call, scope) {
  if (scope === null) return true;
  const supportLine = supportLineForCall(call);
  return Boolean(supportLine) && scope.includes(supportLine);
}

function ticketMatchesSupportScope(ticket, scope) {
  if (scope === null) return true;
  return ticketCallSupportNumbers(ticket).some((number) => scope.includes(number));
}

function mergeSupportNumbers(...values) {
  return [...new Set(values.flatMap((value) => normalizeSupportNumbers(value)))];
}

function supportPermissionError(message) {
  const error = new Error(message);
  error.code = "permission-denied";
  return error;
}

function normalizeCustomerAddress(value) {
  return normalizeE164(cleanText(value, 120).replace(/^(?:rcs|sms):/i, ""));
}

function inboundMessagingChannel(payload = {}) {
  let metadata = {};
  try {
    metadata = JSON.parse(cleanText(payload.ChannelMetadata, 12000) || "{}");
  } catch {
    metadata = {};
  }
  const metadataType = cleanText(metadata.type, 20).toLowerCase();
  const prefix = cleanText(payload.ChannelPrefix, 20).toLowerCase();
  const addresses = `${cleanText(payload.From, 120)} ${cleanText(payload.To, 120)}`.toLowerCase();
  return metadataType === "rcs" || prefix === "rcs" || addresses.includes("rcs:") ? "rcs" : "sms";
}

function normalizeRoutingGroup(value) {
  const group = cleanText(value, 20).toLowerCase() || "primary";
  if (!ROUTING_GROUPS.has(group)) {
    throw new Error("Choose the primary or backup routing group.");
  }
  return group;
}

function normalizeRoutingOrder(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("Routing order must be a whole number from 1 to 100.");
  }
  return parsed;
}

function normalizeDeliveryMode(value) {
  const mode = cleanText(value, 20).toLowerCase() || "phone";
  if (!DELIVERY_MODES.has(mode)) {
    throw new Error("Choose app or phone delivery.");
  }
  return mode;
}

function normalizeVoiceRoutingMode(value) {
  const mode = cleanText(value, 20).toLowerCase();
  if (!VOICE_ROUTING_MODES.has(mode)) {
    throw new Error("Choose app or phone routing.");
  }
  return mode;
}

function voiceIdentityFor(value) {
  const normalized = cleanText(value, 240).toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  if (!normalized) throw new Error("A staff user is required for app calling.");
  return `staff_${normalized}`.slice(0, 256);
}

function normalizeStaffInput(input = {}) {
  const name = cleanText(input.name, 100);
  if (!name) throw new Error("Staff name is required.");
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode);
  const userUid = cleanText(input.userUid, 160);
  if (deliveryMode === "app" && !userUid) {
    throw new Error("Choose a Chargerent user for app calling.");
  }
  const hasSupportNumberInput = Object.prototype.hasOwnProperty.call(input, "supportNumbers") ||
    Object.prototype.hasOwnProperty.call(input, "supportNumber");
  const supportNumbers = hasSupportNumberInput ? normalizeSupportNumbers(
      input.supportNumbers ?? input.supportNumber,
      {allowEmpty: false},
  ) : null;
  return {
    name,
    phoneE164: normalizeE164(input.phoneE164 || input.phone, {allowEmpty: deliveryMode === "app"}),
    deliveryMode,
    userUid,
    twilioIdentity: deliveryMode === "app" ? voiceIdentityFor(userUid) : "",
    routingGroup: normalizeRoutingGroup(input.routingGroup),
    routingOrder: normalizeRoutingOrder(input.routingOrder || 1),
    enabled: input.enabled !== false,
    ...(supportNumbers ? {supportNumbers} : {}),
  };
}

function phoneTicketId(phoneE164, supportAddress = "") {
  const customerNumber = normalizeE164(phoneE164);
  const supportLine = cleanText(supportAddress, 200).toLowerCase();
  const digest = crypto.createHash("sha256")
      .update(supportLine ? `${customerNumber}|${supportLine}` : customerNumber)
      .digest("hex");
  return `PHONE-${digest.slice(0, 20)}`;
}

function callTicketId(callSid) {
  const normalizedCallSid = cleanText(callSid, 80);
  if (!normalizedCallSid) throw new Error("A Twilio call ID is required.");
  const digest = crypto.createHash("sha256").update(normalizedCallSid).digest("hex");
  return `CALL-${digest.slice(0, 20)}`;
}

function providerDocumentId(kind, externalId) {
  const digest = crypto.createHash("sha256")
      .update(`${cleanText(kind, 30)}:${cleanText(externalId, 500)}`)
      .digest("hex");
  return `twilio-${digest.slice(0, 32)}`;
}

function cleanDocumentId(value, label = "Document") {
  const id = cleanText(value, 160);
  if (!id || id.includes("/")) throw new Error(`${label} ID is invalid.`);
  return id;
}

function routingAttemptKey(group, staffId) {
  return `${normalizeRoutingGroup(group)}:${cleanDocumentId(staffId, "Staff")}`;
}

function mobileCaseSummary(id, data = {}, latestCall = {}) {
  const customer = data.customer && typeof data.customer === "object" ? data.customer : {};
  const callback = data.callback && typeof data.callback === "object" ? data.callback : {};
  const linkedRental = data.linkedRental && typeof data.linkedRental === "object" ? data.linkedRental : {};
  const transcriptStatus = cleanText(latestCall.transcriptStatus, 40);
  const transcriptText = cleanText(latestCall.transcriptText, 12000);
  const contentExpiresAtIso = cleanText(latestCall.sensitiveContentExpiresAtIso, 40);
  const callTranscript = transcriptStatus || transcriptText || contentExpiresAtIso ? {
    status: transcriptStatus,
    text: transcriptText,
    segmentCount: Math.max(0, Number(latestCall.transcriptSegmentCount) || 0),
    contentExpiresAtIso,
  } : null;
  return {
    id,
    displayTicketNumber: cleanText(data.displayTicketNumber || data.ticketNumber || id, 120),
    subject: cleanText(data.subject, 300) || "Support case",
    status: cleanText(data.status, 40) || "new",
    priority: cleanText(data.priority, 40) || "normal",
    source: cleanText(data.source, 40) || "manual",
    category: cleanText(data.category, 50) || "customer_support",
    customerName: cleanText(customer.name, 160),
    customerEmail: cleanText(customer.email, 254),
    customerPhone: cleanText(customer.phoneE164 || customer.phone, 40),
    assignedTo: cleanText(data.assignedTo, 100),
    message: cleanText(data.message, 1000),
    callbackRequested: callback.status === "requested",
    callbackPhone: cleanText(callback.phone, 40),
    needsCaseMatch: data.needsCaseMatch === true,
    linkedRentalId: cleanText(linkedRental.documentId, 200),
    unread: data.unread === true,
    createdAtIso: cleanText(data.createdAtIso, 40),
    lastActivityAtIso: cleanText(data.lastActivityAtIso || data.updatedAtIso, 40),
    callTranscript,
  };
}

function actorName(authState = {}) {
  return cleanText(
      authState.profile?.displayName || authState.profile?.name ||
      authState.profile?.username || authState.uid || "admin",
      100,
  );
}

function staffDocumentId(value = "") {
  const existing = cleanText(value, 120).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return existing || `STAFF-${crypto.randomUUID()}`;
}

function staffSort(left, right) {
  const groupOrder = {primary: 0, backup: 1};
  const groupDifference = (groupOrder[left.routingGroup] ?? 2) -
    (groupOrder[right.routingGroup] ?? 2);
  if (groupDifference) return groupDifference;
  const orderDifference = Number(left.routingOrder || 100) - Number(right.routingOrder || 100);
  if (orderDifference) return orderDifference;
  return String(left.name || "").localeCompare(String(right.name || ""));
}

function splitRoutingStaff(staff = [], {deliveryMode = "phone", requireAvailable = false} = {}) {
  const mode = normalizeDeliveryMode(deliveryMode);
  const enabled = staff.filter((member) => {
    if (member?.enabled === false) return false;
    const memberMode = member?.deliveryMode || "phone";
    if (memberMode !== mode) return false;
    if (requireAvailable && member?.available !== true) return false;
    return mode === "app" ? Boolean(member?.twilioIdentity) : Boolean(member?.phoneE164);
  });
  return {
    primary: enabled.filter((member) => member.routingGroup === "primary").sort(staffSort).slice(0, 10),
    backup: enabled.filter((member) => member.routingGroup === "backup").sort(staffSort).slice(0, 10),
  };
}

function deliveryStatus(providerStatus) {
  const status = cleanText(providerStatus, 40).toLowerCase();
  if (["failed", "undelivered"].includes(status)) return "failed";
  if (status === "read") return "read";
  if (status === "delivered") return "delivered";
  if (status === "sent") return "sent";
  return "sending";
}

function createSupportTelephonyService({
  db,
  admin,
  sendMessage = null,
  clock = () => new Date(),
}) {
  if (!db || !admin) throw new Error("Firestore dependencies are required.");
  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  function ticketReference(phoneE164, supportAddress = "") {
    const id = phoneTicketId(phoneE164, supportAddress);
    return {id, ref: db.collection("supportTickets").doc(id)};
  }

  function callLogReference(callSid) {
    return db.collection("supportCallLogs").doc(providerDocumentId("call-log", callSid));
  }

  function callLogDocumentReference(callLogId) {
    return db.collection("supportCallLogs").doc(cleanDocumentId(callLogId, "Call log"));
  }

  function routingReference(callSid) {
    return db.collection("supportCallRoutes").doc(providerDocumentId("call-route", callSid));
  }

  async function recentCallLogDocuments(limit = 500) {
    const snapshot = await db.collection("supportCallLogs")
        .orderBy("createdAtIso", "desc")
        .limit(Math.min(500, Math.max(1, Number(limit) || 500)))
        .get();
    return snapshot.docs.map((document) => ({
      id: document.id,
      data: document.data() || {},
    }));
  }

  async function assertCaseAccess(ticketId, supportNumbers) {
    const id = cleanDocumentId(ticketId, "Support case");
    const scope = normalizedSupportScope(supportNumbers);
    const ticketSnapshot = await db.collection("supportTickets").doc(id).get();
    if (!ticketSnapshot.exists) throw new Error("Support case was not found.");
    if (scope === null) return {id, ticket: ticketSnapshot.data() || {}};
    const ticket = ticketSnapshot.data() || {};
    if (isCallCase(ticket) && ticketMatchesSupportScope(ticket, scope)) {
      return {id, ticket};
    }
    const calls = await recentCallLogDocuments();
    if (calls.some(({data}) =>
      cleanText(data.ticketId, 120) === id && callMatchesSupportScope(data, scope),
    )) {
      return {id, ticket};
    }
    throw supportPermissionError("This call case is not assigned to one of your support numbers.");
  }

  async function importInbound({
    channel,
    externalId,
    from,
    to,
    body,
    type = "message",
    providerData = {},
    ticketId = "",
  }) {
    if (!new Set(["sms", "rcs", "phone"]).has(channel)) {
      throw new Error("Unsupported telephony channel.");
    }
    const phoneE164 = normalizeCustomerAddress(from);
    const supportAddress = channel === "rcs" ? cleanText(to, 200) : normalizeE164(to);
    const replyChannel = channel === "phone" ? "sms" : channel;
    const normalizedExternalId = cleanText(externalId, 500);
    if (!normalizedExternalId) throw new Error("A Twilio message or call ID is required.");
    const messageBody = cleanText(body, 12000) ||
      (channel === "phone" ? "Incoming customer call." : "Customer sent an attachment.");
    const id = ticketId ? cleanDocumentId(ticketId, "Ticket") :
      phoneTicketId(phoneE164, supportAddress);
    const ref = db.collection("supportTickets").doc(id);
    const messageId = providerDocumentId(type, normalizedExternalId);
    const messageRef = ref.collection("messages").doc(messageId);
    const now = clock();
    const nowIso = now.toISOString();
    let duplicate = false;
    let shouldSendWelcomeAutoReply = false;

    await db.runTransaction(async (transaction) => {
      const [ticketSnapshot, messageSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(messageRef),
      ]);
      if (messageSnapshot.exists) {
        duplicate = true;
        const existing = ticketSnapshot.exists ? ticketSnapshot.data() : null;
        shouldSendWelcomeAutoReply = Boolean(existing &&
          (channel === "sms" || channel === "rcs") &&
          existing.welcomeAutoReplyVersion === WELCOME_AUTO_REPLY_VERSION &&
          ["pending", "failed"].includes(existing.welcomeAutoReplyStatus));
        return;
      }

      const existing = ticketSnapshot.exists ? ticketSnapshot.data() : null;
      if (!existing) {
        const isTextConversation = channel === "sms" || channel === "rcs";
        shouldSendWelcomeAutoReply = isTextConversation;
        transaction.set(ref, {
          schemaVersion: 1,
          ticketNumber: id,
          displayTicketNumber: supportTicketDisplayNumber(id, "customer_support"),
          source: channel,
          channel,
          replyChannel,
          category: "customer_support",
          requestType: channel,
          subject: channel === "phone" ? `Phone call from ${phoneE164}` : `Text message from ${phoneE164}`,
          status: isTextConversation ? "in_progress" : "new",
          priority: "normal",
          unread: true,
          assignedTo: "",
          customer: {
            name: "Phone customer",
            email: "",
            phone: phoneE164,
            phoneE164,
            company: "",
            role: "",
          },
          payment: {cardLastFour: ""},
          details: {twilioSupportAddress: supportAddress},
          ...(channel === "phone" ? {callSupportLines: [supportAddress]} : {}),
          message: messageBody,
          createdAt: serverTimestamp(),
          createdAtIso: nowIso,
          updatedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          lastActivityAtIso: nowIso,
          lastInboundAt: serverTimestamp(),
          lastInboundAtIso: nowIso,
          replyAddress: phoneE164,
          linkedRental: null,
          ...(isTextConversation ? {
            welcomeAutoReplyVersion: WELCOME_AUTO_REPLY_VERSION,
            welcomeAutoReplyStatus: "pending",
          } : {}),
          ...(channel === "phone" ? {needsCaseMatch: true} : {}),
        });
      } else {
        const isTextConversation = channel === "sms" || channel === "rcs";
        shouldSendWelcomeAutoReply = isTextConversation &&
          existing.welcomeAutoReplyVersion === WELCOME_AUTO_REPLY_VERSION &&
          ["pending", "failed"].includes(existing.welcomeAutoReplyStatus);
        transaction.update(ref, {
          unread: true,
          status: isTextConversation ? "in_progress" :
            (TERMINAL_TICKET_STATUSES.has(existing.status) ? "new" : (existing.status || "new")),
          replyChannel,
          updatedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          lastActivityAtIso: nowIso,
          lastInboundAt: serverTimestamp(),
          lastInboundAtIso: nowIso,
          message: messageBody,
          "customer.phone": existing.customer?.phone || phoneE164,
          "customer.phoneE164": phoneE164,
          ...(channel === "phone" ? {
            callSupportLines: mergeSupportNumbers(existing.callSupportLines, supportAddress),
          } : {}),
        });
      }

      transaction.set(messageRef, {
        type,
        direction: "inbound",
        channel,
        from: phoneE164,
        to: supportAddress,
        body: messageBody,
        externalMessageId: normalizedExternalId,
        provider: "twilio",
        ...providerData,
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
      });
    });

    return {ok: true, ticketId: id, messageId, duplicate, shouldSendWelcomeAutoReply};
  }

  async function sendWelcomeAutoReply({ticketId, from, to, messagingServiceSid = ""} = {}) {
    if (typeof sendMessage !== "function") {
      return {ok: false, skipped: true, reason: "SMS delivery is not configured."};
    }
    const id = cleanDocumentId(ticketId, "Support case");
    const normalizedMessagingServiceSid = cleanText(messagingServiceSid, 80);
    const normalizedFrom = normalizedMessagingServiceSid ? "" : normalizeE164(from);
    const normalizedTo = normalizeCustomerAddress(to);
    const ticketRef = db.collection("supportTickets").doc(id);
    const messageRef = ticketRef.collection("messages").doc(WELCOME_AUTO_REPLY_MESSAGE_ID);
    const startedAt = clock();
    let shouldSend = false;

    await db.runTransaction(async (transaction) => {
      const messageSnapshot = await transaction.get(messageRef);
      const message = messageSnapshot.exists ? messageSnapshot.data() || {} : {};
      if (messageSnapshot.exists && message.deliveryStatus !== "failed") return;
      shouldSend = true;
      transaction.set(messageRef, {
        type: "message",
        direction: "outbound",
        channel: "sms",
        requestedChannel: normalizedMessagingServiceSid ? "rcs_or_sms" : "sms",
        messagingServiceSid: normalizedMessagingServiceSid,
        from: normalizedFrom,
        to: normalizedTo,
        body: WELCOME_AUTO_REPLY_BODY,
        authorUid: "system",
        authorName: "Chargerent automatic reply",
        automatic: true,
        automaticReplyVersion: WELCOME_AUTO_REPLY_VERSION,
        deliveryStatus: "sending",
        provider: "twilio",
        createdAt: messageSnapshot.exists ? message.createdAt : serverTimestamp(),
        createdAtIso: messageSnapshot.exists ? message.createdAtIso : startedAt.toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: startedAt.toISOString(),
      }, {merge: true});
      transaction.update(ticketRef, {
        welcomeAutoReplyStatus: "sending",
        updatedAt: serverTimestamp(),
      });
    });

    if (!shouldSend) return {ok: true, skipped: true};

    try {
      const sent = await sendMessage({
        ...(normalizedMessagingServiceSid ?
          {messagingServiceSid: normalizedMessagingServiceSid} : {from: normalizedFrom}),
        to: normalizedTo,
        body: WELCOME_AUTO_REPLY_BODY,
      });
      const sentAt = clock();
      const batch = db.batch();
      batch.update(messageRef, {
        externalMessageId: cleanText(sent?.sid, 100),
        providerStatus: cleanText(sent?.status, 40) || "queued",
        deliveryStatus: deliveryStatus(sent?.status || "queued"),
        sentAt: serverTimestamp(),
        sentAtIso: sentAt.toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: sentAt.toISOString(),
      });
      batch.update(ticketRef, {
        status: "in_progress",
        welcomeAutoReplyStatus: "sent",
        welcomeAutoReplySentAt: serverTimestamp(),
        welcomeAutoReplySentAtIso: sentAt.toISOString(),
        lastReplyAt: serverTimestamp(),
        lastReplyAtIso: sentAt.toISOString(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return {ok: true, skipped: false, messageId: cleanText(sent?.sid, 100)};
    } catch (error) {
      const failedAt = clock();
      const batch = db.batch();
      batch.update(messageRef, {
        deliveryStatus: "failed",
        deliveryError: "Automatic SMS delivery failed.",
        failedAt: serverTimestamp(),
        failedAtIso: failedAt.toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: failedAt.toISOString(),
      });
      batch.update(ticketRef, {
        welcomeAutoReplyStatus: "failed",
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      throw error;
    }
  }

  async function importInboundSms(payload = {}) {
    const mediaCount = Math.max(0, Number(payload.NumMedia) || 0);
    const channel = inboundMessagingChannel(payload);
    const imported = await importInbound({
      channel,
      externalId: payload.MessageSid || payload.SmsMessageSid || payload.SmsSid,
      from: payload.From,
      to: payload.To,
      body: payload.Body,
      type: "message",
      providerData: {
        providerStatus: cleanText(payload.SmsStatus, 40) || "received",
        mediaCount,
        buttonPayload: cleanText(payload.ButtonPayload, 500),
        buttonText: cleanText(payload.ButtonText, 200),
        buttonType: cleanText(payload.ButtonType, 40),
        messagingServiceSid: cleanText(payload.MessagingServiceSid, 80),
      },
    });
    const inboundMessagingServiceSid = cleanText(payload.MessagingServiceSid, 80);
    const canAddressReply = channel === "sms" || /^MG[a-f0-9]{32}$/i.test(inboundMessagingServiceSid);
    if (imported.shouldSendWelcomeAutoReply && typeof sendMessage === "function" && canAddressReply) {
      await sendWelcomeAutoReply({
        ticketId: imported.ticketId,
        from: payload.To,
        to: payload.From,
        messagingServiceSid: inboundMessagingServiceSid,
      });
    }
    return imported;
  }

  async function importInboundCall(payload = {}) {
    const callSid = cleanText(payload.CallSid, 80);
    const imported = await importInbound({
      channel: "phone",
      externalId: callSid,
      from: payload.From,
      to: payload.To,
      body: "Incoming customer call.",
      type: "call",
      providerData: {
        callSid,
        callStatus: cleanText(payload.CallStatus, 40) || "ringing",
        disposition: "ringing",
      },
      ticketId: callTicketId(callSid),
    });
    if (!imported.duplicate) {
      const now = clock();
      await callLogReference(payload.CallSid).set({
        schemaVersion: 1,
        provider: "twilio",
        callSid: cleanText(payload.CallSid, 80),
        ticketId: imported.ticketId,
        ticketHistory: [imported.ticketId],
        direction: "inbound",
        from: normalizeE164(payload.From),
        to: normalizeE164(payload.To),
        supportLine: normalizeE164(payload.To),
        providerStatus: cleanText(payload.CallStatus, 40) || "ringing",
        disposition: "ringing",
        callbackRequested: false,
        createdAt: serverTimestamp(),
        createdAtIso: now.toISOString(),
        updatedAt: serverTimestamp(),
        updatedAtIso: now.toISOString(),
      });
    }
    return imported;
  }

  async function importOutboundCall({
    callSid,
    from,
    to,
    staffId = "",
    staffName = "",
    staffIdentity = "",
  } = {}) {
    const normalizedCallSid = cleanText(callSid, 80);
    if (!normalizedCallSid) throw new Error("A Twilio call ID is required.");
    const supportNumber = normalizeE164(from);
    const customerNumber = normalizeE164(to);
    const {id, ref} = ticketReference(customerNumber, supportNumber);
    const messageId = providerDocumentId("call", normalizedCallSid);
    const messageRef = ref.collection("messages").doc(messageId);
    const now = clock();
    const nowIso = now.toISOString();
    let duplicate = false;

    await db.runTransaction(async (transaction) => {
      const [ticketSnapshot, messageSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(messageRef),
      ]);
      if (messageSnapshot.exists) {
        duplicate = true;
        return;
      }
      if (!ticketSnapshot.exists) {
        transaction.set(ref, {
          schemaVersion: 1,
          ticketNumber: id,
          displayTicketNumber: supportTicketDisplayNumber(id, "customer_support"),
          source: "phone",
          channel: "phone",
          replyChannel: "sms",
          category: "customer_support",
          requestType: "phone",
          subject: `Outgoing call to ${customerNumber}`,
          status: "in_progress",
          priority: "normal",
          unread: false,
          assignedTo: cleanText(staffName, 100),
          customer: {
            name: "Phone customer",
            email: "",
            phone: customerNumber,
            phoneE164: customerNumber,
            company: "",
            role: "",
          },
          payment: {cardLastFour: ""},
          details: {twilioSupportNumber: supportNumber},
          callSupportLines: [supportNumber],
          message: "Outgoing support call.",
          createdAt: serverTimestamp(),
          createdAtIso: nowIso,
          updatedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          lastActivityAtIso: nowIso,
          replyAddress: customerNumber,
          linkedRental: null,
        });
      } else {
        const existing = ticketSnapshot.data() || {};
        transaction.update(ref, {
          updatedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          lastActivityAtIso: nowIso,
          "customer.phone": ticketSnapshot.data()?.customer?.phone || customerNumber,
          "customer.phoneE164": customerNumber,
          callSupportLines: mergeSupportNumbers(existing.callSupportLines, supportNumber),
        });
      }
      transaction.set(messageRef, {
        type: "call",
        direction: "outbound",
        channel: "phone",
        from: supportNumber,
        to: customerNumber,
        body: "Outgoing support call.",
        externalMessageId: normalizedCallSid,
        callSid: normalizedCallSid,
        callStatus: "initiated",
        disposition: "dialing",
        provider: "twilio",
        staffId: cleanText(staffId, 120),
        staffName: cleanText(staffName, 100),
        staffIdentity: cleanText(staffIdentity, 256),
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
      });
    });

    if (!duplicate) {
      await callLogReference(normalizedCallSid).set({
        schemaVersion: 1,
        provider: "twilio",
        callSid: normalizedCallSid,
        ticketId: id,
        ticketHistory: [id],
        direction: "outbound",
        from: supportNumber,
        to: customerNumber,
        supportLine: supportNumber,
        staffId: cleanText(staffId, 120),
        staffName: cleanText(staffName, 100),
        staffIdentity: cleanText(staffIdentity, 256),
        providerStatus: "initiated",
        disposition: "dialing",
        callbackRequested: false,
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      });
    }
    return {ok: true, ticketId: id, messageId, duplicate};
  }

  async function listRoutingStaff() {
    const [staffSnapshot, userSnapshot] = await Promise.all([
      db.collection("supportTelephonyStaff").get(),
      db.collection("users").get(),
    ]);
    const configured = staffSnapshot.docs
        .map((document) => ({id: document.id, ...document.data()}));
    const configuredByUid = new Map(configured
        .filter((member) => cleanText(member.userUid, 160))
        .map((member) => [cleanText(member.userUid, 160), member]));
    const automatic = userSnapshot.docs
        .map((document) => ({uid: document.id, profile: document.data() || {}}))
        .filter(({profile}) => isSupportAppProfile(profile))
        .map(({uid, profile}) => automaticRoutingStaff(
            uid,
            profile,
            configuredByUid.get(uid) || null,
        ));
    const automaticUids = new Set(automatic.map((member) => member.userUid));
    return [
      ...automatic,
      ...configured.filter((member) => !automaticUids.has(cleanText(member.userUid, 160))),
    ].sort(staffSort);
  }

  async function listCallLogs(requestedLimit = 50, supportNumbers = undefined) {
    const parsedLimit = Number(requestedLimit);
    const resultLimit = Number.isFinite(parsedLimit) ?
      Math.min(100, Math.max(1, Math.floor(parsedLimit))) : 50;
    const scope = normalizedSupportScope(supportNumbers);
    const scanLimit = scope === null ? resultLimit :
      Math.min(500, Math.max(300, resultLimit * 5));
    const snapshot = await db.collection("supportCallLogs")
        .orderBy("createdAtIso", "desc")
        .limit(scanLimit)
        .get();
    return snapshot.docs.filter((document) =>
      callMatchesSupportScope(document.data() || {}, scope),
    ).slice(0, resultLimit).map((document) => {
      const data = document.data() || {};
      return {
        id: document.id,
        ticketId: cleanText(data.ticketId, 120),
        direction: cleanText(data.direction, 20) || "inbound",
        from: cleanText(data.from, 40),
        to: cleanText(data.to, 40),
        disposition: cleanText(data.disposition, 40) || "unknown",
        providerStatus: cleanText(data.providerStatus, 40),
        dialCallDuration: cleanText(data.dialCallDuration, 20),
        recordingDuration: cleanText(data.recordingDuration, 20),
        hasRecording: Boolean(data.recordingSid),
        recordingStatus: cleanText(data.recordingStatus, 40),
        transcriptStatus: cleanText(data.transcriptStatus, 40),
        transcriptPreview: cleanText(data.transcriptText, 1200),
        transcriptSegmentCount: Math.max(0, Number(data.transcriptSegmentCount) || 0),
        contentExpiresAtIso: cleanText(data.sensitiveContentExpiresAtIso, 40),
        staffName: cleanText(data.staffName || data.acceptedByName, 100),
        callbackRequested: data.callbackRequested === true,
        callbackPhone: cleanText(data.callbackPhone, 40),
        createdAtIso: cleanText(data.createdAtIso, 40),
        updatedAtIso: cleanText(data.updatedAtIso, 40),
      };
    });
  }

  async function beginCallRouting({
    ticketId,
    callSid,
    queueName,
    routingMode,
    customerPhone,
    supportNumber,
    primary = [],
    backup = [],
  } = {}) {
    const normalizedTicketId = cleanDocumentId(ticketId, "Ticket");
    const normalizedCallSid = cleanText(callSid, 80);
    const normalizedQueueName = cleanText(queueName, 64);
    const normalizedCustomerPhone = normalizeE164(customerPhone);
    const normalizedSupportNumber = normalizeE164(supportNumber);
    const mode = normalizeVoiceRoutingMode(routingMode);
    if (!normalizedCallSid || !normalizedQueueName) {
      throw new Error("Call and queue IDs are required.");
    }
    const groups = {
      primary: primary.map((member) => cleanDocumentId(member.id, "Staff")),
      backup: backup.map((member) => cleanDocumentId(member.id, "Staff")),
    };
    const staff = {};
    for (const member of [...primary, ...backup]) {
      staff[cleanDocumentId(member.id, "Staff")] = {
        id: cleanDocumentId(member.id, "Staff"),
        name: cleanText(member.name, 100) || "Support staff",
        twilioIdentity: cleanText(member.twilioIdentity, 256),
        phoneE164: cleanText(member.phoneE164, 40),
        routingGroup: normalizeRoutingGroup(member.routingGroup),
      };
    }
    const currentGroup = groups.primary.length ? "primary" : "backup";
    const now = clock();
    await routingReference(normalizedCallSid).set({
      schemaVersion: 1,
      ticketId: normalizedTicketId,
      callSid: normalizedCallSid,
      queueName: normalizedQueueName,
      routingMode: mode,
      customerPhone: normalizedCustomerPhone,
      supportNumber: normalizedSupportNumber,
      groups,
      staff,
      attempts: {},
      startedGroups: [],
      currentGroup,
      claimed: false,
      exhausted: !groups.primary.length && !groups.backup.length,
      createdAt: serverTimestamp(),
      createdAtIso: now.toISOString(),
      expiresAtIso: new Date(now.getTime() + ROUTING_MAX_WAIT_MS).toISOString(),
      updatedAt: serverTimestamp(),
      updatedAtIso: now.toISOString(),
    });
    return {ok: true, currentGroup, hasStaff: !(!groups.primary.length && !groups.backup.length)};
  }

  async function startRoutingGroup({callSid, group} = {}) {
    const normalizedCallSid = cleanText(callSid, 80);
    const normalizedGroup = normalizeRoutingGroup(group);
    if (!normalizedCallSid) throw new Error("A call ID is required.");
    const ref = routingReference(normalizedCallSid);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return {start: false, members: [], missing: true};
      const route = snapshot.data() || {};
      const startedGroups = Array.isArray(route.startedGroups) ? route.startedGroups : [];
      if (route.claimed || route.exhausted || route.currentGroup !== normalizedGroup ||
          startedGroups.includes(normalizedGroup)) {
        return {start: false, members: []};
      }
      const memberIds = Array.isArray(route.groups?.[normalizedGroup]) ?
        route.groups[normalizedGroup] : [];
      const members = memberIds.map((id) => route.staff?.[id]).filter(Boolean);
      const attempts = {...(route.attempts || {})};
      for (const member of members) {
        attempts[routingAttemptKey(normalizedGroup, member.id)] = {
          group: normalizedGroup,
          staffId: member.id,
          staffName: member.name,
          status: "queued",
          agentCallSid: "",
        };
      }
      transaction.set(ref, {
        attempts,
        startedGroups: [...startedGroups, normalizedGroup],
        exhausted: members.length === 0,
        updatedAt: serverTimestamp(),
        updatedAtIso: clock().toISOString(),
      }, {merge: true});
      return {
        start: members.length > 0,
        members,
        queueName: route.queueName,
        ticketId: route.ticketId,
        routingMode: route.routingMode,
        customerPhone: route.customerPhone,
        supportNumber: route.supportNumber,
      };
    });
  }

  async function recordRoutingAttempt({
    callSid,
    group,
    staffId,
    agentCallSid = "",
    status,
  } = {}) {
    const normalizedCallSid = cleanText(callSid, 80);
    const normalizedGroup = normalizeRoutingGroup(group);
    const normalizedStaffId = cleanDocumentId(staffId, "Staff");
    const normalizedStatus = cleanText(status, 40).toLowerCase() || "queued";
    if (!normalizedCallSid) throw new Error("A call ID is required.");
    const ref = routingReference(normalizedCallSid);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return {ok: false, missing: true};
      const route = snapshot.data() || {};
      const attempts = {...(route.attempts || {})};
      const key = routingAttemptKey(normalizedGroup, normalizedStaffId);
      attempts[key] = {
        ...(attempts[key] || {}),
        group: normalizedGroup,
        staffId: normalizedStaffId,
        staffName: cleanText(route.staff?.[normalizedStaffId]?.name, 100),
        status: normalizedStatus,
        ...(agentCallSid ? {agentCallSid: cleanText(agentCallSid, 80)} : {}),
      };
      let nextGroup = "";
      let exhausted = route.exhausted === true;
      const expected = Array.isArray(route.groups?.[normalizedGroup]) ?
        route.groups[normalizedGroup] : [];
      const groupFinished = expected.length > 0 && expected.every((id) =>
        ROUTING_TERMINAL_STATUSES.has(
            cleanText(attempts[routingAttemptKey(normalizedGroup, id)]?.status, 40).toLowerCase(),
        ),
      );
      if (!route.claimed && route.currentGroup === normalizedGroup && groupFinished) {
        if (normalizedGroup === "primary" && (route.groups?.backup || []).length) {
          nextGroup = "backup";
        } else {
          exhausted = true;
        }
      }
      transaction.set(ref, {
        attempts,
        ...(nextGroup ? {currentGroup: nextGroup} : {}),
        exhausted,
        updatedAt: serverTimestamp(),
        updatedAtIso: clock().toISOString(),
      }, {merge: true});
      return {ok: true, nextGroup, exhausted};
    });
  }

  async function claimCallRouting({callSid, staffId, agentCallSid} = {}) {
    const normalizedCallSid = cleanText(callSid, 80);
    const normalizedStaffId = cleanDocumentId(staffId, "Staff");
    const normalizedAgentCallSid = cleanText(agentCallSid, 80);
    if (!normalizedCallSid || !normalizedAgentCallSid) {
      throw new Error("Caller and agent call IDs are required.");
    }
    const ref = routingReference(normalizedCallSid);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return {won: false, missing: true, cancelCallSids: []};
      const route = snapshot.data() || {};
      if (route.claimed || route.exhausted) {
        return {won: false, cancelCallSids: []};
      }
      const member = route.staff?.[normalizedStaffId] || {};
      const attempts = {...(route.attempts || {})};
      for (const [key, attempt] of Object.entries(attempts)) {
        if (attempt.staffId === normalizedStaffId) {
          attempts[key] = {...attempt, status: "answered", agentCallSid: normalizedAgentCallSid};
        }
      }
      transaction.set(ref, {
        claimed: true,
        claimedByStaffId: normalizedStaffId,
        claimedByName: cleanText(member.name, 100) || "Support staff",
        claimedAgentCallSid: normalizedAgentCallSid,
        attempts,
        updatedAt: serverTimestamp(),
        updatedAtIso: clock().toISOString(),
      }, {merge: true});
      return {
        won: true,
        queueName: route.queueName,
        ticketId: route.ticketId,
        staffName: cleanText(member.name, 100) || "Support staff",
        cancelCallSids: Object.values(attempts)
            .map((attempt) => cleanText(attempt.agentCallSid, 80))
            .filter((sid) => sid && sid !== normalizedAgentCallSid),
      };
    });
  }

  async function callRoutingWaitState(callSid) {
    const normalizedCallSid = cleanText(callSid, 80);
    if (!normalizedCallSid) throw new Error("A call ID is required.");
    const snapshot = await routingReference(normalizedCallSid).get();
    if (!snapshot.exists) return {missing: true, leave: true, cancelCallSids: []};
    const route = snapshot.data() || {};
    const expired = Boolean(route.expiresAtIso) &&
      new Date(route.expiresAtIso).getTime() <= clock().getTime();
    if (!expired) {
      return {
        missing: false,
        leave: route.exhausted === true,
        claimed: route.claimed === true,
        currentGroup: route.currentGroup,
      };
    }
    const result = await expireCallRouting(normalizedCallSid);
    return {...result, leave: true, expired: true};
  }

  async function expireCallRouting(callSid) {
    const normalizedCallSid = cleanText(callSid, 80);
    const ref = routingReference(normalizedCallSid);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return {missing: true, cancelCallSids: []};
      const route = snapshot.data() || {};
      transaction.set(ref, {
        exhausted: true,
        updatedAt: serverTimestamp(),
        updatedAtIso: clock().toISOString(),
      }, {merge: true});
      return {
        missing: false,
        claimed: route.claimed === true,
        cancelCallSids: Object.values(route.attempts || {})
            .map((attempt) => cleanText(attempt.agentCallSid, 80))
            .filter(Boolean),
      };
    });
  }

  async function listActiveCases(requestedLimit = 100, supportNumbers = undefined) {
    const parsedLimit = Number(requestedLimit);
    const resultLimit = Number.isFinite(parsedLimit) ?
      Math.min(150, Math.max(1, Math.floor(parsedLimit))) : 100;
    const scope = normalizedSupportScope(supportNumbers);
    const [snapshot, calls] = await Promise.all([
      db.collection("supportTickets")
          .orderBy("lastActivityAtIso", "desc")
          .limit(300)
          .get(),
      recentCallLogDocuments(),
    ]);
    const scopedCalls = calls.filter(({data}) => callMatchesSupportScope(data, scope));
    const callTicketIds = new Set(scopedCalls
        .map(({data}) => cleanText(data.ticketId, 120))
        .filter(Boolean));
    const latestTranscriptCallByTicketId = new Map();
    scopedCalls.forEach(({data}) => {
      const ticketId = cleanText(data.ticketId, 120);
      const hasTranscript = cleanText(data.transcriptStatus, 40) ||
        cleanText(data.transcriptText, 12000) ||
        cleanText(data.sensitiveContentExpiresAtIso, 40);
      if (ticketId && hasTranscript && !latestTranscriptCallByTicketId.has(ticketId)) {
        latestTranscriptCallByTicketId.set(ticketId, data);
      }
    });
    return snapshot.docs
        .map((document) => ({id: document.id, data: document.data() || {}}))
        .filter(({id, data}) => isCallCase(data) || callTicketIds.has(id))
        .filter(({id, data}) =>
          scope === null || callTicketIds.has(id) || ticketMatchesSupportScope(data, scope),
        )
        .map(({id, data}) => mobileCaseSummary(
            id,
            data,
            latestTranscriptCallByTicketId.get(id) || {},
        ))
        .filter((ticket) => ACTIVE_TICKET_STATUSES.has(ticket.status))
        .slice(0, resultLimit);
  }

  async function linkCallToCase(data = {}, authState = {}, {supportNumbers = undefined} = {}) {
    const callLogId = cleanDocumentId(data.callLogId, "Call log");
    const callLogRef = callLogDocumentReference(callLogId);
    const callSnapshot = await callLogRef.get();
    if (!callSnapshot.exists) throw new Error("Call log was not found.");
    const call = callSnapshot.data() || {};
    const scope = normalizedSupportScope(supportNumbers);
    if (!callMatchesSupportScope(call, scope)) {
      throw supportPermissionError("This call is not assigned to one of your support numbers.");
    }
    const createNew = data.action === "create";
    const ticketId = createNew ? `CALL-${crypto.randomUUID()}` :
      cleanDocumentId(data.ticketId, "Ticket");
    const ticketRef = db.collection("supportTickets").doc(ticketId);
    const ticketSnapshot = await ticketRef.get();
    if (!createNew && !ticketSnapshot.exists) throw new Error("Support case was not found.");
    if (!createNew && ticketId !== cleanText(call.ticketId, 120) && scope !== null) {
      await assertCaseAccess(ticketId, scope);
    }
    const phone = normalizeE164(call.direction === "outbound" ? call.to : call.from);
    const supportLine = supportLineForCall(call);
    const now = clock();
    const nowIso = now.toISOString();
    const callSid = cleanText(call.callSid, 80);
    const messageRef = ticketRef.collection("messages")
        .doc(providerDocumentId("call", callSid || callLogId));
    const staffName = actorName(authState);
    const batch = db.batch();
    if (createNew) {
      batch.set(ticketRef, {
        schemaVersion: 1,
        ticketNumber: ticketId,
        displayTicketNumber: supportTicketDisplayNumber(ticketId, "customer_support"),
        source: "phone",
        channel: "phone",
        replyChannel: "sms",
        category: "customer_support",
        requestType: "phone",
        subject: `Support call with ${phone}`,
        status: "in_progress",
        priority: "normal",
        unread: false,
        assignedTo: staffName,
        customer: {
          name: "Phone customer",
          email: "",
          phone,
          phoneE164: phone,
          company: "",
          role: "",
        },
        payment: {cardLastFour: ""},
        details: {twilioSupportNumber: supportLine},
        callSupportLines: supportLine ? [supportLine] : [],
        message: "Case created from a support call.",
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        lastActivityAtIso: nowIso,
        replyAddress: phone,
        linkedRental: null,
      });
    } else {
      const existing = ticketSnapshot.data() || {};
      batch.update(ticketRef, {
        status: TERMINAL_TICKET_STATUSES.has(existing.status) ? "in_progress" :
          (existing.status || "in_progress"),
        assignedTo: existing.assignedTo || staffName,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        lastActivityAtIso: nowIso,
        callSupportLines: mergeSupportNumbers(existing.callSupportLines, supportLine),
      });
    }
    batch.set(messageRef, {
      type: "call",
      direction: cleanText(call.direction, 20) || "inbound",
      channel: "phone",
      from: cleanText(call.from, 40),
      to: cleanText(call.to, 40),
      body: `Support call linked by ${staffName}.`,
      externalMessageId: callSid,
      callSid,
      disposition: cleanText(call.disposition, 40),
      providerStatus: cleanText(call.providerStatus, 40),
      recordingSid: cleanText(call.recordingSid, 100),
      recordingUrl: cleanText(call.recordingUrl, 1000),
      recordingDuration: cleanText(call.recordingDuration, 20),
      recordingStatus: cleanText(call.recordingStatus, 40),
      recordingChannels: cleanText(call.recordingChannels, 20),
      transcriptStatus: cleanText(call.transcriptStatus, 40),
      transcriptText: cleanText(call.transcriptText, MAX_TRANSCRIPT_TEXT_LENGTH),
      transcriptSegments: Array.isArray(call.transcriptSegments) ?
        call.transcriptSegments.slice(-MAX_TRANSCRIPT_SEGMENTS) : [],
      transcriptSegmentCount: Math.max(0, Number(call.transcriptSegmentCount) || 0),
      sensitiveContentExpiresAtIso: cleanText(call.sensitiveContentExpiresAtIso, 40),
      transcriptDisclaimer: cleanText(call.transcriptDisclaimer, 300) ||
        "Machine-generated transcript. Verify important details against the recording.",
      provider: "twilio",
      linkedFromCallLogId: callLogId,
      createdAt: serverTimestamp(),
      createdAtIso: cleanText(call.createdAtIso, 40) || nowIso,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
    }, {merge: true});
    batch.set(callLogRef, {
      ticketId,
      ticketHistory: [...new Set([
        ...(Array.isArray(call.ticketHistory) ? call.ticketHistory : []),
        cleanText(call.ticketId, 120),
        ticketId,
      ].filter(Boolean))],
      caseLinkedAt: serverTimestamp(),
      caseLinkedAtIso: nowIso,
      caseLinkedBy: staffName,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
    }, {merge: true});
    await batch.commit();
    const updatedSnapshot = await ticketRef.get();
    return {
      ok: true,
      ticket: mobileCaseSummary(ticketId, updatedSnapshot.data() || {}),
    };
  }

  async function resolveCase(data = {}, authState = {}, {supportNumbers = undefined} = {}) {
    const access = await assertCaseAccess(data.ticketId, supportNumbers);
    const ticketRef = db.collection("supportTickets").doc(access.id);
    const now = clock();
    const changes = {
      status: "resolved",
      unread: false,
      resolvedAt: serverTimestamp(),
      resolvedAtIso: now.toISOString(),
      resolvedBy: actorName(authState),
      updatedAt: serverTimestamp(),
      updatedAtIso: now.toISOString(),
    };
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ticketRef);
      if (!snapshot.exists) throw new Error("Support case was not found.");
      transaction.update(ticketRef, changes);
    });
    return {
      ok: true,
      ticket: mobileCaseSummary(access.id, {...access.ticket, ...changes}),
    };
  }

  async function upsertRoutingStaff(data, authState) {
    const normalized = normalizeStaffInput(data);
    const id = staffDocumentId(data?.staffId);
    const staffSnapshot = await db.collection("supportTelephonyStaff").get();
    const duplicatePhone = normalized.phoneE164 && staffSnapshot.docs.find((document) =>
      document.id !== id && document.data()?.phoneE164 === normalized.phoneE164,
    );
    if (duplicatePhone) throw new Error("That phone number is already assigned to another staff member.");
    const duplicateUser = normalized.userUid && staffSnapshot.docs.find((document) =>
      document.id !== id && document.data()?.userUid === normalized.userUid,
    );
    if (duplicateUser) throw new Error("That Chargerent user is already assigned to another staff member.");
    const ref = db.collection("supportTelephonyStaff").doc(id);
    const existing = await ref.get();
    const now = clock();
    await ref.set({
      ...normalized,
      updatedAt: serverTimestamp(),
      updatedAtIso: now.toISOString(),
      updatedBy: actorName(authState),
      ...(!existing.exists ? {
        createdAt: serverTimestamp(),
        createdAtIso: now.toISOString(),
        createdBy: actorName(authState),
      } : {}),
    }, {merge: true});
    return {ok: true, staffId: id, staff: normalized};
  }

  async function voiceStaffForUser(uid) {
    const normalizedUid = cleanText(uid, 160);
    if (!normalizedUid) return null;
    const staff = await listRoutingStaff();
    return staff.find((member) =>
      member.deliveryMode === "app" &&
      member.userUid === normalizedUid &&
      member.twilioIdentity,
    ) || null;
  }

  async function voiceStaffForIdentity(identity) {
    const normalizedIdentity = cleanText(identity, 256).replace(/^client:/i, "");
    if (!normalizedIdentity) return null;
    const staff = await listRoutingStaff();
    return staff.find((member) =>
      member.enabled !== false &&
      member.deliveryMode === "app" &&
      member.twilioIdentity === normalizedIdentity,
    ) || null;
  }

  async function voiceRoutingMode() {
    const snapshot = await db.collection("supportTelephonyConfig").doc("voice").get();
    const mode = cleanText(snapshot.exists ? snapshot.data()?.routingMode : "", 20).toLowerCase();
    return mode === "app" ? "app" : "phone";
  }

  async function setVoiceRoutingMode(mode, authState) {
    const routingMode = normalizeVoiceRoutingMode(mode);
    const now = clock();
    await db.collection("supportTelephonyConfig").doc("voice").set({
      routingMode,
      updatedAt: serverTimestamp(),
      updatedAtIso: now.toISOString(),
      updatedBy: actorName(authState),
    }, {merge: true});
    return {ok: true, routingMode};
  }

  async function setVoiceAvailability(available, authState) {
    const member = await voiceStaffForUser(authState?.uid);
    if (!member) throw new Error("This account is not assigned to support calling.");
    const now = clock();
    await db.collection("supportTelephonyStaff").doc(member.id).set({
      name: member.name,
      deliveryMode: "app",
      userUid: member.userUid,
      twilioIdentity: member.twilioIdentity,
      routingGroup: member.routingGroup,
      routingOrder: member.routingOrder,
      enabled: member.enabled !== false,
      accountRole: member.accountRole || "",
      allSupportNumbers: member.allSupportNumbers === true,
      ...(Array.isArray(member.supportNumbers) ? {supportNumbers: member.supportNumbers} : {}),
      available: available === true,
      lastSeenAt: serverTimestamp(),
      lastSeenAtIso: now.toISOString(),
      updatedAt: serverTimestamp(),
      updatedAtIso: now.toISOString(),
      updatedBy: actorName(authState),
    }, {merge: true});
    return {
      ok: true,
      available: available === true,
      staffId: member.id,
      identity: member.twilioIdentity,
    };
  }

  async function updateCall(data = {}) {
    const fallbackTicketId = cleanText(data.ticketId, 120);
    const callSid = cleanText(data.callSid, 80);
    if (!fallbackTicketId || !callSid) throw new Error("Ticket and call IDs are required.");
    const callLogRef = callLogReference(callSid);
    const callLogSnapshot = await callLogRef.get();
    const ticketId = cleanText(callLogSnapshot.exists ? callLogSnapshot.data()?.ticketId : "", 120) ||
      fallbackTicketId;
    const ticketRef = db.collection("supportTickets").doc(ticketId);
    const messageRef = ticketRef.collection("messages").doc(providerDocumentId("call", callSid));
    const now = clock();
    const nowIso = now.toISOString();
    const allowed = {};
    for (const key of [
      "callStatus", "disposition", "acceptedByStaffId", "acceptedByName",
      "dialCallSid", "dialCallDuration", "recordingSid", "recordingUrl",
      "recordingDuration", "recordingStatus", "recordingChannels",
      "recordingStartTime", "recordingSource", "providerStatus",
    ]) {
      if (data[key] !== undefined && data[key] !== null && data[key] !== "") {
        allowed[key] = typeof data[key] === "number" ? data[key] : cleanText(data[key], 1000);
      }
    }
    if (!Object.keys(allowed).length) return {ok: true, unchanged: true};
    const existingExpiry = cleanText(
        callLogSnapshot.exists ? callLogSnapshot.data()?.sensitiveContentExpiresAtIso : "",
        40,
    );
    const retention = (data.recordingSid || data.recordingUrl) ? {
      sensitiveContentExpiresAtIso: existingExpiry || contentExpiryIso(now),
    } : {};
    const batch = db.batch();
    batch.set(messageRef, {
      ...allowed,
      ...retention,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
      ...(data.disposition === "voicemail" ? {type: "voicemail", body: "Customer left a voicemail."} : {}),
      ...(data.disposition === "unanswered" ? {body: "Call was not answered."} : {}),
      ...(data.disposition === "answered" ? {body: "Call was answered."} : {}),
    }, {merge: true});
    batch.set(callLogRef, {
      ...allowed,
      ...retention,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
    }, {merge: true});
    batch.update(ticketRef, {
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: nowIso,
      ...(data.disposition === "voicemail" ? {unread: true, status: "new"} : {}),
      ...(data.disposition === "answered" ? {
        unread: false,
        status: "in_progress",
        needsCaseMatch: true,
        ...(cleanText(data.acceptedByName, 100) ? {
          assignedTo: cleanText(data.acceptedByName, 100),
        } : {}),
      } : {}),
    });
    await batch.commit();
    return {ok: true};
  }

  async function recordTranscriptionEvent(data = {}) {
    const fallbackTicketId = cleanText(data.ticketId, 120);
    const callSid = cleanText(data.callSid, 80);
    if (!fallbackTicketId || !callSid) throw new Error("Ticket and call IDs are required.");
    const event = cleanText(data.TranscriptionEvent || data.EventType, 60).toLowerCase();
    if (!new Set([
      "transcription-started", "transcription-content", "transcription-stopped",
      "transcription-error",
    ]).has(event)) {
      return {ok: true, ignored: true};
    }
    if (event === "transcription-content" &&
        !(data.Final === true || cleanText(data.Final, 10).toLowerCase() === "true")) {
      return {ok: true, ignored: true};
    }

    const callLogRef = callLogReference(callSid);
    let result = {ok: true, missing: true};
    await db.runTransaction(async (transaction) => {
      const callLogSnapshot = await transaction.get(callLogRef);
      if (!callLogSnapshot.exists) return;
      const callLog = callLogSnapshot.data() || {};
      const ticketId = cleanText(callLog.ticketId, 120) || fallbackTicketId;
      const ticketRef = db.collection("supportTickets").doc(ticketId);
      const messageRef = ticketRef.collection("messages").doc(providerDocumentId("call", callSid));
      const now = clock();
      const nowIso = now.toISOString();
      const sensitiveContentExpiresAtIso =
        cleanText(callLog.sensitiveContentExpiresAtIso, 40) || contentExpiryIso(now);
      let segments = Array.isArray(callLog.transcriptSegments) ?
        callLog.transcriptSegments.slice(-MAX_TRANSCRIPT_SEGMENTS) : [];

      if (event === "transcription-content") {
        const content = parseTranscriptionData(data.TranscriptionData);
        const text = cleanText(content.transcript || content.text, MAX_TRANSCRIPT_SEGMENT_LENGTH);
        if (text) {
          const track = cleanText(data.Track, 40);
          const segmentId = [
            cleanText(data.TranscriptionSid, 100),
            track,
            cleanText(data.SequenceId, 40),
          ].join(":");
          if (!segments.some((segment) => segment.id === segmentId)) {
            segments.push({
              id: segmentId,
              speaker: transcriptionSpeaker(track),
              text,
              track,
              sequenceId: cleanText(data.SequenceId, 40),
              timestamp: cleanText(data.Timestamp, 80),
              confidence: Number.isFinite(Number(content.confidence)) ?
                Number(content.confidence) : null,
            });
            segments.sort((left, right) =>
              (Number(left.sequenceId) || 0) - (Number(right.sequenceId) || 0) ||
              String(left.timestamp || "").localeCompare(String(right.timestamp || "")),
            );
            segments = segments.slice(-MAX_TRANSCRIPT_SEGMENTS);
          }
        }
      }

      const transcriptStatus = event === "transcription-stopped" ? "ready" :
        event === "transcription-error" ? "failed" : "transcribing";
      const transcriptText = transcriptTextFor(segments);
      const common = {
        transcriptionSid: cleanText(data.TranscriptionSid, 100) ||
          cleanText(callLog.transcriptionSid, 100),
        transcriptStatus,
        transcriptSegments: segments,
        transcriptText,
        transcriptSegmentCount: segments.length,
        transcriptLanguage: cleanText(data.LanguageCode, 20) || "en-US",
        transcriptDisclaimer: "Machine-generated transcript. Verify important details against the recording.",
        sensitiveContentExpiresAtIso,
        transcriptUpdatedAt: serverTimestamp(),
        transcriptUpdatedAtIso: nowIso,
        ...(event === "transcription-error" ? {
          transcriptErrorCode: cleanText(data.ErrorCode, 80),
          transcriptError: cleanText(data.Error || data.ErrorMessage, 500) ||
            "Transcription failed.",
        } : {}),
      };
      transaction.set(callLogRef, {
        ...common,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      }, {merge: true});
      transaction.set(messageRef, {
        type: "call",
        channel: "phone",
        callSid,
        provider: "twilio",
        ...common,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      }, {merge: true});
      if (event === "transcription-stopped" || event === "transcription-error") {
        transaction.set(ticketRef, {
          updatedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          lastActivityAtIso: nowIso,
        }, {merge: true});
      }
      result = {ok: true, ticketId, transcriptStatus, transcriptSegmentCount: segments.length};
    });
    return result;
  }

  async function purgeExpiredCallContent({deleteRecording, limit = 200} = {}) {
    if (typeof deleteRecording !== "function") {
      throw new Error("A recording deletion handler is required.");
    }
    const parsedLimit = Number(limit);
    const resultLimit = Number.isFinite(parsedLimit) ?
      Math.min(500, Math.max(1, Math.floor(parsedLimit))) : 200;
    const now = clock();
    const nowIso = now.toISOString();
    const snapshot = await db.collection("supportCallLogs")
        .where("sensitiveContentExpiresAtIso", "<=", nowIso)
        .limit(resultLimit)
        .get();
    const summary = {checked: snapshot.docs.length, purged: 0, retrying: 0};
    const deleteField = () => admin.firestore.FieldValue.delete();

    for (const document of snapshot.docs) {
      const call = document.data() || {};
      const recordingSid = cleanText(call.recordingSid, 100);
      let recordingDeleted = !recordingSid;
      let recordingError = "";
      if (recordingSid) {
        try {
          await deleteRecording(recordingSid);
          recordingDeleted = true;
        } catch (error) {
          recordingError = cleanText(error?.message || "Twilio recording deletion failed.", 500);
        }
      }

      const transcriptPurge = {
        transcriptionSid: deleteField(),
        transcriptSegments: deleteField(),
        transcriptText: deleteField(),
        transcriptSegmentCount: 0,
        transcriptLanguage: deleteField(),
        transcriptDisclaimer: deleteField(),
        transcriptErrorCode: deleteField(),
        transcriptError: deleteField(),
        transcriptUpdatedAt: deleteField(),
        transcriptUpdatedAtIso: deleteField(),
        transcriptStatus: "purged",
        transcriptPurgedAt: serverTimestamp(),
        transcriptPurgedAtIso: nowIso,
      };
      const recordingPurge = recordingDeleted ? {
        recordingSid: deleteField(),
        recordingUrl: deleteField(),
        recordingStatus: "purged",
        recordingChannels: deleteField(),
        recordingStartTime: deleteField(),
        recordingSource: deleteField(),
        recordingPurgeError: deleteField(),
        recordingPurgedAt: serverTimestamp(),
        recordingPurgedAtIso: nowIso,
        sensitiveContentExpiresAtIso: deleteField(),
        sensitiveContentPurgedAt: serverTimestamp(),
        sensitiveContentPurgedAtIso: nowIso,
      } : {
        recordingPurgeError: recordingError,
        recordingPurgeAttemptedAt: serverTimestamp(),
        recordingPurgeAttemptedAtIso: nowIso,
      };
      const update = {
        ...transcriptPurge,
        ...recordingPurge,
        retentionDays: CALL_CONTENT_RETENTION_DAYS,
        purgeAttempts: Math.max(0, Number(call.purgeAttempts) || 0) + 1,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      };
      const batch = db.batch();
      batch.set(callLogDocumentReference(document.id), update, {merge: true});
      const callSid = cleanText(call.callSid, 80);
      const ticketIds = [...new Set([
        ...(Array.isArray(call.ticketHistory) ? call.ticketHistory : []),
        cleanText(call.ticketId, 120),
      ].filter(Boolean))];
      if (callSid) {
        for (const ticketId of ticketIds) {
          const messageRef = db.collection("supportTickets").doc(ticketId)
              .collection("messages").doc(providerDocumentId("call", callSid));
          batch.set(messageRef, update, {merge: true});
        }
      }
      await batch.commit();
      if (recordingDeleted) summary.purged += 1;
      else summary.retrying += 1;
    }
    return summary;
  }

  async function requestCallback({ticketId, callSid} = {}) {
    const normalizedTicketId = cleanText(ticketId, 120);
    const normalizedCallSid = cleanText(callSid, 80);
    if (!normalizedTicketId || !normalizedCallSid) {
      throw new Error("Ticket and call IDs are required.");
    }
    const ticketRef = db.collection("supportTickets").doc(normalizedTicketId);
    const ticketSnapshot = await ticketRef.get();
    if (!ticketSnapshot.exists) throw new Error("Support ticket was not found.");
    const ticket = ticketSnapshot.data() || {};
    const callbackPhone = normalizeE164(ticket.customer?.phoneE164 || ticket.customer?.phone);
    const messageRef = ticketRef.collection("messages").doc(providerDocumentId("call", normalizedCallSid));
    const now = clock();
    const nowIso = now.toISOString();
    const body = "Customer requested a callback at the number they called from.";
    const batch = db.batch();
    batch.set(messageRef, {
      type: "call",
      disposition: "callback_requested",
      callbackRequested: true,
      callbackPhone,
      body,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
    }, {merge: true});
    batch.set(callLogReference(normalizedCallSid), {
      disposition: "callback_requested",
      callbackRequested: true,
      callbackPhone,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
    }, {merge: true});
    batch.update(ticketRef, {
      requestType: "callback",
      subject: `Callback requested from ${callbackPhone}`,
      message: body,
      status: "new",
      priority: "high",
      unread: true,
      callback: {
        status: "requested",
        phone: callbackPhone,
        sourceCallSid: normalizedCallSid,
        requestedAt: serverTimestamp(),
        requestedAtIso: nowIso,
      },
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: nowIso,
    });
    await batch.commit();
    return {ok: true, ticketId: normalizedTicketId, callbackPhone};
  }

  async function sendSmsReply(data = {}, authState = {}, options = {}) {
    if (typeof sendMessage !== "function") throw new Error("SMS delivery is not configured.");
    const ticketId = cleanText(data.ticketId, 120);
    const rawBody = typeof data.body === "string" ? data.body.trim() : "";
    if (rawBody.length > MAX_SMS_BODY_LENGTH) {
      throw new Error(`SMS messages must be ${MAX_SMS_BODY_LENGTH} characters or fewer.`);
    }
    const body = cleanText(rawBody, MAX_SMS_BODY_LENGTH);
    if (!ticketId || !body) throw new Error("A ticket and SMS message are required.");
    const ticketRef = db.collection("supportTickets").doc(ticketId);
    const snapshot = await ticketRef.get();
    if (!snapshot.exists) throw new Error("Support ticket was not found.");
    const ticket = snapshot.data() || {};
    const to = normalizeE164(ticket.customer?.phoneE164 || ticket.customer?.phone);
    const from = normalizeE164(options.fromNumber);
    const messagingServiceSid = cleanText(options.messagingServiceSid, 80);
    const richTemplate = options.richTemplate && typeof options.richTemplate === "object" ?
      options.richTemplate : null;
    if (cleanText(data.templateId, 120) && !richTemplate) {
      throw new Error("That rich-message template is not available.");
    }
    const messageRef = ticketRef.collection("messages").doc();
    const startedAt = clock();
    await messageRef.set({
      type: "message",
      direction: "outbound",
      channel: "sms",
      requestedChannel: messagingServiceSid ? "rcs_or_sms" : "sms",
      templateId: cleanText(richTemplate?.id, 120),
      contentSid: cleanText(richTemplate?.contentSid, 80),
      from,
      to,
      body,
      authorUid: cleanText(authState.uid, 160),
      authorName: actorName(authState),
      deliveryStatus: "sending",
      provider: "twilio",
      createdAt: serverTimestamp(),
      createdAtIso: startedAt.toISOString(),
    });

    try {
      const messageRequest = {
        to,
        statusCallback: options.statusCallbackUrl?.({ticketId, messageDocId: messageRef.id}),
      };
      if (messagingServiceSid) {
        messageRequest.messagingServiceSid = messagingServiceSid;
        messageRequest.fallbackFrom = from;
      } else {
        messageRequest.from = from;
      }
      if (richTemplate) {
        messageRequest.contentSid = cleanText(richTemplate.contentSid, 80);
        messageRequest.contentVariables = JSON.stringify({"1": body});
      } else {
        messageRequest.body = body;
      }
      const sent = await sendMessage(messageRequest);
      const nowIso = clock().toISOString();
      const batch = db.batch();
      batch.update(messageRef, {
        externalMessageId: cleanText(sent?.sid, 100),
        providerStatus: cleanText(sent?.status, 40) || "queued",
        deliveryStatus: deliveryStatus(sent?.status || "queued"),
        sentAt: serverTimestamp(),
        sentAtIso: nowIso,
      });
      batch.update(ticketRef, {
        status: "in_progress",
        unread: false,
        message: body,
        replyChannel: "sms",
        lastReplyAt: serverTimestamp(),
        lastReplyAtIso: nowIso,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        lastActivityAtIso: nowIso,
        updatedBy: actorName(authState),
      });
      await batch.commit();
      return {ok: true, ticketId, messageId: cleanText(sent?.sid, 100)};
    } catch (error) {
      const nowIso = clock().toISOString();
      const batch = db.batch();
      batch.update(messageRef, {
        deliveryStatus: "failed",
        deliveryError: "SMS delivery failed.",
        failedAt: serverTimestamp(),
        failedAtIso: nowIso,
      });
      batch.update(ticketRef, {
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        lastActivityAtIso: nowIso,
        updatedBy: actorName(authState),
      });
      await batch.commit();
      throw error;
    }
  }

  async function updateSmsStatus(data = {}) {
    const ticketId = cleanText(data.ticketId, 120);
    const messageDocId = cleanText(data.messageDocId, 120);
    if (!ticketId || !messageDocId) throw new Error("SMS callback identifiers are required.");
    const providerStatus = cleanText(data.providerStatus, 40).toLowerCase();
    const ref = db.collection("supportTickets").doc(ticketId)
        .collection("messages").doc(messageDocId);
    await ref.set({
      providerStatus,
      deliveryStatus: deliveryStatus(providerStatus),
      ...(cleanText(data.channelPrefix, 20) ? {
        providerChannel: cleanText(data.channelPrefix, 20).toLowerCase(),
      } : {}),
      ...(cleanText(data.errorCode, 40) ? {providerErrorCode: cleanText(data.errorCode, 40)} : {}),
      updatedAt: serverTimestamp(),
      updatedAtIso: clock().toISOString(),
    }, {merge: true});
    return {ok: true};
  }

  return {
    assertCaseAccess,
    beginCallRouting,
    callRoutingWaitState,
    claimCallRouting,
    expireCallRouting,
    importInboundCall,
    importInboundSms,
    importOutboundCall,
    linkCallToCase,
    listActiveCases,
    listCallLogs,
    listRoutingStaff,
    recordRoutingAttempt,
    recordTranscriptionEvent,
    purgeExpiredCallContent,
    resolveCase,
    sendSmsReply,
    requestCallback,
    updateCall,
    updateSmsStatus,
    upsertRoutingStaff,
    setVoiceAvailability,
    setVoiceRoutingMode,
    startRoutingGroup,
    voiceRoutingMode,
    voiceStaffForIdentity,
    voiceStaffForUser,
  };
}

module.exports = {
  CALL_CONTENT_RETENTION_DAYS,
  MAX_SMS_BODY_LENGTH,
  WELCOME_AUTO_REPLY_BODY,
  DELIVERY_MODES,
  ROUTING_GROUPS,
  createSupportTelephonyService,
  deliveryStatus,
  inboundMessagingChannel,
  isSupportAppProfile,
  memberCanReceiveSupportNumber,
  normalizeE164,
  normalizeSupportNumbers,
  normalizeCustomerAddress,
  normalizeDeliveryMode,
  normalizeRoutingGroup,
  normalizeStaffInput,
  normalizeVoiceRoutingMode,
  callTicketId,
  phoneTicketId,
  providerDocumentId,
  profileSupportNumbers,
  staffSupportNumbers,
  supportLineForCall,
  ticketCallSupportNumbers,
  splitRoutingStaff,
  staffSort,
  voiceIdentityFor,
};
