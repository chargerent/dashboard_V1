import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';

const clean = (value) => String(value ?? '').trim();
const upper = (value) => clean(value).toUpperCase();

export const APOLLO_TERMINAL_GATEWAY = 'APOLLO';
export const APOLLO_QR_VEND_GATEWAY = 'SCANNER';

export const environmentName = z.enum(['us-lab', 'us-prod']);

export const uiNotificationSchema = z.object({
  serialNumber: z.string().trim().min(1).max(120),
  screenId: z.string().trim().min(1).max(160),
  response: z.string().trim().max(1000),
}).passthrough();

export const terminalStateSchema = z.object({
  serialNumber: z.string().trim().min(1).max(120),
}).passthrough();

export const cardSchema = z.object({
  serialNumber: z.string().trim().min(1).max(120),
  ifd: z.string().trim().min(1).max(120),
  aid: z.string().trim().max(500).default(''),
  cardId: z.string().trim().min(1).max(4096),
}).passthrough();

export const sessionNotificationSchema = z.object({
  session: z.object({serialNumber: z.string().trim().min(1).max(120)}).passthrough().optional(),
  error: z.string().max(2000).optional(),
}).passthrough().refine((value) => Boolean(value.session?.serialNumber), 'Session serial number is required.');

export const kioskEventSchema = z.discriminatedUnion('type', [
  z.object({
    schemaVersion: z.literal(1), type: z.literal('availability_result'),
    sessionId: z.string().trim().min(1).max(160),
    commandId: z.string().trim().min(1).max(200),
    available: z.boolean(),
    module: z.union([z.string(), z.number()]).optional(),
    slot: z.union([z.string(), z.number()]).optional(),
    chargerId: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    schemaVersion: z.literal(1), type: z.literal('vend_result'),
    sessionId: z.string().trim().min(1).max(160),
    commandId: z.string().trim().min(1).max(200),
    success: z.boolean(),
    module: z.union([z.string(), z.number()]).optional(),
    slot: z.union([z.string(), z.number()]).optional(),
    chargerId: z.string().trim().max(200).optional(),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    schemaVersion: z.literal(1), type: z.literal('return_result'),
    stationId: z.string().trim().min(1).max(120),
    success: z.literal(true),
    module: z.union([z.string(), z.number()]),
    slot: z.union([z.string(), z.number()]),
    chargerId: z.string().trim().min(1).max(200),
    returnedAt: z.number().int().nonnegative().optional(),
  }),
  z.object({
    schemaVersion: z.literal(1), type: z.literal('heartbeat'),
    stationId: z.string().trim().min(1).max(120),
    timestamp: z.string().datetime().optional(),
  }),
]);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function createEventId(kind, payload) {
  return sha256(`${clean(kind)}\n${canonicalJson(payload)}`);
}

export function classifyCardMethod(card) {
  const candidates = [card?.ifd, card?.aid].map(upper);
  if (candidates.some((value) => value.includes('QR'))) return 'QR_CODE';
  if (candidates.some((value) => value.includes('PROPRIETARY'))) return 'PROPRIETARY';
  if (
    clean(card?.maskedPan)
    || (Array.isArray(card?.sessions) && card.sessions.length > 0)
    || candidates.some((value) => /CONTACT|EMV|MAGSTRIPE|MAGNETIC|CHIP|ICC/.test(value))
  ) return 'EMV';
  return 'UNKNOWN';
}

export function hashQrCredential(cardId, secret) {
  if (!clean(cardId) || !clean(secret)) throw new Error('QR credential and hashing key are required.');
  return createHmac('sha256', secret).update(clean(cardId)).digest('hex');
}

export function safeCardSummary(card) {
  return {
    serialNumber: upper(card?.serialNumber),
    ifd: upper(card?.ifd),
    aidClass: classifyCardMethod(card),
  };
}

export function verifySignedRequest({body, now = Date.now(), secret, signature, timestamp}) {
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) return false;
  const expected = createHmac('sha256', secret).update(`${timestampMs}.${canonicalJson(body)}`).digest('hex');
  const provided = clean(signature).replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}

export function normalizeSerial(value) {
  const serial = upper(value).replace(/[^A-Z0-9._-]/g, '');
  if (!serial) throw new Error('Terminal serial number is required.');
  return serial;
}
