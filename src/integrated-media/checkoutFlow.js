export const IDLE_CHECKOUT_FLOW={step:'start',pageId:null,consent:false};
export const RETURN_NOTICE_MS=20000;
export function normalizeCheckoutReturnNotice(event,{stationId='LAB-US8004',now=Date.now()}={}) {
  if(event?.type!=='charger_returned' || event.stationId!==stationId || typeof event.eventId!=='string' || !event.eventId || event.eventId.length>160 || !Number.isSafeInteger(event.slot) || event.slot<=0)return null;
  const occurredAt=Date.parse(event.occurredAt),sourceExpiry=Date.parse(event.expiresAt);
  const noticeExpiresAt=Math.min(Math.min(occurredAt,now)+RETURN_NOTICE_MS,Number.isFinite(sourceExpiry)?sourceExpiry:Infinity);
  if(!Number.isFinite(occurredAt) || occurredAt<=0 || occurredAt>now+5000 || noticeExpiresAt<=now)return null;
  return {...event,noticeExpiresAt};
}
export function canPresentCheckoutReturn({flow=IDLE_CHECKOUT_FLOW,phase='idle',busy=false,recovering=false,suppressed=false}={}) {
  if(busy || recovering || suppressed)return false;
  if(['succeeded','declined','cancelled','failed'].includes(phase))return true;
  return phase==='idle' && ['start','ready','returning','returned','out_of_order'].includes(flow.step);
}
export function checkoutReturnContext({flow=IDLE_CHECKOUT_FLOW,phase='idle',interaction,returnEvent}={}) {
  const ownReturn=phase==='succeeded' && returnEvent?.interactionId===interaction?.id && !!interaction?.id && returnEvent.stationId===interaction.stationId;
  return JSON.stringify([phase,interaction?.id,interaction?.stationId,ownReturn?null:interaction?.updatedAt,ownReturn?null:interaction?.moneyStatus,flow]);
}
export function mayDismissCheckoutReturn(shown,eventId,context,safe) {
  return safe===true && shown?.eventId===eventId && shown.context===context;
}
export function returnReceiptSizing(panelHeight,scale=1) {
  const padding=20*scale,available=Math.max(0,panelHeight-2*padding),done=Math.min(60*scale,available),gap=Math.min(10*scale,available-done),qr=Math.min(160*scale,available-done-gap);
  return {padding,done,gap,qr};
}
export function checkoutReturnReceiptUrl(profile,event,interaction) {
  const matched=event?.interactionId && event.interactionId===interaction?.id && event.stationId===interaction.stationId?interaction:null;
  return checkoutLinkUrl(profile,'receipt',matched);
}
export function floatingCheckoutGeometry(width=1080,height=1920,fraction=.16,fontScale=1) {
  const scale=Math.min(width,height)/1080;
  const minimum=height>width?384*scale:(360+Math.max(0,fontScale-1)*100)*scale;
  return {scale,idleWidth:560*scale,idleHeight:128*scale,expandedWidth:width-64*scale,expandedHeight:Math.min(height,Math.round(Math.max(height*fraction,minimum))),bottom:32*scale,radius:40*scale};
}
export function checkoutLinkUrl(profile,stage,interaction) {
  for(const candidate of [stage==='receipt'?interaction?.receiptUrl:null,profile?.links?.[stage]]){
    if(typeof candidate!=='string' || !candidate.trim())continue;
    try{const url=new URL(candidate);if(url.protocol==='https:' && !url.username && !url.password)return url.href;}catch{/* Invalid links are omitted from the kiosk preview. */}
  }
  return null;
}
export function checkoutUsesColumns(width=1080,height=1920,fraction=.32) {
  const density=Math.min(width,height)/540;
  return (width>height && width>680*density) || (height*fraction<180*density && width>=480*density);
}
export function checkoutMoney(cents,currency='usd',language='en') {return Number.isFinite(cents)?new Intl.NumberFormat(({en:'en-US',fr:'fr-FR',es:'es-ES'})[language] || 'en-US',{style:'currency',currency:currency.toUpperCase()}).format(cents/100):'—';}
export function checkoutPopupValues({event,offer,interaction,language='en'}) {
  // Slot reuse does not identify a rental. Only its explicit interaction ID can
  // connect this station event to the browser tab's financial state.
  const matched=event?.interactionId && event.interactionId===interaction?.id && (!event.stationId || event.stationId===interaction.stationId)?interaction:null;
  const settlement=event?.settlement?.status==='refunded'?event.settlement:matched?.settlement?.status==='refunded'?matched.settlement:null;
  const currency=matched?.currency || offer?.currency;
  const money=(...values)=>currency?checkoutMoney(values.find(value=>Number.isFinite(value) && value>=0),currency,language):'—';
  return {
    deposit:money(settlement?.capturedAmountCents,matched?.amountCents,offer?.depositAmountCents,offer?.amountCents),
    fee:money(settlement?.chargedAmountCents,offer?.rentalFeeCents),
    refund:money(settlement?.refundedAmountCents,offer?.refundAmountCents),
    available:Number.isFinite(offer?.availableCount) && offer.availableCount>=0?offer.availableCount:'—',
    slot:Number.isFinite(event?.slot) && event.slot>0?event.slot:'—',
  };
}
export const enabledCheckoutPages=profile=>(profile?.pages || []).filter(page=>page.enabled!==false);
export function beginCheckoutFlow(pages) {
  return pages.length?{step:'page',pageId:pages[0].id,consent:false}:{step:'review',pageId:null,consent:false};
}
export function nextCheckoutPage(flow,pages) {
  const index=pages.findIndex(page=>page.id===flow.pageId),next=pages[index+1];
  return next?{step:'page',pageId:next.id,consent:false}:{step:'review',pageId:null,consent:false};
}
export function previousCheckoutPage(flow,pages) {
  const index=flow.step==='review'?pages.length:pages.findIndex(page=>page.id===flow.pageId);
  return index>0?{step:'page',pageId:pages[index-1].id,consent:false}:{step:'ready',pageId:null,consent:false};
}
export function canCreateCheckout(flow,{connected,available,busy,recovering,quoteKey}) {
  return flow.step==='review' && flow.consent===true && connected===true && available===true && !busy && !recovering && (quoteKey===undefined || flow.quoteKey===quoteKey);
}
export function isFreshReturnForFlow(flow,event) {
  return flow.step==='returning' && event?.type==='charger_returned' && event.stationId==='LAB-US8004' && Number.isFinite(flow.returnAfter) && Date.parse(event.occurredAt)>=flow.returnAfter;
}
