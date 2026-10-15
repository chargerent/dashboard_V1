import {MEDIA_HOSTED,mediaUrl,mediaFetch} from './mediaApi.js';
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import {customerHelpQrDataUrl,customerHelpUrl,customerHelpTermsUrl,stripeQrDataUrl} from './stripeQr.js';

import {STRIPE_UI_LANGUAGES,defaultStripeUi,validateStripeUi,stripeText,stripeRentReturnText,rentReturnOverrides,stripePageText,resolveStripeLanguage,eventReturnDeadline,directTapFooterKeys} from './stripeUi.js';
import {checkoutMoney,checkoutUsesColumns,checkoutLinkUrl,checkoutReturnReceiptUrl,normalizeCheckoutReturnNotice,canPresentCheckoutReturn,canPreviewCheckoutReturn,checkoutReturnContext,mayDismissCheckoutReturn,returnReceiptSizing,floatingCheckoutGeometry,directTapCheckoutGeometry,IDLE_CHECKOUT_FLOW,checkoutScreenTimeoutMs,checkoutInactivityTimeoutMs,refreshCheckoutNotice,checkoutInactivityAction,enabledCheckoutPages,beginCheckoutFlow,nextCheckoutPage,previousCheckoutPage,canCreateCheckout} from './checkoutFlow.js';
import {checkoutTransactionReceipt,checkoutVendReceipt,enrichCheckoutNoticeReceipt} from './checkoutReceipt.js';
import {DashboardIcon} from './DashboardIcons.jsx';
import {checkoutHowItWorks,checkoutHowItWorksGeometry,formatPricingMoney} from './howItWorks.js';
import {checkoutEventSimpleReview,checkoutEventSimpleReviewGeometry} from './checkoutReview.js';
export {checkoutMoney} from './checkoutFlow.js';

const API=mediaUrl('/api/').replace(/\/$/,'');
const STATION='LOCAL-KIOSK';
function returnNoticeForCheckout(checkout,timeoutMs){
  const notice=normalizeCheckoutReturnNotice(checkout.returnEvent,{stationId:checkout.stationId || STATION,timeoutMs});
  return notice?{...notice,previewDuringCollection:canPreviewCheckoutReturn({directTap:checkout.offer?.touch===false && checkout.offer?.paymentRequired!==false,
    phase:checkout.interaction?.phase,paymentProgress:checkout.paymentProgress,interaction:checkout.interaction,recovering:checkout.recovering})}:null;
}

const CHECKOUT=`/device/stations/${STATION}/checkout`;
// Each preview tab owns its rental. The former shared localStorage namespace is
// intentionally not migrated: selecting a rental from another tab is unsafe.
// sessionStorage keeps the actor, interaction and create key across this tab's reloads.
const STORAGE='chargerent-media-browser-checkout-tab-v1';
const TERMINAL=new Set(['succeeded','declined','cancelled','failed']);
const MOCK_QR_STAGES=new Set(['map']);
const CHECKOUT_STEP_ICONS={rent:'qr',card:'card',scanner:'qr',phone:'phone',charge:'batteryCharging',return:'returnSlot'};
const DECORATIVE_QR_PATTERN=[
  '111111101100001111111','100000101110001000001','101110101001101011101','101110100010101011101','101110101010101011101','100000100111001000001','111111101010101111111',
  '000000001010000000000','101011100011001000111','101101001000001000001','000000111001010110010','100001010010111111011','110010101000000000001','000000001011111110111',
  '111111100000110100011','101110101111010111101','101110100110110101001','101110101010100010000','100000101011111000111','111111101111010111101','111111101101001000001',
];
function MockQrCode({label}) {
  return <svg className="ms-checkout-mock-qr" viewBox="0 0 25 25" role="img" aria-label={label} shapeRendering="crispEdges">
    {DECORATIVE_QR_PATTERN.flatMap((row,y)=>[...row].map((cell,x)=>cell==='1'?<rect key={`${x}-${y}`} x={x+2} y={y+2} width="1" height="1" fill="currentColor"/>:null))}
  </svg>;
}
function stored(key) {try{return sessionStorage.getItem(`${STORAGE}:${key}`);}catch{return null;}}
function remember(key,value) {try{if(value===null)sessionStorage.removeItem(`${STORAGE}:${key}`);else sessionStorage.setItem(`${STORAGE}:${key}`,String(value));}catch{/* The current session still works when storage is disabled. */}}
async function request(path,options={}) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await mediaFetch(`${API}${path}`,{...options,signal:controller.signal,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
    const body=await response.json().catch(()=>({}));
    if(controller.signal.aborted)throw new Error('The connection timed out. Reconnecting to your rental…');
    if(!response.ok){const failure=new Error(body.error?.message || `The media service returned ${response.status}.`);failure.status=response.status;throw failure;}
    return body;
  } catch(failure) {
    if(controller.signal.aborted)throw new Error('The connection timed out. Reconnecting to your rental…');
    throw failure;
  } finally {clearTimeout(timeout);}
}
const post=(path,body)=>request(path,{method:'POST',body:JSON.stringify(body)});
export function useBrowserCheckout({onEvent}) {
  const [actorId]=useState(()=>{const existing=stored('actor');if(existing && /^[a-zA-Z0-9_-]{8,100}$/.test(existing))return existing;const value=`browser_${crypto.randomUUID().replaceAll('-','')}`;remember('actor',value);return value;});
  const [returnEvent,setReturnEvent]=useState(null),[vendEvent,setVendEvent]=useState(null);
  const [offer,setOffer]=useState(null),[interaction,setInteraction]=useState(null),[connected,setConnected]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(''),[recovering,setRecovering]=useState(true);
  const interactionId=useRef(stored('interaction')),createKey=useRef(stored('createKey')),polling=useRef(false),operation=useRef(false),epoch=useRef(0),latestEvent=useRef(onEvent),cursor=useRef(Number(stored('cursor')) || 0),initialEvents=useRef(stored('cursor')!==null);
  useEffect(()=>{latestEvent.current=onEvent;},[onEvent]);
  function accept(value) {setInteraction(value || null);if(value?.id && interactionId.current!==value.id){interactionId.current=value.id;remember('interaction',value.id);}}
  async function refresh() {
    if(MEDIA_HOSTED){setRecovering(false);return;}
    if(polling.current)return;polling.current=true;const readEpoch=epoch.current;
    try {
      const currentOffer=await request(`${CHECKOUT}/offer`);setOffer(currentOffer);
      let result;
      if(interactionId.current){
        try{result=await request(`${CHECKOUT}/interactions/${encodeURIComponent(interactionId.current)}?actorId=${encodeURIComponent(actorId)}`);}
        catch(failure){if(failure.status!==404)throw failure;if(readEpoch!==epoch.current)return;interactionId.current=null;remember('interaction',null);}
      }
      if(!result)result=await request(`${CHECKOUT}/active?actorId=${encodeURIComponent(actorId)}`);
      if(readEpoch!==epoch.current)return;
      accept(result.interaction);setConnected(true);setRecovering(false);
      // First visit establishes a high-water mark; reload resumes the saved cursor.
      try {
        const events=await request(`/device/stations/${STATION}/events?after=${cursor.current}`);
        for(const event of events.events || []){
          if(initialEvents.current && event.stationId===STATION && Date.parse(event.expiresAt)>Date.now() && ['rental_dispensed','charger_returned','rental_failed'].includes(event.type)){if(event.type==='charger_returned')setReturnEvent(event);if(event.type==='rental_dispensed')setVendEvent(event);latestEvent.current?.(event);}
        }
        cursor.current=Number(events.cursor) || cursor.current;remember('cursor',cursor.current);initialEvents.current=true;
      } catch { /* Checkout recovery remains available when the event stream is briefly unavailable. */ }
    } catch {if(readEpoch===epoch.current){setConnected(false);setRecovering(false);}}
    finally{polling.current=false;}
  }
  useEffect(()=>{refresh();const timer=setInterval(refresh,1000);return()=>clearInterval(timer);},[actorId]);
  async function act(action) {
    if(MEDIA_HOSTED)return;
    if(operation.current)return;operation.current=true;epoch.current++;setBusy(action);setError('');
    try {
      let result;
      if(action==='start') {
        if(!connected || !offer?.canRent)throw new Error(offer?.unavailableReason || 'Rentals are temporarily unavailable.');
        if(!createKey.current){createKey.current=crypto.randomUUID();remember('createKey',createKey.current);}
        result=await post(`${CHECKOUT}/interactions`,{actorId,idempotencyKey:createKey.current});
      } else {
        if(!interactionId.current)throw new Error('This rental is no longer available. Please start again.');
        result=await post(`${CHECKOUT}/interactions/${encodeURIComponent(interactionId.current)}/${action}`,{actorId});
      }
      accept(result.interaction);setConnected(true);
    } catch(failure) {setError(failure.message);if(!failure.status || failure.status>=500)setConnected(false);}
    finally{operation.current=false;setBusy('');refresh();}
  }
  function reset() {
    if(operation.current)return;
    if(interaction && !TERMINAL.has(interaction.phase))return;
    epoch.current++;interactionId.current=null;createKey.current=null;remember('interaction',null);remember('createKey',null);setInteraction(null);setError('');setRecovering(true);refresh();
  }
  return {actorId,offer,interaction,returnEvent,vendEvent,connected,error,busy,recovering,start:()=>act('start'),pay:()=>act('pay'),cancel:()=>act('cancel'),reset,refresh};
}

function normalizeCheckoutVendNotice(event,timeoutMs) {
  if(event?.type!=='rental_dispensed')return null;
  const result=normalizeCheckoutReturnNotice({...event,type:'charger_returned'},{timeoutMs});
  return result?{...result,type:'rental_dispensed'}:null;
}
const CUSTOMER_STAGES=new Set(['start','ready','sold_out','page','review','waiting_for_card','authorizing','dispensing','succeeded','declined','cancelled','failed','returning','returned','information','terms','map','out_of_order','loading']);
const LINK_STAGES=new Set(['terms','map']);
const INFORMATION_STAGES=new Set(['information',...LINK_STAGES]);

export function LanguageFlag({language}) {
  const clip=`flag-${useId().replaceAll(':','')}`;
  return <svg viewBox="0 0 60 60" aria-hidden="true"><defs><clipPath id={clip}><circle cx="30" cy="30" r="30"/></clipPath></defs><g clipPath={`url(#${clip})`}>
    {language==='fr'?<><path fill="#002654" d="M0 0h20v60H0z"/><path fill="#fff" d="M20 0h20v60H20z"/><path fill="#ed2939" d="M40 0h20v60H40z"/></>:language==='es'?<><path fill="#aa151b" d="M0 0h60v60H0z"/><path fill="#f1bf00" d="M0 15h60v30H0z"/><path fill="#aa151b" d="M16 25h12v12q-6 7-12 0z"/><path fill="#fff" d="M22 26h5v6h-5zm-5 7h5v5h-5z"/><path fill="#f1bf00" d="M17 26h4v6h-4zm6 7h4v5h-4zM16 22h12v3H16z"/><path fill="#aa151b" d="m17 22-1-3 4 1 2-3 2 3 4-1-1 3z"/></>:<><path fill="#fff" d="M0 0h60v60H0z"/>{Array.from({length:7},(_,i)=><rect key={i} x="0" y={i*120/13} width="60" height={60/13} fill="#b22234"/>)}<path fill="#3c3b6e" d="M0 0h32v32.31H0z"/>{Array.from({length:9},(_,row)=>Array.from({length:row%2?5:6},(_,col)=><polygon key={`${row}-${col}`} transform={`translate(${(col+(row%2?1:.5))*32/6} ${(row+.5)*32.31/9})`} points="0,-1.5 .35,-.48 1.43,-.46 .57,.19 .88,1.21 0,.6 -.88,1.21 -.57,.19 -1.43,-.46 -.35,-.48" fill="#fff"/>))}</>}
  </g></svg>;
}

function FlagPicker({language,languages,label,onChange,disabled=false}) {
  const [open,setOpen]=useState(false),[settled,setSettled]=useState(false);
  const others=languages.filter(key=>key!==language),names={en:'English',fr:'Français',es:'Español'};
  useEffect(()=>{setOpen(false);setSettled(false);},[language,disabled]);
  useEffect(()=>{setSettled(false);if(!open || disabled)return;const timer=setTimeout(()=>setSettled(true),300);return()=>clearTimeout(timer);},[open,disabled,language]);
  const expanded=open && !disabled,canSelect=expanded && settled;
  return <div className={`ms-flag-picker ${expanded?'open':''} ${canSelect?'settled':''}`} style={{'--flag-picker-width':`calc(var(--checkout-pixel) * ${expanded?80+others.length*96:80})`}}>
    {others.map((key,index)=><button type="button" className="ms-language-flag ms-flag-option" key={key} style={{'--flag-distance':index+1}} aria-label={names[key]} aria-hidden={!canSelect} tabIndex={canSelect?0:-1} disabled={!canSelect} onClick={()=>{if(!canSelect)return;setSettled(false);setOpen(false);onChange(key);}}><LanguageFlag language={key}/></button>)}
    <button type="button" className="ms-language-flag ms-flag-selected" aria-label={`${label}: ${names[language]}`} aria-expanded={expanded} disabled={disabled || !others.length} onClick={()=>{setSettled(false);setOpen(value=>!value);}}><LanguageFlag language={language}/></button>
  </div>;
}

// The editor selects a stage explicitly. This uses the customer presentation at
// native canvas dimensions and never creates, pays, cancels or resets a rental.
export function CheckoutPanel({checkout={},previewOnly=false,previewStage,previewPageId,previewLanguage,previewStageChange,previewLanguageChange,stripeUi,height=.32,viewportWidth=1080,viewportHeight=1920,onLanguageChange,returnOnly=false,inactivityTimeoutMs}) {
  const profile=useMemo(()=>{
    let value;try{value=validateStripeUi(stripeUi || defaultStripeUi());}catch{value=defaultStripeUi();}
    if(previewOnly && STRIPE_UI_LANGUAGES.some(item=>item.key===previewLanguage) && !value.enabledLanguages.includes(previewLanguage))value={...value,enabledLanguages:[...value.enabledLanguages,previewLanguage]};
    return value;
  },[stripeUi,previewOnly,previewLanguage]);
  const configuredTimeoutMs=checkoutScreenTimeoutMs(profile);
  const previousTimeout=useRef(configuredTimeoutMs);
  const [selectedLanguage,setSelectedLanguage]=useState(''),[flow,setFlow]=useState({...IDLE_CHECKOUT_FLOW}),[previewConsent,setPreviewConsent]=useState(false),[offerChanged,setOfferChanged]=useState(false),[qrOpen,setQrOpen]=useState(false),[qrImage,setQrImage]=useState(null),[helpQrImage,setHelpQrImage]=useState(null);
  const [returnNotice,setReturnNotice]=useState(()=>returnNoticeForCheckout(checkout,configuredTimeoutMs)),[vendNotice,setVendNotice]=useState(()=>normalizeCheckoutVendNotice(checkout.vendEvent,configuredTimeoutMs)),[noticeNow,setNoticeNow]=useState(Date.now);
  const [documentHidden,setDocumentHidden]=useState(()=>typeof document!=='undefined' && document.hidden),[activityToken,setActivityToken]=useState(0);
  const lastReturn=useRef(checkout.returnEvent?.eventId),lastVend=useRef(checkout.vendEvent?.eventId),shownReturn=useRef(null),shownVend=useRef(null),idlePending=useRef(false);
  const panel=useRef(null);
  useEffect(()=>{
    if(previousTimeout.current===configuredTimeoutMs)return;
    previousTimeout.current=configuredTimeoutMs;
    const now=Date.now();
    setReturnNotice(notice=>refreshCheckoutNotice(notice,now,configuredTimeoutMs));
    setVendNotice(notice=>refreshCheckoutNotice(notice,now,configuredTimeoutMs));
    idlePending.current=false;setActivityToken(value=>value+1);
  },[configuredTimeoutMs]);

  useEffect(()=>{const changed=()=>{setDocumentHidden(document.hidden);setNoticeNow(Date.now());};document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
  const controlled=previewOnly && (!!previewStage || !!previewPageId);
  const selectedStage=previewPageId?'page':previewStage==='recovering'?'dispensing':CUSTOMER_STAGES.has(previewStage)?previewStage:'start';
  useEffect(()=>{setPreviewConsent(false);},[selectedStage,previewPageId,previewLanguage]);
  const language=resolveStripeLanguage(profile,(previewOnly && previewLanguage) || selectedLanguage || profile.defaultLanguage);
  const pages=enabledCheckoutPages(profile),navigation=profile.navigation || {};
  const {offer,interaction,error,busy}=checkout;
  const directTap=offer?.touch===false && offer?.paymentRequired!==false;
  const connected=previewOnly || checkout.connected===true,recovering=!previewOnly && checkout.recovering;
  const previewPhase=selectedStage==='waiting_for_card'?'awaiting_payment':selectedStage==='returned'?'succeeded':selectedStage;
  const phase=previewOnly?(['awaiting_payment','authorizing','dispensing',...TERMINAL].includes(previewPhase)?previewPhase:'idle'):interaction?.phase || 'idle';
  const ended=TERMINAL.has(phase),returned=phase==='succeeded' && (interaction?.moneyStatus==='refunded' || interaction?.settlement?.status==='refunded');
  const unavailable=!connected || offer?.canRent!==true;
  const profileSignature=JSON.stringify({...profile,screenTimeoutSeconds:undefined});
  const quoteKey=JSON.stringify([offer?.amountCents,offer?.depositAmountCents,offer?.rentalFeeCents,offer?.refundAmountCents,offer?.currency]);
  const quoteRef=useRef(quoteKey);
  useEffect(()=>{setFlow({...IDLE_CHECKOUT_FLOW});setOfferChanged(false);setQrOpen(false);},[profileSignature]);
  useEffect(()=>{onLanguageChange?.(language);},[language,onLanguageChange]);
  useEffect(()=>{if(quoteRef.current!==quoteKey){quoteRef.current=quoteKey;if(flow.step==='review'){setFlow(value=>({...value,consent:false}));setOfferChanged(true);}}},[quoteKey,flow.step]);
  useEffect(()=>{
    const event=checkout.returnEvent;if(!event)return;
    if(event.eventId===lastReturn.current){setReturnNotice(notice=>enrichCheckoutNoticeReceipt(notice,event));return;}
    lastReturn.current=event.eventId;const next=returnNoticeForCheckout(checkout,configuredTimeoutMs);
    if(next){setReturnNotice(previous=>!previous || Date.parse(next.occurredAt)>=Date.parse(previous.occurredAt)?next:previous);setVendNotice(null);}
    setNoticeNow(Date.now());
  },[checkout.returnEvent,configuredTimeoutMs]);
  useEffect(()=>{const event=checkout.vendEvent;if(!event)return;if(event.eventId===lastVend.current){setVendNotice(notice=>enrichCheckoutNoticeReceipt(notice,event));return;}lastVend.current=event.eventId;const next=normalizeCheckoutVendNotice(event,configuredTimeoutMs);if(next){setVendNotice(next);setReturnNotice(null);}setNoticeNow(Date.now());},[checkout.vendEvent,configuredTimeoutMs]);
  useEffect(()=>{if(phase!=='idle')setFlow({...IDLE_CHECKOUT_FLOW});setQrOpen(false);},[phase]);
  const shownFlow=controlled?{...IDLE_CHECKOUT_FLOW,step:selectedStage,pageId:previewPageId}:flow;
  const flowPages=controlled?profile.pages.filter(page=>page.enabled!==false || page.id===previewPageId):pages;
  const currentPage=phase==='idle' && shownFlow.step==='page'?(controlled?profile.pages:pages).find(page=>page.id===shownFlow.pageId):null;
  const localStage=shownFlow.step==='page' && !currentPage?'review':shownFlow.step;
  const auxiliary=INFORMATION_STAGES.has(localStage) && phase==='idle';
  const outOfOrder=!previewOnly && phase==='idle' && ['start','ready'].includes(localStage) && (!connected || !offer || offer.controllerOnline===false || directTap && (checkout.availabilityFresh===false || offer.reader?.status==='disconnected'));
  const restoring=recovering || (!previewOnly && !connected && interaction && !ended);
  const returnSafe=canPresentCheckoutReturn({flow,phase,busy,recovering:restoring,suppressed:documentHidden || checkout.noticeSuppressed});
  const returnContext=checkoutReturnContext({flow,phase,interaction,returnEvent:returnNotice});
  const returnPreview=returnNotice?.previewDuringCollection && !documentHidden && !checkout.noticeSuppressed &&
    canPreviewCheckoutReturn({directTap,phase,paymentProgress:checkout.paymentProgress,interaction,recovering:restoring,includeCancellation:true});
  const showingReturn=!controlled && returnNotice?.noticeExpiresAt>noticeNow && (returnSafe || returnPreview);
  const showingVend=!controlled && !showingReturn && vendNotice?.noticeExpiresAt>noticeNow && returnSafe;
  const noticePresentation=showingReturn || (controlled && selectedStage==='returned');
  const transactionStage=phase==='awaiting_payment'?'waiting_for_card':phase==='succeeded' && (!Number.isSafeInteger(interaction?.slot) || interaction.slot<=0)?'failed':returned?'returned':CUSTOMER_STAGES.has(phase)?phase:'dispensing';
  const soldOut=phase==='idle' && ['start','ready'].includes(localStage) && !outOfOrder && offer?.controllerOnline!==false && offer?.availableCount===0 && checkout.availabilityFresh!==false;
  const stage=controlled?(directTap && ['start','ready','waiting_for_card'].includes(selectedStage)?'touch_ready':selectedStage):showingReturn?'returned':showingVend?'succeeded':restoring?transactionStage:auxiliary?localStage:outOfOrder?'out_of_order':soldOut?'sold_out':phase==='idle'?(directTap?'touch_ready':localStage):transactionStage;
  const inactivityAction=directTap || showingReturn || showingVend?'none':checkoutInactivityAction({stage,phase,busy,previewOnly,returnOnly,suppressed:checkout.noticeSuppressed || restoring});
  const activeInactivityTimeoutMs=checkoutInactivityTimeoutMs(profile,phase,inactivityTimeoutMs);
  useEffect(()=>{if(showingReturn){if(shownReturn.current?.eventId!==returnNotice.eventId)shownReturn.current={eventId:returnNotice.eventId,context:returnContext};setQrOpen(false);}},[showingReturn,returnNotice?.eventId,returnContext]);
  useEffect(()=>{if(showingVend){if(shownVend.current?.eventId!==vendNotice.eventId)shownVend.current={eventId:vendNotice.eventId,context:returnContext};setQrOpen(false);}},[showingVend,vendNotice?.eventId,returnContext]);
  useEffect(()=>{if(!returnNotice && !vendNotice)return;const timer=setInterval(()=>setNoticeNow(Date.now()),250);return()=>clearInterval(timer);},[returnNotice,vendNotice]);
  useEffect(()=>{
    if(!returnNotice || returnNotice.noticeExpiresAt>noticeNow)return;
    if(mayDismissCheckoutReturn(shownReturn.current,returnNotice.eventId,returnContext,returnSafe)){setFlow({...IDLE_CHECKOUT_FLOW});if(!returnOnly && !previewOnly && ended)checkout.reset?.();}
    setReturnNotice(null);setQrOpen(false);
  },[returnNotice,noticeNow,returnSafe,returnContext,ended,previewOnly,returnOnly]);
  useEffect(()=>{if(!vendNotice || vendNotice.noticeExpiresAt>noticeNow)return;if(mayDismissCheckoutReturn(shownVend.current,vendNotice.eventId,returnContext,returnSafe)){setFlow({...IDLE_CHECKOUT_FLOW});if(!returnOnly && !previewOnly && ended)checkout.reset?.();}setVendNotice(null);setQrOpen(false);},[vendNotice,noticeNow,returnSafe,returnContext,ended,previewOnly,returnOnly]);
  const eventReview=stage==='review' && !currentPage?checkoutEventSimpleReview(checkout,language):null;
  const baseGeometry=checkoutHowItWorksGeometry(floatingCheckoutGeometry(viewportWidth,viewportHeight,returnOnly ? .16 : height),viewportWidth,viewportHeight,stage);
  const touchGeometry=directTapCheckoutGeometry(baseGeometry,viewportWidth,viewportHeight,stage,directTap);
  const geometry=checkoutEventSimpleReviewGeometry(touchGeometry,viewportWidth,viewportHeight,eventReview),idle=stage==='start' || stage==='loading';
  const receiptSizing=returnReceiptSizing(geometry.expandedHeight,geometry.scale);
  useEffect(()=>{
    for(const scroller of panel.current?.querySelectorAll('.ms-checkout-main,.ms-checkout-actions') || [])scroller.scrollTop=0;
  },[stage,currentPage?.id]);
  const currency=interaction?.currency || offer?.currency || 'usd';
  const money=value=>checkoutMoney(value,currency,language);
  const values=noticePresentation || showingVend?{deposit:'—',fee:'—',refund:'—',slot:(showingVend?vendNotice:returnNotice)?.slot ?? interaction?.returnSlot ?? interaction?.slot ?? '—',available:'—'}:{deposit:money(interaction?.amountCents ?? offer?.depositAmountCents ?? offer?.amountCents),fee:money(returned?interaction?.settlement?.chargedAmountCents:offer?.rentalFeeCents),refund:money(returned?interaction?.settlement?.refundedAmountCents:offer?.refundAmountCents),slot:interaction?.returnSlot ?? interaction?.slot ?? '—',available:offer?.availableCount ?? '—'};
  const eventCharge=formatPricingMoney(offer?.buyPriceCents ?? offer?.pricing?.buyPriceCents ?? offer?.depositAmountCents ?? offer?.amountCents ?? null,currency.toUpperCase(),language) || '—';
  const eventDeadline=eventReturnDeadline(offer);
  const planCode=offer?.planCode || offer?.pricing?.planCode;
  const useRentReturnCopy=['ready','touch_ready'].includes(stage) || directTap && stage==='waiting_for_card';
  const text=key=>useRentReturnCopy?stripeRentReturnText(profile,language,key,planCode,!directTap,{...values,eventCharge,overdueDays:eventDeadline.days ?? '—'}):stripeText(profile,language,key,{...values,eventCharge,overdueDays:eventDeadline.days ?? '—'});
  const pageText=key=>stripePageText(profile,currentPage,language,key,{...values,eventCharge,overdueDays:eventDeadline.days ?? '—'});
  const liveTerminalEnabled=checkout.liveTerminalEnabled===true;
  const presentationStage=liveTerminalEnabled && !directTap && stage==='authorizing'?'waiting_for_card':stage;
  const eventSimple=(offer?.planCode || offer?.pricing?.planCode)==='EVENT_SIMPLE';
  const borrowingScreen=['touch_ready','waiting_for_card'].includes(presentationStage) && (directTap || eventSimple);
  const title=eventReview?.title ?? (currentPage?pageText('title'):borrowingScreen?text(directTap?'touchBorrowTitle':'eventBorrowTitle'):text(`${presentationStage}.title`)),body=eventReview || borrowingScreen?'':currentPage?pageText('body'):text(`${presentationStage}.body`);
  const reviewPricing=liveTerminalEnabled && Array.isArray(offer?.pricingLines) && offer.pricingLines.length
    ? [`${values.deposit} deposit`,...offer.pricingLines].join(' · ')
    : text('pricing');
  const themeStyle={...Object.fromEntries(Object.entries(profile.theme).map(([key,value])=>[`--checkout-${key}`,value])),'--checkout-pixel':`calc(var(--ms-preview-pixel) * ${geometry.scale*(idle?1:geometry.contentScale)})`};
  const px=value=>`calc(var(--ms-preview-pixel) * ${value})`;
  const cardStyle={...themeStyle,'--checkout-card-opacity':`${profile.cardOpacityPercent}%`,'--return-qr-size':px(receiptSizing.qr),'--return-done-height':px(receiptSizing.done),'--return-gap':px(receiptSizing.gap),width:px(idle?geometry.idleWidth:geometry.expandedWidth),height:px(idle?geometry.idleHeight:geometry.expandedHeight),bottom:px(geometry.bottom),borderRadius:px(geometry.radius)};
  const canSubmit=!previewOnly && canCreateCheckout(flow,{connected,available:offer?.canRent,busy,recovering,quoteKey});
  const link=stage==='succeeded'?(showingVend?checkoutTransactionReceipt(vendNotice)?.url:checkoutVendReceipt(interaction)?.url):stage==='returned'?checkoutReturnReceiptUrl(profile,showingReturn?returnNotice:null,interaction):LINK_STAGES.has(stage)?checkoutLinkUrl(profile,stage,interaction,checkout,language):null;
  const mockLink=!link && MOCK_QR_STAGES.has(stage);
  const receiptPreview=previewOnly && checkout.receiptPreview===true && ['succeeded','returned'].includes(stage) && !link;
  useEffect(()=>{
    if(!directTap || stage!=='succeeded')return;
    const root=panel.current,group=root?.querySelector('.ms-checkout-vend-return');
    const hint=group?.querySelector('small'),caption=root?.querySelector('.ms-return-receipt p');
    if(!group || !hint || !caption)return;
    let active=true;
    const baseline=node=>{
      const marker=node.ownerDocument.createElement('span');
      marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';
      node.append(marker);const top=marker.getBoundingClientRect().top;marker.remove();return top;
    };
    const align=()=>{
      if(!active || !hint.textContent.trim())return;
      const scale=root.getBoundingClientRect().height/root.offsetHeight;
      if(!Number.isFinite(scale) || scale<=0)return;
      const delta=(baseline(caption)-baseline(hint))/scale;
      if(Math.abs(delta)<.5)return;
      const gap=parseFloat(getComputedStyle(group).marginTop)||0;
      group.style.marginTop=`${Math.max(0,gap+delta)}px`;
    };
    const observer=new ResizeObserver(align);
    for(const node of [root,hint,caption])observer.observe(node);
    align();document.fonts?.ready.then(align);
    return()=>{active=false;observer.disconnect();group.style.removeProperty('margin-top');};
  },[directTap,stage,profile,language,qrImage,link,receiptPreview,viewportWidth,viewportHeight,geometry.expandedHeight]);
  const helpStationId=String(checkout.stationId || STATION).trim().toUpperCase(),helpTemplate=profile.links?.help || '',helpLink=directTap?customerHelpTermsUrl(helpTemplate,helpStationId,offer?.planCode || offer?.pricing?.planCode,language):customerHelpUrl(helpTemplate,helpStationId);
  const tapToRent=directTap && !currentPage && ['touch_ready','waiting_for_card'].includes(stage);
  const portraitTap=tapToRent && viewportHeight>viewportWidth;
  const footerKeys=directTapFooterKeys(offer?.gatewayOption || offer?.pricing?.gatewayOption);
  const freeDay=text('eventFreeDay'),freeBreak=freeDay.indexOf(' ');
  const showHelpQr=!currentPage && (directTap?tapToRent:stage==='ready' || stage==='sold_out') && !!helpLink;
  const helpInOwnColumn=!directTap && showHelpQr && checkoutUsesColumns(viewportWidth,viewportHeight,returnOnly ? .16 : height);
  useEffect(()=>{let active=true;setQrImage(null);setQrOpen(false);if(link)stripeQrDataUrl(link).then(value=>{if(active)setQrImage(value);}).catch(()=>{});return()=>{active=false;};},[link]);
  useEffect(()=>{let active=true;setHelpQrImage(null);if(helpLink)(directTap?stripeQrDataUrl(helpLink):customerHelpQrDataUrl(helpTemplate,helpStationId)).then(value=>{if(active)setHelpQrImage(value);}).catch(()=>{});return()=>{active=false;};},[helpLink,helpTemplate,helpStationId,directTap]);
  function selectFlow(value){if(controlled){previewStageChange?.(value.step,value.pageId);return;}setFlow(value);}
  function begin(){setOfferChanged(false);selectFlow(beginCheckoutFlow(pages));}
  function cancelPayment(){if(controlled){previewStageChange?.('cancelled');return;}if(!previewOnly)checkout.cancel?.();}
  function done(){if(controlled){previewStageChange?.('start');return;}const safe=(!showingReturn || mayDismissCheckoutReturn(shownReturn.current,returnNotice?.eventId,returnContext,returnSafe)) && (!showingVend || mayDismissCheckoutReturn(shownVend.current,vendNotice?.eventId,returnContext,returnSafe));setReturnNotice(null);setVendNotice(null);setQrOpen(false);if(!safe)return;setFlow({...IDLE_CHECKOUT_FLOW});setOfferChanged(false);if(!returnOnly && !previewOnly && ended)checkout.reset?.();}
  function returnToStart(){setQrOpen(false);setOfferChanged(false);selectFlow({...IDLE_CHECKOUT_FLOW});}
  function noteActivity(){idlePending.current=false;setActivityToken(value=>value+1);const now=Date.now();if(showingReturn)setReturnNotice(notice=>refreshCheckoutNotice(notice,now,configuredTimeoutMs));if(showingVend)setVendNotice(notice=>refreshCheckoutNotice(notice,now,configuredTimeoutMs));}
  function back(){setQrOpen(false);if(auxiliary)selectFlow({...IDLE_CHECKOUT_FLOW,step:flow.returnStep || 'ready'});else selectFlow(previousCheckoutPage(shownFlow,flowPages));}
  function showInformation(step){selectFlow({step,pageId:null,consent:false,returnStep:flow.step==='ready'?'ready':'start'});}
  function changeLanguage(value){if(controlled){previewLanguageChange?.(value);return;}setSelectedLanguage(value);setFlow(value=>({...value,consent:false}));}
  useEffect(()=>{
    if(inactivityAction==='none' || !Number.isFinite(activeInactivityTimeoutMs) || activeInactivityTimeoutMs<=0){idlePending.current=false;return;}
    if(idlePending.current)return;
    const timer=setTimeout(()=>{
      if(inactivityAction==='start')returnToStart();
      else if(inactivityAction==='finish')done();
      else {
        idlePending.current=true;
        if(inactivityAction==='cancel')checkout.cancel?.();
      }
    },activeInactivityTimeoutMs);
    return()=>clearTimeout(timer);
  },[inactivityAction,activeInactivityTimeoutMs,stage,currentPage?.id,activityToken]);
  useEffect(()=>{
    if(!idlePending.current)return;
    if(inactivityAction==='start'){idlePending.current=false;returnToStart();}
    else if(inactivityAction==='finish'){idlePending.current=false;done();}
    else if(inactivityAction==='cancel' && !busy){checkout.cancel?.();}
  },[inactivityAction,busy,phase,stage]);
  const action=(label,onClick,{secondary=false,disabled=false,key=label,presentationOnly=false}={})=><button key={key} type="button" className={secondary?'ms-checkout-secondary':'ms-checkout-primary'} disabled={disabled} onClick={()=>{if(!controlled || presentationOnly)onClick?.();}}>{label}</button>;
  const button=(key,onClick,options={})=>action(text(key),onClick,{...options,key});
  const busyMessage=key=><div className="ms-checkout-progress" role="status"><span>{text(key)}</span><i/></div>;
  const instructions=checkoutHowItWorks(checkout,language,{title:text('information.chargeTitle'),body:text('information.chargeBody')});
  const rateLines=offer?.pricingLines?.length?offer.pricingLines:instructions.cards[0].lines;
  const rentReturnPricing=rentReturnOverrides(profile,language,planCode,!directTap).pricing;
  const tapPricingLines=rentReturnPricing!==undefined?stripeRentReturnText(profile,language,'pricing',planCode,!directTap,{...values,eventCharge,overdueDays:eventDeadline.days ?? '—',rateSummary:rateLines.join('\n')}).split('\n')
    :eventSimple?[freeDay,text(eventDeadline.key)]:rateLines;
  const howItWorksStep=(key,index)=><div className="ms-checkout-step" key={key}>
    <div className="ms-checkout-step-header"><span className="ms-checkout-step-number">{String(index+1).padStart(2,'0')}</span><span className="ms-checkout-step-icon" data-step-icon={CHECKOUT_STEP_ICONS[key]}><DashboardIcon name={CHECKOUT_STEP_ICONS[key]}/></span></div>
    <div className="ms-checkout-step-copy"><strong>{instructions.cards[index].title}</strong>{instructions.cards[index].lines.map((line,lineIndex)=><p key={lineIndex}>{line}</p>)}</div>
  </div>;
  function renderActions(){
    if(directTap && !['succeeded','returned'].includes(stage))return null;
    if(stage==='sold_out')return button('return',()=>selectFlow({step:'returning',pageId:null,consent:false,returnAfter:Date.now()}),{secondary:true,presentationOnly:true});
    if(stage==='ready')return <>{button('rent',begin,{disabled:!!busy || unavailable,presentationOnly:true})}<div className="ms-checkout-row">{button('return',()=>selectFlow({step:'returning',pageId:null,consent:false,returnAfter:Date.now()}),{secondary:true,disabled:!!busy,presentationOnly:true})}{button('cancel',done,{secondary:true,disabled:!!busy,presentationOnly:true})}</div><div className="ms-checkout-utilities">{navigation.map!==false && button('map',()=>showInformation('map'),{secondary:true,presentationOnly:true})}{navigation.terms!==false && button('termsButton',()=>showInformation('terms'),{secondary:true,presentationOnly:true})}{navigation.information!==false && button('information',()=>showInformation('information'),{secondary:true,presentationOnly:true})}</div></>;
    if(currentPage)return <div className="ms-checkout-row">{action(pageText('nextLabel') || text('continue'),()=>selectFlow(nextCheckoutPage(shownFlow,flowPages)),{disabled:!!busy,presentationOnly:true})}{button('back',back,{secondary:true,disabled:!!busy,presentationOnly:true})}</div>;
    if(stage==='review')return <>{offerChanged && <p className="ms-checkout-error" role="status">{text('offerChanged')}</p>}<label className="ms-checkout-consent"><input type="checkbox" checked={controlled?previewConsent:flow.consent} disabled={!!busy} onChange={event=>{if(controlled)setPreviewConsent(event.target.checked);else selectFlow({...flow,consent:event.target.checked,quoteKey});}}/><span>{text('consent')}</span></label><div className="ms-checkout-row">{button(busy==='start'?'starting':'continue',()=>{if(controlled)previewStageChange?.('waiting_for_card');else if(canSubmit)checkout.start?.();},{disabled:controlled?!previewConsent:!canSubmit,presentationOnly:controlled})}{button('back',back,{secondary:true,disabled:!!busy,presentationOnly:true})}</div></>;
    if(stage==='waiting_for_card')return <>{liveTerminalEnabled && !restoring && busyMessage('tap')}{button('cancel',cancelPayment,{secondary:true,disabled:!!busy || !connected,presentationOnly:controlled})}</>;
    if(stage==='authorizing')return <>{!restoring && busyMessage(liveTerminalEnabled?'tap':'authorizing.body')}{button('cancel',cancelPayment,{secondary:true,disabled:!connected,presentationOnly:controlled})}</>;
    if(stage==='dispensing')return busyMessage('waitingSlot');
    if(stage==='loading')return busyMessage('connecting');
    if(stage==='out_of_order')return null;
    if(INFORMATION_STAGES.has(stage))return <>{stage!=='terms' && link && button('openLink',()=>setQrOpen(true),{disabled:!qrImage,presentationOnly:true})}{button('back',back,{secondary:true,presentationOnly:true})}</>;
    if(stage==='returning')return <>{busyMessage('returnPending')}{button('cancel',()=>selectFlow({...IDLE_CHECKOUT_FLOW,step:'ready'}),{secondary:true,disabled:!!busy,presentationOnly:true})}</>;
    if(stage==='returned' || stage==='succeeded')return <><div className="ms-return-receipt" aria-label={text('receipt.title')}>{link && qrImage?<><img className="ms-checkout-qr" src={qrImage} alt={text('receiptScan')}/><p>{text('receiptScan')}</p></>:receiptPreview?<><span className="ms-return-qr-preview" data-receipt-preview="true"><MockQrCode label={text('receiptScan')}/></span><p>{text('receiptScan')}</p></>:<p role="status" aria-live="polite">{text('receiptPending')}</p>}</div>{!directTap && button('done',done,{disabled:!!busy,presentationOnly:true})}</>;
    if(['declined','cancelled','failed'].includes(stage))return button('done',done,{disabled:!!busy,presentationOnly:true});
    return null;
  }
  const settlementKey=({voided:'settlementVoided',refunded:'settlementRefunded',captured:'settlementCaptured',authorized:'settlementAuthorized'})[interaction?.moneyStatus];
  const overlayTarget=panel.current?.closest('[data-kiosk-viewport],.ms-screen') || panel.current?.parentElement;
  const flags=!directTap && navigation.language!==false?<FlagPicker language={language} languages={profile.enabledLanguages} label={text('language')} onChange={changeLanguage} disabled={!!busy}/>:null;
  const helpTitle=text(directTap?'helpTermsTitle':'helpTitle').trim().replace(/\s*[?？]\s*$/u,'');
  const helpCard=showHelpQr?<div className="ms-checkout-help" data-help-url={helpLink}><div className="ms-checkout-help-heading"><strong className="ms-checkout-help-title">{helpTitle}</strong>{!directTap && <span className="ms-checkout-help-mark" aria-hidden="true">?</span>}</div>{helpQrImage?<img className="ms-checkout-help-qr" src={helpQrImage} alt={`${directTap?'Help and rental terms':'Help'} QR code for ${helpStationId}`}/>:<span className="ms-checkout-help-pending" aria-hidden="true"/>}<span className="ms-checkout-help-scan">{text('helpScan')}</span></div>:null;
  const dialog=qrOpen && overlayTarget?createPortal(<div className="ms-checkout-dialog-shade" role="presentation" style={themeStyle} onPointerDown={noteActivity} onKeyDown={noteActivity}><section role="dialog" aria-modal="true" aria-label={title} className="ms-checkout-dialog"><h2>{title}</h2>{qrImage && <img src={qrImage} alt={title}/>}<p className="ms-checkout-dialog-url">{link}</p><button type="button" onClick={()=>setQrOpen(false)}>{text('back')}</button></section></div>,overlayTarget):null;
  if(returnOnly && !showingReturn && !showingVend && !(controlled && ['returned','succeeded'].includes(stage)))return <div className="ms-checkout-viewport" style={themeStyle}/>;
  return <div className="ms-checkout-viewport" style={themeStyle}><section ref={panel} className={`ms-checkout-panel ${stage} ${directTap?'direct-tap':''} ${portraitTap?'portrait-tap':''} ${idle?'start':''} ${checkoutUsesColumns(viewportWidth,viewportHeight,stage==='information' || eventReview?geometry.expandedHeight/viewportHeight:returnOnly ? .16 : height)?'compact':''} ${helpInOwnColumn?'help-column':''}`} style={{...cardStyle,...(portraitTap?{borderRadius:px(28*geometry.scale)}:{})}} lang={language} aria-label="Floating payment card" data-receipt-transaction={link?(showingVend?vendNotice:showingReturn?returnNotice:interaction)?.transactionId:undefined} data-checkout-phase={stage} data-viewport-orientation={viewportWidth>viewportHeight?'landscape':'portrait'} data-language-enabled={!directTap && navigation.language!==false} data-floating-state={idle?'idle':'expanded'} data-inactivity-timeout-ms={activeInactivityTimeoutMs} onPointerDown={noteActivity} onKeyDown={noteActivity}>
    {idle?<div className="ms-idle-actions">{button('start',()=>selectFlow({step:'ready',pageId:null,consent:false}),{disabled:stage==='loading' || !!busy,presentationOnly:true})}{flags}</div>:<>
    {flags && <div className="ms-checkout-language-corner">{flags}</div>}
    {tapToRent && <h2 className="ms-checkout-tap-heading">{title}</h2>}
    <div className="ms-checkout-main" key={`copy-${stage}-${currentPage?.id || ''}`}>{!tapToRent && <h2>{title}</h2>}{stage==='returned' && <p className="ms-return-slot">{text('returnSlot')}</p>}{body && stage!=='information' && !(directTap && stage==='succeeded') && (!LINK_STAGES.has(stage) || link || mockLink) && <p className="ms-checkout-body">{body}</p>}
      {stage==='information' && <><div className="ms-how-it-works-steps" data-gateway-step={instructions.gateway}>{[instructions.gateway,'charge','return'].map(howItWorksStep)}</div><p className="ms-how-it-works-bank">{instructions.footer}</p></>}
      {stage==='review' && (eventReview?<div className="ms-event-simple-review">{eventReview.paragraphs.map((paragraph,index)=><p key={index} className={index===3?'ms-review-bank':undefined}>{paragraph}</p>)}</div>:<><p className="ms-checkout-pricing">{reviewPricing}</p><p className="ms-checkout-terms">{text('terms')}</p></>)}
      {tapToRent && <p className="ms-checkout-pricing">{tapPricingLines.map((line,index)=><span key={index} className={eventSimple && index===0?'ms-checkout-free-day':undefined}>{portraitTap && eventSimple && index===0 && freeBreak>0 && rentReturnPricing===undefined?<><strong className="ms-checkout-free-emphasis">{freeDay.slice(0,freeBreak)}</strong>{freeDay.slice(freeBreak)}</>:line}</span>)}</p>}
      {portraitTap && <div className="ms-checkout-stacked-return"><p className="ms-checkout-return-instruction">{text('returnAnySlot')}</p><p className="ms-checkout-terms">{text('returnConfirmationHint')}</p></div>}
      {directTap && !portraitTap && helpCard}
      {directTap && stage==='succeeded' && <div className="ms-checkout-vend-return"><DashboardIcon name="returnSlot"/><p>{text('returnAnySlot')}</p><small>{text('returnConfirmationHint')}</small></div>}
      {!directTap && stage==='sold_out' && <p className="ms-checkout-body">{text('returnAnySlot')}</p>}
      {stage==='ready' && unavailable && <p className="ms-reader-caption">{text(offer?.reader?.status==='disconnected'?'readerUnavailable':'unavailable')}</p>}
      {LINK_STAGES.has(stage) && (link?(qrImage?<img className="ms-checkout-qr" src={qrImage} alt={title}/>:<p className="ms-checkout-terms">{text('connecting')}</p>):mockLink?<MockQrCode label={text('mockQr')}/>:<p className="ms-checkout-terms">{text('linkUnavailable')}</p>)}
      {!noticePresentation && !previewOnly && error && connected && <p className="ms-checkout-error" role="alert">{text(stage==='returning'?'returnPending':'errorGeneric')}</p>}
      {!noticePresentation && !previewOnly && !connected && !recovering && <p className="ms-checkout-error" role="status">{text(stage==='returning'?'returnPending':'connectionLost')}</p>}
      {!noticePresentation && !showingVend && !['succeeded','returned'].includes(stage) && phase!=='idle' && settlementKey && !auxiliary && <p className="ms-checkout-settlement">{text(settlementKey)}</p>}
      {!directTap && !helpInOwnColumn && helpCard}
    </div>
    {(helpInOwnColumn || portraitTap) && <div className="ms-checkout-help-zone">{helpCard}</div>}
    <div className="ms-checkout-actions" key={`actions-${stage}-${currentPage?.id || ''}`}>{directTap && !portraitTap && (tapToRent || stage==='sold_out') && <><DashboardIcon name="returnSlot" className="ms-checkout-return-icon"/><p className="ms-checkout-return-instruction">{text('returnAnySlot')}</p><p className="ms-checkout-terms">{text('returnConfirmationHint')}</p></>}{renderActions()}</div>{tapToRent && <div className={`ms-checkout-tap-footer${footerKeys.length>1?' has-upfront':''}`}>{footerKeys.map(key=><p key={key} className={key==='touchConsent'?'ms-checkout-tap-consent':'ms-checkout-tap-upfront'}>{text(key)}</p>)}</div>}</>}
  </section>{dialog}</div>;
}
