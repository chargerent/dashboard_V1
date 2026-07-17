const RESPONSE_CONTAINER_FIELDS = ['payload', 'data', 'command', 'response'];
const REQUEST_ID_FIELDS = ['requestId', 'requestid', 'commandRequestId', 'bulkRequestId', 'parentRequestId'];
const ADMIN_ID_FIELDS = ['admin', '_session', 'socketId', 'socketid', 'sessionId', 'sessionid', 'clientSocketId'];
const ACTION_FIELDS = ['action', 'original_action', 'originalAction', 'commandAction'];
const STATION_ID_FIELDS = ['stationid', 'stationId', 'kioskid', 'kioskId', 'kiosk'];
const PROVISION_ID_FIELDS = ['provisionid', 'provisionId'];
const MESSAGE_FIELDS = ['status_en', 'statusEn', 'message', 'status_message', 'statusMessage'];
const STATUS_FIELDS = ['statuscode', 'statusCode', 'status'];
const SENDER_FIELDS = ['sender', 'source'];

export const LEGACY_UNTARGETED_RESPONSE_WINDOW_MS = 30 * 1000;
export const LEGACY_TARGETED_RESPONSE_WINDOW_MS = 10 * 60 * 1000;

function normalizeScopeId(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    return normalizeScopeId(value.id || value.socketId || value.socketid || value.sessionId || value.sessionid);
  }
  return String(value).trim();
}

function getResponseSources(data) {
  if (!data || typeof data !== 'object') return [];

  const sources = [];
  const queue = [data];
  const seen = new Set();

  while (queue.length > 0 && sources.length < 20) {
    const source = queue.shift();
    if (!source || typeof source !== 'object' || seen.has(source)) continue;

    seen.add(source);
    sources.push(source);
    RESPONSE_CONTAINER_FIELDS.forEach((field) => {
      if (source[field] && typeof source[field] === 'object') {
        queue.push(source[field]);
      }
    });
  }

  return sources;
}

function getFirstScalarEntry(data, fields) {
  for (const source of getResponseSources(data)) {
    for (const field of fields) {
      const value = source[field];
      if (value !== null && value !== undefined && typeof value !== 'object') {
        const normalized = String(value).trim();
        if (normalized) return { field, value: normalized };
      }
    }
  }

  return { field: '', value: '' };
}

function getFirstScalarValue(data, fields) {
  return getFirstScalarEntry(data, fields).value;
}

function collectScopeIds(data, fields) {
  return [...new Set(
    getResponseSources(data)
      .flatMap((source) => fields.map((field) => normalizeScopeId(source[field])))
      .filter(Boolean)
  )];
}

export function normalizeKioskCommandAction(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  const compact = normalized.replace(/\s+/g, '');

  if (compact === 'updateflow' || normalized === 'flow update') return 'update flow';
  if (compact === 'updateui' || normalized === 'ui update') return 'update ui';
  return normalized;
}

export function getCommandResponseRequestIds(data) {
  return collectScopeIds(data, REQUEST_ID_FIELDS);
}

export function getCommandResponseAdminId(data) {
  return collectScopeIds(data, ADMIN_ID_FIELDS)[0] || '';
}

export function getCommandResponseAction(data) {
  return normalizeKioskCommandAction(getFirstScalarValue(data, ACTION_FIELDS));
}

export function getCommandResponseMessage(data) {
  return getFirstScalarValue(data, MESSAGE_FIELDS);
}

export function getCommandResponseStationId(data) {
  const directStationId = getFirstScalarValue(data, STATION_ID_FIELDS);
  if (directStationId) return directStationId;

  return getCommandResponseMessage(data).match(/\bkiosk\s+([a-z0-9_-]*\d[a-z0-9_-]*)\b/i)?.[1] || '';
}

export function getCommandResponseProvisionId(data) {
  return getFirstScalarValue(data, PROVISION_ID_FIELDS);
}

export function getMatchingOutgoingCommandScope(scopes, requestIds) {
  for (const requestId of requestIds) {
    if (scopes.has(requestId)) {
      return scopes.get(requestId);
    }

    for (const [outgoingRequestId, scope] of scopes.entries()) {
      if (requestId.startsWith(`${outgoingRequestId}-`)) {
        return scope;
      }
    }
  }

  return null;
}

function scopeMatchesTarget(scope, stationId, provisionId) {
  if (stationId && String(scope?.stationid || '').trim().toLowerCase() !== stationId.toLowerCase()) {
    return false;
  }
  if (provisionId && String(scope?.provisionid || '').trim().toLowerCase() !== provisionId.toLowerCase()) {
    return false;
  }
  return true;
}

export function getMatchingLegacyCommandScope(scopes, data, now = Date.now()) {
  const requestIds = getCommandResponseRequestIds(data);
  const requestScope = getMatchingOutgoingCommandScope(scopes, requestIds);
  if (requestScope) return requestScope;
  if (requestIds.length > 0) return null;

  const action = getCommandResponseAction(data);
  if (!action) return null;
  const adminId = getCommandResponseAdminId(data);
  const sender = getFirstScalarValue(data, SENDER_FIELDS).toLowerCase();
  const isLegacyKioskUpdate = sender === 'kiosk' && Boolean(adminId) && (
    action === 'update flow' || action === 'update ui'
  );
  if (!isLegacyKioskUpdate) return null;

  const stationId = getCommandResponseStationId(data);
  const provisionId = getCommandResponseProvisionId(data);
  const hasTarget = Boolean(stationId || provisionId);
  const maxAgeMs = hasTarget
    ? LEGACY_TARGETED_RESPONSE_WINDOW_MS
    : LEGACY_UNTARGETED_RESPONSE_WINDOW_MS;
  const candidates = [...scopes.values()]
    .filter((scope) => normalizeKioskCommandAction(scope?.action) === action)
    .filter((scope) => {
      const createdAt = Number(scope?.createdAt || 0);
      return createdAt > 0 && now - createdAt >= 0 && now - createdAt <= maxAgeMs;
    })
    .filter((scope) => scopeMatchesTarget(scope, stationId, provisionId))
    .sort((left, right) => Number(right?.createdAt || 0) - Number(left?.createdAt || 0));

  return candidates.length === 1 ? candidates[0] : null;
}

function responseIndicatesFailure(data, message) {
  const rawStatus = getFirstScalarValue(data, STATUS_FIELDS).toLowerCase();
  if (rawStatus === '0' || ['error', 'failed', 'failure', 'rejected'].includes(rawStatus)) {
    return true;
  }
  return /\b(?:error|failed|failure|unable|could not|rejected)\b/i.test(message);
}

function responseIndicatesSuccess(data, message) {
  const rawStatus = getFirstScalarValue(data, STATUS_FIELDS).toLowerCase();
  if (rawStatus === '1' || ['success', 'successful', 'complete', 'completed'].includes(rawStatus)) {
    return true;
  }
  if (/\b(?:being|currently)\s+(?:updated|installed)\b/i.test(message)) return false;
  return /\b(?:has been updated|updated (?:flow|ui) (?:for|on) kiosk|(?:flow|ui) updated (?:for|on) kiosk|installed|complete|completed|successful|succeeded|already current)\b/i.test(message);
}

function parseVersionFromMessage(message) {
  const updatedToMatch = message.match(/\b(?:updated|upgraded|changed|installed)\s+to\s+(?:version\s+)?(.+?)\s*$/i);
  if (updatedToMatch?.[1]) return updatedToMatch[1].trim().replace(/[.,;:!?]+$/, '');

  const trailingToMatch = message.match(/\bto\s+(?:version\s+)?([a-z0-9][a-z0-9._+\-/]*(?:\s+[a-z0-9][a-z0-9._+\-/]*)*)\s*$/i);
  return trailingToMatch?.[1]?.trim().replace(/[.,;:!?]+$/, '') || '';
}

export function parseKioskSoftwareUpdateResponse(data, type = 'flow') {
  const normalizedType = type === 'ui' ? 'ui' : 'flow';
  const action = getCommandResponseAction(data);
  const message = getCommandResponseMessage(data);
  const expectedAction = `update ${normalizedType}`;
  const messageMentionsUpdate = normalizedType === 'flow'
    ? /\bflow\s+(?:on|for)\s+kiosk\b/i.test(message)
    : /\bui\s+(?:on|for)\s+kiosk\b/i.test(message);

  if (action && action !== expectedAction) return null;
  if (action !== expectedAction && !messageMentionsUpdate) return null;

  const stationid = getCommandResponseStationId(data);
  const authoritativeVersionFields = normalizedType === 'flow'
    ? ['fversion', 'flowVersion', 'flowversion']
    : ['uiVersion', 'uiversion'];
  const directVersionFields = [...authoritativeVersionFields, 'version'];
  const authoritativeVersion = getFirstScalarValue(data, authoritativeVersionFields);
  const version = getFirstScalarValue(data, directVersionFields) || parseVersionFromMessage(message);
  const failed = responseIndicatesFailure(data, message);
  const succeeded = !failed && responseIndicatesSuccess(data, message);
  const terminalMessage = responseIndicatesSuccess({}, message);
  const complete = Boolean(succeeded && stationid && version && (terminalMessage || authoritativeVersion));

  return {
    action: expectedAction,
    complete,
    message,
    stationid,
    state: failed ? 'error' : (succeeded ? 'success' : 'pending'),
    version,
  };
}
