import {mediaUrl,mediaFetch} from './mediaApi.js';
const PREFIX = mediaUrl('/api/remote');
let session = null;
let pendingSession = null;

async function fetchJson(path, options = {}) {
  const response = await mediaFetch(`${PREFIX}${path}`, {...options, signal: AbortSignal.timeout(10000)});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || body.message || `Local remote service returned ${response.status}.`);
    error.status = response.status;
    error.code = body.error?.code;
    throw error;
  }
  return body;
}

async function authorize() {
  if (session && new Date(session.expiresAt).getTime() > Date.now() + 30000) return session.token;
  if (!pendingSession) pendingSession = fetchJson('/session', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-Lab-Client': 'chargerent-remote-studio'}, body: '{}',
  }).then(value => {session = value; return value.token;}).finally(() => {pendingSession = null;});
  return pendingSession;
}

// The page depends on this adapter only. A future authenticated production
// adapter must retain the command/result contract and enforce tenant access.
export async function remoteRequest(path, body, retry = true) {
  const token = await authorize();
  try {
    return await fetchJson(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
  } catch (error) {
    if (error.status === 401 && retry) {session = null; return remoteRequest(path, body, false);}
    throw error;
  }
}

export async function downloadRemoteApk() {
  const token=await authorize();
  const response=await mediaFetch(`${PREFIX}/release/apk`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok) {
    const body=await response.json().catch(()=>({}));
    throw new Error(body.error?.message || `APK download failed (${response.status}).`);
  }
  return response.blob();
}

export const requestId = () => crypto.randomUUID();
export const devicePath = device => `/devices/${encodeURIComponent(device.id || device.deviceId)}`;
export function capabilityFor(device, operation) {
  const capability = device?.capabilities?.find(item => item.operation === operation);
  if (capability) return capability;
  const inventory = device?.inventory || {};
  return {operation, supported: inventory.allowedOperations?.includes(operation) === true,
    reason: inventory.unavailableReasons?.[operation] || 'Waiting for the app to report this capability.'};
}
export function stamp(value) {
  if (!value) return 'Not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not reported' : date.toLocaleTimeString([], {hour:'numeric', minute:'2-digit', second:'2-digit'});
}
export function bytes(value) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return 'Not reported';
  return value > 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.round(value / 1024 ** 2)} MB`;
}
