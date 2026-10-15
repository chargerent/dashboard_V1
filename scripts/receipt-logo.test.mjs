import assert from 'node:assert/strict';
import test from 'node:test';
import { RECEIPT_LOGO_MAX_BYTES, receiptLogoFileError, receiptLogoPreviewUrl, receiptLogoUploadInput } from '../src/utils/receiptLogo.js';

test('validates accepted logo types and rejects oversized, empty, and active formats', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(receiptLogoFileError({ type, size: 100 }), '');
  for (const type of ['image/svg+xml', 'image/heic', 'text/html', '', 'application/octet-stream']) assert.match(receiptLogoFileError({ type, size: 100 }), /PNG/);
  assert.match(receiptLogoFileError({ type: 'image/png', size: 0 }), /empty/);
  assert.match(receiptLogoFileError({ type: 'image/png', size: RECEIPT_LOGO_MAX_BYTES + 1 }), /2 MB/);
});

test('existing logo previews allow only plain HTTPS URLs', () => {
  assert.equal(receiptLogoPreviewUrl({ url: 'https://example.com/logo.png' }), 'https://example.com/logo.png');
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://example.com/logo', 'https://user:pass@example.com/logo', '/local-logo.png', '']) assert.equal(receiptLogoPreviewUrl({ url }), '');
});

test('reads logo bytes only when building the Save request, preserving exact bytes and target profile', async () => {
  const bytes = new Uint8Array([0, 255, 128, 65, 10, 20]);
  let reads = 0;
  const file = { type: 'image/png', size: bytes.length, name: 'Venue logo.png', arrayBuffer: async () => { reads += 1; return bytes.buffer; } };
  assert.equal(receiptLogoFileError(file), '');
  assert.equal(reads, 0);
  const input = await receiptLogoUploadInput(file, 'profile-1');
  assert.deepEqual(input, { uid: 'profile-1', name: 'Venue logo.png', contentType: 'image/png', dataBase64: Buffer.from(bytes).toString('base64') });
  assert.equal(reads, 1);
  const createInput = await receiptLogoUploadInput(file);
  assert.equal(Object.hasOwn(createInput, 'uid'), false);
});

test('does not upload files that fail validation or read inconsistently', async () => {
  await assert.rejects(receiptLogoUploadInput({ type: 'image/svg+xml', size: 100 }), /PNG/);
  await assert.rejects(receiptLogoUploadInput({ type: 'image/png', size: 3, arrayBuffer: async () => new ArrayBuffer(2) }), /could not be read/);
});
