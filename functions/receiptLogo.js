"use strict";

const {randomUUID} = require("node:crypto");
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"};

class ReceiptLogoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function invalid(message) {
  throw new ReceiptLogoError("invalid-argument", message);
}

function imageDimensions(buffer, contentType) {
  if (contentType === "image/png") {
    if (buffer.length < 45 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString() !== "IHDR" ||
        buffer.subarray(-8, -4).toString() !== "IEND") return null;
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  }
  if (contentType === "image/jpeg") {
    if (buffer.length < 12 || buffer.readUInt16BE(0) !== 0xffd8 ||
        buffer.readUInt16BE(buffer.length - 2) !== 0xffd9) return null;
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) return null;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return length >= 8 ? [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)] : null;
      }
      offset += length;
    }
    return null;
  }
  if (contentType === "image/webp") {
    if (buffer.length < 30 || buffer.subarray(0, 4).toString() !== "RIFF" ||
        buffer.subarray(8, 12).toString() !== "WEBP" || buffer.readUInt32LE(4) + 8 !== buffer.length) return null;
    const chunk = buffer.subarray(12, 16).toString();
    if (chunk === "VP8X" && buffer.length >= 30 && buffer.readUInt32LE(16) === 10) {
      return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
    }
    if (chunk === "VP8L" && buffer[20] === 0x2f && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
    }
    if (chunk === "VP8 " && buffer.subarray(23, 26).toString("hex") === "9d012a") {
      return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
    }
  }
  return null;
}

function validateReceiptLogoUpload(input = {}) {
  const contentType = String(input.contentType || "").trim().toLowerCase();
  if (!TYPES[contentType]) invalid("Use a PNG, JPEG, or WebP image.");
  const encoded = String(input.dataBase64 || "");
  if (!encoded || encoded.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) invalid("The logo must be a valid image of 2 MB or smaller.");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0 || buffer.length > MAX_LOGO_BYTES || buffer.toString("base64") !== encoded) invalid("The logo must be a valid image of 2 MB or smaller.");
  const dimensions = imageDimensions(buffer, contentType);
  if (!dimensions) invalid("The image does not match its PNG, JPEG, or WebP format.");
  if (dimensions.some((value) => value < 1 || value > 4096)) invalid("The logo must be 4096 pixels or smaller on each side.");
  const name = String(input.name || "receipt-logo").split("")
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("").trim().slice(0, 160) || "receipt-logo";
  const uid = String(input.uid || "").trim();
  if (uid && !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) invalid("Invalid client profile.");
  return {buffer, contentType, name, uid, extension: TYPES[contentType]};
}

async function uploadReceiptLogo({input, authState, bucket, db, now = () => new Date(), makeId = randomUUID}) {
  if (!authState?.uid || authState.isAdmin !== true) {
    throw new ReceiptLogoError("permission-denied", "Client profile editing requires an administrator.");
  }
  const upload = validateReceiptLogoUpload(input);
  if (upload.uid) {
    const target = await db.collection("users").doc(upload.uid).get();
    if (!target.exists) throw new ReceiptLogoError("not-found", "The client profile no longer exists.");
  }
  const owner = upload.uid || `draft-${String(authState.uid).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128)}`;
  const path = `client-receipt-logos/${owner}/${makeId()}.${upload.extension}`;
  const token = makeId();
  await bucket.file(path).save(upload.buffer, {
    resumable: false,
    metadata: {
      contentType: upload.contentType,
      cacheControl: "public,max-age=31536000,immutable",
      metadata: {firebaseStorageDownloadTokens: token},
    },
  });
  return {
    url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`,
    path,
    contentType: upload.contentType,
    name: upload.name,
    updatedAt: now().toISOString(),
  };
}

module.exports = {MAX_LOGO_BYTES, ReceiptLogoError, validateReceiptLogoUpload, uploadReceiptLogo};
