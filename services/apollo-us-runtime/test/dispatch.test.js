import test from 'node:test';
import assert from 'node:assert/strict';
import {processWithFallback} from '../src/dispatch.js';

const input = {
  deliveryKey: 'physical-press-1',
  orderingKey: 'APO1',
  payload: {serialNumber: 'APO1', screenId: 'start-1', response: 'start'},
  receivedAt: '2026-09-10T12:00:00.000Z',
  type: 'payter_ui',
};

test('runtime events are processed immediately without waiting for Pub/Sub delivery', async () => {
  const processed = [];
  const queued = [];
  const result = await processWithFallback({
    ...input,
    enqueueEnvelope: async (...args) => queued.push(args),
    processEnvelope: async (envelope) => processed.push(envelope),
  });
  assert.equal(result.delivery, 'direct');
  assert.equal(processed.length, 1);
  assert.equal(queued.length, 0);
});

test('a failed immediate event is queued with the same id for retry', async () => {
  const queued = [];
  const result = await processWithFallback({
    ...input,
    enqueueEnvelope: async (...args) => queued.push(args),
    processEnvelope: async () => { throw new Error('temporary failure'); },
  });
  assert.equal(result.delivery, 'queued');
  assert.equal(result.directError, 'temporary failure');
  assert.equal(queued.length, 1);
  assert.equal(queued[0][0].eventId, result.eventId);
  assert.equal(queued[0][1], 'APO1');
});
