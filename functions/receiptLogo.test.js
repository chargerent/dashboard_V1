"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {MAX_LOGO_BYTES, validateReceiptLogoUpload, uploadReceiptLogo} = require("./receiptLogo");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const input = {name: "venue.png", contentType: "image/png", dataBase64: PNG.toString("base64")};

function fakeDependencies() {
  const writes = [];
  return {
    writes,
    bucket: {name: "test-bucket", file: (path) => ({save: async (buffer, options) => writes.push({path, buffer, options})})},
    db: {collection: (name) => ({doc: (uid) => ({get: async () => ({exists: name === "users" && uid === "target-user"})})})},
    authState: {uid: "admin-user", isAdmin: true},
    now: () => new Date("2026-10-08T12:00:00Z"),
    makeId: () => "fixed-id",
  };
}

test("valid PNG validation preserves exact bytes and normalized metadata", () => {
  const result = validateReceiptLogoUpload({...input, name: "\u0000 Venue logo.png\n", uid: "target-user"});
  assert.deepEqual(result.buffer, PNG);
  assert.equal(result.name, "Venue logo.png");
  assert.equal(result.extension, "png");
});

test("rejects MIME mismatch, malformed base64, oversize, SVG, and invalid dimensions", () => {
  const huge = {...input, dataBase64: Buffer.alloc(MAX_LOGO_BYTES + 1).toString("base64")};
  const wide = Buffer.from(PNG);
  wide.writeUInt32BE(4097, 16);
  for (const candidate of [huge, {...input, contentType: "image/jpeg"}, {...input, contentType: "image/svg+xml"}, {...input, dataBase64: "!!!="}, {...input, dataBase64: input.dataBase64 + "\n"}, {...input, uid: "../bad"}, {...input, dataBase64: wide.toString("base64")}]) {
    assert.throws(() => validateReceiptLogoUpload(candidate), (error) => error.code === "invalid-argument");
  }
});

test("JPEG and WebP header dimensions are validated without accepting their MIME label alone", () => {
  const jpeg = Buffer.from("ffd8ffc00008080001000201ffd9", "hex");
  assert.equal(validateReceiptLogoUpload({...input, contentType: "image/jpeg", dataBase64: jpeg.toString("base64")}).extension, "jpg");
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0); webp.writeUInt32LE(22, 4); webp.write("WEBPVP8X", 8); webp.writeUInt32LE(10, 16);
  assert.equal(validateReceiptLogoUpload({...input, contentType: "image/webp", dataBase64: webp.toString("base64")}).extension, "webp");
  webp.writeUInt32LE(999, 4);
  assert.throws(() => validateReceiptLogoUpload({...input, contentType: "image/webp", dataBase64: webp.toString("base64")}), /format/);
});

test("unauthorized caller and nonexistent profile cannot write Storage", async () => {
  for (const authState of [null, {uid: "client", isAdmin: false}]) {
    const deps = fakeDependencies();
    await assert.rejects(uploadReceiptLogo({...deps, input, authState}), (error) => error.code === "permission-denied");
    assert.equal(deps.writes.length, 0);
  }
  const deps = fakeDependencies();
  await assert.rejects(uploadReceiptLogo({...deps, input: {...input, uid: "missing-user"}}), (error) => error.code === "not-found");
  assert.equal(deps.writes.length, 0);
});

test("saved profile upload returns public logo-only URL and immutable image metadata", async () => {
  const deps = fakeDependencies();
  const result = await uploadReceiptLogo({...deps, input: {...input, uid: "target-user"}});
  assert.equal(deps.writes.length, 1);
  assert.equal(result.path, "client-receipt-logos/target-user/fixed-id.png");
  assert.equal(result.contentType, "image/png");
  assert.equal(result.updatedAt, "2026-10-08T12:00:00.000Z");
  assert.match(result.url, /^https:\/\/firebasestorage.googleapis.com\//);
  assert.equal(new URL(result.url).searchParams.get("token"), "fixed-id");
  assert.deepEqual(deps.writes[0].buffer, PNG);
  assert.equal(deps.writes[0].options.metadata.contentType, "image/png");
});

test("new client upload is isolated in the authorized administrator draft folder", async () => {
  const deps = fakeDependencies();
  const result = await uploadReceiptLogo({...deps, input});
  assert.equal(result.path, "client-receipt-logos/draft-admin-user/fixed-id.png");
});
