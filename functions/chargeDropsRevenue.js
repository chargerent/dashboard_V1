/* eslint-env node */

const HOUSE_REGIONAL_PARTNER_ID = "OCHARGELLC";
const COMPANY_MANAGED_PARTNER_TYPE = "company_managed";
const REVENUE_BASIS_VERSION = "gross_minus_refunds_and_taxes_v1";
const FULL_REFUND_STATUSES = new Set([
  "refunded",
  "refund-completed",
  "refund_completed",
]);

function normalizeClientId(value) {
  return String(value || "").trim().toUpperCase();
}

function isCompanyManagedChargeDrops(profile) {
  return String(profile?.regionalPartnerType || "").trim().toLowerCase() ===
      COMPANY_MANAGED_PARTNER_TYPE ||
    normalizeClientId(profile?.regionalPartnerId) === HOUSE_REGIONAL_PARTNER_ID;
}

function buildCompanyManagedRevenueAllocation(clientPercent) {
  const normalizedClientPercent = Number(clientPercent);
  if (!Number.isFinite(normalizedClientPercent) ||
      normalizedClientPercent < 0 || normalizedClientPercent > 100) {
    throw new RangeError("Client revenue share must be between 0 and 100 percent.");
  }
  return {
    clientPercent: normalizedClientPercent,
    partnerPercent: 0,
    companyPercent: Math.round((100 - normalizedClientPercent) * 100) / 100,
  };
}

function shouldCreatePartnerPayout(profile, repClientId) {
  return !(isCompanyManagedChargeDrops(profile) &&
    normalizeClientId(repClientId) === HOUSE_REGIONAL_PARTNER_ID);
}

function moneyToCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function storedCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function normalizeCurrency(value, fallback = "usd") {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    us: "usd",
    usd: "usd",
    ca: "cad",
    cad: "cad",
    eu: "eur",
    eur: "eur",
    124: "cad",
    840: "usd",
    978: "eur",
  };
  return aliases[normalized] || aliases[String(fallback || "").trim().toLowerCase()] || "";
}

function firstMoneyCents(record, keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null && record?.[key] !== "") {
      return moneyToCents(record[key]);
    }
  }
  return 0;
}

function rentalRevenueBasis(rental = {}, {fallbackCurrency = "usd"} = {}) {
  const totalCents = firstMoneyCents(rental, ["totalCharged", "total", "amountCharged"]);
  const paymentCents = storedCents(rental.paymentAmountCents);
  const subtotalCents = firstMoneyCents(rental, ["subtotal", "subTotal"]);
  const componentCents = firstMoneyCents(rental, ["initialCharge"]) +
    firstMoneyCents(rental, ["overageCharge"]);
  const taxCents = firstMoneyCents(rental, ["tax", "taxAmount", "salesTax"]);
  const refundValue = String(rental.refundAmount ?? "").trim().toLowerCase();
  const status = String(rental.refundStatus || rental.status || "").trim().toLowerCase();
  const fullRefund = refundValue === "full" || FULL_REFUND_STATUSES.has(status);
  const numericRefundCents = fullRefund ? 0 : moneyToCents(rental.refundAmount);
  const refundCompleted = fullRefund || rental.refundCompleted === true ||
    rental.refundProcessed === true || numericRefundCents > 0;
  const documentedGrossCents = Math.max(
      totalCents,
      paymentCents,
      subtotalCents + taxCents,
      componentCents + taxCents,
  );

  let grossCents = documentedGrossCents;
  let refundCents = 0;
  if (fullRefund) {
    refundCents = documentedGrossCents;
  } else if (refundCompleted && numericRefundCents > 0) {
    refundCents = numericRefundCents;
    // Newer records may replace totalCharged with the amount left after a
    // refund. paymentAmountCents, when present, remains the best gross source.
    if ((rental.refundCompleted === true || rental.refundProcessed === true) &&
        paymentCents === 0) {
      grossCents = Math.max(grossCents, totalCents + refundCents);
    }
  }

  refundCents = Math.min(refundCents, grossCents);
  const qualifyingCents = Math.max(0, grossCents - refundCents - taxCents);
  return {
    version: REVENUE_BASIS_VERSION,
    currency: normalizeCurrency(
        rental.currency || rental.currencyCode || rental.currencyCodeAlpha ||
          rental.currencyCodeNumeric,
        fallbackCurrency,
    ),
    grossCents,
    refundCents,
    taxCents: Math.min(taxCents, Math.max(0, grossCents - refundCents)),
    qualifyingCents,
  };
}

function centsToMoney(value) {
  return Math.round((Number(value) || 0)) / 100;
}

module.exports = {
  COMPANY_MANAGED_PARTNER_TYPE,
  HOUSE_REGIONAL_PARTNER_ID,
  buildCompanyManagedRevenueAllocation,
  centsToMoney,
  isCompanyManagedChargeDrops,
  normalizeCurrency,
  rentalRevenueBasis,
  REVENUE_BASIS_VERSION,
  shouldCreatePartnerPayout,
};
