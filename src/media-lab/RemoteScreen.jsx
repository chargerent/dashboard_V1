import React, {useCallback, useEffect, useRef, useState} from 'react';
import {PHONE_WEBRTC_PROFILES, createWebRtcSessionId, encodePointerPacket, encodeGlobalActionPacket, waitForIceGatheringComplete, mediaPoint, stopRemoteScreenSession, isFreshLivePreview} from './remoteProtocol.js';
import {capabilityFor, devicePath, remoteRequest, requestId, stamp} from './remoteTransport.js';
import {DashboardIcon as Icon} from './DashboardIcons.jsx';

export default function RemoteScreen({device, screen = {}, onCommand, onError, busy}) {
  const [profile, setProfile] = useState('balanced');
  const [state, setState] = useState('idle');
  const [hasStream, setHasStream] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [videoSize, setVideoSize] = useState(null);
  const [direct, setDirect] = useState(false);
  const [text, setText] = useState('');
  const [cleanupBusy,setCleanupBusy]=useState(false),[jpegDecoded,setJpegDecoded]=useState('');
  const video = useRef(null), image = useRef(null), peer = useRef(null), channel = useRef(null), stream = useRef(null);
  const session = useRef(''), generation = useRef(0), pointer = useRef(null), settingAnswer = useRef(false);
  const nativeSession=useRef(null),watchdog=useRef(null),decodedVideo=useRef(false),cleanupGeneration=useRef(0),mounted=useRef(true);
  const errorCallback=useRef(onError);errorCallback.current=onError;
  const rtc = screen.webrtc || {};
  const active = !['idle','stopped','failed','closed','expired','permission_denied','projection_stopped'].includes(state);
  const connected = device?.online === true;
  const can = operation => connected && !(device?.inventory?.media?.checkoutBusy && operation.startsWith('UI_')) && capabilityFor(device, operation).supported;
  const input = !device?.inventory?.media?.checkoutBusy && (can('UI_TAP') || (direct && connected && device?.inventory?.remoteUiInputEnabled === true));
  // Native RTC metadata reports physical display pixels; decoded video can be
  // downscaled by the quality profile and must never size signed coordinates.
  const width = Number(hasVideo ? rtc.width || screen.width || 1080 : screen.width || 1080);
  const height = Number(hasVideo ? rtc.height || screen.height || 1920 : screen.height || 1920);
  const aspectWidth=hasVideo?videoSize?.width || width:width, aspectHeight=hasVideo?videoSize?.height || height:height;
  const imageUrl = screen.dataUrl || '';
  const close = useCallback((next = 'stopped') => {
    const remote=nativeSession.current;nativeSession.current=null;
    generation.current += 1;
    clearTimeout(watchdog.current);watchdog.current=null;decodedVideo.current=false;
    channel.current?.close(); peer.current?.close(); channel.current = null; peer.current = null;
    session.current = ''; stream.current = null; pointer.current = null; settingAnswer.current = false;
    if (video.current) video.current.srcObject = null;
    if(mounted.current){setDirect(false);setHasStream(false);setHasVideo(false);setVideoSize(null);setState(next);}
    if(!remote)return Promise.resolve();
    const cleanup=++cleanupGeneration.current;
    if(mounted.current)setCleanupBusy(true);
    // Wait for the bounded start POST before stopping, including an uncertain
    // timeout: the Android session may already have been queued by that POST.
    return Promise.resolve(remote.submission).catch(()=>{}).then(()=>stopRemoteScreenSession({request:remoteRequest,path:remote.path,sessionId:remote.id,requestId:requestId()})).catch(()=>{
      if(mounted.current && cleanup===cleanupGeneration.current)errorCallback.current('The browser closed live video, but the Android stop request could not be confirmed. The remote session will expire automatically.');
    }).finally(()=>{if(mounted.current && cleanup===cleanupGeneration.current)setCleanupBusy(false);});
  }, []);
  useEffect(() => {mounted.current=true;return()=>{close();mounted.current=false;};},[device?.id,close]);
  useEffect(() => {
    if (hasStream && video.current && stream.current) {
      const attempt=generation.current;video.current.srcObject=stream.current;
      video.current.play().catch(()=>{if(attempt===generation.current)close('failed');});
    }
  }, [hasStream]);
  function observeVideoFrame() {
    const element=video.current;
    if (!session.current || !stream.current || !element || element.readyState<2 || !element.videoWidth || !element.videoHeight) return;
    decodedVideo.current=true;clearTimeout(watchdog.current);watchdog.current=null;
    setVideoSize(previous=>previous?.width===element.videoWidth && previous?.height===element.videoHeight ? previous : {width:element.videoWidth,height:element.videoHeight});
    setHasVideo(true);
  }
  useEffect(() => {
    if (!peer.current || !session.current || session.current !== rtc.sessionId) return;
    if (rtc.answerSdp && !peer.current.currentRemoteDescription && !settingAnswer.current) {
      settingAnswer.current = true;
      const current = generation.current;
      peer.current.setRemoteDescription({type:'answer', sdp:rtc.answerSdp}).catch(error => {
        if (current === generation.current) close('failed');
      }).finally(() => {if (current === generation.current) settingAnswer.current = false;});
    }
    if (['failed','permission_denied','expired','projection_stopped','stopped'].includes(rtc.state)) close(rtc.state);
    if (rtc.expiresAt && new Date(rtc.expiresAt).getTime() <= Date.now()) close('expired');
  }, [rtc.answerSdp, rtc.sessionId, rtc.state, rtc.expiresAt, close]);
  async function start() {
    const previousCleanup=close('preparing');const attempt=generation.current;
    try {
      await previousCleanup;if(generation.current!==attempt)return;
      const connection = new RTCPeerConnection({iceServers:[]}); peer.current = connection;
      session.current = createWebRtcSessionId();
      const control = connection.createDataChannel('chargerent-control-v1', {ordered:true}); channel.current = control;
      control.binaryType = 'arraybuffer';
      control.onopen = () => {if (generation.current === attempt) setDirect(true);};
      control.onclose = () => {if (generation.current === attempt) setDirect(false);};
      connection.addTransceiver('video', {direction:'recvonly'});
      connection.ontrack = event => {if (generation.current === attempt) {stream.current = event.streams[0] || new MediaStream([event.track]); setHasStream(true);}};
      connection.onconnectionstatechange = () => {
        if (generation.current !== attempt) return;
        if (['failed','closed'].includes(connection.connectionState))close('failed');
        else {
          setState(connection.connectionState);
          if(connection.connectionState==='disconnected') {
            clearTimeout(watchdog.current);
            watchdog.current=setTimeout(()=>{if(generation.current===attempt)close('failed');},15000);
          } else if(connection.connectionState==='connected' && decodedVideo.current){clearTimeout(watchdog.current);watchdog.current=null;}
        }
      };
      await connection.setLocalDescription(await connection.createOffer());
      await waitForIceGatheringComplete(connection);
      if (generation.current !== attempt) return;
      const target={path:devicePath(device),id:session.current};nativeSession.current=target;
      watchdog.current=setTimeout(()=>{if(generation.current===attempt && !decodedVideo.current)close('failed');},45000);
      target.submission=remoteRequest(`${target.path}/webrtc`,{requestId:requestId(),sessionId:target.id,offerSdp:connection.localDescription.sdp,durationSeconds:300,profile:PHONE_WEBRTC_PROFILES[profile]});
      await target.submission;
      if (generation.current === attempt) setState('awaiting_device');
    } catch {if(generation.current===attempt)close('failed');}
  }
  function stop() {close();}
  function send(packet) {if (channel.current?.readyState !== 'open') return false; channel.current.send(packet); return true;}
  function point(event) {return mediaPoint(event, hasVideo ? video.current : image.current);}
  function down(event) {
    if (!input) return;
    const position = point(event); if (!position) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointer.current = {...position, started:performance.now(), clientX:event.clientX, clientY:event.clientY};
    if (direct) send(encodePointerPacket('down', position.x, position.y));
  }
  function move(event) {
    if (!pointer.current || !direct || !input) return;
    const position = point(event); if (position) send(encodePointerPacket('move', position.x, position.y, performance.now() - pointer.current.started));
  }
  function up(event) {
    const first = pointer.current; pointer.current = null; if (!first || !input) return;
    const end = point(event);
    if (!end) {if (direct) send(encodePointerPacket('cancel', first.x, first.y)); return;}
    const elapsed = Math.max(150, Math.min(1500, performance.now() - first.started));
    if (direct) {send(encodePointerPacket('up', end.x, end.y, elapsed)); return;}
    if (Math.hypot(event.clientX-first.clientX,event.clientY-first.clientY) < 12) onCommand('UI_TAP', {x:Math.round(end.x*(width-1)),y:Math.round(end.y*(height-1))});
    else onCommand('UI_SWIPE',{startX:Math.round(first.x*(width-1)),startY:Math.round(first.y*(height-1)),endX:Math.round(end.x*(width-1)),endY:Math.round(end.y*(height-1)),durationMs:Math.round(elapsed)});
  }
  function cancelPointer() {const first = pointer.current; pointer.current = null; if (first && direct) send(encodePointerPacket('cancel',first.x,first.y));}
  function globalAction(action) {if (!input) return; if (!send(encodeGlobalActionPacket(action))) onCommand('UI_GLOBAL_ACTION',{action});}
  const frameTime = screen.capturedAt || screen.receivedAt;
  const oldFrame = frameTime && Date.now()-new Date(frameTime).getTime()>15000;
  const livePreview=connected && jpegDecoded===imageUrl && isFreshLivePreview(screen);
  const liveVideo=connected && state==='connected' && hasVideo;
  const screenLabel=!device?'Not connected':!connected?'Device offline':liveVideo?'Live video':livePreview?'Live preview':state==='connected'?'Waiting for video':state.replaceAll('_',' ');
  const offlineHint=device?'The device is offline. Remote input will be available after it reconnects.':'Enroll the local Android app to use remote input.';
  const inputHint=!connected?offlineHint:device.inventory?.media?.checkoutBusy?'A rental is in progress. Remote input is paused until checkout finishes.':capabilityFor(device,'UI_TAP').reason || (device.inventory?.remoteUiInputEnabled===false?'Enable the app’s Remote UI control in Android Accessibility to tap and swipe.':'Remote input is unavailable. Refresh the device to check its current capability.');
  const captureHint=operation=>!connected?(device?'The device must reconnect before capturing its screen.':'Enroll the local Android app first.'):capabilityFor(device,operation).reason || 'Screen capture is unavailable with the app’s current permissions.';
  const failureMessage=state==='failed'?(livePreview?'Live video could not connect. Fallback preview is updating.':'Live video could not connect. Use Fallback preview for regularly updated screenshots.'):state==='permission_denied'?'Android did not allow screen sharing. Start live again and accept the screen-sharing prompt.':state==='expired'?'The live session expired. Start live again or use Fallback preview.':'Android ended screen sharing. Start live again or use Fallback preview.';
  return <section className="kc-remote-panel" aria-label="Remote kiosk screen">
    <div className="kc-card-heading"><div><span className="kc-eyebrow">{connected?'CONNECTED APP':'LAST REPORTED SCREEN'}</span><h2>Remote screen</h2></div><span className={`kc-pill ${liveVideo || livePreview?'green':''}`}>{screenLabel}</span></div>
    <div className="kc-screen-toolbar"><button className="kc-button primary" title={!active && !can('START_WEBRTC_SCREEN') ? captureHint('START_WEBRTC_SCREEN') : ''} disabled={!active && (!can('START_WEBRTC_SCREEN') || busy || cleanupBusy)} onClick={active?stop:start}><Icon name={active?'pause':'play'} size={16}/>{active?'Stop live':cleanupBusy?'Stopping…':'Start live'}</button><button className="kc-button" title={!can('CAPTURE_SCREEN') ? captureHint('CAPTURE_SCREEN') : ''} disabled={!can('CAPTURE_SCREEN') || busy} onClick={()=>onCommand('CAPTURE_SCREEN')}><Icon name="capture" size={16}/>Capture screen</button></div>
    <div className="kc-remote-stage"><div className={`kc-device-screen ${aspectWidth>aspectHeight?'landscape':''}`} style={{aspectRatio:`${aspectWidth}/${aspectHeight}`}}>
      <button aria-label="Remote screen: click to tap, drag to swipe" className="kc-screen-input" disabled={!input} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelPointer}>
        <video ref={video} autoPlay muted playsInline onLoadedData={observeVideoFrame} onPlaying={observeVideoFrame} onResize={observeVideoFrame} style={{position:'absolute',inset:0,opacity:hasVideo?1:0}}/>
        {!hasVideo && imageUrl && <img ref={image} src={imageUrl} onLoad={()=>setJpegDecoded(imageUrl)} onError={()=>setJpegDecoded('')} alt={`Last screen captured from ${device?.stationId || 'the kiosk'}`}/>}
        {!hasVideo && !imageUrl && <div className="kc-screen-placeholder"><Icon name="monitor" size={48}/><strong>Your kiosk screen appears here</strong><p>{!connected?device?'The device is offline. Reconnect it to capture a screenshot or start live video.':'Enroll the local Android app to connect.':!capabilityFor(device,'CAPTURE_SCREEN').supported?captureHint('CAPTURE_SCREEN'):'Capture a screenshot or start live video.'}</p></div>}
      </button>
      {(!connected || (oldFrame && !hasVideo)) && imageUrl && <div className="kc-frame-stale">{!connected?'Device offline · last image':'Last captured image'}</div>}
    </div></div>
    <div className="kc-screen-caption"><span>{hasVideo?(liveVideo?'Live view · audio muted':'Last video frame · audio muted'):livePreview?`Live preview · ${stamp(frameTime)}`:`Frame: ${stamp(frameTime)}`}</span><span>{hasVideo || (screen.width && screen.height)?`${width} × ${height}`:'Dimensions not reported'}</span></div>
    <div className="kc-screen-options"><label>Video quality<select value={profile} onChange={event=>{setProfile(event.target.value);if(active)onCommand('SET_WEBRTC_PROFILE',{sessionId:session.current,profile:PHONE_WEBRTC_PROFILES[event.target.value]});}}>{Object.entries(PHONE_WEBRTC_PROFILES).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></label><button className="kc-button" disabled={!can(screen.live?.active?'STOP_LIVE_SCREEN':'START_LIVE_SCREEN') || busy} onClick={()=>onCommand(screen.live?.active?'STOP_LIVE_SCREEN':'START_LIVE_SCREEN',screen.live?.active?{}:{durationSeconds:120,intervalMs:1200})}>{screen.live?.active?'Stop preview':'Fallback preview'}</button></div>
    {!input && <p className="kc-permission-note">{inputHint}</p>}
    {['permission_denied','failed','projection_stopped','expired'].includes(state) && <p className="kc-inline-error">{failureMessage}</p>}
    <div className="kc-navigation">{[['BACK','back','Back'],['HOME','home','Home'],['RECENTS','recent','Recent']].map(([action,icon,label])=><button key={action} className="kc-button" disabled={!input || (!direct && busy)} onClick={()=>globalAction(action)}><Icon name={icon} size={16}/>{label}</button>)}</div>
    <div className="kc-navigation"><button className="kc-button" disabled={!can('UI_SWIPE') || busy} onClick={()=>onCommand('UI_SWIPE',{startX:Math.round(width*.5),startY:Math.round(height*.8),endX:Math.round(width*.5),endY:Math.round(height*.25),durationMs:450})}><Icon name="swipeUp" size={16}/>Swipe up</button><button className="kc-button" disabled={!can('UI_SWIPE') || busy} onClick={()=>onCommand('UI_SWIPE',{startX:Math.round(width*.5),startY:Math.round(height*.25),endX:Math.round(width*.5),endY:Math.round(height*.8),durationMs:450})}><Icon name="swipeDown" size={16}/>Swipe down</button><button className="kc-button" disabled={!can('WAKE_AND_UNLOCK') || busy} onClick={()=>onCommand('WAKE_AND_UNLOCK')}><Icon name="unlock" size={16}/>Wake / unlock</button></div>
    <form className="kc-type-form" onSubmit={event=>{event.preventDefault();onCommand('UI_SET_FOCUSED_TEXT',{text});setText('');}}><input aria-label="Text for focused remote field" placeholder="Type into the focused field…" value={text} onChange={event=>setText(event.target.value)} maxLength={2000}/><button className="kc-button" disabled={!can('UI_SET_FOCUSED_TEXT') || busy || !text}><Icon name="text" size={16}/>Send text</button></form>
    <p className="kc-small-note">Live sessions last up to five minutes. Android screen sharing requires permission; locking the device ends the stream.</p>
  </section>;
}
