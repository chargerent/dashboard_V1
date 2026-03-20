export function normalizeStationId(stationid) {
  return String(stationid || '').trim().toUpperCase();
}

export function buildStationQrUrl(stationid) {
  const normalizedStationId = normalizeStationId(stationid);
  return normalizedStationId
    ? `https://chargerent.online/stations/qr?id=${normalizedStationId}`
    : '';
}

export function parseStationQrInput(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return { mode: 'empty', stationid: '' };
  }

  const compactValue = rawValue.replace(/\s+/g, '');
  const idMatch = compactValue.match(/(?:^|[?&])id=([^&#\s]+)/i);

  if (idMatch) {
    try {
      return {
        mode: 'qr',
        stationid: normalizeStationId(decodeURIComponent(idMatch[1])),
      };
    } catch {
      return {
        mode: 'qr',
        stationid: normalizeStationId(idMatch[1]),
      };
    }
  }

  if (/^https?:\/\//i.test(compactValue)) {
    return { mode: 'invalid-url', stationid: '' };
  }

  return {
    mode: 'manual',
    stationid: normalizeStationId(rawValue),
  };
}
