import assert from 'node:assert/strict';
import test from 'node:test';

import { filterProvisionedStations, isKioskActive } from '../src/utils/helpers.js';

test('keeps pending AI booth registrations off the dashboard', () => {
  const stations = [
    {
      stationid: 'aid-1780555893',
      provisionid: 'aid-1780555893',
      status: 'pending-provision',
      active: false,
    },
    {
      stationid: 'US0118',
      provisionid: 'id-5446395998',
      status: 'active',
      active: true,
    },
  ];

  assert.deepEqual(
    filterProvisionedStations(stations).map((station) => station.stationid),
    ['US0118']
  );
});

test('excludes every supported pending status spelling', () => {
  const stations = ['pending', 'pending-provision', 'pending_provision'].map((status, index) => ({
    stationid: `US8${String(index).padStart(3, '0')}`,
    provisionid: `id-${index}`,
    status,
  }));

  assert.deepEqual(filterProvisionedStations(stations), []);
});

test('keeps legitimate inactive or disabled provisioned kiosks visible', () => {
  const station = {
    stationid: 'CA0010',
    provisionid: 'id-1234567890',
    status: 'inactive',
    active: false,
    disabled: { status: true },
  };

  assert.deepEqual(filterProvisionedStations([station]), [station]);
});

test('requires both the manual active flag and a recent kiosk heartbeat', () => {
  const referenceTime = '2026-08-31T12:00:00.000Z';
  const recentHeartbeat = '2026-08-30T12:00:00.000Z';
  const staleHeartbeat = '2026-08-01T12:00:00.000Z';

  assert.equal(isKioskActive({ active: true, lastUpdated: recentHeartbeat }, referenceTime), true);
  assert.equal(isKioskActive({ lastUpdated: recentHeartbeat }, referenceTime), true);
  assert.equal(isKioskActive({ active: false, lastUpdated: recentHeartbeat }, referenceTime), false);
  assert.equal(isKioskActive({ active: true, lastUpdated: staleHeartbeat }, referenceTime), false);
});
