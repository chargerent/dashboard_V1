/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ctf7 = require("./ctf7Model");

// Execute the actual binding functions without initializing Admin SDK or Stripe.
const source = fs.readFileSync(require.resolve("./index.js"), "utf8");
function definition(name) {
  const regex = new RegExp(`^(?:async )?function ${name}\\(`, "m");
  const start = source.search(regex);
  assert.notEqual(start, -1, name);
  const rest = source.slice(start + 1);
  const boundary = rest.search(/^\s*(?:async )?function [A-Za-z]/m);
  return boundary < 0 ? source.slice(start) : source.slice(start, start + 1 + boundary);
}
class FakeDb {
  constructor() { this.rows = new Map(); this.counter = 0; this.tail = Promise.resolve(); }
  snap(ref) {
    const value = this.rows.get(ref.path);
    return {ref, id: ref.id, exists: !!value, data: () => value && structuredClone(value)};
  }
  collection(name) {
    const db = this;
    const query = (filters = []) => ({
      doc(id = `auto-${db.counter++}`) {
        const ref = {path: `${name}/${id}`, id};
        ref.get = async () => db.snap(ref);
        return ref;
      },
      where(field, _op, value) { return query([...filters, [field, value]]); },
      limit() { return this; },
      async get() {
        const docs = [...db.rows.keys()].filter((key) => key.startsWith(`${name}/`) &&
          filters.every(([field, value]) => db.rows.get(key)[field] === value))
            .map((key) => db.snap({path: key, id: key.split("/")[1]}));
        return {docs, empty: !docs.length, size: docs.length};
      },
    });
    return query();
  }
  runTransaction(fn) {
    const operation = this.tail.then(async () => {
      const writes = [];
      const tx = {
        get: async (ref) => {
          assert.equal(writes.length, 0, "All transaction reads must precede writes");
          return ref.path ? this.snap(ref) : ref.get();
        },
        set: (ref, data) => writes.push([ref.path, structuredClone(data)]),
        delete: (ref) => writes.push([ref.path, null]),
      };
      const result = await fn(tx);
      for (const [key, value] of writes) {
        if (value === null) this.rows.delete(key);
        else this.rows.set(key, value);
      }
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
function harness() {
  const db = new FakeDb(); let nextProvision = 0;
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const context = vm.createContext({db, ctf7,
    functions: {https: {HttpsError}},
    admin: {firestore: {FieldValue: {serverTimestamp: () => "timestamp"}}},
    DEFAULT_KIOSK_POWER_THRESHOLD: 80, V2_DEFAULT_WIFI: {},
    DEFAULT_ANALYTICS_OPTIONS: {active: false},
    BOUND_KIOSK_TYPE_CONFIG: {CTF7: {modules: 1, slots: 7}, CT4: {modules: 1, slots: 4}},
    getDefaultCurrencyConfig: () => ({currency: "US", symbol: "$"}),
    getDefaultBoundKioskInfo: (country) => ({country}),
    normalizeMarketingOptions: () => ({}),
    getActiveStationReservations: async () => [],
    buildReservedStationIdSet: () => new Set(),
    findNextStationId: () => "US8999",
    findNextProvisionId: () => `id-${++nextProvision}`,
    normalizeCountry: (country) => String(country || "US").toUpperCase(),
    normalizeStationId: (id) => String(id || "").toUpperCase(),
    getCountryFromStationId: (id) => String(id).slice(0, 2),
    getRequestedKioskType: (data) => data.kioskType || "",
    isBindingStationId: (id, country) => new RegExp(`^${country}\\d{4}$`).test(id),
    buildInvalidStationIdMessage: () => "Invalid station ID",
    buildStationReservationConflictMessage: () => "Reserved station",
    extractStationId: (doc) => doc.data().stationid,
    extractProvisionId: (doc) => doc.id,
    collectV2ModuleIds: () => [],
    syncModuleOrder: (hardware, moduleIds) => ({...hardware, moduleOrder: moduleIds}),
    buildQrUrl: (id) => `https://example.test/${id}`,
  });
  for (const name of ["normalizeKioskType", "normalizeModuleId", "moduleIdsMatch", "clonePlain",
    "getBoundKioskTypeConfig", "createEmptyBoundSlots", "getDefaultBoundKioskHardware", "recalculateKioskTotals",
    "createBoundKioskDocument", "stationBindingBindModuleImpl", "stationBindingUnbindModuleImpl", "stationBindingMoveModuleImpl"]) {
    vm.runInContext(definition(name), context, {filename: `index.js:${name}`});
  }
  return {db,
    bind: (data) => context.stationBindingBindModuleImpl(data, {uid: "admin"}),
    unbind: (data) => context.stationBindingUnbindModuleImpl(data, {uid: "admin"}),
    move: (data) => context.stationBindingMoveModuleImpl(data, {uid: "admin"})};
}
const request = {country: "US", stationid: "US8998", moduleId: "ZDHW0726090", kioskType: "CTF7"};
test("CTF7 binding creates one inactive seven-slot module and a stable registry", async () => {
  const {db, bind} = harness(); const result = await bind(request);
  const kiosk = db.rows.get(`kiosks/${result.provisionid}`);
  assert.equal(kiosk.modules.length, 1); assert.equal(kiosk.modules[0].slots.length, 7);
  assert.equal(kiosk.modules[0].id, "LM-ZDHW0726090"); assert.equal(kiosk.modules[0].machineSN, "");
  assert.equal(kiosk.hardware.capacity, 7); assert.equal(kiosk.active, false); assert.equal(kiosk.enabled, false);
  assert.equal(db.rows.get("ctf7Bindings/LM-ZDHW0726090").generation, 1);
});
test("concurrent bindings cannot assign the same module twice", async () => {
  const {db, bind} = harness();
  const results = await Promise.allSettled([bind(request), bind({...request, stationid: "US8997"})]);
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal([...db.rows.keys()].filter((key) => key.startsWith("kiosks/")).length, 1);
});
test("label serial is never truncated into a login serial and aliases cannot collide", async () => {
  const {bind, db} = harness();
  await assert.rejects(bind({...request, machineSN: "ZDHW0726090"}), (error) => error.code === "invalid-argument");
  db.rows.set("ctf7Bindings/LM-OTHER00007", {machineSN: "TEST000007", state: "unbound"});
  await assert.rejects(bind({...request, machineSN: "TEST000007"}), (error) => error.code === "already-exists");
});
test("fan identifiers cannot be registered as Besiter modules", async () => {
  const {bind} = harness();
  await assert.rejects(bind({...request, moduleId: "LM-ZDHW0726090", kioskType: "CT4"}),
      (error) => error.code === "invalid-argument");
});
test("unbind preserves the module identity and fences the previous generation", async () => {
  const {db, bind, unbind} = harness(); const result = await bind(request);
  await unbind({stationid: request.stationid, moduleId: result.moduleId});
  const registry = db.rows.get(`ctf7Bindings/${result.moduleId}`);
  assert.equal(registry.state, "unbound"); assert.equal(registry.generation, 2); assert.equal(registry.controlEnabled, false);
  assert.equal(db.rows.get(`pending/${result.moduleId}`).moduleId, result.moduleId);
});
test("unresolved vend blocks unbind and retains the station assignment", async () => {
  const {db, bind, unbind} = harness(); const result = await bind(request);
  db.rows.set(`ctf7CommandLocks/${result.moduleId}`, {unresolved: true});
  await assert.rejects(unbind({stationid: request.stationid, moduleId: result.moduleId}), /pending CTF7 dispense/);
  assert.equal(db.rows.get(`ctf7Bindings/${result.moduleId}`).state, "bound");
});
test("move changes assignment atomically without emitting a Besiter rebind command", async () => {
  const {db, bind, move} = harness(); const result = await bind(request);
  const moved = await move({sourceStationid: request.stationid, moduleId: result.moduleId,
    createNewStation: true, destinationCountry: "US", destinationStationid: "US8997", kioskType: "CTF7"});
  const registry = db.rows.get(`ctf7Bindings/${result.moduleId}`);
  assert.equal(registry.stationid, "US8997"); assert.equal(registry.generation, 2);
  assert.equal(registry.moduleId, result.moduleId); assert.equal(moved.reconnectState, "assignment-updated");
  assert.equal([...db.rows.keys()].some((key) => key.startsWith("moduleRebindCommands/")), false);
});
test("moving into another CTF7 station retains seven slots per physical module", async () => {
  const {db, bind, move} = harness(); const result = await bind(request);
  const destination = await bind({...request, stationid: "US8997", moduleId: "OTHER000007"});
  await move({sourceStationid: request.stationid, moduleId: result.moduleId,
    destinationStationid: "US8997", destinationCountry: "US", createNewStation: false});
  const kiosk = db.rows.get(`kiosks/${destination.provisionid}`);
  assert.equal(kiosk.modules.length, 2); assert.equal(kiosk.hardware.capacity, 14);
  assert.equal(kiosk.hardware.modules, 2); assert.equal(kiosk.modules[0].slots.length, 7);
});
test("move rejects protocol mismatch, unresolved vends, and stale assignments", async () => {
  const {db, bind, move} = harness(); const result = await bind(request);
  await assert.rejects(move({sourceStationid: request.stationid, moduleId: result.moduleId,
    createNewStation: true, destinationCountry: "US", destinationStationid: "US8997", kioskType: "CT4"}), /Choose CTF7/);
  db.rows.set(`ctf7CommandLocks/${result.moduleId}`, {unresolved: true});
  const moveRequest = {sourceStationid: request.stationid, moduleId: result.moduleId,
    createNewStation: true, destinationCountry: "US", destinationStationid: "US8997", kioskType: "CTF7"};
  await assert.rejects(move(moveRequest), /pending CTF7 dispense/);
  db.rows.delete(`ctf7CommandLocks/${result.moduleId}`);
  db.rows.get(`ctf7Bindings/${result.moduleId}`).stationid = "US8996";
  await assert.rejects(move(moveRequest), /assignment changed/);
});
