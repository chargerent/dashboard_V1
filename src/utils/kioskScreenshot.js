const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const SUPPORTED_IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=]+)$/i;
const BASE64_VALUE = /^[a-z0-9+/=]+$/i;

function estimatedBase64Bytes(value) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return globalThis.btoa(binary);
}

export function normalizeKioskScreenshotDataUrl(value) {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, '');
    const dataUrlMatch = normalized.match(SUPPORTED_IMAGE_DATA_URL);

    if (dataUrlMatch) {
      return estimatedBase64Bytes(dataUrlMatch[2]) <= MAX_SCREENSHOT_BYTES ? normalized : '';
    }

    if (
      normalized.length > 0 &&
      normalized.length % 4 === 0 &&
      BASE64_VALUE.test(normalized) &&
      estimatedBase64Bytes(normalized) <= MAX_SCREENSHOT_BYTES
    ) {
      return `data:image/png;base64,${normalized}`;
    }

    return '';
  }

  if (value instanceof Uint8Array) {
    if (value.byteLength === 0 || value.byteLength > MAX_SCREENSHOT_BYTES) return '';
    return `data:image/png;base64,${bytesToBase64(value)}`;
  }

  if (Array.isArray(value)) {
    if (
      value.length === 0 ||
      value.length > MAX_SCREENSHOT_BYTES ||
      value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    ) {
      return '';
    }
    return normalizeKioskScreenshotDataUrl(Uint8Array.from(value));
  }

  if (value && typeof value === 'object') {
    if (value.type === 'Buffer' && Array.isArray(value.data)) {
      return normalizeKioskScreenshotDataUrl(value.data);
    }
    if (typeof value.data === 'string' || Array.isArray(value.data)) {
      return normalizeKioskScreenshotDataUrl(value.data);
    }
  }

  return '';
}

export { MAX_SCREENSHOT_BYTES };
