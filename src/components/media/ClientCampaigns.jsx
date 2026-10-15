import {useCallback,useEffect,useRef,useState} from 'react';
import {campaignRequest} from '../../utils/campaignApi.js';
import MediaCampaignWizard from './MediaCampaignWizard.jsx';
import {mediaAccessProblem} from '../../integrated-media/mediaApi.js';
import {campaignsForClient} from '../../utils/mediaCampaign.js';

const EMPTY_KIOSKS=Object.freeze([]);

export default function ClientCampaigns({clientId,kiosks=EMPTY_KIOSKS,referenceTime,onStatus,onDirtyChange,request=campaignRequest,listDevices,previewMode=false}) {
  const [campaigns,setCampaigns]=useState([]);
  const [editor,setEditor]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [working,setWorking]=useState(false);
  const [delivery,setDelivery]=useState({});
  const [serviceReady,setServiceReady]=useState(false);
  const dirty=useRef(false),sequence=useRef(0),editorSequence=useRef(0);
  const dirtyChanged=useCallback(value=>{dirty.current=value;onDirtyChange?.(value);},[onDirtyChange]);
  useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
  const refresh=useCallback(async()=>{
    const attempt=++sequence.current;
    try {
      const result=await request(`/campaigns?clientId=${encodeURIComponent(clientId)}`);
      if(attempt!==sequence.current)return;
      setCampaigns(campaignsForClient(result.campaigns,clientId,kiosks));
      setServiceReady(result.capabilities?.clientCampaigns===1);setError('');
    } catch(failure){if(attempt===sequence.current)setError(mediaAccessProblem(failure)||failure.message);}
    finally {if(attempt===sequence.current)setLoading(false);}
  },[clientId,kiosks,request]);
  useEffect(()=>{refresh();return()=>{sequence.current+=1;};},[refresh]);
  useEffect(()=>{
    if(editor)return undefined;
    let active=true;
    const update=async()=>{
      const results=await Promise.all(campaigns.filter(item=>item.revision&&item.stationIds?.length).map(async item=>{
        try {return [item.id,(await request(`/campaigns/${item.id}/status`)).campaign?.stations||[]];}
        catch {return [item.id,null];}
      }));
      if(active)setDelivery(Object.fromEntries(results));
    };
    update();const timer=window.setInterval(update,10000);
    return()=>{active=false;window.clearInterval(timer);};
  },[campaigns,editor,request]);
  const leaveEditor=()=>{
    if(dirty.current&&!window.confirm('Discard unsaved campaign changes?'))return;
    setEditor(null);dirtyChanged(false);refresh();
  };
  const edit=async campaign=>{
    if(!serviceReady)return;
    setWorking(true);
    try {
      const result=await request(`/campaigns/${campaign.id}`);
      setEditor({key:`${campaign.id}:${++editorSequence.current}`,campaign:result.campaign});
    } catch(failure){onStatus?.({state:'error',message:failure.message});}
    finally {setWorking(false);}
  };
  const restore=async campaign=>{
    if(!serviceReady)return;
    setWorking(true);
    try {
      const detail=(await request(`/campaigns/${campaign.id}`)).campaign;
      const previous=detail.history.at(-1);
      if(!previous)return;
      await request(`/campaigns/${campaign.id}/restore`,{method:'POST',body:JSON.stringify({revision:previous.revision,expectedVersion:detail.editVersion})});
      await edit(campaign);
      onStatus?.({state:'success',message:'Previous version restored as a draft. Review and publish when ready.'});
    } catch(failure){onStatus?.({state:'error',message:failure.message});}
    finally {setWorking(false);}
  };
  if(!clientId)return <p>Select a client to manage its campaigns.</p>;
  if(editor)return <MediaCampaignWizard key={editor.key} clientId={clientId} initialCampaign={editor.campaign} campaigns={campaigns} kiosks={kiosks} referenceTime={referenceTime} onStatus={onStatus} onDirtyChange={dirtyChanged} onCancel={leaveEditor} apiRequest={request} listDevices={listDevices} previewMode={previewMode}
    onSaved={campaign=>{setCampaigns(items=>[campaign,...items.filter(item=>item.id!==campaign.id)]);refresh();}}/>;
  return <div data-client-campaigns={clientId} className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">{clientId} campaigns</h3><p className="mt-1 text-sm text-slate-500">Create or edit campaigns for this client. Saving a draft keeps the published version playing.</p></div><button type="button" disabled={loading||working||Boolean(error)||!serviceReady} onClick={()=>setEditor({key:`new:${++editorSequence.current}`,campaign:null})} className="rounded-xl bg-cyan-800 px-4 py-2.5 font-semibold text-white disabled:opacity-40">New campaign</button></div>
    {!loading&&!error&&!serviceReady&&<p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Campaigns are filtered using this client’s kiosk assignments. The media service update is required to create or edit client-owned campaigns.</p>}
    {loading?<p role="status">Loading campaigns…</p>:error?<div role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">{error}<button type="button" className="ml-3 underline" onClick={refresh}>Retry</button></div>:<>
      {!campaigns.length&&<div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No campaigns for {clientId} yet.</div>}
      {campaigns.map(campaign=><article key={campaign.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-4" data-campaign-id={campaign.id}>
        <div><h4 className="font-bold">{campaign.name}</h4><p className="mt-1 text-sm text-slate-500">{campaign.clientId||'Client assignment required'} · {campaign.hasDraft?'Draft changes':campaign.revision?'Published':'Draft'} · {(campaign.stationIds||[]).join(', ')||'No kiosks published'}</p><p className="mt-1 text-xs text-slate-400">Last published: {campaign.publishedAt?new Date(campaign.publishedAt).toLocaleString():'Never'}</p>
          {delivery[campaign.id]?.map(station=><span key={station.stationId} data-campaign-status={station.state} className="mr-3 mt-2 inline-block text-xs font-semibold">{station.stationId}: {station.label}</span>)}
          {delivery[campaign.id]===null&&<p className="mt-2 text-xs text-amber-800">Playback status temporarily unavailable.</p>}
          {campaign.needsClientAssignment&&<p className="mt-2 text-xs text-amber-800">{campaign.clientId?'Client verified from its current kiosks. Save this campaign to record ownership.':'Review this legacy campaign and select kiosks belonging to this client before saving.'}</p>}
        </div><div className="flex gap-2"><button type="button" disabled={working||!serviceReady} onClick={()=>edit(campaign)} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-40">Edit</button>{campaign.historyCount>0&&<button type="button" disabled={working||!serviceReady} onClick={()=>restore(campaign)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-40">Restore previous draft</button>}</div>
      </article>)}
    </>}
  </div>;
}
