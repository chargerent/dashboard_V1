import {createDefaultKioskUiProfile, cloneProfileValue} from './kioskUiProfiles.js';
import {mergeProfileSection} from '../../functions/uiProfileSections.mjs';
import {hasStationScreen} from '../../functions/uiProfileSections.mjs';
import {stationBrand} from './stationBrand.js';
import {createYyzApolloProfileSection} from '../../functions/apolloProfileTemplate.mjs';

export const PROFILE_PREVIEW_KIOSKS = [
  {stationid: 'SAMPLE-A01', info: {client: 'APOLLO SAMPLE', location: 'Apollo only'}, hardware: {gateway: 'APOLLO', screen: 'no screen'}},
  {stationid: 'SAMPLE-A02', info: {client: 'APOLLO SAMPLE', location: 'Second Apollo'}, hardware: {gateway: 'APOLLO', screen: 'no screen'}},
  {stationid: 'SAMPLE-P01', info: {client: 'P68 SAMPLE', location: 'P68 only'}, hardware: {gateway: 'PAYTERP68', screen: 'no screen'}, screen: {mode: 'picture'}},
  {stationid: 'SAMPLE-M01', info: {client: 'MIXED SAMPLE', location: 'Touchscreen, P68, and Chargerent app'}, hardware: {gateway: 'PAYTERP68', screen: '7in'}, screen: {mode: 'picture'}, ui: {mode: 'UI'}, profileCapabilities: {chargerentApp: true}},
  {stationid: 'SAMPLE-M02', info: {client: 'MIXED SAMPLE', location: 'Apollo'}, hardware: {gateway: 'APOLLO', screen: 'no screen'}},
];

export function createProfilePreviewApi() {
  const stationBrands = new Map();
  const apolloClients = new Set(PROFILE_PREVIEW_KIOSKS
    .filter((kiosk) => kiosk.hardware?.gateway === 'APOLLO')
    .map((kiosk) => kiosk.info.client));
  let profiles = ['APOLLO SAMPLE', 'MIXED SAMPLE', 'P68 SAMPLE'].map((clientId) => {
    const profile = createDefaultKioskUiProfile(clientId);
    if (apolloClients.has(clientId)) {
      profile.terminalProfiles = {apollo: createYyzApolloProfileSection()};
      profile.sectionVersions = {apollo: 1};
    }
    return profile;
  });
  return async (name, data) => {
    if (name === 'uiProfile_list') return {profiles: cloneProfileValue(profiles), capabilities: {scopedProfiles: 1, stationBranding: 1, chargerentAppProfiles: 1, receiptPages: 1, integratedKioskStationIds: ['SAMPLE-M01'], apolloScreens: 1, apolloEstablishedScreenRemoval: 1, apolloPublishing: false, apolloTestScreens: 1, apolloProfileTestsEnabled: false, apolloTestStationIds: []}};
    if (name === 'uiProfile_setStationBrand') {
      const kiosk = PROFILE_PREVIEW_KIOSKS.find((candidate) => candidate.stationid === data.stationid);
      if (!hasStationScreen(kiosk)) throw new Error('Station branding requires a screen.');
      const current = stationBrands.get(kiosk.stationid) || stationBrand(kiosk.stationBrand).value;
      if (current !== data.expectedStationBrand) throw new Error('The station brand changed. Reload the preview.');
      const brand = stationBrand(data.stationBrand).value;
      stationBrands.set(kiosk.stationid, brand);
      return {ok: true, kiosk: {...cloneProfileValue(kiosk), stationBrand: brand}};
    }
    if (name !== 'uiProfile_upsert') throw new Error('Publishing is disabled in the local preview.');
    const existing = profiles.find(({id}) => id === data.profile.id);
    if (existing.version !== data.profile.version) throw new Error('Profile changed. Reload the preview.');
    const next = {
      ...mergeProfileSection(existing, data.profile, data.section, data.stationid, data.useDefault),
      version: existing.version + 1,
      sectionVersions: {...existing.sectionVersions, [data.section]: Number(existing.sectionVersions?.[data.section] || 0) + 1},
    };
    profiles = profiles.map((profile) => profile.id === next.id ? next : profile);
    return {profile: cloneProfileValue(next)};
  };
}
