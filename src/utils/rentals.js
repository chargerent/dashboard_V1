import { normalizeText } from './text';

const SUCCESSFUL_REFUND_STATUSES = new Set(['approved', 'refunded', 'succeeded']);

const toValidIsoTimestamp = (value) => {
    if (!value) return '';

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};

const calculateRentalPeriod = (rentalTime, returnTime, fallbackValue) => {
    const rentalTimestamp = Date.parse(rentalTime);
    const returnTimestamp = Date.parse(returnTime);

    if (!Number.isFinite(rentalTimestamp) || !Number.isFinite(returnTimestamp)) {
        return fallbackValue;
    }

    return Math.max(0, returnTimestamp - rentalTimestamp);
};

export const normalizeRefundStatus = (status) => normalizeText(status);

export const isSuccessfulRefundStatus = (status) => (
    SUCCESSFUL_REFUND_STATUSES.has(normalizeRefundStatus(status))
);

export const hasRefundRequest = (rental) => (
    normalizeRefundStatus(rental?.refundStatus) !== '' ||
    normalizeText(rental?.status) === 'refunded'
);

export const isRefundedRental = (rental) => (
    isSuccessfulRefundStatus(rental?.refundStatus) ||
    normalizeText(rental?.status) === 'refunded'
);

export const isReturnedRentalStatus = (status) => {
    const normalizedStatus = normalizeText(status);
    return normalizedStatus === 'returned' || normalizedStatus === 'refunded';
};

export const rentalMatchesRefundConfirmation = (rental, confirmation) => {
    const normalizedOrderId = normalizeText(confirmation?.orderId);
    const normalizedTransactionId = normalizeText(confirmation?.transactionid);

    return (
        (normalizedOrderId !== '' && normalizeText(rental?.orderid) === normalizedOrderId) ||
        (normalizedTransactionId !== '' && normalizeText(rental?.rawid) === normalizedTransactionId)
    );
};

export const applyRefundConfirmationToRental = (rental, confirmation) => {
    const refundStatus = normalizeRefundStatus(confirmation?.refund_status || confirmation?.status) || 'approved';
    const refundDate = toValidIsoTimestamp(confirmation?.refund_date || confirmation?.time) || new Date().toISOString();
    const isOpenRental = normalizeText(rental?.status) === 'rented' || !rental?.returnTime;
    const nextReturnTime = isOpenRental
        ? (toValidIsoTimestamp(rental?.returnTime) || refundDate)
        : rental?.returnTime;
    const nextRentalPeriod = nextReturnTime
        ? calculateRentalPeriod(rental?.rentalTime, nextReturnTime, rental?.rentalPeriod)
        : rental?.rentalPeriod;
    const currentStatus = normalizeText(rental?.status);

    return {
        ...rental,
        status: currentStatus === 'refunded'
            ? 'returned'
            : (isOpenRental ? 'returned' : (rental?.status || 'returned')),
        refundStatus,
        refundAmount: confirmation?.refund_amount ?? confirmation?.amount ?? rental?.refundAmount,
        refundDate,
        ...(isOpenRental ? {
            returnTime: nextReturnTime,
            returnType: rental?.returnType || 'auto-return',
            returnStationid: rental?.returnStationid || rental?.rentalStationid,
            ...(nextRentalPeriod != null ? { rentalPeriod: nextRentalPeriod } : {}),
        } : {}),
    };
};
