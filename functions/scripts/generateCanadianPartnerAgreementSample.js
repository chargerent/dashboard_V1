/* eslint-env node */

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  appendCanadianPartnerSignatureCertificate,
  generateCanadianRegionalPartnerAgreement,
} = require("../canadianRegionalPartnerAgreementTemplate");

async function main() {
  const individual = process.argv.includes("--individual");
  const signed = process.argv.includes("--signed");
  const result = await generateCanadianRegionalPartnerAgreement({
    partnerType: individual ? "individual" : "company",
    legalName: individual ? "Alex Partner" : "Maple Venue Partners Inc.",
    businessAddress: "101 Jasper Avenue, Edmonton, AB T5J 1N9, Canada",
    telephone: "+1 780-555-0100",
    email: "alex@example.ca",
    taxNumber: individual ? "" : "123456789RT0001",
    effectiveDate: "2026-10-15",
    territory: "Edmonton, Alberta",
  });
  const buffer = signed ? await appendCanadianPartnerSignatureCertificate(
      result.buffer,
      {
        title: "Chargerent Inc Canadian Regional Representative Agreement",
        version: result.version,
        agreementId: "qa-agreement-123",
        clientId: individual ? "AB-INDIVIDUAL" : "AB-NORTH",
        venueName: "Edmonton, Alberta",
        partnerType: individual ? "individual" : "company",
        signerName: "Alex Partner",
        signerTitle: individual ? "Individual" : "President",
        signerEmail: "alex@example.ca",
        signedAt: "2026-10-15T12:00:00.000Z",
        sourceHash: "a".repeat(64),
      },
  ) : result.buffer;
  const output = path.resolve(__dirname, signed ?
    "../../tmp/pdfs/Canadian_Regional_Partner_Agreement_Signed_QA.pdf" : individual ?
    "../../tmp/pdfs/Canadian_Individual_Regional_Partner_Agreement_QA.pdf" :
    "../../output/pdf/Chargerent_Canadian_Regional_Partner_Agreement_Sample.pdf");
  await fs.mkdir(path.dirname(output), {recursive: true});
  await fs.writeFile(output, buffer);
  process.stdout.write(`${output}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
