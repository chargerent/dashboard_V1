const DEBUG_STORAGE_KEY = 'debugKioskInteractions';
const MAX_LOG_ENTRIES = 300;

const truthyValues = new Set(['1', 'true', 'yes', 'on']);

function getWindow() {
  return typeof window === 'undefined' ? null : window;
}

export function isKioskInteractionDebugEnabled() {
  const win = getWindow();
  if (!win) return false;

  try {
    const urlValue = new URLSearchParams(win.location.search).get(DEBUG_STORAGE_KEY);
    if (urlValue && truthyValues.has(urlValue.toLowerCase())) {
      return true;
    }

    const storedValue = win.localStorage.getItem(DEBUG_STORAGE_KEY);
    return storedValue ? truthyValues.has(storedValue.toLowerCase()) : false;
  } catch {
    return false;
  }
}

function getElement(value) {
  if (!value) return null;
  if (value.nodeType === 1) return value;
  return value.parentElement || null;
}

function describeElement(value) {
  const element = getElement(value);
  if (!element) return null;

  const className = typeof element.className === 'string'
    ? element.className
    : '';
  const text = String(element.innerText || element.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return {
    tag: element.tagName?.toLowerCase() || '',
    id: element.id || '',
    className,
    text,
    disabled: Boolean(element.disabled),
    title: element.getAttribute?.('title') || '',
    action: element.getAttribute?.('data-kiosk-action') || '',
    slot: element.getAttribute?.('data-kiosk-slotid') || '',
    module: element.getAttribute?.('data-kiosk-moduleid') || '',
    station: element.getAttribute?.('data-kiosk-stationid') || '',
    disabledReason: element.getAttribute?.('data-kiosk-disabled-reason') || '',
  };
}

function getEventPoint(event) {
  const touch = event?.changedTouches?.[0] || event?.touches?.[0];
  const clientX = Number.isFinite(event?.clientX) ? event.clientX : touch?.clientX;
  const clientY = Number.isFinite(event?.clientY) ? event.clientY : touch?.clientY;

  return Number.isFinite(clientX) && Number.isFinite(clientY)
    ? { clientX, clientY }
    : null;
}

function getClosestInteractive(target) {
  const element = getElement(target);
  return element?.closest?.('button,a,input,select,textarea,[role="button"]') || null;
}

function getRelevantKioskElement(target) {
  const element = getElement(target);
  return element?.closest?.(
    '[data-kiosk-action],[data-kiosk-slot-debug],[data-kiosk-detail-panel],[data-kiosk-control-panel]'
  ) || null;
}

function summarizeEvent(event) {
  if (!event) return null;

  const point = getEventPoint(event);
  const pointElement = point
    ? document.elementFromPoint(point.clientX, point.clientY)
    : null;
  const nearestInteractive = getClosestInteractive(event.target);

  return {
    type: event.type,
    pointerType: event.pointerType || '',
    button: event.button,
    buttons: event.buttons,
    defaultPrevented: Boolean(event.defaultPrevented),
    cancelable: Boolean(event.cancelable),
    point,
    target: describeElement(event.target),
    currentTarget: describeElement(event.currentTarget),
    elementFromPoint: describeElement(pointElement),
    nearestInteractive: describeElement(nearestInteractive),
  };
}

export function logKioskInteraction(stage, details = {}, event = null) {
  if (!isKioskInteractionDebugEnabled()) return;

  const win = getWindow();
  const entry = {
    at: new Date().toISOString(),
    stage,
    details,
    event: summarizeEvent(event),
  };

  try {
    const log = Array.isArray(win.__kioskInteractionDebugLog)
      ? win.__kioskInteractionDebugLog
      : [];
    log.push(entry);
    win.__kioskInteractionDebugLog = log.slice(-MAX_LOG_ENTRIES);
  } catch {
    // Console output is still useful if persisting the in-memory log fails.
  }

  const logger = stage.includes('blocked') || stage.includes('disabled')
    ? console.warn
    : console.info;
  logger(`[KioskInteractionDebug] ${stage}`, entry);
}

export function installKioskInteractionDebugCapture() {
  const win = getWindow();
  if (!win || !win.document) return () => {};

  const handler = (event) => {
    if (!isKioskInteractionDebugEnabled()) return;

    const relevantElement = getRelevantKioskElement(event.target);
    if (!relevantElement) return;

    logKioskInteraction(
      `document:${event.type}`,
      {
        relevantElement: describeElement(relevantElement),
      },
      event
    );
  };

  ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend'].forEach((eventName) => {
    win.document.addEventListener(eventName, handler, { capture: true, passive: true });
  });

  logKioskInteraction('capture-installed');

  return () => {
    ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend'].forEach((eventName) => {
      win.document.removeEventListener(eventName, handler, { capture: true });
    });
    logKioskInteraction('capture-removed');
  };
}
