const cleanText = (value) => String(value ?? '').trim();

const parseTime = (value) => {
    const timestamp = Date.parse(cleanText(value));
    return Number.isFinite(timestamp) ? timestamp : null;
};

const resolveNow = (value) => {
    if (value instanceof Date) return value.getTime();
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;
    const parsedValue = parseTime(value);
    return parsedValue ?? Date.now();
};

export const MEDIA_PLAYBACK_STALE_MS = 3 * 60 * 1000;

export const resolveKioskMediaPlaybackStatus = ({
    kiosk = {},
    assignment = {},
    referenceTime,
    isOnline,
} = {}) => {
    const report = kiosk?.reportedMedia && typeof kiosk.reportedMedia === 'object'
        ? kiosk.reportedMedia
        : {};
    const desiredActive = assignment?.active === true && Array.isArray(assignment?.playlist)
        && assignment.playlist.length > 0;
    const desiredUpdatedAt = parseTime(assignment?.updatedAt || assignment?.assignedAt || assignment?.clearedAt);
    const reportedAt = parseTime(kiosk?.mediaReportedAt || report?.receivedAt || report?.reportedAt);
    const now = resolveNow(referenceTime);
    const reportedStatus = cleanText(report?.status).toLowerCase();
    const reportIsForCurrentAssignment = reportedAt !== null && (
        desiredUpdatedAt === null || reportedAt >= desiredUpdatedAt
    );
    const reportIsStale = reportedAt !== null && now - reportedAt > MEDIA_PLAYBACK_STALE_MS;

    if (desiredActive && isOnline === false) {
        return {
            state: 'offline',
            label: 'Offline',
            reportedAt: cleanText(kiosk?.mediaReportedAt || report?.receivedAt || report?.reportedAt),
            error: cleanText(report?.error),
        };
    }

    if (desiredActive && !reportIsForCurrentAssignment) {
        return { state: 'pending', label: 'Awaiting kiosk', reportedAt: null, error: '' };
    }

    if (desiredActive && reportIsStale) {
        return {
            state: 'stale',
            label: 'Playback stale',
            reportedAt: cleanText(kiosk?.mediaReportedAt || report?.receivedAt || report?.reportedAt),
            error: cleanText(report?.error),
        };
    }

    if (desiredActive && reportedStatus === 'playing') {
        return {
            state: 'playing',
            label: 'Playing',
            reportedAt: cleanText(kiosk?.mediaReportedAt || report?.receivedAt || report?.reportedAt),
            error: '',
        };
    }

    if (desiredActive && reportedStatus === 'downloaded') {
        return {
            state: 'downloaded',
            label: 'Downloaded',
            reportedAt: cleanText(kiosk?.mediaReportedAt || report?.receivedAt || report?.reportedAt),
            error: '',
        };
    }

    if (desiredActive && reportedStatus === 'out_of_sync') {
        return {
            state: 'out-of-sync',
            label: 'Out of sync',
            reportedAt: cleanText(kiosk?.mediaReportedAt || report?.receivedAt || report?.reportedAt),
            error: cleanText(report?.error),
        };
    }

    if (desiredActive && reportedStatus === 'error') {
        return {
            state: 'error',
            label: 'Load error',
            reportedAt: cleanText(kiosk?.mediaReportedAt || report?.receivedAt || report?.reportedAt),
            error: cleanText(report?.error),
        };
    }

    if (desiredActive) {
        return { state: 'pending', label: 'Awaiting kiosk', reportedAt: null, error: '' };
    }

    if (reportedStatus === 'cleared' && !reportIsStale) {
        return {
            state: 'cleared',
            label: 'Cleared',
            reportedAt: cleanText(kiosk?.mediaReportedAt || report?.receivedAt || report?.reportedAt),
            error: '',
        };
    }

    return { state: 'unassigned', label: 'Not assigned', reportedAt: null, error: '' };
};
