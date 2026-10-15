export const CTF7_MODEL = 'CTF7';
export const CTF7_PROTOCOL = 'lm-tcp-v1';

export function parseCtf7ModuleId(value) {
  const serial = String(value ?? '').trim().replace(/^LM-/, '');
  return /^[A-Za-z0-9_-]{8,32}$/.test(serial) ? `LM-${serial}` : '';
}

export function isCtf7Module(module, kiosk) {
  return module?.protocol === CTF7_PROTOCOL || kiosk?.hardware?.type === CTF7_MODEL;
}

export const CTF7_OPERATOR_ACTIONS = new Set(['eject specific', 'eject module', 'eject all',
  'eject full', 'eject empty', 'eject locked', 'eject locked manual', 'eject locked auto', 'eject count',
  'lock module', 'unlock module', 'enable module', 'disable module', 'enable', 'disable']);

export function commandChargerId(value, kiosk) {
  if (kiosk?.hardware?.vendor === 'lita' || kiosk?.hardware?.checkoutExecution === 'local') {
    const serial = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,80}$/.test(serial) && !/^0+$/.test(serial) ? serial : undefined;
  }
  if (kiosk?.hardware?.type === CTF7_MODEL) {
    const serial = String(value ?? '').trim();
    return /^[\x21-\x7e]{12}$/.test(serial) && !/^0+$/.test(serial) ? serial : undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

export function ctf7EjectDisabledReason(module, now = Date.now()) {
  if (!module?.connected) return 'Module offline';
  if (!module.topologyVerified) return 'Verify the seven physical slot addresses';
  if (!module.controlEnabled) return 'Complete the physical eject test';
  const age = now - Date.parse(module.lastInventoryAt || module.lastUpdated);
  if (!module.inventoryVerified || !Number.isFinite(age) || age < 0 || age > 30000) return 'Awaiting fresh inventory';
  return '';
}

// Only successful, identity-matched results clear a slot. Partial bulk outcomes
// never clear another module or a bank that arrived after the command.
export function applyCtf7EjectResults(stations, receipt) {
  return stations.map((station) => station.stationid !== receipt.stationid ? station : {
    ...station,
    modules: station.modules.map((module) => ({...module, slots: module.slots.map((slot) => {
      const result = (receipt.results || []).find((entry) => entry.state === 'dispensed' &&
        entry.moduleId === module.id && Number(entry.position) === Number(slot.position) && entry.sn === slot.sn);
      return result ? {...slot, sn: '', status: 0, sstat: '0C', batteryLevel: null, chargingCurrent: 0} : slot;
    })})),
  });
}
