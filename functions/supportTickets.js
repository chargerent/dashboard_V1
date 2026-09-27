/* eslint-env node */
const crypto = require("node:crypto");

const SUPPORT_CATEGORIES = new Set(["customer_support", "sales", "partnership", "general"]);
const SUPPORT_STATUSES = new Set(["new", "in_progress", "waiting_customer", "resolved", "closed"]);
const SUPPORT_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const SUPPORT_SOURCES = new Set(["website", "email", "chatbot", "sms", "phone", "quo", "manual"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISNEY_CHATBOT_REASONS = new Map([
  ["no_unit_dispensed", "No charger dispensed"],
  ["faulty_powerbank", "Faulty charger"],
  ["charged_30_returned", "Charged 30 after return"],
  ["double_charge", "Double charge"],
  ["wrong_amount", "Wrong amount charged"],
  ["other", "Other"],
]);
const DISNEY_CHATBOT_PAYMENT_METHODS = new Set([
  "physical_card",
  "apple_pay",
  "google_pay",
]);
const DISNEY_CHATBOT_LANGUAGES = new Set([
  "en", "fr", "es", "de", "it", "pt", "nl", "ru", "zh", "ja", "ar", "pl",
]);
const DISNEY_CHATBOT_AMOUNTS = new Set([5, 10, 30]);
const DISNEY_CHATBOT_STATIONS = Object.freeze({
  S01: {name: "Station 1", location: "City Hall", zone: "A", park: "Disneyland Park"},
  S02: {name: "Station 2", location: "Main Street Station", zone: "A", park: "Disneyland Park"},
  S03: {name: "Station 3", location: "Main Street Station", zone: "A", park: "Disneyland Park"},
  S04: {name: "Station 4", location: "Main Street Station", zone: "A", park: "Disneyland Park"},
  S05: {name: "Station 5", location: "Main Street Station", zone: "A", park: "Disneyland Park"},
  S06: {name: "Station 6", location: "Strollers", zone: "A", park: "Disneyland Park"},
  S07: {name: "Station 7", location: "Café Hyperion", zone: "A", park: "Disneyland Park"},
  S08: {name: "Station 8", location: "Café Hyperion", zone: "A", park: "Disneyland Park"},
  S10: {name: "Station 10", location: "Bella Notte", zone: "A", park: "Disneyland Park"},
  S20: {name: "Station 20", location: "World Premiere", zone: "B", park: "Walt Disney Studios"},
  S21: {name: "Station 21", location: "Animation Celebration", zone: "B", park: "Walt Disney Studios"},
  S22: {name: "Station 22", location: "Avengers Campus", zone: "B", park: "Walt Disney Studios"},
  S23: {name: "Station 23", location: "Studio Services", zone: "B", park: "Walt Disney Studios"},
  S24: {name: "Station 24", location: "The Regal View", zone: "B", park: "Walt Disney Studios"},
  S25: {name: "Station 25", location: "Café Luminosity", zone: "B", park: "Walt Disney Studios"},
  S26: {name: "Station 26", location: "World of Frozen", zone: "B", park: "Walt Disney Studios"},
  S27: {name: "Station 27", location: "World Premiere", zone: "B", park: "Walt Disney Studios"},
  S30: {name: "Station 30", location: "Sports Bar", zone: "C", park: "Disney Village"},
  unknown: {name: "Unknown station", location: "Guest did not remember", zone: "", park: ""},
});
const SUPPORT_REPLY_SENDERS = Object.freeze({
  support: Object.freeze({
    key: "support",
    name: "Chargerent Customer Support",
    email: "support@charge.rent",
    categories: Object.freeze(["customer_support", "general"]),
  }),
  george: Object.freeze({
    key: "george",
    name: "George at Charge.rent",
    email: "george@charge.rent",
    categories: Object.freeze(["sales", "partnership"]),
  }),
  arthur: Object.freeze({
    key: "arthur",
    name: "Arthur at Charge.rent",
    email: "arthur@charge.rent",
    categories: Object.freeze(["sales", "partnership"]),
  }),
});

function cleanText(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : "";
}

function cleanNumber(value, {min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null} = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanId(value, fallbackPrefix = "CR") {
  const normalized = cleanText(value, 120).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || `${fallbackPrefix}-${crypto.randomUUID()}`;
}

function resolveReplySender(category, requestedSenderKey) {
  const normalizedCategory = SUPPORT_CATEGORIES.has(category) ? category : "general";
  const defaultKey = ["sales", "partnership"].includes(normalizedCategory) ? "george" : "support";
  const senderKey = cleanText(requestedSenderKey, 30).toLowerCase() || defaultKey;
  const sender = SUPPORT_REPLY_SENDERS[senderKey];
  if (!sender || !sender.categories.includes(normalizedCategory)) {
    throw new Error(`The selected sender cannot reply to ${normalizedCategory.replaceAll("_", " ")} inquiries.`);
  }
  return sender;
}

function requestCategory(requestType) {
  if (requestType === "event" || requestType === "venue") return "sales";
  if (requestType === "vending") return "partnership";
  if (requestType === "other") return "customer_support";
  return "general";
}

const TICKET_PREFIXES = {
  customer_support: "CS",
  sales: "SL",
  partnership: "PT",
  general: "GN",
};

function supportTicketDisplayNumber(ticketNumber, category = "general") {
  const storedNumber = cleanText(ticketNumber, 120);
  if (/^(CS|SL|PT|GN)-[A-Z0-9]{4,10}$/i.test(storedNumber)) return storedNumber.toUpperCase();
  const compactId = storedNumber.replace(/^Q-/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const prefix = TICKET_PREFIXES[category] || TICKET_PREFIXES.general;
  return `${prefix}-${(compactId.slice(0, 6) || "000000").padEnd(6, "0")}`;
}

function ticketTokenFromSubject(subject) {
  const match = cleanText(subject, 300).match(/\[((?:CS|SL|PT|GN)-[A-Z0-9]{4,10})\]/i);
  return match?.[1]?.toUpperCase() || "";
}

function inferEmailCategory(subject, body) {
  const haystack = `${cleanText(subject, 300)} ${cleanText(body, 12000)}`.toLowerCase();
  if (/\b(partner|partnership|distributor|reseller|vending operator|revenue share)\b/.test(haystack)) {
    return "partnership";
  }
  if (/\b(event|venue|proposal|quote|pricing|purchase|installation|sponsor|conference|festival)\b/.test(haystack)) {
    return "sales";
  }
  if (/\b(rental|charger|charge(?:d|s)?|refund|return(?:ed)?|card|apple pay|google pay|kiosk)\b/.test(haystack)) {
    return "customer_support";
  }
  return "general";
}

function inferChatbotCategory(intent, subject, body) {
  const normalizedIntent = cleanText(intent, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (["partnership", "partner", "distributor", "reseller", "vending"].includes(normalizedIntent)) {
    return "partnership";
  }
  if (["sales", "event", "venue", "quote", "pricing", "purchase"].includes(normalizedIntent)) {
    return "sales";
  }
  if ([
    "customer_support",
    "charge_concern",
    "refund",
    "return",
    "rental",
    "payment",
    "charger",
  ].includes(normalizedIntent)) {
    return "customer_support";
  }
  return inferEmailCategory(subject, `${normalizedIntent} ${body}`);
}

function externalMessageDocumentId(externalMessageId) {
  const normalized = cleanText(externalMessageId, 500);
  return normalized ?
    `external-${crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 40)}` :
    "";
}

function chatbotTicketNumber(provider, conversationId) {
  const identity = `${cleanText(provider, 80).toLowerCase() || "chatbot"}:${cleanText(conversationId, 500)}`;
  return `CHAT-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

function cleanIsoTimestamp(value, fallback) {
  const raw = cleanText(value, 80);
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error("The chatbot event timestamp is invalid.");
  return parsed.toISOString();
}

function isDisneyChatbotSubmission(payload) {
  return [
    "session_id",
    "chat_transcript",
    "station_id",
    "card_last4",
    "amount_requested",
  ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function disneyChatbotStationLabel(stationId, station) {
  if (stationId === "unknown") return station.location;
  return `${stationId} · ${station.name} — ${station.location} — ${station.park}`;
}

function normalizeDisneyChatbotSubmission(payload) {
  const reason = cleanText(payload.reason, 80);
  const stationId = cleanText(payload.station_id, 30);
  const paymentMethod = cleanText(payload.payment_method, 50);
  const cardLastFour = cleanText(payload.card_last4, 100);
  const language = cleanText(payload.language, 20).toLowerCase();
  const sessionId = cleanText(payload.session_id, 500);
  const transcript = cleanText(payload.chat_transcript, 12000);
  const reasonDetail = cleanText(payload.reason_detail, 1000);
  const rawEmail = payload.guest_email === null ? "" : cleanText(payload.guest_email, 254);
  const email = cleanEmail(rawEmail);
  const amountRequested = Number(payload.amount_requested);
  const station = DISNEY_CHATBOT_STATIONS[stationId];
  const submittedAt = cleanText(payload.submitted_at, 80);

  if (!DISNEY_CHATBOT_REASONS.has(reason)) {
    throw new Error("The Disney chatbot reason is invalid.");
  }
  if (!station) throw new Error("The Disney chatbot station ID is invalid.");
  if (!DISNEY_CHATBOT_PAYMENT_METHODS.has(paymentMethod)) {
    throw new Error("The Disney chatbot payment method is invalid.");
  }
  if (!/^\d{4}$/.test(cardLastFour)) {
    throw new Error("Card information must contain exactly the last four digits.");
  }
  if (!DISNEY_CHATBOT_AMOUNTS.has(amountRequested)) {
    throw new Error("The Disney chatbot requested amount is invalid.");
  }
  if (rawEmail && !email) throw new Error("The chatbot customer email address is invalid.");
  if (!DISNEY_CHATBOT_LANGUAGES.has(language)) {
    throw new Error("The Disney chatbot language is invalid.");
  }
  if (!sessionId || !transcript) {
    throw new Error("A Disney chatbot session ID and chat transcript are required.");
  }
  if (!submittedAt) throw new Error("The Disney chatbot submission timestamp is required.");
  const normalizedSubmittedAt = cleanIsoTimestamp(submittedAt, "");
  const rentalDate = cleanText(payload.rental_date, 30) || normalizedSubmittedAt.slice(0, 10);
  if (rentalDate && !/^\d{4}-\d{2}-\d{2}$/.test(rentalDate)) {
    throw new Error("The Disney chatbot rental date must use YYYY-MM-DD.");
  }

  const stationLabel = disneyChatbotStationLabel(stationId, station);
  return {
    provider: "disney-chatbot",
    conversationId: sessionId,
    messageId: `submission:${sessionId}`,
    eventType: "refund_request.submitted",
    occurredAt: normalizedSubmittedAt,
    intent: "refund",
    category: "customer_support",
    subject: `Disney chatbot request — ${stationId === "unknown" ? "station unknown" : `${stationId} · ${station.location}`}`,
    customer: {email, locale: language},
    rental: {
      location: stationLabel,
      date: rentalDate,
      cardLastFour,
    },
    message: transcript,
    disneySubmission: {
      reason,
      reasonLabel: DISNEY_CHATBOT_REASONS.get(reason),
      reasonDetail,
      stationId,
      stationName: station.name,
      stationLocation: station.location,
      stationZone: station.zone,
      stationPark: station.park,
      paymentMethod,
      amountRequested,
      language,
      sessionId,
    },
  };
}

function normalizeChatbotEvent(payload, {createdAt = null, createdAtIso = new Date().toISOString()} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("A chatbot event payload is required.");
  }
  const eventPayload = isDisneyChatbotSubmission(payload) ?
    normalizeDisneyChatbotSubmission(payload) : payload;
  const disneySubmission = eventPayload.disneySubmission || null;
  const provider = cleanText(eventPayload.provider, 80) || "chatbot";
  const conversationId = cleanText(eventPayload.conversationId, 500);
  const externalMessageId = cleanText(eventPayload.messageId || eventPayload.eventId, 500);
  const body = cleanText(eventPayload.message || eventPayload.body, 12000);
  if (!conversationId || !externalMessageId || !body) {
    throw new Error("A conversation ID, message ID, and message body are required.");
  }

  const rawCustomer = eventPayload.customer && typeof eventPayload.customer === "object" && !Array.isArray(eventPayload.customer) ?
    eventPayload.customer : {};
  const rawRental = eventPayload.rental && typeof eventPayload.rental === "object" && !Array.isArray(eventPayload.rental) ?
    eventPayload.rental : {};
  const rawEmail = cleanText(rawCustomer.email, 254);
  const email = cleanEmail(rawEmail);
  if (rawEmail && !email) throw new Error("The chatbot customer email address is invalid.");
  const rawCardLastFour = cleanText(rawRental.cardLastFour || eventPayload.cardLastFour, 100);
  if (rawCardLastFour && !/^\d{4}$/.test(rawCardLastFour)) {
    throw new Error("Card information must contain exactly the last four digits.");
  }

  const subject = cleanText(eventPayload.subject, 300);
  const intent = cleanText(eventPayload.intent, 80);
  const requestedCategory = cleanText(eventPayload.category, 50);
  const category = SUPPORT_CATEGORIES.has(requestedCategory) ?
    requestedCategory : inferChatbotCategory(intent, subject, body);
  const customerName = cleanText(rawCustomer.name, 100) || "Chatbot customer";
  const rentalLocation = cleanText(rawRental.location || rawRental.rentalLocation, 150);
  const receivedAtIso = cleanIsoTimestamp(eventPayload.occurredAt || eventPayload.receivedAt, createdAtIso);
  const eventType = cleanText(eventPayload.eventType, 80) || "message.created";
  const ticketNumber = chatbotTicketNumber(provider, conversationId);
  const displayTicketNumber = supportTicketDisplayNumber(ticketNumber, category);
  const subjectContext = rentalLocation || customerName || "Online chat";
  const normalizedSubject = subject || (
    category === "customer_support" ? `Chatbot customer support — ${subjectContext}` :
    category === "sales" ? `Chatbot sales inquiry — ${subjectContext}` :
    category === "partnership" ? `Chatbot partnership inquiry — ${subjectContext}` :
    `Chatbot inquiry — ${subjectContext}`
  );
  const locale = rawCustomer.locale === "fr" || eventPayload.locale === "fr" ? "fr" : "en";
  const replyChannel = email ? "email" : "chatbot";
  const details = {
    rentalLocation,
    rentalDate: cleanText(rawRental.date || rawRental.rentalDate, 30),
    cardLastFour: rawCardLastFour,
    locale,
    chatbotIntent: intent,
    chatbotEventType: eventType,
    chatbotHandoffReason: cleanText(eventPayload.handoffReason, 500),
    chatbotPageUrl: cleanText(eventPayload.pageUrl, 1000),
    chatbotConfidence: cleanNumber(eventPayload.confidence, {min: 0, max: 1, fallback: null}),
    ...(disneySubmission ? {
      chatbotReason: disneySubmission.reason,
      chatbotReasonLabel: disneySubmission.reasonLabel,
      chatbotReasonDetail: disneySubmission.reasonDetail,
      chatbotStationId: disneySubmission.stationId,
      chatbotStationName: disneySubmission.stationName,
      chatbotStationLocation: disneySubmission.stationLocation,
      chatbotStationZone: disneySubmission.stationZone,
      chatbotStationPark: disneySubmission.stationPark,
      paymentMethod: disneySubmission.paymentMethod,
      amountRequested: disneySubmission.amountRequested,
      amountCurrency: "EUR",
      submittedLanguage: disneySubmission.language,
      chatbotSessionId: disneySubmission.sessionId,
    } : {}),
  };
  const customerUpdates = {
    ...(cleanText(rawCustomer.name, 100) ? {name: cleanText(rawCustomer.name, 100)} : {}),
    ...(email ? {email} : {}),
    ...(cleanText(rawCustomer.phone, 40) ? {phone: cleanText(rawCustomer.phone, 40)} : {}),
    ...(cleanText(rawCustomer.company, 150) ? {company: cleanText(rawCustomer.company, 150)} : {}),
    ...(cleanText(rawCustomer.role, 100) ? {role: cleanText(rawCustomer.role, 100)} : {}),
  };
  const detailsUpdates = {
    ...(rentalLocation ? {rentalLocation} : {}),
    ...(details.rentalDate ? {rentalDate: details.rentalDate} : {}),
    ...(rawCardLastFour ? {cardLastFour: rawCardLastFour} : {}),
    ...(["en", "fr"].includes(rawCustomer.locale) || ["en", "fr"].includes(eventPayload.locale) ? {locale} : {}),
    ...(intent ? {chatbotIntent: intent} : {}),
    ...(eventType ? {chatbotEventType: eventType} : {}),
    ...(details.chatbotHandoffReason ? {chatbotHandoffReason: details.chatbotHandoffReason} : {}),
    ...(details.chatbotPageUrl ? {chatbotPageUrl: details.chatbotPageUrl} : {}),
    ...(details.chatbotConfidence !== null ? {chatbotConfidence: details.chatbotConfidence} : {}),
    ...(disneySubmission ? {
      chatbotReason: details.chatbotReason,
      chatbotReasonLabel: details.chatbotReasonLabel,
      ...(details.chatbotReasonDetail ? {chatbotReasonDetail: details.chatbotReasonDetail} : {}),
      chatbotStationId: details.chatbotStationId,
      chatbotStationName: details.chatbotStationName,
      chatbotStationLocation: details.chatbotStationLocation,
      chatbotStationZone: details.chatbotStationZone,
      chatbotStationPark: details.chatbotStationPark,
      paymentMethod: details.paymentMethod,
      amountRequested: details.amountRequested,
      amountCurrency: details.amountCurrency,
      submittedLanguage: details.submittedLanguage,
      chatbotSessionId: details.chatbotSessionId,
      locale,
    } : {}),
  };

  return {
    id: ticketNumber,
    externalMessageId,
    customerUpdates,
    detailsUpdates,
    ticket: {
      schemaVersion: 1,
      ticketNumber,
      displayTicketNumber,
      source: "chatbot",
      channel: "chatbot",
      category,
      requestType: "chatbot",
      subject: normalizedSubject,
      status: "new",
      priority: "normal",
      unread: true,
      assignedTo: "",
      customer: {
        name: customerName,
        email,
        phone: cleanText(rawCustomer.phone, 40),
        company: cleanText(rawCustomer.company, 150),
        role: cleanText(rawCustomer.role, 100),
      },
      payment: {cardLastFour: rawCardLastFour},
      details,
      message: body,
      createdAt,
      createdAtIso: receivedAtIso,
      updatedAt: createdAt,
      lastActivityAt: createdAt,
      lastActivityAtIso: receivedAtIso,
      lastInboundAt: createdAt,
      lastInboundAtIso: receivedAtIso,
      replyAddress: "support@charge.rent",
      replyChannel,
      linkedRental: null,
      chatbotProvider: provider,
      chatbotConversationId: conversationId,
      lastInboundChatbotMessageId: externalMessageId,
    },
    message: {
      type: "message",
      direction: "inbound",
      channel: "chatbot",
      from: email || "chatbot-user",
      to: "support@charge.rent",
      subject: normalizedSubject,
      body,
      externalMessageId,
      externalThreadId: conversationId,
      provider,
      eventType,
      intent,
      createdAt,
      createdAtIso: receivedAtIso,
    },
  };
}

function subjectForLead(lead, category) {
  if (category === "customer_support") {
    return `Customer service request — ${cleanText(lead.rentalLocation, 150) || cleanText(lead.name, 100) || "Website"}`;
  }
  if (category === "partnership") {
    return `Partnership inquiry — ${cleanText(lead.cityRegion, 120) || cleanText(lead.company, 150) || "Website"}`;
  }
  if (lead.requestType === "event") {
    const date = cleanText(lead.eventStartDate || lead.eventDate, 30);
    return `Event request — ${cleanText(lead.eventCity, 120) || cleanText(lead.company, 150) || "Website"}${date ? ` — ${date}` : ""}`;
  }
  if (category === "sales") {
    return `Venue request — ${cleanText(lead.company, 150) || cleanText(lead.name, 100) || "Website"}`;
  }
  return `General inquiry — ${cleanText(lead.name, 100) || "Website"}`;
}

function normalizeAttribution(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const normalizeTouch = (touch) => {
    if (!touch || typeof touch !== "object" || Array.isArray(touch)) return null;
    const normalized = {
      page: cleanText(touch.page, 1000),
      referrer: cleanText(touch.referrer, 1000),
      utmSource: cleanText(touch.utmSource, 200),
      utmMedium: cleanText(touch.utmMedium, 200),
      utmCampaign: cleanText(touch.utmCampaign, 300),
      utmTerm: cleanText(touch.utmTerm, 300),
      utmContent: cleanText(touch.utmContent, 300),
      gclid: cleanText(touch.gclid, 500),
      gbraid: cleanText(touch.gbraid, 500),
      wbraid: cleanText(touch.wbraid, 500),
      msclkid: cleanText(touch.msclkid, 500),
    };
    return Object.values(normalized).some(Boolean) ? normalized : null;
  };
  const normalized = {
    first: normalizeTouch(input.first),
    last: normalizeTouch(input.last),
    submissionPage: cleanText(input.submissionPage, 1000),
    analyticsConsent: ["granted", "denied", "unset"].includes(input.analyticsConsent) ? input.analyticsConsent : "unset",
  };
  return normalized.first || normalized.last || normalized.submissionPage ? normalized : null;
}

function normalizePublicSubmission(payload, {createdAt = null, createdAtIso = new Date().toISOString()} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("A submission payload is required.");
  }
  const lead = payload.lead && typeof payload.lead === "object" && !Array.isArray(payload.lead) ? payload.lead : {};
  const requestType = ["event", "venue", "vending", "other"].includes(lead.requestType) ? lead.requestType : "other";
  const requestedCategory = cleanText(payload.category, 50);
  const category = SUPPORT_CATEGORIES.has(requestedCategory) ? requestedCategory : requestCategory(requestType);
  const email = cleanEmail(lead.email);
  const name = cleanText(lead.name, 100);
  if (!name || !email) throw new Error("A valid name and email address are required.");

  const ticketNumber = cleanId(payload.quoteId || payload.ticketId);
  const displayTicketNumber = supportTicketDisplayNumber(ticketNumber, category);
  const rawCardLastFour = cleanText(lead.cardLastFour, 100);
  if (rawCardLastFour && !/^\d{4}$/.test(rawCardLastFour)) {
    throw new Error("Card information must contain exactly the last four digits.");
  }
  const cardLastFour = rawCardLastFour;

  const details = {
    venueType: cleanText(lead.venueType, 80),
    venueCity: cleanText(lead.venueCity, 120),
    numberOfLocations: cleanNumber(lead.numberOfLocations, {min: 1, max: 10000, fallback: null}),
    estimatedFootTraffic: cleanText(lead.estimatedFootTraffic, 50),
    eventName: cleanText(lead.eventName, 150),
    eventVenue: cleanText(lead.eventVenue, 150),
    eventStartDate: cleanText(lead.eventStartDate || lead.eventDate, 30),
    eventEndDate: cleanText(lead.eventEndDate, 30),
    eventCity: cleanText(lead.eventCity, 120),
    estimatedAttendance: cleanText(lead.estimatedAttendance, 20),
    machineCount: cleanNumber(lead.machineCount, {min: 1, max: 100000, fallback: null}),
    cityRegion: cleanText(lead.cityRegion, 120),
    locationTypes: cleanText(lead.locationTypes, 300),
    routeSoftware: cleanText(lead.routeSoftware, 100),
    preferredCommercialModel: cleanText(lead.preferredCommercialModel, 50),
    partnershipInterest: cleanText(lead.partnershipInterest, 80),
    rentalLocation: cleanText(lead.rentalLocation, 150),
    rentalDate: cleanText(lead.rentalDate, 30),
    cardLastFour,
    howHeard: cleanText(lead.howHeard, 80),
    locale: lead.locale === "fr" ? "fr" : "en",
  };

  return {
    id: ticketNumber,
    ticket: {
      schemaVersion: 1,
      ticketNumber,
      displayTicketNumber,
      source: "website",
      channel: "web_form",
      category,
      requestType,
      subject: subjectForLead(lead, category),
      status: "new",
      priority: "normal",
      unread: true,
      assignedTo: "",
      customer: {
        name,
        email,
        phone: cleanText(lead.phone, 40),
        company: cleanText(lead.company, 150),
        role: cleanText(lead.role, 100),
      },
      payment: {cardLastFour},
      details,
      message: cleanText(lead.message, 3000),
      attribution: normalizeAttribution(lead.attribution),
      createdAt,
      createdAtIso: cleanText(payload.submittedAt, 50) || createdAtIso,
      updatedAt: createdAt,
      lastActivityAt: createdAt,
      lastActivityAtIso: cleanText(payload.submittedAt, 50) || createdAtIso,
      replyAddress: "support@charge.rent",
      linkedRental: null,
    },
  };
}

function cleanLinkedRental(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Linked rental data is invalid.");
  }
  const chargerLocation = value.chargerLocation && typeof value.chargerLocation === "object" ? {
    stationId: cleanText(value.chargerLocation.stationId, 80),
    location: cleanText(value.chargerLocation.location, 150),
    moduleId: cleanText(value.chargerLocation.moduleId, 80),
    slotId: cleanText(String(value.chargerLocation.slotId ?? ""), 30),
    chargerId: cleanText(value.chargerLocation.chargerId, 120),
  } : null;
  return {
    documentId: cleanText(value.documentId, 200),
    rawid: cleanText(value.rawid, 200),
    orderid: cleanText(value.orderid, 200),
    transactionid: cleanText(value.transactionid, 200),
    cardLastFour: cleanText(value.cardLastFour, 4).replace(/\D/g, "").slice(0, 4),
    chargerId: cleanText(value.chargerId, 120),
    rentalStationid: cleanText(value.rentalStationid, 80),
    rentalLocation: cleanText(value.rentalLocation, 150),
    rentalTime: cleanText(value.rentalTime, 80),
    returnStationid: cleanText(value.returnStationid, 80),
    returnTime: cleanText(value.returnTime, 80),
    status: cleanText(value.status, 80),
    refundStatus: cleanText(value.refundStatus, 80),
    refundDate: cleanText(value.refundDate, 80),
    totalCharged: cleanNumber(value.totalCharged, {min: 0, max: 1000000, fallback: null}),
    refundAmount: cleanNumber(value.refundAmount, {min: 0, max: 1000000, fallback: null}),
    symbol: cleanText(value.symbol, 8),
    chargerLocation,
  };
}

function normalizeTicketChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new Error("Ticket changes are required.");
  }
  const next = {};
  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    if (!SUPPORT_STATUSES.has(changes.status)) throw new Error("Unsupported ticket status.");
    next.status = changes.status;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "category")) {
    if (!SUPPORT_CATEGORIES.has(changes.category)) throw new Error("Unsupported ticket category.");
    next.category = changes.category;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
    if (!SUPPORT_PRIORITIES.has(changes.priority)) throw new Error("Unsupported ticket priority.");
    next.priority = changes.priority;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "assignedTo")) {
    next.assignedTo = cleanText(changes.assignedTo, 160);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "unread")) {
    next.unread = changes.unread === true;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "linkedRental")) {
    next.linkedRental = cleanLinkedRental(changes.linkedRental);
  }
  if (Object.keys(next).length === 0) throw new Error("No supported ticket changes were provided.");
  return next;
}

function describeChanges(changes) {
  const parts = [];
  if (changes.status) parts.push(`Status changed to ${changes.status.replaceAll("_", " ")}`);
  if (changes.category) parts.push(`Category changed to ${changes.category.replaceAll("_", " ")}`);
  if (changes.priority) parts.push(`Priority changed to ${changes.priority}`);
  if (Object.prototype.hasOwnProperty.call(changes, "assignedTo")) parts.push(changes.assignedTo ? `Assigned to ${changes.assignedTo}` : "Assignment cleared");
  if (Object.prototype.hasOwnProperty.call(changes, "linkedRental")) parts.push(changes.linkedRental ? "Rental linked" : "Rental link removed");
  if (Object.prototype.hasOwnProperty.call(changes, "unread")) parts.push(changes.unread ? "Marked unread" : "Marked read");
  return parts.join(" · ");
}

function actorName(authState) {
  return cleanText(authState?.profile?.username || authState?.profile?.contact?.name || authState?.uid, 160) || "Dashboard admin";
}

function ensureTicketToken(subject, ticketNumber) {
  const cleanSubject = cleanText(subject, 300);
  const token = `[${ticketNumber}]`;
  if (cleanSubject.includes(token)) return cleanSubject;
  return `${cleanSubject || "Chargerent inquiry"} ${token}`;
}

function createSupportTicketService({db, admin, sendEmail = null, clock = () => new Date()}) {
  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  async function createPublicTicket(payload) {
    const now = clock();
    const normalized = normalizePublicSubmission(payload, {
      createdAt: serverTimestamp(),
      createdAtIso: now.toISOString(),
    });
    const ticketRef = db.collection("supportTickets").doc(normalized.id);
    const messageRef = ticketRef.collection("messages").doc();
    let duplicate = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ticketRef);
      if (snapshot.exists) {
        duplicate = true;
        return;
      }
      transaction.set(ticketRef, normalized.ticket);
      transaction.set(messageRef, {
        type: "form_submission",
        direction: "inbound",
        channel: "website",
        body: normalized.ticket.message || "Website form submitted without an additional message.",
        from: normalized.ticket.customer.email,
        createdAt: serverTimestamp(),
        createdAtIso: normalized.ticket.createdAtIso,
      });
    });
    return {ok: true, ticketId: normalized.id, duplicate};
  }

  async function importChatbotEvent(payload) {
    const now = clock();
    const normalized = normalizeChatbotEvent(payload, {
      createdAt: serverTimestamp(),
      createdAtIso: now.toISOString(),
    });
    const ticketRef = db.collection("supportTickets").doc(normalized.id);
    const messageRef = ticketRef.collection("messages").doc(
        externalMessageDocumentId(normalized.externalMessageId),
    );
    let duplicate = false;
    let created = false;
    await db.runTransaction(async (transaction) => {
      const [ticketSnapshot, messageSnapshot] = await Promise.all([
        transaction.get(ticketRef),
        transaction.get(messageRef),
      ]);
      if (messageSnapshot.exists) {
        duplicate = true;
        return;
      }
      if (!ticketSnapshot.exists) {
        created = true;
        transaction.set(ticketRef, normalized.ticket);
      } else {
        const existing = ticketSnapshot.data() || {};
        const existingCustomer = existing.customer && typeof existing.customer === "object" ? existing.customer : {};
        const existingPayment = existing.payment && typeof existing.payment === "object" ? existing.payment : {};
        const existingDetails = existing.details && typeof existing.details === "object" ? existing.details : {};
        transaction.update(ticketRef, {
          source: "chatbot",
          channel: "chatbot",
          status: "new",
          unread: true,
          customer: {...existingCustomer, ...normalized.customerUpdates},
          payment: {
            ...existingPayment,
            ...(normalized.ticket.payment.cardLastFour ? normalized.ticket.payment : {}),
          },
          details: {...existingDetails, ...normalized.detailsUpdates},
          replyChannel: normalized.customerUpdates.email ? "email" :
            (existing.replyChannel || normalized.ticket.replyChannel),
          chatbotProvider: normalized.ticket.chatbotProvider,
          chatbotConversationId: normalized.ticket.chatbotConversationId,
          lastInboundChatbotMessageId: normalized.externalMessageId,
          updatedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          lastActivityAtIso: normalized.message.createdAtIso,
          lastInboundAt: serverTimestamp(),
          lastInboundAtIso: normalized.message.createdAtIso,
        });
      }
      transaction.set(messageRef, normalized.message);
    });
    return {
      ok: true,
      ticketId: normalized.id,
      displayTicketNumber: normalized.ticket.displayTicketNumber,
      duplicate,
      created,
    };
  }

  async function getTicket(ticketId) {
    const normalizedId = cleanId(ticketId);
    let ref = db.collection("supportTickets").doc(normalizedId);
    let snapshot = await ref.get();
    if (!snapshot.exists && /^(CS|SL|PT|GN)-[A-Z0-9]{4,10}$/i.test(normalizedId)) {
      const aliasSnapshot = await db.collection("supportTickets")
          .where("displayTicketNumber", "==", normalizedId.toUpperCase())
          .limit(2)
          .get();
      if (aliasSnapshot.docs.length > 1) throw new Error("Support ticket number is ambiguous.");
      if (aliasSnapshot.docs.length === 1) {
        [snapshot] = aliasSnapshot.docs;
        ref = snapshot.ref;
      }
    }
    if (!snapshot.exists) throw new Error("Support ticket was not found.");
    return {ref, id: ref.id, ticket: snapshot.data() || {}};
  }

  async function updateTicket(data, authState) {
    const {ref, id} = await getTicket(data?.ticketId);
    const changes = normalizeTicketChanges(data?.changes);
    const summary = describeChanges(changes);
    const now = clock();
    const batch = db.batch();
    batch.update(ref, {
      ...changes,
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: now.toISOString(),
      updatedBy: actorName(authState),
    });
    if (summary && !Object.prototype.hasOwnProperty.call(changes, "unread")) {
      batch.set(ref.collection("messages").doc(), {
        type: "system",
        direction: "internal",
        channel: "dashboard",
        summary,
        body: summary,
        authorUid: cleanText(authState?.uid, 160),
        authorName: actorName(authState),
        createdAt: serverTimestamp(),
        createdAtIso: now.toISOString(),
      });
    }
    await batch.commit();
    return {ok: true, ticketId: id};
  }

  async function addNote(data, authState) {
    const {ref, id} = await getTicket(data?.ticketId);
    const body = cleanText(data?.body, 5000);
    if (!body) throw new Error("An internal note is required.");
    const now = clock();
    const batch = db.batch();
    batch.set(ref.collection("messages").doc(), {
      type: "internal_note",
      direction: "internal",
      channel: "dashboard",
      body,
      authorUid: cleanText(authState?.uid, 160),
      authorName: actorName(authState),
      createdAt: serverTimestamp(),
      createdAtIso: now.toISOString(),
    });
    batch.update(ref, {
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: now.toISOString(),
      updatedBy: actorName(authState),
    });
    await batch.commit();
    return {ok: true, ticketId: id};
  }

  async function saveDraft(data, authState) {
    const {ref, id, ticket} = await getTicket(data?.ticketId);
    const body = cleanText(data?.body, 12000);
    if (!body) throw new Error("A reply message is required.");
    const displayTicketNumber = supportTicketDisplayNumber(ticket.ticketNumber || id, ticket.category);
    const subject = ensureTicketToken(data?.subject, displayTicketNumber);
    const sender = resolveReplySender(ticket.category, data?.senderKey);
    const now = clock();
    const messageRef = ref.collection("messages").doc();
    const batch = db.batch();
    batch.set(messageRef, {
      type: "draft",
      direction: "outbound",
      channel: "email",
      from: sender.email,
      fromName: sender.name,
      senderKey: sender.key,
      to: cleanEmail(ticket.customer?.email),
      subject,
      body,
      authorUid: cleanText(authState?.uid, 160),
      authorName: actorName(authState),
      createdAt: serverTimestamp(),
      createdAtIso: now.toISOString(),
    });
    batch.update(ref, {
      displayTicketNumber,
      draftMessageId: messageRef.id,
      draftUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: now.toISOString(),
      updatedBy: actorName(authState),
    });
    await batch.commit();
    return {ok: true, ticketId: id, draftId: messageRef.id};
  }

  async function sendReply(data, authState) {
    if (typeof sendEmail !== "function") throw new Error("Support email delivery is not configured.");
    const {ref, id, ticket} = await getTicket(data?.ticketId);
    const to = cleanEmail(ticket.customer?.email);
    if (!to) throw new Error("This ticket does not have a valid customer email address.");
    const body = cleanText(data?.body, 12000);
    if (!body) throw new Error("A reply message is required.");
    const displayTicketNumber = supportTicketDisplayNumber(ticket.ticketNumber || id, ticket.category);
    const subject = ensureTicketToken(data?.subject, displayTicketNumber);
    const sender = resolveReplySender(ticket.category, data?.senderKey);
    const messageRef = ref.collection("messages").doc();
    const startedAt = clock();
    await messageRef.set({
      type: "email",
      direction: "outbound",
      channel: "email",
      deliveryStatus: "sending",
      from: sender.email,
      fromName: sender.name,
      senderKey: sender.key,
      to,
      subject,
      body,
      authorUid: cleanText(authState?.uid, 160),
      authorName: actorName(authState),
      createdAt: serverTimestamp(),
      createdAtIso: startedAt.toISOString(),
    });

    let result;
    try {
      const knownThreadIds = Array.isArray(ticket.gmailThreadIds) ? ticket.gmailThreadIds : [];
      result = await sendEmail({
        to,
        subject,
        body,
        ticketId: id,
        sender,
        gmailThreadId: cleanText(ticket.gmailThreadId, 500) || cleanText(knownThreadIds.at(-1), 500),
        inReplyTo: cleanText(ticket.lastInboundRfcMessageId, 500),
        references: cleanText(ticket.lastInboundReferences, 2000) || cleanText(ticket.lastInboundRfcMessageId, 500),
      });
    } catch (error) {
      const failedAt = clock();
      const failureBatch = db.batch();
      failureBatch.update(messageRef, {
        deliveryStatus: "failed",
        deliveryError: "Email delivery failed.",
        failedAt: serverTimestamp(),
        failedAtIso: failedAt.toISOString(),
      });
      failureBatch.update(ref, {
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        lastActivityAtIso: failedAt.toISOString(),
        updatedBy: actorName(authState),
      });
      await failureBatch.commit();
      throw error;
    }

    const now = clock();
    const externalThreadId = cleanText(result?.threadId, 500);
    const arrayUnion = admin.firestore.FieldValue.arrayUnion;
    const batch = db.batch();
    batch.update(messageRef, {
      deliveryStatus: "sent",
      externalMessageId: cleanText(result?.messageId, 500),
      ...(externalThreadId ? {externalThreadId} : {}),
      sentAt: serverTimestamp(),
      sentAtIso: now.toISOString(),
    });
    batch.update(ref, {
      displayTicketNumber,
      status: "waiting_customer",
      unread: false,
      lastReplyAt: serverTimestamp(),
      lastReplyAtIso: now.toISOString(),
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: now.toISOString(),
      updatedBy: actorName(authState),
      ...(externalThreadId ? {
        gmailThreadId: externalThreadId,
        ...(typeof arrayUnion === "function" ? {gmailThreadIds: arrayUnion(externalThreadId)} : {}),
      } : {}),
    });
    await batch.commit();
    return {ok: true, ticketId: id, messageId: cleanText(result?.messageId, 500)};
  }

  async function importMessage(data) {
    const subject = cleanText(data?.subject, 300);
    const subjectTicket = subject.match(/\[([A-Za-z0-9_-]{6,120})\]/)?.[1] || "";
    const ticketId = cleanId(data?.ticketId || subjectTicket);
    const {ref, id} = await getTicket(ticketId);
    const body = cleanText(data?.body, 12000);
    if (!body) throw new Error("An inbound message body is required.");
    const source = SUPPORT_SOURCES.has(data?.source) ? data.source : "email";
    const externalMessageId = cleanText(data?.messageId, 500);
    const messageId = externalMessageDocumentId(externalMessageId) || undefined;
    const messageRef = messageId ? ref.collection("messages").doc(messageId) : ref.collection("messages").doc();
    const existing = messageId ? await messageRef.get() : null;
    if (existing?.exists) return {ok: true, ticketId: id, duplicate: true};
    const now = clock();
    const externalThreadId = cleanText(data?.threadId, 500);
    const rfcMessageId = cleanText(data?.rfcMessageId, 500);
    const references = cleanText(data?.references, 2000);
    const arrayUnion = admin.firestore.FieldValue.arrayUnion;
    const batch = db.batch();
    batch.set(messageRef, {
      type: source === "phone" ? "call" : "message",
      direction: "inbound",
      channel: source,
      from: cleanText(data?.from, 254),
      to: cleanText(data?.to, 254) || "support@charge.rent",
      subject,
      body,
      externalMessageId,
      ...(externalThreadId ? {externalThreadId} : {}),
      ...(rfcMessageId ? {rfcMessageId} : {}),
      ...(cleanText(data?.inReplyTo, 500) ? {inReplyTo: cleanText(data.inReplyTo, 500)} : {}),
      ...(references ? {references} : {}),
      ...(cleanText(data?.matchMethod, 80) ? {matchMethod: cleanText(data.matchMethod, 80)} : {}),
      createdAt: serverTimestamp(),
      createdAtIso: cleanText(data?.receivedAt, 80) || now.toISOString(),
    });
    batch.update(ref, {
      ...(source === "email" ? {source: "email"} : {}),
      status: "new",
      unread: true,
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp(),
      lastActivityAtIso: now.toISOString(),
      lastInboundAt: serverTimestamp(),
      lastInboundAtIso: now.toISOString(),
      ...(externalThreadId ? {
        gmailThreadId: externalThreadId,
        ...(typeof arrayUnion === "function" ? {gmailThreadIds: arrayUnion(externalThreadId)} : {}),
      } : {}),
      ...(externalMessageId ? {lastInboundGmailMessageId: externalMessageId} : {}),
      ...(rfcMessageId ? {lastInboundRfcMessageId: rfcMessageId} : {}),
      ...(references ? {lastInboundReferences: references} : {}),
      emailMatchStatus: "matched",
    });
    await batch.commit();
    return {ok: true, ticketId: id, duplicate: false};
  }

  async function findInboundEmailTicket(data) {
    const explicitTicket = cleanText(data?.ticketId, 120) || ticketTokenFromSubject(data?.subject);
    if (explicitTicket) {
      try {
        const found = await getTicket(explicitTicket);
        return {ticketId: found.id, matchMethod: "ticket_token"};
      } catch {
        // Continue with thread and sender matching when an old or mistyped token is present.
      }
    }

    const threadId = cleanText(data?.threadId, 500);
    if (threadId) {
      const threadSnapshot = await db.collection("supportTickets")
          .where("gmailThreadIds", "array-contains", threadId)
          .limit(2)
          .get();
      if (threadSnapshot.docs.length === 1) {
        return {ticketId: threadSnapshot.docs[0].id, matchMethod: "gmail_thread"};
      }
    }

    const from = cleanEmail(data?.from);
    if (!from) return null;
    const customerSnapshot = await db.collection("supportTickets")
        .where("customer.email", "==", from)
        .limit(10)
        .get();
    const openTickets = customerSnapshot.docs.filter((document) => {
      const status = cleanText(document.data()?.status, 40);
      return !["resolved", "closed"].includes(status);
    });
    if (openTickets.length === 1) {
      return {ticketId: openTickets[0].id, matchMethod: "unique_open_customer"};
    }
    return null;
  }

  async function createInboundEmailTicket(data) {
    const externalMessageId = cleanText(data?.messageId, 500);
    const body = cleanText(data?.body, 12000);
    const from = cleanEmail(data?.from);
    if (!externalMessageId || !body || !from) {
      throw new Error("An inbound Gmail message ID, sender, and body are required.");
    }
    const subject = cleanText(data?.subject, 300) || "Email inquiry";
    const category = SUPPORT_CATEGORIES.has(data?.category) ?
      data.category : inferEmailCategory(subject, body);
    const ticketNumber = cleanId(
        data?.ticketId || `EMAIL-${crypto.createHash("sha256").update(externalMessageId).digest("hex").slice(0, 20)}`,
    );
    const displayTicketNumber = supportTicketDisplayNumber(ticketNumber, category);
    const ticketRef = db.collection("supportTickets").doc(ticketNumber);
    const messageRef = ticketRef.collection("messages").doc(externalMessageDocumentId(externalMessageId));
    const receivedAtIso = cleanText(data?.receivedAt, 80) || clock().toISOString();
    const threadId = cleanText(data?.threadId, 500);
    const rfcMessageId = cleanText(data?.rfcMessageId, 500);
    const references = cleanText(data?.references, 2000);
    const appearsToBeReply = /^(?:re|fwd?):/i.test(subject) ||
      Boolean(cleanText(data?.inReplyTo, 500) || references);
    let duplicate = false;

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ticketRef);
      if (snapshot.exists) {
        duplicate = true;
        return;
      }
      transaction.set(ticketRef, {
        schemaVersion: 1,
        ticketNumber,
        displayTicketNumber,
        source: "email",
        channel: "email",
        category,
        requestType: "email",
        subject,
        status: "new",
        priority: "normal",
        unread: true,
        assignedTo: "",
        customer: {
          name: cleanText(data?.fromName, 100) || from.split("@")[0],
          email: from,
          phone: "",
          company: "",
          role: "",
        },
        payment: {cardLastFour: ""},
        details: {},
        message: body,
        createdAt: serverTimestamp(),
        createdAtIso: receivedAtIso,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        lastActivityAtIso: receivedAtIso,
        lastInboundAt: serverTimestamp(),
        lastInboundAtIso: receivedAtIso,
        replyAddress: "support@charge.rent",
        linkedRental: null,
        needsCaseMatch: appearsToBeReply,
        emailMatchStatus: appearsToBeReply ? "unmatched_reply" : "new_email",
        ...(threadId ? {gmailThreadId: threadId, gmailThreadIds: [threadId]} : {}),
        lastInboundGmailMessageId: externalMessageId,
        ...(rfcMessageId ? {lastInboundRfcMessageId: rfcMessageId} : {}),
        ...(references ? {lastInboundReferences: references} : {}),
      });
      transaction.set(messageRef, {
        type: "message",
        direction: "inbound",
        channel: "email",
        from,
        to: cleanEmail(data?.to) || "support@charge.rent",
        subject,
        body,
        externalMessageId,
        ...(threadId ? {externalThreadId: threadId} : {}),
        ...(rfcMessageId ? {rfcMessageId} : {}),
        ...(cleanText(data?.inReplyTo, 500) ? {inReplyTo: cleanText(data.inReplyTo, 500)} : {}),
        ...(references ? {references} : {}),
        matchMethod: appearsToBeReply ? "unmatched_reply" : "new_email",
        createdAt: serverTimestamp(),
        createdAtIso: receivedAtIso,
      });
    });
    return {
      ok: true,
      ticketId: ticketNumber,
      duplicate,
      created: !duplicate,
      matchMethod: appearsToBeReply ? "unmatched_reply" : "new_email",
    };
  }

  async function importInboundEmail(data) {
    const match = await findInboundEmailTicket(data);
    if (!match) return createInboundEmailTicket(data);
    return importMessage({
      ...data,
      ticketId: match.ticketId,
      source: "email",
      matchMethod: match.matchMethod,
    });
  }

  return {
    createPublicTicket,
    importChatbotEvent,
    updateTicket,
    addNote,
    saveDraft,
    sendReply,
    importMessage,
    importInboundEmail,
  };
}

function secretsMatch(received, expected) {
  const left = Buffer.from(cleanText(received, 2000));
  const right = Buffer.from(cleanText(expected, 2000));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_REPLY_SENDERS,
  SUPPORT_STATUSES,
  createSupportTicketService,
  inferEmailCategory,
  inferChatbotCategory,
  normalizeChatbotEvent,
  normalizePublicSubmission,
  normalizeTicketChanges,
  requestCategory,
  resolveReplySender,
  secretsMatch,
  supportTicketDisplayNumber,
  subjectForLead,
  ticketTokenFromSubject,
};
