import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getReportRentalStatus,
    isRentalIncludedInReport,
} from '../src/utils/reportingRentalEligibility.js';

test('rentals that become purchases remain in reporting totals', () => {
    for (const status of ['purchased', 'purchase-pending', 'purchased-pending']) {
        assert.equal(isRentalIncludedInReport({ status }), true, status);
    }
});

test('failed and still-unconfirmed vends are excluded', () => {
    assert.equal(isRentalIncludedInReport({ status: 'vend_failed' }), false);
    assert.equal(isRentalIncludedInReport({ status: ' VEND_FAILED ' }), false);
    assert.equal(isRentalIncludedInReport({ status: 'pending' }), false);
});

test('confirmed rental lifecycle states remain included', () => {
    assert.equal(isRentalIncludedInReport({ status: 'rented' }), true);
    assert.equal(isRentalIncludedInReport({ status: 'returned' }), true);
});

test('reporting overrides and explicit exclusions remain authoritative', () => {
    const correctedFailure = { status: 'purchased', reportingStatus: 'vend_failed' };

    assert.equal(getReportRentalStatus(correctedFailure), 'vend_failed');
    assert.equal(isRentalIncludedInReport(correctedFailure), false);
    assert.equal(isRentalIncludedInReport({ status: 'returned', excludeFromReporting: true }), false);
    assert.equal(isRentalIncludedInReport({ status: 'returned', returnType: 'vend-reset' }), false);
});
