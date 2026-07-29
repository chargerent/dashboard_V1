import assert from 'node:assert/strict';
import test from 'node:test';

import {
    rentalMatchesRefundConfirmation,
    replaceLoadedRentalDocument,
} from '../src/utils/rentals.js';

test('refund confirmation identifies the loaded rental by order id', () => {
    assert.equal(
        rentalMatchesRefundConfirmation(
            { documentId: 'a30b603c-617b', orderid: 'a30b603c-617b' },
            { action: 'refund', orderId: 'a30b603c-617b', status: 'refunded' }
        ),
        true
    );
});

test('authoritative refresh replaces only the matching loaded rental', () => {
    const otherRental = {
        documentId: 'other-rental',
        status: 'returned',
    };
    const staleRental = {
        documentId: 'a30b603c-617b',
        status: 'pending',
    };
    const refreshedRental = {
        documentId: 'a30b603c-617b',
        status: 'returned',
        refundStatus: 'refunded',
        refundAmount: 'full',
    };

    const result = replaceLoadedRentalDocument(
        [otherRental, staleRental],
        refreshedRental
    );

    assert.strictEqual(result[0], otherRental);
    assert.deepEqual(result[1], refreshedRental);
});
