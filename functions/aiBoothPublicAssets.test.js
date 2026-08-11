/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPublicAssetId,
  buildPublicAssetStoragePath,
  inferPublicAssetDetails,
  normalizePublicAsset,
} = require("./aiBoothPublicAssets");

test("infers English and French menu details from the generated filenames", () => {
  assert.deepEqual(
      inferPublicAssetDetails("ace-pizza-demo-menu.pdf"),
      {assetType: "menu", label: "Ace Pizza", language: "en", slug: "ace-pizza"},
  );
  assert.deepEqual(
      inferPublicAssetDetails("la-terrasse-francaise-demo-menu-fr.pdf"),
      {
        assetType: "menu",
        label: "La Terrasse Francaise",
        language: "fr",
        slug: "la-terrasse-francaise",
      },
  );
});

test("builds deterministic public ids and event-scoped storage paths", () => {
  const input = {
    targetType: "event",
    targetId: "roland-garros-2026-demo",
    assetType: "menu",
    language: "fr",
    slug: "ace-pizza",
  };
  assert.equal(buildPublicAssetId(input), buildPublicAssetId(input));
  assert.match(buildPublicAssetId(input), /^ace-pizza-fr-[a-f0-9]{8}$/);
  assert.equal(
      buildPublicAssetStoragePath(input),
      "ai-booth-public-assets/event/roland-garros-2026-demo/menus/fr/ace-pizza.pdf",
  );
});

test("normalizes the public record without exposing unknown fields", () => {
  assert.deepEqual(normalizePublicAsset({
    id: "asset-1",
    type: "menu",
    label: "Court Side Coffee",
    language: "fr-CA",
    slug: "Court Side Coffee",
    url: "https://obailix.com/a/asset-1",
    secret: "discard-me",
  }), {
    id: "asset-1",
    assetType: "menu",
    label: "Court Side Coffee",
    language: "fr",
    slug: "court-side-coffee",
    fileName: "",
    contentType: "application/pdf",
    size: 0,
    storagePath: "",
    bucketName: "",
    publicUrl: "https://obailix.com/a/asset-1",
    downloadUrl: "",
    sourceSubmissionId: "",
    sourceFileId: "",
    active: true,
    publishedAt: "",
    publishedBy: null,
  });
});
