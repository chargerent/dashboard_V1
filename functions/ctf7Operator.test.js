/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {createOperatorApi} = require("./ctf7Operator");
const model = require("./ctf7Model");

class FakeDb {
  constructor() { this.rows = new Map(); this.tail = Promise.resolve(); }
  snap(ref) { const data = this.rows.get(ref.path); return {ref, id: ref.id, exists: !!data, data: () => data && structuredClone(data)}; }
  collection(name) {
    const db = this;
    const query = (filters = []) => ({
      doc(id) { const ref = {path: `${name}/${id}`, id}; ref.get = async () => db.snap(ref); return ref; },
      where(field, _op, value) { return query([...filters, [field, value]]); }, limit() { return this; },
      async get() { const docs = [...db.rows.keys()].filter(key => key.startsWith(`${name}/`) &&
        filters.every(([field, value]) => db.rows.get(key)[field] === value)).map(path => db.snap({path, id: path.split("/")[1]}));
      return {docs, size: docs.length, empty: !docs.length}; },
    });
    return query();
  }
  runTransaction(fn) {
    const pending = this.tail.then(async () => {
      const writes = [];
      const result = await fn({get: async ref => { assert.equal(writes.length, 0); return this.snap(ref); },
        set: (ref, data) => writes.push([ref.path, structuredClone(data)]),
        create: (ref, data) => { assert.equal(this.rows.has(ref.path), false); writes.push([ref.path, structuredClone(data)]); }});
      writes.forEach(([path, data]) => this.rows.set(path, data)); return result;
    });
    this.tail = pending.catch(() => {}); return pending;
  }
}
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fixture() {
  const db = new FakeDb(); const now = Date.now();
  const modules = ["TEST000007", "TEST000008"].map((sn, index) => {
    const module = model.createModule(sn);
    Object.assign(module, {machineSN: sn, connected: true, inventoryVerified: true, topologyVerified: true,
      controlEnabled: true, operationalEnabled: true, lastUpdated: new Date(now).toISOString(), lastInventoryAt: new Date(now).toISOString()});
    module.slots[0] = {...module.slots[0], sn: `FAN00000000${index + 1}`, status: 1, observed: true, batteryLevel: 99, mode: 0};
    db.rows.set(`ctf7Bindings/${module.id}`, {moduleId: module.id, machineSN: sn, state: "bound", generation: 1,
      stationid: "FR4000", provisionid: "id-test", controlEnabled: true, topologyVerified: true});
    db.rows.set(`ctf7Sessions/${module.id}`, {sessionId: `session-${index}`, generation: 1, connected: true});
    return module;
  });
  db.rows.set("kiosks/id-test", {stationid: "FR4000", active: true, enabled: true, rentalsValidated: true,
    hardware: {type: "CTF7", power: 80}, modules, info: {client: "venue"}});
  return {db, modules, api: createOperatorApi({db, HttpsError, now: () => now}), now};
}
const admin = {uid: "admin", isAdmin: true};
const request = {stationid: "FR4000", action: "eject all", requestId: "batch-1"};
test("operator bulk eject spans modules with distinct session/generation and durable locks", async () => {
  const {db, api} = fixture(); const receipt = await api.execute(request, admin);
  assert.equal(receipt.targets.length, 2); assert.equal(receipt.state, "queued");
  const stored = db.rows.get("ctf7OperatorRequests/batch-1");
  assert.equal(stored.targets[0].sn, "FAN000000001");
  assert.notEqual(stored.targets[0].requestId, stored.targets[1].requestId);
  assert.notEqual(stored.targets[0].moduleId, stored.targets[1].moduleId);
  await assert.rejects(api.execute({...request, requestId: "batch-2"}, admin), /unresolved/);
  assert.equal((await api.execute(request, admin)).requestId, "batch-1");
  await assert.rejects(api.execute({...request, action: "eject full"}, admin), /different operation/);
});
test("client command permissions and station ownership are both enforced", async () => {
  const {api} = fixture();
  await assert.rejects(api.execute(request, {uid: "other", profile: {clientId: "other", commands: {eject: true}}}), /Not allowed/);
  await assert.rejects(api.execute(request, {uid: "owner", profile: {clientId: "venue", commands: {lock: true}}}), /Not allowed/);
  await api.execute(request, {uid: "owner", profile: {clientId: "venue", commands: {eject: true}}});
  await assert.rejects(api.status({requestId: request.requestId}, {uid: "other", profile: {clientId: "other", commands: {eject: true}}}), /Not allowed/);
});
test("commissioning, stale inventory, and a changed bank cannot reach the queue", async () => {
  const {db, api, modules, now} = fixture();
  const specific = {...request, action: "eject specific", moduleid: modules[0].id, slotid: 1};
  await assert.rejects(api.execute({...specific, chargerid: "FAN000000099"}, admin), /changed/);
  db.rows.get("kiosks/id-test").modules[0].controlEnabled = false;
  await assert.rejects(api.execute(specific, admin), /controls/);
  db.rows.get("kiosks/id-test").modules[0].controlEnabled = true;
  db.rows.get("kiosks/id-test").modules[0].lastInventoryAt = new Date(now - 31000).toISOString();
  await assert.rejects(api.execute(specific, admin), /stale/);
  assert.equal(db.rows.has("ctf7OperatorRequests/batch-1"), false);
});
test("slot-only eject and unsupported protocol operations fail without fabricating serials", async () => {
  const {api, modules} = fixture();
  await assert.rejects(api.execute({...request, action: "eject specific", moduleid: modules[0].id, slotid: 2}, admin), /12-byte serial/);
  await assert.rejects(api.execute({...request, action: "reboot module", moduleid: modules[0].id}, admin), /not supported/);
});
test("module lock and OFF preserve the other module and recompute shared station availability", async () => {
  const {api, db, modules} = fixture();
  await api.execute({...request, action: "lock module", moduleid: modules[0].id}, admin);
  let kiosk = db.rows.get("kiosks/id-test");
  assert.equal(kiosk.count, 1); assert.equal(kiosk.lockcount, 7); assert.equal(kiosk.hardware.capacity, 14);
  assert.equal(kiosk.modules[1].slots[0].lock, false);
  await api.execute({...request, requestId: "off", action: "disable module", moduleid: modules[1].id}, admin);
  kiosk = db.rows.get("kiosks/id-test");
  assert.equal(kiosk.count, 0); assert.equal(kiosk.modules[0].slots[0].lock, true);
  assert.equal(kiosk.modules[1].operationalEnabled, false);
});
test("enabling rentals is gated independently of operator locks", async () => {
  const {api, db, modules} = fixture();
  db.rows.get("kiosks/id-test").rentalsValidated = false;
  await assert.rejects(api.execute({...request, action: "enable module", moduleid: modules[0].id}, admin), /validation/);
  await api.execute({...request, action: "disable module", moduleid: modules[0].id}, admin);
  assert.equal(db.rows.get("kiosks/id-test").modules[0].operationalEnabled, false);
});
