/* eslint-env node */

const crypto = require("node:crypto");

const EVENTS_COLLECTION = "kioskEvents";
const INCIDENTS_COLLECTION = "kioskIncidents";
const MONITORS_COLLECTION = "kioskStateMonitors";
const EVENT_RETENTION_DAYS = 90;
const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const CRITICAL_OFFLINE_WINDOW_MS = 30 * 60 * 1000;
const ACTIVE_KIOSK_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
const V2_STATION_PATTERN = /^((CA|FR|US)8\d{3}|(CAB|FRB|USB)\d{4})$/;
const V2_TYPES = new Set(["CK24", "CK48", "CT3", "CT4", "CT8", "CT12"]);

const UI_STATE_POLICIES = [
  {pattern: /start|idle|home/i, timeoutMs: null, label: "Start"},
  {pattern: /payment credited|credited/i, timeoutMs: 60_000, label: "Payment credited"},
  {pattern: /please wait|processing|authoriz/i, timeoutMs: 90_000, label: "Processing"},
  {pattern: /vend|dispens|eject/i, timeoutMs: 90_000, label: "Vend in progress"},
  {pattern: /refund|credit|failure|failed|error/i, timeoutMs: 90_000, label: "Result"},
  {pattern: /thank|return.*complete|success/i, timeoutMs: 60_000, label: "Completion"},
  {pattern: /rent|return|map|term|info|language|scan/i, timeoutMs: 120_000, label: "Customer screen"},
];

const asMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && Number.isFinite(value._seconds)) {
    return (value._seconds * 1000) + Math.floor((value._nanoseconds || 0) / 1e6);
  }
  return null;
};

const normalizeText = (value) => String(value ?? "").trim();

const isV2Kiosk = (kiosk) => {
  const stationId = normalizeText(kiosk?.stationid).toUpperCase();
  const type = normalizeText(kiosk?.hardware?.type).toUpperCase();
  return kiosk?.isNewSchema === true || V2_STATION_PATTERN.test(stationId) ||
    V2_TYPES.has(type);
};

const normalizeModules = (kiosk) => {
  const source = kiosk?.modules;
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== "object") return [];
  return Object.entries(source)
      .filter(([key, value]) => /^\d+$/.test(key) && value && typeof value === "object")
      .map(([key, value]) => ({...value, id: value.id || key}));
};

const moduleKey = (module, index) => normalizeText(
    module?.id ?? module?.moduleId ?? module?.movement ?? module?.position ?? index + 1,
);

const moduleConnected = (module, kiosk, nowMs) => {
  if (isV2Kiosk(kiosk)) {
    const lastSeen = asMillis(module?.lastUpdated ?? module?.timestamp ?? module?.lastSeenAt);
    if (lastSeen != null) return nowMs - lastSeen <= ONLINE_WINDOW_MS;
    if (typeof module?.heartbeatOutput === "boolean") return module.heartbeatOutput;
    return module?.output !== false;
  }
  if (typeof module?.serialstatus === "boolean") return module.serialstatus;
  if (typeof module?.heartbeatOutput === "boolean") return module.heartbeatOutput;
  return module?.output !== false;
};

const comparableKioskState = (kiosk, nowMs = Date.now()) => ({
  mqtt: kiosk?.mqtt === true,
  uiState: normalizeText(kiosk?.uistate),
  button: normalizeText(kiosk?.button),
  renting: kiosk?.renting === true,
  disabled: kiosk?.disabled === true,
  lastScanAt: asMillis(kiosk?.lastscan?.time),
  lastScanCode: normalizeText(kiosk?.lastscan?.barcode),
  modules: Object.fromEntries(normalizeModules(kiosk).map((module, index) => [
    moduleKey(module, index),
    {
      connected: moduleConnected(module, kiosk, nowMs),
      lastUpdated: asMillis(module?.lastUpdated ?? module?.timestamp ?? module?.lastSeenAt),
    },
  ])),
});

const eventId = () => crypto.randomUUID();
const incidentDocId = (incidentKey) => crypto.createHash("sha256")
    .update(incidentKey)
    .digest("hex")
    .slice(0, 40);

const baseIdentity = (kiosk, provisionId) => ({
  stationId: normalizeText(kiosk?.stationid) || provisionId,
  provisionId: normalizeText(kiosk?.provisionid) || provisionId,
  kioskGeneration: isV2Kiosk(kiosk) ? "v2" : "v1",
  gateway: normalizeText(kiosk?.hardware?.gateway),
});

const buildPointEvent = (identity, data, now) => ({
  ...identity,
  state: "point",
  occurredAt: now,
  receivedAt: now,
  expiresAt: new Date(now.toMillis() + (EVENT_RETENTION_DAYS * 86400000)),
  ...data,
});

const diffKioskEvents = (before, after, identity, now, nowMs = Date.now()) => {
  const previous = comparableKioskState(before || {}, nowMs);
  const current = comparableKioskState(after || {}, nowMs);
  const events = [];

  if (before && previous.mqtt !== current.mqtt) {
    events.push(buildPointEvent(identity, {
      category: "connectivity",
      type: current.mqtt ? "mqtt_connected" : "mqtt_disconnected",
      severity: current.mqtt ? "info" : "error",
      source: "backend",
      previousValue: previous.mqtt,
      currentValue: current.mqtt,
      summary: current.mqtt ? "MQTT connected" : "MQTT disconnected",
    }, now));
  }

  if (before && previous.uiState !== current.uiState) {
    events.push(buildPointEvent(identity, {
      category: "interaction",
      type: "ui_state_changed",
      severity: "info",
      source: "kiosk",
      previousValue: previous.uiState || null,
      currentValue: current.uiState || null,
      page: current.uiState || null,
      summary: `Screen changed to ${current.uiState || "unknown"}`,
    }, now));
  }

  if (before && previous.button !== current.button) {
    events.push(buildPointEvent(identity, {
      category: "interaction",
      type: "customer_button_state_changed",
      severity: current.button.toLowerCase() === "disabled" ? "warning" : "info",
      source: "kiosk",
      previousValue: previous.button || null,
      currentValue: current.button || null,
      summary: `Customer controls ${current.button || "changed"}`,
    }, now));
  }

  if (before && (previous.lastScanAt !== current.lastScanAt ||
      previous.lastScanCode !== current.lastScanCode) && current.lastScanAt) {
    events.push(buildPointEvent(identity, {
      category: "interaction",
      type: "scanner_activity",
      severity: "info",
      source: "kiosk",
      occurredAt: new Date(current.lastScanAt),
      summary: "Scanner interaction",
    }, now));
  }

  const moduleIds = new Set([
    ...Object.keys(previous.modules),
    ...Object.keys(current.modules),
  ]);
  for (const id of moduleIds) {
    const oldModule = previous.modules[id];
    const newModule = current.modules[id];
    if (!oldModule || !newModule || oldModule.connected === newModule.connected) continue;
    events.push(buildPointEvent(identity, {
      category: "module",
      type: newModule.connected ? "module_connected" : "module_disconnected",
      severity: newModule.connected ? "info" : "error",
      source: identity.kioskGeneration === "v2" ? "besiter" : "kiosk",
      moduleId: id,
      previousValue: oldModule.connected,
      currentValue: newModule.connected,
      summary: `Module ${id} ${newModule.connected ? "connected" : "disconnected"}`,
    }, now));
  }

  return {events, current};
};

const statePolicy = (uiState) => UI_STATE_POLICIES.find(({pattern}) => pattern.test(uiState)) || {
  timeoutMs: 180_000,
  label: "Unknown customer state",
};

const terminalPhase = (kiosk) => {
  const pending = kiosk?.vend?.pending;
  const transaction = kiosk?.transaction?.current ?? kiosk?.transaction;
  const cancel = kiosk?.paymentCancel;
  if (cancel && typeof cancel === "object" && cancel.pending === true) return "cancel_pending";
  if (pending && typeof pending === "object") {
    if (pending.creditRequested === true && pending.creditConfirmed !== true) return "credit_pending";
    if (pending.paymentApproved === true && !pending.commandSentAt) return "approved_waiting_for_vend";
    if (pending.commandSentAt && !pending.respondedAt && !pending.completedAt) return "vend_result_pending";
  }
  if (transaction && typeof transaction === "object" && transaction.pending === true) {
    return "terminal_result_pending";
  }
  return "idle";
};

const shouldMonitorKiosk = (kiosk, nowMs) => {
  const stationId = normalizeText(kiosk?.stationid);
  const provisionId = normalizeText(kiosk?.provisionid);
  const status = normalizeText(kiosk?.status).toLowerCase();
  if (!stationId || kiosk?.disabled === true || status.includes("pending")) return false;
  if (provisionId && stationId.toLowerCase() === provisionId.toLowerCase()) return false;
  const lastSeen = asMillis(kiosk?.lastUpdate ?? kiosk?.timestamp);
  if (lastSeen) return nowMs - lastSeen <= ACTIVE_KIOSK_WINDOW_MS;
  return kiosk?.mqtt === true;
};

const watchdogCandidates = (kiosk, monitor, nowMs) => {
  const candidates = [];
  const uiState = normalizeText(kiosk?.uistate);
  const policy = statePolicy(uiState);
  const enteredAt = asMillis(monitor?.uiStateEnteredAt) ?? nowMs;
  const phase = terminalPhase(kiosk);
  const terminalEnteredAt = asMillis(monitor?.terminalPhaseEnteredAt) ?? nowMs;

  if (kiosk?.mqtt === false) {
    candidates.push({
      key: "mqtt-disconnected",
      category: "connectivity",
      type: "mqtt_disconnected",
      severity: "critical",
      source: "backend",
      summary: "MQTT is disconnected",
      enteredAt: asMillis(monitor?.mqttStateEnteredAt) ?? nowMs,
      durationMs: nowMs - (asMillis(monitor?.mqttStateEnteredAt) ?? nowMs),
    });
  }

  const kioskLastSeen = asMillis(kiosk?.lastUpdate ?? kiosk?.timestamp);
  if (kioskLastSeen && nowMs - kioskLastSeen > ONLINE_WINDOW_MS) {
    candidates.push({
      key: "kiosk-telemetry-overdue",
      category: "connectivity",
      type: "kiosk_telemetry_overdue",
      severity: nowMs - kioskLastSeen > CRITICAL_OFFLINE_WINDOW_MS ? "critical" : "error",
      source: "backend",
      summary: "Kiosk telemetry is overdue",
      enteredAt: kioskLastSeen,
      expectedExitBy: kioskLastSeen + ONLINE_WINDOW_MS,
      durationMs: nowMs - kioskLastSeen,
    });
  }

  if (uiState && policy.timeoutMs != null && nowMs - enteredAt > policy.timeoutMs) {
    candidates.push({
      key: "ui-state-overdue",
      category: "interaction",
      type: "ui_state_overdue",
      severity: nowMs - enteredAt > policy.timeoutMs * 3 ? "critical" : "error",
      source: "watchdog",
      summary: `${policy.label} screen is overdue`,
      page: uiState,
      enteredAt,
      expectedExitBy: enteredAt + policy.timeoutMs,
      durationMs: nowMs - enteredAt,
      details: {
        button: normalizeText(kiosk?.button) || null,
        renting: kiosk?.renting === true,
      },
    });
  }

  if (phase !== "idle" && nowMs - terminalEnteredAt > 120_000) {
    candidates.push({
      key: `terminal-${phase}`,
      category: "terminal",
      type: "terminal_state_overdue",
      severity: /approved|credit|vend/.test(phase) ? "critical" : "error",
      source: "watchdog",
      summary: `Terminal state ${phase.replaceAll("_", " ")} is overdue`,
      terminalState: phase,
      enteredAt: terminalEnteredAt,
      expectedExitBy: terminalEnteredAt + 120_000,
      durationMs: nowMs - terminalEnteredAt,
    });
  }

  const modules = normalizeModules(kiosk);
  modules.forEach((module, index) => {
    const id = moduleKey(module, index);
    const seenAt = asMillis(module?.lastUpdated ?? module?.timestamp ?? module?.lastSeenAt);
    if (!moduleConnected(module, kiosk, nowMs)) {
      candidates.push({
        key: `module-${id}-disconnected`,
        category: "module",
        type: "module_disconnected",
        severity: "error",
        source: isV2Kiosk(kiosk) ? "besiter" : "kiosk",
        moduleId: id,
        summary: `Module ${id} is disconnected`,
        enteredAt: asMillis(monitor?.moduleStates?.[id]?.enteredAt) ?? seenAt ?? nowMs,
        durationMs: nowMs - (asMillis(monitor?.moduleStates?.[id]?.enteredAt) ?? seenAt ?? nowMs),
      });
    }
    if (isV2Kiosk(kiosk) && seenAt && nowMs - seenAt > ONLINE_WINDOW_MS) {
      candidates.push({
        key: `module-${id}-telemetry-overdue`,
        category: "module",
        type: "module_telemetry_overdue",
        severity: nowMs - seenAt > CRITICAL_OFFLINE_WINDOW_MS ? "critical" : "error",
        source: "besiter",
        moduleId: id,
        summary: `Module ${id} telemetry is overdue`,
        enteredAt: seenAt,
        expectedExitBy: seenAt + ONLINE_WINDOW_MS,
        durationMs: nowMs - seenAt,
      });
    }
  });

  return candidates;
};

const monitorPatch = (before, after, existing, now) => {
  const oldState = comparableKioskState(before || {});
  const newState = comparableKioskState(after || {});
  const oldPhase = terminalPhase(before || {});
  const newPhase = terminalPhase(after || {});
  const patch = {
    stationId: normalizeText(after?.stationid),
    provisionId: normalizeText(after?.provisionid),
    uiState: newState.uiState,
    terminalPhase: newPhase,
    updatedAt: now,
    mqtt: newState.mqtt,
    moduleStates: Object.fromEntries(Object.entries(newState.modules).map(([id, value]) => [
      id,
      {
        connected: value.connected,
        enteredAt: existing?.moduleStates?.[id]?.connected === value.connected ?
          existing.moduleStates[id].enteredAt || now :
          now,
      },
    ])),
  };
  if (!existing?.uiStateEnteredAt || oldState.uiState !== newState.uiState) {
    patch.uiStateEnteredAt = now;
  }
  if (!existing?.terminalPhaseEnteredAt || oldPhase !== newPhase) {
    patch.terminalPhaseEnteredAt = now;
  }
  if (!existing?.mqttStateEnteredAt || oldState.mqtt !== newState.mqtt) {
    patch.mqttStateEnteredAt = now;
  }
  return patch;
};

const writeEvents = async (db, events) => {
  if (!events.length) return;
  const batch = db.batch();
  events.forEach((event) => {
    batch.set(db.collection(EVENTS_COLLECTION).doc(eventId()), event);
  });
  await batch.commit();
};

const handleKioskWrite = async ({
  before,
  after,
  provisionId,
  sourceUpdateTime,
  admin,
  db,
}) => {
  if (!after) return;
  const now = admin.firestore.Timestamp.now();
  const identity = baseIdentity(after, provisionId);
  const {events} = diffKioskEvents(before, after, identity, now);
  const monitorRef = db.collection(MONITORS_COLLECTION).doc(provisionId);
  await Promise.all([writeEvents(db, events), db.runTransaction(async (transaction) => {
    const monitorSnap = await transaction.get(monitorRef);
    const existing = monitorSnap.data();
    const incomingMs = asMillis(sourceUpdateTime) ?? now.toMillis();
    const storedMs = asMillis(existing?.sourceUpdateTime) ?? 0;
    if (incomingMs < storedMs) return;
    transaction.set(monitorRef, {
      ...monitorPatch(before, after, existing, now),
      sourceUpdateTime: sourceUpdateTime || now,
    }, {merge: true});
  })]);
};

const reconcileIncident = async ({
  db,
  kiosk,
  provisionId,
  candidate,
  existingIncident,
  now,
}) => {
  const identity = baseIdentity(kiosk, provisionId);
  const incidentKey = `${identity.stationId}:${candidate.key}`;
  const ref = db.collection(INCIDENTS_COLLECTION).doc(incidentDocId(incidentKey));
  if (existingIncident?.state === "open") {
    await ref.set({
      severity: candidate.severity,
      durationMs: candidate.durationMs,
      lastObservedAt: now,
      updatedAt: now,
    }, {merge: true});
    return;
  }

  const incident = {
    ...identity,
    ...candidate,
    incidentKey,
    state: "open",
    openedAt: now,
    lastObservedAt: now,
    updatedAt: now,
  };
  await ref.set(incident, {merge: true});
  await writeEvents(db, [buildPointEvent(identity, {
    ...candidate,
    incidentKey,
    state: "opened",
  }, now)]);
};

const resolveMissingIncidents = async ({db, openIncidents, activeKeys, now}) => {
  const batch = db.batch();
  openIncidents.forEach(({ref, data: incident}) => {
    const key = normalizeText(incident.incidentKey).split(":").slice(1).join(":");
    if (activeKeys.has(key)) return;
    batch.set(ref, {state: "resolved", resolvedAt: now, updatedAt: now}, {merge: true});
    const openedAtMs = asMillis(incident.openedAt) ?? now.toMillis();
    batch.set(db.collection(EVENTS_COLLECTION).doc(eventId()), {
      stationId: incident.stationId,
      provisionId: incident.provisionId,
      kioskGeneration: incident.kioskGeneration,
      gateway: incident.gateway || "",
      category: incident.category,
      type: `${incident.type}_resolved`,
      severity: "info",
      source: "watchdog",
      state: "resolved",
      incidentKey: incident.incidentKey,
      summary: `${incident.summary || incident.type} resolved`,
      durationMs: Math.max(0, now.toMillis() - openedAtMs),
      occurredAt: now,
      receivedAt: now,
      expiresAt: new Date(now.toMillis() + (EVENT_RETENTION_DAYS * 86400000)),
    });
  });
  await batch.commit();
};

const runWatchdog = async ({admin, db}) => {
  const now = admin.firestore.Timestamp.now();
  const nowMs = now.toMillis();
  const [kiosks, monitors, openIncidents] = await Promise.all([
    db.collection("kiosks").get(),
    db.collection(MONITORS_COLLECTION).get(),
    db.collection(INCIDENTS_COLLECTION).where("state", "==", "open").get(),
  ]);
  const monitorsById = new Map(monitors.docs.map((doc) => [doc.id, doc.data()]));
  const openByStation = new Map();
  openIncidents.docs.forEach((doc) => {
    const data = doc.data();
    const stationId = normalizeText(data.stationId);
    if (!openByStation.has(stationId)) openByStation.set(stationId, []);
    openByStation.get(stationId).push({ref: doc.ref, data});
  });
  let openedOrUpdated = 0;

  for (const kioskDoc of kiosks.docs) {
    const kiosk = kioskDoc.data();
    if (!normalizeText(kiosk?.stationid)) continue;
    if (!shouldMonitorKiosk(kiosk, nowMs)) {
      const stationIncidents = openByStation.get(normalizeText(kiosk.stationid)) || [];
      await resolveMissingIncidents({
        db,
        openIncidents: stationIncidents,
        activeKeys: new Set(),
        now,
      });
      continue;
    }
    const monitorRef = db.collection(MONITORS_COLLECTION).doc(kioskDoc.id);
    let monitor = monitorsById.get(kioskDoc.id);
    const currentState = comparableKioskState(kiosk, nowMs);
    const currentPhase = terminalPhase(kiosk);
    if (!monitor || monitor.uiState !== currentState.uiState ||
        monitor.terminalPhase !== currentPhase || monitor.mqtt !== currentState.mqtt) {
      const patch = monitorPatch(null, kiosk, monitor, now);
      await monitorRef.set(patch, {merge: true});
      monitor = {...monitor, ...patch};
    }
    const candidates = watchdogCandidates(kiosk, monitor, nowMs);
    const activeKeys = new Set(candidates.map(({key}) => key));
    const stationIncidents = openByStation.get(normalizeText(kiosk.stationid)) || [];
    const incidentsByKey = new Map(stationIncidents.map(({data}) => [
      data.incidentKey,
      data,
    ]));
    for (const candidate of candidates) {
      const incidentKey = `${normalizeText(kiosk.stationid)}:${candidate.key}`;
      await reconcileIncident({
        db,
        kiosk,
        provisionId: kioskDoc.id,
        candidate,
        existingIncident: incidentsByKey.get(incidentKey),
        now,
      });
      openedOrUpdated += 1;
    }
    await resolveMissingIncidents({
      db,
      openIncidents: stationIncidents,
      activeKeys,
      now,
    });
  }

  return {kiosks: kiosks.size, incidents: openedOrUpdated};
};

module.exports = {
  EVENTS_COLLECTION,
  INCIDENTS_COLLECTION,
  MONITORS_COLLECTION,
  comparableKioskState,
  diffKioskEvents,
  handleKioskWrite,
  isV2Kiosk,
  runWatchdog,
  shouldMonitorKiosk,
  statePolicy,
  terminalPhase,
  watchdogCandidates,
};
