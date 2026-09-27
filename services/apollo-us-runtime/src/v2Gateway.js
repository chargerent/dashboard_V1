const clean = (value) => String(value ?? '').trim();
const upper = (value) => clean(value).toUpperCase();

const requestPrefix = 'apollo-uslab';

export function parseBrokerCredentials(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_error) {
      throw new Error('The V2 MQTT credential secret is not valid JSON.');
    }
  }
  const username = clean(parsed?.username);
  const password = clean(parsed?.password);
  if (!username || !password) throw new Error('The V2 MQTT credential secret is incomplete.');
  return {username, password};
}

export function availabilityRequestId(sessionId) {
  return `${requestPrefix}-status-${clean(sessionId)}`;
}

export function vendRequestId(sessionId) {
  return `${requestPrefix}-vend-${clean(sessionId)}`;
}

function responseIdentity(requestId) {
  const match = clean(requestId).match(/^apollo-uslab-(status|vend)-([A-Za-z0-9_-]{8,120})$/);
  return match ? {action: match[1], sessionId: match[2]} : null;
}

export function cstaResponseToKioskEvent(topic, value) {
  let payload = value;
  if (Buffer.isBuffer(payload)) payload = payload.toString('utf8');
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (_error) {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const stationId = upper(payload.stationid);
  const action = clean(payload.action).toLowerCase();
  if (topic === 'CSTA/post' && action === 'return') {
    const module = payload.moduleid;
    const slot = payload.slotid;
    const chargerId = clean(payload.chargerid);
    if (!stationId || Number(payload.status) !== 1 || module === undefined || module === null || slot === undefined || slot === null || !chargerId) return null;
    const returnedAt = Number(payload.timeresponded);
    return {
      schemaVersion: 1,
      type: 'return_result',
      stationId,
      success: true,
      module,
      slot,
      chargerId,
      ...(Number.isInteger(returnedAt) && returnedAt >= 0 ? {returnedAt} : {}),
    };
  }

  const identity = responseIdentity(payload.requestId || payload.requestid);
  if (!identity || action !== identity.action) return null;
  if (!stationId || topic !== `CSTA/post/${stationId}`) return null;

  if (identity.action === 'status') {
    const candidate = payload.vendbattery && typeof payload.vendbattery === 'object' ? payload.vendbattery : null;
    const hasCandidate = Boolean(candidate && candidate.sn && candidate.slot !== undefined && candidate.slot !== null && payload.moduleid !== undefined && payload.moduleid !== null);
    return {
      schemaVersion: 1,
      type: 'availability_result',
      sessionId: identity.sessionId,
      commandId: `availability:${identity.sessionId}`,
      available: Array.isArray(payload.status) && payload.status.length > 0 && hasCandidate,
      ...(hasCandidate ? {module: payload.moduleid, slot: candidate.slot, chargerId: String(candidate.sn)} : {}),
    };
  }

  const numericStatus = Number(payload.status);
  const reason = clean(payload.status_en || payload.reason || 'vend_failed');
  const success = numericStatus === 1 && !/(fail|error|jam|timeout)/i.test(reason);
  return {
    schemaVersion: 1,
    type: 'vend_result',
    sessionId: identity.sessionId,
    commandId: `vend:${identity.sessionId}`,
    success,
    ...(payload.moduleid !== undefined && payload.moduleid !== null ? {module: payload.moduleid} : {}),
    ...(payload.slotid !== undefined && payload.slotid !== null ? {slot: payload.slotid} : {}),
    ...(payload.chargerid ? {chargerId: String(payload.chargerid)} : {}),
    ...(!success ? {reason: reason.slice(0, 500)} : {}),
  };
}
