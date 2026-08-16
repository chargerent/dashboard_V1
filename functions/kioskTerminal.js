/* eslint-env node */
const crypto = require("node:crypto");

const INSTALLATIONS_COLLECTION = "kioskInstallations";
const INTERACTIONS_COLLECTION = "kioskTerminalInteractions";
const RESERVATIONS_COLLECTION = "kioskTerminalReservations";
const RETURNS_COLLECTION = "kioskTerminalReturns";
const RESERVATION_TTL_MS = 3 * 60 * 1000;
const RETURN_SESSION_TTL_MS = 2 * 60 * 1000;
const VEND_RESULT_TTL_MS = 2 * 60 * 1000;
const SHARED_TEST_ACCOUNT_CURRENCY_OVERRIDES = Object.freeze({
  US: "usd",
  FR: "usd",
});
const KIOSK_CURRENCY_CODES = Object.freeze({
  usd: "US",
  cad: "CA",
  eur: "FR",
});

class KioskTerminalError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "KioskTerminalError";
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new KioskTerminalError(status, code, message);
}

function cleanString(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeStripeAccountCountry(value) {
  const country = cleanString(value, 2).toUpperCase();
  if (!new Set(["US", "CA", "FR"]).has(country)) {
    fail(503, "stripe-account-not-configured", "The kiosk Stripe account is not configured.");
  }
  return country;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function reservationId(stationId, moduleId, chargerSn) {
  return crypto.createHash("sha256")
      .update(`${stationId}|${moduleId}|${chargerSn}`)
      .digest("hex");
}

function valueMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Date.parse(value) || 0;
}

function requestBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === "object" && !Buffer.isBuffer(body)) return body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      fail(400, "invalid-json", "The request body must be valid JSON.");
    }
  }
  fail(400, "invalid-json", "The request body must be a JSON object.");
}

function requestPath(req) {
  let path = cleanString(req.path || req.url || "/", 500).split("?")[0];
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path;
}

function bearerToken(req) {
  const header = cleanString(req.headers && req.headers.authorization, 600);
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : "";
  if (token.length < 32 || token.length > 512) {
    fail(401, "unauthorized", "A valid kiosk installation token is required.");
  }
  return token;
}

function normalizeSlotNumbers(installation) {
  const configured = Array.isArray(installation.slotNumbers) ?
    installation.slotNumbers : [];
  const slots = configured
      .map((slot) => Number(slot))
      .filter((slot) => Number.isInteger(slot) && slot > 0 && slot <= 100);
  if (slots.length) return [...new Set(slots)].sort((a, b) => a - b);

  const slotCount = Number(installation.slotCount);
  if (Number.isInteger(slotCount) && slotCount > 0 && slotCount <= 100) {
    return Array.from({length: slotCount}, (_value, index) => index + 1);
  }
  fail(503, "installation-not-configured", "No V2 slots are configured for this kiosk.");
}

function normalizePricingPlan(value) {
  const normalized = cleanString(value, 80)
      .toUpperCase()
      .replace(/[_/]+/g, " ")
      .replace(/\s+/g, " ");
  const plans = {
    "PURCHASE - SIMPLE DAILY": "PURCHASE_SIMPLE_DAILY",
    "PURCHASE - MIXED DAILY": "PURCHASE_MIXED_DAILY",
    "PURCHASE SIMPLE 24 HRS": "PURCHASE_SIMPLE_24_HRS",
    "PURCHASE - MIXED DAY": "PURCHASE_MIXED_DAY",
    "LEASE - SIMPLE DAILY": "LEASE_SIMPLE_DAILY",
    "LEASE - MIXED DAILY": "LEASE_MIXED_DAILY",
    "EVENT - SIMPLE": "EVENT_SIMPLE",
  };
  const planCode = plans[normalized];
  if (!planCode) {
    fail(503, "invalid-price", "The kiosk pricing plan is not supported by the phone terminal.");
  }
  return {planCode, planLabel: normalized};
}

function normalizeKioskCurrency(value) {
  const raw = cleanString(value, 10).toUpperCase();
  const aliases = {US: "USD", CAN: "CAD", CA: "CAD", FR: "EUR"};
  const currency = aliases[raw] || raw;
  if (!/^[A-Z]{3}$/.test(currency)) {
    fail(503, "invalid-currency", "The kiosk pricing currency is not configured correctly.");
  }
  return currency.toLowerCase();
}

function majorAmountCents(value, field, {minimum = 0, maximum = 1000000} = {}) {
  const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
  const amount = Number(normalized);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Math.abs((amount * 100) - cents) > 0.0001 ||
      cents < minimum || cents > maximum) {
    fail(503, "invalid-price", `The kiosk ${field} is not configured correctly.`);
  }
  return cents;
}

function positiveInteger(value, field) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0 || result > 3650) {
    fail(503, "invalid-price", `The kiosk ${field} is not configured correctly.`);
  }
  return result;
}

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function terminalPaymentCurrency(installation, configuredCurrency) {
  const stripeMode = cleanString(installation && installation.stripeMode, 10).toLowerCase();
  const accountCountry = normalizeStripeAccountCountry(
      installation && installation.stripeAccountCountry,
  );
  if (stripeMode === "test" && SHARED_TEST_ACCOUNT_CURRENCY_OVERRIDES[accountCountry]) {
    return SHARED_TEST_ACCOUNT_CURRENCY_OVERRIDES[accountCountry];
  }
  return configuredCurrency;
}

function resolveKioskOffer(installation, kiosk) {
  const pricing = kiosk && typeof kiosk.pricing === "object" ? kiosk.pricing : {};
  const hardware = kiosk && typeof kiosk.hardware === "object" ? kiosk.hardware : {};
  const {planCode, planLabel} = normalizePricingPlan(pricing.text);
  const configuredCurrency = normalizeKioskCurrency(pricing.currency);
  const currency = terminalPaymentCurrency(installation, configuredCurrency);
  const configuredKioskCurrency = cleanString(pricing.currency, 10).toUpperCase();
  const kioskCurrency = currency === configuredCurrency ?
    configuredKioskCurrency : (KIOSK_CURRENCY_CODES[currency] || currency.toUpperCase());
  const gatewayOption = cleanString(
      hardware.gatewayoptions || hardware.gatewayOptions,
      40,
  ).toUpperCase().replace(/[ _-]/g, "");
  if (!new Set(["FULLPRICE", "INITIALPRICE"]).has(gatewayOption)) {
    fail(503, "invalid-price", "The kiosk payment option is not supported by the phone terminal.");
  }

  const kioskMode = cleanString(pricing.kioskmode, 40).toUpperCase();
  const initialPeriodHours = positiveInteger(pricing.initialperiod, "initial period");
  const overdueDays = positiveInteger(pricing.overdue, "overdue period");
  const initialAmountCents = majorAmountCents(pricing.authamount, "authorization amount");
  const dailyPriceCents = majorAmountCents(pricing.dailyprice, "daily price");
  const buyPriceCents = majorAmountCents(pricing.buyprice, "not-returned price");
  const paymentAmountCents = gatewayOption === "FULLPRICE" ?
    buyPriceCents : (kioskMode === "LEASE" ? 0 : initialAmountCents);
  if (paymentAmountCents < 50 || paymentAmountCents > 10000) {
    fail(503, "invalid-price", "The kiosk payment amount must be between 0.50 and 100.00.");
  }

  const initialAmount = formatMoney(initialAmountCents, currency);
  const dailyPrice = formatMoney(dailyPriceCents, currency);
  const buyPrice = formatMoney(buyPriceCents, currency);
  const paymentAmount = formatMoney(paymentAmountCents, currency);
  const pricingLines = [];
  switch (planCode) {
    case "PURCHASE_SIMPLE_DAILY":
      pricingLines.push(`${dailyPrice} per 24-hour period`);
      pricingLines.push(`${buyPrice} if not returned after ${overdueDays} days`);
      break;
    case "PURCHASE_MIXED_DAILY":
    case "PURCHASE_MIXED_DAY":
      pricingLines.push(`${initialAmount} if returned within ${initialPeriodHours} hours`);
      pricingLines.push(`${dailyPrice} if returned the same day`);
      pricingLines.push(`${buyPrice} if not returned`);
      break;
    case "PURCHASE_SIMPLE_24_HRS":
      pricingLines.push(`${dailyPrice} for 24 hours`);
      pricingLines.push(`${buyPrice} if not returned`);
      break;
    case "LEASE_SIMPLE_DAILY":
      pricingLines.push("Free for the first 24 hours");
      pricingLines.push(`${dailyPrice} for each additional 24-hour period`);
      pricingLines.push(`${buyPrice} if not returned after ${overdueDays} days`);
      break;
    case "LEASE_MIXED_DAILY":
      pricingLines.push(`Free for the first ${initialPeriodHours} hours`);
      pricingLines.push(`${dailyPrice} for each additional 24-hour period`);
      pricingLines.push(`${buyPrice} if not returned after ${overdueDays} days`);
      break;
    case "EVENT_SIMPLE":
      pricingLines.push("Event pricing applies");
      break;
    default:
      fail(503, "invalid-price", "The kiosk pricing plan is not supported.");
  }

  const fullPrice = gatewayOption === "FULLPRICE";
  const paymentTerms = fullPrice ? [
    `I accept the ${paymentAmount} deposit, applicable rental charges, and the Terms and Conditions.`,
    "The deposit is refunded upon return, less applicable rental charges.",
  ] : [
    "I accept the applicable rental charges and the Terms and Conditions.",
    "The final charge depends on the rental duration.",
  ];

  return {
    stationId: installation.stationId,
    source: "kiosk",
    planCode,
    planLabel,
    gatewayOption,
    currency,
    kioskCurrency,
    configuredCurrency,
    configuredKioskCurrency,
    testCurrencyOverride: currency !== configuredCurrency,
    symbol: currency === configuredCurrency ?
      (cleanString(pricing.symbol, 8) || paymentAmount.replace(/[\d\s.,-]/g, "")) :
      paymentAmount.replace(/[\d\s.,-]/g, ""),
    paymentAmountCents,
    paymentAmount,
    depositAmountCents: fullPrice ? paymentAmountCents : null,
    initialPeriodHours,
    initialAmountCents,
    dailyPriceCents,
    buyPriceCents,
    overdueDays,
    pricingLines,
    paymentTerms,
  };
}

function normalizeBesiterAvailability(response, installation) {
  const stationId = cleanString(response && response.stationid, 40).toUpperCase();
  if (stationId !== installation.stationId ||
      cleanString(response && response.action, 20).toLowerCase() !== "status") {
    fail(502, "invalid-availability", "Besiter returned availability for the wrong kiosk.");
  }

  const rawStatus = response.status;
  if (!Array.isArray(rawStatus)) {
    const state = cleanString(rawStatus, 20).toLowerCase();
    if (state === "soldout") {
      return {state: "sold_out", availableCount: 0, selected: null};
    }
    if (state === "offline") {
      return {state: "offline", availableCount: 0, selected: null};
    }
    fail(502, "invalid-availability", "Besiter returned an unknown availability state.");
  }

  const chargerIds = [...new Set(rawStatus
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0))];
  const candidate = response.vendbattery && typeof response.vendbattery === "object" ?
    response.vendbattery : null;
  const chargerSn = Number(candidate && candidate.sn);
  const slot = Number(candidate && candidate.slot);
  const moduleId = cleanString(response.moduleid, 80);
  const batteryLevel = Number(candidate && candidate.powerlevel);

  if (!chargerIds.length) {
    return {state: "sold_out", availableCount: 0, selected: null};
  }
  if (!moduleId || !Number.isInteger(chargerSn) || chargerSn <= 0 ||
      !chargerIds.includes(chargerSn) || !Number.isInteger(slot) || slot <= 0 ||
      !Number.isFinite(batteryLevel)) {
    fail(502, "invalid-availability", "Besiter did not return a usable V2 charger candidate.");
  }

  return {
    state: "available",
    availableCount: chargerIds.length,
    selected: {moduleId, slot, chargerSn, batteryLevel},
  };
}

function besiterRentalOutcome(rental) {
  if (!rental || typeof rental !== "object") return {outcome: "pending"};
  const status = cleanString(rental.status, 40).toLowerCase();
  const vendState = cleanString(rental.vendState, 40).toLowerCase();
  const attempts = Array.isArray(rental.vendAttempts) ? rental.vendAttempts : [];
  const confirmationSource = cleanString(rental.vendConfirmationSource, 80);
  const hasPhysicalProof = attempts.some((attempt) => Number(attempt && attempt.exitStatus) === 1) ||
    confirmationSource === "popup_sn" || confirmationSource === "fresh_status_watchdog";

  if (status === "rented" && vendState === "dispensed" && hasPhysicalProof) {
    return {
      outcome: "vend_succeeded",
      slot: Number(rental.rentalSlotid || rental.requestedSlotid) || null,
      moduleId: cleanString(rental.rentalModuleid || rental.vendModuleid, 80) || null,
      chargerSn: Number(rental.chargerid || rental.sn) || null,
    };
  }
  if (status === "vend_failed" || vendState === "failed") {
    return {
      outcome: "vend_failed",
      message: cleanString(rental.failureReason || rental.lastVendFailureReason, 240) ||
        "The V2 kiosk could not release a charger.",
    };
  }
  return {outcome: "pending"};
}

function stripeIntentIdForRental(rental, rentalId = "") {
  return [
    rental && rental.paymentIntentId,
    rental && rental.paymentintentid,
    rental && rental.transactionid,
    rental && rental.orderid,
    rentalId,
  ].map((value) => cleanString(value, 160)).find((value) => /^pi_[A-Za-z0-9_]+$/.test(value)) || "";
}

async function settleStripeReturn({
  rental,
  rentalId,
  stripe,
  getStripeClient,
  store,
  now = () => new Date(),
}) {
  const gateway = cleanString(rental && rental.gateway, 40).toUpperCase();
  const status = cleanString(rental && rental.status, 40).toLowerCase();
  const existing = rental && typeof rental.stripeReturnSettlement === "object" ?
    rental.stripeReturnSettlement : {};
  const paymentIntentId = stripeIntentIdForRental(rental, rentalId);
  if (gateway !== "STRIPE" || status !== "returned" || !paymentIntentId ||
      existing.status === "completed") {
    return {handled: false};
  }
  if (!store || typeof store.updateBesiterRental !== "function") {
    throw new TypeError("A rental store is required.");
  }
  const interaction = typeof store.getInteractionByPaymentIntentId === "function" ?
    await store.getInteractionByPaymentIntentId(paymentIntentId) : null;
  const stripeAccountCountry = normalizeStripeAccountCountry(
      rental.stripeAccountCountry || interaction?.stripeAccountCountry,
  );
  const stripeMode = cleanString(
      rental.stripeMode || interaction?.stripeMode || "test",
      10,
  ).toLowerCase();
  const stripeClient = stripe || (typeof getStripeClient === "function" ?
    getStripeClient({accountCountry: stripeAccountCountry, mode: stripeMode}) : null);
  if (!stripeClient || !stripeClient.paymentIntents || !stripeClient.refunds) {
    throw new TypeError("A Stripe client with refunds is required.");
  }

  const totalChargedCents = majorAmountCents(rental.totalCharged || 0, "return charge", {
    minimum: 0,
    maximum: 1000000,
  });
  const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
  if (!paymentIntent || paymentIntent.status !== "succeeded") {
    fail(409, "return-payment-not-settled", "The returned rental payment is not captured.");
  }
  const capturedCents = Number(paymentIntent.amount_received || paymentIntent.amount || 0);
  if (!Number.isInteger(capturedCents) || capturedCents <= 0 || totalChargedCents > capturedCents) {
    fail(409, "invalid-return-charge", "The returned rental charge exceeds the captured deposit.");
  }
  const refundCents = capturedCents - totalChargedCents;
  let refundId = cleanString(existing.refundId, 160) || null;
  if (refundCents > 0) {
    const refund = await stripeClient.refunds.create({
      payment_intent: paymentIntentId,
      amount: refundCents,
      metadata: {
        chargerent_rental_id: cleanString(rentalId, 160),
        chargerent_station_id: cleanString(rental.returnStationid || rental.rentalStationid, 80),
      },
    }, {idempotencyKey: `kiosk-return-refund-${cleanString(rentalId, 120)}`});
    refundId = cleanString(refund && refund.id, 160) || refundId;
  }

  const settledAt = now();
  await store.updateBesiterRental(rentalId, {
    stripeReturnSettlement: {
      status: "completed",
      paymentIntentId,
      capturedCents,
      finalChargeCents: totalChargedCents,
      refundCents,
      refundId,
      stripeAccountCountry,
      stripeMode,
      settledAt,
    },
    paymentStatus: refundCents > 0 ? "partially_or_fully_refunded" : "captured",
    lastUpdate: settledAt.toISOString(),
  });
  return {handled: true, capturedCents, finalChargeCents: totalChargedCents, refundCents};
}

function validateInstallation(installation) {
  if (!installation || installation.active !== true) {
    fail(403, "installation-disabled", "This kiosk installation is disabled.");
  }
  const required = ["stationId", "provisionId", "moduleId"];
  for (const field of required) {
    if (!cleanString(installation[field])) {
      fail(503, "installation-not-configured", `The installation is missing ${field}.`);
    }
  }
  if (cleanString(installation.stripeMode).toLowerCase() !== "test") {
    fail(503, "stripe-mode-mismatch", "This pilot endpoint requires Stripe test mode.");
  }
  const stripeAccountCountry = normalizeStripeAccountCountry(installation.stripeAccountCountry);
  if (!cleanString(installation.stripeLocationId, 160).startsWith("tml_")) {
    fail(503, "stripe-location-not-configured", "The kiosk Stripe location is not configured.");
  }
  installation.stripeAccountCountry = stripeAccountCountry;
  normalizeSlotNumbers(installation);
  return installation;
}

function assertStation(req, body, installation) {
  const headerStation = cleanString(
      req.headers && req.headers["x-chargerent-station"],
      40,
  );
  if (!headerStation || headerStation !== installation.stationId) {
    fail(403, "station-mismatch", "The request does not match this kiosk installation.");
  }
  const bodyStation = cleanString(body.stationId, 40);
  if (bodyStation && bodyStation !== installation.stationId) {
    fail(403, "station-mismatch", "The request does not match this kiosk installation.");
  }
}

function assertInteractionOwner(interaction, installation) {
  if (!interaction || interaction.installationId !== installation.id) {
    fail(404, "interaction-not-found", "The kiosk interaction was not found.");
  }
}

function assertReturnOwner(session, installation) {
  if (!session || session.installationId !== installation.id) {
    fail(404, "return-session-not-found", "The return session was not found.");
  }
}

function createFirestoreKioskTerminalStore(db) {
  if (!db) throw new TypeError("A Firestore instance is required.");

  return {
    async getInstallation(id) {
      const snapshot = await db.collection(INSTALLATIONS_COLLECTION).doc(id).get();
      return snapshot.exists ? {id: snapshot.id, ...snapshot.data()} : null;
    },

    async confirmInstallation(installation, report, now) {
      const installationRef = db.collection(INSTALLATIONS_COLLECTION).doc(installation.id);
      const deviceRef = db.collection("phoneDevices").doc(installation.deviceId);
      const assignmentRef = db.collection("phoneKioskAssignments").doc(installation.stationId);
      await db.runTransaction(async (transaction) => {
        const [installationSnapshot, deviceSnapshot] = await Promise.all([
          transaction.get(installationRef),
          transaction.get(deviceRef),
        ]);
        if (!installationSnapshot.exists || installationSnapshot.data()?.active !== true) {
          fail(403, "installation-disabled", "This kiosk installation is disabled.");
        }
        const device = deviceSnapshot.data() || {};
        const terminal = device.terminal && typeof device.terminal === "object" ?
          device.terminal : {};
        if (terminal.installationId !== installation.id ||
            cleanString(device.stationId, 40).toUpperCase() !== installation.stationId) {
          fail(409, "installation-reassigned", "This phone was assigned to another kiosk.");
        }
        const terminalUpdate = {
          ...terminal,
          enabled: true,
          state: "ready",
          lockdownEnabled: true,
          message: `Payment app confirmed ${installation.stationId} configuration.`,
          confirmedAt: now,
          updatedAt: now,
        };
        transaction.set(installationRef, {
          confirmationState: "confirmed",
          confirmedAt: now,
          lastSeenAt: now,
          deviceReportedConfig: report,
          updatedAt: now,
        }, {merge: true});
        transaction.set(deviceRef, {
          terminal: terminalUpdate,
          updatedAt: now,
        }, {merge: true});
        transaction.set(assignmentRef, {
          terminalEnabled: true,
          terminal: terminalUpdate,
          updatedAt: now,
        }, {merge: true});
      });
    },

    async verifyKiosk(installation) {
      const snapshot = await db.collection("kiosks")
          .doc(installation.provisionId)
          .get();
      if (!snapshot.exists) {
        fail(503, "kiosk-not-found", "The configured V2 kiosk was not found.");
      }
      const kiosk = snapshot.data() || {};
      if (cleanString(kiosk.stationid, 40) !== installation.stationId) {
        fail(503, "kiosk-config-mismatch", "The kiosk station configuration does not match.");
      }
      const modules = Array.isArray(kiosk.modules) ? kiosk.modules : [];
      const foundModule = modules.some((module) => (
        cleanString(module && (module.id || module.moduleid || module.moduleId), 80) ===
        installation.moduleId
      ));
      if (!foundModule) {
        fail(503, "module-not-found", "The configured V2 module was not found on the kiosk.");
      }
      return {id: snapshot.id, ...kiosk};
    },

    async reserveInteraction(interaction, candidate, expiresAt, now) {
      const interactionRef = db.collection(INTERACTIONS_COLLECTION).doc(interaction.id);
      const lockRef = db.collection(RESERVATIONS_COLLECTION).doc(reservationId(
          interaction.stationId,
          candidate.moduleId,
          candidate.chargerSn,
      ));

      return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(lockRef);
        const existing = snapshot.exists ? snapshot.data() : null;
        if (existing && valueMillis(existing.expiresAt) > now.getTime()) {
          fail(409, "charger-reserved", "The available V2 charger was just reserved. Please try again.");
        }

        transaction.set(lockRef, {
          interactionId: interaction.id,
          installationId: interaction.installationId,
          stationId: interaction.stationId,
          moduleId: candidate.moduleId,
          chargerSn: candidate.chargerSn,
          slot: candidate.slot,
          expiresAt,
          updatedAt: now,
        });
        transaction.create(interactionRef, {
          ...interaction,
          moduleId: candidate.moduleId,
          chargerSn: candidate.chargerSn,
          reservedSlot: candidate.slot,
          batteryLevel: candidate.batteryLevel,
          reservationExpiresAt: expiresAt,
          createdAt: now,
          updatedAt: now,
        });
        return {
          ...interaction,
          moduleId: candidate.moduleId,
          chargerSn: candidate.chargerSn,
          reservedSlot: candidate.slot,
          batteryLevel: candidate.batteryLevel,
        };
      });
    },

    async getInteraction(id) {
      const snapshot = await db.collection(INTERACTIONS_COLLECTION).doc(id).get();
      return snapshot.exists ? {id: snapshot.id, ...snapshot.data()} : null;
    },

    async getInteractionByPaymentIntentId(paymentIntentId) {
      const snapshot = await db.collection(INTERACTIONS_COLLECTION)
          .where("paymentIntentId", "==", paymentIntentId)
          .limit(1)
          .get();
      return snapshot.empty ? null : {id: snapshot.docs[0].id, ...snapshot.docs[0].data()};
    },

    async updateInteraction(id, patch, now) {
      await db.collection(INTERACTIONS_COLLECTION).doc(id).set({
        ...patch,
        updatedAt: now,
      }, {merge: true});
    },

    async extendReservation(interaction, expiresAt, now) {
      const lockRef = db.collection(RESERVATIONS_COLLECTION).doc(reservationId(
          interaction.stationId,
          interaction.moduleId,
          interaction.chargerSn,
      ));
      const interactionRef = db.collection(INTERACTIONS_COLLECTION).doc(interaction.id);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(lockRef);
        if (!snapshot.exists || snapshot.data().interactionId !== interaction.id) {
          fail(409, "reservation-lost", "The charger reservation is no longer available.");
        }
        transaction.set(lockRef, {expiresAt, updatedAt: now}, {merge: true});
        transaction.set(interactionRef, {
          reservationExpiresAt: expiresAt,
          updatedAt: now,
        }, {merge: true});
      });
    },

    async releaseReservation(interaction, now) {
      const lockRef = db.collection(RESERVATIONS_COLLECTION).doc(reservationId(
          interaction.stationId,
          interaction.moduleId,
          interaction.chargerSn,
      ));
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(lockRef);
        if (snapshot.exists && snapshot.data().interactionId === interaction.id) {
          transaction.delete(lockRef);
        }
        transaction.set(db.collection(INTERACTIONS_COLLECTION).doc(interaction.id), {
          reservationReleasedAt: now,
          updatedAt: now,
        }, {merge: true});
      });
    },

    async createReturnSession(session, now) {
      await db.collection(RETURNS_COLLECTION).doc(session.id).create({
        ...session,
        createdAt: now,
        updatedAt: now,
      });
    },

    async getReturnSession(id) {
      const snapshot = await db.collection(RETURNS_COLLECTION).doc(id).get();
      return snapshot.exists ? {id: snapshot.id, ...snapshot.data()} : null;
    },

    async updateReturnSession(id, patch, now) {
      await db.collection(RETURNS_COLLECTION).doc(id).set({
        ...patch,
        updatedAt: now,
      }, {merge: true});
    },

    async findReturnSince(session) {
      const snapshot = await db.collection("rentals")
          .where("returnStationid", "==", session.stationId)
          .limit(100)
          .get();
      const startedAt = valueMillis(session.startedAt || session.createdAt);
      const match = snapshot.docs
          .map((doc) => ({id: doc.id, ...doc.data()}))
          .filter((rental) => valueMillis(rental.returnTime) >= startedAt)
          .sort((left, right) => valueMillis(right.returnTime) - valueMillis(left.returnTime))[0];
      return match || null;
    },

    async getBesiterRental(paymentIntentId) {
      const snapshot = await db.collection("rentals").doc(paymentIntentId).get();
      return snapshot.exists ? {id: snapshot.id, ...snapshot.data()} : null;
    },

    async updateBesiterRental(rentalId, patch) {
      await db.collection("rentals").doc(rentalId).set(patch, {merge: true});
    },
  };
}

function createKioskTerminalService({
  store,
  getStripeClient,
  besiterGateway,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
}) {
  if (!store) throw new TypeError("A kiosk Terminal store is required.");
  if (typeof getStripeClient !== "function") {
    throw new TypeError("A Stripe client factory is required.");
  }
  if (!besiterGateway || typeof besiterGateway.requestAvailability !== "function" ||
      typeof besiterGateway.sendVend !== "function") {
    throw new TypeError("A Besiter gateway is required.");
  }

  async function authorize(req, body = {}) {
    const installation = await store.getInstallation(tokenHash(bearerToken(req)));
    if (!installation) {
      fail(401, "unauthorized", "A valid kiosk installation token is required.");
    }
    validateInstallation(installation);
    assertStation(req, body, installation);
    return installation;
  }

  async function loadInteraction(id, installation) {
    const interaction = await store.getInteraction(cleanString(id, 100));
    assertInteractionOwner(interaction, installation);
    return interaction;
  }

  async function loadKioskOffer(installation) {
    const kiosk = await store.verifyKiosk(installation);
    return resolveKioskOffer(installation, kiosk);
  }

  async function loadAvailability(installation) {
    const requestId = randomUUID();
    const requestedAt = now().getTime();
    const response = await besiterGateway.requestAvailability({
      stationId: installation.stationId,
      requestId,
      requestedAt,
    });
    return {
      ...normalizeBesiterAvailability(response, installation),
      requestId,
      checkedAt: new Date(Number(response.timeresponded) || now().getTime()).toISOString(),
    };
  }

  function stripe(primary = {}, fallback = {}) {
    const accountCountry = normalizeStripeAccountCountry(
        primary.stripeAccountCountry || fallback.stripeAccountCountry,
    );
    const mode = cleanString(
        primary.stripeMode || fallback.stripeMode || "test",
        10,
    ).toLowerCase();
    let client;
    try {
      client = getStripeClient({accountCountry, mode});
    } catch {
      fail(
          503,
          "stripe-account-not-configured",
          `The ${accountCountry} Stripe ${mode} account is not configured.`,
      );
    }
    if (!client || !client.paymentIntents || !client.terminal) {
      fail(503, "stripe-not-configured", "Stripe Terminal is not configured.");
    }
    return client;
  }

  async function cancelOrRefundPayment(client, interaction) {
    if (!interaction.paymentIntentId) return "not_created";
    const paymentIntent = await client.paymentIntents.retrieve(interaction.paymentIntentId);
    if (paymentIntent.status === "canceled") return "canceled";
    if (paymentIntent.status === "succeeded") {
      if (!client.refunds) {
        fail(503, "stripe-not-configured", "Stripe refunds are not configured.");
      }
      await client.refunds.create(
          {payment_intent: paymentIntent.id},
          {idempotencyKey: `kiosk-refund-${interaction.id}`},
      );
      return "refunded";
    }
    await client.paymentIntents.cancel(paymentIntent.id);
    return "canceled";
  }

  return {
    async confirmInstallation(req) {
      const body = requestBody(req);
      const installation = await authorize(req, body);
      const report = {
        stationId: cleanString(body.stationId, 40).toUpperCase(),
        provisionId: cleanString(body.provisionId, 100),
        moduleId: cleanString(body.moduleId, 100),
        slotCount: Number(body.slotCount),
        currency: cleanString(body.currency, 10).toLowerCase(),
        appVersion: cleanString(body.appVersion, 40),
      };
      if (report.provisionId !== installation.provisionId ||
          report.moduleId !== installation.moduleId ||
          report.currency !== cleanString(installation.currency, 10).toLowerCase() ||
          report.slotCount !== normalizeSlotNumbers(installation).length) {
        fail(409, "installation-config-mismatch", "The payment app configuration is out of date.");
      }
      await store.confirmInstallation(installation, report, now());
      return {
        status: 200,
        body: {confirmed: true, stationId: installation.stationId},
      };
    },

    async getConfig(req) {
      const installation = await authorize(req);
      const [offer, availability] = await Promise.all([
        loadKioskOffer(installation),
        loadAvailability(installation),
      ]);
      return {
        status: 200,
        body: {
          stationId: installation.stationId,
          provisionId: installation.provisionId,
          moduleId: availability.selected?.moduleId || installation.moduleId,
          slotCount: normalizeSlotNumbers(installation).length,
          pricing: offer,
          availability,
        },
      };
    },

    async createConnectionToken(req) {
      const body = requestBody(req);
      const installation = await authorize(req, body);
      const token = await stripe(installation).terminal.connectionTokens.create();
      if (!token || !token.secret) {
        fail(502, "stripe-token-failed", "Stripe did not return a connection token.");
      }
      return {status: 200, body: {secret: token.secret}};
    },

    async createInteraction(req) {
      const body = requestBody(req);
      const installation = await authorize(req, body);
      if (cleanString(body.intent, 20) !== "rent" ||
          cleanString(body.provisionId, 80) !== installation.provisionId) {
        fail(403, "kiosk-config-mismatch", "The rental request does not match this kiosk.");
      }
      const [offer, availability] = await Promise.all([
        loadKioskOffer(installation),
        loadAvailability(installation),
      ]);
      if (availability.state === "sold_out") {
        fail(409, "sold-out", "No eligible V2 charger is currently available.");
      }
      if (availability.state !== "available" || !availability.selected) {
        fail(503, "kiosk-offline", "The V2 kiosk is not currently available.");
      }

      const timestamp = now();
      const interaction = await store.reserveInteraction({
        id: randomUUID(),
        installationId: installation.id,
        stationId: installation.stationId,
        stripeAccountCountry: installation.stripeAccountCountry,
        stripeMode: installation.stripeMode,
        provisionId: installation.provisionId,
        moduleId: availability.selected.moduleId,
        amountCents: offer.paymentAmountCents,
        currency: offer.currency,
        kioskCurrency: offer.kioskCurrency,
        symbol: offer.symbol,
        buyPriceCents: offer.buyPriceCents,
        authorizationAmountCents: offer.initialAmountCents,
        pricingSource: offer.source,
        pricingPlan: offer.planCode,
        gatewayOption: offer.gatewayOption,
        availabilityRequestId: availability.requestId,
        availabilityCheckedAt: availability.checkedAt,
        outcome: "pending",
        state: "reserved",
      }, availability.selected, new Date(
          timestamp.getTime() + RESERVATION_TTL_MS,
      ), timestamp);

      return {
        status: 200,
        body: {
          interactionId: interaction.id,
          reservedSlot: interaction.reservedSlot,
          amountCents: interaction.amountCents,
          currency: interaction.currency,
          pricingPlan: interaction.pricingPlan,
          gatewayOption: interaction.gatewayOption,
          availabilityCheckedAt: interaction.availabilityCheckedAt,
        },
      };
    },

    async createPaymentIntent(req, interactionId) {
      const installation = await authorize(req);
      const interaction = await loadInteraction(interactionId, installation);
      const client = stripe(interaction, installation);

      const timestamp = now();
      if (valueMillis(interaction.reservationExpiresAt) <= timestamp.getTime()) {
        fail(409, "reservation-expired", "The charger reservation has expired. Please try again.");
      }
      await store.extendReservation(
          interaction,
          new Date(timestamp.getTime() + RESERVATION_TTL_MS),
          timestamp,
      );

      if (interaction.paymentIntentId) {
        const existing = await client.paymentIntents.retrieve(interaction.paymentIntentId);
        if (!existing.client_secret) {
          fail(409, "payment-intent-unavailable", "The existing payment cannot be resumed.");
        }
        return {
          status: 200,
          body: {paymentIntentId: existing.id, clientSecret: existing.client_secret},
        };
      }

      const paymentIntent = await client.paymentIntents.create({
        amount: interaction.amountCents,
        currency: interaction.currency,
        payment_method_types: ["card_present"],
        capture_method: "manual",
        description: `Chargerent ${interaction.stationId} kiosk rental`,
        metadata: {
          chargerent_interaction_id: interaction.id,
          chargerent_station_id: interaction.stationId,
          chargerent_module_id: interaction.moduleId,
          chargerent_slot: String(interaction.reservedSlot),
          chargerent_charger_sn: String(interaction.chargerSn),
        },
      }, {idempotencyKey: `kiosk-payment-${interaction.id}`});
      if (!paymentIntent || !paymentIntent.id || !paymentIntent.client_secret) {
        fail(502, "payment-intent-failed", "Stripe did not create a usable payment.");
      }
      await store.updateInteraction(interaction.id, {
        paymentIntentId: paymentIntent.id,
        state: "payment_intent_created",
      }, now());
      return {
        status: 200,
        body: {paymentIntentId: paymentIntent.id, clientSecret: paymentIntent.client_secret},
      };
    },

    async paymentProcessed(req, interactionId) {
      const body = requestBody(req);
      const installation = await authorize(req, body);
      const interaction = await loadInteraction(interactionId, installation);
      const paymentIntentId = cleanString(body.paymentIntentId, 120);
      if (!paymentIntentId || paymentIntentId !== interaction.paymentIntentId) {
        fail(409, "payment-mismatch", "The processed payment does not match this interaction.");
      }

      const timestamp = now();
      await store.extendReservation(
          interaction,
          new Date(timestamp.getTime() + RESERVATION_TTL_MS),
          timestamp,
      );

      const paymentIntent = await stripe(interaction, installation)
          .paymentIntents.retrieve(paymentIntentId);
      const metadataInteraction = cleanString(
          paymentIntent.metadata && paymentIntent.metadata.chargerent_interaction_id,
          100,
      );
      if (metadataInteraction !== interaction.id ||
          paymentIntent.amount !== interaction.amountCents ||
          paymentIntent.currency !== interaction.currency) {
        fail(409, "payment-mismatch", "Stripe returned an unexpected payment.");
      }
      if (paymentIntent.status !== "requires_capture") {
        fail(409, "payment-not-authorized", "The card payment is not authorized for vending.");
      }

      await store.updateInteraction(interaction.id, {
        state: "payment_authorized",
        paymentAuthorizedAt: timestamp,
        message: "Payment authorized; sending the selected charger to Besiter.",
      }, timestamp);

      try {
        await besiterGateway.sendVend({
          stationid: interaction.stationId,
          moduleid: interaction.moduleId,
          chargerid: interaction.chargerSn,
          sn: interaction.chargerSn,
          slotid: interaction.reservedSlot,
          orderid: paymentIntentId,
          transactionid: paymentIntentId,
          paymentIntentId,
          requestId: interaction.id,
          interactionId: interaction.id,
          paymentStatus: "approved",
          paymentApprovedAt: timestamp.toISOString(),
          rentalTime: timestamp.toISOString(),
          timerequested: timestamp.getTime(),
          gateway: "STRIPE",
          stripeAccountCountry: interaction.stripeAccountCountry,
          stripeMode: interaction.stripeMode,
          currency: interaction.kioskCurrency || interaction.currency.toUpperCase(),
          symbol: interaction.symbol || null,
          buyprice: Number(interaction.buyPriceCents || 0) / 100,
          authamount: Number(interaction.authorizationAmountCents || 0) / 100,
          maxVendAttempts: 3,
        });
      } catch (error) {
        const paymentResolution = await cancelOrRefundPayment(
            stripe(interaction, installation),
            interaction,
        );
        await store.updateInteraction(interaction.id, {
          outcome: paymentResolution === "refunded" ? "refunded" : "vend_failed",
          state: "vend_request_failed",
          paymentResolution,
          message: "The V2 vend request could not be sent. The payment was canceled.",
        }, now());
        await store.releaseReservation(interaction, now());
        throw error;
      }

      await store.updateInteraction(interaction.id, {
        state: "vend_requested",
        vendRequestedAt: now(),
        message: "Besiter is releasing the selected charger.",
      }, now());
      return {status: 202, body: {accepted: true, state: "vend_requested"}};
    },

    async getInteraction(req, interactionId) {
      const installation = await authorize(req);
      let interaction = await loadInteraction(interactionId, installation);
      if ((interaction.outcome || "pending") === "pending" && interaction.paymentIntentId) {
        const rental = await store.getBesiterRental(interaction.paymentIntentId);
        const physical = besiterRentalOutcome(rental);
        if (physical.outcome === "vend_succeeded") {
          const client = stripe(interaction, installation);
          const paymentIntent = await client.paymentIntents.retrieve(interaction.paymentIntentId);
          if (paymentIntent.status === "requires_capture") {
            await client.paymentIntents.capture(
                interaction.paymentIntentId,
                {},
                {idempotencyKey: `kiosk-capture-${interaction.id}`},
            );
          } else if (paymentIntent.status !== "succeeded") {
            fail(409, "payment-not-capturable", "The authorized payment could not be captured.");
          }
          const completedAt = now();
          await store.updateInteraction(interaction.id, {
            outcome: "vend_succeeded",
            state: "complete",
            paymentResolution: "captured",
            paymentCapturedAt: completedAt,
            reservedSlot: physical.slot || interaction.reservedSlot,
            moduleId: physical.moduleId || interaction.moduleId,
            chargerSn: physical.chargerSn || interaction.chargerSn,
            message: "The V2 kiosk confirmed that the charger was dispensed.",
          }, completedAt);
          await store.releaseReservation(interaction, completedAt);
          interaction = {
            ...interaction,
            outcome: "vend_succeeded",
            reservedSlot: physical.slot || interaction.reservedSlot,
            message: "The V2 kiosk confirmed that the charger was dispensed.",
          };
        } else if (physical.outcome === "vend_failed") {
          const paymentResolution = await cancelOrRefundPayment(
              stripe(interaction, installation),
              interaction,
          );
          const failedAt = now();
          await store.updateInteraction(interaction.id, {
            outcome: paymentResolution === "refunded" ? "refunded" : "vend_failed",
            state: "vend_failed",
            paymentResolution,
            message: physical.message,
          }, failedAt);
          await store.releaseReservation(interaction, failedAt);
          interaction = {
            ...interaction,
            outcome: paymentResolution === "refunded" ? "refunded" : "vend_failed",
            message: physical.message,
          };
        } else if (valueMillis(interaction.vendRequestedAt) > 0 &&
            now().getTime() - valueMillis(interaction.vendRequestedAt) > VEND_RESULT_TTL_MS) {
          const paymentResolution = await cancelOrRefundPayment(
              stripe(interaction, installation),
              interaction,
          );
          const timedOutAt = now();
          await store.updateInteraction(interaction.id, {
            outcome: paymentResolution === "refunded" ? "refunded" : "vend_failed",
            state: "vend_result_timeout",
            paymentResolution,
            message: "The kiosk did not confirm a physical dispense. The payment was canceled.",
          }, timedOutAt);
          await store.releaseReservation(interaction, timedOutAt);
          interaction = {
            ...interaction,
            outcome: paymentResolution === "refunded" ? "refunded" : "vend_failed",
            message: "The kiosk did not confirm a physical dispense. The payment was canceled.",
          };
        }
      }
      return {
        status: 200,
        body: {
          outcome: interaction.outcome || "pending",
          slot: interaction.reservedSlot || null,
          message: interaction.message || null,
        },
      };
    },

    async cancelInteraction(req, interactionId) {
      const installation = await authorize(req);
      const interaction = await loadInteraction(interactionId, installation);
      let paymentResolution = "not_created";
      if (interaction.paymentIntentId) {
        paymentResolution = await cancelOrRefundPayment(
            stripe(interaction, installation),
            interaction,
        );
      }
      const timestamp = now();
      await store.updateInteraction(interaction.id, {
        outcome: paymentResolution === "refunded" ? "refunded" : "vend_failed",
        state: "canceled",
        paymentResolution,
        message: paymentResolution === "refunded" ?
          "The payment was refunded." : "The rental was canceled before capture.",
      }, timestamp);
      await store.releaseReservation(interaction, timestamp);
      return {status: 200, body: {canceled: true, paymentResolution}};
    },

    async createReturnSession(req) {
      const body = requestBody(req);
      const installation = await authorize(req, body);
      if (cleanString(body.moduleId, 80) !== installation.moduleId) {
        fail(403, "kiosk-config-mismatch", "The return request does not match this kiosk.");
      }
      await store.verifyKiosk(installation);
      const timestamp = now();
      const session = {
        id: randomUUID(),
        installationId: installation.id,
        stationId: installation.stationId,
        moduleId: installation.moduleId,
        outcome: "pending",
        state: "waiting_for_besiter_return",
        startedAt: timestamp.toISOString(),
        expiresAt: new Date(timestamp.getTime() + RETURN_SESSION_TTL_MS),
      };
      await store.createReturnSession(session, timestamp);
      return {status: 200, body: {returnSessionId: session.id}};
    },

    async getReturnSession(req, returnSessionId) {
      const installation = await authorize(req);
      const session = await store.getReturnSession(cleanString(returnSessionId, 100));
      assertReturnOwner(session, installation);
      let outcome = session.outcome;
      if (outcome === "pending") {
        const returnedRental = await store.findReturnSince(session);
        if (returnedRental) {
          outcome = "received";
          await store.updateReturnSession(session.id, {
            outcome,
            state: "besiter_return_confirmed",
            rentalId: returnedRental.id,
            chargerSn: Number(returnedRental.chargerid || returnedRental.sn) || null,
            returnModuleId: cleanString(returnedRental.returnModuleid, 80) || null,
            returnSlot: Number(returnedRental.returnSlotid) || null,
            receivedAt: returnedRental.returnTime || now().toISOString(),
          }, now());
        } else if (valueMillis(session.expiresAt) <= now().getTime()) {
          outcome = "failed";
        }
      }
      return {status: 200, body: {outcome}};
    },
  };
}

function setResponseHeaders(req, res) {
  const origin = cleanString(req.headers && req.headers.origin, 300) || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Chargerent-Station",
  );
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Cache-Control", "no-store");
}

function createKioskTerminalHandler(service) {
  if (!service) throw new TypeError("A kiosk Terminal service is required.");

  return async (req, res) => {
    setResponseHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const method = cleanString(req.method, 10).toUpperCase();
    const path = requestPath(req);
    try {
      let result;
      if (method === "POST" && path === "/v1/installation/confirm") {
        result = await service.confirmInstallation(req);
      } else if (method === "GET" && path === "/v1/config") {
        result = await service.getConfig(req);
      } else if (method === "POST" && path === "/v1/terminal/connection-token") {
        result = await service.createConnectionToken(req);
      } else if (method === "POST" && path === "/v1/interactions") {
        result = await service.createInteraction(req);
      } else if (method === "POST" && /^\/v1\/interactions\/[^/]+\/payment-intent$/.test(path)) {
        result = await service.createPaymentIntent(req, path.split("/")[3]);
      } else if (method === "POST" && /^\/v1\/interactions\/[^/]+\/payment-processed$/.test(path)) {
        result = await service.paymentProcessed(req, path.split("/")[3]);
      } else if (method === "POST" && /^\/v1\/interactions\/[^/]+\/cancel$/.test(path)) {
        result = await service.cancelInteraction(req, path.split("/")[3]);
      } else if (method === "GET" && /^\/v1\/interactions\/[^/]+$/.test(path)) {
        result = await service.getInteraction(req, path.split("/")[3]);
      } else if (method === "POST" && path === "/v1/returns") {
        result = await service.createReturnSession(req);
      } else if (method === "GET" && /^\/v1\/returns\/[^/]+$/.test(path)) {
        result = await service.getReturnSession(req, path.split("/")[3]);
      } else {
        fail(404, "not-found", "Kiosk Terminal API route not found.");
      }
      res.status(result.status).json(result.body);
    } catch (error) {
      const known = error instanceof KioskTerminalError;
      if (!known) console.error("kioskTerminalApi failed", error);
      res.status(known ? error.status : 500).json({
        error: known ? error.message : "The kiosk service could not complete the request.",
        code: known ? error.code : "internal",
      });
    }
  };
}

module.exports = {
  besiterRentalOutcome,
  KioskTerminalError,
  createFirestoreKioskTerminalStore,
  createKioskTerminalHandler,
  createKioskTerminalService,
  resolveKioskOffer,
  normalizeBesiterAvailability,
  settleStripeReturn,
  stripeIntentIdForRental,
  reservationId,
  tokenHash,
};
