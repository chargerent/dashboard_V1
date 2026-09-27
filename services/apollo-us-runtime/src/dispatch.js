import {createEnvelope} from './events.js';

export async function processWithFallback({
  deliveryKey = '',
  enqueueEnvelope,
  orderingKey,
  payload,
  processEnvelope,
  receivedAt = new Date().toISOString(),
  type,
}) {
  const envelope = createEnvelope(type, payload, receivedAt, deliveryKey);
  try {
    await processEnvelope(envelope);
    return {delivery: 'direct', eventId: envelope.eventId};
  } catch (error) {
    await enqueueEnvelope(envelope, orderingKey);
    return {delivery: 'queued', directError: error.message, eventId: envelope.eventId};
  }
}
