const FULL_REFUND_STATUSES = new Set(['refunded', 'refund-completed', 'refund_completed']);

function moneyToCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function storedCents(value) {
  if (value === null || value === undefined || value === '') return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function firstMoneyCents(record, keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null && record?.[key] !== '') {
      return moneyToCents(record[key]);
    }
  }
  return 0;
}

export function rentalRevenueBasis(rental = {}) {
  const totalCents = firstMoneyCents(rental, ['totalCharged', 'total', 'amountCharged']);
  const paymentCents = storedCents(rental.paymentAmountCents);
  const subtotalCents = firstMoneyCents(rental, ['subtotal', 'subTotal']);
  const componentCents = firstMoneyCents(rental, ['initialCharge']) +
    firstMoneyCents(rental, ['overageCharge']);
  const taxCents = firstMoneyCents(rental, ['tax', 'taxAmount', 'salesTax']);
  const refundValue = String(rental.refundAmount ?? '').trim().toLowerCase();
  const status = String(rental.refundStatus || rental.status || '').trim().toLowerCase();
  const fullRefund = refundValue === 'full' || FULL_REFUND_STATUSES.has(status);
  const numericRefundCents = fullRefund ? 0 : moneyToCents(rental.refundAmount);
  const refundCompleted = fullRefund || rental.refundCompleted === true ||
    rental.refundProcessed === true || numericRefundCents > 0;
  const documentedGrossCents = Math.max(
    totalCents,
    paymentCents,
    subtotalCents + taxCents,
    componentCents + taxCents,
  );
  let grossCents = documentedGrossCents;
  let refundCents = 0;
  if (fullRefund) {
    refundCents = documentedGrossCents;
  } else if (refundCompleted && numericRefundCents > 0) {
    refundCents = numericRefundCents;
    if ((rental.refundCompleted === true || rental.refundProcessed === true) && paymentCents === 0) {
      grossCents = Math.max(grossCents, totalCents + refundCents);
    }
  }
  refundCents = Math.min(refundCents, grossCents);
  const effectiveTaxCents = Math.min(taxCents, Math.max(0, grossCents - refundCents));
  return {
    gross: grossCents / 100,
    refunds: refundCents / 100,
    taxes: effectiveTaxCents / 100,
    qualifying: Math.max(0, grossCents - refundCents - effectiveTaxCents) / 100,
  };
}
