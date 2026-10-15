export const campaignClientId=value=>String(value||'').trim().toUpperCase();

// Older hosted services ignore the client query and omit campaign ownership.
// Show a legacy campaign only when every target belongs to the selected client.
export function campaignsForClient(campaigns,clientId,kiosks=[]) {
  const selectedClient=campaignClientId(clientId);
  if(!selectedClient||!Array.isArray(campaigns))return [];
  const clientsByStation=new Map();
  for(const kiosk of kiosks){
    const stationId=campaignClientId(kiosk?.stationid||kiosk?.stationId);
    const owner=campaignClientId(kiosk?.info?.client||kiosk?.info?.clientId);
    const owners=clientsByStation.get(stationId)||new Set();
    owners.add(owner);clientsByStation.set(stationId,owners);
  }
  return campaigns.flatMap(campaign=>{
    if(!campaign||typeof campaign!=='object')return [];
    const owner=campaignClientId(campaign.clientId);
    if(owner)return owner===selectedClient?[campaign]:[];
    if(!Array.isArray(campaign.stationIds)||!campaign.stationIds.length)return [];
    const verified=campaign.stationIds.every(id=>{
      const owners=clientsByStation.get(campaignClientId(id));
      return owners?.size===1&&owners.has(selectedClient);
    });
    return verified?[{...campaign,clientId:selectedClient,needsClientAssignment:true}]:[];
  });
}

export function campaignEditorValues(campaign) {
  const draft=campaign?.draft||{};
  return {
    name:draft.name||'',layout:draft.layout||'full',
    mediaType:(draft.stationBrandBackground===true || (draft.stationBrandBackground===undefined && !draft.zones?.some(zone=>zone.type==='playlist')))?'brand':draft.mediaType||'image',
    checkoutEnabled:draft.checkout?.enabled!==false,
    stationIds:[...(draft.stationIds||[])],
    zoneMedia:Object.fromEntries((draft.zones||[]).filter(zone=>zone.type==='playlist').map(zone=>[zone.id,zone.items.map(item=>item.assetId)])),
  };
}

export function buildCampaignDraft({clientId,id,expectedVersion,name,layout,mediaType,checkoutEnabled,stationIds,zoneMedia,library,baseDraft={},popup}) {
  const assets=new Map(library.map(asset=>[asset.id,asset]));
  const zones=mediaType==='brand'?[{id:'owner',x:0,y:0,width:1,height:1,type:'text',text:'',background:'#ffffff'}]:layout.zones.map(zone=>{
    const old=baseDraft.zones?.find(item=>item.id===zone.id);
    if(zone.type==='text')return {...zone};
    return {...zone,type:'playlist',muted:old?.muted!==false,items:(zoneMedia[zone.id]||[]).map(assetId=>{
      const prior=old?.items?.find(item=>item.assetId===assetId);
      return prior?{...prior}:{assetId,durationMs:assets.get(assetId)?.durationMs||10000,rotation:0,fit:'cover'};
    })};
  });
  return {clientId:campaignClientId(clientId),...(id?{id,expectedVersion}:{}),name:name.trim(),stationIds,
    mediaType:mediaType==='brand'?'image':mediaType,layout:mediaType==='brand'?'full':layout.id,
    stationBrandBackground:mediaType==='brand',checkout:{enabled:checkoutEnabled,height:baseDraft.checkout?.height||.16},
    orientation:baseDraft.orientation||'portrait',background:mediaType==='brand'?'#ffffff':baseDraft.background||'#08120f',
    zones,popup:baseDraft.popup||popup};
}

export function campaignReplacementAssignments(campaigns,stationIds,currentId) {
  return Object.fromEntries(campaigns.filter(item=>item.id!==currentId).flatMap(item=>(item.stationIds||[])
    .filter(id=>stationIds.includes(id)).map(id=>[id,item.id])));
}
