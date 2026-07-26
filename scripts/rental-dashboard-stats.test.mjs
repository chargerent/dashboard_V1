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

test('dashboard aggregation combines station day buckets and active statuses', () => {
  const statsByStationId = new Map([
    ['US0001', {
      days: {
        '2026-07-25': { count: 2, revenue: 18, initialCharge: 10, rented: 1, lost: 1 },
        '2026-07-20': { count: 1, revenue: 8, initialCharge: 5, rented: 0, lost: 1 },
        '2026-06-28': { count: 3, revenue: 24, initialCharge: 15, rented: 0, lost: 0 },
        '2026-01-05': { count: 4, revenue: 32, initialCharge: 20, rented: 0, lost: 0 },
      },
    }],
    ['US0002', {
      days: {
        '2026-07-25': { count: 1, revenue: 7, initialCharge: 5, rented: 2, lost: 0 },
      },
    }],
  ]);

  const totals = aggregateRentalDashboardStats(
    statsByStationId,
    ['US0001', 'US0002'],
    '2026-07-25T18:00:00.000Z',
    '$'
  );

  assert.deepEqual(totals.today, { count: 3, revenue: 25, initialCharge: 15 });
  assert.deepEqual(totals.last7Days, { count: 4, revenue: 33, initialCharge: 20 });
  assert.deepEqual(totals.last30Days, { count: 7, revenue: 57, initialCharge: 35 });
  assert.deepEqual(totals.monthToDate, { count: 4, revenue: 33, initialCharge: 20 });
  assert.deepEqual(totals.yearToDate, { count: 11, revenue: 89, initialCharge: 55 });
  assert.deepEqual(totals.statusCounts, { rented: 3, lost: 2 });
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
  assert.deepEqual(added.days['2026-07-25'], {
    count: 1,
    revenue: 12.5,
    initialCharge: 5,
    rented: 1,
    lost: 0,
  });

  const removed = applyRentalProjection(added, projection, -1, new Date('2026-07-25T18:00:00.000Z'));
  assert.deepEqual(removed.days, {});
});

test('empty dashboard totals use the requested currency symbol', () => {
  assert.equal(createEmptyRentalDashboardTotals('€').symbol, '€');
});
