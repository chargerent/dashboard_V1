/* eslint-env node */

const {normalizeSupportNumbers, ticketCallSupportNumbers} = require("./supportTelephony");

const ACTIVE_TICKET_STATUSES = new Set(["new", "in_progress", "waiting_customer"]);
const CANADIAN_AREA_CODES = new Set([
  "204", "226", "236", "249", "250", "257", "263", "289", "306", "343",
  "354", "365", "367", "368", "382", "403", "416", "418", "428", "431",
  "437", "438", "450", "468", "474", "506", "514", "519", "548", "579",
  "581", "584", "587", "604", "613", "639", "647", "672", "683", "705",
  "709", "742", "753", "778", "780", "782", "807", "819", "825", "867",
  "873", "879", "902", "905",
]);

function cleanText(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanIdentifier(value, maxLength = 200) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLength);
}

function cleanDocumentId(value, label) {
  const id = cleanText(value, 200);
  if (!id || id.includes("/")) throw new Error(`${label} ID is invalid.`);
  return id;
}

function normalizeLastFour(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(digits)) throw new Error("Enter the last four digits of the card used.");
  return digits;
}

function normalizeChargerId(value) {
  const chargerId = cleanIdentifier(value, 40).toUpperCase();
  if (!/^[A-Z0-9_-]{4,40}$/.test(chargerId)) {
    throw new Error("Enter a valid charger ID.");
  }
  return chargerId;
}

function rentalChargerId(rental = {}) {
  return cleanIdentifier(rental.sn ?? rental.chargerid, 40).toUpperCase();
}

function normalizedSupportScope(value) {
  return value === undefined || value === null ? null : normalizeSupportNumbers(value);
}

function supportNumberCountry(value) {
  const digits = cleanIdentifier(value, 40).replace(/\D/g, "");
  if (digits.startsWith("33")) return "FR";
  if (digits.startsWith("1") && digits.length >= 4) {
    return CANADIAN_AREA_CODES.has(digits.slice(1, 4)) ? "CA" : "US";
  }
  return "";
}

function rentalStationCountry(rental = {}) {
  const stationId = cleanIdentifier(rental.rentalStationid, 80).toUpperCase();
  if (stationId.startsWith("CA")) return "CA";
  if (stationId.startsWith("FR")) return "FR";
  if (stationId.startsWith("US")) return "US";
  return "";
}

function ticketSupportCountry(ticket = {}) {
  const details = ticket.details && typeof ticket.details === "object" ? ticket.details : {};
  const supportNumber = cleanIdentifier(
      details.twilioSupportNumber || details.twilioSupportAddress ||
      ticketCallSupportNumbers(ticket)[0],
      40,
  );
  return supportNumberCountry(supportNumber);
}

function ticketMatchesSupportScope(ticket = {}, scope = null) {
  return scope === null || ticketCallSupportNumbers(ticket)
      .some((number) => scope.includes(number));
}

function messageMatchesSupportScope(message = {}, scope = null) {
  if (scope === null) return true;
  const direction = cleanText(message.direction, 20).toLowerCase();
  const address = direction === "outbound" ? message.from : message.to;
  try {
    return normalizeSupportNumbers(address).some((number) => scope.includes(number));
  } catch {
    return false;
  }
}

function isoString(value) {
  if (!value) return "";
  if (typeof value === "string") return cleanText(value, 80);
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Number.isFinite(Number(value._seconds ?? value.seconds))) {
    return new Date(Number(value._seconds ?? value.seconds) * 1000).toISOString();
  }
  return "";
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mobileRentalChargeAmount(rental = {}) {
  const status = cleanText(rental.status, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (!["returned", "refunded", "purchased"].includes(status)) return null;
  return finiteNumber(rental.totalCharged ?? rental.buyprice);
}

function rentalActivityIso(rental = {}) {
  return isoString(
      rental.returnTime || rental.rentalTime || rental.rentedAt ||
      rental.createdAt || rental.updatedAt,
  );
}

function rentalChronologyMillis(rental = {}) {
  const value = isoString(
      rental.rentalTime || rental.rentedAt || rental.createdAt || rental.updatedAt,
  );
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
}

function mobileRentalSummary(id, rental = {}, station = {}) {
  return {
    id,
    orderId: cleanIdentifier(
        rental.orderid || rental.rawid || rental.transactionid ||
        rental.transactionId || rental.paymentSessionId || id,
        200,
    ),
    transactionId: cleanIdentifier(
        rental.transactionid || rental.transactionId || rental.paymentSessionId ||
        rental.rawid || rental.orderid,
        200,
    ),
    cardLastFour: String(rental.card_last4 ?? "").replace(/\D/g, "").slice(-4),
    chargerId: cleanIdentifier(rental.sn || rental.chargerid, 120),
    stationId: cleanIdentifier(rental.rentalStationid, 80),
    location: cleanText(
        rental.rentalLocation || rental.rentalPlace || station.info?.location || station.info?.place,
        180,
    ),
    rentalTime: isoString(rental.rentalTime || rental.rentedAt || rental.createdAt),
    returnTime: isoString(rental.returnTime),
    status: cleanText(rental.status, 80),
    totalCharged: mobileRentalChargeAmount(rental),
    symbol: cleanText(rental.symbol, 8) || "$",
    refundStatus: cleanText(rental.refundStatus || rental.refund_status, 80),
    refundAmount: finiteNumber(rental.refundAmount),
    refundDate: isoString(rental.refundDate),
    gateway: cleanText(rental.gateway || station.hardware?.gateway, 80),
    activityAtIso: rentalActivityIso(rental),
  };
}

function linkedRentalPayload(id, rental = {}) {
  const summary = mobileRentalSummary(id, rental);
  return {
    documentId: id,
    rawid: cleanIdentifier(rental.rawid, 200),
    orderid: cleanIdentifier(rental.orderid, 200),
    transactionid: cleanIdentifier(rental.transactionid || rental.transactionId, 200),
    cardLastFour: summary.cardLastFour,
    chargerId: summary.chargerId,
    rentalStationid: summary.stationId,
    rentalLocation: summary.location,
    rentalTime: summary.rentalTime,
    returnStationid: cleanText(rental.returnStationid || rental.returnStationId, 80),
    returnTime: summary.returnTime,
    status: summary.status,
    refundStatus: summary.refundStatus,
    refundDate: summary.refundDate,
    totalCharged: summary.totalCharged,
    refundAmount: summary.refundAmount,
    symbol: summary.symbol,
    chargerLocation: null,
  };
}

function mobileConversationSummary(id, ticket = {}) {
  const customer = ticket.customer && typeof ticket.customer === "object" ? ticket.customer : {};
  return {
    id,
    displayTicketNumber: cleanText(ticket.displayTicketNumber || ticket.ticketNumber || id, 120),
    subject: cleanText(ticket.subject, 300) || "Customer text",
    status: cleanText(ticket.status, 40) || "new",
    customerName: cleanText(customer.name, 160),
    customerPhone: cleanText(customer.phoneE164 || customer.phone, 40),
    lastMessage: cleanText(ticket.message, 1000),
    unread: ticket.unread === true,
    lastActivityAtIso: cleanText(ticket.lastActivityAtIso || ticket.updatedAtIso, 80),
  };
}

function mobileTextMessage(id, message = {}) {
  return {
    id,
    direction: cleanText(message.direction, 20) || "inbound",
    channel: cleanText(message.providerChannel || message.channel, 20) || "sms",
    body: cleanText(message.body, 12000),
    buttonText: cleanText(message.buttonText, 200),
    buttonPayload: cleanText(message.buttonPayload, 500),
    deliveryStatus: cleanText(message.deliveryStatus || message.providerStatus, 40),
    createdAtIso: cleanText(message.createdAtIso, 80) || isoString(message.createdAt),
  };
}

function normalizeMessagingConfig(value = {}) {
  const messagingServiceSid = cleanText(value.messagingServiceSid, 80);
  const rcsEnabled = value.rcsEnabled === true && /^MG[a-fA-F0-9]{32}$/.test(messagingServiceSid);
  const templates = Array.isArray(value.richTemplates) ? value.richTemplates
      .map((template) => ({
        id: cleanText(template?.id, 120),
        name: cleanText(template?.name, 120),
        description: cleanText(template?.description, 300),
        contentSid: cleanText(template?.contentSid, 80),
      }))
      .filter((template) => template.id && template.name && /^HX[a-fA-F0-9]{32}$/.test(template.contentSid)) : [];
  return {
    brandName: cleanText(value.brandName, 120) || "Chargerent",
    logoConfigured: value.logoConfigured === true,
    messagingServiceSid,
    rcsEnabled,
    senderStatus: cleanText(value.senderStatus, 80) || "setup_required",
    templates,
  };
}

function createSupportMobileService({db, admin, ticketService, telephonyService, clock = () => new Date()}) {
  if (!db || !admin || !ticketService || !telephonyService) {
    throw new Error("Support mobile dependencies are required.");
  }
  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  async function getTicket(ticketId) {
    const id = cleanDocumentId(ticketId, "Support case");
    const ref = db.collection("supportTickets").doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error("Support case was not found.");
    return {id, ref, ticket: snapshot.data() || {}};
  }

  async function messagingConfig() {
    const snapshot = await db.collection("supportTelephonyConfig").doc("messaging").get();
    return normalizeMessagingConfig(snapshot.exists ? snapshot.data() || {} : {});
  }

  async function messagingCapabilities() {
    const config = await messagingConfig();
    return {
      ok: true,
      brandName: config.brandName,
      logoConfigured: config.logoConfigured,
      rcsEnabled: config.rcsEnabled,
      senderStatus: config.senderStatus,
      templates: config.templates.map(({id, name, description}) => ({id, name, description})),
    };
  }

  async function searchRentals(data = {}, authState = {}) {
    const {id: ticketId, ref: ticketRef, ticket} = await getTicket(data.ticketId);
    const searchMode = cleanText(data.searchMode, 40) === "charger_id" ?
      "charger_id" : "card_last_four";
    const cardLastFour = searchMode === "card_last_four" ?
      normalizeLastFour(data.cardLastFour) : "";
    const chargerId = searchMode === "charger_id" ? normalizeChargerId(data.chargerId) : "";
    const supportCountry = ticketSupportCountry(ticket);
    if (!supportCountry) {
      throw new Error("This case does not identify the country of the support number dialed.");
    }
    const queries = searchMode === "charger_id" ? [
      ["sn", chargerId],
      ["chargerid", chargerId],
      ...(/^\d+$/.test(chargerId) ? [
        ["sn", Number(chargerId)],
        ["chargerid", Number(chargerId)],
      ] : []),
    ] : [
      ["card_last4", cardLastFour],
      ["card_last4", Number(cardLastFour)],
    ];
    const snapshots = await Promise.all(queries.map(([field, value]) => db.collection("rentals")
        .where(field, "==", value)
        .get()));
    const matches = new Map();
    for (const snapshot of snapshots) {
      for (const document of snapshot.docs) matches.set(document.id, document.data() || {});
    }
    const candidates = [...matches]
        .filter(([, rental]) => rentalStationCountry(rental) === supportCountry)
        .sort((left, right) =>
          rentalChronologyMillis(right[1]) - rentalChronologyMillis(left[1]))
        .slice(0, 20);
    const stationIds = [...new Set(candidates
        .map(([, rental]) => cleanText(rental.rentalStationid, 80))
        .filter(Boolean))];
    const stationSnapshots = await Promise.all(stationIds.map((stationId) => db.collection("kiosks")
        .where("stationid", "==", stationId)
        .limit(1)
        .get()));
    const stations = new Map();
    stationSnapshots.forEach((snapshot, index) => {
      if (snapshot.docs[0]) stations.set(stationIds[index], snapshot.docs[0].data() || {});
    });
    const rentals = candidates.map(([id, rental]) => mobileRentalSummary(
        id,
        rental,
        stations.get(cleanText(rental.rentalStationid, 80)) || {},
    ));
    const nowIso = clock().toISOString();
    await ticketRef.set({
      ...(searchMode === "card_last_four" ? {
        payment: {...(ticket.payment || {}), cardLastFour},
      } : {}),
      details: {
        ...(ticket.details || {}),
        rentalSearchMode: searchMode,
        ...(cardLastFour ? {cardLastFour} : {}),
        ...(chargerId ? {chargerId} : {}),
      },
      needsCaseMatch: true,
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: nowIso,
      updatedBy: cleanText(
          authState.profile?.displayName || authState.profile?.username || authState.uid,
          160,
      ),
    }, {merge: true});
    return {ok: true, ticketId, searchMode, cardLastFour, chargerId, rentals};
  }

  async function matchRental(data = {}, authState = {}) {
    const {id: ticketId, ref: ticketRef, ticket} = await getTicket(data.ticketId);
    const rentalId = cleanDocumentId(data.rentalId, "Rental");
    const rentalSnapshot = await db.collection("rentals").doc(rentalId).get();
    if (!rentalSnapshot.exists) throw new Error("Rental was not found.");
    const rental = rentalSnapshot.data() || {};
    const searchMode = ticket.details?.rentalSearchMode === "charger_id" ?
      "charger_id" : "card_last_four";
    if (searchMode === "charger_id") {
      const searchedChargerId = normalizeChargerId(ticket.details?.chargerId);
      if (rentalChargerId(rental) !== searchedChargerId) {
        throw new Error("This rental does not match the charger ID saved on the case.");
      }
    } else {
      const searchedLastFour = normalizeLastFour(
          ticket.payment?.cardLastFour || ticket.details?.cardLastFour,
      );
      if (String(rental.card_last4 ?? "").replace(/\D/g, "").slice(-4) !== searchedLastFour) {
        throw new Error("This rental does not match the card last four saved on the case.");
      }
    }
    const supportCountry = ticketSupportCountry(ticket);
    if (!supportCountry || rentalStationCountry(rental) !== supportCountry) {
      throw new Error("This rental is not from a kiosk in the country of the support number dialed.");
    }
    await ticketService.updateTicket({
      ticketId,
      changes: {linkedRental: linkedRentalPayload(rentalId, rental)},
    }, authState);
    await ticketRef.set({needsCaseMatch: false}, {merge: true});
    return {ok: true, ticketId, rental: mobileRentalSummary(rentalId, rental)};
  }

  async function listTextConversations(requestedLimit = 100, supportNumbers = undefined) {
    const parsedLimit = Number(requestedLimit);
    const resultLimit = Number.isFinite(parsedLimit) ?
      Math.min(150, Math.max(1, Math.floor(parsedLimit))) : 100;
    const snapshot = await db.collection("supportTickets")
        .orderBy("lastActivityAtIso", "desc")
        .limit(300)
        .get();
    const scope = normalizedSupportScope(supportNumbers);
    return snapshot.docs
        .map((document) => ({
          conversation: mobileConversationSummary(document.id, document.data() || {}),
          ticket: document.data() || {},
        }))
        .filter(({conversation}) => conversation.customerPhone)
        .filter(({ticket}) => ["sms", "rcs"].includes(ticket.source) ||
          ["sms", "rcs"].includes(ticket.channel))
        .filter(({ticket}) => ticketMatchesSupportScope(ticket, scope))
        .map(({conversation}) => scope === null ? conversation : {
          ...conversation,
          lastMessage: "",
        })
        .slice(0, resultLimit);
  }

  async function listTextMessages(data = {}, supportNumbers = undefined) {
    await telephonyService.assertCaseAccess(data.ticketId, supportNumbers);
    const {id, ref, ticket} = await getTicket(data.ticketId);
    const customerPhone = cleanText(ticket.customer?.phoneE164 || ticket.customer?.phone, 40);
    if (!customerPhone) throw new Error("This support case does not have a customer phone number.");
    const parsedLimit = Number(data.limit);
    const resultLimit = Number.isFinite(parsedLimit) ?
      Math.min(300, Math.max(1, Math.floor(parsedLimit))) : 200;
    const snapshot = await ref.collection("messages")
        .orderBy("createdAtIso", "asc")
        .limit(resultLimit)
        .get();
    const messages = snapshot.docs
        .map((document) => ({id: document.id, data: document.data() || {}}))
        .filter(({data: message}) => ["sms", "rcs"].includes(message.channel))
        .filter(({data: message}) => messageMatchesSupportScope(message, normalizedSupportScope(supportNumbers)))
        .map(({id: messageId, data: message}) => mobileTextMessage(messageId, message));
    if (ticket.unread === true) {
      await ref.set({unread: false, updatedAt: serverTimestamp()}, {merge: true});
    }
    return {
      ok: true,
      conversation: mobileConversationSummary(id, {...ticket, unread: false}),
      messages,
    };
  }

  async function sendText(data = {}, authState = {}, options = {}) {
    await telephonyService.assertCaseAccess(data.ticketId, options.supportNumbers);
    const config = await messagingConfig();
    const templateId = cleanText(data.templateId, 120);
    const richTemplate = templateId ? config.templates.find((template) => template.id === templateId) : null;
    if (templateId && (!config.rcsEnabled || !richTemplate)) {
      throw new Error("Branded RCS messaging is not ready for that template.");
    }
    return telephonyService.sendSmsReply(data, authState, {
      ...options,
      messagingServiceSid: config.rcsEnabled ? config.messagingServiceSid : "",
      richTemplate,
    });
  }

  return {
    listTextConversations,
    listTextMessages,
    matchRental,
    messagingCapabilities,
    searchRentals,
    sendText,
  };
}

module.exports = {
  ACTIVE_TICKET_STATUSES,
  createSupportMobileService,
  linkedRentalPayload,
  mobileConversationSummary,
  mobileRentalChargeAmount,
  mobileRentalSummary,
  mobileTextMessage,
  normalizeMessagingConfig,
  normalizeChargerId,
  normalizeLastFour,
  rentalChargerId,
  rentalChronologyMillis,
  rentalStationCountry,
  messageMatchesSupportScope,
  supportNumberCountry,
  ticketSupportCountry,
  ticketMatchesSupportScope,
};
