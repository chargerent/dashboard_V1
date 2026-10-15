/* eslint-env node */
const {createHash} = require("node:crypto");
const model = require("./ctf7Model");

const EJECT_ACTIONS = new Set(["eject specific", "eject module", "eject all", "eject full",
  "eject empty", "eject locked", "eject locked manual", "eject locked auto", "eject count"]);
const STATE_ACTIONS = new Set(["lock module", "unlock module", "enable module", "disable module", "enable", "disable"]);

function permissionFor(action) {
  if (action.includes("lock") && !action.startsWith("eject")) return "lock";
  if (action === "eject count") return "eject_multiple";
  return action.startsWith("eject") ? "eject" : "disable";
}
function authorized(auth, kiosk, action) {
  if (auth?.isAdmin === true) return true;
  const client = String(auth?.profile?.clientId || "").trim();
  const scoped = client && [kiosk.info?.client, kiosk.info?.clientId, kiosk.info?.rep].includes(client);
  const commands = auth?.profile?.commands || auth?.profile?.Commands || {};
  return Boolean(scoped && commands[permissionFor(action)] === true);
}
function automaticLock(slot) {
  const reason = String(slot.lockReason || "").trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  return reason.startsWith("auto locked") || reason.startsWith("never dispensed:") ||
    reason.startsWith("broken charger suspected:") || reason.includes("consecutive returns between 1 and 5 minutes") ||
    reason.includes("verified motor error; charger remained present");
}
function createOperatorApi({db, HttpsError, now = Date.now}) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const assertAccess = (auth, kiosk, action) => {
    if (kiosk?.hardware?.type !== model.MODEL) fail("failed-precondition", "This route requires a CTF7 station.");
    if (!authorized(auth, kiosk, action)) fail("permission-denied", "Not allowed to control this station.");
  };
  const receipt = (value) => ({requestId: value.requestId, stationid: value.stationid,
    action: value.action, state: value.state, results: value.results || [],
    targets: value.targets.map(({moduleId, position, sn}) => ({moduleid: moduleId, slotid: position, chargerid: sn})),
    message: value.message || ""});

  async function execute(data, auth) {
    const stationid = String(data?.stationid || "").trim().toUpperCase();
    const action = String(data?.action || "").trim().toLowerCase();
    const moduleId = String(data?.moduleid || "").trim();
    const requestId = String(data?.requestId || "").trim();
    if (!stationid || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) fail("invalid-argument", "Station and unique request ID are required.");
    if (!EJECT_ACTIONS.has(action) && !STATE_ACTIONS.has(action)) fail("failed-precondition", "This operation is not supported by the CTF7 protocol.");
    const station = await db.collection("kiosks").where("stationid", "==", stationid).limit(2).get();
    if (station.size !== 1) fail("not-found", "Station assignment is missing or ambiguous.");
    const kioskRef = station.docs[0].ref;
    const requestRef = db.collection("ctf7OperatorRequests").doc(requestId);
    const fingerprint = JSON.stringify({stationid, action, moduleId, slotid: data.slotid ?? null,
      chargerid: data.chargerid ?? null});

    return db.runTransaction(async (tx) => {
      const [kioskSnap, previousSnap] = await Promise.all([tx.get(kioskRef), tx.get(requestRef)]);
      const kiosk = kioskSnap.data();
      if (!kioskSnap.exists || kiosk.stationid !== stationid) fail("aborted", "Station assignment changed.");
      assertAccess(auth, kiosk, action);
      const previous = previousSnap.data();
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail("already-exists", "Request ID was used for a different operation.");
        return receipt(previous);
      }
      const modules = (kiosk.modules || []).filter((module) => !moduleId || module.id === moduleId);
      if (!modules.length || ((action.endsWith("module") || action === "eject specific") && !moduleId)) fail("not-found", "Select the module on this station.");
      if (STATE_ACTIONS.has(action)) {
        if (action.startsWith("enable") && (kiosk.rentalsValidated !== true || modules.some((module) =>
          module.controlEnabled !== true || module.topologyVerified !== true))) {
          fail("failed-precondition", "Rental and return validation must finish before enabling this station or module.");
        }
        const next = {...kiosk, modules: (kiosk.modules || []).map((module) => {
          if (!modules.some((entry) => entry.id === module.id)) return module;
          if (action.includes("lock")) {
            const locked = action === "lock module";
            return {...module, slots: module.slots.map((slot) => ({...slot, lock: locked,
              lockReason: locked ? String(data.info || "Module locked manually from dashboard").slice(0, 500) : ""}))};
          }
          if (action.endsWith("module")) return {...module, operationalEnabled: action === "enable module"};
          return module;
        })};
        if (action === "disable") next.disabled = {status: true};
        if (action === "enable") next.disabled = null;
        const summary = model.summarizeKiosk(next, now());
        const record = {requestId, stationid, provisionid: kioskRef.id, action, fingerprint,
          state: "completed", targets: [], results: [], requestedBy: auth.uid,
          requestedAt: new Date(now()).toISOString(), message: `${action} saved on ${stationid}.`};
        tx.set(kioskRef, summary);
        tx.create(requestRef, record);
        return {...receipt(record), kiosk: summary};
      }

      const threshold = Number(kiosk.hardware?.power ?? 80);
      let targets = modules.flatMap((module) => (module.slots || []).filter((slot) => {
        if (action === "eject specific") return Number(slot.position) === Number(data.slotid);
        if (!model.hasBank(slot)) return false;
        if (action === "eject full") return slot.batteryLevel >= threshold && !slot.lock;
        if (action === "eject empty") return Number.isFinite(slot.batteryLevel) && slot.batteryLevel < threshold && !slot.lock;
        if (action.startsWith("eject locked")) return slot.lock === true &&
          (action === "eject locked" || automaticLock(slot) === action.endsWith("auto"));
        return true;
      }).map((slot) => ({moduleId: module.id, position: Number(slot.position), sn: String(slot.sn || ""),
        mode: slot.mode ?? 0})));
      if (action === "eject count") {
        const count = Number(data.slotid);
        if (!Number.isInteger(count) || count < 1 || count > 100) fail("invalid-argument", "Eject count must be between 1 and 100.");
        targets = targets.slice(0, count);
      }
      if (!targets.length) fail("failed-precondition", "No matching occupied slots.");
      for (const target of targets) {
        const module = modules.find((entry) => entry.id === target.moduleId);
        const slot = module.slots.find((entry) => Number(entry.position) === target.position);
        if (!model.hasBank(slot)) fail("failed-precondition", "CTF7 eject requires a reported 12-byte serial; slot-only eject is not documented.");
        if (data.chargerid && String(data.chargerid) !== target.sn) fail("failed-precondition", "The charger in this slot has changed.");
        if (!model.freshModule(module, now()) || module.controlEnabled !== true) fail("failed-precondition", "Module is offline, inventory is stale, or controls have not been validated.");
      }
      const ids = [...new Set(targets.map((target) => target.moduleId))];
      const resources = await Promise.all(ids.map(async (id) => {
        const bindingRef = db.collection(model.BINDINGS_COLLECTION).doc(id);
        const sessionRef = db.collection("ctf7Sessions").doc(id);
        const lockRef = db.collection("ctf7OperatorLocks").doc(id);
        const motorRef = db.collection("ctf7CommandLocks").doc(id);
        const [binding, session, lock, motor] = await Promise.all([tx.get(bindingRef), tx.get(sessionRef), tx.get(lockRef), tx.get(motorRef)]);
        return {id, binding: binding.data(), session: session.data(), lock: lock.data(), motor: motor.data(), lockRef};
      }));
      for (const entry of resources) {
        if (entry.binding?.provisionid !== kioskRef.id || entry.binding.stationid !== stationid ||
            entry.binding.state !== "bound" || !entry.binding.controlEnabled || !entry.binding.topologyVerified ||
            entry.session?.connected !== true || entry.session.generation !== entry.binding.generation ||
            entry.lock?.unresolved || entry.motor?.unresolved) fail("failed-precondition", "Assignment changed or an unresolved command blocks this module.");
        targets.filter((target) => target.moduleId === entry.id).forEach((target) => {
          target.generation = entry.binding.generation; target.sessionId = entry.session.sessionId;
        });
      }
      targets.forEach((target, index) => { target.requestId = createHash("sha256").update(`${requestId}:${index}`).digest("hex"); });
      const record = {requestId, stationid, provisionid: kioskRef.id, action, fingerprint,
        state: "queued", targets, results: [], requestedBy: auth.uid,
        requestedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 30000).toISOString()};
      tx.create(requestRef, record);
      resources.forEach((entry) => tx.set(entry.lockRef, {requestId, unresolved: true}));
      return receipt(record);
    });
  }

  async function status(data, auth) {
    const requestId = String(data?.requestId || "");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) fail("invalid-argument", "Invalid request ID.");
    const snap = await db.collection("ctf7OperatorRequests").doc(requestId).get();
    if (!snap.exists) fail("not-found", "Command not found.");
    const record = snap.data();
    const kiosk = await db.collection("kiosks").doc(record.provisionid).get();
    if (!kiosk.exists || kiosk.data().stationid !== record.stationid) fail("failed-precondition", "Station assignment changed.");
    assertAccess(auth, kiosk.data(), record.action);
    return receipt(record);
  }
  return {execute, status};
}
module.exports = {createOperatorApi, EJECT_ACTIONS, STATE_ACTIONS};
