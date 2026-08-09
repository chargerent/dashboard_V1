/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EVENT_RETENTION_DAYS,
  diffKioskEvents,
  isV2Kiosk,
  rentalAuditInteractionCandidates,
  rentalInteractionCandidates,
  resolvedIncidentSummary,
  shouldMonitorKiosk,
  terminalPhase,
  uiStatePageSummary,
  watchdogCandidates,
} = require("./kioskOperationalEvents");

test("retains operational history for seven days", () => {
  assert.equal(EVENT_RETENTION_DAYS, 7);
});

const timestamp = (millis) => ({
  toMillis: () => millis,
});

test("classifies centralized Besiter stations as V2", () => {
  assert.equal(isV2Kiosk({stationid: "FR8010"}), true);
  assert.equal(isV2Kiosk({stationid: "US0118", hardware: {type: "CT10"}}), false);
});

test("does not monitor a retired kiosk from a stale MQTT flag", () => {
  const now = Date.now();
  assert.equal(shouldMonitorKiosk({
    stationid: "CA8011",
    provisionid: "id-ca8011",
    mqtt: true,
    lastUpdate: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
  }, now), false);
});

test("records V1 MQTT, screen, button, and module transitions", () => {
  const now = timestamp(Date.now());
  const before = {
    stationid: "US0118",
    mqtt: true,
    uistate: "startpage",
    button: "enabled",
    modules: {1: {id: "US0118m1", serialstatus: true}},
  };
  const after = {
    ...before,
    mqtt: false,
    uistate: "payment credited",
    button: "disabled",
    modules: {1: {id: "US0118m1", serialstatus: false}},
    interaction: {current: {
      id: "interaction-123",
      kind: "rental",
      surface: "ui",
    }},
  };
  const {events} = diffKioskEvents(before, after, {
    stationId: "US0118",
    provisionId: "id-5446395998",
    kioskGeneration: "v1",
  }, now);
  assert.deepEqual(events.map(({type}) => type), [
    "mqtt_disconnected",
    "ui_state_changed",
    "customer_button_state_changed",
    "module_disconnected",
  ]);
  assert.equal(events.find(({type}) => type === "ui_state_changed").summary,
      "Payment credited page");
  assert.equal(events.find(({type}) => type === "ui_state_changed").interactionId,
      "interaction-123");
  assert.equal(events.find(({type}) => type === "ui_state_changed").sourceSurface, "ui");
  assert.equal(events.find(({type}) => type === "customer_button_state_changed").severity,
      "info");
});

test("labels every recorded kiosk page visit clearly", () => {
  assert.equal(uiStatePageSummary("startpage"), "Returned to start page");
  assert.equal(uiStatePageSummary("rentpage"), "Rent page");
  assert.equal(uiStatePageSummary("return_page"), "Return page");
  assert.equal(uiStatePageSummary("returntypage"), "Return complete page");
  assert.equal(uiStatePageSummary("waitpage"), "Please wait page");
  assert.equal(uiStatePageSummary("button pressed", "ui"), "Button pressed");
  assert.equal(uiStatePageSummary("button pressed", "terminal"), "Terminal button pressed");
});

test("labels no-screen kiosk presses as terminal and records controls disabled afterward", () => {
  const now = timestamp(Date.now());
  const before = {
    stationid: "US0017",
    hardware: {type: "CK30", screen: "no screen"},
    ui: {mode: "MEDIA"},
    uistate: "startpage",
    button: "enabled",
  };
  const after = {...before, uistate: "button pressed", button: "disabled"};
  const {events} = diffKioskEvents(before, after, {
    stationId: "US0017",
    provisionId: "id-9937541816",
    kioskGeneration: "v1",
  }, now);
  const pressIndex = events.findIndex(({type}) => type === "ui_state_changed");
  const disabledIndex = events.findIndex(({type}) => type === "customer_button_state_changed");
  assert.equal(events[pressIndex].summary, "Terminal button pressed");
  assert.equal(events[pressIndex].sourceSurface, "terminal");
  assert.equal(events[disabledIndex].severity, "info");
  assert.ok(pressIndex < disabledIndex);
});

test("opens an overdue UI incident for a stuck P68 state", () => {
  const now = Date.now();
  const candidates = watchdogCandidates({
    stationid: "US0118",
    hardware: {type: "CT10", gateway: "PAYTERP68"},
    mqtt: true,
    uistate: "payment credited",
    button: "disabled",
    renting: false,
  }, {
    uiStateEnteredAt: new Date(now - 70_000),
    terminalPhaseEnteredAt: new Date(now),
    mqttStateEnteredAt: new Date(now),
  }, now);
  const incident = candidates.find(({type}) => type === "ui_state_overdue");
  assert.equal(incident.page, "payment credited");
  assert.equal(incident.details.button, "disabled");
});

test("tracks P68 approved, vend, and credit terminal phases", () => {
  assert.equal(terminalPhase({vend: {pending: {paymentApproved: true}}}),
      "approved_waiting_for_vend");
  assert.equal(terminalPhase({vend: {pending: {
    paymentApproved: true,
    commandSentAt: "2026-08-07T00:00:00Z",
  }}}), "vend_result_pending");
  assert.equal(terminalPhase({vend: {pending: {
    creditRequested: true,
    creditConfirmed: false,
  }}}), "credit_pending");
});

test("detects V2 module telemetry that stays stale", () => {
  const now = Date.now();
  const candidates = watchdogCandidates({
    stationid: "FR8010",
    mqtt: true,
    modules: [{
      id: "movement-1",
      lastUpdated: new Date(now - 11 * 60_000).toISOString(),
      slots: [],
    }],
  }, {
    uiStateEnteredAt: new Date(now),
    terminalPhaseEnteredAt: new Date(now),
    mqttStateEnteredAt: new Date(now),
  }, now);
  assert.ok(candidates.some(({type}) => type === "module_disconnected"));
  assert.equal(candidates.some(({type}) => type === "module_telemetry_overdue"), false);
  assert.equal(candidates.some(({type}) => type === "kiosk_telemetry_overdue"), false);
});

test("starts module disconnect duration at the disconnect transition", () => {
  const now = Date.now();
  const staleConnectedAt = new Date(now - (16 * 60 * 60_000));
  const kiosk = {
    stationid: "FR8010",
    mqtt: true,
    modules: [{
      id: "864253060998911",
      lastUpdated: new Date(now - 11 * 60_000).toISOString(),
    }],
  };

  const newlyDisconnected = watchdogCandidates(kiosk, {
    moduleStates: {
      "864253060998911": {connected: true, enteredAt: staleConnectedAt},
    },
  }, now).find(({type}) => type === "module_disconnected");
  assert.equal(newlyDisconnected.enteredAt, now);
  assert.equal(newlyDisconnected.durationMs, 0);

  const disconnectedAt = new Date(now - 6 * 60_000);
  const stillDisconnected = watchdogCandidates(kiosk, {
    moduleStates: {
      "864253060998911": {connected: false, enteredAt: disconnectedAt},
    },
  }, now).find(({type}) => type === "module_disconnected");
  assert.equal(stillDisconnected.enteredAt, disconnectedAt.getTime());
  assert.equal(stillDisconnected.durationMs, 6 * 60_000);
});

test("groups an overdue kiosk heartbeat with module activity", () => {
  const now = Date.now();
  const candidates = watchdogCandidates({
    stationid: "US0118",
    mqtt: true,
    lastUpdate: new Date(now - 11 * 60_000).toISOString(),
  }, {
    uiStateEnteredAt: new Date(now),
    terminalPhaseEnteredAt: new Date(now),
    mqttStateEnteredAt: new Date(now),
  }, now);
  const heartbeat = candidates.find(({type}) => type === "kiosk_telemetry_overdue");
  assert.equal(heartbeat.category, "module");
  assert.equal(heartbeat.summary, "Overdue heartbeat");
});

test("records the heartbeat recovery transition", () => {
  assert.equal(resolvedIncidentSummary({
    type: "kiosk_telemetry_overdue",
    summary: "Overdue heartbeat",
  }), "Heartbeat restored");
});

test("records paid, rented, and returned rental interactions", () => {
  assert.deepEqual(rentalInteractionCandidates(null, {
    status: "rented",
    rentalStationid: "US0118",
    rentalTime: "2026-08-07T10:00:00Z",
  }).map(({type}) => type), ["rental_paid", "charger_rented"]);

  assert.deepEqual(rentalInteractionCandidates({status: "rented"}, {
    status: "returned",
    rentalStationid: "US0118",
    returnStationid: "US0092",
    returnTime: "2026-08-07T11:00:00Z",
  }).map(({type, stationId}) => ({type, stationId})), [{
    type: "charger_returned",
    stationId: "US0092",
  }]);
});

test("UID rentals rely on physical vend audit and never appear paid", () => {
  const rental = {
    status: "rented",
    source: "p68_uid",
    paymentStatus: "uid_authorized",
    rentalFlow: "p68-uid-postvend-v1",
    rentalStationid: "FR0140",
    rentalTime: "2026-08-09T03:36:39.561Z",
    orderid: "UID:example",
  };

  assert.deepEqual(rentalInteractionCandidates(null, rental), []);

  const returned = rentalInteractionCandidates(rental, {
    ...rental,
    status: "returned",
    returnStationid: "FR0140",
    returnTime: "2026-08-09T04:36:39.561Z",
  });
  assert.equal(returned.length, 1);
  assert.equal(returned[0].type, "charger_returned");
});

test("records purchased rental timing on the closing event", () => {
  const rentalTime = "2026-08-07T13:27:51.453Z";
  const overdueTime = "2026-08-08T13:27:51.453Z";
  const [purchased] = rentalInteractionCandidates({status: "rented"}, {
    status: "purchased",
    rentalStationid: "FR1010",
    rentalTime,
    overdueTime,
    purchaseTime: "2026-08-08T13:29:25.000Z",
    orderid: "413154bf-6392",
  });

  assert.equal(purchased.type, "charger_purchased");
  assert.equal(purchased.interactionKind, "rental");
  assert.deepEqual(purchased.details, {rentalTime, overdueTime});
});

test("correlates new rental audit events with one interaction", () => {
  const before = {
    rentalEvents: [{eventid: "existing", eventtype: "reservation_created"}],
  };
  const after = {
    rentalStationid: "US0118",
    orderid: "TX-123",
    reservationid: "reservation-123",
    rentalEvents: [
      ...before.rentalEvents,
      {
        eventid: "approved-1",
        eventtype: "payment_approved",
        occurredat: "2026-08-07T10:00:00Z",
        stationid: "US0118",
        interactionId: "interaction-123",
        source: "p68_triangle",
        transactionid: "TX-123",
        paymentAttemptId: "payment-123",
      },
      {
        eventid: "vend-failed-1",
        eventtype: "vend_failed",
        occurredat: "2026-08-07T10:00:05Z",
        stationid: "US0118",
        interactionId: "interaction-123",
        source: "p68_triangle",
        transactionid: "TX-123",
        failureReason: "motor_error",
        processLog: [{event: "vend_failed"}],
      },
    ],
  };

  const events = rentalAuditInteractionCandidates(before, after);
  assert.deepEqual(events.map(({type}) => type), [
    "payment_approved",
    "charger_dispense_failed",
  ]);
  assert.ok(events.every(({interactionId}) => interactionId === "interaction-123"));
  assert.ok(events.every(({transactionId}) => transactionId === "TX-123"));
  assert.ok(events.every(({sourceSurface}) => sourceSurface === "terminal"));
  assert.equal(events[1].details.failureReason, "motor_error");
  assert.deepEqual(events[1].details.processLog, [{event: "vend_failed"}]);
});
