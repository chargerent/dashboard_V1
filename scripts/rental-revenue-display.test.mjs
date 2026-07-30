import assert from 'node:assert/strict';
import test from 'node:test';

import {
  usesFullPriceRevenueTotal,
} from '../src/utils/rentalRevenueDisplay.js';

test('FULLPRICE uses one revenue total including overages', () => {
  assert.equal(usesFullPriceRevenueTotal('FULLPRICE'), true);
  assert.equal(usesFullPriceRevenueTotal(' fullprice '), true);
});

test('other gateway options retain the revenue and initial-charge pair', () => {
  assert.equal(usesFullPriceRevenueTotal('INITIALPRICE'), false);
  assert.equal(usesFullPriceRevenueTotal('OPENMODE'), false);
  assert.equal(usesFullPriceRevenueTotal(undefined), false);
});
