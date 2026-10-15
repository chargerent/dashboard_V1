import documents from './rentalTermsDocuments.js';

// Select documents from structured pricing, never from editable UI paragraphs.
// This registry is also bundled in Android so both screens use the same PDFs.
export function checkoutTermsUrl(checkout={},language='en',legacyLink='') {
  const offer=checkout.offer || {};
  const pricing=checkout.liveTerminalEnabled===true && Object.hasOwn(offer,'planCode')
    ? offer : checkout.checkoutPresentation ?? offer;
  const plan=typeof pricing.planCode==='string'?pricing.planCode.trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_'):'';
  const hasPricing=checkout.checkoutPresentation!=null || Object.hasOwn(offer,'planCode');
  const candidate=plan?documents.plans[plan]?.[language]:hasPricing?null:legacyLink;
  if(typeof candidate!=='string' || !candidate.trim())return null;
  try {
    const url=new URL(candidate.trim());
    if(url.protocol==='https:' && !url.username && !url.password && !/[\s\\]/.test(candidate.trim()))return url.href;
  } catch { /* Invalid or unsafe term links remain unavailable. */ }
  return null;
}
