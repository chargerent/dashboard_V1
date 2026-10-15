/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {PDFDocument} = require("pdf-lib");
const {
  COMPANY,
  TEMPLATE_VERSION,
  appendCanadianPartnerSignatureCertificate,
  generateCanadianRegionalPartnerAgreement,
} = require("./canadianRegionalPartnerAgreementTemplate");

test("generates the Canadian company partner agreement with fixed commercial terms", async () => {
  const result = await generateCanadianRegionalPartnerAgreement({
    partnerType: "company",
    legalName: "Maple Venue Partners Inc.",
    businessAddress: "101 Jasper Avenue, Edmonton, AB T5J 1N9, Canada",
    telephone: "+1 780-555-0100",
    email: "alex@example.ca",
    taxNumber: "123456789RT0001",
    effectiveDate: "2026-10-15",
    territory: "Edmonton, Alberta",
  });

  assert.equal(result.company.name, COMPANY);
  assert.equal(result.version, TEMPLATE_VERSION);
  assert.equal(result.version.includes("DRAFT"), false);
  assert.equal(result.details.partnerType, "company");
  assert.equal(result.details.territory, "Edmonton, Alberta");
  assert.equal(result.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  const pdf = await PDFDocument.load(result.buffer);
  assert.equal(pdf.getSubject(), "Canadian regional representative agreement");
  assert.ok(pdf.getPageCount() >= 4);
});

test("generates an agreement for an individual regional partner", async () => {
  const result = await generateCanadianRegionalPartnerAgreement({
    partnerType: "individual",
    legalName: "Alex Partner",
    businessAddress: "101 Jasper Avenue, Edmonton, AB T5J 1N9, Canada",
    telephone: "+1 780-555-0100",
    email: "alex@example.ca",
    effectiveDate: "2026-10-15",
    territory: "Edmonton, Alberta",
  });

  assert.equal(result.details.partnerType, "individual");
  assert.equal(result.details.legalName, "Alex Partner");
  assert.equal(result.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  const pdf = await PDFDocument.load(result.buffer);
  assert.ok(pdf.getPageCount() >= 4);
});

test("rejects an incomplete agreement snapshot", async () => {
  await assert.rejects(
      generateCanadianRegionalPartnerAgreement({legalName: "Incomplete"}),
      /missing required details/i,
  );
});

test("adds a Chargerent Canadian electronic-signature certificate", async () => {
  const source = await generateCanadianRegionalPartnerAgreement({
    partnerType: "company",
    legalName: "Maple Venue Partners Inc.",
    businessAddress: "101 Jasper Avenue, Edmonton, AB T5J 1N9, Canada",
    telephone: "+1 780-555-0100",
    email: "alex@example.ca",
    effectiveDate: "2026-10-15",
    territory: "Edmonton, Alberta",
  });
  const signed = await appendCanadianPartnerSignatureCertificate(source.buffer, {
    title: "Chargerent Inc Canadian Regional Representative Agreement",
    version: source.version,
    agreementId: "agreement-123",
    clientId: "AB-NORTH",
    venueName: "Edmonton, Alberta",
    partnerType: "company",
    signerName: "Alex Partner",
    signerTitle: "President",
    signerEmail: "alex@example.ca",
    signedAt: "2026-10-15T12:00:00.000Z",
    sourceHash: "a".repeat(64),
  });
  const sourcePdf = await PDFDocument.load(source.buffer);
  const signedPdf = await PDFDocument.load(signed);
  assert.equal(signedPdf.getPageCount(), sourcePdf.getPageCount() + 1);
});
