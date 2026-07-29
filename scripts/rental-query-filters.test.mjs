import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildRentalFilterQueryStreams,
    buildStationVersionKey,
    createStationVersionMap,
    rentalHasLogError,
    rentalMatchesActiveFilters,
} from '../src/utils/rentalQueryFilters.js';

test('rare exact statuses are queried before the 30-day result is paged', () => {
    assert.deepEqual(
        buildRentalFilterQueryStreams({ status: 'vend_failed' }),
        [{ key: 'status:vend_failed', field: 'status', value: 'vend_failed' }]
    );
    assert.deepEqual(
        buildRentalFilterQueryStreams({ status: 'purchased' }),
        [{ key: 'status:purchased', field: 'status', value: 'purchased' }]
    );
    assert.deepEqual(
        buildRentalFilterQueryStreams({ status: 'payment_approved' }),
        [{ key: 'status:payment_approved', field: 'status', value: 'payment_approved' }]
    );
});

test('gateway filters query both normalized and legacy uppercase values', () => {
    assert.deepEqual(
        buildRentalFilterQueryStreams({ status: 'all', gateway: 'uid' }),
        [
            { key: 'gateway:uid', field: 'gateway', value: 'uid' },
            { key: 'gateway:UID', field: 'gateway', value: 'UID' },
        ]
    );
});

test('heartbeat-only kiosk updates preserve the station-version dependency key', () => {
    const getVersion = station => station.hardware?.type === 'CT3' ? 'v2' : 'v1';
    const initialStations = [
        { stationid: 'US0001', timestamp: 'first', hardware: { type: 'CK30' } },
        { stationid: 'US0002', timestamp: 'first', hardware: { type: 'CT3' } },
    ];
    const heartbeatStations = initialStations.map(station => ({
        ...station,
        timestamp: 'second',
    }));

    const initialKey = buildStationVersionKey(initialStations, getVersion);
    const heartbeatKey = buildStationVersionKey(heartbeatStations, getVersion);
    const changedVersionKey = buildStationVersionKey([
        initialStations[0],
        { ...initialStations[1], hardware: { type: 'CK30' } },
    ], getVersion);

    assert.equal(heartbeatKey, initialKey);
    assert.notEqual(changedVersionKey, initialKey);
    assert.deepEqual(
        Object.fromEntries(createStationVersionMap(initialKey)),
        { US0001: 'v1', US0002: 'v2' }
    );
});

test('refunded rentals combine legacy status and successful refund fields', () => {
    assert.deepEqual(
        buildRentalFilterQueryStreams({ status: 'refunded' }),
        [
            { key: 'status:refunded', field: 'status', value: 'refunded' },
            { key: 'refund:approved', field: 'refundStatus', value: 'approved' },
            { key: 'refund:refunded', field: 'refundStatus', value: 'refunded' },
            { key: 'refund:succeeded', field: 'refundStatus', value: 'succeeded' },
        ]
    );

    assert.equal(
        rentalMatchesActiveFilters(
            { status: 'returned', refundStatus: 'approved' },
            { status: 'refunded' }
        ),
        true
    );
});

test('computed filters retain only matching rentals after bounded scanning', () => {
    assert.equal(
        rentalMatchesActiveFilters(
            { status: 'returned', rentalPeriod: 120_000 },
            { status: 'short_rental' }
        ),
        true
    );
    assert.equal(
        rentalMatchesActiveFilters(
            { status: 'returned', rentalPeriod: 600_000 },
            { status: 'short_rental' }
        ),
        false
    );
    assert.equal(
        rentalMatchesActiveFilters(
            { status: 'pending' },
            { status: 'error' },
            { hasLogError: () => true }
        ),
        true
    );
});

test('log-error matching detects failed vend and backend process events', () => {
    assert.equal(
        rentalHasLogError({
            status: 'returned',
            vendAttempts: [{ reason: 'dispensed', exitStatus: 1 }],
        }),
        false
    );
    assert.equal(
        rentalHasLogError({
            status: 'vend_failed',
            failureReason: 'MQTT_TIMEOUT',
        }),
        true
    );
    assert.equal(
        rentalHasLogError({
            status: 'returned',
            processLog: [{ event: 'apollo-commit-failed', status: 'failed' }],
        }),
        true
    );
});

test('secondary gateway, return type, and station-version filters remain combined', () => {
    const filters = {
        status: 'returned',
        gateway: 'uid',
        returnType: 'auto-return',
        version: 'v2',
    };
    const rental = {
        status: 'returned',
        gateway: 'UID',
        returnType: 'auto-return',
    };

    assert.equal(
        rentalMatchesActiveFilters(
            rental,
            filters,
            { getStationVersion: () => 'v2' }
        ),
        true
    );
    assert.equal(
        rentalMatchesActiveFilters(
            rental,
            filters,
            { getStationVersion: () => 'v1' }
        ),
        false
    );
});
