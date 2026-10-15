/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isReadyForActivation,
  normalizeCreateInput,
  normalizeProfileInput,
  tokenHash,
} = require("./regionalPartnerOnboarding");

test("requires only a signed agreement for dashboard activation", () => {
  assert.equal(isReadyForActivation({agreementStatus: "signed"}), true);
  assert.equal(isReadyForActivation({
    agreementStatus: "signed",
    payoutStatus: "not_started",
  }), true);
  assert.equal(isReadyForActivation({agreementStatus: "awaiting_signature"}), false);
});

test("normalizes a Canadian partner invitation", () => {
  assert.deepEqual(normalizeCreateInput({
    contactName: " Alex Partner ",
    contactEmail: "ALEX@EXAMPLE.CA",
    username: " Alberta.Partner ",
    clientId: " ab-north ",
    province: "ab",
    territory: "Edmonton and Northern Alberta",
  }), {
    partnerType: "company",
    contactName: "Alex Partner",
    contactEmail: "alex@example.ca",
    username: "alberta.partner",
    clientId: "AB-NORTH",
    countryCode: "CA",
    province: "AB",
    territory: "Edmonton and Northern Alberta",
    language: "en",
  });
});

test("blocks Quebec until the French agreement is approved", () => {
  assert.throws(() => normalizeCreateInput({
    contactName: "Alex",
    contactEmail: "alex@example.ca",
    username: "alex",
    clientId: "QC01",
    province: "QC",
    territory: "Montreal",
  }), (error) => error.code === "failed-precondition" && /French/i.test(error.message));
});

test("accepts only complete legal profiles", () => {
  assert.equal(normalizeProfileInput({
    legalName: "Maple Partners Inc.",
    businessAddress: "101 Jasper Avenue",
    city: "Edmonton",
    postalCode: "T5J 1N9",
    telephone: "+1 780-555-0100",
    signerName: "Alex Partner",
    signerTitle: "President",
  }, {province: "AB"}).countryCode, "CA");
  assert.throws(() => normalizeProfileInput({}, {province: "AB"}), /Complete the legal company/i);
});

test("normalizes an individual partner without company signer fields", () => {
  const invite = normalizeCreateInput({
    partnerType: "individual",
    contactName: "Alex Partner",
    contactEmail: "alex@example.ca",
    username: "alex.partner",
    clientId: "AB-INDIVIDUAL",
    province: "AB",
    territory: "Edmonton and Northern Alberta",
  });
  const profile = normalizeProfileInput({
    legalName: "Alex Partner",
    businessAddress: "101 Jasper Avenue",
    city: "Edmonton",
    postalCode: "T5J 1N9",
    telephone: "+1 780-555-0100",
  }, invite);

  assert.equal(invite.partnerType, "individual");
  assert.equal(profile.partnerType, "individual");
  assert.equal(profile.signerName, "Alex Partner");
  assert.equal(profile.signerTitle, "Individual");
});

test("never uses the raw invite token as the Firestore identifier", () => {
  const raw = "a".repeat(64);
  assert.notEqual(tokenHash(raw), raw);
  assert.equal(tokenHash(raw).length, 64);
});
