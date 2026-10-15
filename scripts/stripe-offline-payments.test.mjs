import test from 'node:test';
import assert from 'node:assert/strict';
import {stripeOfflineRefundId,stripeOfflineAmountPending} from '../src/utils/stripeOfflinePayments.js';
test('pending or declined offline card approval never exposes a refundable payment or zero final amount',()=>{
 for(const paymentResolution of ['pending','declined']){
  const rental={stripeOffline:true,paymentResolution,paymentIntentId:'pi_forwarded',orderid:'local_stable',localSettlement:{state:'awaiting_forwarding'}};
  assert.equal(stripeOfflineRefundId(rental),'');assert.equal(stripeOfflineAmountPending(rental),true);
 }
});
test('an offline rental uses its actual Stripe payment for refund after capture rather than its local rental ID',()=>{
 assert.equal(stripeOfflineRefundId({stripeOffline:true,paymentResolution:'captured',paymentIntentId:'pi_forwarded',orderid:'local_stable'}),'pi_forwarded');
 assert.equal(stripeOfflineRefundId({stripeOffline:true,paymentResolution:'authorized',paymentIntentId:'pi_forwarded',localSettlement:{state:'completed',targetCents:200}}),'pi_forwarded');
 assert.equal(stripeOfflineRefundId({stripeOffline:true,paymentResolution:'authorized',paymentIntentId:'pi_forwarded',localSettlement:{state:'completed',targetCents:0}}),'');
 assert.equal(stripeOfflineRefundId({stripeOffline:true,paymentResolution:'authorized',paymentIntentId:'pi_forwarded'}),'');
});
test('completed offline settlement has a final amount while other gateways keep their existing display',()=>{
 assert.equal(stripeOfflineAmountPending({stripeOffline:true,localSettlement:{state:'completed'}}),false);
 assert.equal(stripeOfflineAmountPending({gateway:'PAYTER'}),false);
});
