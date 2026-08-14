export const PHONE_WEBRTC_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export const PHONE_WEBRTC_PROFILES = {
  low: { label: 'Data saver', longEdge: 480, fps: 15, bitrateKbps: 700 },
  balanced: { label: 'Balanced', longEdge: 720, fps: 24, bitrateKbps: 1800 },
  high: { label: 'High quality', longEdge: 1080, fps: 30, bitrateKbps: 3500 },
};

const GLOBAL_ACTION_CODES = {
  BACK: 1,
  HOME: 2,
  RECENTS: 3,
  NOTIFICATIONS: 4,
  QUICK_SETTINGS: 5,
};

export function createWebRtcSessionId() {
  const random = globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `webrtc-${random}`;
}

export function encodePointerPacket(action, normalizedX, normalizedY, elapsedMs = 0) {
  const actions = { down: 0, move: 1, up: 2, cancel: 3 };
  const actionCode = actions[action];
  if (actionCode === undefined) throw new Error('Unsupported pointer action');
  const packet = new ArrayBuffer(9);
  const view = new DataView(packet);
  view.setUint8(0, 1);
  view.setUint8(1, 1);
  view.setUint8(2, actionCode);
  view.setUint16(3, Math.round(Math.max(0, Math.min(1, normalizedX)) * 65535));
  view.setUint16(5, Math.round(Math.max(0, Math.min(1, normalizedY)) * 65535));
  view.setUint16(7, Math.max(0, Math.min(65535, Math.round(elapsedMs))));
  return packet;
}

export function encodeGlobalActionPacket(action) {
  const actionCode = GLOBAL_ACTION_CODES[String(action || '').toUpperCase()];
  if (!actionCode) throw new Error('Unsupported global action');
  return Uint8Array.from([1, 2, actionCode]).buffer;
}

export function waitForIceGatheringComplete(peerConnection, timeoutMs = 6000) {
  if (peerConnection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      peerConnection.removeEventListener('icegatheringstatechange', handleStateChange);
      globalThis.clearTimeout(timeout);
      resolve();
    };
    const handleStateChange = () => {
      if (peerConnection.iceGatheringState === 'complete') finish();
    };
    const timeout = globalThis.setTimeout(finish, timeoutMs);
    peerConnection.addEventListener('icegatheringstatechange', handleStateChange);
  });
}

export function mediaPoint(event, mediaElement) {
  if (!mediaElement) return null;
  const bounds = mediaElement.getBoundingClientRect();
  const mediaWidth = Number(mediaElement.videoWidth || mediaElement.naturalWidth || 0);
  const mediaHeight = Number(mediaElement.videoHeight || mediaElement.naturalHeight || 0);
  if (!bounds.width || !bounds.height || !mediaWidth || !mediaHeight) return null;

  const scale = Math.min(bounds.width / mediaWidth, bounds.height / mediaHeight);
  const renderedWidth = mediaWidth * scale;
  const renderedHeight = mediaHeight * scale;
  const left = bounds.left + (bounds.width - renderedWidth) / 2;
  const top = bounds.top + (bounds.height - renderedHeight) / 2;
  if (event.clientX < left || event.clientX > left + renderedWidth ||
      event.clientY < top || event.clientY > top + renderedHeight) return null;
  return {
    x: Math.max(0, Math.min(1, (event.clientX - left) / renderedWidth)),
    y: Math.max(0, Math.min(1, (event.clientY - top) / renderedHeight)),
  };
}
