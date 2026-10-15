import {useEffect,useMemo,useState} from 'react';
import {campaignRequest} from '../utils/campaignApi.js';
import ClientCampaigns from '../components/media/ClientCampaigns.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import DashboardPageActions from '../components/UI/DashboardPageActions.jsx';
import {filterStationsForClient} from '../utils/helpers.js';

// Campaign-only operators use the same workspace without loading UI/payment settings.
export default function ClientCampaignWorkspace({currentUser,allStationsData=[],initialClientId='',onLogout,onNavigateToDashboard,onNavigateToAdmin,onNavigateToUiEditor,referenceTime,t,request=campaignRequest,listDevices}) {
  const [clients,setClients]=useState([]),[clientId,setClientId]=useState(initialClientId),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[status,setStatus]=useState(null);
  const kiosks=useMemo(()=>filterStationsForClient(allStationsData,currentUser),[allStationsData,currentUser]);
  useEffect(()=>{
    let active=true;
    request('/campaign-clients').then(result=>{
      if(!active)return;
      const items=result.clients||[];setClients(items);
      setClientId(value=>items.some(item=>item.clientId===value)?value:items[0]?.clientId||'');
    }).catch(failure=>active&&setError(failure.message));
    return()=>{active=false;};
  },[request]);
  return <div className="min-h-screen bg-slate-100 text-slate-900"><CommandStatusToast status={status} onDismiss={()=>setStatus(null)}/><header className="bg-white shadow-sm"><div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-6 py-4"><h1 className="text-2xl font-bold">Client profiles · Campaigns</h1><DashboardPageActions onLogout={onLogout} onNavigateToDashboard={onNavigateToDashboard} onNavigateToAdmin={onNavigateToAdmin} t={t}/></div></header><main className="mx-auto max-w-screen-2xl space-y-5 p-6"><label className="block font-semibold">Client<select aria-label="Campaign client" value={clientId} className="ml-3 rounded-lg border border-slate-300 p-2" onChange={event=>{if(dirty&&!window.confirm('Discard unsaved campaign changes?'))return;setClientId(event.target.value);setDirty(false);}}>{clients.map(item=><option key={item.clientId} value={item.clientId}>{item.clientId}</option>)}</select></label>{onNavigateToUiEditor&&<button type="button" onClick={()=>{if(dirty&&!window.confirm('Discard unsaved campaign changes?'))return;onNavigateToUiEditor();}} className="text-sm font-semibold text-cyan-800 underline">Open UI settings</button>}{error?<p role="alert">{error}</p>:clientId?<section className="rounded-2xl bg-white p-5 shadow-sm"><ClientCampaigns key={clientId} clientId={clientId} kiosks={kiosks} referenceTime={referenceTime} onStatus={setStatus} onDirtyChange={setDirty} request={request} listDevices={listDevices}/></section>:<p>No accessible clients are available.</p>}</main></div>;
}
