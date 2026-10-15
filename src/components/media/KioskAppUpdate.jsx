import {useEffect,useState} from 'react';
import {remoteRequest,requestId} from '../../integrated-media/remoteTransport.js';
import {callFunctionWithAuth} from '../../utils/callableRequest.js';
const capabilityFor=device=>{const c=device?.inventory?.capabilities?.INSTALL_APP_UPDATE;return typeof c==='object'?c:{supported:c===true,reason:'Local app setup is required.'};};
const path=device=>`/kiosk-update/${encodeURIComponent(device.id)}`;

export default function KioskAppUpdate({device,onStatus,onRefresh}) {
  const [live,setLive]=useState(null),[checking,setChecking]=useState(false),[error,setError]=useState(''),[command,setCommand]=useState(null);
  useEffect(()=>{
    let stopped=false;
    const refresh=async()=>{
      try {
        const result=await remoteRequest(path(device));
        if(stopped)return;
        setLive(result.device);setError('');
        if(command?.id) {
          const response=await callFunctionWithAuth('phoneControl_listCommands',{deviceId:device.id});
          if(!stopped)setCommand(response.commands.find(item=>item.id===command.id)||command);
        }
      }catch(e){if(!stopped)setError(e.message);}
    };
    refresh();const timer=setInterval(refresh,15000);
    return()=>{stopped=true;clearInterval(timer);};
  },[device.id,command?.id]);
  const release=live?.release,installed=Number(live?.inventory?.agentVersionCode||live?.inventory?.appVersionCode||device.inventory?.agentVersionCode||0);
  const capability=capabilityFor(live);
  const updating=command&&['queued','delivered'].includes(command.status);
  const available=release&&release.versionCode>installed;
  const blocked=!live?.online?'The kiosk is offline.':!release?'A compatible kiosk release is unavailable.':!capability.supported?capability.reason:live.activeCommandId?'Wait for the current command to finish.':'';
  const install=async()=>{
    if(checking||blocked||!available||updating)return;
    setChecking(true);
    try {
      const fresh=(await remoteRequest(path(device))).device;
      if(!fresh?.online||!fresh?.release||!capabilityFor(fresh).supported)throw new Error(capabilityFor(fresh).reason||'The kiosk is not ready for an update.');
      const r=fresh.release;
      const queued=await callFunctionWithAuth('phoneControl_sendCommand',{deviceId:device.id,requestId:requestId(),operation:'INSTALL_APP_UPDATE',arguments:{httpsUrl:r.apkUrl,sha256:r.apkSha256,versionCode:r.versionCode,versionName:r.versionName},confirmed:true});
      setCommand(queued.command||{id:queued.commandId,status:queued.status||'queued'});onStatus({state:'pending',message:`Kiosk app ${fresh.release.versionName} queued for ${device.stationId||device.id}.`});
      onRefresh(false);
    }catch(e){setError(e.message);onStatus({state:'error',message:e.message});}
    finally{setChecking(false);}
  };
  let status=error||blocked||(release?available?`Available: ${release.versionName}`:`Kiosk app ${live?.inventory?.agentVersion||release.versionName} is installed.`:'Checking kiosk release…');
  const confirmedVersion=command?.result?.versionName||command?.arguments?.versionName;
  if(command)status=command.status==='completed'?`Update confirmed by kiosk${confirmedVersion?` · ${confirmedVersion}`:''}.`:command.status==='failed'?`Update failed: ${command.error||'Check the kiosk.'}`:command.status==='expired'?'Update expired; reconnect the kiosk and try again.':`Update ${command.status}; waiting for the kiosk.`;
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3" data-kiosk-app-update={device.id}>
    <p className="text-xs text-slate-500" role="status">{status}</p>
    <button type="button" onClick={install} disabled={!available||Boolean(blocked)||checking||updating} title={blocked||'Install the verified kiosk app release'} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{checking?'Checking…':updating?'Updating…':'Update kiosk app'}</button>
  </div>;
}
