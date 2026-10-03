/* eslint-env node */
const crypto = require("node:crypto");
const {besiterRentalOutcome, stripeIntentIdForRental} = require("./kioskTerminal");
const {parseCredentials} = require("./besiterGateway");

// This existing server-only namespace avoids exposing export state through
// the legacy public rentals collection or changing Firestore rules.
const CONFIG_PATH = "accounting/amazonRentalExport";
const OUTBOX_PATH = `${CONFIG_PATH}/outbox`;
const SUPPORTED_STATIONS = new Set(["FR8011"]);
const MAX_IMPORT_DELAY_MS = 120_000;
const LEASE_MS = 90_000;

class ExportError extends Error {
  constructor(code, retryable = false) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

function millis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" ? value : Date.parse(String(value || ""));
}

function text(value) {
  return String(value || "").trim();
}

function number(value, name, minimum = 0) {
  if (value === null || value === undefined || value === "") throw new ExportError(`missing-${name}`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum) throw new ExportError(`invalid-${name}`);
  return result;
}

function prepareExport({rental, rentalId, interaction, config, now = new Date()}) {
  const stationId = text(rental.rentalStationid).toUpperCase();
  if (!config || config.enabled !== true || !SUPPORTED_STATIONS.has(stationId) ||
      !Array.isArray(config.stationIds) || !config.stationIds.includes(stationId) ||
      text(rental.gateway).toUpperCase() !== "STRIPE") return null;
  const enabledAt = millis(config.enabledAt);
  const startedAt = millis(rental.rentalTime);
  // Never replay historical rentals with the importer's receipt-time clock.
  if (!Number.isFinite(enabledAt) || !Number.isFinite(startedAt) || startedAt < enabledAt) return null;
  const paymentIntentId = stripeIntentIdForRental(rental, rentalId);
  if (!paymentIntentId || !interaction || interaction.paymentIntentId !== paymentIntentId ||
      text(interaction.stationId).toUpperCase() !== stationId || interaction.stripeMode !== "live") {
    throw new ExportError("interaction-mismatch");
  }
  const settled = rental.stripeReturnSettlement;
  const isSettlement = ["returned", "purchased"].includes(rental.status) && settled?.status === "completed";
  if (!isSettlement && besiterRentalOutcome(rental).outcome !== "vend_succeeded") return null;
  const paymentResolution = text(interaction.paymentResolution);
  if (!["authorized", "captured"].includes(paymentResolution)) throw new ExportError("payment-not-approved");
  const option = text(interaction.gatewayOption).toUpperCase();
  if (!["FULLPRICE", "INITIALPRICE"].includes(option)) throw new ExportError("invalid-gateway-option");
  // Use the interaction's frozen offer, never the kiosk's current pricing.
  const source = interaction.pricingSnapshot;
  if (!source || !Array.isArray(source.rate) || source.rate.length === 0) {
    throw new ExportError("missing-original-pricing");
  }
  const pricing = {
    kioskmode: text(source.kioskmode).toUpperCase(),
    initialperiod: number(source.initialperiod, "initialperiod"),
    dailyprice: number(source.dailyprice, "dailyprice"),
    buyprice: number(source.buyprice, "buyprice"),
    authamount: number(source.authamount, "authamount"),
    overdue: number(source.overdue, "overdue", 1),
    taxrate: number(source.taxrate ?? 0, "taxrate"),
    currency: text(interaction.kioskCurrency || source.currency).toUpperCase(),
    symbol: text(interaction.symbol || source.symbol),
    rate: source.rate.map((r) => ({time: number(r.time, "rate-time"), price: number(r.price, "rate-price")})),
  };
  if (!["LEASE", "PURCHASE"].includes(pricing.kioskmode) || !pricing.currency) {
    throw new ExportError("invalid-original-pricing");
  }
  const amountCents = number(interaction.amountCents, "amount-cents", 1);
  if (!Number.isInteger(amountCents) || Math.round((option === "FULLPRICE" ?
    pricing.buyprice : pricing.authamount) * 100) !== amountCents) throw new ExportError("price-payment-mismatch");
  const chargerId = number(rental.chargerid, "charger", 1);
  const slot = number(rental.rentalSlotid, "slot", 1);
  const moduleId = text(rental.rentalModuleid);
  if (!Number.isInteger(chargerId) || !Number.isInteger(slot) || !/^\d+$/.test(moduleId)) {
    throw new ExportError("invalid-vend-identity");
  }
  const phase = isSettlement ? "settlement" : "vend";
  const paymentState = isSettlement ? text(settled.paymentStatus || rental.paymentStatus) : paymentResolution;
  const occurredAt = isSettlement ? millis(settled.settledAt) : millis(rental.vendConfirmedAt || rental.rentedAt || rental.rentalTime);
  if (!Number.isFinite(occurredAt)) throw new ExportError("invalid-event-time");
  const event = {
    eventid: `firebase-${paymentIntentId}-${phase}-v1`,
    eventtype: isSettlement ? "stripe_settlement_completed" : "vend_succeeded",
    source: "firebase_android_stripe", stationid: stationId,
    moduleid: moduleId, slotnumber: slot, chargerid: String(chargerId),
    transactionid: paymentIntentId, reservationid: text(interaction.id || rental.interactionId),
    paymentstatus: paymentState, vendstatus: "dispensed",
    occurredat: new Date(occurredAt).toISOString(),
    rentalStartedAt: new Date(startedAt).toISOString(),
    currency: text(interaction.currency), gateway: "STRIPE", gatewayoptions: option,
    authorizedAmountCents: amountCents,
    capturedAmountCents: isSettlement ? number(settled.capturedCents, "captured-cents") :
      (paymentResolution === "captured" ? amountCents : 0),
    finalChargeCents: isSettlement ? number(settled.finalChargeCents, "final-charge-cents") : null,
    refundedAmountCents: isSettlement ? number(settled.refundCents ?? 0, "refund-cents") : 0,
    releasedAmountCents: isSettlement ? number(settled.releasedCents ?? 0, "released-cents") : 0,
    pricing,
  };
  const rentalMessage = isSettlement ? null : {
    stationid: stationId, rawid: paymentIntentId, EMV_Transaction_ID: paymentIntentId,
    gateway: "STRIPE", gatewayoptions: option, paymentStatus: "approved", pricing,
    chargerid: String(chargerId), moduleid: moduleId, slotnumber: slot,
    batterylevel: number(rental.rentPower ?? interaction.batteryLevel, "battery-level"),
    rentalTime: new Date(startedAt).toISOString(), paymentResolution,
    source: "firebase_android_stripe", exportEventId: event.eventid,
  };
  return {
    id: `${paymentIntentId}-${phase}`, schemaVersion: 1, phase,
    stationId, rentalId, paymentIntentId, rentalMessage,
    eventTopic: `tl/ck/${stationId}/rental-event`, event,
    createdAt: now, sourceStartedAt: new Date(startedAt),
    status: "pending", nextAttemptAt: now, attemptCount: 0,
    legacyAccountingNotice: "Amazon RENTALS totals represent authorization; accurate payment state is in RENTAL_EVENTS.",
  };
}

function createAmazonTransport({credentials, connect, timeoutMs = 15_000}) {
  const auth = parseCredentials(credentials);
  async function send(topic, payload, ackRequired) {
    const probe = payload === null;
    return new Promise((resolve, reject) => {
      const client = connect("mqtt://chargerent.io:1884", {
        ...auth, clean: true, reconnectPeriod: 0, connectTimeout: 8_000,
        clientId: `firebase-amazon-${crypto.randomBytes(8).toString("hex")}`,
      });
      let done = false;
      const timer = setTimeout(() => finish(new ExportError("amazon-ack-timeout", true)), timeoutMs);
      function finish(error, result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { client.end(true); } catch { /* preserve the result */ }
        if (error) reject(error); else resolve(result);
      }
      function publish() {
        client.publish(topic, JSON.stringify(payload), {qos: 2, retain: false}, (error) => {
          if (error) finish(new ExportError("amazon-publish-failed", true));
          else if (!ackRequired) finish(null, {status: "broker_accepted"});
        });
      }
      client.once("error", () => finish(new ExportError("amazon-connect-failed", true)));
      client.on("message", (responseTopic, raw) => {
        if (!ackRequired || responseTopic !== "kiosk/ack") return;
        let ack;
        try { ack = JSON.parse(String(raw)); } catch { return; }
        // Rejections without an ID cannot safely be attributed to this request.
        if (text(ack.transactionid) !== payload.rawid || text(ack.stationid) !== payload.stationid) return;
        if (["logged", "duplicate"].includes(ack.status)) finish(null, {status: ack.status});
        else finish(new ExportError(`amazon-${ack.status === "rejected" ? "rejected" : "error"}`, ack.status !== "rejected"));
      });
      client.once("connect", () => {
        if (!ackRequired && !probe) return publish();
        client.subscribe("kiosk/ack", {qos: 2}, (error, granted) => {
          if (error || !granted?.length || granted.some((g) => g.qos === 128)) {
            finish(new ExportError("amazon-subscribe-failed", true));
          } else if (probe) finish(null, {status: "connected"});
          else publish();
        });
      });
    });
  }
  return {
    checkConnection() { return send(null, null, false); },
    publishRental(payload) { return send("kiosk/rental", payload, true); },
    publishEvent(topic, payload) { return send(topic, payload, false); },
  };
}

function createAmazonExportService({db, getTransport, now = () => new Date()}) {
  const configRef = db.doc(CONFIG_PATH);
  const outbox = db.collection(OUTBOX_PATH);
  async function enqueue(rental, rentalId) {
    if (!SUPPORTED_STATIONS.has(text(rental.rentalStationid).toUpperCase()) || rental.gateway !== "STRIPE") return null;
    const config = (await configRef.get()).data();
    if (!config?.enabled || millis(rental.rentalTime) < millis(config.enabledAt)) return null;
    if (besiterRentalOutcome(rental).outcome !== "vend_succeeded" &&
        rental.stripeReturnSettlement?.status !== "completed") return null;
    let interaction;
    if (rental.interactionId) interaction = (await db.doc(`kioskTerminalInteractions/${rental.interactionId}`).get()).data();
    else {
      const found = await db.collection("kioskTerminalInteractions")
          .where("paymentIntentId", "==", stripeIntentIdForRental(rental, rentalId)).limit(1).get();
      interaction = found.empty ? null : found.docs[0].data();
    }
    let prepared;
    try {
      prepared = prepareExport({rental, rentalId, interaction, config, now: now()});
    } catch (error) {
      if (!(error instanceof ExportError)) throw error;
      const paymentIntentId = stripeIntentIdForRental(rental, rentalId);
      if (!paymentIntentId) throw error;
      const phase = rental.stripeReturnSettlement?.status === "completed" ? "settlement" : "vend";
      prepared = {id: `${paymentIntentId}-${phase}`, stationId: rental.rentalStationid,
        rentalId, paymentIntentId, phase, status: "blocked", createdAt: now(),
        sourceStartedAt: new Date(millis(rental.rentalTime)), lastErrorCode: error.code};
    }
    if (!prepared) return null;
    const ref = outbox.doc(prepared.id);
    await db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) tx.create(ref, prepared);
    });
    return prepared.id;
  }

  async function deliver(id) {
    const config = (await configRef.get()).data();
    if (!config?.enabled) return {status: "disabled"};
    const ref = outbox.doc(id);
    const owner = crypto.randomUUID();
    const timestamp = now();
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const row = snap.data();
      if (!row || !config.stationIds?.includes(row.stationId) || !SUPPORTED_STATIONS.has(row.stationId) ||
          ["delivered", "blocked"].includes(row.status) || millis(row.leaseUntil) > timestamp.getTime() ||
          millis(row.nextAttemptAt) > timestamp.getTime()) return null;
      // After a rental ACK, only the accurate audit event remains to be retried.
      if (row.phase === "vend" && !row.amazonAck &&
          timestamp.getTime() - millis(row.sourceStartedAt) > MAX_IMPORT_DELAY_MS) {
        tx.update(ref, {status: "blocked", lastErrorCode: "legacy-timestamp-window", updatedAt: timestamp});
        return null;
      }
      const patch = {status: "processing", leaseOwner: owner,
        leaseUntil: new Date(timestamp.getTime() + LEASE_MS), attemptCount: Number(row.attemptCount || 0) + 1};
      tx.update(ref, patch);
      return {...row, ...patch};
    });
    if (!claimed) return {status: "not-claimed"};
    async function updateOwned(patch) {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data();
        if (current?.leaseOwner === owner) tx.update(ref, patch);
      });
    }
    try {
      const transport = getTransport();
      if (claimed.rentalMessage && !claimed.amazonAck) {
        const ack = await transport.publishRental(claimed.rentalMessage);
        await updateOwned({amazonAck: ack.status, amazonAcknowledgedAt: now()});
      }
      await transport.publishEvent(claimed.eventTopic, claimed.event);
      await updateOwned({status: "delivered", eventDelivery: "broker_accepted", deliveredAt: now(),
        leaseUntil: null, leaseOwner: null, lastErrorCode: null});
      return {status: "delivered"};
    } catch (error) {
      const retryable = error instanceof ExportError && error.retryable;
      const delay = Math.min(60_000, 5_000 * 2 ** Math.min(claimed.attemptCount - 1, 4));
      const retryAt = new Date(now().getTime() + delay);
      await updateOwned({status: retryable ? "pending" : "blocked", nextAttemptAt: retryAt,
        lastErrorCode: error instanceof ExportError ? error.code : "export-internal-error",
        leaseUntil: null, leaseOwner: null, updatedAt: now()});
      return {status: retryable ? "pending" : "blocked"};
    }
  }

  async function retryPending() {
    const config = (await configRef.get()).data();
    // Explicit one-time check from the deployed runtime; never sends a rental
    // or payment message and can run while forwarding is disabled.
    if (config?.connectionCheckRequested === true) {
      let status;
      try {
        status = (await getTransport().checkConnection()).status;
      } catch {
        status = "failed";
      }
      await configRef.set({connectionCheckRequested: false,
        lastBrokerCheck: {status, checkedAt: now()}}, {merge: true});
    }
    if (!config?.enabled) return [];
    // Single-field query needs no new Firestore composite index.
    const rows = await outbox.where("status", "in", ["pending", "processing"]).limit(10).get();
    const results = [];
    for (const row of rows.docs) results.push(await deliver(row.id));
    return results;
  }
  return {enqueue, deliver, retryPending};
}

module.exports = {CONFIG_PATH, OUTBOX_PATH, MAX_IMPORT_DELAY_MS, ExportError,
  prepareExport, createAmazonTransport, createAmazonExportService};
