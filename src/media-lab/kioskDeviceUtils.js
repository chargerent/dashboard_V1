export const deviceId = device => device?.id || device?.deviceId || '';
export const deviceName = device => device?.stationId || device?.displayName || 'Unassigned app';
export function relativeTime(value, now=Date.now()) {
  const time=typeof value==='number'?value:new Date(value || '').getTime();
  if(!Number.isFinite(time) || time<=0)return 'Not reported';
  const seconds=Math.max(0,Math.floor((now-time)/1000));
  if(seconds<10)return 'Just now';
  if(seconds<60)return `${seconds}s ago`;
  if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;
  if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;
  return `${Math.floor(seconds/86400)}d ago`;
}
export function phoneLine(device) {
  const agent=String(device?.phoneLine?.agentNumber || device?.inventory?.phoneNumber || device?.reportedPhoneNumber || '').trim();
  const manual=String(device?.phoneLine?.manualNumber || device?.manualPhoneNumber || '').trim();
  const number=agent || manual;
  return {number,agent,manual,source:agent?'agent':manual?'manual':'',key:number.replace(/\D/g,'')};
}
export function needsAttention(device) {
  const inventory=device?.inventory || {};
  return !device?.online || inventory.isDeviceOwner===false || inventory.remoteUiInputEnabled===false || !!inventory.media?.playbackError;
}
export function matchesDevice(device,query='',filter='all') {
  const inventory=device?.inventory || {};
  const search=[deviceId(device),device.stationId,device.displayName,device.market,inventory.model,inventory.manufacturer,inventory.cellularCarrier,phoneLine(device).number].join(' ').toLowerCase();
  if(!search.includes(query.trim().toLowerCase()))return false;
  if(filter==='online')return device.online===true;
  if(filter==='unassigned')return !device.stationId;
  if(filter==='attention')return needsAttention(device);
  if(filter==='terminal')return inventory.terminalPackageInstalled===true;
  if(filter==='no-terminal')return inventory.terminalPackageInstalled===false;
  if(filter.startsWith('market:'))return device.market===filter.slice(7);
  return true;
}
// Same OpenStreetMap presentation as Phone Control, with strict missing-value
// validation so absent GPS data never creates a marker at zero coordinates.
export function locationMapUrls(location) {
  const numeric=value=>typeof value==='number' || (typeof value==='string' && value.trim()!=='' && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()));
  if(!location || !numeric(location.latitude) || !numeric(location.longitude))return null;
  const latitude=Number(location.latitude),longitude=Number(location.longitude);
  if(!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180)return null;
  const accuracy=Math.max(0,Number(location.accuracyMeters)||0);
  const latDelta=Math.max(.004,Math.min(.08,accuracy/111000*4));
  const lonDelta=Math.min(.12,latDelta/Math.max(.2,Math.cos(latitude*Math.PI/180)));
  const bbox=[longitude-lonDelta,latitude-latDelta,longitude+lonDelta,latitude+latDelta].map(value=>value.toFixed(6)).join(',');
  const marker=`${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  return {latitude,longitude,embed:`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`,external:`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`};
}
export function latestLocation(device) {
  const time=fix=>{
    const value=fix.capturedAt || fix.capturedAtMs || fix.receivedAt;
    const number=typeof value==='number'?value:new Date(value || '').getTime();
    return Number.isFinite(number)?number:0;
  };
  // A completed GPS command and the next inventory heartbeat can arrive in
  // either order. Compare their actual fixes instead of preferring one source.
  return [device?.location,device?.inventory?.location].filter(fix=>locationMapUrls(fix)).sort((a,b)=>time(b)-time(a))[0] || null;
}
export function locationStatusMessage(status,hasFix) {
  if(status?.status==='no_fix')return hasFix?undefined:'Android has not returned a location fix yet.';
  return {requesting:'Android is requesting a location…',disabled:'Location services are off. Turn them on, then refresh.',permission_required:'Grant Location permission in Android before requesting a fix.',unsupported:'This Android device does not report an available location provider.',error:status?.error || 'Android could not obtain a location.'}[status?.status];
}
export function hotspotLabel(inventory={}) {
  if(inventory.hotspotSupported===false || inventory.hotspotControlMode==='unavailable')return 'Control unavailable';
  if(inventory.hotspotControlGranted===false)return 'Permission needed';
  if(inventory.hotspotActive===true)return inventory.hotspotControlMode==='settings_automation'?'Last confirmed on':inventory.hotspotAlwaysOn?'On · Always on':'On';
  if(['starting','retrying','waiting'].includes(inventory.hotspotState))return inventory.hotspotState;
  return inventory.hotspotActive===false?'Off':'Not reported';
}
export function networkLabel(inventory={}) {
  if(inventory.wifiCaptivePortal===true)return 'Sign-in required';
  return {online:'Internet online',no_internet:'No internet',local_only:'Local network only',offline:'Offline'}[inventory.networkStatus] || (inventory.network==='offline'?'Offline':inventory.networkValidated===true?'Internet online':inventory.network || 'Not reported');
}
export function androidCohort(devices,device) {
  const inventory=device?.inventory || {};
  if(!inventory.model)return 'Model not reported';
  const normalized=value=>String(value || '').trim().toLowerCase();
  const cohort=devices.filter(item=>normalized(item.inventory?.model)===normalized(inventory.model) && normalized(item.inventory?.manufacturer)===normalized(inventory.manufacturer));
  if(cohort.length<2)return 'Only app with this model in the local fleet';
  const versions=[...new Set(cohort.map(item=>item.inventory?.androidVersion || 'Unknown'))];
  const latestPatch=cohort.filter(item=>item.inventory?.androidVersion===inventory.androidVersion).map(item=>item.inventory?.securityPatch).filter(Boolean).sort().at(-1);
  const behindPatch=inventory.securityPatch && latestPatch && inventory.securityPatch<latestPatch;
  return versions.length===1 && versions[0]!=='Unknown'?`Android ${versions[0]} aligned across ${cohort.length} apps${behindPatch?` · Newer security patch reported: ${latestPatch}`:''}`:`Version mismatch: ${versions.join(', ')}`;
}

// Delivery may complete even when Android declines the requested effect.
// Preserve that delivery status and present the explicit native result beside it.
export function commandOutcome(command={}) {
  const result=command.result && typeof command.result==='object'?command.result:{};
  const flags=[];
  if(result.applied===false)flags.push('Not applied');
  if(result.accepted===false)flags.push('Not accepted');
  const details=[];
  for(const key of ['applied','accepted'])if(typeof result[key]==='boolean')details.push(`${key}: ${result[key]}`);
  for(const key of ['reason','message','error','code']) {
    const value=result[key];
    if(typeof value==='string' && value.trim())details.push(value.trim());
    else if(key==='error' && value && typeof value.message==='string')details.push(value.message);
  }
  return {deliveryStatus:command.status || 'queued',negative:flags.length>0,label:flags.join(' · '),details:[...new Set(details)]};
}
