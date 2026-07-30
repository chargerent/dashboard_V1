export function usesFullPriceRevenueTotal(gatewayOptions) {
  return String(gatewayOptions || '').trim().toUpperCase() === 'FULLPRICE';
}
