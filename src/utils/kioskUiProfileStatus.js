const cleanText = (value) => String(value ?? '').trim();

export const formatKioskUiProfileName = (value) => (
    cleanText(value).replace(/\s+kiosk\s+ui\s*$/i, '').trim()
);

const normalizeVersion = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const version = Number(value);
    return Number.isFinite(version) && version >= 0 ? version : null;
};

export const formatKioskUiProfileDate = (value) => {
    const timestamp = Date.parse(cleanText(value));
    if (!Number.isFinite(timestamp)) return 'Unknown';

    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(timestamp));
};

export const resolveKioskUiProfileStatus = (kiosk = {}) => {
    const ui = kiosk?.ui && typeof kiosk.ui === 'object' ? kiosk.ui : {};
    const reported = kiosk?.reportedUiProfile && typeof kiosk.reportedUiProfile === 'object'
        ? kiosk.reportedUiProfile
        : {};

    const desiredProfileId = cleanText(ui.profileId || kiosk.uiProfileId);
    const desiredProfileName = cleanText(ui.profileName);
    const desiredVersion = normalizeVersion(ui.profileVersion);
    const reportedProfileId = cleanText(reported.profileId);
    const reportedVersion = normalizeVersion(reported.profileVersion);
    const reportedStatus = cleanText(reported.status).toLowerCase();
    const hasDesiredProfile = Boolean(desiredProfileId);
    const hasReportedProfile = Boolean(reportedProfileId);
    const idsMatch = hasDesiredProfile && hasReportedProfile && desiredProfileId === reportedProfileId;
    const versionsMatch = desiredVersion !== null && reportedVersion !== null && desiredVersion === reportedVersion;
    const isConfirmed = reportedStatus === 'applied' && idsMatch && versionsMatch;

    let state = 'legacy';
    let statusLabel = 'Legacy / manual';
    if (reportedStatus === 'error') {
        state = 'error';
        statusLabel = 'Load error';
    } else if (isConfirmed) {
        state = 'confirmed';
        statusLabel = 'Loaded';
    } else if (hasReportedProfile) {
        state = 'out-of-sync';
        statusLabel = 'Out of sync';
    } else if (hasDesiredProfile) {
        state = 'pending';
        statusLabel = 'Awaiting confirmation';
    }

    const loadedProfileId = hasReportedProfile ? reportedProfileId : desiredProfileId;
    const loadedVersion = hasReportedProfile ? reportedVersion : desiredVersion;
    const loadedProfileName = formatKioskUiProfileName(
        reported.profileName || (loadedProfileId === desiredProfileId ? desiredProfileName : '') || loadedProfileId,
    );
    const publishedAt = cleanText(ui.profileAppliedAt);
    const confirmedAt = cleanText(kiosk.uiProfileReportedAt || reported.reportedAt);
    const loadedAt = cleanText(reported.appliedAt || (hasReportedProfile ? confirmedAt : '') || publishedAt);

    return {
        state,
        statusLabel,
        isConfirmed,
        profileId: loadedProfileId,
        profileName: loadedProfileName || 'No managed profile',
        profileVersion: loadedVersion,
        versionLabel: loadedVersion === null ? 'Version unknown' : `Version ${loadedVersion}`,
        updatedAt: loadedAt,
        updatedLabel: formatKioskUiProfileDate(loadedAt),
        publishedAt,
        confirmedAt,
        desiredProfileId,
        desiredVersion,
        reportedProfileId,
        reportedVersion,
        error: cleanText(reported.error),
    };
};
