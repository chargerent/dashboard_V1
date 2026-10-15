import {defaultStripeUi, validateStripeUi} from '../integrated-media/stripeUi.js';
import {defaultReceiptPage, normalizeReceiptPage} from '../../functions/receiptPageProfile.mjs';

export const CHARGERENT_APP_PROFILE_KEY = 'chargerentMedia';
export const CHARGERENT_APP_SECTION_KEY = 'chargerentApp';

export function defaultChargerentAppProfile() {
  return {
    checkout: {enabled: true, height: 0.32},
    stripeUi: defaultStripeUi(),
    receiptPage: defaultReceiptPage(),
  };
}
export function normalizeChargerentAppProfile(value) {
  const fallback = defaultChargerentAppProfile();
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  const checkout = source.checkout && typeof source.checkout === 'object' && !Array.isArray(source.checkout)
    ? source.checkout
    : fallback.checkout;
  const height = Number(checkout.height ?? 0.32);
  if (typeof checkout.enabled !== 'boolean' || !Number.isFinite(height) || height < 0.15 || height > 0.50) {
    throw new Error('The Chargerent checkout panel must be enabled or disabled and use 15% to 50% of the screen.');
  }
  const stripeUi=validateStripeUi(source.stripeUi || fallback.stripeUi);
  return {
    checkout: {enabled: checkout.enabled, height},
    stripeUi,
    receiptPage: normalizeReceiptPage({...(source.receiptPage || fallback.receiptPage),defaultLanguage:stripeUi.defaultLanguage,enabledLanguages:stripeUi.enabledLanguages}),
  };
}

export function chargerentAppProfileForService(value, savedValue, capabilities = {}, {hasReceiptLogoFile = false} = {}) {
  const normalized=normalizeChargerentAppProfile(value);
  if (capabilities.receiptPages === 1) return normalized;
  const currentReceipt=normalizeReceiptPage(value?.receiptPage || defaultReceiptPage());
  const savedReceipt=normalizeReceiptPage(savedValue?.receiptPage || defaultReceiptPage());
  if (hasReceiptLogoFile || savedValue?.receiptPage || JSON.stringify(currentReceipt)!==JSON.stringify(savedReceipt)) {
    throw new Error('Receipt page changes require the updated profile service. Your draft is kept; publish these changes after the service update.');
  }
  // Older services accept only checkout and stripeUi. A new editor must not add
  // untouched receipt defaults to an otherwise compatible checkout save.
  delete normalized.receiptPage;
  return normalized;
}

export function readChargerentAppProfile(profile) {
  const fallback = defaultChargerentAppProfile();
  const source = profile?.applicationProfiles?.[CHARGERENT_APP_PROFILE_KEY];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return fallback;
  const checkout = {...fallback.checkout, ...(source.checkout || {})};
  const legacyHeight = Number(checkout.height);
  if (legacyHeight >= .10 && legacyHeight < .15) checkout.height = .15;
  return {
    checkout,
    stripeUi: source.stripeUi || fallback.stripeUi,
    receiptPage: source.receiptPage || fallback.receiptPage,
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
