/* eslint-env node */
// Isolated US6000 and US8012 commissioning entry point. It has no live Stripe credential.
const admin = require('firebase-admin');
const {onRequest} = require('firebase-functions/v2/https');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {defineSecret} = require('firebase-functions/params');
const Stripe = require('stripe');
const {createLocalStationBackend, createLocalStationHandler} = require('./localStationBackend');
const {createReceiptService, createFirestoreReceiptStore} = require('./rentalReceipt');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const testKey = defineSecret('STRIPE_TEST_SECRET_KEY');
const receiptKey = defineSecret('RENTAL_RECEIPT_SIGNING_KEY');
let stripe;
function getStripeClient({mode, accountCountry}) {
  if (mode !== 'test' || accountCountry !== 'US') throw new Error('Only US Stripe test mode is enabled.');
  if (!stripe) {
    const key = String(testKey.value() || '').trim();
    if (!key.startsWith('sk_test_')) throw new Error('Stripe test credential is not configured.');
    stripe = new Stripe(key, {maxNetworkRetries: 2});
  }
  return stripe;
}
const receiptService = createReceiptService({
  store: createFirestoreReceiptStore(db),
  signingKey: () => receiptKey.value(),
  publicBaseUrl: 'https://chargerentstations.com/media-kiosk',
});
const service = createLocalStationBackend({db, getStripeClient, receiptService,
  allowedStationIds: ['US6000', 'US8012'], allowedStripeModes: ['test']});
exports.localStationApi = onRequest({region: 'us-central1', timeoutSeconds: 60,
  memory: '512MiB', invoker: 'public', secrets: [testKey, receiptKey]}, createLocalStationHandler(service));
exports.localStation_reconcile = onSchedule({region: 'us-central1', schedule: 'every 1 minutes',
  timeoutSeconds: 360, memory: '512MiB', secrets: [testKey]}, async () => {
  const result = await service.tick();
  if (result.failed) console.warn('Local test station settlement needs retry', result);
});
