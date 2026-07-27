export const SSH_STATE_OVERRIDE_TTL_MS = 60_000;

export function rememberSshStateOverride(
  overrides,
  stationid,
  ssh,
  now = Date.now(),
  ttlMs = SSH_STATE_OVERRIDE_TTL_MS,
) {
  const normalizedStationId = String(stationid || '').trim();
  if (!normalizedStationId || !(overrides instanceof Map)) return;

  overrides.set(normalizedStationId, {
    ssh: ssh === true,
    expiresAt: now + ttlMs,
  });
}

export function applySshStateOverride(station, overrides, now = Date.now()) {
  if (!station || !(overrides instanceof Map)) return station;

  const stationid = String(station.stationid || '').trim();
  const override = overrides.get(stationid);
  if (!override) return station;

  if (station.ssh === override.ssh || now >= Number(override.expiresAt || 0)) {
    overrides.delete(stationid);
    return station;
  }

  return { ...station, ssh: override.ssh };
}
