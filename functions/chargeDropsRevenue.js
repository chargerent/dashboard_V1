/* eslint-env node */

const HOUSE_REGIONAL_PARTNER_ID = "OCHARGELLC";
const COMPANY_MANAGED_PARTNER_TYPE = "company_managed";

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

module.exports = {
  COMPANY_MANAGED_PARTNER_TYPE,
  HOUSE_REGIONAL_PARTNER_ID,
  buildCompanyManagedRevenueAllocation,
  isCompanyManagedChargeDrops,
  shouldCreatePartnerPayout,
};
