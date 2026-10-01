import {resolveKioskUiProfileStatus} from './kioskUiProfileStatus.js';
import {getChargerentAppProfile, getTerminalProfileCopy, isProfileSectionTarget} from '../../functions/uiProfileSections.mjs';

export function isProfileDeviceSectionAvailable(section, capabilities = {}, matchingKiosks = [], profile = null) {
  const hasMatchingKiosk = matchingKiosks.some((kiosk) => isProfileSectionTarget(kiosk, section));
  if (section !== 'chargerentApp') return hasMatchingKiosk;

  const hasSavedAppProfile = Boolean(profile?.applicationProfiles?.chargerentMedia);
  return capabilities.chargerentAppProfiles === 1 && (hasMatchingKiosk || hasSavedAppProfile);
}
export function profileSectionContent(profile, section) {
  if (section === 'chargerentApp') return getChargerentAppProfile(profile) || {};
  if (section === 'p68' || section === 'apollo') {
    return getTerminalProfileCopy(profile, section);
  }
  if (section === 'admin') return profile?.admin || {};
  const languages = JSON.parse(JSON.stringify(profile?.languages || {}));
  for (const locale of Object.values(languages.locales || {})) delete locale.terminals;
  for (const locale of ['en', 'fr', 'es']) if (languages[locale]) delete languages[locale].payter;
  return {ui: profile?.ui || {}, languages};
}

export function profileDeviceStatus(kiosk, section, profile, pendingAppliedAt = '') {
  const desired = kiosk.ui?.profileSections?.[section];
  if (pendingAppliedAt && desired?.appliedAt !== pendingAppliedAt) return 'Published · awaiting confirmation';
  if (desired) {
    const reported = kiosk.reportedUiProfile?.sections?.[section];
    if (desired.profileId !== profile?.id) return 'Using another profile';
    if (reported?.status === 'error') return 'Load error';
    if (reported?.status === 'applied' && reported.profileId === desired.profileId && Number(reported.profileVersion) === Number(desired.profileVersion)) return 'Confirmed loaded';
    return 'Published · awaiting confirmation';
  }
  if (section === 'kiosk') {
    const status = resolveKioskUiProfileStatus(kiosk);
    if (status.desiredProfileId && status.desiredProfileId !== profile?.id) return 'Using another profile';
    return status.isConfirmed ? 'Confirmed loaded' : status.statusLabel;
  }
  if (section === 'apollo') return 'Current terminal flow · not migrated';
  if (section === 'chargerentApp') return 'Not published to Chargerent apps';
  return 'Existing configuration · not published here';
}
