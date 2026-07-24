import assert from 'node:assert/strict';
import test from 'node:test';

import { getFirestoreKioskStationId } from '../src/utils/firestoreStationId.js';

function kioskDoc(id, data) {
  return {
    id,
    data: () => data,
  };
}

test('uses the embedded operational station ID for generated Firestore document IDs', () => {
  assert.equal(
    getFirestoreKioskStationId(kioskDoc('id-8341037296', { stationid: 'US0061' })),
    'US0061'
  );
});

test('falls back to the Firestore document ID when stationid is absent', () => {
  assert.equal(getFirestoreKioskStationId(kioskDoc('US0118', {})), 'US0118');
});

test('trims station IDs before using them in rental queries', () => {
  assert.equal(
    getFirestoreKioskStationId(kioskDoc('id-generated', { stationid: ' US0939 ' })),
    'US0939'
  );
});
