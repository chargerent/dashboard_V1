export const NGROK_STATE_OVERRIDE_TTL_MS = 60_000;

export function rememberNgrokStateOverride(
  overrides,
  stationid,
  ngrok,
  now = Date.now(),
  ttlMs = NGROK_STATE_OVERRIDE_TTL_MS,
) {
  const normalizedStationId = String(stationid || '').trim();
  if (!normalizedStationId || !(overrides instanceof Map)) return;

  overrides.set(normalizedStationId, {
    ngrok: ngrok === true,
    expiresAt: now + ttlMs,
  });
}

export function applyNgrokStateOverride(station, overrides, now = Date.now()) {
  if (!station || !(overrides instanceof Map)) return station;

  const stationid = String(station.stationid || '').trim();
  const override = overrides.get(stationid);
  if (!override) return station;

  if (station.ngrok === override.ngrok || now >= Number(override.expiresAt || 0)) {
    overrides.delete(stationid);
    return station;
  }

  return { ...station, ngrok: override.ngrok };
}
