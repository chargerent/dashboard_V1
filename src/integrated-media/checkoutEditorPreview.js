import {howItWorksOfferFromKiosk} from './howItWorks.js';
import {RENT_RETURN_PLANS,rentReturnPlanCode,eventReturnDeadline,directTapFooterKeys} from './stripeUi.js';
import {calculateRateArray} from '../utils/kioskPricing.js';

export function editorPreviewOffer(offer={}, {mode='auto',plan='auto'}={}) {
  const currentPlan=rentReturnPlanCode(offer.planCode || offer.pricingSnapshot?.text);
  const selectedPlan=plan==='auto'?currentPlan:plan;
  let result={...offer};
  if(selectedPlan && selectedPlan!==currentPlan && RENT_RETURN_PLANS.some(({key})=>key===selectedPlan)){
    // Unassigned rate tabs use examples. Selecting a tab never changes station pricing.
    const text=selectedPlan==='PURCHASE_SIMPLE_24_HRS'?'PURCHASE SIMPLE 24 HRS':selectedPlan.replace('_',' - ').replaceAll('_',' ');
    const pricing={text,currency:'US',authamount:1,initialperiod:2,dailyprice:5,buyprice:55,overdue:30,offline:false};
    pricing.rate=calculateRateArray(pricing);
    result={...result,...howItWorksOfferFromKiosk({pricing,hardware:{gateway:offer.gateway || 'STRIPE',gatewayoptions:offer.gatewayOption || 'FULLPRICE'}})};
    delete result.pricingLines;
  }
  const noCard=result.paymentRequired===false;
  result={...result,stationId:offer.stationId,planCode:selectedPlan,touch:noCard?true:mode==='auto'?offer.touch!==false:mode==='touch',previewExample:selectedPlan!==currentPlan};
  return {...result,pricingLines:result.pricingLines || editorPricingLines(result)};
}

// Match the terminal's configured rental-price lines.
export function editorPricingLines(offer={}) {
  const p=offer.pricingSnapshot || {};
  const money=value=>{
    const amount=Number(value);
    if(value==null || typeof value!=='number' && (typeof value!=='string' || !value.trim()) || !Number.isFinite(amount) || !offer.currency)return '—';
    try{return new Intl.NumberFormat('en-US',{style:'currency',currency:offer.currency.toUpperCase(),minimumFractionDigits:2,maximumFractionDigits:2}).format(amount);}
    catch{return '—';}
  };
  const daily=money(p.dailyprice),buy=money(p.buyprice),initial=money(p.authamount),hours=p.initialperiod ?? '—',days=p.overdue ?? '—';
  switch(offer.planCode){
    case 'PURCHASE_SIMPLE_DAILY':return [`${daily} per 24-hour period`,`${buy} if not returned after ${days} days`];
    case 'PURCHASE_MIXED_DAILY':case 'PURCHASE_MIXED_DAY':return [`${initial} if returned within ${hours} hours`,`${daily} if returned the same day`,`${buy} if not returned`];
    case 'PURCHASE_SIMPLE_24_HRS':return [`${daily} for 24 hours`,`${buy} if not returned`];
    case 'LEASE_SIMPLE_DAILY':return ['Free for the first 24 hours',`${daily} for each additional 24-hour period`,`${buy} if not returned after ${days} days`];
    case 'LEASE_MIXED_DAILY':return [`Free for the first ${hours} hours`,`${daily} for each additional 24-hour period`,`${buy} if not returned after ${days} days`];
    case 'EVENT_SIMPLE':return ['Free if returned by end of day (first 24 hours)',`${daily} for each additional 24-hour period`,`${buy} if not returned after ${days} days`];
    default:return [];
  }
}

export function rentReturnEditorKeys(offer={},navigation={}) {
  if(offer.touch!==false || offer.paymentRequired===false)return ['ready.title','ready.body','rent','return','cancel',
    ...[['map','map'],['terms','termsButton'],['information','information']].filter(([setting])=>navigation[setting]!==false).map(([,key])=>key),'helpTitle','helpScan'];
  return ['touchBorrowTitle',...(offer.planCode==='EVENT_SIMPLE'?['eventFreeDay',eventReturnDeadline(offer).key]:['pricing']),
    'returnAnySlot','returnConfirmationHint','helpTermsTitle','helpScan',...directTapFooterKeys(offer.gatewayOption).filter(key=>key!=='touchUpfrontPayment')];
}

export function editorPreviewStage(group,offer={}) {
  const direct=offer.touch===false && offer.paymentRequired!==false;
  return direct && ['start','ready','waiting_for_card','shared'].includes(group)?'ready':group;
}

export function editorPreviewSections(sections,offer={}) {
  return offer.touch===false && offer.paymentRequired!==false
    ? sections.filter(section=>!['start','loading','information','returning','review','waiting_for_card','terms','map','shared'].includes(section.key))
    : sections;
}
