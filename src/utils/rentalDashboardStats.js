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

function getRentalPeriodStarts(referenceTime) {
  const now = new Date(referenceTime);
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const todayStart = new Date(safeNow);
  todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(safeNow);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setMinutes(0, 0, 0);
  const thirtyDaysAgo = new Date(safeNow);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setMinutes(0, 0, 0);
  const monthStart = new Date(safeNow);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(safeNow);
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);

  return {
    now: safeNow,
    todayStart,
    sevenDaysAgo,
    thirtyDaysAgo,
    monthStart,
    yearStart,
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
  const periodStarts = getRentalPeriodStarts(referenceTime);

  [...new Set((stationIds || []).map(value => String(value || '').trim()).filter(Boolean))]
    .forEach((stationId) => {
      const stationStats = getStationStats(statsByStationId, stationId);
      if (!stationStats) return;

      const hourlyEntries = Object.entries(stationStats.hours || {});
      if (hourlyEntries.length === 0) {
        // Schema v2 compatibility while the production summaries are being migrated.
        // These UTC day buckets cannot represent a browser-local midnight exactly.
        const todayKey = periodStarts.now.toISOString().slice(0, 10);
        const sevenDayKey = new Date(
          periodStarts.now.getTime() - (7 * DAY_MS)
        ).toISOString().slice(0, 10);
        const thirtyDayKey = new Date(
          periodStarts.now.getTime() - (30 * DAY_MS)
        ).toISOString().slice(0, 10);
        Object.entries(stationStats.days || {}).forEach(([dayKey, dayTotals]) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey > todayKey) return;

          if (dayKey === todayKey) addPeriod(totals.today, dayTotals);
          if (dayKey >= sevenDayKey) addPeriod(totals.last7Days, dayTotals);
          if (dayKey >= thirtyDayKey) {
            addPeriod(totals.last30Days, dayTotals);
            totals.statusCounts.rented += Number(dayTotals?.rented) || 0;
            totals.statusCounts.lost += Number(dayTotals?.lost) || 0;
          }
          if (dayKey.startsWith(todayKey.slice(0, 7))) addPeriod(totals.monthToDate, dayTotals);
          if (dayKey.startsWith(todayKey.slice(0, 4))) addPeriod(totals.yearToDate, dayTotals);
        });
        return;
      }

      hourlyEntries.forEach(([hourKey, hourTotals]) => {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hourKey)) return;
        const bucketTime = new Date(`${hourKey}:00:00.000Z`);
        if (!Number.isFinite(bucketTime.getTime()) || bucketTime > periodStarts.now) return;

        if (bucketTime >= periodStarts.todayStart) addPeriod(totals.today, hourTotals);
        if (bucketTime >= periodStarts.sevenDaysAgo) addPeriod(totals.last7Days, hourTotals);
        if (bucketTime >= periodStarts.thirtyDaysAgo) {
          addPeriod(totals.last30Days, hourTotals);
          totals.statusCounts.rented += Number(hourTotals?.rented) || 0;
          totals.statusCounts.lost += Number(hourTotals?.lost) || 0;
        }
        if (bucketTime >= periodStarts.monthStart) addPeriod(totals.monthToDate, hourTotals);
        if (bucketTime >= periodStarts.yearStart) addPeriod(totals.yearToDate, hourTotals);
      });
    });

  return totals;
}
