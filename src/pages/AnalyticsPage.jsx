import { useState, useEffect, useMemo, memo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase-config';
import { HomeIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/solid';

const COLORS = {
  rentals: '#3b82f6', // Blue
  count: '#22c55e',   // Green
  total: '#000000',   // Black
  disconnected: '#ef4444', // Red
  returns: '#f97316' // Orange
};

// ---------- GENERIC HELPERS ----------

// Safely turn Firestore TS / string / ms into Date
const safeToDate = (timestamp) => {
  if (!timestamp) return null;
  if (typeof timestamp.toDate === 'function') return timestamp.toDate();
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? null : d;
};

// Format milliseconds into a readable duration string
const formatMsDuration = (ms) => {
  if (ms === null || ms === undefined) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days > 0 ? `${days}d ` : ''}${hours > 0 ? `${hours}h ` : ''}${minutes}m`;
};

// Static ticks every 2 hours from 00:00 → 24:00
const generateTicks = () => Array.from({ length: 13 }, (_, i) => i * 2 * 60 * 60 * 1000);
const staticTicks = generateTicks();

/**
 * Get the offset (in ms) between UTC and a given IANA timezone at a given instant.
 * Positive result means “timezone is ahead of UTC”.
 */
function getTimeZoneOffsetMs(date, timeZone) {
  // We format THIS UTC instant in the target zone and rebuild the timestamp
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const values = {};
  for (const { type, value } of parts) {
    values[type] = value;
  }

  // This is the wall-clock time in that zone, turned back into UTC millis
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  // Offset = “what that zone thinks UTC is” - actual UTC
  return asUTC - date.getTime();
}

/**
 * Given a real Date (now) and a target timezone, return the UTC start/end
 * for THAT calendar day in THAT timezone.
 * This is the correct way to say: “give me today in Europe/Paris as UTC”.
 */
function getUtcRangeForTimezoneDay(realDate, timeZone) {
  // Step 1: figure out what the year/month/day is in that zone right now
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(realDate);

  const year = Number(parts.find(p => p.type === 'year').value);
  const month = Number(parts.find(p => p.type === 'month').value);
  const day = Number(parts.find(p => p.type === 'day').value);

  // Step 2: take that Y-M-D at midnight (as UTC guess)
  const utcGuessMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  // Step 3: find what the offset of that zone is AT that midnight
  const offsetAtMidnight = getTimeZoneOffsetMs(new Date(utcGuessMidnight), timeZone);

  // Step 4: real UTC start = guess - offset
  const startDate = new Date(utcGuessMidnight - offsetAtMidnight);
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000 - 1);

  return { startDate, endDate };
}

/**
 * Return millis since local midnight in a zone for a given UTC instant.
 * Uses the SAME offset logic as above, so plotting and filtering match.
 */
function msSinceMidnightInZone(date, timeZone) {
  // current zone offset at this exact instant
  const offset = getTimeZoneOffsetMs(date, timeZone); // ms
  // convert this UTC instant to “local” ms
  const localTs = date.getTime() + offset;
  // ms in day
  const dayMs = 24 * 60 * 60 * 1000;
  let ms = localTs % dayMs;
  if (ms < 0) ms += dayMs; // just in case
  return ms;
}

// ---------- COMPONENT ----------
const AnalyticsPage = ({ allStationsData, rentalData, onNavigateToDashboard, onLogout, t }) => {
  const [totalRentals, setTotalRentals] = useState(0);
  const [selectedStation, setSelectedStation] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('CA');
  const [timeRange, setTimeRange] = useState('today');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [chartData, setChartData] = useState({ data: [], fetchStartDate: null, fetchEndDate: null });
  const [loading, setLoading] = useState(false);
  const [stationSnapshots, setStationSnapshots] = useState([]);
  const [visibleLines, setVisibleLines] = useState({
    rentals: true,
    returns: true,
    count: true,
    total: true,
    disconnected: true,
  });

  const stationsForDropdown = useMemo(
    () => allStationsData.filter(s => s.info?.country === selectedCountry),
    [allStationsData, selectedCountry]
  );

  // if country changes and current station is not in it, clear it
  useEffect(() => {
    if (selectedStation && !stationsForDropdown.some(s => s.stationid === selectedStation)) {
      setSelectedStation('');
    }
  }, [stationsForDropdown, selectedStation]);

  // New Effect: Fetch snapshots on-demand when a station is selected
  useEffect(() => {
    if (!selectedStation) {
      setStationSnapshots([]);
      return;
    }

    const fetchSnapshotsForStation = async () => {
      setLoading(true);
      try {
        const snapshotsRef = collection(db, 'stations', selectedStation, 'snapshots');
        const snapshotDocs = await getDocs(snapshotsRef);
        const snapshots = snapshotDocs.docs.map(doc => doc.data());
        setStationSnapshots(snapshots);
      } catch (error) {
        console.error(`[Analytics] Failed to fetch snapshots for ${selectedStation}:`, error);
        setStationSnapshots([]);
      }
      // Loading will be set to false in the main data processing effect
    };

    fetchSnapshotsForStation();
  }, [selectedStation]);

  // --- MAIN DATA PIPELINE ---
  useEffect(() => {
    if (!selectedStation || (loading && stationSnapshots.length === 0)) { // Wait for snapshots to load
      setChartData({ data: [], fetchStartDate: null, fetchEndDate: null });
      setTotalRentals(0);
      return;
    }

    setLoading(true);
    const now = new Date();

    // pick correct day (today / yesterday) in *real* time
    const targetDay = timeRange === 'yesterday'
      ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
      : now;

    // this is the key: get the actual UTC window for that zone’s calendar day
    const { startDate, endDate } = getUtcRangeForTimezoneDay(targetDay, timezone);

    // 1) snapshots
    const dailySnapshots = stationSnapshots
      .map(snap => ({ ...snap, timestamp: safeToDate(snap.timestamp) }))
      .filter(snap => snap.timestamp && snap.timestamp >= startDate && snap.timestamp <= endDate)
      .map(snap => ({ ...snap, disconnected: snap.modules }));

    // 2) rentals
    const dailyRentals = rentalData
      .filter(r => r.rentalStationid === selectedStation)
      .map(r => ({ ...r, timestamp: safeToDate(r.rentalTime) }))
      .filter(r => r.timestamp && r.timestamp >= startDate && r.timestamp <= endDate)
      .map(r => ({ timestamp: r.timestamp, rentals: 1, sn: r.sn }));

    // 2b) returns
    const dailyReturns = rentalData
      .filter(r => r.returnStationid === selectedStation && r.returnTime)
      .map(r => ({ ...r, timestamp: safeToDate(r.returnTime) }))
      .filter(r => r.timestamp && r.timestamp >= startDate && r.timestamp <= endDate)
      .map(r => ({ timestamp: r.timestamp, returns: 1, sn: r.sn, rentalPeriod: r.rentalPeriod }));

    setTotalRentals(dailyRentals.length);

    // 3) merge by real timestamp
    const dataMap = new Map();
    [...dailySnapshots, ...dailyRentals, ...dailyReturns].forEach(item => {
      const key = item.timestamp.getTime();
      const existing = dataMap.get(key) || { timestamp: item.timestamp };
      dataMap.set(key, { ...existing, ...item });
    });

    // 4) turn to array and compute x position in that zone
    let merged = Array.from(dataMap.values()).map(item => {
      const x = msSinceMidnightInZone(item.timestamp, timezone);
      return {
        ...item,
        date: x,
        originalTimestamp: item.timestamp.getTime(),
      };
    });

    // 5) sort by what we actually PLOT (this fixes “today values first then yesterday”)
    merged.sort((a, b) => {
      if (a.date === b.date) {
        return a.originalTimestamp - b.originalTimestamp;
      }
      return a.date - b.date;
    });

    // 6) forward-fill so rental dots have counts/totals
    let lastCount = null;
    let lastTotal = null;
    let lastDisc = null;
    const processed = merged.map(item => {
      if (item.count !== undefined) lastCount = item.count;
      if (item.total !== undefined) lastTotal = item.total;
      if (item.disconnected !== undefined) lastDisc = item.disconnected;
      if (item.rentals && item.count === undefined) item.count = lastCount;
      if (item.returns && item.count === undefined) item.count = lastCount;
      if (item.rentals && item.total === undefined) item.total = lastTotal;
      if (item.rentals && item.disconnected === undefined) item.disconnected = lastDisc;
      return item;
    });

    setChartData({ data: processed, fetchStartDate: startDate, fetchEndDate: endDate });
    setLoading(false);
  }, [selectedStation, timeRange, timezone, rentalData, stationSnapshots]); // Depend on local snapshots now

  const handleToggleLine = (line) => {
    setVisibleLines(prev => ({ ...prev, [line]: !prev[line] }));
  };

  // Y range
  const maxCount = useMemo(() => {
    const maxTotal = Math.max(...chartData.data.map(d => d.total || 0), 0);
    return Math.max(maxTotal + 5, 15);
  }, [chartData.data]);

  const memoData = useMemo(() => chartData.data, [chartData.data]);
  const chartKey = `${selectedStation}-${timeRange}-${timezone}`;

  // ensure rental dots always have a y
  const chartDisplayData = useMemo(() => {
    let lastKnownCount = null;
    return memoData.map(d => {
      if (d.count !== undefined) lastKnownCount = d.count;
      return {
        ...d,
        rentalMarker: d.rentals ? (d.count ?? lastKnownCount) : null,
        returnMarker: d.returns ? (d.count ?? lastKnownCount) : null,
      };
    });
  }, [memoData]);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-end items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={onNavigateToDashboard}
              className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300"
              title={t('home')}
            >
              <HomeIcon className="h-6 w-6" />
            </button>
            <button
              onClick={onLogout}
              className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600"
              title={t('logout')}
            >
              <ArrowRightOnRectangleIcon className="h-6 w-6" />
            </button>
          </div>
        </div>
      </header>

      <main className="py-8">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8">
          {/* Filters */}
          <div className="bg-white p-4 rounded-lg shadow-sm flex flex-wrap items-center gap-4 mb-6">
            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('country')}</label>
              <select
                value={selectedCountry}
                onChange={e => setSelectedCountry(e.target.value)}
                className="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md"
              >
                <option value="CA">Canada</option>
                <option value="FR">France</option>
                <option value="US">United States</option>
              </select>
            </div>

            {/* Station */}
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('station')}</label>
              <select
                value={selectedStation}
                onChange={e => setSelectedStation(e.target.value)}
                className="mt-1 block w-full pl-3 pr-10 py-2 border-gray-300 rounded-md"
              >
                <option value="" disabled>{t('select_kiosk')}</option>
                {stationsForDropdown
                  .sort((a, b) => a.stationid.localeCompare(b.stationid))
                  .map(st => (
                    <option key={st.stationid} value={st.stationid}>
                      {st.stationid} - {st.info?.location || ''}
                    </option>
                  ))}
              </select>
            </div>

            {/* Time Range */}
            <div>
              {['yesterday', 'today'].map(r => (
                <button
                  key={r}
                  onClick={() => setTimeRange(r)}
                  className={`px-4 py-2 border text-sm ${
                    timeRange === r ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t(r)}
                </button>
              ))}
            </div>

            {/* Timezone */}
            <div>
              {[
                { label: 'PST', value: 'America/Los_Angeles' },
                { label: 'MST', value: 'America/Denver' },
                { label: 'EST', value: 'America/New_York' },
                { label: 'France', value: 'Europe/Paris' },
              ].map(tz => (
                <button
                  key={tz.value}
                  onClick={() => setTimezone(tz.value)}
                  className={`px-3 py-2 border text-sm ${
                    timezone === tz.value ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tz.label}
                </button>
              ))}
            </div>

            {/* Totals + Toggles */}
            <div className="flex-grow flex justify-end items-center gap-6">
              <div className="text-right">
                <div className="text-sm font-medium text-gray-500">{t('total_rentals')}</div>
                <div className="text-2xl font-bold text-gray-800">{totalRentals}</div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {Object.keys(visibleLines).map(lineKey => (
                  <label key={lineKey} className="inline-flex items-center cursor-pointer">
                    <div
                      className="w-3 h-3 rounded-sm mr-1.5"
                      style={{ backgroundColor: COLORS[lineKey] }}
                    />
                    <input
                      type="checkbox"
                      checked={visibleLines[lineKey]}
                      onChange={() => handleToggleLine(lineKey)}
                    />
                    <span className="ml-2 text-sm capitalize font-medium" style={{ color: COLORS[lineKey] }}>
                      {lineKey}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm h-96">
            {loading ? (
              <div className="flex justify-center items-center h-full">{t('loading_data')}...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                <LineChart key={chartKey} data={chartDisplayData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    type="number"
                    domain={[0, 24 * 60 * 60 * 1000]}
                    ticks={staticTicks}
                    tickFormatter={(tick) => {
                      const hours = Math.floor(tick / (60 * 60 * 1000));
                      const minutes = Math.floor((tick % (60 * 60 * 1000)) / (60 * 1000));
                      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                    }}
                    tick={{ fontSize: 12, fill: '#374151' }}
                    stroke="#9ca3af"
                  />
                  <YAxis
                    yAxisId="left"
                    domain={[0, maxCount]}
                    tick={{ fontSize: 12, fill: '#374151' }}
                    stroke="#9ca3af"
                  />
                  <Tooltip
                    labelFormatter={(label) => {
                      const h = Math.floor(label / (60 * 60 * 1000));
                      const m = Math.floor((label % (60 * 60 * 1000)) / (60 * 1000));
                      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                    }}
                    formatter={(value, name, props) => {
                      if (props.payload) {
                        const { sn, rentalPeriod, originalTimestamp } = props.payload;

                        if (name === 'rentalMarker' && sn) {
                          return [<span style={{ color: COLORS.count, fontWeight: 'bold' }}>{value}</span>, `${t('rental')} (SN: ${sn})`];
                        }
                        if (name === 'returnMarker' && sn) {
                          const duration = rentalPeriod ? ` - ${formatMsDuration(rentalPeriod)}` : '';
                          return [<span style={{ color: COLORS.count, fontWeight: 'bold' }}>{value}</span>, `${t('return')} (SN: ${sn}${duration})`];
                        }
                        // Fallback for other lines like count, total, etc.
                        const formattedTime = new Date(originalTimestamp).toLocaleString('en-US', {
                          timeZone: timezone,
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        });
                        return [value, `${t(name)} (${formattedTime})`];
                      }
                      return [value, t(name)];
                    }}
                    contentStyle={{ fontSize: '13px' }}
                  />
                  {visibleLines.count && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="count"
                      stroke={COLORS.count}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}

                  {visibleLines.total && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="total"
                      stroke={COLORS.total}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}

                  {visibleLines.disconnected && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="disconnected"
                      stroke={COLORS.disconnected}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}

                  {visibleLines.returns && (
                    <Line
                      yAxisId="left"
                      dataKey="returnMarker"
                      stroke="none"
                      dot={{ fill: COLORS.returns, r: 5, strokeWidth: 1, stroke: '#fff' }}
                      activeDot={{ r: 8 }}
                      isAnimationActive={false}
                    />
                  )}

                  {visibleLines.rentals && (
                    <Line
                      yAxisId="left"
                      dataKey="rentalMarker"
                      stroke="none"
                      dot={{ fill: COLORS.rentals, r: 5, strokeWidth: 1, stroke: '#fff' }}
                      activeDot={{ r: 8 }}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default memo(AnalyticsPage);
