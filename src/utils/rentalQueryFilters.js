import {
    isRefundedRental,
    isReturnedRentalStatus,
} from './rentals.js';
import { normalizeText } from './text.js';

const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;

const DIRECT_STATUS_FILTERS = new Set([
    'rented',
    'returned',
    'purchased',
    'pending',
    'declined',
    'vend_failed',
]);

const normalizeStatusKey = (status) => (
    normalizeText(status).replace(/[-\s]+/g, '_')
);

const STATION_VERSION_ENTRY_SEPARATOR = '\u001e';
const STATION_VERSION_RECORD_SEPARATOR = '\u001f';

export const buildStationVersionKey = (stations, getVersion) => (
    (stations || [])
        .map(station => [
            String(station?.stationid || '').trim(),
            getVersion(station),
        ])
        .filter(([stationId]) => stationId)
        .map(([stationId, version]) => (
            `${stationId}${STATION_VERSION_ENTRY_SEPARATOR}${version}`
        ))
        .sort()
        .join(STATION_VERSION_RECORD_SEPARATOR)
);

export const createStationVersionMap = (stationVersionKey) => new Map(
    stationVersionKey
        ? stationVersionKey.split(STATION_VERSION_RECORD_SEPARATOR).map(entry => (
            entry.split(STATION_VERSION_ENTRY_SEPARATOR)
        ))
        : []
);

const processEntryHasError = (entry) => {
    const status = normalizeText(entry?.status || entry?.paymentActionStatus);
    const event = normalizeText(entry?.event || entry?.type || entry?.title);
    return (
        status.includes('fail') ||
        status.includes('error') ||
        status.includes('missing') ||
        event.includes('fail') ||
        event.includes('error') ||
        event.includes('missing')
    );
};

const vendAttemptSucceeded = (attempt) => (
    normalizeText(attempt?.reason) === 'dispensed' ||
    Number(attempt?.exitStatus) === 1
);

export const rentalHasLogError = (rental) => {
    const processLog = Array.isArray(rental?.processLog) ? rental.processLog : [];
    const attempts = Array.isArray(rental?.vendAttempts) ? rental.vendAttempts : [];
    const hasBackendEvent = (eventName) => processLog.some(entry => (
        normalizeText(entry?.event) === eventName
    ));
    const status = normalizeStatusKey(rental?.status);
    const hasSuccessfulVend = (
        attempts.some(vendAttemptSucceeded) ||
        (attempts.length === 0 && Number(rental?.exitStatus) === 1)
    );
    const hasCompletedVend = (
        hasSuccessfulVend ||
        status === 'rented' ||
        status === 'purchased' ||
        isReturnedRentalStatus(rental?.status) ||
        Boolean(rental?.returnTime)
    );
    const hasFinalFailure = Boolean(
        status === 'vend_failed' ||
        ((rental?.failureReason || rental?.lastVendFailureReason) && !hasCompletedVend)
    );
    const hasFailedAttempt = attempts.some(attempt => !vendAttemptSucceeded(attempt));
    const hasFailedLegacyVend = (
        attempts.length === 0 &&
        rental?.exitStatus != null &&
        Number(rental.exitStatus) !== 1
    );
    const hasFailedPaymentAction = Boolean(
        rental?.paymentAction &&
        !hasBackendEvent('apollo-payment-action-queued') &&
        processEntryHasError({
            status: rental?.paymentActionStatus,
            event: `apollo-${rental.paymentAction}`,
        })
    );
    const hasCancelEvent = processLog.some(entry => normalizeText(entry?.event).includes('cancel'));
    const hasFailedCancel = Boolean(
        (rental?.cpsCancelStatusCode || rental?.cpsCancelLookupStatusCode || rental?.cpsCancelState) &&
        !hasCancelEvent &&
        !rental?.cpsCancelConfirmed
    );
    const hasCommitEvent = processLog.some(entry => normalizeText(entry?.event).includes('commit'));
    const hasFailedCommit = Boolean(
        (rental?.cpsCommitStatusCode || rental?.cpsCommitState) &&
        !hasCommitEvent &&
        !rental?.cpsCommitConfirmed
    );

    return (
        hasFailedAttempt ||
        hasFailedLegacyVend ||
        Boolean(rental?.lastVendFailure && attempts.length === 0) ||
        hasFinalFailure ||
        hasFailedPaymentAction ||
        hasFailedCancel ||
        hasFailedCommit ||
        processLog.some(processEntryHasError)
    );
};

export const buildRentalFilterQueryStreams = (filters = {}) => {
    const status = normalizeStatusKey(filters.status);

    if (status === 'refunded') {
        return [
            { key: 'status:refunded', field: 'status', value: 'refunded' },
            { key: 'refund:approved', field: 'refundStatus', value: 'approved' },
            { key: 'refund:refunded', field: 'refundStatus', value: 'refunded' },
            { key: 'refund:succeeded', field: 'refundStatus', value: 'succeeded' },
        ];
    }

    if (status === 'short_rental') {
        return [
            { key: 'status:returned', field: 'status', value: 'returned' },
            { key: 'status:refunded', field: 'status', value: 'refunded' },
        ];
    }

    if (DIRECT_STATUS_FILTERS.has(status)) {
        return [{ key: `status:${status}`, field: 'status', value: status }];
    }

    if (filters.gateway && filters.gateway !== 'all') {
        const normalizedGateway = normalizeText(filters.gateway);
        return [...new Set([
            normalizedGateway,
            normalizedGateway.toUpperCase(),
        ])].map(value => ({
            key: `gateway:${value}`,
            field: 'gateway',
            value,
        }));
    }

    if (filters.returnType && filters.returnType !== 'all') {
        return [{
            key: `return:${filters.returnType}`,
            field: 'returnType',
            value: filters.returnType,
        }];
    }

    return [{ key: 'all' }];
};

export const rentalMatchesActiveFilters = (
    rental,
    filters = {},
    {
        getStationVersion = () => '',
        hasLogError = () => false,
    } = {}
) => {
    const status = normalizeStatusKey(filters.status);

    if (
        filters.version &&
        filters.version !== 'all' &&
        getStationVersion(rental) !== filters.version
    ) {
        return false;
    }

    if (
        filters.gateway &&
        filters.gateway !== 'all' &&
        normalizeText(rental?.gateway) !== normalizeText(filters.gateway)
    ) {
        return false;
    }

    if (
        filters.returnType &&
        filters.returnType !== 'all' &&
        rental?.returnType !== filters.returnType
    ) {
        return false;
    }

    if (!status || status === 'all') return true;

    if (status === 'short_rental') {
        return (
            isReturnedRentalStatus(rental?.status) &&
            Number(rental?.rentalPeriod) > 0 &&
            Number(rental?.rentalPeriod) < FIVE_MINUTES_IN_MS
        );
    }

    if (status === 'refunded') return isRefundedRental(rental);
    if (status === 'error') return hasLogError(rental);

    return normalizeStatusKey(rental?.status) === status;
};
