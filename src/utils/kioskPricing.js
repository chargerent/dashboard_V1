// Event Simple uses the same elapsed 24-hour free tier and later daily rates
// as Lease Simple Daily. End-of-day wording is handled by the display layer.
export const calculateRateArray = (pricing) => {
    const pricingstyle = pricing.text;
    const initialprice = Number(pricing.authamount || 0);
    const initialperiod = Number(pricing.initialperiod || 0); // in hours
    const dailyprice = Number(pricing.dailyprice || 0);
    const overdueby = Number(pricing.overdue || 0); // in days

    const rentprice = [];
    const DAY_IN_MINUTES = 1440; // 24 * 60

    switch (pricingstyle) {
        case "PURCHASE - SIMPLE DAILY":
            for (let i = 1; i <= overdueby; i++) {
                rentprice.push({ time: i * DAY_IN_MINUTES, price: i * dailyprice });
            }
            break;
        case "PURCHASE - MIXED DAILY":
            rentprice.push({ time: initialperiod * 60, price: initialprice });
            for (let i = 1; i <= overdueby; i++) {
                rentprice.push({ time: i * DAY_IN_MINUTES, price: i * dailyprice });
            }
            break;
        case "PURCHASE SIMPLE 24 HRS":
            rentprice.push({ time: DAY_IN_MINUTES, price: dailyprice });
            break;
        case "PURCHASE - MIXED DAY":
            rentprice.push({ time: initialperiod * 60, price: initialprice });
            rentprice.push({ time: DAY_IN_MINUTES, price: dailyprice });
            break;
        case "EVENT - SIMPLE":
        case "LEASE - SIMPLE DAILY":
            rentprice.push({ time: DAY_IN_MINUTES, price: 0 });
            for (let i = 1; i < overdueby; i++) {
                rentprice.push({ time: (i + 1) * DAY_IN_MINUTES, price: i * dailyprice });
            }
            break;
        case "LEASE - MIXED DAILY":
            rentprice.push({ time: initialperiod * 60, price: 0 });
            for (let i = 1; i <= overdueby; i++) {
                rentprice.push({ time: i * DAY_IN_MINUTES, price: i * dailyprice });
            }
            break;
    }
    return rentprice;
};
