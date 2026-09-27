/* eslint-env node */
const fs = require("node:fs/promises");
const path = require("node:path");
const {createHash} = require("node:crypto");

const PARTNER_KIT_FILENAME = "Chargerent_Regional_Partner_Launch_Kit.pdf";
const PARTNER_KIT_PATH = path.join(__dirname, "assets", PARTNER_KIT_FILENAME);
const MAX_PARTNER_KIT_BYTES = 10 * 1024 * 1024;

function unavailable() {
  const error = new Error("The partner launch kit PDF is unavailable or invalid. Restore the bundled PDF before sending it.");
  error.code = "failed-precondition";
  return error;
}

function validatePartnerKitBuffer(content) {
  if (!Buffer.isBuffer(content) || content.length < 32 || content.length > MAX_PARTNER_KIT_BYTES ||
      !/^%PDF-\d\.\d/.test(content.subarray(0, 8).toString("ascii")) ||
      !content.subarray(-4096).toString("ascii").trimEnd().endsWith("%%EOF")) {
    throw unavailable();
  }
  return {
    filename: PARTNER_KIT_FILENAME,
    sizeBytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function createPartnerKitLoader({openFile = fs.open} = {}) {
  return async function preparePartnerKit({includePartnerKit, role} = {}) {
    if (includePartnerKit !== true) return null;
    if (role !== "partner") {
      const error = new Error("The partner launch kit can only be sent to partner accounts.");
      error.code = "permission-denied";
      throw error;
    }
    let file;
    try {
      // The path is fixed here. Callers cannot select another file or a URL.
      file = await openFile(PARTNER_KIT_PATH, "r");
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 32 || stat.size > MAX_PARTNER_KIT_BYTES) throw unavailable();
      const content = await file.readFile();
      const metadata = validatePartnerKitBuffer(content);
      return {attachment: {filename: PARTNER_KIT_FILENAME, content, contentType: "application/pdf"}, metadata};
    } catch {
      // File paths, OS errors and document contents never enter a callable response.
      throw unavailable();
    } finally {
      if (file) await file.close().catch(() => {});
    }
  };
}

const preparePartnerKit = createPartnerKitLoader();

module.exports = {
  PARTNER_KIT_FILENAME,
  PARTNER_KIT_PATH,
  MAX_PARTNER_KIT_BYTES,
  createPartnerKitLoader,
  preparePartnerKit,
  validatePartnerKitBuffer,
};
