/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCompanyManagedRevenueAllocation,
  isCompanyManagedChargeDrops,
  shouldCreatePartnerPayout,
} = require("./chargeDropsRevenue");

test("recognizes the Ocharge LLC company-managed option", () => {
  assert.equal(isCompanyManagedChargeDrops({regionalPartnerId: "OCHARGELLC"}), true);
  assert.equal(isCompanyManagedChargeDrops({regionalPartnerType: "company_managed"}), true);
  assert.equal(isCompanyManagedChargeDrops({regionalPartnerId: "PHOENIX"}), false);
});

test("allocates no partner share for a company-managed location", () => {
  assert.deepEqual(buildCompanyManagedRevenueAllocation(20), {
    clientPercent: 20,
    partnerPercent: 0,
    companyPercent: 80,
  });
  assert.deepEqual(buildCompanyManagedRevenueAllocation(12.5), {
    clientPercent: 12.5,
    partnerPercent: 0,
    companyPercent: 87.5,
  });
  assert.throws(() => buildCompanyManagedRevenueAllocation(101), RangeError);
});

test("excludes Ocharge LLC from regional-partner payout lines", () => {
  const companyManaged = {
    regionalPartnerId: "OCHARGELLC",
    regionalPartnerType: "company_managed",
  };
  assert.equal(shouldCreatePartnerPayout(companyManaged, "OCHARGELLC"), false);
  assert.equal(shouldCreatePartnerPayout({regionalPartnerId: "PHOENIX"}, "PHOENIX"), true);
});
