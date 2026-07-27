import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySshStateOverride,
  rememberSshStateOverride,
} from '../src/utils/kioskSshState.js';

test('keeps confirmed SSH state while Firestore is stale', () => {
  const overrides = new Map();
  rememberSshStateOverride(overrides, 'US0118', true, 1_000, 60_000);

  const staleStation = { stationid: 'US0118', ssh: false };
  const mergedStation = applySshStateOverride(staleStation, overrides, 2_000);

  assert.equal(mergedStation.ssh, true);
  assert.equal(overrides.has('US0118'), true);
});

test('clears the override when Firestore catches up', () => {
  const overrides = new Map();
  rememberSshStateOverride(overrides, 'US0118', true, 1_000, 60_000);

  const currentStation = { stationid: 'US0118', ssh: true };
  const mergedStation = applySshStateOverride(currentStation, overrides, 2_000);

  assert.equal(mergedStation, currentStation);
  assert.equal(overrides.has('US0118'), false);
});

test('expires an override instead of masking Firestore indefinitely', () => {
  const overrides = new Map();
  rememberSshStateOverride(overrides, 'US0118', false, 1_000, 500);

  const station = { stationid: 'US0118', ssh: true };
  const mergedStation = applySshStateOverride(station, overrides, 1_500);

  assert.equal(mergedStation, station);
  assert.equal(overrides.has('US0118'), false);
});
