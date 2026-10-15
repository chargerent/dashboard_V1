/* eslint-env node */
const STATION_BRANDS = Object.freeze(['chargerent', 'eventcharging', 'chargedrops']);
function normalizeStationBrand(value) {
  const key = value == null || value === '' ? 'chargerent' : String(value).trim().toLowerCase();
  if (!STATION_BRANDS.includes(key)) throw new Error('Choose Chargerent, Event Charging or ChargeDrops as the station brand.');
  return key;
}
module.exports = {STATION_BRANDS, normalizeStationBrand};
