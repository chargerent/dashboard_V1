const ROLLING_RENTAL_DAYS = 31;
const DASHBOARD_STATS_SCHEMA_VERSION = 3;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getUtcHourKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 13) : "";
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

  const hourKey = getUtcHourKey(rental.rentalTime);
  return {
    stationid,
    hourKey,
    count: hourKey ? 1 : 0,
    revenue: hourKey ? toFiniteNumber(rental.totalCharged) : 0,
    initialCharge: hourKey ? toFiniteNumber(rental.initialCharge) : 0,
    status: normalizeProjectedStatus(rental.status),
  };
}

function isRentalDashboardGenerationReady(meta) {
  return meta?.ready === true &&
    Number(meta?.schemaVersion) === DASHBOARD_STATS_SCHEMA_VERSION;
}

function projectionsEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.stationid === right.stationid &&
    left.hourKey === right.hourKey &&
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

function pruneOldHours(hours, referenceTime = new Date()) {
  const cutoffKey = getUtcHourKey(getRentalRetentionCutoff(referenceTime));

  return Object.fromEntries(
      Object.entries(hours || {}).filter(([hourKey]) => hourKey >= cutoffKey),
  );
}

function applyRentalProjection(summary, projection, direction, referenceTime = new Date()) {
  const next = {
    schemaVersion: DASHBOARD_STATS_SCHEMA_VERSION,
    stationid: projection.stationid,
    hours: {...(summary?.hours || {})},
  };

  if (projection.hourKey && projection.count) {
    const existing = next.hours[projection.hourKey] || {};
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
      delete next.hours[projection.hourKey];
    } else {
      next.hours[projection.hourKey] = updated;
    }
  }

  next.hours = pruneOldHours(next.hours, referenceTime);
  return next;
}

module.exports = {
  DASHBOARD_STATS_SCHEMA_VERSION,
  ROLLING_RENTAL_DAYS,
  applyRentalProjection,
  buildRentalProjection,
  getRentalRetentionCutoff,
  isRentalDashboardGenerationReady,
  projectionsEqual,
};
