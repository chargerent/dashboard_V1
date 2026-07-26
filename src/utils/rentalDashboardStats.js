const DAY_MS = 24 * 60 * 60 * 1000;

const emptyPeriod = () => ({
  count: 0,
  revenue: 0,
  initialCharge: 0,
});

export function createEmptyRentalDashboardTotals(symbol = '$') {
  return {
    today: emptyPeriod(),
    last7Days: emptyPeriod(),
    last30Days: emptyPeriod(),
    monthToDate: emptyPeriod(),
    yearToDate: emptyPeriod(),
    statusCounts: {
      rented: 0,
      lost: 0,
    },
    symbol,
  };
}

function addPeriod(target, source) {
  target.count += Number(source?.count) || 0;
  target.revenue += Number(source?.revenue) || 0;
  target.initialCharge += Number(source?.initialCharge) || 0;
}

function getUtcDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function getRentalPeriodKeys(referenceTime) {
  const now = new Date(referenceTime);
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const sevenDaysAgo = new Date(safeNow.getTime() - (7 * DAY_MS));
  const thirtyDaysAgo = new Date(safeNow.getTime() - (30 * DAY_MS));
  const todayKey = getUtcDateKey(safeNow);

  return {
    todayKey,
    sevenDayKey: getUtcDateKey(sevenDaysAgo),
    thirtyDayKey: getUtcDateKey(thirtyDaysAgo),
    monthPrefix: todayKey.slice(0, 7),
    yearPrefix: todayKey.slice(0, 4),
  };
}

function getStationStats(statsByStationId, stationId) {
  if (statsByStationId instanceof Map) {
    return statsByStationId.get(stationId);
  }

  return statsByStationId?.[stationId];
}

export function aggregateRentalDashboardStats(
  statsByStationId,
  stationIds,
  referenceTime,
  symbol = '$'
) {
  const totals = createEmptyRentalDashboardTotals(symbol);
  const {
    todayKey,
    sevenDayKey,
    thirtyDayKey,
    monthPrefix,
    yearPrefix,
  } = getRentalPeriodKeys(referenceTime);

  [...new Set((stationIds || []).map(value => String(value || '').trim()).filter(Boolean))]
    .forEach((stationId) => {
      const stationStats = getStationStats(statsByStationId, stationId);
      if (!stationStats) return;

      Object.entries(stationStats.days || {}).forEach(([dayKey, dayTotals]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey > todayKey) return;

        if (dayKey === todayKey) addPeriod(totals.today, dayTotals);
        if (dayKey >= sevenDayKey) addPeriod(totals.last7Days, dayTotals);
        if (dayKey >= thirtyDayKey) {
          addPeriod(totals.last30Days, dayTotals);
          totals.statusCounts.rented += Number(dayTotals?.rented) || 0;
          totals.statusCounts.lost += Number(dayTotals?.lost) || 0;
        }
        if (dayKey.startsWith(monthPrefix)) addPeriod(totals.monthToDate, dayTotals);
        if (dayKey.startsWith(yearPrefix)) addPeriod(totals.yearToDate, dayTotals);
      });
    });

  return totals;
}
