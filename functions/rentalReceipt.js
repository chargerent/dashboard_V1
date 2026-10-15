/* eslint-env node */
const crypto = require("node:crypto");
const clean = (value, limit = 160) => String(value ?? "").trim().slice(0, limit);
const lower = (value) => clean(value).toLowerCase();
const fail = () => Object.assign(new Error("This receipt is not available."), {status: 404, code: "RECEIPT_NOT_FOUND"});
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const millis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Date.parse(String(value ?? "")));
const iso = (value) => Number.isFinite(millis(value)) ? new Date(millis(value)).toISOString() : null;
const cents = (value) => (typeof value === "number" || typeof value === "string" && /^\d+$/.test(value.trim())) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100000000 ? Number(value) : null;
const majorCents = (value) => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (!["number", "string"].includes(typeof value) || !/^\d+(?:[.,]\d+)?$/.test(String(value).trim())) return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) && Math.abs(number * 100 - Math.round(number * 100)) < .000001 ? cents(Math.round(number * 100)) : null;
};
function transactionIdForRental(rental, rentalId) {
  return [rental?.transactionid, rental?.transactionId, rental?.rawid, rental?.paymentIntentId, rental?.orderid, rental?.EMV_Transaction_ID, rentalId].map((value) => clean(value, 200)).find(validId) || null;
}
function physicalVendProven(rental) {
  if (!rental || !["rented", "returned", "refunded", "purchased"].includes(lower(rental.status))) return false;
  const slot = Number(rental.rentalSlotid ?? rental.rentalSlotId);
  const charger = rental.chargerid ?? rental.sn;
  if (!["string", "number"].includes(typeof (rental.rentalSlotid ?? rental.rentalSlotId)) || !Number.isSafeInteger(slot) || slot <= 0 || !["string", "number"].includes(typeof charger) || !/^[A-Za-z0-9_-]+$/.test(clean(charger))) return false;
  const module = clean(rental.rentalModuleid ?? rental.rentalModuleId);
  const auditProof = (Array.isArray(rental.rentalEvents) ? rental.rentalEvents : []).some((event) =>
    lower(event.eventtype) === "vend_succeeded" && iso(event.occurredat || event.receivedat) &&
    String(event.moduleid ?? module) === module && Number(event.slotnumber ?? slot) === slot &&
    String(event.chargerid ?? charger) === String(charger));
  const ctf7Proof = rental.transport === "ctf7" && /^LM-/.test(module) &&
    /^[\x21-\x7e]{12}$/.test(String(charger)) && slot <= 7 && lower(rental.vendState) === "dispensed" &&
    ["ctf7_correlated_ack", "ctf7_correlated_fresh_absence"].includes(rental.vendConfirmationSource) &&
    (rental.vendAttempts || []).some(attempt => attempt.state === "dispensed" && attempt.moduleid === module &&
      Number(attempt.requestedSlotid) === slot && String(attempt.sn) === String(charger) &&
      attempt.confirmationSource === rental.vendConfirmationSource && iso(attempt.respondedAt));
  const directProof = lower(rental.vendState) === "dispensed" &&
    ((Array.isArray(rental.vendAttempts) ? rental.vendAttempts : []).some((attempt) => Number(attempt?.exitStatus) === 1) ||
      ["popup_sn", "fresh_status_watchdog"].includes(clean(rental.vendConfirmationSource)));
  return Boolean(module && (auditProof || directProof || ctf7Proof));
}
function safeLogo(value) {
  try {
    if (!value || !["image/png", "image/jpeg", "image/webp"].includes(value.contentType)) return null;
    const url = new URL(value.url);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}
function normalizedCurrency(value) {
  const currency = clean(value, 10).toUpperCase();
  const normalized = ({US: "USD", CAN: "CAD", CA: "CAD", FR: "EUR"})[currency] || currency;
  return Intl.supportedValuesOf("currency").includes(normalized) ? normalized : null;
}
function stripeIntentForReceipt({rental, rentalId, interaction}) {
  const ids = [rental?.paymentIntentId, rental?.paymentintentid, rental?.transactionid,
    rental?.transactionId, rental?.orderid, rentalId, interaction?.paymentIntentId]
      .map((value) => clean(value)).filter((value) => /^pi_[A-Za-z0-9_]+$/.test(value));
  return new Set(ids).size === 1 ? ids[0] : null;
}
function managedStripeReceipt(context) {
  return clean(context.rental?.gateway).toUpperCase() === "STRIPE";
}
const stripeObjectId = (value) => clean(typeof value === "object" ? value?.id : value);

// This observer has no financial write or Firestore write dependency. The client
// resolver must map an exact public account ID and mode to the existing key.
function createStripeReceiptObserver({getStripeClientForAccount}) {
  if (typeof getStripeClientForAccount !== "function") throw new TypeError("An exact Stripe account resolver is required.");
  return async function observe(context) {
    const pending = {source: "stripe", state: "pending", finalChargeCents: null,
      refundedCents: null, releasedCents: null};
    try {
      const {rental, rentalId, interaction} = context;
      const paymentIntentId = stripeIntentForReceipt(context);
      const accountIds = [rental?.stripeAccountId, interaction?.stripeAccountId]
          .map((value) => clean(value)).filter(Boolean);
      const modes = [rental?.stripeMode, interaction?.stripeMode].map(lower).filter(Boolean);
      if (!managedStripeReceipt(context) || !paymentIntentId || new Set(accountIds).size !== 1 ||
          !/^acct_[A-Za-z0-9]+$/.test(accountIds[0]) || new Set(modes).size !== 1 ||
          !["test", "live"].includes(modes[0])) return pending;
      const accountId = accountIds[0];
      const mode = modes[0];
      const stripe = await getStripeClientForAccount(accountId, mode);
      if (!stripe?.accounts?.retrieve || !stripe?.paymentIntents?.retrieve) return pending;
      const account = await stripe.accounts.retrieve();
      if (account?.id !== accountId) return pending;
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {expand: ["latest_charge"]});
      const currency = normalizedCurrency(intent?.currency);
      const expectedCurrency = normalizedCurrency(interaction?.currency || rental.currency || rental.pricing?.currency);
      const amount = cents(intent?.amount);
      const received = cents(intent?.amount_received);
      if (intent?.id !== paymentIntentId || !currency || expectedCurrency && currency !== expectedCurrency ||
          intent.livemode !== (mode === "live") ||
          amount === null || received === null || received > amount || cents(intent.amount_capturable) !== 0) return pending;
      async function includeFinalPayment(observation) {
        const finalId = clean(rental?.finalPaymentIntentId);
        if (!finalId) return observation;
        if (rental?.billingOwner !== "local_station_v1" || !/^pi_[A-Za-z0-9]+$/.test(finalId) || finalId === paymentIntentId) return pending;
        const finalIntent = await stripe.paymentIntents.retrieve(finalId);
        if (finalIntent.metadata?.chargerent_rental !== (rental?.billingOwner === "local_station_v1" ? rentalId : paymentIntentId) || finalIntent.metadata?.billing_owner !== "local_station_v1" ||
          finalIntent.currency !== intent.currency || finalIntent.livemode !== intent.livemode) return pending;
        const extra = await observe({rentalId: finalId, interaction: null, rental: {...rental, finalPaymentIntentId: null,
          paymentIntentId: finalId, paymentintentid: finalId, transactionid: finalId, transactionId: finalId, orderid: finalId}});
        if (extra.state !== "settled") return pending;
        return {...observation, finalChargeCents: observation.finalChargeCents + extra.finalChargeCents,
          refundedCents: observation.refundedCents + extra.refundedCents};
      }
      const manual = intent.capture_method === "manual";
      if (intent.status === "canceled" && received === 0) {
        const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
        if (charge && cents(charge.amount_captured) !== 0) return pending;
        return includeFinalPayment({source: "stripe", state: "settled", finalChargeCents: 0,
          refundedCents: 0, releasedCents: manual ? amount : 0});
      }
      if (intent.status !== "succeeded" || received === 0) return pending;
      let charge = intent.latest_charge;
      if (typeof charge === "string" && stripe.charges?.retrieve) charge = await stripe.charges.retrieve(charge);
      const chargeAmount = cents(charge?.amount);
      const aggregateRefunded = cents(charge?.amount_refunded);
      if (!charge || !/^ch_[A-Za-z0-9]+$/.test(charge.id) ||
          stripeObjectId(charge.payment_intent) !== paymentIntentId ||
          normalizedCurrency(charge.currency) !== currency || charge.captured !== true || charge.paid !== true ||
          cents(charge.amount_captured) !== received || chargeAmount === null || chargeAmount < received ||
          aggregateRefunded === null || aggregateRefunded > received || !stripe.refunds?.list) return pending;
      let refunded = 0;
      let refundPending = false;
      let startingAfter;
      const seen = new Set();
      for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
        const page = await stripe.refunds.list({payment_intent: paymentIntentId, limit: 100,
          ...(startingAfter ? {starting_after: startingAfter} : {})});
        if (!Array.isArray(page?.data) || typeof page.has_more !== "boolean") return pending;
        for (const refund of page.data) {
          const refundAmount = cents(refund.amount);
          if (!/^re_[A-Za-z0-9]+$/.test(refund.id) || seen.has(refund.id) ||
              stripeObjectId(refund.payment_intent) !== paymentIntentId ||
              stripeObjectId(refund.charge) !== charge.id || normalizedCurrency(refund.currency) !== currency ||
              refundAmount === null || !["succeeded", "failed", "canceled", "pending", "requires_action"].includes(refund.status)) return pending;
          seen.add(refund.id);
          if (refund.status === "succeeded") refunded += refundAmount;
          if (["pending", "requires_action"].includes(refund.status)) refundPending = true;
        }
        if (refunded > received) return pending;
        if (!page.has_more) {
          if (refundPending || refunded !== aggregateRefunded) return {...pending, refundedCents: refunded};
          return includeFinalPayment({source: "stripe", state: "settled", finalChargeCents: received - refunded,
            refundedCents: refunded, releasedCents: manual ? chargeAmount - received : 0});
        }
        startingAfter = page.data.at(-1)?.id;
        if (!startingAfter) return pending;
      }
      return pending;
    } catch {
      // Missing history credentials, account mismatch and read failures must not
      // turn a calculated return fee into a claimed processor settlement.
      return pending;
    }
  };
}
function projectReceipt({rental, rentalId, interaction, client, station, returnStation, paymentObservation}) {
  if (!physicalVendProven(rental)) throw fail();
  const transactionId = transactionIdForRental(rental, rentalId);
  if (!transactionId) throw fail();
  const status = lower(rental.status);
  const returnedAt = ["returned", "refunded"].includes(status) ? iso(rental.returnTime) : null;
  const closed = Boolean(returnedAt) || status === "purchased";
  const option = clean(interaction?.gatewayOption || rental.gatewayOption || rental.gatewayoptions).toUpperCase().replace(/[ _-]/g, "");
  const pricing = interaction?.pricingSnapshot || rental.pricing || rental.pricingSnapshot || {};
  const upfront = cents(interaction?.amountCents ?? rental.authorizedAmountCents ?? rental.paymentAmountCents) ?? majorCents(option === "FULLPRICE" ? pricing.buyprice ?? rental.buyprice : pricing.authamount ?? rental.authamount);
  const stripeSettlement = rental.stripeReturnSettlement?.status === "completed" ? rental.stripeReturnSettlement : null;
  const settlement = stripeSettlement || (rental.paymentSettlement?.status === "completed" ? rental.paymentSettlement : null);
  const legacyRefundConfirmed = ["approved", "refunded", "succeeded"].includes(lower(rental.refundStatus));
  const managedStripe = managedStripeReceipt({rental, rentalId, interaction});
  const observed = paymentObservation?.source === "stripe" ? paymentObservation : null;
  const observedSettled = observed?.state === "settled" &&
    [observed.finalChargeCents, observed.refundedCents, observed.releasedCents].every((value) => cents(value) !== null);
  const finalCharge = closed ? managedStripe ? (observedSettled ? cents(observed.finalChargeCents) : null) :
    cents(settlement?.finalChargeCents) ?? majorCents(rental.totalCharged) : null;
  const refunded = closed ? managedStripe ? cents(observed?.refundedCents) :
    cents(settlement?.refundCents ?? settlement?.refundedAmountCents) ?? (legacyRefundConfirmed ? majorCents(rental.refundAmount) : null) : null;
  const released = closed ? managedStripe ? (observedSettled ? cents(observed.releasedCents) : null) :
    cents(settlement?.releasedCents ?? settlement?.releasedAmountCents) : null;
  const paymentState = rental.stripeOffline === true && rental.paymentResolution === "declined" ? "declined" : closed ? (managedStripe ? (observedSettled ? "settled" : "pending") :
    (settlement || legacyRefundConfirmed ? "settled" : "pending")) :
    (["authorized", "captured"].includes(lower(interaction?.paymentResolution || rental.paymentResolution)) ? lower(interaction?.paymentResolution || rental.paymentResolution) : "pending");
  return {
    transactionId, status: returnedAt ? "returned" : status === "purchased" ? "purchased" : "renting",
    rentedAt: iso(rental.rentalTime || rental.rentedAt || rental.vendConfirmedAt), returnedAt,
    station: {id: clean(rental.rentalStationid || station?.stationid, 40), name: clean(station?.info?.location || station?.info?.place || station?.name || rental.rentalStationid, 100)},
    returnStation: returnedAt ? {id: clean(rental.returnStationid, 40), name: clean(returnStation?.info?.location || returnStation?.info?.place || returnStation?.name || rental.returnStationid, 100)} : null,
    charger: {slot: Number(rental.rentalSlotid)},
    currency: normalizedCurrency(interaction?.currency || rental.currency || pricing.currency),
    pricingLines: (Array.isArray(interaction?.pricingLines) ? interaction.pricingLines : Array.isArray(rental.pricingLines) ? rental.pricingLines : []).slice(0, 8).map((line) => clean(line, 240)),
    payment: {state: paymentState, ...(rental.stripeOffline === true ? {collectedOffline: true} : {}), upfrontKind: paymentState === "authorized" || option === "FULLPRICE" && lower(interaction?.paymentResolution || rental.paymentResolution) === "authorized" ? "hold" : lower(rental.upfrontKind || pricing.upfrontKind) === "deposit" ? "deposit" : "payment", upfrontCents: upfront, finalChargeCents: finalCharge, refundedCents: refunded, releasedCents: released},
    brand: {name: clean(client?.displayName || client?.name || client?.clientName || "Chargerent", 100), logoUrl: safeLogo(client?.receiptLogo)},
    updatedAt: iso(settlement?.settledAt || rental.refundDate || rental.lastUpdate || rental.updatedAt || rental.returnTime || rental.rentalTime),
  };
}
function createReceiptService({store, signingKey, publicBaseUrl, observePayment}) {
  if (!store || typeof store.getRental !== "function") throw new TypeError("A receipt rental store is required.");
  const key = () => {
    const value = typeof signingKey === "function" ? signingKey() : signingKey;
    if (typeof value !== "string" || Buffer.byteLength(value) < 32) throw new Error("Configure a private receipt signing key of at least 32 bytes.");
    return value;
  };
  const base = () => {
    const url = new URL(typeof publicBaseUrl === "function" ? publicBaseUrl() : publicBaseUrl);
    if (!((url.protocol === "https:") || (url.protocol === "http:" && ["127.0.0.1", "localhost", "10.0.2.2"].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error("Configure a safe receipt base URL.");
    return url.href.replace(/\/$/, "");
  };
  const signature = (transactionId, encodedId) => crypto.createHmac("sha256", key()).update(`chargerent-receipt-v1\n${transactionId}\n${encodedId}`).digest("base64url");
  return {
    link({rental, rentalId}) {
      if (!validId(rentalId) || !physicalVendProven(rental)) return null;
      const transactionId = transactionIdForRental(rental, rentalId);
      if (!transactionId) return null;
      const encoded = Buffer.from(rentalId).toString("base64url");
      return {transactionId, receiptUrl: `${base()}/receipt/${encodeURIComponent(transactionId)}?key=${encoded}.${signature(transactionId, encoded)}`};
    },
    async read(transactionId, token) {
      if (!validId(transactionId) || typeof token !== "string" || token.length > 400) throw fail();
      const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
      if (!match) throw fail();
      const expected = signature(transactionId, match[1]);
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(match[2]))) throw fail();
      const rentalId = Buffer.from(match[1], "base64url").toString();
      if (!validId(rentalId) || Buffer.from(rentalId).toString("base64url") !== match[1]) throw fail();
      const rental = await store.getRental(rentalId);
      if (!rental || transactionIdForRental(rental, rentalId) !== transactionId || !physicalVendProven(rental)) throw fail();
      const context = typeof store.getContext === "function" ? await store.getContext(rental, rentalId) : {};
      let paymentObservation;
      if (managedStripeReceipt({rental, rentalId, ...context}) &&
          ["returned", "refunded", "purchased"].includes(lower(rental.status)) && typeof observePayment === "function") {
        try { paymentObservation = await observePayment({rental, rentalId, ...context}); } catch { /* Display pending on read failure. */ }
      }
      const result = projectReceipt({rental, rentalId, ...context, paymentObservation});
      if (context.receiptPage) {
        try {
          const {normalizeReceiptPage} = await import("./receiptPageProfile.mjs");
          result.page = normalizeReceiptPage(context.receiptPage);
        } catch { /* Invalid presentation settings must not hide a valid receipt. */ }
      }
      return result;
    },
  };
}
function createFirestoreReceiptStore(db) {
  const eligibleClient = (profile, clientId) => profile &&
    ["", "user"].includes(lower(profile.role)) && profile.admin !== true && profile.partner !== true &&
    lower(profile.username) !== "chargerent" && clean(profile.clientId).toUpperCase() === clientId;
  return {
    async getRental(id) { const doc = await db.collection("rentals").doc(id).get(); return doc.exists ? doc.data() : null; },
    async getContext(rental) {
      async function findStation(id) {
        if (!/^[A-Z]{2,3}\d{4}$/.test(clean(id))) return null;
        const result = await db.collection("kiosks").where("stationid", "==", id).limit(2).get();
        return result.docs.length === 1 ? result.docs[0].data() : null;
      }
      const station = await findStation(clean(rental.rentalStationid));
      const returnStation = rental.returnStationid === rental.rentalStationid ? station : await findStation(clean(rental.returnStationid));
      const clientId = clean(rental.clientId || rental.clientid || station?.info?.client || station?.info?.clientId, 100).toUpperCase();
      let client = null;
      let receiptPage = null;
      if (clientId && ![...clientId].some(character => character.charCodeAt(0) < 32)) {
        const explicitUid = clean(rental.clientUid || station?.info?.clientUid, 128);
        if (validId(explicitUid)) {
          const doc = await db.collection("users").doc(explicitUid).get();
          if (doc.exists && eligibleClient(doc.data(), clientId)) client = doc.data();
        }
        const result = client ? null : await db.collection("users").where("clientId", "==", clientId).limit(11).get();
        const eligible = result?.docs.map((doc) => doc.data()).filter((profile) => eligibleClient(profile, clientId)) || [];
        // Ambiguous ownership must never attach another customer's branding.
        // No arbitrary first/last user, email or contact data is exposed.
        if (result && result.docs.length < 11 && eligible.length === 1) client = eligible[0];
        try {
          const profiles = await db.collection("uiProfiles").where("clientId", "==", clientId).limit(11).get();
          const stationClient = clean(station?.info?.client || station?.info?.clientId, 100).toUpperCase();
          const desiredId = stationClient === clientId ? station?.ui?.profileSections?.chargerentApp?.profileId : null;
          const profile = profiles.docs.length < 11 && (profiles.docs.find(doc => doc.id === desiredId) ||
            (profiles.docs.length === 1 ? profiles.docs[0] : null));
          const published = profile?.data()?.publishedSections?.chargerentApp?.value;
          // Never expose a draft, another client's profile, or unrelated profile fields.
          if (published?.receiptPage) receiptPage = {...published.receiptPage,
            defaultLanguage: published.stripeUi?.defaultLanguage || "en",
            enabledLanguages: published.stripeUi?.enabledLanguages || ["en", "fr", "es"]};
        } catch { /* Receipt presentation must not block transaction/payment reads. */ }
      }
      let interaction = null;
      if (/^pi_[A-Za-z0-9_]+$/.test(clean(rental.paymentIntentId || rental.transactionid))) {
        const result = await db.collection("kioskTerminalInteractions").where("paymentIntentId", "==", rental.paymentIntentId || rental.transactionid).limit(2).get();
        if (result.docs.length === 1) interaction = result.docs[0].data();
      }
      return {station, returnStation, client, interaction, receiptPage};
    },
  };
}
module.exports = {createReceiptService, createFirestoreReceiptStore, createStripeReceiptObserver,
  projectReceipt, physicalVendProven, transactionIdForRental};
