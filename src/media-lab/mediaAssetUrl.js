import {useEffect,useState} from 'react';
import {MEDIA_HOSTED,mediaFetch,mediaUrl} from './mediaApi.js';
const entries=new Map();
function entryFor(id) {
  if(!entries.has(id))entries.set(id,{url:'',expiresAt:0,access:null,listeners:new Set(),timer:null,pending:null});
  return entries.get(id);
}
async function refresh(id,entry) {
  if(entry.pending)return entry.pending;
  entry.pending=(async()=>{
    try {
      const response=await mediaFetch(`/api/assets/${id}/access`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access:entry.access}),signal:AbortSignal.timeout(10000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Media preview unavailable.');
      const next=mediaUrl(result.url);entry.access=new URL(next).searchParams.get('access');entry.url=next;entry.expiresAt=Date.parse(result.expiresAt);
      for(const notify of entry.listeners)notify(next);
    } catch {if(entry.expiresAt<=Date.now()){entry.url='';for(const notify of entry.listeners)notify('');}}
    finally {
      entry.pending=null;clearTimeout(entry.timer);
      if(entry.listeners.size)entry.timer=setTimeout(()=>refresh(id,entry),Math.max(10000,Math.min(240000,entry.expiresAt-Date.now()-30000)));
    }
  })();return entry.pending;
}
/** Renew the same scoped URL while mounted so a grant refresh never restarts media. */
export function useMediaAssetUrl(asset) {
  const id=asset?.id;
  const [url,setUrl]=useState(()=>id?(MEDIA_HOSTED?entryFor(id).url:mediaUrl(`/api/assets/${id}/content`)):'');
  useEffect(()=>{
    if(!id){setUrl('');return;}
    if(!MEDIA_HOSTED){setUrl(mediaUrl(`/api/assets/${id}/content`));return;}
    const entry=entryFor(id);setUrl(entry.url);entry.listeners.add(setUrl);
    if(entry.expiresAt<Date.now()+45000)refresh(id,entry);
    else if(!entry.timer)entry.timer=setTimeout(()=>refresh(id,entry),Math.max(1000,entry.expiresAt-Date.now()-30000));
    return()=>{entry.listeners.delete(setUrl);if(!entry.listeners.size){clearTimeout(entry.timer);entry.timer=null;}};
  },[id]);
  return url;
}
