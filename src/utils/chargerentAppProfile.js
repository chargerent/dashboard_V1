import {defaultStripeUi, validateStripeUi} from '../media-lab/stripeUi.js';

export const CHARGERENT_APP_PROFILE_KEY = 'chargerentMedia';
export const CHARGERENT_APP_SECTION_KEY = 'chargerentApp';

export function defaultChargerentAppProfile() {
  return {
    checkout: {enabled: true, height: 0.32},
    stripeUi: defaultStripeUi(),
  };
}
export function normalizeChargerentAppProfile(value) {
  const fallback = defaultChargerentAppProfile();
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  const checkout = source.checkout && typeof source.checkout === 'object' && !Array.isArray(source.checkout)
    ? source.checkout
    : fallback.checkout;
  const height = Number(checkout.height ?? 0.32);
  if (typeof checkout.enabled !== 'boolean' || !Number.isFinite(height) || height < 0.10 || height > 0.50) {
    throw new Error('The Chargerent checkout panel must be enabled or disabled and use 10% to 50% of the screen.');
  }
  return {
    checkout: {enabled: checkout.enabled, height},
    stripeUi: validateStripeUi(source.stripeUi || fallback.stripeUi),
  };
}

export function readChargerentAppProfile(profile) {
  const fallback = defaultChargerentAppProfile();
  const source = profile?.applicationProfiles?.[CHARGERENT_APP_PROFILE_KEY];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return fallback;
  return {
    checkout: {...fallback.checkout, ...(source.checkout || {})},
    stripeUi: source.stripeUi || fallback.stripeUi,
  };
}

export function writeChargerentAppProfile(profile, value) {
  return {
    ...(profile || {}),
    applicationProfiles: {
      ...(profile?.applicationProfiles || {}),
      [CHARGERENT_APP_PROFILE_KEY]: value,
    },
  };
}
