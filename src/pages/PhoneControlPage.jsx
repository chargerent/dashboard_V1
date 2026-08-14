import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowPathIcon,
  ArrowUpIcon,
  ArrowUturnLeftIcon,
  Battery100Icon,
  BoltIcon,
  DevicePhoneMobileIcon,
  HomeIcon,
  LockClosedIcon,
  LockOpenIcon,
  MapPinIcon,
  PauseIcon,
  PlayIcon,
  PowerIcon,
  SignalIcon,
  Squares2X2Icon,
  WifiIcon,
} from '@heroicons/react/24/outline';

import ConfirmationModal from '../components/UI/ConfirmationModal.jsx';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import { filterStationsForClient } from '../utils/helpers.js';
import {
  HIGH_IMPACT_PHONE_OPERATIONS,
  PHONE_KIOSK_COUNTRIES,
  createPhoneCommandRequestId,
  formatPhoneRelativeTime,
  getKioskForPhone,
  getPhoneKioskCountryCode,
  getPhoneConnectionState,
  isPhoneWebRtcActive,
  normalizeAgentRelease,
  normalizePhoneDevice,
  phoneLocationMapUrls,
  phoneHotspotLabel,
  phoneMatchesSearch,
  phoneNetworkLabel,
  phoneTimestampToMillis,
} from '../utils/phoneControl.js';
import {
  PHONE_WEBRTC_ICE_SERVERS,
  PHONE_WEBRTC_PROFILES,
  createWebRtcSessionId,
  encodeGlobalActionPacket,
  encodePointerPacket,
  mediaPoint,
  waitForIceGatheringComplete,
} from '../utils/phoneWebRtc.js';

const FILTERS = [
  { value: 'all', label: 'All phones' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'unassigned', label: 'Unassigned' },
];

const STATE_STYLES = {
  online: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: 'Online' },
  offline: { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700', label: 'Offline' },
  never: { dot: 'bg-slate-300', badge: 'bg-slate-100 text-slate-600', label: 'Not connected' },
};

const COMMAND_STYLES = {
  queued: 'bg-amber-100 text-amber-700',
  delivered: 'bg-blue-100 text-blue-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-slate-100 text-slate-600',
};

const CONFIRMATION_REQUIRED_PHONE_OPERATIONS = new Set([
  ...HIGH_IMPACT_PHONE_OPERATIONS,
  'SET_WIFI_ENABLED',
  'SET_ALWAYS_ON_HOTSPOT',
]);

const PHONE_COMMAND_LABELS = {
  PING: 'Ping phone',
  GET_INVENTORY: 'Refresh device details',
  GET_LOCATION: 'Refresh location',
  SET_LOCATION_ENABLED: 'GPS',
  SET_WIFI_ENABLED: 'Wi-Fi',
  SET_ALWAYS_ON_HOTSPOT: 'Always-on hotspot',
  OPEN_TETHER_SETTINGS: 'Open tethering settings',
  SET_BLUETOOTH_ENABLED: 'Bluetooth',
  LOCK_NOW: 'Lock phone',
  WAKE_AND_UNLOCK: 'Wake and unlock',
  REBOOT: 'Reboot phone',
  SET_UPDATE_POLICY: 'Update policy',
  SET_SCREEN_BRIGHTNESS: 'Screen brightness',
  SET_SCREEN_TIMEOUT: 'Screen timeout',
  SET_AUTOMATIC_TIME: 'Automatic time',
  SET_TIME_ZONE: 'Time zone',
  SET_KEYGUARD_DISABLED: 'Lock screen',
  SET_KIOSK_ALLOWLIST: 'Kiosk apps',
  SET_APP_HIDDEN: 'App visibility',
  SET_APP_SUSPENDED: 'App suspension',
  SET_RUNTIME_PERMISSION: 'App permission',
  REQUEST_BUGREPORT: 'Request bug report',
  SET_NETWORK_LOGGING: 'Network logging',
  SET_SECURITY_LOGGING: 'Security logging',
  UI_TAP: 'Screen tap',
  UI_SWIPE: 'Screen swipe',
  UI_GLOBAL_ACTION: 'Phone navigation',
  UI_SET_FOCUSED_TEXT: 'Enter text',
  CAPTURE_SCREEN: 'Capture screen',
  START_LIVE_SCREEN: 'Start fallback preview',
  STOP_LIVE_SCREEN: 'Stop fallback preview',
  START_WEBRTC_SCREEN: 'Start live screen',
  SET_WEBRTC_PROFILE: 'Live screen quality',
  STOP_WEBRTC_SCREEN: 'Stop live screen',
  INSTALL_SYSTEM_UPDATE: 'Install system update',
  INSTALL_APP_UPDATE: 'Install app update',
  WIPE_DEVICE: 'Erase phone',
};

function stationIdOf(kiosk) {
  return String(kiosk?.stationid || kiosk?.stationId || '').trim().toUpperCase();
}

function commandTimestamp(command) {
  return phoneTimestampToMillis(command?.updatedAt || command?.completedAt || command?.createdAt || command?.issuedAt);
}

function commandLabel(operation) {
  const normalizedOperation = String(operation || 'command').trim().toUpperCase();
  if (PHONE_COMMAND_LABELS[normalizedOperation]) return PHONE_COMMAND_LABELS[normalizedOperation];
  return normalizedOperation
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function commandActionLabel(operation, args = {}) {
  if (operation === 'SET_WIFI_ENABLED') return `Turn Wi-Fi ${args.enabled === true ? 'on' : 'off'}`;
  if (operation === 'SET_LOCATION_ENABLED') return `Turn GPS ${args.enabled === true ? 'on' : 'off'}`;
  if (operation === 'SET_ALWAYS_ON_HOTSPOT') return `${args.enabled === true ? 'Enable' : 'Disable'} always-on hotspot`;
  if (operation === 'INSTALL_APP_UPDATE' && args.versionName) return `Install Agent ${args.versionName}`;
  return commandLabel(operation);
}

function humanizePhoneMessage(message) {
  return String(message || '').replace(
    /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,
    (operation) => commandLabel(operation),
  );
}

function phoneCommandConfirmationDetails(confirmation, device) {
  const operation = confirmation?.operation;
  const stationLabel = device?.stationId || device?.displayName || 'this device';

  if (operation === 'REBOOT') {
    return {
      title: 'Confirm Reboot',
      action: operation,
      confirmationText: `Reboot the phone assigned to ${stationLabel}? It will be unreachable while restarting.`,
    };
  }

  if (operation === 'SET_WIFI_ENABLED') {
    const enabling = confirmation?.args?.enabled === true;
    return {
      title: `Confirm Wi-Fi ${enabling ? 'On' : 'Off'}`,
      action: operation,
      confirmationText: enabling
        ? `Turn Wi-Fi on for the phone assigned to ${stationLabel}? It will attempt to reconnect to a saved network.`
        : `Turn Wi-Fi off for the phone assigned to ${stationLabel}? It may become unreachable if Wi-Fi is its only network connection.`,
    };
  }

  if (operation === 'SET_ALWAYS_ON_HOTSPOT') {
    const enabling = confirmation?.args?.enabled === true;
    return {
      title: `${enabling ? 'Enable' : 'Disable'} Always-on Hotspot`,
      action: operation,
      confirmationText: enabling
        ? `Keep hotspot on for the phone assigned to ${stationLabel}? Agent will start it and restore it after shutdowns or reboots.`
        : `Disable always-on hotspot for the phone assigned to ${stationLabel}? Devices using that hotspot may lose their network connection.`,
    };
  }

  if (operation === 'INSTALL_APP_UPDATE') {
    const versionName = confirmation?.args?.versionName || 'update';
    return {
      title: `Install Agent ${versionName}`,
      action: operation,
      confirmationText: `Install Agent ${versionName} on the phone assigned to ${stationLabel}? Remote management will restart briefly while Android replaces the app.`,
    };
  }

  return {
    title: `Confirm ${commandLabel(operation)}`,
    action: operation,
    confirmationText: `${commandLabel(operation)} is a high-impact phone operation. Continue?`,
  };
}

function SummaryCard({ label, value, detail, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-60">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs opacity-70">{detail}</p>
    </div>
  );
}

function FieldProvisioningCard() {
  const basePath = import.meta.env.BASE_URL || '/portal/';
  const [release, setRelease] = useState({
    versionName: '1.2.6',
    apkUrl: 'https://chargerentstations.com/portal/mdm/remote-agent-v1.2.6.apk',
    qrImagePath: `${basePath}mdm/remote-agent-device-owner-qr.png`,
    qrPayloadPath: `${basePath}mdm/remote-agent-device-owner-payload.json`,
  });

  useEffect(() => {
    let active = true;
    fetch(`${basePath}mdm/remote-agent-provisioning.json`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Field provisioning metadata is unavailable');
        return response.json();
      })
      .then((metadata) => {
        const trustedRelease = normalizeAgentRelease(metadata);
        if (active) setRelease((current) => ({ ...current, ...metadata, ...trustedRelease }));
      })
      .catch(() => {
        // The bundled release details remain usable when metadata refresh is unavailable.
      });
    return () => {
      active = false;
    };
  }, [basePath]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">Factory setup QR</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Reusable Device Owner setup for factory-reset Android phones.</p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">Agent {release.versionName}</span>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
        <img
          src={release.qrImagePath}
          alt="Agent Android Device Owner provisioning QR code"
          className="mx-auto aspect-square w-full max-w-[220px] rounded-lg bg-white"
        />
      </div>

      <ol className="mt-4 space-y-2 text-xs leading-5 text-slate-600">
        <li><span className="font-bold text-slate-800">1.</span> Factory-reset the phone and stop at the first Welcome screen.</li>
        <li><span className="font-bold text-slate-800">2.</span> Tap the same empty area six times, then connect to Wi-Fi.</li>
        <li><span className="font-bold text-slate-800">3.</span> Scan this QR and wait for Android to install Agent.</li>
        <li><span className="font-bold text-slate-800">4.</span> Enter the one-time kiosk code created below.</li>
        <li><span className="font-bold text-slate-800">5.</span> Open Agent and approve always-on hotspot access.</li>
      </ol>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={release.qrImagePath} download="remote-agent-device-owner-qr.png" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center text-xs font-bold text-blue-700 hover:bg-blue-100">Download QR</a>
        <a href={release.apkUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-xs font-bold text-slate-700 hover:bg-slate-50">Download APK</a>
      </div>
      <a href={release.qrPayloadPath} target="_blank" rel="noreferrer" className="mt-3 block text-center text-[11px] font-semibold text-slate-400 hover:text-slate-600">View Android provisioning file</a>
    </div>
  );
}

async function fetchCurrentAgentRelease() {
  const basePath = import.meta.env.BASE_URL || '/portal/';
  const response = await fetch(`${basePath}mdm/remote-agent-provisioning.json`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Current Agent release information is unavailable.');
  return normalizeAgentRelease(await response.json());
}

function Metric({ icon: Icon, label, value, active = null }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Icon className={`h-4 w-4 ${active === false ? 'text-slate-300' : 'text-slate-500'}`} />
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

function ActionButton({ children, icon: Icon, onClick, disabled = false, tone = 'slate', title = '', className = '' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    blue: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
    red: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function WifiToggle({ enabled, onToggle, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`Wi-Fi ${enabled ? 'on' : 'off'}`}
      onClick={onToggle}
      disabled={disabled}
      className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="flex items-center gap-2">
        <WifiIcon className="h-4 w-4" />
        Wi-Fi
      </span>
      <span className="grid min-w-[5.5rem] grid-cols-2 rounded-lg border border-slate-300 bg-slate-200 p-0.5">
        <span className={`rounded-md px-2 py-1 text-center transition ${enabled ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>
          On
        </span>
        <span className={`rounded-md px-2 py-1 text-center transition ${enabled ? 'text-slate-500' : 'bg-white text-slate-700 shadow-sm'}`}>
          Off
        </span>
      </span>
    </button>
  );
}

function PhoneLocationCard({ device, now, onRefresh, onToggleLocation, locationEnabled, canRefresh }) {
  const location = device?.location || {};
  const mapUrls = phoneLocationMapUrls(location);
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const capturedAtMs = location.capturedAtMs || location.receivedAtMs;
  const accuracy = Number(location.accuracyMeters);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <MapPinIcon className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-black text-slate-900">Phone location</h3>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {mapUrls
              ? `${Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m · ` : ''}${capturedAtMs ? formatPhoneRelativeTime(capturedAtMs, now) : 'Current result'}`
              : 'No successful location result yet'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mapUrls && (
            <a href={mapUrls.external} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-blue-600 hover:text-blue-800">
              Open map
            </a>
          )}
          <button
            type="button"
            onClick={onToggleLocation}
            disabled={!canRefresh}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MapPinIcon className="h-3.5 w-3.5" />
            {locationEnabled ? 'GPS off' : 'GPS on'}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!canRefresh}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>
      {mapUrls ? (
        <>
          <iframe
            title={`Location of ${device.stationId || device.id}`}
            src={mapUrls.embed}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-44 w-full border-0 bg-slate-100"
          />
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-500">
            <span>{latitude.toFixed(5)}, {longitude.toFixed(5)}</span>
            <span>{location.stale ? 'Cached position' : (location.provider || location.source || 'Android location')}</span>
          </div>
        </>
      ) : (
        <div className="flex h-32 items-center justify-center border-t border-slate-100 bg-slate-50 px-6 text-center text-xs leading-5 text-slate-500">
          Select “Refresh” after GPS is enabled. The map appears when Android returns coordinates.
        </div>
      )}
    </section>
  );
}

function RemoteScreen({
  device,
  canControl,
  canSendCommand,
  onCommand,
  onStartRealtime,
  onStopRealtime,
  onStartPreview,
  onStopPreview,
  liveRequested,
  now,
}) {
  const [profileKey, setProfileKey] = useState('balanced');
  const [rtcState, setRtcState] = useState('idle');
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [controlReady, setControlReady] = useState(false);
  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const videoRef = useRef(null);
  const imageRef = useRef(null);
  const sessionIdRef = useRef('');
  const pointerRef = useRef(null);
  const imageUrl = String(device?.screen?.dataUrl || device?.screen?.latestUrl || device?.screen?.imageUrl || '').trim();
  const screenWidth = Number(device?.screen?.width || 1080);
  const screenHeight = Number(device?.screen?.height || 2400);
  const liveExpiresAt = phoneTimestampToMillis(device?.screen?.live?.expiresAt);
  const liveActive = device?.screen?.live?.active === true && liveExpiresAt > now;
  const webRtc = device?.screen?.webrtc || {};
  const serverRtcState = String(webRtc.state || '');
  const webRtcExpiresAt = phoneTimestampToMillis(webRtc.expiresAt);
  const webRtcActive = isPhoneWebRtcActive(webRtc, now);
  const directControl = controlReady;

  const closePeer = useCallback((nextState = 'idle') => {
    channelRef.current?.close();
    peerRef.current?.close();
    channelRef.current = null;
    peerRef.current = null;
    sessionIdRef.current = '';
    pointerRef.current = null;
    setControlReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
    setHasRemoteVideo(false);
    setRtcState(nextState);
  }, []);

  useEffect(() => () => closePeer(), [closePeer, device?.id]);

  useEffect(() => {
    const peer = peerRef.current;
    if (!peer || !sessionIdRef.current || webRtc.sessionId !== sessionIdRef.current) return;
    if (webRtc.answerSdp && !peer.currentRemoteDescription) {
      peer.setRemoteDescription({ type: 'answer', sdp: webRtc.answerSdp })
        .then(() => setRtcState('connecting'))
        .catch(() => closePeer('failed'));
    }
    if (serverRtcState === 'connected') setRtcState('connected');
    if (['failed', 'permission_denied', 'expired', 'projection_stopped'].includes(serverRtcState)) {
      closePeer(serverRtcState);
    }
  }, [closePeer, serverRtcState, webRtc.answerSdp, webRtc.sessionId]);

  useEffect(() => {
    const expirableState = ['awaiting_permission', 'starting', 'connecting', 'connected', 'disconnected']
      .includes(serverRtcState);
    if (expirableState && webRtc.sessionId === sessionIdRef.current &&
        webRtcExpiresAt > 0 && webRtcExpiresAt <= now) {
      closePeer('expired');
    }
  }, [closePeer, now, serverRtcState, webRtc.sessionId, webRtcExpiresAt]);

  const sendDirect = (packet) => {
    if (channelRef.current?.readyState !== 'open') return false;
    channelRef.current.send(packet);
    return true;
  };

  const startRealtime = async () => {
    if (!canControl || typeof window.RTCPeerConnection !== 'function') return;
    closePeer('preparing');
    const sessionId = createWebRtcSessionId();
    const peer = new window.RTCPeerConnection({ iceServers: PHONE_WEBRTC_ICE_SERVERS });
    const channel = peer.createDataChannel('chargerent-control-v1', { ordered: true });
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      setControlReady(true);
      setRtcState('connected');
    };
    channel.onclose = () => {
      setControlReady(false);
      setRtcState((current) => current === 'stopped' ? current : 'disconnected');
    };
    channelRef.current = channel;
    peerRef.current = peer;
    sessionIdRef.current = sessionId;
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
        setHasRemoteVideo(true);
      }
    };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      setRtcState(state);
      if (['failed', 'closed'].includes(state)) closePeer(state);
    };
    try {
      setRtcState('creating_offer');
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIceGatheringComplete(peer);
      const queued = await onStartRealtime({
        sessionId,
        offerSdp: peer.localDescription?.sdp || '',
        durationSeconds: 300,
        iceServers: PHONE_WEBRTC_ICE_SERVERS,
        profile: PHONE_WEBRTC_PROFILES[profileKey],
      });
      if (!queued) closePeer('failed');
      else setRtcState('awaiting_device');
    } catch {
      closePeer('failed');
    }
  };

  const stopRealtime = () => {
    const sessionId = sessionIdRef.current || webRtc.sessionId || '';
    closePeer('stopped');
    onStopRealtime(sessionId);
  };

  const pointerPoint = (event) => mediaPoint(
    event,
    hasRemoteVideo ? videoRef.current : imageRef.current,
  );

  const handlePointerDown = (event) => {
    if (!canControl || (!hasRemoteVideo && !imageUrl)) return;
    const point = pointerPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerRef.current = {
      ...point,
      clientX: event.clientX,
      clientY: event.clientY,
      startedAt: performance.now(),
    };
    if (directControl) sendDirect(encodePointerPacket('down', point.x, point.y, 0));
  };

  const handlePointerMove = (event) => {
    if (!pointerRef.current || !directControl) return;
    const point = pointerPoint(event);
    if (!point) return;
    sendDirect(encodePointerPacket(
      'move', point.x, point.y, performance.now() - pointerRef.current.startedAt,
    ));
  };

  const handlePointerUp = (event) => {
    const start = pointerRef.current;
    if (!canControl || !start) return;
    const end = pointerPoint(event);
    pointerRef.current = null;
    if (!end) return;
    if (directControl) {
      sendDirect(encodePointerPacket('up', end.x, end.y, performance.now() - start.startedAt));
      return;
    }
    const travel = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
    if (travel < 12) {
      onCommand('UI_TAP', {
        x: Math.round(end.x * Math.max(0, screenWidth - 1)),
        y: Math.round(end.y * Math.max(0, screenHeight - 1)),
      });
      return;
    }
    onCommand('UI_SWIPE', {
      startX: Math.round(start.x * Math.max(0, screenWidth - 1)),
      startY: Math.round(start.y * Math.max(0, screenHeight - 1)),
      endX: Math.round(end.x * Math.max(0, screenWidth - 1)),
      endY: Math.round(end.y * Math.max(0, screenHeight - 1)),
      durationMs: Math.max(150, Math.min(performance.now() - start.startedAt, 1_500)),
    });
  };

  const cancelPointer = () => {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (start && directControl) {
      sendDirect(encodePointerPacket('cancel', start.x, start.y, performance.now() - start.startedAt));
    }
  };

  const globalAction = (action) => {
    if (!sendDirect(encodeGlobalActionPacket(action))) {
      onCommand('UI_GLOBAL_ACTION', { action });
    }
  };

  const swipeUp = () => {
    if (!directControl) {
      onCommand('UI_SWIPE', {
        startX: Math.round(screenWidth * 0.5),
        startY: Math.round(screenHeight * 0.82),
        endX: Math.round(screenWidth * 0.5),
        endY: Math.round(screenHeight * 0.25),
        durationMs: 450,
      });
      return;
    }
    sendDirect(encodePointerPacket('down', 0.5, 0.82, 0));
    for (let step = 1; step <= 8; step += 1) {
      window.setTimeout(() => {
        const progress = step / 8;
        const y = 0.82 + (0.25 - 0.82) * progress;
        sendDirect(encodePointerPacket(step === 8 ? 'up' : 'move', 0.5, y, step * 45));
      }, step * 45);
    }
  };

  const swipeDown = () => {
    if (!directControl) {
      onCommand('UI_SWIPE', {
        startX: Math.round(screenWidth * 0.5),
        startY: Math.round(screenHeight * 0.25),
        endX: Math.round(screenWidth * 0.5),
        endY: Math.round(screenHeight * 0.82),
        durationMs: 450,
      });
      return;
    }
    sendDirect(encodePointerPacket('down', 0.5, 0.25, 0));
    for (let step = 1; step <= 8; step += 1) {
      window.setTimeout(() => {
        const progress = step / 8;
        const y = 0.25 + (0.82 - 0.25) * progress;
        sendDirect(encodePointerPacket(step === 8 ? 'up' : 'move', 0.5, y, step * 45));
      }, step * 45);
    }
  };

  const changeProfile = (event) => {
    const nextKey = event.target.value;
    setProfileKey(nextKey);
    if (sessionIdRef.current && webRtcActive) {
      onCommand('SET_WEBRTC_PROFILE', {
        sessionId: sessionIdRef.current,
        profile: PHONE_WEBRTC_PROFILES[nextKey],
      });
    }
  };

  const realtimeStarting = liveRequested ||
    ['preparing', 'creating_offer', 'awaiting_device', 'new', 'connecting'].includes(rtcState) ||
    (webRtcActive && ['awaiting_permission', 'starting', 'connecting'].includes(serverRtcState));
  const realtimeConnected = webRtcActive &&
    (rtcState === 'connected' || serverRtcState === 'connected');
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-950 p-3 shadow-inner">
      <div className="mx-auto mb-3 flex w-full max-w-[240px] gap-2">
        <button
          type="button"
          onClick={webRtcActive || realtimeStarting || realtimeConnected ? stopRealtime : startRealtime}
          disabled={!canControl}
          className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${webRtcActive || realtimeStarting || realtimeConnected ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}
        >
          {webRtcActive || realtimeStarting || realtimeConnected ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          {realtimeConnected ? 'Stop live' : realtimeStarting || webRtcActive ? 'Starting…' : 'Start live'}
        </button>
        <ActionButton icon={DevicePhoneMobileIcon} onClick={() => onCommand('CAPTURE_SCREEN')} disabled={!canSendCommand} tone="blue" className="flex-1 !px-2">Capture</ActionButton>
      </div>

      {!device.inventory.remoteUiInputEnabled && (
        <p className="mx-auto mb-3 max-w-[360px] rounded-lg border border-amber-500/40 bg-amber-400/10 px-3 py-2 text-center text-[11px] font-semibold leading-4 text-amber-200">
          Remote control is off on this phone. Open Android Settings → Accessibility → Agent and enable Remote UI control.
        </p>
      )}

      <div className="mx-auto flex aspect-[9/19.5] max-h-[520px] max-w-[240px] items-center justify-center overflow-hidden rounded-[1.5rem] border-4 border-slate-700 bg-black">
        {hasRemoteVideo || imageUrl ? (
          <button
            type="button"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={cancelPointer}
            disabled={!canControl}
            className="h-full w-full touch-none cursor-crosshair select-none disabled:cursor-default"
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`${hasRemoteVideo ? 'block' : 'hidden'} h-full w-full object-contain`}
            />
            {!hasRemoteVideo && <img ref={imageRef} src={imageUrl} alt={`Screen preview for ${device.stationId || device.id}`} className="h-full w-full object-contain" />}
          </button>
        ) : (
          <div className="px-5 text-center">
            <DevicePhoneMobileIcon className="mx-auto h-12 w-12 text-slate-700" />
            <p className="mt-3 text-xs font-semibold text-slate-400">No screen frame received</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-600">Navigation controls remain available when the phone is online.</p>
          </div>
        )}
      </div>

      <div className="mx-auto mt-3 flex max-w-[360px] items-center gap-2">
        <select value={profileKey} onChange={changeProfile} className="min-h-9 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 text-[11px] font-bold text-slate-200">
          {Object.entries(PHONE_WEBRTC_PROFILES).map(([key, profile]) => (
            <option key={key} value={key}>{profile.label}</option>
          ))}
        </select>
        <button type="button" onClick={liveActive ? onStopPreview : onStartPreview} disabled={!canControl} className="min-h-9 rounded-lg border border-slate-700 px-3 text-[11px] font-bold text-slate-300 hover:bg-slate-900 disabled:opacity-40">
          {liveActive ? 'Stop preview' : 'Fallback preview'}
        </button>
      </div>

      <div className="mx-auto mt-3 grid max-w-[360px] grid-cols-3 gap-2">
        <ActionButton icon={ArrowUturnLeftIcon} onClick={() => globalAction('BACK')} disabled={!canControl}>Back</ActionButton>
        <ActionButton icon={HomeIcon} onClick={() => globalAction('HOME')} disabled={!canControl}>Home</ActionButton>
        <ActionButton icon={Squares2X2Icon} onClick={() => globalAction('RECENTS')} disabled={!canControl}>Recent</ActionButton>
        <ActionButton icon={ArrowUpIcon} onClick={swipeUp} disabled={!canControl} className="!gap-1 !px-2 !text-[11px] whitespace-nowrap">Swipe up</ActionButton>
        <ActionButton icon={ArrowDownIcon} onClick={swipeDown} disabled={!canControl} className="!gap-1 !px-2 !text-[11px] whitespace-nowrap">Swipe down</ActionButton>
        <ActionButton icon={WifiIcon} onClick={() => onCommand('OPEN_TETHER_SETTINGS')} disabled={!canSendCommand} tone="blue" className="!gap-1 !px-2 !text-[11px] whitespace-nowrap">Tethering</ActionButton>
      </div>
      <p className="mt-3 text-center text-[10px] leading-4 text-slate-500">
        The phone stays awake during live sessions. Android ends screen sharing if the hardware or dashboard Lock control is used.
      </p>
    </section>
  );
}

export default function PhoneControlPage({
  onNavigateToDashboard,
  onLogout,
  currentUser,
  allStationsData = [],
  t = (key) => key,
}) {
  const [devices, setDevices] = useState([]);
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [commandStatus, setCommandStatus] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [assignmentStationId, setAssignmentStationId] = useState('');
  const [enrollmentCountry, setEnrollmentCountry] = useState('CA');
  const [enrollmentStationId, setEnrollmentStationId] = useState('');
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [liveRequestedDeviceId, setLiveRequestedDeviceId] = useState('');
  const [agentUpdateChecking, setAgentUpdateChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isAdmin = currentUser?.isAdmin === true || currentUser?.role === 'admin' || currentUser?.username === 'chargerent';
  const hasPhoneControlAccess = isAdmin || currentUser?.features?.phone_control === true;
  const accessibleKiosks = useMemo(
    () => filterStationsForClient(allStationsData, currentUser),
    [allStationsData, currentUser],
  );

  const loadDevices = useCallback(async (showSpinner = false) => {
    if (!hasPhoneControlAccess) {
      setDevices([]);
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      const response = await callFunctionWithAuth('phoneControl_listDevices');
      const nextDevices = (Array.isArray(response?.devices) ? response.devices : [])
        .map((device) => normalizePhoneDevice(device, device.id || device.deviceId))
        .sort((left, right) => (
          (left.stationId || 'ZZZZ').localeCompare(right.stationId || 'ZZZZ') || left.id.localeCompare(right.id)
        ));
      setDevices(nextDevices);
      setLoadError('');
      setSelectedDeviceId((current) => (
        nextDevices.some((device) => device.id === current) ? current : nextDevices[0]?.id || ''
      ));
    } catch (error) {
      console.error('Unable to load managed phones', error);
      setLoadError('Unable to load managed phones. The Mobile Device Management service may not be deployed yet.');
    } finally {
      setLoading(false);
    }
  }, [hasPhoneControlAccess]);

  useEffect(() => {
    loadDevices(true);
    const interval = window.setInterval(() => loadDevices(false), 15_000);
    return () => window.clearInterval(interval);
  }, [loadDevices]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  const loadCommands = useCallback(async () => {
    if (!selectedDeviceId || !hasPhoneControlAccess) {
      setCommands([]);
      return;
    }
    try {
      const response = await callFunctionWithAuth('phoneControl_listCommands', {
        deviceId: selectedDeviceId,
      });
      setCommands((Array.isArray(response?.commands) ? response.commands : [])
        .sort((left, right) => commandTimestamp(right) - commandTimestamp(left))
        .slice(0, 6));
    } catch (error) {
      console.error('Unable to load phone command activity', error);
    }
  }, [hasPhoneControlAccess, selectedDeviceId]);

  useEffect(() => {
    loadCommands();
    const interval = window.setInterval(loadCommands, 5_000);
    return () => window.clearInterval(interval);
  }, [loadCommands]);

  useEffect(() => {
    if (!selectedDeviceId || !hasPhoneControlAccess) return undefined;
    let cancelled = false;
    let timeoutId = null;

    const loadScreen = async () => {
      let nextDelayMs = liveRequestedDeviceId === selectedDeviceId ? 1_500 : 5_000;
      try {
        const response = await callFunctionWithAuth('phoneControl_getScreen', {
          deviceId: selectedDeviceId,
        }, { forceRefreshToken: false });
        if (cancelled) return;
        const nextScreen = response?.screen && typeof response.screen === 'object' ? response.screen : {};
        setDevices((current) => current.map((device) => (
          device.id === selectedDeviceId ? { ...device, screen: nextScreen } : device
        )));
        const liveActive = nextScreen.live?.active === true &&
          phoneTimestampToMillis(nextScreen.live?.expiresAt) > Date.now();
        const webRtcState = String(nextScreen.webrtc?.state || '');
        const webRtcExpiresAt = phoneTimestampToMillis(nextScreen.webrtc?.expiresAt);
        const webRtcActive = isPhoneWebRtcActive(nextScreen.webrtc, Date.now());
        const webRtcExpired = ['awaiting_permission', 'starting', 'connecting', 'disconnected']
          .includes(webRtcState) && webRtcExpiresAt > 0 && webRtcExpiresAt <= Date.now();
        if (liveActive || webRtcActive) {
          nextDelayMs = webRtcActive ? 1_000 : 1_500;
          setLiveRequestedDeviceId('');
        } else if (webRtcExpired || ['failed', 'permission_denied', 'expired', 'projection_stopped', 'stopped'].includes(webRtcState)) {
          nextDelayMs = 5_000;
          if (webRtcExpired && liveRequestedDeviceId === selectedDeviceId) {
            setCommandStatus({
              state: 'error',
              message: 'Live screen timed out before Android approved screen sharing.',
            });
          }
          setLiveRequestedDeviceId('');
        }
      } catch (error) {
        if (!cancelled) console.error('Unable to refresh the live phone screen', error);
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(loadScreen, nextDelayMs);
        }
      }
    };

    loadScreen();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [hasPhoneControlAccess, liveRequestedDeviceId, selectedDeviceId]);

  const kioskByStationId = useMemo(() => new Map(
    accessibleKiosks.map((kiosk) => [stationIdOf(kiosk), kiosk]).filter(([stationId]) => stationId),
  ), [accessibleKiosks]);

  const assignedStationIds = useMemo(() => new Set(
    devices.map((device) => device.stationId).filter(Boolean),
  ), [devices]);

  const kioskOptions = useMemo(() => accessibleKiosks
    .map((kiosk) => ({
      stationId: stationIdOf(kiosk),
      countryCode: getPhoneKioskCountryCode(kiosk),
      label: kiosk?.info?.location || kiosk?.info?.place || kiosk?.info?.client || '',
    }))
    .filter((kiosk) => kiosk.stationId)
    .sort((left, right) => left.stationId.localeCompare(right.stationId)), [accessibleKiosks]);

  const enrollmentKioskOptions = useMemo(() => (
    kioskOptions.filter((kiosk) => kiosk.countryCode === enrollmentCountry)
  ), [enrollmentCountry, kioskOptions]);

  const filteredDevices = useMemo(() => devices.filter((device) => {
    const connection = getPhoneConnectionState(device, now);
    if (filter === 'online' && connection !== 'online') return false;
    if (filter === 'offline' && connection === 'online') return false;
    if (filter === 'unassigned' && device.stationId) return false;
    return phoneMatchesSearch(device, kioskByStationId.get(device.stationId), search);
  }), [devices, filter, kioskByStationId, now, search]);

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) || null;
  const selectedKiosk = selectedDevice ? getKioskForPhone(selectedDevice, accessibleKiosks) : null;
  const selectedConnection = getPhoneConnectionState(selectedDevice, now);
  const canControlSelected = hasPhoneControlAccess && selectedConnection === 'online' && selectedDevice?.enrollmentState === 'enrolled';
  const selectedWebRtcActive = isPhoneWebRtcActive(selectedDevice?.screen?.webrtc, now);

  useEffect(() => {
    setAssignmentStationId(selectedDevice?.stationId || '');
  }, [selectedDevice?.id, selectedDevice?.stationId]);

  const sendCommand = useCallback(async (operation, args = {}, confirmed = false) => {
    if (!selectedDevice?.id) return;
    const requestId = createPhoneCommandRequestId(operation, selectedDevice.id);
    const actionLabel = commandActionLabel(operation, args);
    const targetLabel = selectedDevice.stationId || selectedDevice.displayName || 'the phone';
    setCommandStatus({ state: 'sending', message: `${actionLabel}…` });

    try {
      const result = await callFunctionWithAuth('phoneControl_sendCommand', {
        requestId,
        deviceId: selectedDevice.id,
        operation,
        arguments: args,
        confirmed,
      });
      setCommandStatus({
        state: 'pending',
        message: `${actionLabel} request sent to ${targetLabel}.`,
      });
      return result;
    } catch (error) {
      setCommandStatus({ state: 'error', message: humanizePhoneMessage(error?.message || 'Phone command failed.') });
      return null;
    }
  }, [selectedDevice]);

  const requestCommand = useCallback((operation, args = {}) => {
    if (CONFIRMATION_REQUIRED_PHONE_OPERATIONS.has(operation)) {
      setConfirmation({ operation, args });
      return;
    }
    sendCommand(operation, args, false);
  }, [sendCommand]);

  const requestAgentUpdate = useCallback(async () => {
    if (!selectedDevice?.id || agentUpdateChecking) return;
    setAgentUpdateChecking(true);
    setCommandStatus({ state: 'sending', message: 'Checking for the latest Agent release…' });
    try {
      const release = await fetchCurrentAgentRelease();
      const installedVersionCode = Number(selectedDevice.inventory.agentVersionCode || 0);
      const sameNamedVersion = selectedDevice.inventory.agentVersion === release.versionName;
      if ((installedVersionCode > 0 && installedVersionCode >= release.versionCode) ||
          (!installedVersionCode && sameNamedVersion)) {
        setCommandStatus({
          state: 'success',
          message: `Agent ${release.versionName} is already installed on ${selectedDevice.stationId || 'this phone'}.`,
        });
        return;
      }
      setCommandStatus(null);
      setConfirmation({
        operation: 'INSTALL_APP_UPDATE',
        args: {
          httpsUrl: release.apkUrl,
          sha256: release.apkSha256,
          versionCode: release.versionCode,
          versionName: release.versionName,
        },
      });
    } catch (error) {
      setCommandStatus({
        state: 'error',
        message: humanizePhoneMessage(error?.message || 'Could not check for Agent updates.'),
      });
    } finally {
      setAgentUpdateChecking(false);
    }
  }, [agentUpdateChecking, selectedDevice]);

  const startRealtimeScreen = useCallback(async (arguments_) => {
    if (!selectedDevice?.id) return;
    setLiveRequestedDeviceId(selectedDevice.id);
    return sendCommand('START_WEBRTC_SCREEN', arguments_, false);
  }, [selectedDevice, sendCommand]);

  const stopRealtimeScreen = useCallback((sessionId) => {
    setLiveRequestedDeviceId('');
    sendCommand('STOP_WEBRTC_SCREEN', { sessionId }, false);
  }, [sendCommand]);

  const startLivePreview = useCallback(() => {
    if (!selectedDevice?.id) return;
    sendCommand('START_LIVE_SCREEN', { durationSeconds: 120, intervalMs: 1_200 }, false);
  }, [selectedDevice, sendCommand]);

  const stopLivePreview = useCallback(() => {
    sendCommand('STOP_LIVE_SCREEN', {}, false);
  }, [sendCommand]);

  const assignSelectedPhone = async () => {
    if (!selectedDevice?.id || !assignmentStationId) return;
    setCommandStatus({ state: 'sending', message: `Assigning phone to ${assignmentStationId}…` });
    try {
      const result = await callFunctionWithAuth('phoneControl_assignDevice', {
        deviceId: selectedDevice.id,
        stationId: assignmentStationId,
      });
      setCommandStatus({ state: 'success', message: result?.message || `Phone assigned to ${assignmentStationId}.` });
    } catch (error) {
      setCommandStatus({ state: 'error', message: error?.message || 'Phone assignment failed.' });
    }
  };

  const createEnrollment = async () => {
    if (!enrollmentStationId) return;
    setCommandStatus({ state: 'sending', message: `Creating enrollment for ${enrollmentStationId}…` });
    setEnrollmentCode('');
    try {
      const result = await callFunctionWithAuth('phoneControl_createEnrollment', { stationId: enrollmentStationId });
      setEnrollmentCode(String(result?.enrollmentCode || ''));
      setCommandStatus({ state: 'success', message: result?.message || `Enrollment ready for ${enrollmentStationId}.` });
    } catch (error) {
      setCommandStatus({ state: 'error', message: error?.message || 'Could not create enrollment.' });
    }
  };

  const onlineCount = devices.filter((device) => getPhoneConnectionState(device, now) === 'online').length;
  const unassignedCount = devices.filter((device) => !device.stationId).length;
  const attentionCount = devices.filter((device) => (
    getPhoneConnectionState(device, now) !== 'online' || !device.inventory.isDeviceOwner || !device.inventory.remoteUiInputEnabled
  )).length;

  if (!hasPhoneControlAccess) {
    return <div className="min-h-screen bg-gray-100 p-6"><div className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">Mobile Device Management is not enabled for this account.</div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 text-slate-900">
      <CommandStatusToast status={commandStatus} onDismiss={() => setCommandStatus(null)} />
      <ConfirmationModal
        isOpen={Boolean(confirmation)}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          sendCommand(confirmation.operation, confirmation.args, true);
          setConfirmation(null);
        }}
        details={phoneCommandConfirmationDetails(confirmation, selectedDevice)}
        t={t}
      />

      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="truncate text-xl font-black text-slate-900">Mobile Device Management</h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onNavigateToDashboard} className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300" title="Back to dashboard" aria-label="Back to dashboard">
              <HomeIcon className="h-6 w-6" />
            </button>
            <button type="button" onClick={onLogout} className="rounded-md bg-red-500 p-2 text-white hover:bg-red-600" title={t('logout')} aria-label={t('logout')}>
              <PowerIcon className="h-6 w-6" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Managed phones" value={devices.length} detail="One phone per assigned kiosk" />
          <SummaryCard label="Online" value={onlineCount} detail="Heartbeat within 90 seconds" tone="green" />
          <SummaryCard label="Needs attention" value={attentionCount} detail="Offline or missing control access" tone={attentionCount ? 'red' : 'green'} />
          <SummaryCard label="Unassigned" value={unassignedCount} detail="Not linked to a kiosk" tone={unassignedCount ? 'amber' : 'slate'} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label htmlFor="phone-search" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Find kiosk or phone</label>
              <input id="phone-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Station ID, location, client, model, or device ID" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${filter === item.value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {loadError && <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-700">{loadError}</div>}

        {loading ? <LoadingSpinner t={t} /> : (
          <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.6fr)]">
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">Kiosk phones</h2>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">{filteredDevices.length}</span>
              </div>

              {filteredDevices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <DevicePhoneMobileIcon className="mx-auto h-12 w-12 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-700">No matching phones</p>
                  <p className="mt-1 text-xs text-slate-500">{isAdmin ? 'Create an enrollment below to connect the first kiosk phone.' : 'No managed phones are assigned to your partner kiosks.'}</p>
                </div>
              ) : filteredDevices.map((device) => {
                const kiosk = kioskByStationId.get(device.stationId);
                const connection = getPhoneConnectionState(device, now);
                const style = STATE_STYLES[connection];
                const selected = device.id === selectedDeviceId;
                return (
                  <button key={device.id} type="button" onClick={() => setSelectedDeviceId(device.id)} className={`w-full rounded-xl border p-4 text-left shadow-sm transition ${selected ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                          <p className="truncate text-base font-black text-slate-900">{device.stationId || 'Unassigned phone'}</p>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">{kiosk?.info?.location || kiosk?.info?.place || device.displayName || device.id}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${style.badge}`}>{style.label}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs text-slate-500">
                      <span className="truncate font-semibold">{device.inventory.model}</span>
                      <span className="shrink-0">{formatPhoneRelativeTime(device.lastSeenAtMs, now)}</span>
                    </div>
                  </button>
                );
              })}

              {isAdmin && <FieldProvisioningCard />}

              {isAdmin && <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-black text-slate-900">Enroll a kiosk phone</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Create a one-time code tied to a kiosk, then enter it in Agent.</p>
                <div className="mt-3 grid grid-cols-3 rounded-lg bg-slate-100 p-1" role="group" aria-label="Enrollment kiosk country">
                  {PHONE_KIOSK_COUNTRIES.map((country) => (
                    <button
                      key={country.code}
                      type="button"
                      onClick={() => {
                        setEnrollmentCountry(country.code);
                        setEnrollmentStationId('');
                        setEnrollmentCode('');
                      }}
                      aria-pressed={enrollmentCountry === country.code}
                      className={`rounded-md px-2 py-2 text-xs font-bold transition ${enrollmentCountry === country.code ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      {country.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <select value={enrollmentStationId} onChange={(event) => setEnrollmentStationId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Select {PHONE_KIOSK_COUNTRIES.find((country) => country.code === enrollmentCountry)?.label} kiosk</option>
                    {enrollmentKioskOptions.map((kiosk) => <option key={kiosk.stationId} value={kiosk.stationId} disabled={assignedStationIds.has(kiosk.stationId)}>{kiosk.stationId}{kiosk.label ? ` — ${kiosk.label}` : ''}</option>)}
                  </select>
                  <button type="button" onClick={createEnrollment} disabled={!enrollmentStationId} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">Create</button>
                </div>
                {enrollmentCode && (
                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600">One-time enrollment code</p>
                    <p className="mt-1 font-mono text-2xl font-black tracking-[0.22em] text-blue-900">{enrollmentCode}</p>
                  </div>
                )}
              </div>}
            </section>

            <section>
              {!selectedDevice ? (
                <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <div><DevicePhoneMobileIcon className="mx-auto h-14 w-14 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-700">Select a kiosk phone</p></div>
                </div>
              ) : (
                <div className="space-y-4">
                  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-2xl font-black text-slate-900">{selectedDevice.stationId || 'Unassigned phone'}</h2>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${STATE_STYLES[selectedConnection].badge}`}>{STATE_STYLES[selectedConnection].label}</span>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${selectedDevice.inventory.isDeviceOwner ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>{selectedDevice.inventory.isDeviceOwner ? 'Device Owner' : 'Owner missing'}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{selectedKiosk?.info?.location || selectedKiosk?.info?.place || 'No kiosk location'}{selectedKiosk?.info?.client ? ` · ${selectedKiosk.info.client}` : ''}</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">{selectedDevice.id}</p>
                      </div>
                      {isAdmin && <div className="flex min-w-[260px] gap-2">
                        <select value={assignmentStationId} onChange={(event) => setAssignmentStationId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                          <option value="">Assign to kiosk</option>
                          {kioskOptions.map((kiosk) => <option key={kiosk.stationId} value={kiosk.stationId} disabled={assignedStationIds.has(kiosk.stationId) && kiosk.stationId !== selectedDevice.stationId}>{kiosk.stationId}</option>)}
                        </select>
                        <button type="button" onClick={assignSelectedPhone} disabled={!assignmentStationId || assignmentStationId === selectedDevice.stationId} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">Assign</button>
                      </div>}
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
                      <Metric icon={Battery100Icon} label="Battery" value={selectedDevice.inventory.batteryPercent == null ? 'Unknown' : `${selectedDevice.inventory.batteryPercent}%${selectedDevice.inventory.batteryCharging ? ' · Charging' : ''}`} />
                      <Metric icon={SignalIcon} label="Network" value={phoneNetworkLabel(selectedDevice.inventory)} active={selectedDevice.inventory.network !== 'offline'} />
                      <Metric icon={WifiIcon} label="Hotspot" value={phoneHotspotLabel(selectedDevice.inventory)} active={selectedDevice.inventory.hotspotActive} />
                      <Metric icon={DevicePhoneMobileIcon} label="Phone" value={`${selectedDevice.inventory.model}${selectedDevice.inventory.androidVersion ? ` · Android ${selectedDevice.inventory.androidVersion}` : ''}`} />
                      <Metric icon={BoltIcon} label="Agent" value={selectedDevice.inventory.agentVersion ? `v${selectedDevice.inventory.agentVersion}` : selectedDevice.enrollmentState} active={selectedDevice.enrollmentState === 'enrolled'} />
                    </div>

                    {selectedDevice.inventory.hotspotLastError && selectedDevice.inventory.hotspotAlwaysOn && !selectedDevice.inventory.hotspotActive && (
                      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        Hotspot: {humanizePhoneMessage(selectedDevice.inventory.hotspotLastError)}
                      </p>
                    )}

                  </section>

                  <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
                    <RemoteScreen
                      device={selectedDevice}
                      canControl={canControlSelected && selectedDevice.inventory.remoteUiInputEnabled}
                      canSendCommand={canControlSelected}
                      onCommand={requestCommand}
                      onStartRealtime={startRealtimeScreen}
                      onStopRealtime={stopRealtimeScreen}
                      onStartPreview={startLivePreview}
                      onStopPreview={stopLivePreview}
                      liveRequested={liveRequestedDeviceId === selectedDevice.id}
                      now={now}
                    />

                    <div className="space-y-4">
                      <PhoneLocationCard
                        device={selectedDevice}
                        now={now}
                        onRefresh={() => requestCommand('GET_LOCATION')}
                        onToggleLocation={() => requestCommand('SET_LOCATION_ENABLED', { enabled: !selectedDevice.inventory.locationEnabled })}
                        locationEnabled={selectedDevice.inventory.locationEnabled}
                        canRefresh={canControlSelected}
                      />
                      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <ActionButton icon={LockOpenIcon} onClick={() => requestCommand('WAKE_AND_UNLOCK')} disabled={!canControlSelected} tone="blue">Unlock</ActionButton>
                          <WifiToggle enabled={selectedDevice.inventory.wifiEnabled} onToggle={() => requestCommand('SET_WIFI_ENABLED', { enabled: !selectedDevice.inventory.wifiEnabled })} disabled={!canControlSelected} />
                          <ActionButton icon={LockClosedIcon} onClick={() => requestCommand('LOCK_NOW')} disabled={!canControlSelected || selectedWebRtcActive} title={selectedWebRtcActive ? 'Stop the live stream before locking the phone' : ''} tone="amber">Lock</ActionButton>
                          <ActionButton icon={PowerIcon} onClick={() => requestCommand('REBOOT')} disabled={!canControlSelected} tone="red">Reboot</ActionButton>
                          <ActionButton
                            icon={WifiIcon}
                            onClick={() => requestCommand('SET_ALWAYS_ON_HOTSPOT', { enabled: !selectedDevice.inventory.hotspotAlwaysOn })}
                            disabled={!canControlSelected || !selectedDevice.inventory.hotspotSupported || !selectedDevice.inventory.hotspotControlGranted}
                            title={!selectedDevice.inventory.hotspotSupported
                              ? 'Always-on hotspot requires Android 16 or newer'
                              : !selectedDevice.inventory.hotspotControlGranted
                                ? 'Open Agent on the phone and approve always-on hotspot first'
                                : ''}
                            tone={selectedDevice.inventory.hotspotAlwaysOn ? 'green' : 'blue'}
                            className="col-span-2"
                          >
                            Always-on hotspot: {selectedDevice.inventory.hotspotAlwaysOn ? 'On' : 'Off'}
                          </ActionButton>
                          <ActionButton icon={ArrowPathIcon} onClick={requestAgentUpdate} disabled={!canControlSelected || agentUpdateChecking} tone="blue" className="col-span-2">
                            {agentUpdateChecking ? 'Checking for update…' : 'Update Agent'}
                          </ActionButton>
                        </div>
                      </section>
                      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-base font-black text-slate-900">Command activity</h3>
                      <div className="mt-4 space-y-2">
                        {commands.length === 0 ? <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">No commands recorded for this phone.</p> : commands.map((command) => {
                          const state = String(command.status || 'queued').toLowerCase();
                          return (
                            <div key={command.id} className="rounded-lg border border-slate-200 px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="truncate text-xs font-bold text-slate-800">{commandLabel(command.operation)}</span>
                                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${COMMAND_STYLES[state] || COMMAND_STYLES.queued}`}>{state}</span>
                              </div>
                              <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-slate-400">
                                <span className="truncate font-mono">{command.id}</span>
                                <span className="shrink-0">{formatPhoneRelativeTime(commandTimestamp(command), now)}</span>
                              </div>
                              {(command.error || command.result?.message) && <p className="mt-2 text-xs text-slate-600">{humanizePhoneMessage(command.error || command.result.message)}</p>}
                            </div>
                          );
                        })}
                      </div>
                      </section>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
