export const STATION_BRANDS = Object.freeze([
  {value: 'chargerent', label: 'Chargerent', logo: 'chargerent-wordmark.png'},
  {value: 'eventcharging', label: 'Event Charging', logo: 'eventcharging-logo.svg'},
  {value: 'chargedrops', label: 'ChargeDrops', logo: 'chargedrops-logo.svg'},
]);

export function stationBrand(value) {
  const key = value == null || value === '' ? 'chargerent' : String(value).trim().toLowerCase();
  const brand = STATION_BRANDS.find(candidate => candidate.value === key);
  if (!brand) throw new Error('Choose Chargerent, Event Charging or ChargeDrops as the station brand.');
  return brand;
}
