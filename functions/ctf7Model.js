/* eslint-env node */
// One physical CTF7 is one module. Cabin addresses are transport details.
const MODEL = "CTF7";
const PROTOCOL = "lm-tcp-v1";
const CAPACITY = 7;
const BINDINGS_COLLECTION = "ctf7Bindings";

function manufacturerSerial(value) {
  const sn = String(value ?? "").trim().replace(/^LM-/, "");
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(sn)) {
    throw new TypeError("CTF7 requires the label serial, or LM-<label serial>.");
  }
  return sn;
}

function moduleId(value) {
  return `LM-${manufacturerSerial(value)}`;
}

function isCtf7Module(module) {
  return module?.protocol === PROTOCOL || /^LM-[A-Za-z0-9_-]{8,32}$/.test(String(module?.id || module || ""));
}

function validateSlotMap(value) {
  if (!Array.isArray(value) || value.length !== CAPACITY) {
    throw new TypeError("CTF7 needs an explicitly verified map of exactly seven slots.");
  }
  const seenPositions = new Set();
  const seenAddresses = new Set();
  const result = value.map((entry) => {
    const {position, cabin, channel} = entry;
    if (!Number.isInteger(position) || position < 1 || position > CAPACITY ||
        !Number.isInteger(cabin) || cabin < 1 || cabin > 3 ||
        !Number.isInteger(channel) || channel < 1 || channel > 4 ||
        seenPositions.has(position) || seenAddresses.has(`${cabin}:${channel}`)) {
      throw new TypeError("Invalid or duplicate CTF7 slot address.");
    }
    seenPositions.add(position);
    seenAddresses.add(`${cabin}:${channel}`);
    return {position, cabin, channel};
  });
  return result.sort((a, b) => a.position - b.position);
}

function createModule(value) {
  return {
    id: moduleId(value), model: MODEL, protocol: PROTOCOL,
    manufacturerSerial: manufacturerSerial(value), machineSN: "", capacity: CAPACITY,
    slotMap: [], topologyVerified: false, operationalEnabled: false,
    inventoryVerified: false, controlEnabled: false, lastUpdated: null,
    slots: Array.from({length: CAPACITY}, (_, index) => ({
      position: index + 1, absolutePosition: index + 1,
      sn: "", status: 0, observed: false, batteryLevel: null,
      lock: false, lockReason: "", rented: false,
    })),
    total: 0, full: 0, empty: 0, slot: 0, lock: 0, charging: 0,
  };
}

function boundRegistry({module, stationid, provisionid, previous = {}, timestamp, actorUid}) {
  return {
    ...previous,
    moduleId: module.id, manufacturerSerial: module.manufacturerSerial,
    machineSN: module.machineSN || previous.machineSN || "",
    model: MODEL, protocol: PROTOCOL, capacity: CAPACITY,
    stationid, provisionid, state: "bound",
    generation: Number(previous.generation || 0) + 1,
    controlEnabled: false, topologyVerified: module.topologyVerified === true,
    slotMap: module.topologyVerified === true ? validateSlotMap(module.slotMap) : [],
    updatedAt: timestamp, updatedBy: actorUid,
  };
}

function hasBank(slot) {
  return slot?.observed === true && Number(slot.status) === 1 &&
    /^[\x21-\x7e]{12}$/.test(String(slot.sn || "")) && !/^0+$/.test(slot.sn);
}

function freshModule(module, now = Date.now()) {
  const age = now - Date.parse(module?.lastInventoryAt || module?.lastUpdated);
  return module?.connected === true && module.inventoryVerified === true &&
    module.topologyVerified === true && Number.isFinite(age) && age >= 0 && age <= 30000;
}

// Same station -> modules -> slots contract as V2. Availability is separate from
// the operator's lock: commissioning and disconnects must never erase that lock.
function summarizeKiosk(kiosk, now = Date.now()) {
  const power = Number(kiosk?.hardware?.power ?? 80);
  const threshold = Number.isFinite(power) ? power : 80;
  const stationEnabled = kiosk.active === true && kiosk.enabled !== false &&
    !kiosk.disabled && kiosk.rentalsValidated === true;
  const modules = (kiosk.modules || []).map((module) => {
    const slots = module.slots || [];
    const occupied = slots.filter(hasBank);
    const full = occupied.filter((slot) => Number.isFinite(slot.batteryLevel) && slot.batteryLevel >= threshold);
    const ready = stationEnabled && module.operationalEnabled === true &&
      module.controlEnabled === true && freshModule(module, now);
    return {...module, total: occupied.length, full: full.length,
      empty: occupied.filter((slot) => Number.isFinite(slot.batteryLevel) && slot.batteryLevel < threshold).length,
      slot: slots.filter((slot) => slot.observed === true && Number(slot.status) === 0).length,
      lock: slots.filter((slot) => slot.lock === true).length,
      count: ready ? full.filter((slot) => !slot.lock && !slot.abnormal && !slot.rented).length : 0,
      charging: 0}; // The protocol does not report charging current.
  });
  const sum = (field) => modules.reduce((total, module) => total + Number(module[field] || 0), 0);
  const count = sum("count");
  return {...kiosk, active: kiosk.active === true,
    enabled: kiosk.active === true && kiosk.enabled !== false,
    modules, moduleIds: modules.map((module) => module.id),
    hardware: {...kiosk.hardware, type: MODEL, protocol: PROTOCOL,
      modules: modules.length, capacity: CAPACITY * modules.length},
    count, chargers: count || "soldout", slotscount: CAPACITY * modules.length,
    lockcount: sum("lock"), total: sum("total"), full: sum("full"), empty: sum("empty"),
    slot: sum("slot"), charging: sum("charging")};
}

module.exports = {MODEL, PROTOCOL, CAPACITY, BINDINGS_COLLECTION,
  manufacturerSerial, moduleId, isCtf7Module, validateSlotMap, createModule, boundRegistry,
  hasBank, freshModule, summarizeKiosk};
