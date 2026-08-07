/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  diffKioskEvents,
  isV2Kiosk,
  shouldMonitorKiosk,
  terminalPhase,
  watchdogCandidates,
} = require("./kioskOperationalEvents");

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
  assert.ok(candidates.some(({type}) => type === "module_telemetry_overdue"));
  assert.ok(candidates.some(({type}) => type === "module_disconnected"));
});
