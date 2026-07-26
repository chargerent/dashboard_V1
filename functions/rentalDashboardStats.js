const ROLLING_RENTAL_DAYS = 31;
const DASHBOARD_STATS_SCHEMA_VERSION = 2;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getUtcDateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function normalizeStationId(value) {
  return String(value || "").trim();
}

function normalizeProjectedStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return status === "rented" || status === "lost" ? status : "";
}

function getRentalRetentionCutoff(referenceTime = new Date()) {
  const now = new Date(referenceTime);
  const rollingCutoff = new Date(now);
  rollingCutoff.setUTCDate(rollingCutoff.getUTCDate() - ROLLING_RENTAL_DAYS);
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return rollingCutoff < yearStart ? rollingCutoff : yearStart;
}

function buildRentalProjection(rental) {
  if (!rental || typeof rental !== "object") return null;

  const stationid = normalizeStationId(rental.rentalStationid);
  if (!stationid) return null;

  const dayKey = getUtcDateKey(rental.rentalTime);
  return {
    stationid,
    dayKey,
    count: dayKey ? 1 : 0,
    revenue: dayKey ? toFiniteNumber(rental.totalCharged) : 0,
    initialCharge: dayKey ? toFiniteNumber(rental.initialCharge) : 0,
    status: normalizeProjectedStatus(rental.status),
  };
}

function projectionsEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.stationid === right.stationid &&
    left.dayKey === right.dayKey &&
    left.count === right.count &&
    left.revenue === right.revenue &&
    left.initialCharge === right.initialCharge &&
    left.status === right.status
  );
}

function clampNumber(value) {
  const normalized = Math.abs(value) < 0.000001 ? 0 : value;
  return normalized < 0 ? 0 : normalized;
}

function pruneOldDays(days, referenceTime = new Date()) {
  const cutoffKey = getUtcDateKey(getRentalRetentionCutoff(referenceTime));

  return Object.fromEntries(
      Object.entries(days || {}).filter(([dayKey]) => dayKey >= cutoffKey),
  );
}

function applyRentalProjection(summary, projection, direction, referenceTime = new Date()) {
  const next = {
    schemaVersion: DASHBOARD_STATS_SCHEMA_VERSION,
    stationid: projection.stationid,
    days: {...(summary?.days || {})},
  };

  if (projection.dayKey && projection.count) {
    const existing = next.days[projection.dayKey] || {};
    const updated = {
      count: clampNumber(toFiniteNumber(existing.count) + (direction * projection.count)),
      revenue: clampNumber(toFiniteNumber(existing.revenue) + (direction * projection.revenue)),
      initialCharge: clampNumber(
          toFiniteNumber(existing.initialCharge) + (direction * projection.initialCharge),
      ),
      rented: clampNumber(
          toFiniteNumber(existing.rented) +
          (projection.status === "rented" ? direction : 0),
      ),
      lost: clampNumber(
          toFiniteNumber(existing.lost) +
          (projection.status === "lost" ? direction : 0),
      ),
    };

    if (
      updated.count === 0 &&
      updated.revenue === 0 &&
      updated.initialCharge === 0 &&
      updated.rented === 0 &&
      updated.lost === 0
    ) {
      delete next.days[projection.dayKey];
    } else {
      next.days[projection.dayKey] = updated;
    }
  }

  next.days = pruneOldDays(next.days, referenceTime);
  return next;
}

module.exports = {
  DASHBOARD_STATS_SCHEMA_VERSION,
  ROLLING_RENTAL_DAYS,
  applyRentalProjection,
  buildRentalProjection,
  getRentalRetentionCutoff,
  projectionsEqual,
};
