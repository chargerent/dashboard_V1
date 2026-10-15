/* eslint-env node */
const test = require('node:test');
const assert = require('node:assert/strict');
const {createStripeReceiptObserver} = require('./rentalReceipt');
test('local final-card charges are included in the existing signed receipt observation', async () => {
  const intents = {
    pi_original: {id: 'pi_original', amount: 200, amount_received: 200, amount_capturable: 0, currency: 'usd', livemode: false,
      capture_method: 'automatic', status: 'succeeded', latest_charge: {id: 'ch_original', payment_intent: 'pi_original', currency: 'usd', amount: 200, amount_captured: 200, amount_refunded: 0, captured: true, paid: true}},
    pi_final: {id: 'pi_final', amount: 2800, amount_received: 2800, amount_capturable: 0, currency: 'usd', livemode: false,
      metadata: {chargerent_rental: 'pi_original', billing_owner: 'local_station_v1'}, capture_method: 'automatic', status: 'succeeded',
      latest_charge: {id: 'ch_final', payment_intent: 'pi_final', currency: 'usd', amount: 2800, amount_captured: 2800, amount_refunded: 0, captured: true, paid: true}},
  };
  const stripe = {accounts: {retrieve: async () => ({id: 'acct_local'})}, paymentIntents: {retrieve: async id => intents[id]},
    refunds: {list: async () => ({data: [], has_more: false})}};
  const observer = createStripeReceiptObserver({getStripeClientForAccount: async () => stripe});
  const context = {rentalId: 'pi_original', rental: {gateway: 'STRIPE', billingOwner: 'local_station_v1', stripeAccountId: 'acct_local', stripeMode: 'test',
    currency: 'usd', paymentIntentId: 'pi_original', transactionid: 'pi_original', finalPaymentIntentId: 'pi_final'}};
  assert.equal((await observer(context)).finalChargeCents, 3000);
  intents.pi_final.metadata.chargerent_rental = 'pi_somebodyelse';
  assert.equal((await observer(context)).state, 'pending');
});
