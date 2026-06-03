const TRACE_KEY = 'dashboardStartupTraceEnabled';

export function createTraceId(prefix = 'trace') {
  const safePrefix = String(prefix || 'trace').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 24) || 'trace';
  const randomSegment = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

  return `${safePrefix}-${Date.now()}-${randomSegment}`;
}

function canTrace() {
  if (typeof window === 'undefined') return false;

  try {
    return Boolean(import.meta.env.DEV) || window.localStorage.getItem(TRACE_KEY) === '1';
  } catch {
    return Boolean(import.meta.env.DEV);
  }
}

function getStore() {
  if (typeof window === 'undefined') return null;

  if (!window.__dashboardStartupTrace) {
    window.__dashboardStartupTrace = {
      label: 'startup',
      traceId: createTraceId('startup'),
      startedAt: performance.now(),
      steps: [],
    };
  }

  return window.__dashboardStartupTrace;
}

function roundDuration(value) {
  return Math.round(Number(value || 0));
}

export function resetStartupTrace(label = 'startup') {
  const traceId = createTraceId(label);

  if (typeof window !== 'undefined') {
    window.__dashboardStartupTrace = {
      label,
      traceId,
      startedAt: performance.now(),
      steps: [],
    };
  }

  if (!canTrace()) return traceId;

  console.log(`[StartupTrace:${traceId}] reset "${label}"`);
  return traceId;
}

export function markStartupStep(step, details = {}) {
  if (!canTrace()) return;

  const store = getStore();
  if (!store) return;

  const elapsedMs = roundDuration(performance.now() - store.startedAt);
  const entry = {
    step,
    elapsedMs,
    details,
    traceId: store.traceId,
    at: new Date().toISOString(),
  };

  store.steps.push(entry);
  console.log(`[StartupTrace:${store.traceId} +${elapsedMs}ms] ${step}`, details);
}

export function measureStartupDuration(startedAt) {
  return roundDuration(performance.now() - startedAt);
}

export function getStartupTraceId() {
  try {
    return window.__dashboardStartupTrace?.traceId || null;
  } catch {
    return null;
  }
}

export function isStartupTraceEnabled() {
  return canTrace();
}
