import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SCREENSHOT_BYTES,
  normalizeKioskScreenshotDataUrl,
} from '../src/utils/kioskScreenshot.js';

test('keeps supported image data URLs', () => {
  const value = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(normalizeKioskScreenshotDataUrl(value), value);
});

test('converts Node-RED Buffer JSON into a PNG data URL', () => {
  assert.equal(
    normalizeKioskScreenshotDataUrl({ type: 'Buffer', data: [137, 80, 78, 71] }),
    'data:image/png;base64,iVBORw==',
  );
});

test('rejects unsafe and oversized payloads', () => {
  assert.equal(normalizeKioskScreenshotDataUrl('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(normalizeKioskScreenshotDataUrl(new Uint8Array(MAX_SCREENSHOT_BYTES + 1)), '');
});
