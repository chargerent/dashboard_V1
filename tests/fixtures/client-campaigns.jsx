import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ClientCampaigns from '../../src/components/media/ClientCampaigns.jsx';
import UiProfilesPage from '../../src/pages/UiProfilesPage.jsx';
import {PROFILE_PREVIEW_KIOSKS} from '../../src/utils/profilePreview.js';
import '../../src/index.css';

const popup={durationMs:5000,successTemplate:'Take it.',returnTemplate:'Thank you.',failureTemplate:'Try again.'};
const originalId='11111111-1111-1111-1111-111111111111';
const draft={name:'Original client campaign',mediaType:'image',layout:'full',stationBrandBackground:true,orientation:'landscape',background:'#ffffff',checkout:{enabled:true,height:.24},zones:[{id:'owner',x:0,y:0,width:1,height:1,type:'text',text:'',background:'#ffffff'}],popup,stationIds:['SAMPLE-M01']};
const items=new Map([[originalId,{id:originalId,clientId:'MIXED SAMPLE',name:draft.name,revision:10,editVersion:1,publishedAt:'2026-10-15T03:00:00Z',stationIds:['SAMPLE-M01'],draft}]]);
const legacyResponse=new URLSearchParams(window.location.search).get('legacy')==='1';
if(legacyResponse){
  delete items.get(originalId).clientId;
  items.set('foreign',{id:'foreign',name:'Other client campaign',stationIds:['SAMPLE-A01']});
  items.set('unknown',{id:'unknown',name:'Unknown kiosk campaign',stationIds:['SAMPLE-UNKNOWN']});
  items.set('unassigned',{id:'unassigned',name:'Unassigned campaign',stationIds:[]});
}
window.campaignWrites=[];
const clone=value=>structuredClone(value);
const request=async(route,options={})=>{
  const [pathname,search]=route.split('?'),body=options.body?JSON.parse(options.body):null;
  if(pathname==='/campaign-clients')return {clients:[{clientId:'MIXED SAMPLE'},{clientId:'APOLLO SAMPLE'}]};
  if(pathname==='/library')return {assets:[]};
  if(pathname==='/campaigns'&&!body){const clientId=new URLSearchParams(search).get('clientId');return {campaigns:clone([...items.values()].filter(item=>legacyResponse||item.clientId===clientId)),...(!legacyResponse?{capabilities:{clientCampaigns:1}}:{})};}
  const detail=pathname.match(/^\/campaigns\/([^/]+)$/);
  if(detail&&!body)return {campaign:clone(items.get(detail[1]))};
  const status=pathname.match(/^\/campaigns\/([^/]+)\/status$/);
  if(status)return {campaign:{stations:(items.get(status[1])?.stationIds||[]).map(stationId=>({stationId,state:'playing',label:'Playing'}))}};
  if(body&&['/campaigns/draft','/campaigns/publish'].includes(pathname)){
    window.campaignWrites.push({route,body:clone(body)});
    const id=body.id||'22222222-2222-2222-2222-222222222222',previous=items.get(id);
    const publishing=pathname.endsWith('/publish');
    const campaign={...previous,id,clientId:body.clientId,name:body.name,editVersion:(previous?.editVersion||0)+1,draft:body,hasDraft:!publishing,
      revision:publishing?11:previous?.revision||0,publishedAt:publishing?new Date().toISOString():previous?.publishedAt||null,
      stationIds:publishing?body.stationIds:previous?.stationIds||[]};
    items.set(id,campaign);return {campaign:clone(campaign)};
  }
  throw Error('Unexpected local fixture route: '+route);
};
const listDevices=async()=>({devices:[{id:'mixed-device',stationId:'SAMPLE-M01',deviceKind:'integrated_kiosk',lastSeenAt:new Date().toISOString(),inventory:{media:{supportsStationBackground:true}}},
  {id:'foreign-device',stationId:'SAMPLE-A01',deviceKind:'integrated_kiosk',inventory:{media:{supportsStationBackground:true}}}]});

function Harness(){
  const [clientId,setClientId]=useState('MIXED SAMPLE'),[status,setStatus]=useState(null);
  if(new URLSearchParams(window.location.search).get('workspace')==='partner')return <UiProfilesPage allowCampaignManager initialSection="campaigns" currentUser={{role:'partner',partner:true,clientId:'PARTNER-A',features:{campaign_manager:true}}} allStationsData={PROFILE_PREVIEW_KIOSKS.map(kiosk=>({...kiosk,info:{...kiosk.info,rep:'PARTNER-A'}}))} campaignApi={request} campaignDevices={listDevices} onNavigateToDashboard={()=>{}} t={key=>key}/>;
  if(new URLSearchParams(window.location.search).get('workspace')==='profiles')return <UiProfilesPage previewMode allowCampaignManager initialClientId="MIXED SAMPLE" initialSection="campaigns" currentUser={{isAdmin:true}} campaignApi={request} campaignDevices={listDevices} onNavigateToDashboard={()=>{}} t={key=>key}/>;
  return <main className="mx-auto max-w-screen-2xl p-5"><p className="mb-4 text-sm text-slate-500">Local fixture · all writes remain in this browser.</p><label>Client<select aria-label="Fixture client" value={clientId} onChange={event=>setClientId(event.target.value)}><option>MIXED SAMPLE</option><option>APOLLO SAMPLE</option></select></label>{status&&<p role="status">{status.message}</p>}<ClientCampaigns key={clientId} clientId={clientId} kiosks={PROFILE_PREVIEW_KIOSKS} request={request} listDevices={listDevices} onStatus={setStatus}/></main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
