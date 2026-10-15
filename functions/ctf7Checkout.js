/* eslint-env node */
const crypto = require("node:crypto");
const {createFirestoreKioskTerminalStore, resolveKioskOffer, reservationId, tokenHash,
  KioskTerminalError} = require("./kioskTerminal");
const {stationReady, millis} = require("./ctf7Rental");
const terminal = (state) => ["dispensed", "failed", "canceled", "verification_pending"].includes(state);
const fail = (status, code, message) => { throw new KioskTerminalError(status, code, message); };
const paid = (intent, flow) => intent?.id && intent.metadata?.chargerent_interaction_id === flow.id &&
  intent.amount === flow.amountCents && intent.currency === flow.currency &&
  intent.livemode === (flow.stripeMode === "live") &&
  intent.status === (flow.gatewayOption === "FULLPRICE" ? "requires_capture" : "succeeded");

function createCtf7Checkout({db, gateway, getStripeClient, receiptService = null,
  publicUrl = "https://chargerentstations.com/portal/ctf7-rent.html", now = Date.now}) {
  const store = createFirestoreKioskTerminalStore(db);
  const flowRef = id => db.collection("ctf7Checkouts").doc(id);
  const client = flow => getStripeClient({mode: flow.stripeMode, accountCountry: flow.stripeAccountCountry});
  const patch = (id, data) => db.runTransaction(async tx => {
    const ref = flowRef(id), flow = (await tx.get(ref)).data();
    if (!flow) fail(404, "not-found", "Rental not found.");
    tx.set(ref, {...flow, ...data, updatedAt: new Date(now()).toISOString()});
  });
  async function station(stationId) {
    if (!/^[A-Z]{2,3}\d{4}$/.test(stationId)) fail(400, "station", "Invalid station.");
    const docs = await db.collection("kiosks").where("stationid", "==", stationId).limit(2).get();
    if (docs.size !== 1) fail(404, "station", "Station not found.");
    const kiosk = {...docs.docs[0].data(), provisionid: docs.docs[0].id};
    const settings = kiosk.ctf7Checkout;
    if (!stationReady(kiosk) || kiosk.hardware.gateway !== "STRIPE" || settings?.enabled !== true ||
      settings.channel !== "web-qr" || !["test", "live"].includes(settings.stripeMode)) {
      fail(503, "commissioning", "This station is being commissioned. Rentals are not available yet.");
    }
    const offer = resolveKioskOffer({stationId, stripeMode: settings.stripeMode,
      stripeAccountCountry: settings.stripeAccountCountry}, kiosk);
    return {kiosk, offer, settings};
  }
  async function offer(stationId) {
    const {offer, settings} = await station(stationId);
    return {stationId, testMode: settings.stripeMode === "test", pricingLines: offer.pricingLines,
      paymentTerms: offer.paymentTerms, amount: offer.paymentAmount, currency: offer.currency};
  }
  async function rateLimit(ip) {
    const ref = db.collection("ctf7CheckoutLimits").doc(tokenHash(`${ip}|${Math.floor(now() / 3600000)}`));
    await db.runTransaction(async tx => {
      const value = (await tx.get(ref)).data();
      if (Number(value?.count || 0) >= 20) fail(429, "rate-limit", "Please try again later.");
      tx.set(ref, {count: Number(value?.count || 0) + 1, expiresAt: new Date(now() + 7200000)});
    });
  }
  async function start(stationId, {accepted = false} = {}, ip = "unknown") {
    if (accepted !== true) fail(400, "terms", "Please accept the displayed rental pricing first.");
    const {kiosk, offer, settings} = await station(stationId);
    await rateLimit(ip);
    const availability = await gateway.requestAvailability({stationId, requestId: crypto.randomUUID()});
    if (availability.state !== "available" || !availability.selected) fail(409, "unavailable", "No charger is available.");
    const id = crypto.randomUUID(), token = crypto.randomBytes(32).toString("base64url");
    const stamp = new Date(now()), expiresAt = new Date(now() + 180000);
    const candidate = availability.selected;
    const interaction = await store.reserveInteraction({id, installationId: `ctf7-web-${id}`, channel: "ctf7-web",
      stationId, provisionId: kiosk.provisionid, stripeMode: settings.stripeMode,
      stripeAccountCountry: settings.stripeAccountCountry, amountCents: offer.paymentAmountCents,
      currency: offer.currency, kioskCurrency: offer.kioskCurrency, symbol: offer.symbol,
      buyPriceCents: offer.buyPriceCents, authorizationAmountCents: offer.initialAmountCents,
      pricingSnapshot: offer.pricingSnapshot, pricingLines: offer.pricingLines,
      pricingPlan: offer.planCode, pricingSource: "kiosk", gatewayOption: offer.gatewayOption,
      state: "reserved", outcome: "pending", pricingAcceptedAt: stamp}, candidate, expiresAt, stamp);
    const flow = {...interaction, state: "creating", tokenHash: tokenHash(token), expiresAt,
      createdAt: stamp.toISOString(), updatedAt: stamp.toISOString()};
    await db.runTransaction(async tx => { tx.create(flowRef(id), flow); });
    const returnUrl = `${publicUrl}?station=${encodeURIComponent(stationId)}&rental=${id}#${token}`;
    const checkoutParams = {mode: "payment", payment_method_types: ["card"],
        client_reference_id: id, metadata: {chargerent_interaction_id: id},
        line_items: [{quantity: 1, price_data: {currency: flow.currency, unit_amount: flow.amountCents,
          product_data: {name: `Chargerent ${stationId} charger rental`}}}],
        payment_intent_data: {capture_method: flow.gatewayOption === "FULLPRICE" ? "manual" : "automatic",
          metadata: {chargerent_interaction_id: id, chargerent_station_id: stationId}},
        // Stripe Checkout's minimum expiry is 30 minutes. Our bank reservation
        // remains three minutes; expiration/late-payment cleanup happens below.
        expires_at: Math.floor(now() / 1000) + 1860, success_url: returnUrl, cancel_url: returnUrl,
      };
    await patch(id, {checkoutParams});
    try {
      const session = await client(flow).checkout.sessions.create(checkoutParams, {idempotencyKey: `ctf7-checkout-${id}`});
      if (!session?.id || !/^https:\/\/checkout\.stripe\.com\//.test(session.url || "")) throw new Error("Checkout creation failed");
      await patch(id, {state: "checkout_open", checkoutSessionId: session.id});
      return {rentalId: id, token, checkoutUrl: session.url};
    } catch (error) {
      // Network ambiguity must retain the bank lease. Reconciliation recovers
      // the same Stripe session by its original idempotency key, never a vend.
      await patch(id, {state: "creation_pending", reason: "Checkout creation needs reconciliation"});
      throw error;
    }
  }
  async function read(id, token) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token || "")) fail(404, "not-found", "Rental not found.");
    const flow = (await flowRef(id).get()).data();
    if (!flow || flow.tokenHash !== tokenHash(token)) fail(404, "not-found", "Rental not found.");
    return flow;
  }
  async function release(flow) {
    await store.releaseReservation(flow, new Date(now()));
  }
  async function cancelPayment(flow, intent) {
    const stripe = client(flow);
    if (intent?.status === "succeeded") {
      await stripe.refunds.create({payment_intent: intent.id}, {idempotencyKey: `ctf7-failed-${flow.id}`});
    } else if (intent?.id && intent.status !== "canceled") {
      await stripe.paymentIntents.cancel(intent.id, {}, {idempotencyKey: `ctf7-cancel-${flow.id}`});
    }
  }
  async function reconcile(id) {
    let flow = (await flowRef(id).get()).data();
    if (!flow || terminal(flow.state)) return flow;
    if (!flow.checkoutSessionId) {
      if (!flow.checkoutParams || now() - millis(flow.createdAt) >= 86400000) {
        if (now() - millis(flow.createdAt) > 60000) await patch(id, {state: "verification_pending", reason: "Checkout creation uncertain"});
        return (await flowRef(id).get()).data();
      }
      // Retry only Stripe session creation with identical parameters/key.
      // Recover the original session; an expired bank reservation never vends.
      const recovered = await client(flow).checkout.sessions.create(flow.checkoutParams, {idempotencyKey: `ctf7-checkout-${id}`});
      await patch(id, {checkoutSessionId: recovered.id, state: "checkout_open"});
      flow = (await flowRef(id).get()).data();
    }
    const stripe = client(flow);
    let session = await stripe.checkout.sessions.retrieve(flow.checkoutSessionId, {expand: ["payment_intent"]});
    if (session.client_reference_id !== id || session.metadata?.chargerent_interaction_id !== id ||
      session.livemode !== (flow.stripeMode === "live")) fail(409, "payment", "Payment identity does not match.");
    let intent = session.payment_intent;
    if (typeof intent === "string") intent = await stripe.paymentIntents.retrieve(intent);
    if (intent && (intent.metadata?.chargerent_interaction_id !== id || intent.amount !== flow.amountCents ||
      intent.currency !== flow.currency || intent.livemode !== (flow.stripeMode === "live"))) {
      fail(409, "payment", "Payment identity does not match.");
    }
    if (["dispatch_pending", "vend_requested"].includes(flow.state)) {
      const rental = await store.getBesiterRental(flow.paymentIntentId);
      if (rental?.vendState === "dispensed") {
        // A receipt is issued only after the persisted physical vend proof.
        await patch(id, {state: "dispensed"}); await release(flow);
      } else if (rental?.vendState === "failed") {
        await cancelPayment(flow, intent); await patch(id, {state: "failed"}); await release(flow);
      } else if (rental?.vendState === "verification_pending") {
        await patch(id, {state: "verification_pending", reason: "Physical dispense requires verification"});
      } else {
        const requestRef = db.collection("ctf7TransportRequests").doc(tokenHash(`vend:${id}`));
        const failedBeforeMotor = await db.runTransaction(async tx => {
          const [request, currentRental] = await Promise.all([tx.get(requestRef),
            tx.get(db.collection("rentals").doc(flow.paymentIntentId))]);
          return request.data()?.state === "failed" && !currentRental.exists;
        });
        if (failedBeforeMotor) {
          await cancelPayment(flow, intent); await patch(id, {state: "failed"}); await release(flow);
          return (await flowRef(id).get()).data();
        }
        // The queue's identity is stable. Retrying enqueue cannot re-dispatch
        // an already claimed command, even after a browser/function crash.
        await gateway.sendVend({stationid: flow.stationId, moduleid: flow.moduleId, sn: flow.chargerSn,
          slotid: flow.reservedSlot, paymentIntentId: flow.paymentIntentId, interactionId: id, requestId: id});
      }
      return (await flowRef(id).get()).data();
    }
    if (paid(intent, flow)) {
      let ready = true;
      try { await station(flow.stationId); } catch { ready = false; }
      const claimed = await db.runTransaction(async tx => {
        const ref = flowRef(id), current = (await tx.get(ref)).data();
        const lockRef = db.collection("kioskTerminalReservations").doc(reservationId(flow.stationId, flow.moduleId, flow.chargerSn));
        const lock = (await tx.get(lockRef)).data();
        if (!["checkout_open", "expiring"].includes(current.state)) return false;
        if (!ready || millis(current.expiresAt) <= now() || lock?.interactionId !== id || millis(lock.expiresAt) <= now()) {
          tx.set(ref, {...current, state: "cleanup_pending", paymentIntentId: intent.id}); return false;
        }
        const resolution = flow.gatewayOption === "FULLPRICE" ? "authorized" : "captured";
        const expiresAt = new Date(now() + 180000);
        tx.set(lockRef, {...lock, expiresAt});
        tx.update(db.collection("kioskTerminalInteractions").doc(id), {paymentIntentId: intent.id,
          state: resolution === "authorized" ? "payment_authorized" : "payment_captured", paymentResolution: resolution,
          reservationExpiresAt: expiresAt, paymentAuthorizedAt: new Date(now())});
        tx.set(ref, {...current, state: "dispatch_pending", paymentIntentId: intent.id, expiresAt});
        return true;
      });
      flow = (await flowRef(id).get()).data();
      if (claimed || flow.state === "dispatch_pending") {
        await gateway.sendVend({stationid: flow.stationId, moduleid: flow.moduleId, sn: flow.chargerSn,
          slotid: flow.reservedSlot, paymentIntentId: intent.id, interactionId: id, requestId: id});
        // Never overwrite a concurrently completed/failed reconciliation.
        await db.runTransaction(async tx => { const ref = flowRef(id), current = (await tx.get(ref)).data();
          if (current.state === "dispatch_pending") tx.set(ref, {...current, state: "vend_requested"}); });
      } else if (flow.state === "cleanup_pending") {
        await cancelPayment(flow, intent); await patch(id, {state: "canceled"}); await release(flow);
      }
    } else if (now() >= millis(flow.expiresAt) || session.status === "expired" || flow.state === "cleanup_pending") {
      if (session.status === "open") {
        await patch(id, {state: "expiring"});
        try { await stripe.checkout.sessions.expire(session.id); }
        catch {
          const changed = await stripe.checkout.sessions.retrieve(session.id, {expand: ["payment_intent"]});
          if (changed.status === "open") throw new Error("Checkout expiration needs retry");
          return reconcile(id); // A completed payment can race expiration.
        }
        session = await stripe.checkout.sessions.retrieve(session.id, {expand: ["payment_intent"]});
        intent = session.payment_intent;
        if (typeof intent === "string") intent = await stripe.paymentIntents.retrieve(intent);
        if (paid(intent, flow)) return reconcile(id);
      }
      if (session.status !== "expired" && intent?.status === "processing") return flow;
      await cancelPayment(flow, intent); await patch(id, {state: "canceled"}); await release(flow);
    }
    return (await flowRef(id).get()).data();
  }
  async function status(id, token) {
    await read(id, token);
    const flow = await reconcile(id);
    const rental = flow.paymentIntentId ? await store.getBesiterRental(flow.paymentIntentId) : null;
    const link = rental && receiptService?.link({rental, rentalId: flow.paymentIntentId});
    return {rentalId: id, state: flow.state, slot: flow.state === "dispensed" ? flow.reservedSlot : null,
      returned: rental?.status === "returned", receiptUrl: link?.receiptUrl || null, testMode: flow.stripeMode === "test"};
  }
  async function tick() {
    const pending = await db.collection("ctf7Checkouts").where("state", "in", ["checkout_open", "creation_pending",
      "creating", "dispatch_pending", "vend_requested", "cleanup_pending", "expiring"]).limit(50).get();
    let failed = 0;
    for (const entry of pending.docs) {
      try { await reconcile(entry.id); } catch { failed++; }
    }
    return {checked: pending.size, failed};
  }
  return {offer, start, status, tick, reconcile};
}
function createCtf7CheckoutHandler(service) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store"); res.set("Referrer-Policy", "no-referrer");
    res.set("Access-Control-Allow-Origin", "https://chargerentstations.com");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
      const path = String(req.path || "/"); let value;
      const station = /^\/v1\/stations\/([A-Z]{2,3}\d{4})$/.exec(path);
      const rental = /^\/v1\/rentals\/([a-f0-9-]{36})$/.exec(path);
      if (station && req.method === "GET") value = await service.offer(station[1]);
      else if (station && req.method === "POST") value = await service.start(station[1], req.body, req.ip);
      else if (rental && req.method === "GET") value = await service.status(rental[1], String(req.headers.authorization || "").replace(/^Bearer /, ""));
      else fail(404, "not-found", "Rental service not found.");
      res.status(200).json(value);
    } catch (error) {
      res.status(error instanceof KioskTerminalError ? error.status : 503).json({
        error: error instanceof KioskTerminalError ? error.message : "The rental service is temporarily unavailable.",
        code: error instanceof KioskTerminalError ? error.code : "unavailable"});
    }
  };
}
module.exports = {createCtf7Checkout, createCtf7CheckoutHandler, paid};
