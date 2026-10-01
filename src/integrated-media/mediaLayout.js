export const PAYMENT_MIN_HEIGHT=.10;
export const PAYMENT_MAX_HEIGHT=.50;
export const PAYMENT_DEFAULT_HEIGHT=.32;

export function validPaymentHeight(checkout) {
  return !checkout?.enabled || (Number.isFinite(checkout.height) && checkout.height>=PAYMENT_MIN_HEIGHT && checkout.height<=PAYMENT_MAX_HEIGHT);
}

export function previewPaymentHeight(checkout) {
  if(!checkout?.enabled)return 0;
  const height=Number.isFinite(checkout.height)?checkout.height:PAYMENT_DEFAULT_HEIGHT;
  return Math.max(PAYMENT_MIN_HEIGHT,Math.min(PAYMENT_MAX_HEIGHT,height));
}

// The separate Stripe UI editor owns this field. Media edits keep the newest
// published profile without replacing unsaved zone, playlist, or layout changes.
export function withPublishedStripeUi(draft,manifest) {
  const next={...draft};
  if(manifest?.stripeUi!==undefined)next.stripeUi=JSON.parse(JSON.stringify(manifest.stripeUi));
  else delete next.stripeUi;
  return next;
}
