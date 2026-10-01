import {MEDIA_HOSTED,mediaUrl,mediaFetch} from './mediaApi.js';
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import {customerHelpQrDataUrl,customerHelpUrl,stripeQrDataUrl} from './stripeQr.js';

import {STRIPE_UI_LANGUAGES,defaultStripeUi,validateStripeUi,stripeText,stripePageText,resolveStripeLanguage} from './stripeUi.js';
import {checkoutMoney,checkoutUsesColumns,checkoutLinkUrl,checkoutReturnReceiptUrl,normalizeCheckoutReturnNotice,canPresentCheckoutReturn,checkoutReturnContext,mayDismissCheckoutReturn,returnReceiptSizing,floatingCheckoutGeometry,IDLE_CHECKOUT_FLOW,enabledCheckoutPages,beginCheckoutFlow,nextCheckoutPage,previousCheckoutPage,canCreateCheckout} from './checkoutFlow.js';
export {checkoutMoney} from './checkoutFlow.js';

const API=mediaUrl('/api/').replace(/\/$/,'');
const STATION='LAB-US8004';
const CHECKOUT=`/device/stations/${STATION}/checkout`;
// Each preview tab owns its rental. The former shared localStorage namespace is
// intentionally not migrated: selecting a rental from another tab is unsafe.
// sessionStorage keeps the actor, interaction and create key across this tab's reloads.
const STORAGE='chargerent-media-browser-checkout-tab-v1';
const TERMINAL=new Set(['succeeded','declined','cancelled','failed']);
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
  const [returnEvent,setReturnEvent]=useState(null);
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
          if(initialEvents.current && event.stationId===STATION && Date.parse(event.expiresAt)>Date.now() && ['rental_dispensed','charger_returned','rental_failed'].includes(event.type)){if(event.type==='charger_returned')setReturnEvent(event);latestEvent.current?.(event);}
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
  return {actorId,offer,interaction,returnEvent,connected,error,busy,recovering,start:()=>act('start'),pay:()=>act('pay'),cancel:()=>act('cancel'),reset,refresh};
}

const CUSTOMER_STAGES=new Set(['start','ready','page','review','waiting_for_card','authorizing','dispensing','succeeded','declined','cancelled','failed','recovering','returning','returned','information','terms','map','out_of_order','loading']);
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
export function CheckoutPanel({checkout={},previewOnly=false,previewStage,previewPageId,previewLanguage,previewStageChange,previewLanguageChange,stripeUi,height=.32,viewportWidth=1080,viewportHeight=1920,onLanguageChange,returnOnly=false}) {
  const profile=useMemo(()=>{
    let value;try{value=validateStripeUi(stripeUi || defaultStripeUi());}catch{value=defaultStripeUi();}
    if(previewOnly && STRIPE_UI_LANGUAGES.some(item=>item.key===previewLanguage) && !value.enabledLanguages.includes(previewLanguage))value={...value,enabledLanguages:[...value.enabledLanguages,previewLanguage]};
    return value;
  },[stripeUi,previewOnly,previewLanguage]);
  const [selectedLanguage,setSelectedLanguage]=useState(''),[flow,setFlow]=useState({...IDLE_CHECKOUT_FLOW}),[offerChanged,setOfferChanged]=useState(false),[qrOpen,setQrOpen]=useState(false),[qrImage,setQrImage]=useState(null),[helpQrImage,setHelpQrImage]=useState(null);
  const [returnNotice,setReturnNotice]=useState(()=>normalizeCheckoutReturnNotice(checkout.returnEvent)),[noticeNow,setNoticeNow]=useState(Date.now);
  const [documentHidden,setDocumentHidden]=useState(()=>typeof document!=='undefined' && document.hidden);
  const lastReturn=useRef(checkout.returnEvent?.eventId),shownReturn=useRef(null);
  const panel=useRef(null);
  useEffect(()=>{const changed=()=>{setDocumentHidden(document.hidden);setNoticeNow(Date.now());};document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
  const controlled=previewOnly && (!!previewStage || !!previewPageId);
  const selectedStage=previewPageId?'page':CUSTOMER_STAGES.has(previewStage)?previewStage:'start';
  const language=resolveStripeLanguage(profile,(previewOnly && previewLanguage) || selectedLanguage || profile.defaultLanguage);
  const pages=enabledCheckoutPages(profile),navigation=profile.navigation || {};
  const {offer,interaction,error,busy}=checkout;
  const connected=previewOnly || checkout.connected===true,recovering=!previewOnly && checkout.recovering;
  const previewPhase=selectedStage==='waiting_for_card'?'awaiting_payment':selectedStage==='returned'?'succeeded':selectedStage;
  const phase=previewOnly?(['awaiting_payment','authorizing','dispensing',...TERMINAL].includes(previewPhase)?previewPhase:'idle'):interaction?.phase || 'idle';
  const ended=TERMINAL.has(phase),returned=phase==='succeeded' && (interaction?.moneyStatus==='refunded' || interaction?.settlement?.status==='refunded');
  const unavailable=!connected || offer?.canRent!==true;
  const profileSignature=JSON.stringify(profile);
  const quoteKey=JSON.stringify([offer?.amountCents,offer?.depositAmountCents,offer?.rentalFeeCents,offer?.refundAmountCents,offer?.currency]);
  const quoteRef=useRef(quoteKey);
  useEffect(()=>{setFlow({...IDLE_CHECKOUT_FLOW});setOfferChanged(false);setQrOpen(false);},[profileSignature]);
  useEffect(()=>{onLanguageChange?.(language);},[language,onLanguageChange]);
  useEffect(()=>{if(quoteRef.current!==quoteKey){quoteRef.current=quoteKey;if(flow.step==='review'){setFlow(value=>({...value,consent:false}));setOfferChanged(true);}}},[quoteKey,flow.step]);
  useEffect(()=>{
    const event=checkout.returnEvent;if(!event || event.eventId===lastReturn.current)return;
    lastReturn.current=event.eventId;const next=normalizeCheckoutReturnNotice(event);
    if(next)setReturnNotice(previous=>!previous || Date.parse(next.occurredAt)>=Date.parse(previous.occurredAt)?next:previous);
    setNoticeNow(Date.now());
  },[checkout.returnEvent]);
  useEffect(()=>{if(phase!=='idle')setFlow({...IDLE_CHECKOUT_FLOW});setQrOpen(false);},[phase]);
  const shownFlow=controlled?{...IDLE_CHECKOUT_FLOW,step:selectedStage,pageId:previewPageId}:flow;
  const flowPages=controlled?profile.pages.filter(page=>page.enabled!==false || page.id===previewPageId):pages;
  const currentPage=phase==='idle' && shownFlow.step==='page'?(controlled?profile.pages:pages).find(page=>page.id===shownFlow.pageId):null;
  const localStage=shownFlow.step==='page' && !currentPage?'review':shownFlow.step;
  const auxiliary=INFORMATION_STAGES.has(localStage) && phase==='idle';
  const outOfOrder=!previewOnly && phase==='idle' && ['start','ready'].includes(localStage) && (!connected || !offer || offer.controllerOnline===false);
  const restoring=recovering || (!previewOnly && !connected && interaction && !ended);
  const returnSafe=canPresentCheckoutReturn({flow,phase,busy,recovering:restoring,suppressed:documentHidden || checkout.noticeSuppressed});
  const returnContext=checkoutReturnContext({flow,phase,interaction,returnEvent:returnNotice});
  const showingReturn=!controlled && returnNotice?.noticeExpiresAt>noticeNow && returnSafe;
  const noticePresentation=showingReturn || (controlled && selectedStage==='returned');
  const stage=controlled?selectedStage:showingReturn?'returned':restoring?'recovering':auxiliary?localStage:outOfOrder?'out_of_order':phase==='idle'?localStage:phase==='awaiting_payment'?'waiting_for_card':returned?'returned':phase;
  useEffect(()=>{if(showingReturn){if(shownReturn.current?.eventId!==returnNotice.eventId)shownReturn.current={eventId:returnNotice.eventId,context:returnContext};setQrOpen(false);}},[showingReturn,returnNotice?.eventId,returnContext]);
  useEffect(()=>{if(!returnNotice)return;const timer=setInterval(()=>setNoticeNow(Date.now()),250);return()=>clearInterval(timer);},[returnNotice]);
  useEffect(()=>{
    if(!returnNotice || returnNotice.noticeExpiresAt>noticeNow)return;
    if(mayDismissCheckoutReturn(shownReturn.current,returnNotice.eventId,returnContext,returnSafe)){setFlow({...IDLE_CHECKOUT_FLOW});if(!returnOnly && !previewOnly && ended)checkout.reset?.();}
    setReturnNotice(null);setQrOpen(false);
  },[returnNotice,noticeNow,returnSafe,returnContext,ended,previewOnly,returnOnly]);
  const geometry=floatingCheckoutGeometry(viewportWidth,viewportHeight,returnOnly ? .16 : height),idle=stage==='start';
  const receiptSizing=returnReceiptSizing(geometry.expandedHeight,geometry.scale);
  useEffect(()=>{
    for(const scroller of panel.current?.querySelectorAll('.ms-checkout-main,.ms-checkout-actions') || [])scroller.scrollTop=0;
  },[stage,currentPage?.id]);
  const currency=interaction?.currency || offer?.currency || 'usd';
  const money=value=>checkoutMoney(value,currency,language);
  const values=noticePresentation?{deposit:'—',fee:'—',refund:'—',slot:returnNotice?.slot ?? interaction?.returnSlot ?? interaction?.slot ?? '—',available:'—'}:{deposit:money(interaction?.amountCents ?? offer?.depositAmountCents ?? offer?.amountCents),fee:money(returned?interaction?.settlement?.chargedAmountCents:offer?.rentalFeeCents),refund:money(returned?interaction?.settlement?.refundedAmountCents:offer?.refundAmountCents),slot:interaction?.returnSlot ?? interaction?.slot ?? '—',available:offer?.availableCount ?? '—'};
  const text=key=>stripeText(profile,language,key,values);
  const pageText=key=>stripePageText(profile,currentPage,language,key,values);
  const title=currentPage?pageText('title'):text(`${stage}.title`),body=currentPage?pageText('body'):text(`${stage}.body`);
  const themeStyle={...Object.fromEntries(Object.entries(profile.theme).map(([key,value])=>[`--checkout-${key}`,value])),'--checkout-pixel':`calc(var(--ms-preview-pixel) * ${geometry.scale})`};
  const px=value=>`calc(var(--ms-preview-pixel) * ${value})`;
  const cardStyle={...themeStyle,'--return-qr-size':px(receiptSizing.qr),'--return-done-height':px(receiptSizing.done),'--return-gap':px(receiptSizing.gap),width:px(idle?geometry.idleWidth:geometry.expandedWidth),height:px(idle?geometry.idleHeight:geometry.expandedHeight),bottom:px(geometry.bottom),borderRadius:px(geometry.radius)};
  const canSubmit=!previewOnly && canCreateCheckout(flow,{connected,available:offer?.canRent,busy,recovering,quoteKey});
  const link=stage==='returned'?(noticePresentation?checkoutReturnReceiptUrl(profile,showingReturn?returnNotice:null,interaction):checkoutLinkUrl(profile,'receipt',interaction)):LINK_STAGES.has(stage)?checkoutLinkUrl(profile,stage,interaction):null;
  const helpStationId=String(checkout.stationId || STATION).trim().toUpperCase(),helpTemplate=profile.links?.help || '',helpLink=customerHelpUrl(helpTemplate,helpStationId);
  const showHelpQr=!currentPage && stage==='ready' && !!helpLink;
  useEffect(()=>{let active=true;setQrImage(null);setQrOpen(false);if(link)stripeQrDataUrl(link).then(value=>{if(active)setQrImage(value);}).catch(()=>{});return()=>{active=false;};},[link]);
  useEffect(()=>{let active=true;setHelpQrImage(null);if(helpLink)customerHelpQrDataUrl(helpTemplate,helpStationId).then(value=>{if(active)setHelpQrImage(value);}).catch(()=>{});return()=>{active=false;};},[helpLink,helpTemplate,helpStationId]);
  function selectFlow(value){if(controlled){previewStageChange?.(value.step,value.pageId);return;}setFlow(value);}
  function begin(){setOfferChanged(false);selectFlow(beginCheckoutFlow(pages));}
  function done(){if(controlled){previewStageChange?.('start');return;}const safe=!showingReturn || mayDismissCheckoutReturn(shownReturn.current,returnNotice?.eventId,returnContext,returnSafe);setReturnNotice(null);setQrOpen(false);if(!safe)return;setFlow({...IDLE_CHECKOUT_FLOW});setOfferChanged(false);if(!returnOnly && !previewOnly && ended)checkout.reset?.();}
  function back(){setQrOpen(false);if(auxiliary)selectFlow({...IDLE_CHECKOUT_FLOW,step:flow.returnStep || 'ready'});else selectFlow(previousCheckoutPage(shownFlow,flowPages));}
  function showInformation(step){selectFlow({step,pageId:null,consent:false,returnStep:flow.step==='ready'?'ready':'start'});}
  function changeLanguage(value){if(controlled){previewLanguageChange?.(value);return;}setSelectedLanguage(value);setFlow(value=>({...value,consent:false}));}
  const action=(label,onClick,{secondary=false,disabled=false,key=label,presentationOnly=false}={})=><button key={key} type="button" className={secondary?'ms-checkout-secondary':'ms-checkout-primary'} disabled={disabled} onClick={()=>{if(!controlled || presentationOnly)onClick?.();}}>{label}</button>;
  const button=(key,onClick,options={})=>action(text(key),onClick,{...options,key});
  const busyMessage=key=><div className="ms-checkout-progress" role="status"><span>{text(key)}</span><i/></div>;
  function renderActions(){
    if(stage==='ready')return <>{button('rent',begin,{disabled:!!busy || unavailable,presentationOnly:true})}<div className="ms-checkout-row">{button('return',()=>selectFlow({step:'returning',pageId:null,consent:false,returnAfter:Date.now()}),{secondary:true,disabled:!!busy,presentationOnly:true})}{button('cancel',done,{secondary:true,disabled:!!busy,presentationOnly:true})}</div><div className="ms-checkout-utilities">{navigation.map!==false && button('map',()=>showInformation('map'),{secondary:true,presentationOnly:true})}{navigation.terms!==false && button('termsButton',()=>showInformation('terms'),{secondary:true,presentationOnly:true})}{navigation.information!==false && button('information',()=>showInformation('information'),{secondary:true,presentationOnly:true})}</div></>;
    if(currentPage)return <div className="ms-checkout-row">{action(pageText('nextLabel') || text('continue'),()=>selectFlow(nextCheckoutPage(shownFlow,flowPages)),{disabled:!!busy,presentationOnly:true})}{button('back',back,{secondary:true,disabled:!!busy,presentationOnly:true})}</div>;
    if(stage==='review')return <>{offerChanged && <p className="ms-checkout-error" role="status">{text('offerChanged')}</p>}<label className="ms-checkout-consent"><input type="checkbox" checked={controlled?checkout.termsAccepted===true:flow.consent} disabled={!!busy || controlled} onChange={event=>selectFlow({...flow,consent:event.target.checked,quoteKey})}/><span>{text('consent')}</span></label><div className="ms-checkout-row">{button(busy==='start'?'starting':'continue',()=>{if(canSubmit)checkout.start?.();},{disabled:controlled?checkout.termsAccepted!==true:!canSubmit})}{button('back',back,{secondary:true,disabled:!!busy,presentationOnly:true})}</div></>;
    if(stage==='waiting_for_card')return button('cancel',()=>{if(!previewOnly)checkout.cancel?.();},{secondary:true,disabled:!!busy || !connected});
    if(stage==='authorizing')return <>{busyMessage('authorizing.body')}{button('cancel',()=>{if(!previewOnly)checkout.cancel?.();},{secondary:true,disabled:!!busy || !connected})}</>;
    if(stage==='dispensing')return busyMessage('waitingSlot');
    if(stage==='loading')return busyMessage('connecting');
    if(stage==='recovering')return <>{button('recovering.title',()=>{if(!previewOnly)checkout.refresh?.();},{secondary:true,disabled:!!busy})}{['awaiting_payment','authorizing'].includes(interaction?.phase) && button('cancel',()=>{if(!previewOnly)checkout.cancel?.();},{secondary:true,disabled:!!busy || !connected})}</>;
    if(stage==='out_of_order')return null;
    if(stage==='succeeded')return button('done',done,{disabled:!!busy,presentationOnly:true});
    if(INFORMATION_STAGES.has(stage))return <>{link && button('openLink',()=>setQrOpen(true),{disabled:!qrImage,presentationOnly:true})}{button('back',back,{secondary:true,presentationOnly:true})}</>;
    if(stage==='returning')return busyMessage('returnPending');
    if(stage==='returned')return <><div className="ms-return-receipt" aria-label={text('receipt.title')}>{link?<>{qrImage?<img className="ms-checkout-qr" src={qrImage} alt={text('receiptScan')}/>:<span className="ms-return-qr-pending" aria-hidden="true"/>}<p>{text('receiptScan')}</p></>:<><span className="ms-return-qr-pending" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M13 5h22v38l-5-3-6 3-6-3-5 3V5zm6 10h10m-10 8h10m-10 8h6"/></svg></span><p>{text('receiptPending')}</p></>}</div>{button('done',done,{disabled:!!busy,presentationOnly:true})}</>;
    if(['declined','cancelled','failed'].includes(stage))return button('done',done,{disabled:!!busy,presentationOnly:true});
    return null;
  }
  const settlementKey=({voided:'settlementVoided',refunded:'settlementRefunded',captured:'settlementCaptured',authorized:'settlementAuthorized'})[interaction?.moneyStatus];
  const overlayTarget=panel.current?.closest('[data-kiosk-viewport],.ms-screen') || panel.current?.parentElement;
  const flags=navigation.language!==false?<FlagPicker language={language} languages={profile.enabledLanguages} label={text('language')} onChange={changeLanguage} disabled={!!busy}/>:null;
  const dialog=qrOpen && overlayTarget?createPortal(<div className="ms-checkout-dialog-shade" role="presentation" style={themeStyle}><section role="dialog" aria-modal="true" aria-label={title} className="ms-checkout-dialog"><h2>{title}</h2>{qrImage && <img src={qrImage} alt={title}/>}<p className="ms-checkout-dialog-url">{link}</p><button type="button" onClick={()=>setQrOpen(false)}>{text('back')}</button></section></div>,overlayTarget):null;
  if(returnOnly && !showingReturn && !(controlled && stage==='returned'))return null;
  return <div className="ms-checkout-viewport" style={themeStyle}><section ref={panel} className={`ms-checkout-panel ${stage} ${checkoutUsesColumns(viewportWidth,viewportHeight,returnOnly ? .16 : height)?'compact':''}`} style={cardStyle} lang={language} aria-label="Floating payment card" data-checkout-phase={stage} data-floating-state={idle?'idle':'expanded'}>
    {idle?<div className="ms-idle-actions">{button('start',()=>selectFlow({step:'ready',pageId:null,consent:false}),{disabled:!!busy,presentationOnly:true})}{flags}</div>:<>
    {flags && <div className="ms-checkout-language-corner">{flags}</div>}
    <div className="ms-checkout-main" key={`copy-${stage}-${currentPage?.id || ''}`}><h2>{title}</h2>{stage==='returned' && <p className="ms-return-slot">{text('returnSlot')}</p>}{body && (!LINK_STAGES.has(stage) || link) && <p className="ms-checkout-body">{body}</p>}
      {stage==='information' && ['rent','charge','return'].map(key=><div className="ms-checkout-instruction" key={key}><strong>{text(`information.${key}Title`)}</strong><p>{text(`information.${key}Body`)}</p></div>)}
      {stage==='review' && <><p className="ms-checkout-pricing">{text('pricing')}</p><p className="ms-checkout-terms">{text('terms')}</p></>}
      {stage==='ready' && unavailable && <p className="ms-reader-caption">{text(offer?.reader?.status==='disconnected'?'readerUnavailable':'unavailable')}</p>}
      {LINK_STAGES.has(stage) && (link?(qrImage?<img className="ms-checkout-qr" src={qrImage} alt={title}/>:<p className="ms-checkout-terms">{text('connecting')}</p>):<p className="ms-checkout-terms">{text('linkUnavailable')}</p>)}
      {!noticePresentation && !previewOnly && error && connected && <p className="ms-checkout-error" role="alert">{text('errorGeneric')}</p>}
      {!noticePresentation && !previewOnly && !connected && !recovering && <p className="ms-checkout-error" role="status">{text('connectionLost')}</p>}
      {!noticePresentation && phase!=='idle' && settlementKey && !auxiliary && <p className="ms-checkout-settlement">{text(settlementKey)}</p>}
      {showHelpQr && <div className="ms-checkout-help" data-help-url={helpLink}><strong className="ms-checkout-help-title">{text('helpTitle')}</strong>{helpQrImage?<img className="ms-checkout-help-qr" src={helpQrImage} alt={`Help QR code for ${helpStationId}`}/>:<span className="ms-checkout-help-pending" aria-hidden="true"/>}<span className="ms-checkout-help-scan">{text('helpScan')}</span></div>}
    </div>
    <div className="ms-checkout-actions" key={`actions-${stage}-${currentPage?.id || ''}`}>{renderActions()}</div></>}
  </section>{dialog}</div>;
}
