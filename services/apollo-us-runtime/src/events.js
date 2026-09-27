import {createEventId, kioskEventSchema} from './contracts.js';

const envelopeTypes = ['payter_card', 'payter_ui', 'payter_state', 'kiosk_event'];

export function createEnvelope(type, payload, receivedAt = new Date().toISOString(), deliveryKey = '') {
  if (!envelopeTypes.includes(type)) throw new Error('Unsupported event type.');
  return {
    schemaVersion: 1,
    eventId: deliveryKey ? createEventId(type, {deliveryKey}) : createEventId(type, payload),
    type,
    payload,
    receivedAt,
  };
}

export function parseEnvelope(message) {
  const parsed = JSON.parse(Buffer.from(message.data).toString('utf8'));
  if (parsed?.schemaVersion !== 1 || !envelopeTypes.includes(parsed?.type) || !parsed?.eventId || !parsed?.payload) {
    throw new Error('Invalid event envelope.');
  }
  if (parsed.type === 'kiosk_event') parsed.payload = kioskEventSchema.parse(parsed.payload);
  return parsed;
}
