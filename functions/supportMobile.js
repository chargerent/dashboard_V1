/* eslint-env node */

const ACTIVE_TICKET_STATUSES = new Set(["new", "in_progress", "waiting_customer"]);

function cleanText(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

function rentalActivityIso(rental = {}) {
  return isoString(
      rental.returnTime || rental.rentalTime || rental.rentedAt ||
      rental.createdAt || rental.updatedAt,
  );
}

function mobileRentalSummary(id, rental = {}, station = {}) {
  return {
    id,
    orderId: cleanText(
        rental.orderid || rental.rawid || rental.transactionid ||
        rental.transactionId || rental.paymentSessionId || id,
        200,
    ),
    transactionId: cleanText(
        rental.transactionid || rental.transactionId || rental.paymentSessionId ||
        rental.rawid || rental.orderid,
        200,
    ),
    cardLastFour: String(rental.card_last4 ?? "").replace(/\D/g, "").slice(-4),
    chargerId: cleanText(rental.sn || rental.chargerid, 120),
    stationId: cleanText(rental.rentalStationid, 80),
    location: cleanText(
        rental.rentalLocation || rental.rentalPlace || station.info?.location || station.info?.place,
        180,
    ),
    rentalTime: isoString(rental.rentalTime || rental.rentedAt || rental.createdAt),
    returnTime: isoString(rental.returnTime),
    status: cleanText(rental.status, 80),
    totalCharged: finiteNumber(rental.totalCharged ?? rental.buyprice),
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
    rawid: cleanText(rental.rawid, 200),
    orderid: cleanText(rental.orderid, 200),
    transactionid: cleanText(rental.transactionid || rental.transactionId, 200),
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
    const cardLastFour = normalizeLastFour(data.cardLastFour);
    const values = [cardLastFour, Number(cardLastFour)];
    const snapshots = await Promise.all(values.map((value) => db.collection("rentals")
        .where("card_last4", "==", value)
        .limit(100)
        .get()));
    const matches = new Map();
    for (const snapshot of snapshots) {
      for (const document of snapshot.docs) matches.set(document.id, document.data() || {});
    }
    const candidates = [...matches]
        .sort((left, right) => rentalActivityIso(right[1]).localeCompare(rentalActivityIso(left[1])))
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
      payment: {...(ticket.payment || {}), cardLastFour},
      details: {...(ticket.details || {}), cardLastFour},
      needsCaseMatch: true,
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: nowIso,
      updatedBy: cleanText(
          authState.profile?.displayName || authState.profile?.username || authState.uid,
          160,
      ),
    }, {merge: true});
    return {ok: true, ticketId, cardLastFour, rentals};
  }

  async function matchRental(data = {}, authState = {}) {
    const {id: ticketId, ref: ticketRef, ticket} = await getTicket(data.ticketId);
    const rentalId = cleanDocumentId(data.rentalId, "Rental");
    const rentalSnapshot = await db.collection("rentals").doc(rentalId).get();
    if (!rentalSnapshot.exists) throw new Error("Rental was not found.");
    const rental = rentalSnapshot.data() || {};
    const searchedLastFour = normalizeLastFour(
        ticket.payment?.cardLastFour || ticket.details?.cardLastFour,
    );
    if (String(rental.card_last4 ?? "").replace(/\D/g, "").slice(-4) !== searchedLastFour) {
      throw new Error("This rental does not match the card last four saved on the case.");
    }
    await ticketService.updateTicket({
      ticketId,
      changes: {linkedRental: linkedRentalPayload(rentalId, rental)},
    }, authState);
    await ticketRef.set({needsCaseMatch: false}, {merge: true});
    return {ok: true, ticketId, rental: mobileRentalSummary(rentalId, rental)};
  }

  async function listTextConversations(requestedLimit = 100) {
    const parsedLimit = Number(requestedLimit);
    const resultLimit = Number.isFinite(parsedLimit) ?
      Math.min(150, Math.max(1, Math.floor(parsedLimit))) : 100;
    const snapshot = await db.collection("supportTickets")
        .orderBy("lastActivityAtIso", "desc")
        .limit(300)
        .get();
    return snapshot.docs
        .map((document) => mobileConversationSummary(document.id, document.data() || {}))
        .filter((conversation) => conversation.customerPhone)
        .filter((conversation) => {
          const ticket = snapshot.docs.find((document) => document.id === conversation.id)?.data() || {};
          return ["sms", "rcs"].includes(ticket.source) ||
            ["sms", "rcs"].includes(ticket.channel);
        })
        .slice(0, resultLimit);
  }

  async function listTextMessages(data = {}) {
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
  mobileRentalSummary,
  mobileTextMessage,
  normalizeMessagingConfig,
  normalizeLastFour,
};
