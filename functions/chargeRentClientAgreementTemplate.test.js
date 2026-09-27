/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {PDFDocument} = require("pdf-lib");
const {
  STANDARD_PRICING,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  generateChargeRentClientAgreement,
} = require("./chargeRentClientAgreementTemplate");

const DETAILS = {
  legalBusinessName: "Hudson Hospitality LLC",
  venueName: "The Hudson Eatery & Bar",
  address: "1601 E Apache Blvd, Tempe, AZ 85281",
  contactName: "Alex Venue",
  contactEmail: "alex@example.com",
  contactPhone: "480-555-0123",
  effectiveDate: "2026-10-15",
  assetsDeployed: "One ChargeDrops kiosk with 12 powerbanks",
  revenueShare: 20,
  paymentSchedule: "monthly",
};

test("generates the versioned ChargeRent revenue-share agreement", async () => {
  const result = await generateChargeRentClientAgreement(DETAILS);
  const pdf = await PDFDocument.load(result.buffer);

  assert.equal(result.templateId, TEMPLATE_ID);
  assert.equal(result.version, TEMPLATE_VERSION);
  assert.deepEqual(result.pricing, STANDARD_PRICING);
  assert.equal(result.details.legalBusinessName, DETAILS.legalBusinessName);
  assert.ok(result.buffer.subarray(0, 5).toString("ascii") === "%PDF-");
  assert.ok(result.buffer.length > 10000);
  assert.ok(pdf.getPageCount() >= 4);
});

test("requires business, location, deployment, and start-date details", async () => {
  await assert.rejects(
      generateChargeRentClientAgreement({...DETAILS, assetsDeployed: ""}),
      /missing required/i,
  );
  await assert.rejects(
      generateChargeRentClientAgreement({...DETAILS, effectiveDate: "October"}),
      /YYYY-MM-DD/,
  );
});

test("rejects invalid revenue-share percentages", async () => {
  await assert.rejects(
      generateChargeRentClientAgreement({...DETAILS, revenueShare: 101}),
      /between 0 and 100/,
  );
});
