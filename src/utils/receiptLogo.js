export const RECEIPT_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const RECEIPT_LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';
const SUPPORTED_TYPES = new Set(RECEIPT_LOGO_ACCEPT.split(','));

export function receiptLogoFileError(file) {
  if (!file) return 'Choose a logo image.';
  if (!SUPPORTED_TYPES.has(String(file.type || '').toLowerCase())) return 'Use a PNG, JPEG, or WebP image.';
  if (!Number.isInteger(file.size) || file.size <= 0) return 'The selected image is empty.';
  if (file.size > RECEIPT_LOGO_MAX_BYTES) return 'The logo must be 2 MB or smaller.';
  return '';
}

export function receiptLogoPreviewUrl(value) {
  try {
    const parsed = new URL(String(value?.url || ''));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '';
  } catch {
    return '';
  }
}

export function receiptLogoBytesToBase64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(chunks.join(''));
}

export async function receiptLogoUploadInput(file, uid = '') {
  const error = receiptLogoFileError(file);
  if (error) throw new Error(error);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error('The image could not be read. Choose it again.');
  return {
    ...(uid ? { uid } : {}),
    name: String(file.name || 'receipt-logo').slice(0, 160),
    contentType: file.type.toLowerCase(),
    dataBase64: receiptLogoBytesToBase64(bytes),
  };
}
