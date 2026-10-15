import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {defaultStripeUi,validateStripeUi,RENT_RETURN_PLANS,rentReturnOverrides,stripeRentReturnText,directTapFooterKeys} from '../src/integrated-media/stripeUi.js';
import {howItWorksOfferFromKiosk} from '../src/integrated-media/howItWorks.js';
import {editorPreviewOffer,editorPreviewStage,rentReturnEditorKeys} from '../src/integrated-media/checkoutEditorPreview.js';

const {resolveKioskOffer}=createRequire(import.meta.url)('../functions/kioskTerminal.js');
const kiosk={stationid:'US8012',hardware:{gateway:'STRIPE',gatewayoptions:'FULLPRICE'},pricing:{text:'EVENT - SIMPLE',touch:false,currency:'US',buyprice:55,authamount:1,dailyprice:55,initialperiod:24,overdue:30}};

test('US8012 selects its no-touch Event Simple screen and configured prices',()=>{
  const offer=editorPreviewOffer(howItWorksOfferFromKiosk(kiosk));
  assert.equal(offer.touch,false);assert.equal(offer.planCode,'EVENT_SIMPLE');assert.equal(offer.amountCents,5500);
  assert.equal(editorPreviewStage('start',offer),'ready');
  const keys=rentReturnEditorKeys(offer);
  assert(keys.includes('touchBorrowTitle'));assert(keys.includes('eventLateDays'));assert(!keys.includes('touchHold'));assert.equal(keys.at(-1),'touchConsent');
  assert(!keys.includes('rent'));assert(!keys.includes('eventLateDay'));assert(!keys.includes('touchUpfrontPayment'));
  const initial=rentReturnEditorKeys({...offer,gatewayOption:'INITIALPRICE',pricingSnapshot:{overdue:1}});
  assert(!initial.includes('touchUpfrontPayment'));assert(initial.includes('eventLateDay'));
});

test('preview mode and pricing tabs never mutate the selected kiosk or payment offer',()=>{
  const before=structuredClone(kiosk),offer=howItWorksOfferFromKiosk(kiosk),beforeOffer=structuredClone(offer);
  for(const {key} of RENT_RETURN_PLANS){
    const preview=editorPreviewOffer(offer,{plan:key,mode:'touch'});
    assert.equal(preview.planCode,key);assert.equal(preview.touch,true);
    assert.equal(preview.stationId,'US8012');assert.equal(preview.previewExample,key!=='EVENT_SIMPLE');
    assert(rentReturnEditorKeys(preview).includes('rent'));
    assert(!rentReturnEditorKeys(preview).includes('touchConsent'));
    assert(!rentReturnEditorKeys(editorPreviewOffer(offer,{plan:key})).includes('rent'));
  }
  assert.deepEqual(kiosk,before);assert.deepEqual(offer,beforeOffer);
  assert.equal(editorPreviewOffer({...offer,paymentRequired:false},{mode:'noTouch'}).touch,true);
});

test('each rate tab renders the same price lines as the real terminal offer',()=>{
  for(const {key} of RENT_RETURN_PLANS){
    const preview=editorPreviewOffer(howItWorksOfferFromKiosk(kiosk),{plan:key});
    const actual=resolveKioskOffer({stripeMode:'live',stripeAccountCountry:'US'},{hardware:{gatewayoptions:preview.gatewayOption},pricing:preview.pricingSnapshot});
    assert.deepEqual(preview.pricingLines,actual.pricingLines,key);
    assert.equal(preview.amountCents,actual.paymentAmountCents,key);
  }
});

test('rate copy survives validation and stays isolated by plan, touch mode and language',()=>{
  const input=defaultStripeUi();
  input.rentReturn={EVENT_SIMPLE:{noTouch:{en:{touchBorrowTitle:'Event card reader',eventLateDays:'{eventCharge} after {overdueDays} days'},fr:{touchBorrowTitle:'Événement'}}},PURCHASE_SIMPLE_DAILY:{noTouch:{en:{touchBorrowTitle:'Purchase reader',pricing:'Rates:\n{rateSummary}'}}}};
  const profile=validateStripeUi(JSON.parse(JSON.stringify(input)));
  assert.equal(stripeRentReturnText(profile,'en','touchBorrowTitle','EVENT_SIMPLE',false),'Event card reader');
  assert.equal(stripeRentReturnText(profile,'fr','touchBorrowTitle','EVENT_SIMPLE',false),'Événement');
  assert.equal(stripeRentReturnText(profile,'es','touchBorrowTitle','EVENT_SIMPLE',false),profile.locales.es.touchBorrowTitle);
  assert.equal(stripeRentReturnText(profile,'en','touchBorrowTitle','EVENT_SIMPLE',true),profile.locales.en.touchBorrowTitle);
  assert.equal(stripeRentReturnText(profile,'en','touchBorrowTitle','PURCHASE_SIMPLE_DAILY',false),'Purchase reader');
  assert.equal(stripeRentReturnText(profile,'en','eventLateDays','EVENT_SIMPLE',false,{eventCharge:'$55',overdueDays:30}),'$55 after 30 days');
  assert.equal(stripeRentReturnText(profile,'en','pricing','PURCHASE_SIMPLE_DAILY',false,{rateSummary:'$5 for 24 hours'}),'Rates:\n$5 for 24 hours');
  assert.deepEqual(rentReturnOverrides(profile,'en','LEASE_SIMPLE_DAILY',false),{});
  assert.deepEqual(input.rentReturn,profile.rentReturn);
});

test('variant validation rejects billing settings, unknown plans and malformed text',()=>{
  for(const rentReturn of [null,[],{OTHER:{}},{EVENT_SIMPLE:{other:{}}},{EVENT_SIMPLE:{noTouch:{de:{}}}},{EVENT_SIMPLE:{noTouch:{en:{amountCents:100}}}},{EVENT_SIMPLE:{touch:{en:{rent:1}}}},{EVENT_SIMPLE:{noTouch:{en:{touchBorrowTitle:'x'.repeat(2001)}}}}]){
    assert.throws(()=>validateStripeUi({...defaultStripeUi(),rentReturn}),{code:'INVALID_STRIPE_UI'});
  }
  assert.equal(Object.hasOwn(validateStripeUi(defaultStripeUi()),'rentReturn'),false);
});

test('direct-tap footer replaces the hold with consent and retains upfront-payment copy only for its own mode',()=>{
  for(const option of [undefined,'FULLPRICE','AUTH'])assert.deepEqual(directTapFooterKeys(option),['touchConsent']);
  assert.deepEqual(directTapFooterKeys('INITIALPRICE'),['touchUpfrontPayment','touchConsent']);
  assert.deepEqual(rentReturnEditorKeys({...howItWorksOfferFromKiosk(kiosk),gatewayOption:'INITIALPRICE'}).slice(-2),['helpScan','touchConsent']);
  const profile=defaultStripeUi();profile.locales.en.touchHold='Saved legacy hold';
  assert.equal(validateStripeUi(profile).locales.en.touchHold,'Saved legacy hold');
});
