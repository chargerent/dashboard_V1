import {MEDIA_HOSTED,mediaUrl,mediaFetch,mediaHeaders,mediaAccessProblem} from './mediaApi.js';
import {useMediaAssetUrl} from './mediaAssetUrl.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './media-studio.css';
import {DashboardIcon as Icon} from './DashboardIcons.jsx';
import { CheckoutPanel, PaymentScenarioControls, useBrowserCheckout } from './CheckoutPreview.jsx';
import {PAYMENT_MIN_HEIGHT,PAYMENT_MAX_HEIGHT,validPaymentHeight,previewPaymentHeight,withPublishedStripeUi} from './mediaLayout.js';

import {stripeText,resolveStripeLanguage} from './stripeUi.js';
import {checkoutPopupValues} from './checkoutFlow.js';

const API = mediaUrl('/api/').replace(/\/$/,'');
const STATION = 'LAB-US8004';
const STATION_API = `/stations/${STATION}`;
const FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const IMAGE_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_POPUP = {durationMs:5000,successTemplate:'Take your charger from slot {slot}.',returnTemplate:'Charger returned. Thank you!',failureTemplate:'Unable to release a charger. Please try again.'};
function clone(value) {return JSON.parse(JSON.stringify(value));}
function draftOf(manifest) {return {orientation:manifest.orientation,background:manifest.background,zones:clone(manifest.zones || []),popup:{...DEFAULT_POPUP,...manifest.popup},...(manifest.checkout?{checkout:clone(manifest.checkout)}:{}),...(manifest.stripeUi?{stripeUi:clone(manifest.stripeUi)}:{})};}
async function api(path, options={}) {
  const response = await mediaFetch(`${API}${path}`, { ...options, headers:{...(options.body ? {'Content-Type':'application/json'} : {}),...options.headers}});
  const body = await response.json().catch(()=>({}));
  if (!response.ok) throw Object.assign(new Error(body.error?.message || `Media service returned ${response.status}.`),{status:response.status,code:body.error?.code});
  return body;
}
function post(path, body) {return api(path,{method:'POST',body:JSON.stringify(body)});}
function AssetThumbnail({asset}) {const url=useMediaAssetUrl(asset);return assetIsVideo(asset)?<video src={url || undefined} muted preload="metadata"/>:<img src={url || undefined} alt=""/>;}
function prettyBytes(bytes) {return bytes >= 1024*1024*1024 ? `${(bytes/1024/1024/1024).toFixed(2)} GB` : bytes >= 1024*1024 ? `${(bytes/1024/1024).toFixed(1)} MB` : `${Math.round((bytes||0)/1024)} KB`;}
function when(value) {if (!value) return 'No report yet'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'No report yet' : date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'});}
function assetIsVideo(asset) {return asset?.mimeType?.startsWith('video/');}
function validateDraft(draft, assets) {
  if (!draft) return [];
  const issues=[];
  if (!draft.zones.length || draft.zones.length>4) issues.push('Use between one and four screen zones.');
  if (!validPaymentHeight(draft.checkout)) issues.push('The bottom payment panel must use 10% to 50% of the screen.');
  let videoZones=0;
  draft.zones.forEach((zone,index)=>{
    if (![zone.x,zone.y,zone.width,zone.height].every(Number.isFinite) || zone.x<0 || zone.y<0 || zone.width<=0 || zone.height<=0 || zone.x+zone.width>1.00001 || zone.y+zone.height>1.00001) issues.push(`Zone ${index+1} must stay inside the screen.`);
    if (zone.type==='playlist') {
      if (!zone.items?.length) issues.push(`Add media to zone ${index+1}.`);
      if (zone.items?.some(item=>assetIsVideo(assets[item.assetId]))) videoZones++;
      for (const item of zone.items || []) if (!assets[item.assetId]) issues.push('A playlist asset is missing from the library.');
    }
    draft.zones.slice(index+1).forEach(other=>{if (zone.x<other.x+other.width-.00001 && zone.x+zone.width>other.x+.00001 && zone.y<other.y+other.height-.00001 && zone.y+zone.height>other.y+.00001) issues.push(`Zone ${index+1} overlaps another zone.`);});
  });
  if (videoZones>1) issues.push('Keep videos in one playlist zone for this pilot. Other zones can show images or text.');
  return [...new Set(issues)];
}
function Button({children, icon, variant='', ...props}) {return <button className={`ms-button ${variant}`} {...props}>{icon && <Icon name={icon} size={17}/>}<span>{children}</span></button>;}
function Badge({children,tone=''}) {return <span className={`ms-badge ${tone}`}><i/>{children}</span>;}
function Field({label,children,help}) {return <label className="ms-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;}
function PlaylistPreview({zone,assets}) {
  const [index,setIndex] = useState(0);
  const [bounds,setBounds] = useState({width:100,height:100});
  const box=useRef(null);
  const item=zone.items?.[index % (zone.items?.length || 1)];
  const asset=assets[item?.assetId];
  const signature=JSON.stringify(zone.items);
  useEffect(()=>{setIndex(0);},[signature]);
  useEffect(()=>{
    if (!box.current) return;
    const observer=new ResizeObserver(([entry])=>setBounds({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(box.current);return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if (!item || assetIsVideo(asset)) return;
    const timer=setTimeout(()=>setIndex(value=>(value+1)%zone.items.length),item.durationMs || 10000);
    return ()=>clearTimeout(timer);
  },[index,item?.durationMs,item?.assetId,asset?.mimeType,zone.items?.length]);
  const assetUrl=useMediaAssetUrl(asset);
  const rotated=item?.rotation===90 || item?.rotation===270;
  const style={width:rotated ? bounds.height : '100%',height:rotated ? bounds.width : '100%',objectFit:item?.fit || 'contain',position:'absolute',left:'50%',top:'50%',transform:`translate(-50%,-50%) rotate(${item?.rotation || 0}deg)`};
  return <div className="ms-zone-media" ref={box}>{asset ? assetIsVideo(asset) ? <video key={`${asset.id}-${index}`} src={assetUrl || undefined} style={style} autoPlay muted playsInline loop={zone.items.length===1} onEnded={()=>setIndex(value=>(value+1)%zone.items.length)}/> : <img src={assetUrl || undefined} alt={asset.name} style={style}/> : <div className="ms-empty-zone"><Icon name="image" size={32}/><span>Add media to this zone</span></div>}</div>;
}
function Preview({draft,assets,selected,onSelect,popup,split,onSplit,showGuides=true,checkoutNode,checkout,language}) {
  const canvas=useRef(null);
  const [dragging,setDragging]=useState(false);
  useEffect(()=>{
    if (!dragging) return;
    const move=event=>{const box=canvas.current.getBoundingClientRect();onSplit(Math.max(20,Math.min(80,Math.round((split.axis==='x' ? (event.clientX-box.left)/box.width : (event.clientY-box.top)/box.height)*100))));};
    const done=()=>setDragging(false);
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',done,{once:true});
    return ()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',done);};
  },[dragging,split,onSplit]);
  if (!draft) return null;
  const paymentHeight=previewPaymentHeight(draft.checkout);
  const popupLanguage=resolveStripeLanguage(draft.stripeUi,language);
  const popupStage=popup?.type==='charger_returned'?'returned':popup?.type==='rental_failed'?'failed':'succeeded';
  const popupKey=popup?.type==='charger_returned'?'popup.return':popup?.type==='rental_failed'?'popup.failure':'popup.success';
  const popupValues=checkoutPopupValues({event:popup,offer:checkout?.offer,interaction:checkout?.interaction,language:popupLanguage});
  const popupTitle=draft.stripeUi?stripeText(draft.stripeUi,popupLanguage,`${popupStage}.title`,popupValues):popup?.type==='charger_returned'?'Charger returned':popup?.type==='rental_failed'?'Charger was not released':'Your charger is ready';
  const popupMessage=draft.stripeUi?stripeText(draft.stripeUi,popupLanguage,popupKey,popupValues):popup?.message;
  return <div className={`ms-screen-frame ${draft.orientation}`}><div className="ms-screen" style={{background:draft.background,aspectRatio:draft.orientation==='landscape'?'16 / 9':'9 / 16'}} data-testid="screen-preview">
    <div className="ms-media-viewport" ref={canvas} style={{height:'100%'}} data-testid="media-viewport">
    {draft.zones.map((zone,index)=><div key={zone.id} className={`ms-preview-zone ${showGuides && selected===zone.id?'selected':''}`} style={{left:`${zone.x*100}%`,top:`${zone.y*100}%`,width:`${zone.width*100}%`,height:`${zone.height*100}%`,background:zone.background || 'transparent'}} onClick={()=>onSelect?.(zone.id)}>
      {zone.type==='text' ? <div className="ms-zone-text"><p>{zone.text}</p></div> : <PlaylistPreview zone={zone} assets={assets}/>}
      {showGuides && <button className="ms-zone-label" aria-label={`Select zone ${index+1}`} onClick={()=>onSelect?.(zone.id)}>{String(index+1).padStart(2,'0')} · {zone.type==='text'?'Message':'Playlist'}</button>}
    </div>)}
    {showGuides && split && <button aria-label="Drag to adjust split" className={`ms-split-handle ${split.axis}`} style={split.axis==='y'?{top:`${split.value}%`}:{left:`${split.value}%`}} onPointerDown={event=>{event.preventDefault();setDragging(true);}}><span/></button>}
    </div>
    <div className="ms-bottom-payment" style={{height:'100%',pointerEvents:'none'}}>{React.isValidElement(checkoutNode)?React.cloneElement(checkoutNode,{returnOnly:paymentHeight<=0}):checkoutNode}</div>
    {popup && popup.type!=='charger_returned' && <div className={`ms-screen-popup ${popup.type}`} role="status"><strong>{popupTitle}</strong><p>{popupMessage}</p></div>}
  </div><div className="ms-screen-base"><span/> <span/> <span/></div></div>;
}
function VideoJobs({jobs,cancelling,onCancel,statusError}) {
  const [expanded,setExpanded]=useState(false);
  const active=jobs.filter(job=>['uploading','queued','processing'].includes(job.status));
  const completed=jobs.filter(job=>!['uploading','queued','processing'].includes(job.status));
  const visible=expanded ? [...active,...completed] : [...active,...completed.slice(0,3)];
  if (!jobs.length && !statusError) return null;
  const stages={queued:'Waiting to start',probing:'Checking your video',preparing:'Preparing your video',encoding:'Optimizing for playback',transcoding:'Optimizing for playback',verifying:'Checking the optimized video',finalizing:'Finishing up'};
  return <section className="ms-video-jobs" aria-label="Video optimization jobs">
    <div className="ms-video-jobs-heading"><strong>Video preparation</strong><span>{active.length ? `${active.length} in progress` : 'Recent uploads'}</span></div>
    {statusError && <p className="ms-job-status-error" role="status">{statusError}</p>}
    <div className="ms-video-job-list">{visible.map(job=>{
      const progress=Math.max(0,Math.min(100,Math.round(Number(job.progress) || 0)));
      const pending=job.status==='queued' || job.status==='processing';
      return <article className={`ms-video-job ${job.status}`} key={job.id} data-job-id={job.id} data-job-status={job.status}>
        <div className="ms-video-job-title"><Icon name={job.status==='ready'?'check':job.status==='failed'?'info':job.status==='cancelled'?'close':'play'} size={15}/><strong title={job.name}>{job.name}</strong>{pending && <button type="button" aria-label={`Cancel optimization of ${job.name}`} disabled={cancelling===job.id} onClick={()=>onCancel(job.id)}>{cancelling===job.id?'Cancelling…':'Cancel'}</button>}</div>
        {job.status==='uploading' ? <><div className="ms-video-job-progress-label"><span>Uploading original video</span><span>{prettyBytes(job.sourceBytes)} received</span></div><progress aria-label={`Original video upload in progress for ${job.name}`} max="100"/><p>Video preparation begins after the upload finishes.</p></> : pending ? <><div className="ms-video-job-progress-label"><span>{job.status==='queued'?'Queued':stages[job.stage] || job.stage || 'Optimizing video'}</span><span>{job.status==='processing'?`${progress}%`:prettyBytes(job.sourceBytes)}</span></div><progress aria-label={`Optimization progress for ${job.name}`} max="100" value={job.status==='queued'?0:progress}/><p>{job.status==='queued'?'Your original is uploaded. Preparation will begin shortly.':'You can keep editing while this video is prepared.'}</p></> : job.status==='ready' ? <><div className="ms-video-job-ready"><span>Ready for your playlist</span><span>{prettyBytes(job.sourceBytes ?? job.asset?.optimization?.originalBytes)} <b>→</b> {prettyBytes(job.asset?.bytes)}</span></div><p>Find the optimized video in your media library.</p></> : <p className={job.status==='failed'?'ms-video-job-error':''}>{job.status==='failed'?(job.error || 'Video preparation failed. Try uploading it again.'):'Cancelled. This video was not added to the library.'}</p>}
      </article>;
    })}</div>
    {completed.length>3 && <button type="button" className="ms-job-history-toggle" onClick={()=>setExpanded(value=>!value)}>{expanded?'Show recent uploads':`Show all ${jobs.length} uploads`}</button>}
  </section>;
}
function getSplit(zones) {
  if (zones.length!==2) return null;
  const [a,b]=zones;
  if (a.x===0 && b.x===0 && a.width===1 && b.width===1 && Math.abs(a.height-b.y)<.0001) return {axis:'y',value:Math.round(a.height*100)};
  if (a.y===0 && b.y===0 && a.height===1 && b.height===1 && Math.abs(a.width-b.x)<.0001) return {axis:'x',value:Math.round(a.width*100)};
  return null;
}

export default function MediaStudio({embedded=false, workspaceView, onWorkspaceView,suspended=false}) {
  const [library,setLibrary]=useState([]),[station,setStation]=useState(null),[draft,setDraft]=useState(null),[selected,setSelected]=useState('main');
  const [view,setView]=useState(()=>(MEDIA_HOSTED?['kiosk']:['kiosk','testing']).includes(new URLSearchParams(window.location.search).get('view'))?new URLSearchParams(window.location.search).get('view'):'studio'),[inspector,setInspector]=useState('zone'),[query,setQuery]=useState(''),[filter,setFilter]=useState('all');
  const [accessProblem,setAccessProblem]=useState('');const accessMessage=useRef('');
  const [busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[connected,setConnected]=useState(false),[upload,setUpload]=useState(null);
  const [popup,setPopup]=useState(null),[guides,setGuides]=useState(true),[activity,setActivity]=useState([]),[slots,setSlots]=useState([]),[eventSlot,setEventSlot]=useState(1);
  const [historyOpen,setHistoryOpen]=useState(false),[confirmRevision,setConfirmRevision]=useState(null),[staffToken,setStaffToken]=useState(''),[pin,setPin]=useState(''),[ejectSlot,setEjectSlot]=useState(null);
  const [jobs,setJobs]=useState([]),[cancellingJob,setCancellingJob]=useState(''),[jobStatusError,setJobStatusError]=useState('');
  const fileInput=useRef(null),draftRef=useRef(null),popupTimer=useRef(null);
  const [kioskPopup,setKioskPopup]=useState(null),[kioskLanguage,setKioskLanguage]=useState(''),[draftLanguage,setDraftLanguage]=useState('');
  const [draftReturnEvent,setDraftReturnEvent]=useState(null);
  const kioskPopupTimer=useRef(null),stationRef=useRef(null);
  stationRef.current=station;
  const browserCheckout=useBrowserCheckout({onEvent:event=>{
    if(event.type==='charger_returned')return;
    const settings=stationRef.current?.manifest?.popup || DEFAULT_POPUP;
    const key=event.type==='rental_dispensed'?'successTemplate':event.type==='charger_returned'?'returnTemplate':'failureTemplate';
    clearTimeout(kioskPopupTimer.current);
    setKioskPopup({...event,message:(settings[key] || DEFAULT_POPUP[key]).replaceAll('{slot}',String(event.slot))});
    kioskPopupTimer.current=setTimeout(()=>setKioskPopup(null),settings.durationMs || 5000);
  }});
  const checkout={...browserCheckout,noticeSuppressed:suspended || confirmRevision!==null || ejectSlot!==null};
  const draftCheckout={...checkout,returnEvent:(Date.parse(draftReturnEvent?.occurredAt) || -Infinity)>(Date.parse(checkout.returnEvent?.occurredAt) || -Infinity)?draftReturnEvent:checkout.returnEvent};
  useEffect(()=>()=>clearTimeout(kioskPopupTimer.current),[]);
  useEffect(()=>{if(workspaceView)setView(MEDIA_HOSTED&&workspaceView==='testing'?'studio':workspaceView);},[workspaceView]);
  useEffect(()=>{if(embedded){onWorkspaceView?.(view);return;}const url=new URL(window.location.href);if(view==='studio')url.searchParams.delete('view');else url.searchParams.set('view',view);window.history.replaceState(null,'',url);},[view,embedded]);
  const uploadRequest=useRef(null),uploadBatchActive=useRef(false),cancelUploadBatch=useRef(false);
  const jobsPolling=useRef(false),knownJobs=useRef(new Map()),readyLibrarySignature=useRef(null);
  draftRef.current=draft;
  const assets=useMemo(()=>Object.fromEntries([...(station?.manifest?.assets || []),...library].map(asset=>[asset.id,asset])),[library,station?.manifest?.assets]);
  const zone=draft?.zones.find(item=>item.id===selected) || draft?.zones[0];
  const issues=useMemo(()=>validateDraft(draft,assets),[draft,assets]);
  const dirty=!!(draft && station && JSON.stringify(draft)!==JSON.stringify(draftOf(station.manifest)));
  const split=draft ? getSplit(draft.zones) : null;
  const filtered=library.filter(asset=>(filter==='all' || (filter==='video' ? assetIsVideo(asset) : !assetIsVideo(asset))) && asset.name.toLowerCase().includes(query.toLowerCase()));
  const telemetry=station?.telemetry;
  const reportedRevision=telemetry?.revision || 0;
  const lastSeen=telemetry?.lastSeen || telemetry?.receivedAt || telemetry?.reportedAt;
  const stale=telemetry?.stale === true || telemetry?.connectionStatus === 'offline' || ((telemetry?.stale === undefined && telemetry?.connectionStatus === undefined) && lastSeen && Date.now()-new Date(lastSeen).getTime()>15000);
  const playbackState=!telemetry ? 'Awaiting app' : stale || station?.deviceNetworkEnabled===false ? 'Offline' : telemetry.status==='playing' ? 'Playing' : telemetry.status==='downloading' ? 'Downloading' : telemetry.status==='error' ? 'Needs attention' : telemetry.status || 'Connected';
  const log=(message,tone='')=>setActivity(previous=>[{id:Date.now()+Math.random(),time:new Date().toISOString(),message,tone},...previous].slice(0,14));
  async function refresh(initial=false) {
    try {
      const current=await api(STATION_API);setStation(current);setConnected(true);setAccessProblem('');
      const previousAccessMessage=accessMessage.current;if(previousAccessMessage)setError(value=>value===previousAccessMessage?'':value);accessMessage.current='';
      if (initial || !draftRef.current) {setDraft(draftOf(current.manifest));setSelected(current.manifest.zones[0]?.id);}
      else if (JSON.stringify(draftRef.current?.stripeUi)!==JSON.stringify(current.manifest.stripeUi))setDraft(value=>withPublishedStripeUi(value,current.manifest));
      if (initial) {const result=await api('/library');setLibrary(result.assets);}
      try {if(MEDIA_HOSTED)return;const status=await api(`/device${STATION_API}/status`);setSlots(status.slots || []);} catch { /* Device outage intentionally leaves its last known slot snapshot. */ }
    } catch (failure) {setConnected(false);const access=MEDIA_HOSTED?mediaAccessProblem(failure):'';setAccessProblem(access);if(access)accessMessage.current=failure.message;if (initial || access) setError(MEDIA_HOSTED?failure.message:`Start the local lab server to load Media Studio. ${failure.message}`);}
  }
  async function refreshJobs() {
    if (jobsPolling.current) return;
    jobsPolling.current=true;
    try {
      const result=await api('/library/jobs');
      const incoming=(result.jobs || []).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
      const finished=incoming.filter(job=>job.status==='ready' && ['uploading','queued','processing'].includes(knownJobs.current.get(job.id)));
      const failed=incoming.filter(job=>job.status==='failed' && ['uploading','queued','processing'].includes(knownJobs.current.get(job.id)));
      setJobs(incoming);setJobStatusError('');
      knownJobs.current=new Map(incoming.map(job=>[job.id,job.status]));
      const signature=incoming.filter(job=>job.status==='ready').map(job=>`${job.id}:${job.asset?.id || ''}`).sort().join('|');
      if (readyLibrarySignature.current!==signature) {
        const currentLibrary=await api('/library');setLibrary(currentLibrary.assets);
        readyLibrarySignature.current=signature;
      }
      for (const job of finished) {
        setNotice(`${job.name} is ready for your playlist: ${prettyBytes(job.sourceBytes ?? job.asset?.optimization?.originalBytes)} → ${prettyBytes(job.asset?.bytes)}.`);
        log(`Optimized ${job.name} · ${prettyBytes(job.sourceBytes)} → ${prettyBytes(job.asset?.bytes)}`,'success');
      }
      for (const job of failed) log(`Video preparation failed · ${job.name}`);
    } catch {setJobStatusError('Video preparation status is unavailable. Reconnecting to the local server…');}
    finally {jobsPolling.current=false;}
  }
  useEffect(()=>{
    refresh(true);refreshJobs();
    const timer=setInterval(()=>refresh(),3000),jobTimer=setInterval(refreshJobs,2000);
    return ()=>{clearInterval(timer);clearInterval(jobTimer);clearTimeout(popupTimer.current);};
  },[]);
  async function cancelJob(id) {
    setCancellingJob(id);setError('');
    try {
      const result=await api(`/library/jobs/${encodeURIComponent(id)}`,{method:'DELETE'});
      if (result.job) {setJobs(current=>current.map(job=>job.id===id?result.job:job));knownJobs.current.set(id,result.job.status);}
      await refreshJobs();setNotice('Video preparation cancelled.');log('Cancelled video preparation');
    } catch(failure) {setError(failure.message);}
    finally {setCancellingJob('');}
  }
  function cancelTransfer() {
    cancelUploadBatch.current=true;
    uploadRequest.current?.abort();
  }

  useEffect(()=>{if (!notice) return;const timer=setTimeout(()=>setNotice(''),6500);return ()=>clearTimeout(timer);},[notice]);
  const updateZone=patch=>setDraft(value=>({...value,zones:value.zones.map(item=>item.id===zone.id?{...item,...patch}:item)}));
  const updateItem=(index,patch)=>updateZone({items:zone.items.map((item,i)=>i===index?{...item,...patch}:item)});
  const updatePopup=patch=>setDraft(value=>({...value,popup:{...value.popup,...patch}}));
  function setSplit(value) {setDraft(current=>{const currentSplit=getSplit(current.zones);if(!currentSplit)return current;const [a,b]=current.zones;const fraction=value/100;return {...current,zones:currentSplit.axis==='y'?[{...a,x:0,y:0,width:1,height:fraction},{...b,x:0,y:fraction,width:1,height:1-fraction}]:[{...a,x:0,y:0,width:fraction,height:1},{...b,x:fraction,y:0,width:1-fraction,height:1}]};});}
  function applyLayout(layout) {
    setDraft(current=>{
      const main={...(current.zones.find(item=>item.type==='playlist') || {type:'playlist',items:[],muted:true}),id:'main',x:0,y:0,width:1,height:1};
      const text={...(current.zones.find(item=>item.type==='text') || {type:'text',text:'Charge on the go.\nScan at the kiosk to rent.',background:'#216a4c'}),id:'instructions'};
      const image=library.find(asset=>!assetIsVideo(asset));
      const extra={id:'highlight',type:'playlist',muted:true,items:image?[{assetId:image.id,durationMs:10000,rotation:0,fit:'cover'}]:[]};
      const zones=layout==='full'?[main]:layout==='side'?[{...main,width:.65},{...text,x:.65,y:0,width:.35,height:1}]:layout==='three'?[{...main,height:.6},{...text,x:0,y:.6,width:.5,height:.4},{...extra,x:.5,y:.6,width:.5,height:.4}]:layout==='four'?[{...main,width:.5,height:.5},{...text,x:.5,y:0,width:.5,height:.5},{...extra,x:0,y:.5,width:.5,height:.5},{...text,id:'message-2',text:'Power for your next adventure.',x:.5,y:.5,width:.5,height:.5}]:[{...main,height:.65},{...text,x:0,y:.65,width:1,height:.35}];
      return {...current,zones};
    });setSelected('main');setInspector('zone');
  }
  function addAsset(asset) {
    if (!zone || zone.type!=='playlist') {setError('Choose a playlist zone before adding media.');return;}
    if (assetIsVideo(asset) && draft.zones.some(item=>item.id!==zone.id && item.items?.some(clip=>assetIsVideo(assets[clip.assetId])))) {setError('Videos already play in another zone. Keep video playback in one zone for this pilot.');return;}
    updateZone({items:[...(zone.items || []),{assetId:asset.id,durationMs:asset.durationMs || 10000,rotation:0,fit:'contain'}]});setNotice(`Added ${asset.name} to the selected playlist.`);
  }
  async function uploadFiles(files) {
    if (uploadBatchActive.current) return;
    uploadBatchActive.current=true;cancelUploadBatch.current=false;setError('');
    try {
      for (const file of [...files]) {
        if (cancelUploadBatch.current) break;
        const extension=file.name.split('.').pop().toLowerCase();
        const inferred=file.type || ({mp4:'video/mp4',mov:'video/quicktime',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}[extension]);
        if (!FORMATS.includes(inferred)) {setError(`${file.name}: choose an MP4, MOV, JPG, PNG or WebP file.`);continue;}
        const video=inferred.startsWith('video/');
        const limit=video?VIDEO_MAX_BYTES:IMAGE_MAX_BYTES;
        if (file.size>limit) {setError(`${file.name} is larger than the ${video?'2 GB video':'100 MB image'} limit.`);continue;}
        setUpload({name:file.name,percent:0,bytes:file.size,loaded:0,video});
        try {
          const uploadHeaders=await mediaHeaders({'Content-Type':inferred});
          if(cancelUploadBatch.current)break;
          const result=await new Promise((resolve,reject)=>{
            const request=new XMLHttpRequest();uploadRequest.current=request;
            request.open('POST',`${API}/library/${video?'video-upload':'upload'}?name=${encodeURIComponent(file.name)}`);
            for(const [name,value] of uploadHeaders)request.setRequestHeader(name,value);
            request.timeout=video?30*60*1000:120000;
            request.upload.onprogress=event=>event.lengthComputable && setUpload({name:file.name,percent:Math.round(event.loaded/event.total*100),bytes:file.size,loaded:event.loaded,video});
            request.onload=()=>{
              let body;try {body=JSON.parse(request.responseText);} catch {reject(new Error('The upload returned an unreadable response.'));return;}
              if (request.status>=200 && request.status<300) resolve(body);
              else reject(new Error(body.error?.message || 'Upload failed.'));
            };
            request.onabort=()=>reject(Object.assign(new Error('Upload cancelled.'),{name:'AbortError'}));
            request.onerror=()=>reject(new Error('Cannot reach the local lab server.'));
            request.ontimeout=()=>reject(new Error('The upload timed out. Please try again.'));
            request.send(file);
          });
          uploadRequest.current=null;setUpload(null);
          if (video) {
            if (!result.job?.id) throw new Error('The local server did not return a video preparation job.');
            knownJobs.current.set(result.job.id,result.job.status);
            setJobs(current=>[result.job,...current.filter(job=>job.id!==result.job.id)]);
            setNotice(`${file.name} uploaded. It is being optimized for playback.`);
            log(`Uploaded ${file.name} · video preparation queued`);
            refreshJobs();
          } else {
            if (!result.asset?.id) throw new Error('The local server did not return the uploaded image.');
            setLibrary(value=>[result.asset,...value.filter(item=>item.id!==result.asset.id)]);
            setNotice(`${file.name} is ready to add to a playlist.`);log(`Uploaded ${file.name}`);
          }
        } catch(failure) {
          if (failure.name==='AbortError') {setNotice(`Upload cancelled: ${file.name}`);log(`Cancelled upload · ${file.name}`);break;}
          setError(failure.message);
        } finally {uploadRequest.current=null;}
      }
    } finally {
      uploadBatchActive.current=false;setUpload(null);
      if(fileInput.current)fileInput.current.value='';
    }
  }
  async function publish() {
    if(issues.length){setError(issues[0]);return;}
    setBusy('publish');setError('');try {const latest=await api(STATION_API);const result=await post(`${STATION_API}/publish`,withPublishedStripeUi(draft,latest.manifest));setDraft(draftOf(result.manifest));setNotice(`Revision ${result.manifest.revision} published to the local Android app.`);log(`Published revision ${result.manifest.revision}`,'success');await refresh();}catch(failure){setError(failure.message);}finally{setBusy('');}
  }
  async function rollback(revision) {
    setBusy('rollback');setError('');try {const result=await post(`${STATION_API}/rollback`,{revision});setDraft(draftOf(result.manifest));setConfirmRevision(null);setNotice(`Restored revision ${revision} as revision ${result.manifest.revision}.`);log(`Restored revision ${revision}`);await refresh();}catch(failure){setError(failure.message);}finally{setBusy('');}
  }
  function showPopup(type, slot=eventSlot) {
    clearTimeout(popupTimer.current);
    if(type==='charger_returned'){const now=Date.now();setPopup(null);setDraftReturnEvent({eventId:`preview-${crypto.randomUUID()}`,stationId:STATION,type,slot,occurredAt:new Date(now).toISOString(),expiresAt:new Date(now+20000).toISOString()});return;}
    const key=type==='rental_dispensed'?'successTemplate':type==='charger_returned'?'returnTemplate':'failureTemplate';
    setPopup({type,slot,message:draft.popup[key].replaceAll('{slot}',String(slot))});popupTimer.current=setTimeout(()=>setPopup(null),draft.popup.durationMs);
  }
  async function simulate(type) {
    setBusy(type);setError('');try {await post(`${STATION_API}/simulate`,{type,slot:Number(eventSlot)});if(!type.startsWith('controller') && type!=='charger_returned')showPopup(type);log(`Simulated ${type.replaceAll('_',' ')}${type.startsWith('controller')?'':` · slot ${eventSlot}`}`);setNotice('Simulation sent to the local Android app.');await refresh();}catch(failure){setError(failure.message);}finally{setBusy('');}
  }
  async function setNetwork(enabled) {setBusy('network');setError('');try {await post('/lab/network',{enabled});await refresh();log(`Device network ${enabled?'restored':'disconnected'} in the simulator`);setNotice(enabled?'The app can reconnect to the local server.':'Device traffic is blocked. Cached media should keep playing.');}catch(failure){setError(failure.message);}finally{setBusy('');}}
  async function unlockStaff(event) {event.preventDefault();setBusy('staff');setError('');try {const result=await post('/device/staff/session',{pin});setStaffToken(result.token);setPin('');setNotice('Local staff controls unlocked.');}catch(failure){setError(failure.message);}finally{setBusy('');}}
  async function eject() {
    setBusy('eject');setError('');const slot=ejectSlot;try {
      const result=await api(`/device${STATION_API}/commands`,{method:'POST',headers:{Authorization:`Bearer ${staffToken}`},body:JSON.stringify({action:'eject',slot,idempotencyKey:crypto.randomUUID()})});
      setEjectSlot(null);log(`Eject requested · slot ${slot} · awaiting confirmation`);
      let outcome=result;
      for(let tries=0;tries<15;tries++){await new Promise(resolve=>setTimeout(resolve,600));outcome=await api(`/device${STATION_API}/commands/${result.requestId}`,{headers:{Authorization:`Bearer ${staffToken}`}});if(outcome.status!=='pending')break;}
      if(outcome.status==='succeeded'){showPopup('rental_dispensed',slot);setNotice(`Simulated release confirmed for slot ${slot}.`);log(`Simulated release confirmed · slot ${slot}`,'success');}
      else if(outcome.status==='failed')throw new Error(outcome.error?.message || outcome.error || 'The simulated controller rejected the release.');
      else setNotice('No confirmation received yet. Check device status before retrying.');
      await refresh();
    }catch(failure){setError(failure.message);}finally{setBusy('');}
  }

  return <div className={`ms-app ${embedded?'ms-embedded':''}`}>
    <main className="ms-main"><header className="ms-topbar"><div className="ms-header-title"><Icon name="media" size={24}/><h1>Media Studio</h1></div><div className="ms-header-actions"><Badge tone={connected?'green':'amber'}>{connected?(MEDIA_HOSTED?'Hosted service connected':'Local server connected'):(accessProblem || (MEDIA_HOSTED?'Hosted service unavailable':'Local server unavailable'))}</Badge><a href="?page=kiosk-control-lab" className="ms-header-icon" title="Kiosk Control" aria-label="Kiosk Control"><Icon name="monitor" size={24}/></a></div></header>
    <div className="ms-content"><div className="ms-page-heading"><div><div className="ms-eyebrow">VERSION 2 · ANDROID MEDIA</div><h1>{view==='studio'?'Media':view==='kiosk'?'Kiosk preview':'Device lab'}</h1><p>{view==='studio'?'Upload your media, arrange the screen, and publish when it’s ready.':view==='kiosk'?'Try the published media and payment experience together.':'Test payments, charger events, and recovery on this laptop.'}</p></div><div className="ms-heading-actions">{!embedded && <a className="ms-button" href="?page=kiosk-control-lab" title="Open Kiosk Control"><Icon name="monitor" size={17}/><span>Kiosk Control</span></a>}{view!=='studio' && <Button icon="layout" onClick={()=>setView('studio')}>Edit media</Button>}<a className="ms-button" href="?page=ui-profiles-lab" title="Edit Stripe customer screens"><Icon name="card" size={17}/><span>Stripe UI</span></a><Button icon="clock" onClick={()=>setHistoryOpen(!historyOpen)}>History</Button><Button icon="upload" variant="primary" onClick={publish} disabled={!draft || !!busy || !connected || issues.length>0}>{busy==='publish'?'Publishing…':(MEDIA_HOSTED?'Publish to kiosk':'Publish to lab')}</Button></div></div>
    <nav className="ms-mobile-navigation" aria-label="Media workspace sections">{[['studio','layout','Media'],['kiosk','play','Kiosk preview'],...(!MEDIA_HOSTED?[['testing','monitor','Device lab']]:[])].map(([target,icon,label])=><button key={target} type="button" className={view===target?'active':''} aria-current={view===target?'page':undefined} onClick={()=>setView(target)}><Icon name={icon} size={16}/><span>{label}</span></button>)}</nav>
    <div className="ms-context-strip"><div className="ms-device-name"><span className="ms-device-avatar"><Icon name="monitor"/></span><div><strong>{MEDIA_HOSTED?'US8004 · Hosted media':'US8004 · Laptop simulator'}</strong><small>{STATION} <span>·</span> {(view==='kiosk'?station?.manifest?.orientation:draft?.orientation)==='landscape'?'1920 × 1080':'1080 × 1920'} <span>·</span> Android preview</small></div></div><div className="ms-context-right"><Badge tone="purple">{MEDIA_HOSTED?'Hosted':'Simulation'}</Badge><span className={`ms-draft-state ${dirty?'dirty':''}`}><i/>{dirty?'Unpublished changes':'Draft matches published'}</span></div></div>
    {error && <div className="ms-alert error" role="alert"><Icon name="info"/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><Icon name="close" size={17}/></button></div>}
    {notice && <div className="ms-alert success" role="status"><Icon name="check"/><span>{notice}</span><button aria-label="Dismiss notice" onClick={()=>setNotice('')}><Icon name="close" size={17}/></button></div>}
    {historyOpen && <section className="ms-history"><div><h3>Published revisions</h3><p>Restoring creates a new revision. The app switches after all media is verified.</p></div><div>{station?.revisions?.slice().reverse().map(item=><button key={item.revision} onClick={()=>setConfirmRevision(item.revision)} disabled={!!busy || item.revision===station.manifest.revision}><strong>Revision {item.revision}</strong><span>{when(item.publishedAt)}{item.revision===station.manifest.revision?' · Current':''}</span><Icon name="reload" size={16}/></button>)}</div></section>}
    {!draft ? <div className="ms-loading"><Icon name="monitor" size={40}/><h2>{MEDIA_HOSTED?'Connect to hosted media':'Waiting for your local lab'}</h2><p>{MEDIA_HOSTED?'Sign in to the Client Dashboard with an administrator account, then retry.':'Start the lab server on port 8765, then load the sample layout.'}</p><Button icon="reload" onClick={()=>refresh(true)}>Retry connection</Button></div> : view==='studio' ? <>
      <div className="ms-studio-grid">
        <section className="ms-panel ms-library"><div className="ms-panel-title"><h2>Media library <span>{library.length}</span></h2><button className="ms-icon-button" aria-label="Upload media" disabled={!!upload} onClick={()=>fileInput.current.click()}><Icon name="plus"/></button></div><p className="ms-panel-description">Your content, ready for the screen.</p>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.mp4,.mov" multiple hidden onChange={event=>uploadFiles(event.target.files)}/>
          <button className="ms-upload-zone" onClick={()=>fileInput.current.click()} disabled={!!upload} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!upload)uploadFiles(event.dataTransfer.files);}}><span className="ms-upload-symbol"><Icon name="upload"/></span><strong>Drop media here</strong><span>or browse files</span><small>MP4 / MOV videos · up to 2 GB<br/>JPG / PNG / WebP images · up to 100 MB</small></button>
          <p className="ms-optimization-note">Videos are optimized automatically before they appear in your library.</p>
          {upload && <section className="ms-transfer" aria-label="Current file upload"><div><strong title={upload.name}>{upload.name}</strong><button type="button" onClick={cancelTransfer} disabled={upload.percent===100} aria-label={`Cancel upload of ${upload.name}`}>Cancel upload</button></div><div className="ms-transfer-status"><span>{upload.percent===100?'Finishing upload…':'Uploading'}</span><span>{upload.percent}%</span></div><progress max="100" value={upload.percent} aria-label={`Upload progress for ${upload.name}`}/><p>{prettyBytes(upload.loaded)} of {prettyBytes(upload.bytes)}{upload.video?' · Video preparation begins after upload.':''}</p></section>}
          <VideoJobs jobs={jobs} cancelling={cancellingJob} onCancel={cancelJob} statusError={jobStatusError}/>

          <input className="ms-search" aria-label="Search media library" placeholder="Search your media…" value={query} onChange={event=>setQuery(event.target.value)}/><div className="ms-filter-tabs">{[['all','All files'],['video','Videos'],['image','Images']].map(([value,label])=><button key={value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{label}</button>)}</div>
          <div className="ms-asset-list">{filtered.map(asset=><article className="ms-asset-card" key={asset.id}><div className={`ms-asset-thumb ${assetIsVideo(asset)?'video':''}`}>{assetIsVideo(asset)?<><AssetThumbnail asset={asset}/><span className="ms-video-tag"><Icon name="play" size={12}/>{asset.durationMs ? `${Math.round(asset.durationMs/1000)}s`:'Video'}</span></>:<AssetThumbnail asset={asset}/>}<button title={`Add ${asset.name} to selected zone`} aria-label={`Add ${asset.name} to selected zone`} onClick={()=>addAsset(asset)} disabled={zone.type!=='playlist'}><Icon name="plus" size={19}/></button></div><strong title={asset.name}>{asset.name}</strong><small>{asset.width && asset.height ? `${asset.width} × ${asset.height} · `:''}{prettyBytes(asset.bytes)}</small>{asset.optimization && <small className="ms-asset-optimized" title={`Original: ${prettyBytes(asset.optimization.originalBytes)}. Optimized for kiosk playback: ${prettyBytes(asset.bytes)}.`}><Icon name="check" size={10}/>{prettyBytes(asset.optimization.originalBytes)} → {prettyBytes(asset.bytes)}</small>}</article>)}</div>{!filtered.length && <div className="ms-empty-library"><Icon name="folder" size={28}/><p>{query?'No matching media.':'Your library is ready for its first upload.'}</p></div>}<div className="ms-library-note"><Icon name="info" size={15}/><span>Choose a playlist zone, then tap + to add media.</span></div>
        </section>
        <section className="ms-canvas-panel"><div className="ms-canvas-toolbar"><span><i className="ms-live-dot"/>Draft preview</span><button className={guides?'active':''} onClick={()=>setGuides(!guides)}><Icon name="layout" size={15}/>Zone guides</button></div><div className="ms-canvas-area"><Preview draft={draft} assets={assets} selected={selected} onSelect={setSelected} popup={popup} split={split} onSplit={setSplit} showGuides={guides} language={draftLanguage} checkout={checkout} checkoutNode={<CheckoutPanel checkout={draftCheckout} previewOnly stripeUi={draft.stripeUi} height={draft.checkout?.height} viewportWidth={draft.orientation==='landscape'?1920:1080} viewportHeight={draft.orientation==='landscape'?1080:1920} onLanguageChange={setDraftLanguage}/>}/></div><div className="ms-preview-caption"><Icon name="move" size={15}/><span>{split?'Drag the divider to adjust your split.':'Select a zone to edit its content.'}</span></div><div className="ms-preview-status"><span><Icon name="monitor" size={16}/>{draft.zones.length} {draft.zones.length===1?'zone':'zones'}</span><span>{draft.checkout?.enabled?`Full-screen media · ${Math.round(draft.checkout.height*100)}% expanded card`:'Muted playback'}</span><span>{draft.orientation==='portrait'?'9:16':'16:9'}</span></div></section>
        <section className="ms-panel ms-inspector"><div className="ms-inspector-tabs">{[['zone','Content'],['layout','Layout'],['messages','Pop-ups']].map(([value,label])=><button key={value} onClick={()=>setInspector(value)} className={inspector===value?'active':''}>{label}</button>)}</div>
          {inspector==='layout' ? <div className="ms-inspector-body"><h2>Screen layout</h2><p className="ms-panel-description">Choose your media layout and bottom payment area.</p><div className="ms-payment-layout-control"><label><span><strong>Payment panel</strong><small>Float rental controls over the media.</small></span><input aria-label="Enable bottom payment panel" type="checkbox" checked={!!draft.checkout?.enabled} onChange={event=>setDraft(value=>({...value,checkout:{enabled:event.target.checked,height:value.checkout?.height || .32}}))}/></label>{draft.checkout?.enabled && <Field label={`Bottom panel · ${Math.round(draft.checkout.height*100)}%`} help="Sets the expanded card height. Media stays full screen."><input type="range" aria-label="Bottom payment panel height" min={PAYMENT_MIN_HEIGHT*100} max={PAYMENT_MAX_HEIGHT*100} step="1" value={Math.round(draft.checkout.height*100)} onChange={event=>setDraft(value=>({...value,checkout:{...value.checkout,height:Number(event.target.value)/100}}))}/><div className="ms-range-labels"><span>10%</span><span>50%</span></div></Field>}</div><h3>Media area</h3><div className="ms-layout-presets">{[['full','Full screen'],['stack','Top / bottom'],['side','Side by side'],['three','Three zones'],['four','Four zones']].map(([value,label])=><button key={value} onClick={()=>applyLayout(value)}><span className={`ms-layout-icon ${value}`}><i/><i/><i/><i/></span><small>{label}</small></button>)}</div><Field label="Screen orientation"><select value={draft.orientation} onChange={event=>setDraft(value=>({...value,orientation:event.target.value}))}><option value="portrait">Portrait · 1080 × 1920</option><option value="landscape">Landscape · 1920 × 1080</option></select></Field>{split && <Field label={`First zone · ${split.value}%`} help="Drag the screen divider or use the slider."><input aria-label="Screen split percentage" type="range" min="20" max="80" value={split.value} onChange={event=>setSplit(Number(event.target.value))}/><div className="ms-range-labels"><span>20%</span><span>80%</span></div></Field>}<Field label="Screen background"><div className="ms-color-input"><input aria-label="Screen background color" type="color" value={draft.background} onChange={event=>setDraft(value=>({...value,background:event.target.value}))}/><span>{draft.background}</span></div></Field><div className="ms-section-divider"/><h3>Fine-tune zone positions</h3><p className="ms-panel-description">Select a zone, then set its area within the media region.</p><select aria-label="Zone to position" value={zone.id} onChange={event=>setSelected(event.target.value)}>{draft.zones.map((item,index)=><option value={item.id} key={item.id}>Zone {index+1} · {item.type}</option>)}</select><div className="ms-position-grid">{[['x','Left'],['y','Top'],['width','Width'],['height','Height']].map(([property,label])=><Field key={property} label={`${label} %`}><input aria-label={`${label} percent`} type="number" min={property==='width'||property==='height'?1:0} max="100" step="1" value={Math.round(zone[property]*10000)/100} onChange={event=>updateZone({[property]:Number(event.target.value)/100})}/></Field>)}</div><div className="ms-help"><Icon name="info" size={17}/><p>This pilot supports four zones and one zone with video playback.</p></div></div> : inspector==='messages' ? <div className="ms-inspector-body">{draft.stripeUi?<><h2>Customer pop-ups</h2><p className="ms-panel-description">This screen uses the Stripe UI profile’s translated pop-up messages. Edit them with the rest of the customer screens.</p><a className="ms-button full" href="?page=ui-profiles-lab"><Icon name="card" size={17}/><span>Edit Stripe UI</span></a><Button icon="play" variant="subtle full" onClick={()=>showPopup('rental_dispensed')}>Preview release message</Button><Button icon="play" variant="subtle full" onClick={()=>showPopup('charger_returned')}>Preview return message</Button><Button icon="play" variant="subtle full" onClick={()=>showPopup('rental_failed')}>Preview failure message</Button></>:<><h2>Rental pop-ups</h2><p className="ms-panel-description">Helpful messages over your playing media.</p><Field label="Charger released" help="Use {slot} to show the confirmed slot number."><textarea rows="3" value={draft.popup.successTemplate} onChange={event=>updatePopup({successTemplate:event.target.value})}/></Field><Button icon="play" variant="subtle full" onClick={()=>showPopup('rental_dispensed')}>Preview release message</Button><Field label="Charger returned"><textarea rows="2" value={draft.popup.returnTemplate} onChange={event=>updatePopup({returnTemplate:event.target.value})}/></Field><Button icon="play" variant="subtle full" onClick={()=>showPopup('charger_returned')}>Preview return message</Button><Field label="Release unsuccessful"><textarea rows="3" value={draft.popup.failureTemplate} onChange={event=>updatePopup({failureTemplate:event.target.value})}/></Field><Button icon="play" variant="subtle full" onClick={()=>showPopup('rental_failed')}>Preview failure message</Button><Field label="Visible for"><select value={draft.popup.durationMs} onChange={event=>updatePopup({durationMs:Number(event.target.value)})}>{[3000,5000,8000,10000,15000].map(value=><option key={value} value={value}>{value/1000} seconds</option>)}</select></Field><div className="ms-help"><Icon name="shield" size={18}/><p>The app shows success after the controller confirms a release.</p></div></>}</div> : <div className="ms-inspector-body"><div className="ms-zone-heading"><span className="ms-zone-number">{String(draft.zones.indexOf(zone)+1).padStart(2,'0')}</span><div><h2>{zone.type==='text'?'Message zone':'Media playlist'}</h2><small>{Math.round(zone.width*100)}% wide · {Math.round(zone.height*100)}% tall</small></div></div><div className="ms-zone-selector">{draft.zones.map((item,index)=><button key={item.id} className={zone.id===item.id?'active':''} onClick={()=>setSelected(item.id)}>Zone {index+1}</button>)}</div><Field label="Zone content"><select value={zone.type} onChange={event=>updateZone(event.target.value==='text'?{type:'text',text:zone.text || 'Charge on the go.',background:zone.background || '#216a4c'}:{type:'playlist',items:zone.items || [],muted:true})}><option value="playlist">Media playlist</option><option value="text">Text message</option></select></Field>{zone.type==='text'?<><Field label="Your message"><textarea rows="5" value={zone.text || ''} onChange={event=>updateZone({text:event.target.value})}/></Field><Field label="Zone background"><div className="ms-color-input"><input type="color" aria-label="Zone background color" value={zone.background || '#216a4c'} onChange={event=>updateZone({background:event.target.value})}/><span>{zone.background || '#216a4c'}</span></div></Field><div className="ms-help"><Icon name="message" size={18}/><p>Keep the message short so it is readable at a glance.</p></div></>:<><div className="ms-playlist-heading"><strong>Playlist order</strong><span>{zone.items?.length || 0} items</span></div><p className="ms-panel-description">Plays in order, then loops automatically.</p><div className="ms-playlist-items">{zone.items?.map((item,index)=>{const asset=assets[item.assetId];return <div className="ms-playlist-item" key={`${item.assetId}-${index}`}><div className="ms-playlist-item-header"><span className="ms-item-count">{index+1}</span><Icon name={assetIsVideo(asset)?'play':'image'} size={17}/><strong title={asset?.name}>{asset?.name || 'Missing asset'}</strong><button className="ms-icon-button" aria-label={`Remove ${asset?.name} from playlist`} onClick={()=>updateZone({items:zone.items.filter((_,i)=>i!==index)})}><Icon name="trash" size={16}/></button></div><div className="ms-item-options"><Field label={assetIsVideo(asset)?'Plays in full':'Duration (sec)'}>{assetIsVideo(asset)?<div className="ms-video-duration">{asset.durationMs ? `${(asset.durationMs/1000).toFixed(0)} sec`:'Full video'}</div>:<input aria-label={`Duration for ${asset?.name}`} type="number" min="1" max="3600" value={item.durationMs/1000} onChange={event=>updateItem(index,{durationMs:Math.min(3600,Math.max(1,Number(event.target.value)))*1000})}/>}</Field><Field label="Rotation"><select aria-label={`Rotation for ${asset?.name}`} value={item.rotation} onChange={event=>updateItem(index,{rotation:Number(event.target.value)})}>{[0,90,180,270].map(value=><option value={value} key={value}>{value}°</option>)}</select></Field><Field label="Fit"><select aria-label={`Fit for ${asset?.name}`} value={item.fit} onChange={event=>updateItem(index,{fit:event.target.value})}><option value="contain">Fit</option><option value="cover">Fill</option></select></Field></div><div className="ms-item-reorder"><button disabled={index===0} onClick={()=>{const items=[...zone.items];[items[index-1],items[index]]=[items[index],items[index-1]];updateZone({items});}}>Move up</button><button disabled={index===zone.items.length-1} onClick={()=>{const items=[...zone.items];[items[index+1],items[index]]=[items[index],items[index+1]];updateZone({items});}}>Move down</button></div></div>;})}</div>{!zone.items?.length && <div className="ms-playlist-empty"><Icon name="plus" size={25}/><p>Add a file from the media library to start your playlist.</p></div>}<div className="ms-help"><Icon name="reload" size={17}/><p>Media downloads before playback and stays available offline.</p></div></>}</div>}
        </section>
      </div>{issues.length>0 && <div className="ms-validation" role="status"><Icon name="info"/><div><strong>Before you publish</strong>{issues.map(issue=><p key={issue}>{issue}</p>)}</div></div>}
      <section className="ms-publish-bar"><div><span className="ms-publish-icon"><Icon name="wifi" size={23}/></span><div><h3>Local Android app</h3><p>{!telemetry?'Launch the emulator app to start receiving playback reports.':`Last report ${when(lastSeen)} · ${telemetry.deviceId || 'Android player'}`}</p></div></div><div className="ms-revision-stat"><small>Published</small><strong>Revision {station?.manifest.revision || '—'}</strong></div><div className="ms-revision-stat"><small>Reported by app</small><strong>{reportedRevision?`Revision ${reportedRevision}`:'Not connected'}</strong></div><Badge tone={playbackState==='Playing'?'green':playbackState==='Needs attention'?'red':'amber'}>{playbackState}</Badge><button className="ms-text-button" onClick={()=>setView('testing')}>Open device lab <Icon name="arrow" size={16}/></button></section>
    </> : view==='kiosk' ? <div className="ms-public-preview-layout"><section className="ms-public-stage"><div className="ms-public-stage-header"><span><i/>Published kiosk screen</span><span>Revision {station.manifest.revision}</span></div><div className="ms-public-screen-wrap"><Preview draft={station.manifest} assets={assets} popup={kioskPopup} showGuides={false} language={kioskLanguage} checkout={checkout} checkoutNode={<CheckoutPanel checkout={checkout} stripeUi={station.manifest.stripeUi} height={station.manifest.checkout?.height} viewportWidth={station.manifest.orientation==='landscape'?1920:1080} viewportHeight={station.manifest.orientation==='landscape'?1080:1920} onLanguageChange={setKioskLanguage}/>}/></div><div className="ms-public-stage-footer"><span>Media keeps playing during payment</span><span>Audio muted</span></div></section><aside className="ms-public-guide"><span className="ms-badge purple"><i/>Local simulation</span><h2>Full-screen media. Floating checkout.</h2><p>The screen uses your published layout. Try a rental with the simulated card reader while the media continues playing.</p><ol><li><span>1</span><div><strong>Start a rental</strong><p>Tap Start, choose Rent, and review the price shown on screen.</p></div></li><li><span>2</span><div><strong>Present a card from staff controls</strong><p>Choose the waiting rental in Payment scenarios and present a simulated card.</p></div></li><li><span>3</span><div><strong>Wait for the slot</strong><p>Success appears only when the module confirms a charger was released.</p></div></li></ol>{!station.manifest.checkout?.enabled && <div className="ms-public-payment-off"><strong>Payment panel is off</strong><p>Enable it in Layout, then publish to see the combined screen here.</p><Button icon="layout" onClick={()=>{setView('studio');setInspector('layout');}}>Open layout settings</Button></div>}<div className="ms-public-info"><strong>Browser checkout</strong><p>{checkout.recovering?'Restoring rental…':!checkout.connected?'Connection unavailable':checkout.interaction?`${checkout.interaction.phase.replaceAll('_',' ')} · ${checkout.interaction.moneyStatus}`:'Ready for a new rental'}</p><small>No real card is charged.</small></div><Button icon="gear" variant="full" onClick={()=>setView('testing')}>Open payment scenarios</Button>{dirty && <p className="ms-public-draft-note">Your latest draft changes are not published yet.</p>}</aside></div> : <div className="ms-test-grid"><div className="ms-test-left"><PaymentScenarioControls checkout={checkout}/>
<section className="ms-panel ms-test-card"><div className="ms-card-heading"><div><h2>Device connection</h2><p className="ms-panel-description">Test recovery without touching a kiosk.</p></div><Badge tone={station.deviceNetworkEnabled?'green':'amber'}>{station.deviceNetworkEnabled?'Network available':'Network disconnected'}</Badge></div><div className="ms-device-stats"><div><small>Published revision</small><strong>{station.manifest.revision}</strong></div><div><small>Reported revision</small><strong>{reportedRevision || '—'}</strong></div><div><small>Playback state</small><strong>{playbackState}</strong></div><div><small>Available storage</small><strong>{telemetry?.freeBytes ? prettyBytes(telemetry.freeBytes) : '—'}</strong></div></div><div className="ms-toggle-row"><div><strong>Device network</strong><small>When disconnected, downloaded media should continue playing.</small></div><Button icon="wifi" onClick={()=>setNetwork(!station.deviceNetworkEnabled)} disabled={!!busy}>{station.deviceNetworkEnabled?'Disconnect network':'Restore network'}</Button></div><div className="ms-toggle-row"><div><strong>Module controller</strong><small>The controller can fail independently of media playback.</small></div><Button icon="gear" onClick={()=>simulate(station.controllerOnline?'controller_offline':'controller_online')} disabled={!!busy}>{station.controllerOnline?'Simulate controller offline':'Restore controller'}</Button></div>{telemetry?.lastError && <div className="ms-alert error"><Icon name="info"/><span>{telemetry.lastError}</span></div>}</section>
      <section className="ms-panel ms-test-card"><div className="ms-card-heading"><div><h2>Rental events</h2><p className="ms-panel-description">Send a simulated event to the Android app.</p></div><Badge tone="purple">Simulated</Badge></div><div className="ms-event-controls"><Field label="Slot"><select aria-label="Event slot" value={eventSlot} onChange={event=>setEventSlot(Number(event.target.value))}>{(slots.length?slots:Array.from({length:8},(_,i)=>({slot:i+1}))).map(item=><option key={item.slot} value={item.slot}>Slot {item.slot}{item.status?` · ${item.status}`:''}</option>)}</select></Field><Button icon="bolt" onClick={()=>simulate('rental_dispensed')} disabled={!!busy}>Charger released</Button><Button icon="reload" onClick={()=>simulate('charger_returned')} disabled={!!busy}>Charger returned</Button><Button icon="info" onClick={()=>simulate('rental_failed')} disabled={!!busy}>Release failed</Button></div><div className="ms-help"><Icon name="info" size={17}/><p>These events are simulated physical outcomes. Available slots accept releases; empty slots accept returns.</p></div></section>
      <section className="ms-panel ms-test-card"><div className="ms-card-heading"><div><h2>Staff eject controls</h2><p className="ms-panel-description">Local replica of the app’s authenticated module panel.</p></div><Badge tone={station.controllerOnline?'green':'amber'}>{station.controllerOnline?'Controller online':'Controller offline'}</Badge></div>{!staffToken?<form className="ms-staff-form" onSubmit={unlockStaff}><Field label="Local staff PIN"><input aria-label="Local staff PIN" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={event=>setPin(event.target.value)} placeholder="Enter staff PIN"/></Field><Button icon="shield" variant="primary" type="submit" disabled={!!busy || !pin}>Unlock controls</Button><p>Staff PIN: <strong>2468</strong> · local simulator only</p></form>:<><div className="ms-slot-grid">{slots.map(item=><button className={`ms-slot ${item.status}`} key={item.slot} disabled={!!busy || item.status!=='available' || !station.controllerOnline || !station.deviceNetworkEnabled} onClick={()=>setEjectSlot(item.slot)}><span>Slot {String(item.slot).padStart(2,'0')}</span><Icon name="bolt" size={28}/><strong>{item.status==='available'?`${item.battery ?? '—'}%`:item.status}</strong><small>{item.status==='available'?'Tap to eject':item.status==='locked'?'Unavailable':'Awaiting return'}</small></button>)}</div><div className="ms-staff-footer"><span><Icon name="shield" size={15}/>Staff session active</span><button onClick={()=>{setStaffToken('');setEjectSlot(null);}}>Lock controls</button></div></>}</section>
      <section className="ms-panel ms-test-card"><div className="ms-card-heading"><h2>Lab activity</h2><span className="ms-muted">This browser session</span></div>{!activity.length?<p className="ms-panel-description">Publish content or run a simulation to see activity here.</p>:<ul className="ms-activity">{activity.map(item=><li key={item.id}><span className={item.tone || ''}><Icon name={item.tone==='success'?'check':'clock'} size={16}/></span><p>{item.message}</p><time>{when(item.time)}</time></li>)}</ul>}</section>
    </div><div className="ms-test-preview"><div className="ms-canvas-toolbar"><span><i className="ms-live-dot"/>Draft event preview</span></div><Preview draft={draft} assets={assets} selected={null} popup={popup} showGuides={false} language={draftLanguage} checkout={checkout} checkoutNode={<CheckoutPanel checkout={draftCheckout} previewOnly stripeUi={draft.stripeUi} height={draft.checkout?.height} viewportWidth={draft.orientation==='landscape'?1920:1080} viewportHeight={draft.orientation==='landscape'?1080:1920} onLanguageChange={setDraftLanguage}/>}/><p>This preview uses your draft. The Android app plays the published revision.</p><div className="ms-test-checklist"><h3>Suggested test order</h3><ol><li>Publish a layout and confirm its revision in the app.</li><li>Simulate release, return and failure pop-ups.</li><li>Use staff controls to request an eject.</li><li>Disconnect the network and restart the app.</li><li>Reconnect, publish new media, then restore a revision.</li></ol></div></div></div>}
    <footer className="ms-footer"><span>Chargerent Media Studio <span>·</span> Local development pilot</span><span>{MEDIA_HOSTED?'Files and commands use the hosted service':'Files and commands stay on this laptop'} <Icon name="shield" size={14}/></span></footer></div></main>
    {confirmRevision!==null && <div className="ms-modal-backdrop" onClick={()=>setConfirmRevision(null)}><div className="ms-modal" role="dialog" aria-modal="true" aria-labelledby="ms-restore-title" onClick={event=>event.stopPropagation()}><span className="ms-modal-icon"><Icon name="reload" size={27}/></span><h2 id="ms-restore-title">Restore revision {confirmRevision}?</h2><p>This publishes a new revision using the previous layout and media. Your current draft will be replaced.</p><div><Button onClick={()=>setConfirmRevision(null)}>Cancel</Button><Button variant="primary" disabled={!!busy} onClick={()=>rollback(confirmRevision)}>Restore revision</Button></div></div></div>}
    {ejectSlot!==null && <div className="ms-modal-backdrop"><div className="ms-modal" role="dialog" aria-modal="true" aria-labelledby="ms-eject-title"><span className="ms-modal-icon"><Icon name="bolt" size={28}/></span><Badge tone="purple">Local simulation</Badge><h2 id="ms-eject-title">Eject charger from slot {ejectSlot}?</h2><p>The lab controller will simulate a release. Success appears only after the simulated confirmation.</p><div><Button onClick={()=>setEjectSlot(null)} disabled={busy==='eject'}>Cancel</Button><Button variant="primary" onClick={eject} disabled={!!busy}>{busy==='eject'?'Requesting…':'Confirm simulated eject'}</Button></div></div></div>}
  </div>;
}
