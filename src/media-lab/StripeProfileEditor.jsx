import {MEDIA_HOSTED,mediaUrl,mediaFetch} from './mediaApi.js';
import {useMediaAssetUrl} from './mediaAssetUrl.js';
export {MEDIA_HOSTED as stripeProfileHosted} from './mediaApi.js';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {CheckoutPanel} from './CheckoutPreview.jsx';
import {floatingCheckoutGeometry} from './checkoutFlow.js';
import {previewPaymentHeight} from './mediaLayout.js';
import './media-studio.css';
import {DashboardIcon as Icon} from './DashboardIcons.jsx';
import {STRIPE_UI_LANGUAGES as STRIPE_LANGUAGES, STRIPE_UI_FIELDS, STRIPE_UI_COLORS as STRIPE_THEME_FIELDS, defaultStripeUi as createStripeUi, validateStripeUi as normalizeStripeUi, stripeText} from './stripeUi.js';

const SECTION_META = [
  {key:'start',label:'Start'}, {key:'ready',label:'Rent / Return'}, {key:'information',label:'How it works'},
  {key:'returning',label:'Return instructions'}, {key:'review',label:'Rental review'}, {key:'waiting_for_card',label:'Payment'},
  {key:'wait',label:'Please wait',previewStage:'authorizing'}, {key:'succeeded',label:'Rental complete'}, {key:'returned',label:'Return complete'},
  {key:'terms',label:'Terms'}, {key:'map',label:'Map'}, {key:'receipt',label:'Receipt'},
  {key:'failed',label:'Transaction error'}, {key:'declined',label:'Card declined'}, {key:'out_of_order',label:'Out of order'},
  {key:'popups',label:'Confirmation messages',previewStage:'succeeded'}, {key:'shared',label:'Shared buttons',previewStage:'start'},
];
const COMMON_SECTIONS = {
  brand:'ready',start:'start',language:'start',pricing:'review',information:'information',support:'information',
  rent:'ready',return:'ready',availability:'ready',availabilityUnavailable:'ready',unavailable:'out_of_order',returnPending:'returning',continue:'review',consent:'review',terms:'terms',termsButton:'terms',
  readerReady:'waiting_for_card',readerUnavailable:'waiting_for_card',cancel:'waiting_for_card',
  connecting:'wait',connectionLost:'wait',starting:'wait',waitingSlot:'wait',
  settlementRefunded:'returned',returnConfirmed:'returned',receiptScan:'returned',receiptPending:'returned','popup.return':'returned',settlementVoided:'failed',settlementCaptured:'succeeded',settlementAuthorized:'wait',
  errorGeneric:'failed',offerChanged:'review',receipt:'receipt',map:'map',retry:'failed',done:'succeeded',back:'shared',openLink:'shared',linkUnavailable:'shared',
};
const WAIT_STAGES = new Set(['loading','authorizing','dispensing','recovering']);
const STRIPE_FIELDS = STRIPE_UI_FIELDS.filter(field => !['tap','insert','start.title','start.body'].includes(field.key)).map(field => {
  const prefix = field.key.split('.')[0];
  const group = COMMON_SECTIONS[field.key] || (prefix === 'popup' ? 'popups' : WAIT_STAGES.has(prefix) ? 'wait' : prefix === 'cancelled' ? 'failed' : SECTION_META.some(section => section.key === prefix) ? prefix : 'shared');
  const label = WAIT_STAGES.has(prefix) || prefix === 'cancelled' ? `${prefix.charAt(0).toUpperCase()+prefix.slice(1)} · ${field.label}` : field.label;
  return {...field,group,label};
});
const sectionLabel = key => SECTION_META.find(section => section.key === key)?.label || key;
const previewStageFor = key => SECTION_META.find(section => section.key === key)?.previewStage || key;
const OPTIONAL_PAGES = [
  {key:'language',label:'Language selector',section:'start'}, {key:'information',label:'How it works',section:'information'},
  {key:'terms',label:'Terms',section:'terms'}, {key:'map',label:'Map',section:'map'}, {key:'receipt',label:'Receipt',section:'receipt'},
];

const API = mediaUrl('/api/stripe-ui');
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';
const copy = value => JSON.parse(JSON.stringify(value));
async function request(method = 'GET', body) {
  const response = await mediaFetch(API + (method === 'PUBLISH' ? '/publish' : ''), {
    method: method === 'PUBLISH' ? 'POST' : method,
    ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || payload.error || `Unable to load Stripe settings (${response.status}).`);
  return payload;
}

function Field({label, children, hint}) {
  return <label className="block text-sm font-semibold text-slate-700">{label}{children}{hint && <span className="mt-1.5 block text-xs font-normal leading-5 text-slate-500">{hint}</span>}</label>;
}

const PREVIEW_OFFER = {currency:'usd', amountCents:500, depositAmountCents:500, rentalFeeCents:100, refundAmountCents:400, availableCount:4, canRent:true, reader:{status:'ready'}};

function MediaPreviewZone({zone, assets, width, height}) {
  const [index,setIndex] = useState(0);
  const items = zone.items || [];
  const signature = JSON.stringify(items);
  const item = items[index % (items.length || 1)];
  const asset = assets[item?.assetId];
  const isVideo = asset?.mimeType?.startsWith('video/');
  useEffect(() => {setIndex(0);}, [signature]);
  useEffect(() => {
    if (!item || isVideo) return;
    const timer = window.setTimeout(() => setIndex(value => (value+1) % items.length), item.durationMs || 10000);
    return () => window.clearTimeout(timer);
  }, [index, item?.assetId, item?.durationMs, isVideo, items.length]);
  const rotated = item?.rotation === 90 || item?.rotation === 270;
  const mediaStyle = {position:'absolute', left:'50%', top:'50%', width:rotated?height:width, height:rotated?width:height, maxWidth:'none', maxHeight:'none', objectFit:item?.fit || 'contain', transform:`translate(-50%,-50%) rotate(${item?.rotation || 0}deg)`};
  const url = useMediaAssetUrl(asset);
  return <div style={{position:'absolute',left:zone.x*width/zone.width,top:zone.y*height/zone.height,width,height,overflow:'hidden',background:zone.background || 'transparent'}}>
    {zone.type === 'text' ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:'100%',padding:'24px 28px',fontSize:29,color:'#fff',textAlign:'center',whiteSpace:'pre-wrap'}}>{zone.text}</div> : asset ? isVideo ? <video key={`${asset.id}-${index}`} src={url || undefined} style={mediaStyle} autoPlay muted playsInline loop={items.length === 1} onEnded={() => setIndex(value => (value+1) % items.length)}/> : <img src={url || undefined} alt={asset.name || ''} style={mediaStyle}/> : <div style={{display:'grid',placeItems:'center',height:'100%',fontSize:30,color:'#94a3b8'}}>No media assigned</div>}
  </div>;
}

function previewGeometry(manifest) {
  const landscape = manifest?.orientation === 'landscape';
  const screenWidth = landscape ? 1920 : 1080, screenHeight = landscape ? 1080 : 1920;
  const fraction = previewPaymentHeight(manifest?.checkout);
  const {expandedHeight:paymentHeight,idleWidth,idleHeight,bottom:margin,expandedWidth} = floatingCheckoutGeometry(screenWidth,screenHeight,fraction);
  return {screenWidth,screenHeight,fraction,paymentHeight,idleWidth,idleHeight,margin,expandedWidth,detailHeight:Math.max(paymentHeight,idleHeight)+2*margin};
}

function ScaledDevicePreview({profile, language, selectedPage, group, manifest, paymentOnly=false, previewStageChange, previewLanguageChange}) {
  const box = useRef(null), [displayWidth,setDisplayWidth] = useState(0);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setDisplayWidth(entry.contentRect.width));
    observer.observe(box.current); return () => observer.disconnect();
  }, []);
  const {screenWidth,screenHeight,fraction,paymentHeight,detailHeight} = previewGeometry(manifest);
  const canvasHeight = paymentOnly ? detailHeight : screenHeight;
  const scale = displayWidth / screenWidth;
  const assets = Object.fromEntries((manifest.assets || []).map(asset => [asset.id,asset]));
  const previewProfile = {...profile,enabledLanguages:[...new Set([...profile.enabledLanguages,language])]};
  const stage = selectedPage ? 'page' : previewStageFor(group);
  const previewCheckout = {offer:PREVIEW_OFFER, connected:true, recovering:false, interaction:{slot:7,currency:'usd',amountCents:500}};
  return <div ref={box} style={{position:'relative',width:'100%',height:displayWidth?canvasHeight*scale:undefined,aspectRatio:`${screenWidth} / ${canvasHeight || 1}`,overflow:'hidden',background:manifest.background || '#000'}} data-testid={paymentOnly?'stripe-payment-detail':'stripe-device-preview'} data-screen-width={screenWidth} data-screen-height={screenHeight} data-payment-fraction={fraction}>
    {displayWidth > 0 && <div data-kiosk-viewport style={{position:'absolute',top:0,left:0,width:screenWidth,height:canvasHeight,transform:`scale(${scale})`,transformOrigin:'top left','--ms-preview-pixel':'1px',fontFamily:'Roboto,Arial,sans-serif',boxSizing:'border-box'}}>
      {!paymentOnly && <div data-testid="stripe-preview-media" style={{position:'absolute',inset:0,width:screenWidth,height:screenHeight,overflow:'hidden'}}>{(manifest.zones || []).map(zone => <MediaPreviewZone key={zone.id} zone={zone} assets={assets} width={zone.width*screenWidth} height={zone.height*screenHeight}/>)}</div>}
      {paymentHeight > 0 && <div style={{position:'absolute',inset:0,zIndex:1,width:screenWidth,height:canvasHeight,overflow:'visible',pointerEvents:'none'}} data-testid="stripe-preview-payment-region">
        <CheckoutPanel checkout={previewCheckout} previewOnly stripeUi={previewProfile} height={fraction} previewStage={stage} previewPageId={selectedPage?.id} previewLanguage={language} previewStageChange={previewStageChange} previewLanguageChange={previewLanguageChange} viewportWidth={screenWidth} viewportHeight={screenHeight}/>
      </div>}
      {!paymentOnly && stage !== 'start' && <div aria-hidden="true" style={{position:'absolute',zIndex:2,top:0,left:0,width:'100%',height:52,padding:'5px 10px 5px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',background:'rgba(16,37,31,.867)',boxSizing:'border-box'}}><span style={{height:36,fontSize:11,color:'#d1fae5',paddingTop:1}}>● {stripeText(previewProfile,language,'brand')}</span><span style={{display:'grid',placeItems:'center',width:82,height:42}}><span style={{display:'grid',placeItems:'center',width:74,height:30,borderRadius:2,background:'#5a5a5c',color:'#fff',fontSize:12}}>STAFF</span></span></div>}
    </div>}
  </div>;
}

function DraftPreview({profile, language, selectedPage, group, manifest, manifestError, reloadManifest, previewStageChange, previewLanguageChange}) {
  const [zoom,setZoom] = useState(false);
  const {screenWidth:width,screenHeight:height,fraction,paymentHeight,idleWidth,idleHeight,expandedWidth,margin,detailHeight} = previewGeometry(manifest);
  const idle = !selectedPage && previewStageFor(group) === 'start';
  const cardSize = `${idle?idleWidth:expandedWidth} × ${idle?idleHeight:paymentHeight}`;
  const previewProps = {profile,language,selectedPage,group,manifest,previewStageChange,previewLanguageChange};
  return <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-4" aria-label="Stripe preview">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-900">Screen preview</h3><button type="button" onClick={reloadManifest} aria-label="Refresh preview layout" className="rounded-lg p-1.5 text-slate-500 hover:bg-white"><Icon name="reload" size={16}/></button></div>
    <p className="mb-3 mt-1 text-xs text-slate-500">{STRIPE_LANGUAGES.find(item => item.key === language)?.label} · {selectedPage?.name || sectionLabel(group)}</p>
    {manifest ? <>
      <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm"><ScaledDevicePreview {...previewProps}/></div>
      <p className="mt-3 text-xs font-semibold text-slate-700">{width} × {height} · full-screen media</p>
      {fraction > 0 && <p className="mt-1 text-xs leading-5 text-slate-600">{idle?'Start':'Expanded checkout'} card: {cardSize} px · {margin} px from the bottom.</p>}
      <p className="mt-1 text-xs leading-5 text-slate-500">Published layout, revision {manifest.revision}. Text and colors use your current draft.</p>
      {fraction > 0 ? <button type="button" onClick={() => setZoom(true)} className={`${buttonClass} mt-3 w-full`}><Icon name="display" size={16}/>Enlarge floating card</button> : <p className="mt-3 text-xs leading-5 text-slate-500">The checkout card is disabled in the published media layout.</p>}
    </> : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{manifestError || 'Loading the kiosk layout…'}</p>}
    {manifestError && manifest && <p role="status" className="mt-3 text-xs text-amber-800">{manifestError} Showing the last loaded layout.</p>}
    <p className="mt-3 text-xs leading-5 text-slate-500">Press Start to preview the expanded card, or select Start above to collapse it. Preview uses example amounts and slot. Set expanded card height in Media → Layout.</p>
    {zoom && manifest && <div role="dialog" aria-modal="true" aria-label="Enlarged payment preview" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setZoom(false)}><div className="w-full max-w-4xl rounded-2xl bg-white p-5 shadow-xl" onClick={event => event.stopPropagation()}><div className="mb-4 flex items-start justify-between gap-4"><div><h3 className="font-bold text-slate-900">Floating card · enlarged</h3><p className="mt-1 text-xs text-slate-500">{cardSize} px card, scaled with its {width} × {detailHeight} px bottom frame. Media is hidden in this detail view.</p></div><button type="button" className={buttonClass} onClick={() => setZoom(false)} aria-label="Close enlarged payment preview"><Icon name="close" size={18}/></button></div><div className="overflow-hidden rounded-lg border border-slate-200"><ScaledDevicePreview {...previewProps} paymentOnly/></div></div></div>}
  </aside>;
}

export default function StripeProfileEditor() {
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);
  const [version, setVersion] = useState(0);
  const [revision, setRevision] = useState(0);
  const [published, setPublished] = useState(null);
  const [manifest, setManifest] = useState(null), [manifestError,setManifestError] = useState('');
  const [tab, setTab] = useState('Text');
  const [language, setLanguage] = useState('en');
  const [group, setGroup] = useState('start');
  const [selectedPageId, setSelectedPageId] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('load');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmRemove, setConfirmRemove] = useState('');
  const groups = SECTION_META.filter(section => STRIPE_FIELDS.some(field => field.group === section.key)).map(section => section.key);
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const unpublished = saved && JSON.stringify(saved) !== JSON.stringify(published);
  const validation = useMemo(() => {if (!draft) return ''; try {normalizeStripeUi(draft); return '';} catch (failure) {return failure.message;}}, [draft]);
  const page = draft?.pages.find(item => item.id === selectedPageId) || draft?.pages[0];
  const visibleFields = STRIPE_FIELDS.filter(field => field.group === group && (!query || `${field.label} ${draft?.locales?.[language]?.[field.key] || ''}`.toLowerCase().includes(query.toLowerCase())));

  async function load() {
    setBusy('load'); setError('');
    try {
      const payload = await request();
      const next = normalizeStripeUi(payload.draft || createStripeUi());
      setDraft(copy(next)); setSaved(copy(next)); setVersion(payload.version); setRevision(payload.revision); setPublished(payload.published);
    } catch (failure) {setError(failure.message);} finally {setBusy('');}
  }
  async function loadManifest() {
    try {
      const response = await mediaFetch('/api/stations/LAB-US8004');
      const payload = await response.json();
      if (!response.ok || !payload.manifest) throw new Error('Unable to load the published screen layout.');
      setManifest(payload.manifest); setManifestError('');
    } catch (failure) {setManifestError(failure.message);}
  }
  useEffect(() => {load(); loadManifest();}, []);
  const update = change => {setDraft(previous => ({...previous, ...change})); setNotice('');};
  const updateText = (key, value) => update({locales: {...draft.locales, [language]: {...draft.locales[language], [key]: value}}});
  const updatePage = next => update({pages: draft.pages.map(item => item.id === next.id ? next : item)});
  const updatePageText = (key, value) => updatePage({...page, locales: {...page.locales, [language]: {...page.locales[language], [key]: value}}});
  function changePreviewStage(nextStage, nextPageId) {
    if (nextStage === 'page' && draft.pages.some(item => item.id === nextPageId)) {
      setSelectedPageId(nextPageId); setTab('Pages'); setQuery(''); return;
    }
    const nextGroup = WAIT_STAGES.has(nextStage) ? 'wait' : nextStage === 'cancelled' ? 'failed' : nextStage;
    if (!SECTION_META.some(section => section.key === nextGroup)) return;
    setGroup(nextGroup); setTab('Text'); setQuery('');
  }
  function addPage() {
    const id = `page-${crypto.randomUUID().slice(0, 12)}`;
    const next = {id, name: `Page ${draft.pages.length + 1}`, enabled: true, locales: Object.fromEntries(STRIPE_LANGUAGES.map(({key}) => [key, {title: {en: 'Before you rent', fr: 'Avant de louer', es: 'Antes de alquilar'}[key], body: '', nextLabel: {en: 'Continue', fr: 'Continuer', es: 'Continuar'}[key]}]))};
    update({pages: [...draft.pages, next]}); setSelectedPageId(id); setConfirmRemove('');
  }
  function movePage(id, offset) {
    const index = draft.pages.findIndex(item => item.id === id), target = index + offset;
    if (target < 0 || target >= draft.pages.length) return;
    const pages = [...draft.pages]; [pages[index], pages[target]] = [pages[target], pages[index]]; update({pages});
  }
  async function save() {
    if (busy || validation) return;
    setBusy('save'); setError(''); setNotice('');
    try {
      const payload = await request('PUT', {draft, version});
      setDraft(copy(payload.draft)); setSaved(copy(payload.draft)); setVersion(payload.version); setRevision(payload.revision); setPublished(payload.published);
      setNotice(MEDIA_HOSTED?'Stripe draft saved to the hosted service. It is ready to publish.':'Stripe draft saved on this laptop. It is ready to publish.');
    } catch (failure) {setError(failure.message);} finally {setBusy('');}
  }
  async function publish() {
    if (busy || dirty || validation) return;
    setBusy('publish'); setError(''); setNotice('');
    try {
      const payload = await request('PUBLISH', {version, baseRevision: revision});
      setDraft(copy(payload.draft)); setSaved(copy(payload.draft)); setVersion(payload.version); setRevision(payload.revision); setPublished(payload.published);
      setNotice(`Stripe UI published to ${MEDIA_HOSTED?'US8004':'LAB-US8004'} as revision ${payload.revision}. The app will apply it when connected.`); loadManifest();
    } catch (failure) {setError(failure.message);} finally {setBusy('');}
  }
  if (!draft) return <div className="rounded-xl border border-slate-200 p-6 text-sm text-slate-600">{busy ? 'Loading Stripe settings…' : <><p role="alert">{error}</p><button type="button" onClick={load} className={`${buttonClass} mt-4`}>Try again</button></>}</div>;

  return <div data-testid="stripe-profile-editor">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Icon name="card"/>Stripe checkout</h2><p className="mt-1 text-sm text-slate-500">{dirty ? 'Unsaved changes' : unpublished ? 'Saved draft · not published' : 'Published settings'} · revision {revision}</p></div>
      <div className="flex gap-2"><button type="button" onClick={save} disabled={Boolean(busy || !dirty || validation)} className={buttonClass}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button><button type="button" onClick={publish} disabled={Boolean(busy || dirty || validation || !unpublished)} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'publish' ? 'Publishing…' : (MEDIA_HOSTED?'Publish to US8004':'Publish to LAB-US8004')}</button></div>
    </div>
    <div className="mb-5 rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm leading-5 text-cyan-900">These Stripe UI settings belong to <strong>{MEDIA_HOSTED?'US8004':'LAB-US8004'}</strong> {MEDIA_HOSTED?'on the hosted service. Payment processing requires a separate integration.':'on this laptop. Payment processing remains in test mode.'}</div>
    {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}<button type="button" onClick={load} className="ml-3 font-semibold underline">Reload saved draft</button></div>}
    {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {validation && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{validation}</p>}
    <nav aria-label="Stripe settings" className="mb-5 flex gap-1 border-b border-slate-100 pb-3">{['Text', 'Pages', 'Colors'].map(name => <button key={name} type="button" aria-pressed={tab === name} onClick={() => setTab(name)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === name ? 'bg-cyan-50 text-cyan-800' : 'text-slate-500 hover:bg-slate-50'}`}>{name}</button>)}</nav>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <fieldset disabled={Boolean(busy)} className="min-w-0 disabled:opacity-60">
        {tab !== 'Colors' && <div role="tablist" aria-label="Stripe language" className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1">{STRIPE_LANGUAGES.map(({key, label}) => <button type="button" role="tab" aria-selected={language === key} key={key} onClick={() => setLanguage(key)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${language === key ? 'bg-white text-cyan-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}</div>}
        {tab === 'Text' && <>
          <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Field label="Default language"><select aria-label="Stripe default language" value={draft.defaultLanguage} onChange={event => update({defaultLanguage: event.target.value})} className={inputClass}>{STRIPE_LANGUAGES.filter(({key}) => draft.enabledLanguages.includes(key)).map(({key,label}) => <option key={key} value={key}>{label}</option>)}</select></Field>
            <div className="mt-4 flex flex-wrap gap-4">{STRIPE_LANGUAGES.map(({key,label}) => <label key={key} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.enabledLanguages.includes(key)} disabled={key === draft.defaultLanguage} onChange={event => update({enabledLanguages: event.target.checked ? STRIPE_LANGUAGES.map(item => item.key).filter(value => value === key || draft.enabledLanguages.includes(value)) : draft.enabledLanguages.filter(value => value !== key)})} className="h-4 w-4 rounded border-slate-300 accent-cyan-700"/>{label}</label>)}</div>
            <p className="mt-3 text-xs leading-5 text-slate-500">All translations stay editable. Each language has its own text. Clear a field to hide its text.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-[150px_minmax(0,1fr)]">
            <label className="block text-sm font-semibold text-slate-700 md:hidden">Text section<select aria-label="Stripe text section" value={group} onChange={event => {setGroup(event.target.value); setQuery('');}} className={inputClass}>{groups.map(name => <option key={name} value={name}>{sectionLabel(name)}</option>)}</select></label>
            <nav aria-label="Stripe text sections" className="hidden space-y-1 md:block">{groups.map(name => <button key={name} type="button" aria-pressed={group === name} onClick={() => {setGroup(name); setQuery('');}} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${group === name ? 'bg-cyan-50 text-cyan-800' : 'text-slate-600 hover:bg-slate-50'}`}>{sectionLabel(name)}</button>)}</nav>
            <div className="min-w-0"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold text-slate-900">{sectionLabel(group)}</h3><input type="search" aria-label="Find Stripe text" placeholder="Find text" value={query} onChange={event => setQuery(event.target.value)} className="w-40 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"/></div><div className="space-y-4">
              {OPTIONAL_PAGES.filter(item => item.section === group).map(item => <label key={item.key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700"><span>Show {item.label.toLowerCase()}</span><input type="checkbox" aria-label={`Show Stripe ${item.label}`} checked={draft.navigation?.[item.key] !== false} onChange={event => update({navigation:{...draft.navigation,[item.key]:event.target.checked}})} className="h-4 w-4 accent-cyan-700"/></label>)}
              {['terms','map','receipt'].includes(group) && <Field label={group === 'receipt' ? 'Receipt lookup URL' : `${sectionLabel(group)} URL`} hint={group === 'receipt' ? 'Use your receipt lookup page. Leave blank to show an unavailable message until a real destination is configured.' : 'Use an HTTPS page. Leave blank to show an unavailable message until a real destination is configured.'}><input aria-label={`Stripe ${sectionLabel(group)} URL`} type="url" maxLength={1000} placeholder="https://" value={draft.links?.[group] || ''} onChange={event => update({links:{...draft.links,[group]:event.target.value}})} className={inputClass}/></Field>}
              {visibleFields.map(field => <Field key={field.key} label={field.label} hint={field.hint}><textarea aria-label={`Stripe ${field.label}`} value={draft.locales[language]?.[field.key] || ''}  maxLength={2000} rows={/body|terms|pricing|message/i.test(field.key) ? 3 : 2} onChange={event => updateText(field.key, event.target.value)} className={`${inputClass} resize-y leading-6`}/></Field>)}{!visibleFields.length && <p className="py-6 text-center text-sm text-slate-500">No matching text.</p>}</div></div>
          </div>
        </>}
        {tab === 'Pages' && <>
          <div className="mb-6 rounded-2xl border border-slate-200 p-4"><h3 className="font-bold text-slate-900">Kiosk pages and buttons</h3><p className="mt-1 text-sm leading-5 text-slate-500">Choose the same optional pages available in Kiosk screen. Start and transaction pages remain in the customer flow.</p><div className="mt-4 space-y-3">{OPTIONAL_PAGES.map(item => <div key={item.key} className="flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" aria-label={`Enable Stripe ${item.label}`} checked={draft.navigation?.[item.key] !== false} onChange={event => update({navigation:{...draft.navigation,[item.key]:event.target.checked}})} className="h-4 w-4 accent-cyan-700"/>{item.label}</label><button type="button" onClick={() => {setTab('Text');setGroup(item.section);setQuery('');}} className="text-xs font-semibold text-cyan-700 hover:underline">Edit text</button></div>)}</div></div>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">Pages before payment</h3><p className="mt-1 max-w-lg text-sm leading-5 text-slate-500">Add welcome, instructions, or venue messages. Pages appear in this order after Rent.</p></div><button type="button" onClick={addPage} disabled={draft.pages.length >= 12} className={buttonClass}><Icon name="plus" size={16}/>Add page</button></div>
          <div className="mb-5 space-y-2">{draft.pages.map((item,index) => <div key={item.id} className={`flex items-center gap-2 rounded-xl border p-2 ${page?.id === item.id ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200'}`}><button type="button" onClick={() => {setSelectedPageId(item.id); setConfirmRemove('');}} className="min-w-0 flex-1 truncate px-2 py-1 text-left text-sm font-semibold text-slate-800">{index + 1}. {item.name || 'Untitled page'}{!item.enabled && <span className="ml-2 text-xs font-normal text-slate-500">Hidden</span>}</button><button type="button" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => movePage(item.id,-1)} className="rounded-lg p-2 text-slate-500 hover:bg-white disabled:opacity-30"><Icon name="swipeUp" size={16}/></button><button type="button" aria-label={`Move ${item.name} down`} disabled={index === draft.pages.length - 1} onClick={() => movePage(item.id,1)} className="rounded-lg p-2 text-slate-500 hover:bg-white disabled:opacity-30"><Icon name="swipeDown" size={16}/></button></div>)}</div>
          {!page ? <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center"><Icon name="text" className="mx-auto text-slate-400" size={28}/><h4 className="mt-3 font-semibold text-slate-700">Go straight to rental review</h4><p className="mt-1 text-sm text-slate-500">Add a page when customers need more information.</p></div> : <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-4"><h4 className="font-bold text-slate-900">{page.name}</h4><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={page.enabled} onChange={event => updatePage({...page,enabled:event.target.checked})} className="h-4 w-4 accent-cyan-700"/>Show page</label></div>
            <Field label="Page name" hint="For your dashboard only."><input aria-label="Stripe page name" maxLength={80} value={page.name} onChange={event => updatePage({...page,name:event.target.value})} className={inputClass}/></Field>
            <Field label="Title"><input aria-label="Stripe page title" maxLength={200} value={page.locales[language]?.title || ''} placeholder={page.locales[draft.defaultLanguage]?.title || page.locales.en?.title || ''} onChange={event => updatePageText('title',event.target.value)} className={inputClass}/></Field>
            <Field label="Message"><textarea aria-label="Stripe page message" rows={4} maxLength={2000} value={page.locales[language]?.body || ''} placeholder={page.locales[draft.defaultLanguage]?.body || page.locales.en?.body || ''} onChange={event => updatePageText('body',event.target.value)} className={inputClass}/></Field>
            <Field label="Continue button"><input aria-label="Stripe page continue button" maxLength={80} value={page.locales[language]?.nextLabel || ''} placeholder={page.locales[draft.defaultLanguage]?.nextLabel || page.locales.en?.nextLabel || ''} onChange={event => updatePageText('nextLabel',event.target.value)} className={inputClass}/></Field>
            {confirmRemove === page.id ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900"><p>Remove “{page.name}” from this draft?</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => {update({pages:draft.pages.filter(item => item.id !== page.id)});setSelectedPageId('');setConfirmRemove('');}} className={buttonClass}>Remove page</button><button type="button" onClick={() => setConfirmRemove('')} className={buttonClass}>Keep page</button></div></div> : <button type="button" onClick={() => setConfirmRemove(page.id)} className={`${buttonClass} text-red-700`}><Icon name="trash" size={16}/>Delete page</button>}
          </div>}
          <p className="mt-4 text-xs leading-5 text-slate-500">Rental review, consent, payment, and dispensing stay in the checkout flow. Edit their text under Text.</p>
        </>}
        {tab === 'Colors' && <><h3 className="font-bold text-slate-900">Brand colors</h3><p className="mb-5 mt-1 text-sm text-slate-500">Apply your colors to the payment section and added pages.</p><div className="grid gap-4 sm:grid-cols-2">{STRIPE_THEME_FIELDS.map(({key,label}) => <div key={key} className="rounded-2xl border border-slate-200 p-4"><div className="mb-3 flex items-center justify-between gap-3"><label htmlFor={`stripe-color-${key}`} className="text-sm font-semibold text-slate-800">{label}</label><input type="color" aria-label={`Stripe ${label} color picker`} value={/^#[0-9a-f]{6}$/i.test(draft.theme[key]) ? draft.theme[key] : '#000000'} onChange={event => update({theme:{...draft.theme,[key]:event.target.value.toUpperCase()}})} className="h-10 w-10 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"/></div><input id={`stripe-color-${key}`} aria-label={`Stripe ${label} color`} value={draft.theme[key]} maxLength={7} onChange={event => update({theme:{...draft.theme,[key]:event.target.value.toUpperCase()}})} className={inputClass}/></div>)}</div></>}
      </fieldset>
      <DraftPreview profile={draft} language={language} selectedPage={tab === 'Pages' ? page : null} group={group} manifest={manifest} manifestError={manifestError} reloadManifest={loadManifest} previewStageChange={changePreviewStage} previewLanguageChange={setLanguage}/>
    </div>
  </div>;
}
