import {resolveKioskUiProfileStatus} from './kioskUiProfileStatus.js';
import {getTerminalProfileCopy, hasTerminalOverride} from '../../functions/uiProfileSections.mjs';

export function profileSectionContent(profile, section, stationId = '') {
  if (section === 'p68' || section === 'apollo') {
    return {custom: hasTerminalOverride(profile, section, stationId), ...getTerminalProfileCopy(profile, section, stationId)};
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
  return section === 'apollo' ? 'Current terminal flow · not migrated' : 'Existing configuration · not published here';
}
