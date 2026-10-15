export const stripeOfflineRefundId = rental => {
    if (rental?.stripeOffline !== true || rental.paymentResolution === 'declined' || rental.paymentResolution === 'pending') return '';
    const charged = rental.paymentResolution === 'captured' || rental.localSettlement?.state === 'completed' && rental.localSettlement.targetCents > 0;
    return charged && /^pi_[A-Za-z0-9]+$/.test(rental.paymentIntentId || '') ? rental.paymentIntentId : '';
};

export const stripeOfflineAmountPending = rental => rental?.stripeOffline === true && rental.localSettlement?.state !== 'completed';
