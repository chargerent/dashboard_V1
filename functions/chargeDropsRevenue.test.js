/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCompanyManagedRevenueAllocation,
  rentalRevenueBasis,
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

test("uses gross revenue minus refunds and tax for ChargeDrops payouts", () => {
  assert.deepEqual(rentalRevenueBasis({
    totalCharged: 12.50,
    tax: 0.75,
    currency: "US",
  }), {
    version: "gross_minus_refunds_and_taxes_v1",
    currency: "usd",
    grossCents: 1250,
    refundCents: 0,
    taxCents: 75,
    qualifyingCents: 1175,
  });
});

test("does not double count legacy refunds whose total remains gross", () => {
  assert.deepEqual(rentalRevenueBasis({
    totalCharged: 35,
    refundAmount: "10.00",
    tax: 2,
  }), {
    version: "gross_minus_refunds_and_taxes_v1",
    currency: "usd",
    grossCents: 3500,
    refundCents: 1000,
    taxCents: 200,
    qualifyingCents: 2300,
  });
});

test("reconstructs modern post-refund totals and handles full refunds", () => {
  assert.equal(rentalRevenueBasis({
    totalCharged: 25,
    refundAmount: 10,
    refundCompleted: true,
    tax: 2,
  }).grossCents, 3500);
  assert.equal(rentalRevenueBasis({
    totalCharged: 0,
    paymentAmountCents: 3500,
    refundAmount: "full",
    tax: 2,
  }).qualifyingCents, 0);
});
