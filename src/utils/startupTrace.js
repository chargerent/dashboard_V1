const TRACE_KEY = 'dashboardStartupTraceEnabled';

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
  if (!canTrace()) return;

  window.__dashboardStartupTrace = {
    label,
    startedAt: performance.now(),
    steps: [],
  };

  console.log(`[StartupTrace] reset "${label}"`);
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
    at: new Date().toISOString(),
  };

  store.steps.push(entry);
  console.log(`[StartupTrace +${elapsedMs}ms] ${step}`, details);
}

export function measureStartupDuration(startedAt) {
  return roundDuration(performance.now() - startedAt);
}

export function isStartupTraceEnabled() {
  return canTrace();
}
