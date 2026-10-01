/* eslint-env node */

const crypto = require("node:crypto");
const {isCompanyManagedChargeDrops} = require("./chargeDropsRevenue");

const NOTIFICATIONS_COLLECTION = "chargeDropsPartnerNotifications";
const TEMPLATE_VERSION = "chargedrops-partner-onboarding-v1";

const EVENT_DEFINITIONS = {
  onboarding_started: {
    stage: "Client onboarding started",
    summary: "The ChargeDrops client account and location profile were created.",
    nextStep: "The client reviews their portal invitation and agreement.",
  },
  client_invitation_sent: {
    stage: "Client portal invitation sent",
    summary: "The client received their ChargeDrops Client Portal invitation.",
    nextStep: "The client signs in and reviews the agreement.",
  },
  coming_soon_published: {
    stage: "Coming Soon location published",
    summary: "The venue now appears as Coming Soon on the ChargeDrops map.",
    nextStep: "The client completes its agreement and payout setup.",
  },
  agreement_ready: {
    stage: "Agreement sent",
    summary: "The ChargeRent revenue-share agreement is ready for client review.",
    nextStep: "The client reviews and signs the agreement.",
  },
  agreement_signed: {
    stage: "Agreement signed",
    summary: "The client completed the electronic agreement-signing step.",
    nextStep: "The client completes commission payout setup through Stripe.",
  },
  payout_started: {
    stage: "Payout setup started",
    summary: "The client started secure commission payout onboarding.",
    nextStep: "Stripe reviews the client's submitted payout information.",
  },
  payout_action_required: {
    stage: "Payout action required",
    summary: "The client's payout setup needs additional action.",
    nextStep: "The client returns to its portal to complete Stripe's requirements.",
  },
  payout_verification_pending: {
    stage: "Payout verification pending",
    summary: "The client submitted payout details and Stripe is reviewing them.",
    nextStep: "Stripe completes verification.",
  },
  payout_complete: {
    stage: "Payout account complete",
    summary: "The client's commission payout account is ready.",
    nextStep: "ChargeDrops coordinates installation and launch.",
  },
  installation_scheduled: {
    stage: "Installation scheduled",
    summary: "The ChargeDrops kiosk installation has been scheduled.",
    nextStep: "The installation team deploys and verifies the kiosk.",
  },
  kiosk_installed: {
    stage: "Kiosk installed",
    summary: "The ChargeDrops kiosk has been installed at the venue.",
    nextStep: "ChargeDrops completes launch verification.",
  },
  location_live: {
    stage: "Location live",
    summary: "The venue completed onboarding and is live on ChargeDrops.",
    nextStep: "The partner can monitor its kiosks in the Chargerent dashboard.",
  },
};

function text(value, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function escapeHtml(value) {
  return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value, 254));
}

function isPartner(profile) {
  return profile?.active !== false &&
    (profile?.role === "partner" || profile?.partner === true);
}

function notificationId(clientUid, eventType, eventKey) {
  return crypto.createHash("sha256")
      .update(`${clientUid}:${eventType}:${eventKey}`)
      .digest("hex")
      .slice(0, 48);
}

function safeDeliveryError(error) {
  const code = text(error?.code, 80) || "unknown";
  return {
    code,
    definitelyBeforeSend: error?.notificationBeforeSend === true ||
      code === "failed-precondition",
  };
}

function buildPartnerMessage({
  eventType,
  clientProfile,
  partnerProfile,
  dashboardBaseUrl,
  details = {},
}) {
  const definition = EVENT_DEFINITIONS[eventType];
  if (!definition) throw new Error("Unsupported ChargeDrops onboarding event.");
  const venueName = text(
      clientProfile?.chargedrops?.location?.venueName,
      160,
  ) || text(clientProfile?.clientId, 80) || "ChargeDrops venue";
  const clientId = text(clientProfile?.clientId, 80).toUpperCase();
  const city = text(
      clientProfile?.chargedrops?.city?.displayName ||
      clientProfile?.chargedrops?.location?.city,
      120,
  ) || "Not specified";
  const partnerName = text(
      partnerProfile?.contact?.name || partnerProfile?.username,
      160,
  ) || "Partner";
  const scheduledAt = text(details.scheduledAt, 120);
  const scheduleLine = scheduledAt ?
    `\nInstallation schedule: ${scheduledAt}` : "";
  const subject = `ChargeDrops onboarding update: ${venueName} — ` +
    definition.stage;
  const body = [
    `Hi ${partnerName},`,
    "",
    definition.summary,
    "",
    `Client: ${clientId || venueName}`,
    `Venue: ${venueName}`,
    `City: ${city}`,
    `Current stage: ${definition.stage}${scheduleLine}`,
    `Next step: ${definition.nextStep}`,
    "Partner action required: None unless the ChargeDrops team contacts you.",
    "",
    "View your kiosks in the standard Chargerent dashboard:",
    dashboardBaseUrl,
    "",
    "For privacy and security, client credentials, agreement files, verification " +
      "codes, and banking information are never included in partner updates.",
    "",
    "ChargeDrops",
  ].join("\n");

  const rows = [
    ["Client", clientId || venueName],
    ["Venue", venueName],
    ["City", city],
    ["Current stage", definition.stage],
    ...(scheduledAt ? [["Installation schedule", scheduledAt]] : []),
    ["Next step", definition.nextStep],
    ["Partner action", "None unless the ChargeDrops team contacts you"],
  ];
  const rowHtml = rows.map(([label, value]) => [
    "<tr>",
    `<td style="padding:9px 0;color:#64748b;font-size:13px;">${escapeHtml(label)}</td>`,
    `<td style="padding:9px 0;color:#0f172a;font-size:13px;font-weight:700;text-align:right;">${escapeHtml(value)}</td>`,
    "</tr>",
  ].join("")).join("");
  const html = [
    "<!doctype html>",
    "<html><body style=\"margin:0;background:#f1f5f9;\">",
    "<div style=\"font-family:Inter,Arial,sans-serif;padding:28px 16px;\">",
    "<div style=\"max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;\">",
    "<div style=\"background:#312e81;padding:24px;color:#fff;\">",
    "<div style=\"font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#c7d2fe;\">ChargeDrops</div>",
    `<h1 style="font-size:22px;margin:8px 0 0;">${escapeHtml(definition.stage)}</h1>`,
    "</div><div style=\"padding:24px;\">",
    `<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 12px;">Hi ${escapeHtml(partnerName)},</p>`,
    `<p style="color:#334155;font-size:15px;line-height:1.6;">${escapeHtml(definition.summary)}</p>`,
    `<table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${rowHtml}</table>`,
    `<a href="${escapeHtml(dashboardBaseUrl)}" style="display:inline-block;margin-top:20px;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:700;">Open Chargerent dashboard</a>`,
    "<p style=\"margin-top:20px;color:#64748b;font-size:12px;line-height:1.6;\">Client credentials, agreement files, verification codes, and banking information are not included in partner updates.</p>",
    "</div></div></div></body></html>",
  ].join("");

  return {
    subject,
    body,
    html,
    stage: definition.stage,
    venueName,
    clientId,
    city,
    nextStep: definition.nextStep,
  };
}

function createChargeDropsPartnerNotifications({
  db,
  admin,
  sendEmail,
  dashboardBaseUrl = "https://chargerentstations.com/portal/",
  logger = console,
}) {
  if (!db || !admin || typeof sendEmail !== "function") {
    throw new TypeError("ChargeDrops partner notification dependencies are required.");
  }
  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  async function resolvePartner(clientProfile) {
    const partnerUid = text(clientProfile?.regionalPartnerUid, 160);
    const partnerClientId = text(
        clientProfile?.regionalPartnerId,
        80,
    ).toUpperCase();
    let snapshot = null;
    if (partnerUid) {
      const direct = await db.collection("users").doc(partnerUid).get();
      if (direct.exists) snapshot = direct;
    }
    if (!snapshot && partnerClientId) {
      const matches = await db.collection("users")
          .where("clientId", "==", partnerClientId)
          .limit(5)
          .get();
      snapshot = matches.docs.find((doc) => isPartner(doc.data())) || null;
    }
    const profile = snapshot?.data() || null;
    if (!snapshot || !isPartner(profile)) return null;
    const email = text(profile?.contact?.email, 254).toLowerCase();
    if (!validEmail(email)) return null;
    return {
      uid: snapshot.id,
      clientId: text(profile.clientId, 80).toUpperCase(),
      email,
      profile,
    };
  }

  async function notify({
    clientUid,
    clientProfile,
    eventType,
    eventKey = "current",
    actorUid = "system",
    details = {},
  }) {
    const normalizedUid = text(clientUid, 160);
    if (!normalizedUid || !EVENT_DEFINITIONS[eventType]) {
      return {status: "skipped", reason: "invalid-event"};
    }
    const id = notificationId(normalizedUid, eventType, text(eventKey, 240));
    const ref = db.collection(NOTIFICATIONS_COLLECTION).doc(id);
    const existing = await ref.get();
    const saved = existing.exists ? existing.data() || {} : {};
    if (["sent", "sending", "unknown", "skipped"].includes(saved.status)) {
      return {id, status: saved.status, duplicate: true};
    }

    if (isCompanyManagedChargeDrops(clientProfile)) {
      await ref.set({
        id,
        clientUid: normalizedUid,
        clientId: text(clientProfile?.clientId, 80).toUpperCase(),
        eventType,
        eventKey: text(eventKey, 240),
        templateVersion: TEMPLATE_VERSION,
        status: "skipped",
        reason: "company-managed-location",
        createdAt: saved.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {id, status: "skipped", reason: "company-managed-location"};
    }

    const partner = await resolvePartner(clientProfile);
    if (!partner) {
      await ref.set({
        id,
        clientUid: normalizedUid,
        clientId: text(clientProfile?.clientId, 80).toUpperCase(),
        eventType,
        eventKey: text(eventKey, 240),
        templateVersion: TEMPLATE_VERSION,
        status: "skipped",
        reason: "partner-email-unavailable",
        createdAt: saved.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {id, status: "skipped", reason: "partner-email-unavailable"};
    }

    const clientEmail = text(clientProfile?.contact?.email, 254).toLowerCase();
    if (clientEmail && clientEmail === partner.email) {
      await ref.set({
        id,
        clientUid: normalizedUid,
        clientId: text(clientProfile?.clientId, 80).toUpperCase(),
        partnerUid: partner.uid,
        partnerClientId: partner.clientId,
        eventType,
        eventKey: text(eventKey, 240),
        templateVersion: TEMPLATE_VERSION,
        status: "skipped",
        reason: "same-as-client-recipient",
        createdAt: saved.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {id, status: "skipped", reason: "same-as-client-recipient"};
    }

    const message = buildPartnerMessage({
      eventType,
      clientProfile,
      partnerProfile: partner.profile,
      dashboardBaseUrl,
      details,
    });
    const attempts = Number(saved.attempts || 0) + 1;
    await ref.set({
      id,
      clientUid: normalizedUid,
      clientId: message.clientId,
      venueName: message.venueName,
      city: message.city,
      partnerUid: partner.uid,
      partnerClientId: partner.clientId,
      recipientEmail: partner.email,
      eventType,
      eventKey: text(eventKey, 240),
      stage: message.stage,
      nextStep: message.nextStep,
      templateVersion: TEMPLATE_VERSION,
      status: "sending",
      attempts,
      actorUid: text(actorUid, 160) || "system",
      createdAt: saved.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});

    try {
      const result = await sendEmail({
        to: partner.email,
        fromName: "ChargeDrops",
        subject: message.subject,
        body: message.body,
        html: message.html,
      });
      const matchesPartner = (address) => text(
          typeof address === "object" ? address?.address : address,
          254,
      ).toLowerCase() === partner.email;
      const rejected = Array.isArray(result?.rejected) &&
        result.rejected.some(matchesPartner);
      const acceptedKnown = Array.isArray(result?.accepted);
      const accepted = !acceptedKnown || result.accepted.some(matchesPartner);
      if (!accepted || rejected) {
        const error = new Error("Partner email delivery was not confirmed.");
        error.code = "delivery-unconfirmed";
        throw error;
      }
      await ref.set({
        status: "sent",
        messageId: text(result?.messageId, 240),
        sentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, {merge: true});
      return {id, status: "sent", partnerClientId: partner.clientId};
    } catch (error) {
      const deliveryError = safeDeliveryError(error);
      const status = deliveryError.definitelyBeforeSend ? "failed" : "unknown";
      await ref.set({
        status,
        errorCode: deliveryError.code,
        updatedAt: serverTimestamp(),
      }, {merge: true});
      logger.error("ChargeDrops partner notification failed", {
        notificationId: id,
        clientUid: normalizedUid,
        eventType,
        status,
        code: deliveryError.code,
      });
      return {id, status, partnerClientId: partner.clientId};
    }
  }

  async function retry({notificationId: inputId, actorUid = "system"}) {
    const id = text(inputId, 80).toLowerCase();
    if (!/^[a-f0-9]{48}$/.test(id)) {
      return {status: "skipped", reason: "invalid-notification"};
    }
    const ref = db.collection(NOTIFICATIONS_COLLECTION).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return {status: "skipped", reason: "notification-not-found"};
    }
    const saved = snapshot.data() || {};
    if (saved.status !== "failed") {
      return {id, status: saved.status || "unknown", duplicate: true};
    }
    const clientUid = text(saved.clientUid, 160);
    const clientSnapshot = clientUid ?
      await db.collection("users").doc(clientUid).get() : null;
    if (!clientSnapshot?.exists) {
      return {id, status: "skipped", reason: "client-not-found"};
    }
    return notify({
      clientUid,
      clientProfile: clientSnapshot.data() || {},
      eventType: saved.eventType,
      eventKey: saved.eventKey,
      actorUid,
    });
  }

  return {notify, resolvePartner, retry};
}

module.exports = {
  EVENT_DEFINITIONS,
  NOTIFICATIONS_COLLECTION,
  TEMPLATE_VERSION,
  buildPartnerMessage,
  createChargeDropsPartnerNotifications,
  notificationId,
};
