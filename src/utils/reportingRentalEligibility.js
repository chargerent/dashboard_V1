const EXCLUDED_REPORT_RENTAL_STATUSES = new Set([
    'vend_failed',
    'pending',
]);

const EXCLUDED_REPORT_RETURN_TYPES = new Set([
    'vend-reset',
]);

const normalizeReportingValue = (value) => String(value || '').trim().toLowerCase();

export const getReportRentalStatus = (rental) => normalizeReportingValue(
    rental?.reportingStatus || rental?.status
);

export const getReportReturnType = (rental) => normalizeReportingValue(
    rental?.reportingReturnType || rental?.returnType
);

export const isRentalIncludedInReport = (rental) => (
    !rental?.excludeFromReporting &&
    !EXCLUDED_REPORT_RENTAL_STATUSES.has(getReportRentalStatus(rental)) &&
    !EXCLUDED_REPORT_RETURN_TYPES.has(getReportReturnType(rental))
);
