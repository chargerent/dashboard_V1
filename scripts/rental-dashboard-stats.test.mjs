import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  aggregateRentalDashboardStats,
  createEmptyRentalDashboardTotals,
} from '../src/utils/rentalDashboardStats.js';

const require = createRequire(import.meta.url);
const {
  applyRentalProjection,
  buildRentalProjection,
  projectionsEqual,
} = require('../functions/rentalDashboardStats.js');

test('dashboard aggregation uses browser-local boundaries for hourly buckets', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  const statsByStationId = new Map([
    ['US0001', {
      hours: {
        '2026-07-27T15': { count: 1, revenue: 4, initialCharge: 4, rented: 0, lost: 0 },
        '2026-07-27T16': { count: 2, revenue: 8, initialCharge: 8, rented: 1, lost: 0 },
        '2026-07-20T14': { count: 1, revenue: 8, initialCharge: 5, rented: 0, lost: 1 },
        '2026-06-28T12': { count: 3, revenue: 24, initialCharge: 15, rented: 0, lost: 0 },
        '2026-01-05T12': { count: 4, revenue: 32, initialCharge: 20, rented: 0, lost: 0 },
      },
    }],
    ['US0002', {
      hours: {
        '2026-07-27T18': { count: 1, revenue: 7, initialCharge: 5, rented: 2, lost: 0 },
      },
    }],
  ]);

  try {
    const totals = aggregateRentalDashboardStats(
      statsByStationId,
      ['US0001', 'US0002'],
      '2026-07-27T23:00:00.000Z',
      '$'
    );

    assert.deepEqual(totals.today, { count: 3, revenue: 15, initialCharge: 13 });
    assert.deepEqual(totals.last7Days, { count: 4, revenue: 19, initialCharge: 17 });
    assert.deepEqual(totals.last30Days, { count: 8, revenue: 51, initialCharge: 37 });
    assert.deepEqual(totals.monthToDate, { count: 5, revenue: 27, initialCharge: 22 });
    assert.deepEqual(totals.yearToDate, { count: 12, revenue: 83, initialCharge: 57 });
    assert.deepEqual(totals.statusCounts, { rented: 3, lost: 1 });
  } finally {
    process.env.TZ = originalTimezone;
  }
});

test('projection updates are reversible and idempotently comparable', () => {
  const projection = buildRentalProjection({
    rentalStationid: 'US0001',
    rentalTime: '2026-07-25T18:00:00.000Z',
    totalCharged: '12.50',
    initialCharge: 5,
    status: 'rented',
  });

  assert.ok(projectionsEqual(projection, { ...projection }));

  const added = applyRentalProjection(null, projection, 1, new Date('2026-07-25T18:00:00.000Z'));
  assert.deepEqual(added.hours['2026-07-25T18'], {
    count: 1,
    revenue: 12.5,
    initialCharge: 5,
    rented: 1,
    lost: 0,
  });

  const removed = applyRentalProjection(added, projection, -1, new Date('2026-07-25T18:00:00.000Z'));
  assert.deepEqual(removed.hours, {});
});

test('empty dashboard totals use the requested currency symbol', () => {
  assert.equal(createEmptyRentalDashboardTotals('€').symbol, '€');
});
