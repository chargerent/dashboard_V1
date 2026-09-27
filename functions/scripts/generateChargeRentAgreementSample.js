/* eslint-env node */

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  generateChargeRentClientAgreement,
} = require("../chargeRentClientAgreementTemplate");
const {appendSignatureCertificate} = require("../chargeDropsAgreements");

async function main() {
  const outputPath = path.resolve(
      __dirname,
      "../../output/pdf/ChargeRent_ChargeDrops_Agreement_Sample.pdf",
  );
  const agreement = await generateChargeRentClientAgreement({
    legalBusinessName: "Hudson Hospitality LLC",
    venueName: "The Hudson Eatery & Bar",
    address: "1601 E Apache Blvd, Tempe, AZ 85281",
    contactName: "Alex Venue",
    contactEmail: "alex@example.com",
    contactPhone: "480-555-0123",
    effectiveDate: "2026-10-15",
    assetsDeployed: "One ChargeDrops kiosk with 12 powerbanks",
    revenueShare: 20,
    paymentSchedule: "Monthly",
  });
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, agreement.buffer);
  const signedQaPath = path.resolve(
      __dirname,
      "../../tmp/pdfs/ChargeRent_ChargeDrops_Agreement_Signed_QA.pdf",
  );
  const signedQa = await appendSignatureCertificate(agreement.buffer, {
    title: "ChargeRent Revenue Share Agreement",
    version: agreement.version,
    agreementId: "sample-agreement-id",
    clientId: "HUDSON",
    venueName: "The Hudson Eatery & Bar",
    signerName: "Alex Venue",
    signerTitle: "Owner",
    signerEmail: "alex@example.com",
    signedAt: "2026-09-25T10:00:00.000Z",
    sourceHash: "d1f1d8dc96fbf3fd4ef57d177cdb0e35aa917bdedbc17f6a33b6c76f3e3aa2cf",
  });
  await fs.mkdir(path.dirname(signedQaPath), {recursive: true});
  await fs.writeFile(signedQaPath, signedQa);
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
