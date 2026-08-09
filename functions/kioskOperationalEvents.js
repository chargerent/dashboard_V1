/* eslint-env node */

const crypto = require("node:crypto");

const EVENTS_COLLECTION = "kioskEvents";
const INCIDENTS_COLLECTION = "kioskIncidents";
const MONITORS_COLLECTION = "kioskStateMonitors";
const EVENT_RETENTION_DAYS = 7;
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
const normalizeStatus = (value) => normalizeText(value).toLowerCase();

const interactionSurface = (value) => {
  const source = normalizeText(value).toLowerCase();
  if (/p68|payter|apollo|terminal|uid/.test(source)) return "terminal";
  if (/ui|screen|scanner/.test(source)) return "ui";
  return "unknown";
};

const kioskInteractionSurface = (kiosk, explicitSurface) => {
  const explicit = interactionSurface(explicitSurface);
  if (explicit !== "unknown") return explicit;
  const screen = normalizeText(kiosk?.hardware?.screen).toLowerCase();
  const uiMode = normalizeText(kiosk?.ui?.mode).toLowerCase();
  if (/no screen|none|terminal only/.test(screen) || uiMode === "media") return "terminal";
  return "ui";
};

const rentalTransactionId = (rental) => normalizeText(
    rental?.transactionid || rental?.transactionId || rental?.orderid || rental?.rawid,
);

const rentalInteractionId = (rental) => normalizeText(
    rental?.interactionId || rental?.interactionid || rental?.reservationid ||
    rental?.reservationId || rental?.paymentAttemptId,
);

const isUidRentalRecord = (rental) =>
  normalizeStatus(rental?.source) === "p68_uid" ||
  normalizeStatus(rental?.paymentStatus) === "uid_authorized" ||
  normalizeStatus(rental?.paymentstatus) === "uid_authorized" ||
  normalizeStatus(rental?.rentalFlow) === "p68-uid-postvend-v1" ||
  normalizeStatus(rental?.createdFrom) === "p68-uid-postvend-v1";

const kioskInteractionContext = (kiosk) => {
  const interaction = kiosk?.interaction?.current || kiosk?.interaction?.lastCompleted || {};
  return {
    interactionId: normalizeText(interaction.id || interaction.interactionId) || null,
    interactionKind: normalizeText(interaction.kind) || null,
    sourceSurface: kioskInteractionSurface(kiosk, interaction.surface),
  };
};

const uiStatePageSummary = (value, sourceSurface = "ui") => {
  const normalized = normalizeText(value);
  if (!normalized) return "Unknown page";
  const exactSummary = {
    startpage: "Returned to start page",
    returninfopage: "Return information page",
    returntypage: "Return complete page",
    waitpage: "Please wait page",
    loadingpage: "Loading page",
    thankyoupage: "Thank you page",
    declinedpage: "Payment declined page",
    ooopage: "Out of order page",
    remotepage: "Remote support page",
    loginpage: "Admin login page",
  }[normalized.toLowerCase()];
  if (exactSummary) return exactSummary;
  if (/^button[ _-]*pressed$/i.test(normalized)) {
    return sourceSurface === "terminal" ? "Terminal button pressed" : "Button pressed";
  }
  const pageName = normalized
      .replace(/page$/i, "")
      .replaceAll("_", " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${pageName.charAt(0).toUpperCase()}${pageName.slice(1)} page`;
};

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
const stableEventId = (value) => crypto.createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 40);
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
    const interaction = kioskInteractionContext(after);
    events.push(buildPointEvent(identity, {
      category: "interaction",
      type: "ui_state_changed",
      severity: "info",
      source: "kiosk",
      previousValue: previous.uiState || null,
      currentValue: current.uiState || null,
      page: current.uiState || null,
      summary: uiStatePageSummary(current.uiState, interaction.sourceSurface),
      ...interaction,
    }, now));
  }

  if (before && previous.button !== current.button) {
    const interaction = kioskInteractionContext(after);
    events.push(buildPointEvent(identity, {
      category: "interaction",
      type: "customer_button_state_changed",
      severity: "info",
      source: "kiosk",
      previousValue: previous.button || null,
      currentValue: current.button || null,
      summary: `Customer controls ${current.button || "changed"}`,
      ...interaction,
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

const rentalInteractionCandidates = (before, after) => {
  if (!after) return [];
  const previousStatus = normalizeStatus(before?.status);
  const currentStatus = normalizeStatus(after.status);
  const uidRental = isUidRentalRecord(after);
  const candidates = [];

  if (!uidRental && !before && after.rentalTime && [
    "payment_approved",
    "rented",
    "returned",
    "purchased",
  ].includes(currentStatus)) {
    candidates.push({
      type: "rental_paid",
      summary: "Rental paid",
      occurredAt: after.rentalTime,
      stationId: normalizeText(after.rentalStationid),
      interactionId: rentalInteractionId(after),
      transactionId: rentalTransactionId(after),
      sourceSurface: interactionSurface(after.source || after.rentalFlow || after.gateway),
    });
  } else if (!uidRental && previousStatus !== currentStatus &&
      currentStatus === "payment_approved") {
    candidates.push({
      type: "rental_paid",
      summary: "Rental paid",
      occurredAt: after.rentalTime || after.lastUpdate,
      stationId: normalizeText(after.rentalStationid),
      interactionId: rentalInteractionId(after),
      transactionId: rentalTransactionId(after),
      sourceSurface: interactionSurface(after.source || after.rentalFlow || after.gateway),
    });
  }

  if (previousStatus !== currentStatus) {
    const statusEvents = {
      rented: ["charger_rented", "Charger rented", after.rentalTime],
      returned: ["charger_returned", "Charger returned", after.returnTime],
      purchased: ["charger_purchased", "Charger purchased", after.purchaseTime || after.purchasedAt],
      refunded: ["rental_refunded", "Rental refunded", after.refundDate || after.lastUpdate],
      canceled: ["rental_canceled", "Rental canceled", after.lastUpdate],
      failed: ["rental_failed", "Rental failed", after.failedAt || after.lastUpdate],
      vend_failed: ["charger_dispense_failed", "Charger dispense failed", after.failedAt || after.lastUpdate],
    };
    // UID rentals are physically established by their vend_succeeded audit event.
    // Do not synthesize "Rental paid" or a second "Charger rented" event for them.
    const statusEvent = uidRental && currentStatus === "rented" ? null :
      statusEvents[currentStatus];
    if (statusEvent) {
      candidates.push({
        type: statusEvent[0],
        summary: statusEvent[1],
        occurredAt: statusEvent[2],
        stationId: currentStatus === "returned" ?
          normalizeText(after.returnStationid || after.returnStationId || after.rentalStationid) :
          normalizeText(after.rentalStationid),
        interactionId: currentStatus === "returned" ?
          normalizeText(after.returnInteractionId) : rentalInteractionId(after),
        interactionKind: currentStatus === "returned" ? "return" : "rental",
        transactionId: rentalTransactionId(after),
        chargerId: normalizeText(after.chargerid || after.sn),
        moduleId: currentStatus === "returned" ?
          normalizeText(after.returnModuleid || after.returnModuleId) :
          normalizeText(after.rentalModuleid),
        slot: currentStatus === "returned" ?
          (after.returnSlotid ?? after.returnSlotId ?? null) :
          (after.rentalSlotid ?? null),
        sourceSurface: interactionSurface(
            currentStatus === "returned" ? after.returnSource :
              (after.source || after.rentalFlow || after.gateway),
        ),
        details: currentStatus === "purchased" ? {
          rentalTime: after.rentalTime || after.rentedAt || null,
          overdueTime: after.overdueTime || null,
        } : undefined,
      });
    }
  }

  return candidates.filter(({stationId}) => stationId);
};

const rentalAuditInteractionCandidates = (before, after) => {
  if (!after) return [];
  const previousIds = new Set((Array.isArray(before?.rentalEvents) ? before.rentalEvents : [])
      .map((event) => normalizeText(event?.eventid))
      .filter(Boolean));
  const mappings = {
    reservation_created: ["charger_reserved", "Charger reserved", "info"],
    reservation_released: ["reservation_released", "Reservation released", "info"],
    payment_timeout: ["payment_timed_out", "Payment timed out", "error"],
    payment_declined: ["payment_declined", "Payment declined", "warning"],
    payment_approved: ["payment_approved", "Payment approved", "info"],
    vend_failed: ["charger_dispense_failed", "Charger dispense failed", "error"],
    vend_succeeded: ["charger_dispensed", "Charger dispensed", "info"],
  };

  return (Array.isArray(after.rentalEvents) ? after.rentalEvents : [])
      .filter((event) => {
        const eventId = normalizeText(event?.eventid);
        return eventId && !previousIds.has(eventId) && mappings[normalizeStatus(event?.eventtype)];
      })
      .map((event) => {
        const [type, summary, severity] = mappings[normalizeStatus(event.eventtype)];
        return {
          type,
          summary,
          severity,
          occurredAt: event.occurredat || event.receivedat || after.lastUpdate,
          stationId: normalizeText(event.stationid || after.rentalStationid),
          interactionId: normalizeText(event.interactionId || event.interactionid) ||
            rentalInteractionId(after),
          interactionKind: "rental",
          transactionId: normalizeText(event.transactionid) || rentalTransactionId(after),
          chargerId: normalizeText(event.chargerid || after.chargerid || after.sn),
          moduleId: normalizeText(event.moduleid || after.rentalModuleid),
          slot: event.slotnumber ?? after.rentalSlotid ?? null,
          sourceSurface: interactionSurface(event.source || after.source || after.gateway),
          auditEventId: normalizeText(event.eventid),
          details: {
            reservationId: normalizeText(event.reservationid) || null,
            paymentAttemptId: normalizeText(event.paymentAttemptId) || null,
            failureReason: normalizeText(event.failureReason || event.failurereason) || null,
            processLog: Array.isArray(event.processLog) ? event.processLog.slice(-20) : [],
          },
        };
      });
};

const handleRentalWrite = async ({before, after, rentalId, sourceEventId, admin, db}) => {
  const now = admin.firestore.Timestamp.now();
  const statusCandidates = rentalInteractionCandidates(before, after);
  const auditCandidates = rentalAuditInteractionCandidates(before, after);
  const hasPaymentApproval = auditCandidates.some(({type}) => type === "payment_approved");
  const candidates = [
    ...statusCandidates.filter(({type}) => type !== "rental_paid" || !hasPaymentApproval),
    ...auditCandidates,
  ];
  if (!candidates.length) return;
  const batch = db.batch();
  candidates.forEach((candidate) => {
    const occurredAtMs = asMillis(candidate.occurredAt);
    const occurredAt = occurredAtMs == null ? now : admin.firestore.Timestamp.fromMillis(occurredAtMs);
    const fallbackInteractionId = candidate.type === "charger_returned" ?
      `return:${rentalId}:${occurredAtMs || "unknown"}` :
      `rental:${rentalId}`;
    const event = buildPointEvent({
      stationId: candidate.stationId,
      provisionId: "",
      kioskGeneration: "",
      gateway: "",
    }, {
      category: "interaction",
      type: candidate.type,
      severity: candidate.severity || (candidate.type.includes("failed") ? "error" : "info"),
      source: "rental",
      summary: candidate.summary,
      occurredAt,
      interactionId: candidate.interactionId || fallbackInteractionId,
      interactionKind: candidate.interactionKind || "rental",
      sourceSurface: candidate.sourceSurface || "unknown",
      transactionId: candidate.transactionId || null,
      chargerId: candidate.chargerId || null,
      moduleId: candidate.moduleId || null,
      slot: candidate.slot ?? null,
      details: {
        rentalId,
        ...(candidate.details || {}),
      },
    }, now);
    const documentId = stableEventId(
        candidate.auditEventId ?
          `rental-audit:${candidate.auditEventId}` :
          `rental:${sourceEventId || rentalId}:${candidate.type}:${candidate.stationId}`,
    );
    batch.set(db.collection(EVENTS_COLLECTION).doc(documentId), event);
  });
  await batch.commit();
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
  const v2Kiosk = isV2Kiosk(kiosk);
  const modules = normalizeModules(kiosk);
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
  if (kioskLastSeen && nowMs - kioskLastSeen > ONLINE_WINDOW_MS &&
      (!v2Kiosk || modules.length === 0)) {
    candidates.push({
      key: "kiosk-telemetry-overdue",
      category: "module",
      type: "kiosk_telemetry_overdue",
      severity: nowMs - kioskLastSeen > CRITICAL_OFFLINE_WINDOW_MS ? "critical" : "error",
      source: "backend",
      summary: "Overdue heartbeat",
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

  modules.forEach((module, index) => {
    const id = moduleKey(module, index);
    if (!moduleConnected(module, kiosk, nowMs)) {
      const trackedState = monitor?.moduleStates?.[id];
      const disconnectedEnteredAt = trackedState?.connected === false ?
        (asMillis(trackedState.enteredAt) ?? nowMs) :
        nowMs;
      candidates.push({
        key: `module-${id}-disconnected`,
        category: "module",
        type: "module_disconnected",
        severity: "error",
        source: v2Kiosk ? "besiter" : "kiosk",
        moduleId: id,
        summary: `Module ${id} is disconnected`,
        enteredAt: disconnectedEnteredAt,
        durationMs: Math.max(0, nowMs - disconnectedEnteredAt),
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
  now,
}) => {
  const identity = baseIdentity(kiosk, provisionId);
  const incidentKey = `${identity.stationId}:${candidate.key}`;
  const ref = db.collection(INCIDENTS_COLLECTION).doc(incidentDocId(incidentKey));
  const opened = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.data()?.state === "open") {
      transaction.set(ref, {
        severity: candidate.severity,
        durationMs: candidate.durationMs,
        lastObservedAt: now,
        updatedAt: now,
      }, {merge: true});
      return false;
    }

    transaction.set(ref, {
      ...identity,
      ...candidate,
      incidentKey,
      state: "open",
      openedAt: now,
      lastObservedAt: now,
      updatedAt: now,
    }, {merge: true});
    return true;
  });
  if (opened) {
    await writeEvents(db, [buildPointEvent(identity, {
      ...candidate,
      incidentKey,
      state: "opened",
    }, now)]);
  }
};

const resolvedIncidentSummary = (incident) => (
  incident.type === "kiosk_telemetry_overdue" ?
    "Heartbeat restored" :
    `${incident.summary || incident.type} resolved`
);

const resolveMissingIncidents = async ({
  db,
  openIncidents,
  activeKeys,
  now,
  silentlyResolveKeys = new Set(),
}) => {
  const batch = db.batch();
  openIncidents.forEach(({ref, data: incident}) => {
    const key = normalizeText(incident.incidentKey).split(":").slice(1).join(":");
    if (activeKeys.has(key)) return;
    if (silentlyResolveKeys.has(key)) {
      batch.set(ref, {
        state: "resolved",
        resolvedAt: now,
        updatedAt: now,
        resolutionReason: "superseded_duplicate",
      }, {merge: true});
      return;
    }
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
      summary: resolvedIncidentSummary(incident),
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
    const silentlyResolveKeys = new Set();
    if (isV2Kiosk(kiosk)) {
      silentlyResolveKeys.add("kiosk-telemetry-overdue");
      normalizeModules(kiosk).forEach((module, index) => {
        silentlyResolveKeys.add(`module-${moduleKey(module, index)}-telemetry-overdue`);
      });
    }
    const stationIncidents = openByStation.get(normalizeText(kiosk.stationid)) || [];
    for (const candidate of candidates) {
      await reconcileIncident({
        db,
        kiosk,
        provisionId: kioskDoc.id,
        candidate,
        now,
      });
      openedOrUpdated += 1;
    }
    await resolveMissingIncidents({
      db,
      openIncidents: stationIncidents,
      activeKeys,
      now,
      silentlyResolveKeys,
    });
  }

  return {kiosks: kiosks.size, incidents: openedOrUpdated};
};

const deleteQueryInBatches = async (db, queryFactory) => {
  let deleted = 0;
  let hasMore = true;
  while (hasMore) {
    const snapshot = await queryFactory().limit(400).get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    deleted += snapshot.size;
    hasMore = snapshot.size === 400;
  }
  return deleted;
};

const pruneOperationalHistory = async ({admin, db, nowMs = Date.now()}) => {
  const cutoff = admin.firestore.Timestamp.fromMillis(
      nowMs - (EVENT_RETENTION_DAYS * 86400000),
  );
  const [events, incidents] = await Promise.all([
    deleteQueryInBatches(db, () => db.collection(EVENTS_COLLECTION)
        .where("occurredAt", "<", cutoff)),
    deleteQueryInBatches(db, () => db.collection(INCIDENTS_COLLECTION)
        .where("resolvedAt", "<", cutoff)),
  ]);
  return {events, incidents};
};

module.exports = {
  EVENT_RETENTION_DAYS,
  EVENTS_COLLECTION,
  INCIDENTS_COLLECTION,
  MONITORS_COLLECTION,
  comparableKioskState,
  diffKioskEvents,
  handleKioskWrite,
  handleRentalWrite,
  isV2Kiosk,
  pruneOperationalHistory,
  rentalAuditInteractionCandidates,
  rentalInteractionCandidates,
  resolvedIncidentSummary,
  runWatchdog,
  shouldMonitorKiosk,
  statePolicy,
  terminalPhase,
  uiStatePageSummary,
  watchdogCandidates,
};
