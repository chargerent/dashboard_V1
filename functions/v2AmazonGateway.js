/* eslint-env node */
const CONFIG_PATH = "accounting/v2AmazonCheckout";
// Explicit migration scope: FR8012 cannot revert to direct/legacy vending while
// its shared V2 billing profile is being repaired. Ownership also follows an
// installation when it is assigned to another station.
const REQUIRED_V2_STATIONS = new Set(["FR8012"]);

class V2AmazonGatewayError extends Error {
  constructor(code, phase, {ownershipMayHaveTransferred = phase === "vend"} = {}) {
    super(code);
    this.code = code;
    this.phase = phase;
    this.mightHaveVended = phase === "vend";
    this.ownershipMayHaveTransferred = ownershipMayHaveTransferred;
  }
}

function selectV2AmazonRoute(config, installation) {
  const required = REQUIRED_V2_STATIONS.has(installation.stationId) || installation.billingOwner === "amazon_v2";
  if (config?.enabled !== true || !Array.isArray(config.stationIds) ||
      !config.stationIds.includes(installation.stationId)) {
    if (required) throw new V2AmazonGatewayError("v2-checkout-required-configuration-missing", "configuration");
    return null;
  }
  if (config.stripeMode !== "live" || installation.stripeMode !== config.stripeMode ||
      installation.stripeAccountCountry !== "FR" ||
      String(installation.moduleId).startsWith("LM-") ||
      !/^acct_[A-Za-z0-9]+$/.test(config.stripeAccountId || "") ||
      !/^[A-Za-z0-9_.:-]{1,100}$/.test(config.paymentProfile || "") ||
      config.paymentProfile.toUpperCase() === "DEFAULT" || config.paymentProfileVerified !== true) {
    throw new V2AmazonGatewayError("v2-checkout-configuration-mismatch", "configuration");
  }
  return {billingOwner: "amazon_v2", expectedStripeAccountId: config.stripeAccountId,
    expectedStripeLivemode: config.stripeMode === "live", amazonPaymentProfile: config.paymentProfile};
}

function registrationBody(request) {
  const pricing = request.pricing;
  if (!pricing || !Array.isArray(pricing.rate) || pricing.rate.length === 0 ||
      !/^pm_[A-Za-z0-9_]+$/.test(request.paymentMethodId || "") ||
      !/^pi_[A-Za-z0-9_]+$/.test(request.transactionid || "") ||
      !/^[A-Z]{2}[0-9]+$/.test(request.stationid || "") ||
      !/^\d+$/.test(String(request.moduleid || "")) ||
      !Number.isSafeInteger(Number(request.chargerid)) || Number(request.chargerid) <= 0 ||
      !Number.isSafeInteger(Number(request.slotid)) || Number(request.slotid) <= 0 ||
      !Number.isFinite(Number(request.timerequested)) || Number(request.timerequested) <= 0 ||
      !["LEASE", "PURCHASE"].includes(pricing.kioskmode) ||
      !["FULLPRICE", "INITIALPRICE"].includes(request.gatewayoptions) ||
      ["authamount", "dailyprice", "buyprice", "overdue"].some((name) =>
        !Number.isFinite(Number(pricing[name])) || Number(pricing[name]) < 0) ||
      pricing.rate.some(({time, price}) => !Number.isFinite(Number(time)) || Number(time) < 0 ||
        !Number.isFinite(Number(price)) || Number(price) < 0)) {
    throw new V2AmazonGatewayError("v2-original-payment-or-pricing-missing", "registration");
  }
  return {
    stationid: request.stationid, moduleid: request.moduleid, slot: request.slotid,
    chargerid: request.chargerid, transactionid: request.transactionid,
    rentaltime: Math.floor(Number(request.timerequested) / 1000),
    paymentmethod: request.paymentMethodId,
    authamount: Number(pricing.authamount), rentalprice: Number(pricing.dailyprice),
    buyprice: Number(pricing.buyprice), taxrate: Number(pricing.taxrate || 0),
    overdue: Number(pricing.overdue), currency: pricing.currency,
    kioskmode: pricing.kioskmode, gatewayoptions: request.gatewayoptions,
    rentalrate: pricing.rate.map(({time, price}) => ({time: Number(time), price: Number(price)})),
    powerlevel: request.powerlevel, formdata: {},
  };
}

function createV2AmazonGateway({fetchImpl = fetch, timeoutMs = 35_000} = {}) {
  async function call(path, method, body, phase, expectJson = true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`https://chargerent.online${path}`, {
        method, signal: controller.signal,
        ...(body ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {}),
      });
      if (!response.ok) throw new V2AmazonGatewayError("v2-http-request-failed", phase,
          {ownershipMayHaveTransferred: phase === "registration" || phase === "vend"});
      return expectJson ? await response.json() : null;
    } catch (error) {
      if (error instanceof V2AmazonGatewayError) throw error;
      throw new V2AmazonGatewayError("v2-http-result-unknown", phase,
          {ownershipMayHaveTransferred: phase === "registration" || phase === "vend"});
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async sendVend(request) {
      const registration = registrationBody(request);
      await call(`/stations/qr?id=${encodeURIComponent(request.stationid)}`, "GET", null,
          "initialization", false);
      const registered = await call("/stations/log-transaction", "POST", registration, "registration");
      if (registered?.success !== true) {
        throw new V2AmazonGatewayError("v2-transaction-registration-failed", "registration",
            {ownershipMayHaveTransferred: true});
      }
      const validLast4 = (value) => typeof value === "string" && /^\d{4}$/.test(value) ? value : "";
      // This is the sole physical vend request. An uncertain response is never retried.
      const result = await call("/stations/vend", "POST", {
        stationid: request.stationid, moduleid: request.moduleid,
        chargerid: request.chargerid, slot: request.slotid, powerlevel: request.powerlevel,
        transactionid: request.transactionid, memberid: 0,
        time: Number(request.timerequested), timereceived: Number(request.timerequested),
        card_last4: validLast4(request.card_last4) || validLast4(registered.last4),
      }, "vend");
      if (result?.status !== 1 || (result.stationid && result.stationid !== request.stationid)) {
        throw new V2AmazonGatewayError("v2-vend-response-unverified", "vend");
      }
      return {accepted: true};
    },
  };
}

module.exports = {CONFIG_PATH, REQUIRED_V2_STATIONS, V2AmazonGatewayError, createV2AmazonGateway,
  selectV2AmazonRoute, registrationBody};
