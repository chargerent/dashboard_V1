/* eslint-env node */
const crypto = require("node:crypto");

const PUBLIC_ASSET_TYPES = new Set(["document", "guide", "map", "menu"]);
const PUBLIC_ASSET_LANGUAGES = new Set(["en", "fr"]);

function cleanText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function slugifyPublicAsset(value, fallback = "document") {
  const slug = cleanText(value, 240)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  return slug || fallback;
}

function normalizePublicAssetType(value, fallback = "document") {
  const normalized = cleanText(value, 40).toLowerCase();
  return PUBLIC_ASSET_TYPES.has(normalized) ? normalized : fallback;
}

function normalizePublicAssetLanguage(value, fallback = "en") {
  const normalized = cleanText(value, 12).toLowerCase().split(/[-_]/)[0];
  return PUBLIC_ASSET_LANGUAGES.has(normalized) ? normalized : fallback;
}

function getPublicAssetFolder(assetType) {
  return {
    document: "documents",
    guide: "guides",
    map: "maps",
    menu: "menus",
  }[normalizePublicAssetType(assetType)] || "documents";
}

function inferPublicAssetDetails(fileName = "") {
  const baseName = cleanText(fileName, 240)
      .replace(/\.pdf$/i, "")
      .replace(/[-_](?:demo[-_ ]?)?menu(?:[-_ ]?(?:en|fr))?$/i, "")
      .replace(/[-_]fr$/i, "")
      .trim();
  const language = /(?:^|[-_ ])fr(?:\.pdf)?$/i.test(fileName) ? "fr" : "en";
  const assetType = /menu/i.test(fileName) ? "menu" : "document";
  const slug = slugifyPublicAsset(baseName || fileName, "document");
  const label = (baseName || fileName || "Event document")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

  return {assetType, label, language, slug};
}

function buildPublicAssetId({targetType, targetId, assetType, language, slug}) {
  const normalizedTargetType = cleanText(targetType, 20).toLowerCase() === "install" ?
    "install" :
    "event";
  const normalizedType = normalizePublicAssetType(assetType);
  const normalizedLanguage = normalizePublicAssetLanguage(language);
  const normalizedSlug = slugifyPublicAsset(slug, normalizedType);
  const fingerprint = crypto.createHash("sha256")
      .update([
        normalizedTargetType,
        cleanText(targetId, 160),
        normalizedType,
        normalizedLanguage,
        normalizedSlug,
      ].join(":"))
      .digest("hex")
      .slice(0, 8);

  return `${normalizedSlug.slice(0, 36)}-${normalizedLanguage}-${fingerprint}`;
}

function buildPublicAssetStoragePath({targetType, targetId, assetType, language, slug}) {
  const normalizedTargetType = cleanText(targetType, 20).toLowerCase() === "install" ?
    "install" :
    "event";
  const normalizedTargetId = slugifyPublicAsset(targetId, "target");
  const normalizedType = normalizePublicAssetType(assetType);
  const normalizedLanguage = normalizePublicAssetLanguage(language);
  const normalizedSlug = slugifyPublicAsset(slug, normalizedType);
  return [
    "ai-booth-public-assets",
    normalizedTargetType,
    normalizedTargetId,
    getPublicAssetFolder(normalizedType),
    normalizedLanguage,
    `${normalizedSlug}.pdf`,
  ].join("/");
}

function normalizePublicAsset(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const inferred = inferPublicAssetDetails(source.fileName || source.label);
  const assetType = normalizePublicAssetType(source.assetType || source.type, inferred.assetType);
  const language = normalizePublicAssetLanguage(source.language, inferred.language);
  const slug = slugifyPublicAsset(source.slug || inferred.slug, assetType);
  const id = cleanText(source.id || source.assetId, 160);

  return {
    id,
    assetType,
    label: cleanText(source.label || inferred.label, 240),
    language,
    slug,
    fileName: cleanText(source.fileName, 240),
    contentType: cleanText(source.contentType || "application/pdf", 80),
    size: Number.isFinite(Number(source.size)) ? Number(source.size) : 0,
    storagePath: cleanText(source.storagePath, 1000),
    bucketName: cleanText(source.bucketName, 240),
    publicUrl: cleanText(source.publicUrl || source.url, 1200),
    downloadUrl: cleanText(source.downloadUrl, 2000),
    sourceSubmissionId: cleanText(source.sourceSubmissionId, 160),
    sourceFileId: cleanText(source.sourceFileId, 160),
    active: source.active !== false,
    publishedAt: cleanText(source.publishedAt || source.publishedAtIso, 120),
    publishedBy: source.publishedBy && typeof source.publishedBy === "object" ?
      source.publishedBy :
      null,
  };
}

module.exports = {
  buildPublicAssetId,
  buildPublicAssetStoragePath,
  inferPublicAssetDetails,
  normalizePublicAsset,
  normalizePublicAssetLanguage,
  normalizePublicAssetType,
  slugifyPublicAsset,
};
