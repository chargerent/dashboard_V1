export const CTF7_MODEL = 'CTF7';
export const CTF7_PROTOCOL = 'lm-tcp-v1';

export function parseCtf7ModuleId(value) {
  const serial = String(value ?? '').trim().replace(/^LM-/, '');
  return /^[A-Za-z0-9_-]{8,32}$/.test(serial) ? `LM-${serial}` : '';
}

export function isCtf7Module(module, kiosk) {
  return module?.protocol === CTF7_PROTOCOL || kiosk?.hardware?.type === CTF7_MODEL;
}
