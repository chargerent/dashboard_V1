/* eslint-env node */
const test = require('node:test');
const assert = require('node:assert/strict');
const {FakeDb: BaseDb} = require('./testsupport/ctf7FakeDb');
class FakeDb extends BaseDb {
  collection(name) { const base = super.collection(name), original = base.where;
    base.where = (field, operator, value) => { if (operator !== '<=') return original(field, operator, value);
      let count = Infinity; return {limit(n) {count = n; return this;}, get: async () => {
        const docs = [...this.rows.keys()].filter(key => key.startsWith(name + '/') && this.rows.get(key)[field] <= value)
          .slice(0, count).map(key => this.snapshot({path: key, id: key.split('/')[1]})); return {docs}; }}; }; return base; }
}
const {createLocalStationBackend, OWNER, verifyPayment} = require('./localStationBackend');
const {prepareExport} = require('./amazonRentalExport');
const {physicalVendProven} = require('./rentalReceipt');
const {createReceiptService} = require('./rentalReceipt');
function fixture(option = 'FULLPRICE', scope = {}) {
  const db = new FakeDb(), calls = [], intents = new Map();
  let clock = Date.parse('2026-10-11T10:00:00Z');
  const installation = {id: 'a'.repeat(64), active: true, stationId: 'US8001', provisionId: 'id-test', moduleId: '1',
    stripeMode: 'test', stripeAccountCountry: 'US', stripeLocationId: 'tml_test', billingOwner: OWNER, checkoutExecution: 'local', hardwareVendor: 'lita'};
  const kiosk = {stationid: 'US8001', hardware: {vendor: 'lita', checkoutExecution: 'local', billingOwner: OWNER,
    gateway: 'STRIPE', gatewayoptions: option, slotsPerBoard: 2, boardCount: 1},
    pricing: {text: 'PURCHASE - SIMPLE DAILY', currency: 'US', initialperiod: 24, overdue: 7,
      authamount: 2, dailyprice: 2, buyprice: 30, rate: [{time: 1440, price: 2}], taxrate: 0},
    modules: [{id: '1', slots: [{position: 1}, {position: 2}]}]};
  db.rows.set('kiosks/id-test', kiosk);
  const stripe = {accounts: {retrieve: async () => ({id: 'acct_test'})}, paymentIntents: {
    retrieve: async pi => structuredClone(intents.get(pi)),
    capture: async (pi, args, key) => { calls.push(['capture', pi, args, key]); intents.get(pi).status = 'succeeded'; intents.get(pi).amount_received = args.amount_to_capture; return structuredClone(intents.get(pi)); },
    cancel: async (pi, args, key) => { calls.push(['cancel', pi, args, key]); intents.get(pi).status = 'canceled'; return structuredClone(intents.get(pi)); },
    create: async (args, key) => { calls.push(['overage', args, key]); const intent = {id: 'pi_final', status: 'succeeded', ...args, livemode: false}; intents.set(intent.id, intent); return intent; },
    search: async () => ({data: [...intents.values()]}),
  }, refunds: {create: async (...args) => { calls.push(['refund', ...args]); return {id: 're_refund', status: 'succeeded'}; }},
    customers: {create: async () => ({id: 'cus_saved'})}, paymentMethods: {retrieve: async () => ({customer: null}), attach: async () => {}},
    terminal: {connectionTokens: {create: async () => ({secret: 'pst_test'})}, locations: {retrieve: async () => ({id: 'tml_test', address: {country: 'US'}, livemode: false, configuration_overrides: 'tmc_test'})}, configurations: {retrieve: async () => ({id: 'tmc_test', livemode: false, offline: {enabled: true}})}}};
  const service = createLocalStationBackend({db, getStripeClient: () => stripe, now: () => clock, ...scope});
  async function event(overrides = {}) {
    const configuration = await service.configuration(installation, kiosk);
    const result = {eventId: 'rental-event-001', transactionId: 'transaction-001', type: 'rental', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
      paymentIntentId: 'pi_paid', pricingVersion: configuration.pricingVersion, chargerId: 'LC001AB', board: 1, slot: 1,
      moduleId: '1', occurredAt: new Date(clock).toISOString(), proof: 'correlated_ack_and_absence', attempts: [{status: 'succeeded'}], ...overrides};
    intents.set(result.paymentIntentId, {id: result.paymentIntentId, amount: option === 'FULLPRICE' ? 3000 : 200, currency: 'usd', livemode: false,
      capture_method: option === 'FULLPRICE' ? 'manual' : 'automatic', status: option === 'FULLPRICE' ? 'requires_capture' : 'succeeded',
      latest_charge: {payment_method_details: {card_present: {generated_card: 'pm_saved', last4: '4242', brand: 'visa'}}},
      metadata: {chargerent_local_transaction: result.transactionId, chargerent_station_id: 'US8001', chargerent_provision_id: 'id-test', chargerent_pricing_version: result.pricingVersion}});
    return result;
  }
  return {db, service, installation, kiosk, stripe, intents, calls, event, advance: ms => { clock += ms; }, clock: () => clock};
}
test('successful local rental writes the existing rental schema without creating or dispatching payment', async () => {
  const f = fixture(), event = await f.event();
  const ack = await f.service.ingest(f.installation, f.kiosk, event);
  assert.equal(ack.ack, event.eventId); assert.deepEqual(f.calls, []);
  const rental = f.db.rows.get('rentals/pi_paid');
  assert.equal(rental.chargerid, 'LC001AB'); assert.equal(rental.billingOwner, OWNER);
  assert.equal(rental.status, 'rented'); assert.equal(physicalVendProven(rental), true);
  assert.equal(prepareExport({rental, rentalId: 'pi_paid', config: {enabled: true, stationIds: ['US8001']}}), null);
});
test('Touch defaults to touchscreen menus and explicit false is bound to the station pricing version for both vendors', async () => {
  for (const vendor of ['lita', 'besiter']) {
    const f = fixture();
    f.kiosk.hardware.vendor = vendor; f.installation.hardwareVendor = vendor;
    if (vendor === 'besiter') {
      f.kiosk.hardware.slotsPerBoard = 4;
      f.kiosk.modules[0].slots = Array.from({length: 4}, (_, i) => ({position: i + 1, sn: '', present: false}));
    }
    const original = await f.service.configuration(f.installation, f.kiosk);
    assert.equal(original.pricing.touch, true);
    f.kiosk.pricing.touch = false;
    const direct = await f.service.configuration(f.installation, f.kiosk);
    assert.equal(direct.pricing.touch, false);
    assert.notEqual(direct.pricingVersion, original.pricingVersion);
    assert.equal(direct.pricing.paymentAmountCents, original.pricing.paymentAmountCents);
    assert.deepEqual(direct.pricing.paymentTerms, original.pricing.paymentTerms);
    f.kiosk.pricing.touch = true;
    assert.equal((await f.service.configuration(f.installation, f.kiosk)).pricing.touch, true);
  }
});
test('a disabled touchscreen cannot turn no-card mode into automatic dispensing', async () => {
  const f = fixture(); f.kiosk.pricing.offline = true; f.kiosk.pricing.touch = false;
  await assert.rejects(f.service.configuration(f.installation, f.kiosk), /Touch to be on/);
});
test('duplicate and concurrent event delivery creates one rental', async () => {
  const f = fixture(), e = await f.event();
  await Promise.all([f.service.ingest(f.installation, f.kiosk, e), f.service.ingest(f.installation, f.kiosk, e)]);
  await f.service.ingest(f.installation, f.kiosk, e);
  assert.equal([...f.db.rows.keys()].filter(k => k.startsWith('rentals/')).length, 1);
});
test('event identity reuse and one payment used for two rentals are rejected', async () => {
  const f = fixture(), e = await f.event(); await f.service.ingest(f.installation, f.kiosk, e);
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, {...e, slot: 2}), /different contents/);
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, {...e, eventId: 'other-event-001'}), /already has a rental/);
});
test('wrong amount/account mode/station/version or unaccepted payment cannot become a rental', async () => {
  for (const change of [{amount: 1}, {livemode: true}, {currency: 'cad'}, {status: 'processing'}, {capture_method: 'automatic'}, {metadata: {}}]) {
    const f = fixture(), e = await f.event(); Object.assign(f.intents.get(e.paymentIntentId), change);
    await assert.rejects(f.service.ingest(f.installation, f.kiosk, e)); assert.equal(f.db.rows.has('rentals/pi_paid'), false);
  }
});
test('a numeric or changed serial and missing physical proof are rejected', async () => {
  const f = fixture(), e = await f.event();
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, {...e, chargerId: 123}));
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, {...e, proof: 'ack_only'}));
});
test('return uploaded before rental remains pending and later settles once, from physical times', async () => {
  const f = fixture(), e = await f.event(); f.advance(600000);
  const returned = {eventId: 'return-event-001', type: 'return', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
    occurredAt: new Date(f.clock()).toISOString(), chargerId: e.chargerId, board: 1, slot: 2};
  await f.service.ingest(f.installation, f.kiosk, returned); await f.service.tick(); assert.deepEqual(f.calls, []);
  await f.service.ingest(f.installation, f.kiosk, e);
  await f.service.tick(); await f.service.tick();
  const rental = f.db.rows.get('rentals/pi_paid');
  assert.equal(rental.returnTime, returned.occurredAt); assert.equal(rental.returnSlotid, 2);
  assert.equal(rental.localSettlement.state, 'completed');
  assert.equal(f.calls.filter(c => c[0] === 'capture').length, 1); assert.equal(f.calls[0][2].amount_to_capture, 200);
});
test('return receipt correlates its exact charger and rental before billing, without another payment', async () => {
  const receiptService = createReceiptService({store: {getRental: async () => null}, signingKey: 'test-return-receipt-signing-key-123456789', publicBaseUrl: 'https://example.test/media-kiosk'});
  const f = fixture('FULLPRICE', {receiptService}), e = await f.event();
  await f.service.ingest(f.installation, f.kiosk, e); f.advance(600000);
  const returned = {eventId: 'return-receipt-001', type: 'return', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
    occurredAt: new Date(f.clock()).toISOString(), chargerId: e.chargerId, board: 1, slot: 2};
  await f.service.ingest(f.installation, f.kiosk, returned);
  const result = await f.service.returnReceipt(f.installation, returned.eventId);
  assert.equal(result.state, 'completed'); assert.equal(result.receipt.transactionId, e.paymentIntentId);
  assert.equal(new URL(result.receipt.receiptUrl).pathname, '/media-kiosk/receipt/pi_paid');
  assert.ok(new URL(result.receipt.receiptUrl).searchParams.get('key'));
  assert.deepEqual(f.calls, []); // Receipt availability does not claim final settlement.
  assert.equal(f.db.rows.get('rentals/pi_paid').returnSlotid, 2);
  assert.deepEqual(await f.service.returnReceipt(f.installation, returned.eventId), result);
  await f.service.tick(); await f.service.tick();
  assert.equal(f.calls.filter(c => c[0] === 'capture').length, 1);
  assert.deepEqual((await f.service.returnReceipt(f.installation, returned.eventId)).receipt, result.receipt);
  await assert.rejects(f.service.returnReceipt({...f.installation, id: 'b'.repeat(64)}, returned.eventId), /not found/);
  await assert.rejects(f.service.returnReceipt(f.installation, e.eventId), /not found/);
});
test('offline return receipt remains pending until its rental arrives and never uses a different Stripe environment', async () => {
  const receiptService = createReceiptService({store: {getRental: async () => null}, signingKey: 'test-return-receipt-signing-key-123456789', publicBaseUrl: 'https://example.test'});
  const f = fixture('FULLPRICE', {receiptService}), e = await f.event(); f.advance(600000);
  const returned = {eventId: 'return-offline-001', type: 'return', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
    occurredAt: new Date(f.clock()).toISOString(), chargerId: e.chargerId, board: 1, slot: 2};
  f.db.rows.set('rentals/pi_live', {billingOwner: OWNER, stripeMode: 'live', stripeAccountCountry: 'US', rentalStationid: 'US8001',
    chargerid: e.chargerId, rentalTime: new Date(f.clock() - 1).toISOString()});
  await f.service.ingest(f.installation, f.kiosk, returned);
  assert.deepEqual(await f.service.returnReceipt(f.installation, returned.eventId), {ack: returned.eventId, state: 'pending', receipt: null});
  await f.service.ingest(f.installation, f.kiosk, e);
  const result = await f.service.returnReceipt(f.installation, returned.eventId);
  assert.equal(result.receipt.transactionId, 'pi_paid');
  assert.equal(f.db.rows.get('rentals/pi_live').returnTime, undefined);
});
test('failed vend cancels the original authorization, but uncertain vend never cancels or re-vends', async () => {
  for (const type of ['failed', 'uncertain']) {
    const f = fixture(), e = await f.event({type}); await f.service.ingest(f.installation, f.kiosk, e);
    await f.service.tick();
    assert.equal(f.calls.length, type === 'failed' ? 1 : 0); assert.equal(f.db.rows.has('rentals/pi_paid'), false);
  }
});
test('failed INITIALPRICE vend refunds through a stable idempotency key', async () => {
  const f = fixture('INITIALPRICE'), e = await f.event({type: 'failed'});
  await f.service.ingest(f.installation, f.kiosk, e); await f.service.tick(); await f.service.tick();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'refund');
});
test('settlement worker cannot touch an Amazon-owned rental', async () => {
  const f = fixture(); f.db.rows.set('rentals/pi_other', {billingOwner: 'amazon_v2', status: 'returned'});
  await f.service.settle('pi_other'); await f.service.tick(); assert.deepEqual(f.calls, []);
});
test('not-returned rental captures the configured purchase amount', async () => {
  const f = fixture(), e = await f.event(); await f.service.ingest(f.installation, f.kiosk, e); f.advance(8 * 86400000);
  await f.service.tick(); assert.equal(f.calls[0][2].amount_to_capture, 3000);
  assert.equal(f.db.rows.get('rentals/pi_paid').status, 'purchased');
});
test('INITIALPRICE overage reuses the generated card and one final-charge idempotency key', async () => {
  const f = fixture('INITIALPRICE'), e = await f.event(); await f.service.ingest(f.installation, f.kiosk, e); f.advance(8 * 86400000);
  await f.service.tick(); await f.service.tick();
  assert.equal(f.calls.filter(c => c[0] === 'overage').length, 1);
  assert.equal(f.calls[0][1].amount, 2800); assert.equal(f.calls[0][1].payment_method, 'pm_saved');
});
test('heartbeat preserves dashboard configuration and does not regress on older observations', async () => {
  const f = fixture(); f.db.rows.get('kiosks/id-test').modules[0].configuration = 'preserved';
  const event = {eventId: 'heartbeat-event-001', type: 'heartbeat', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
    occurredAt: new Date(f.clock()).toISOString(), online: true, modules: [{id: '1', position: 1, slots: [{position: 1, present: true, chargerId: 'LC001AB', batteryLevel: 90}, {position: 2, present: false}]}]};
  await f.service.ingest(f.installation, f.kiosk, event);
  const stored = f.db.rows.get('kiosks/id-test'); assert.equal(stored.modules[0].configuration, 'preserved'); assert.equal(stored.modules[0].slots[0].sn, 'LC001AB');
  await f.service.ingest(f.installation, f.kiosk, {...event, eventId: 'heartbeat-event-002', online: false, occurredAt: new Date(f.clock() - 5000).toISOString()});
  assert.equal(f.db.rows.get('kiosks/id-test').online, true);
});
test('payment metadata contract can be checked independently of SDK return values', () => {
  assert.throws(() => verifyPayment({id: 'pi_test', metadata: {}}, {paymentIntentId: 'pi_test'}, {}, {}));
});

test('expired FULLPRICE authorization uses the saved card once at the configured due date', async () => {
  const f = fixture(), e = await f.event(); await f.service.ingest(f.installation, f.kiosk, e);
  f.intents.get(e.paymentIntentId).status = 'canceled'; f.advance(8 * 86400000); await f.service.tick(); await f.service.tick();
  assert.equal(f.calls.filter(c => c[0] === 'overage').length, 1); assert.equal(f.calls[0][1].amount, 3000);
});
test('a settlement with lost Stripe response stops automated financial retries before the idempotency window expires', async () => {
  const f = fixture(), e = await f.event(); await f.service.ingest(f.installation, f.kiosk, e); f.advance(8 * 86400000);
  f.stripe.paymentIntents.capture = async () => { f.calls.push(['attempt']); throw new Error('timeout'); };
  await f.service.tick(); f.advance(24 * 3600000); await f.service.tick();
  assert.equal(f.calls.length, 1); assert.equal(f.db.rows.get('rentals/pi_paid').localSettlement.state, 'verification_pending');
});
test('remote commands are claimed once and must be completed by the assigned installation', async () => {
  const f = fixture(); const kiosk = f.db.rows.get('kiosks/id-test');
  Object.assign(kiosk, {online: true, localHeartbeatAt: new Date(f.clock()).toISOString()});
  kiosk.modules[0].slots = [{position: 1, chargerId: 'LC001AB', present: true}, {position: 2, present: false}];
  const input = {requestId: 'remote-command-001', stationid: 'US8001', action: 'eject slot', moduleid: '1', slotid: 1};
  const queued = await f.service.commands.queue(input, {isAdmin: true}); assert.equal(queued.targets[0].chargerId, 'LC001AB');
  assert.equal((await f.service.commands.claim(f.installation)).id, input.requestId);
  assert.equal(await f.service.commands.claim(f.installation), null);
  await assert.rejects(f.service.commands.complete({...f.installation, id: 'other'}, input.requestId, {state: 'completed'}));
  await f.service.commands.complete(f.installation, input.requestId, {state: 'completed'});
  assert.equal((await f.service.commands.status(input.requestId, {isAdmin: true})).state, 'completed');
});
test('remote command refuses a customer reservation and stale station heartbeat', async () => {
  const f = fixture(); const kiosk = f.db.rows.get('kiosks/id-test');
  Object.assign(kiosk, {online: true, localHeartbeatAt: new Date(f.clock()).toISOString(), localController: {pending: true}});
  const input = {requestId: 'remote-command-001', stationid: 'US8001', action: 'check'};
  await assert.rejects(f.service.commands.queue(input, {isAdmin: true}), /reserved/); kiosk.localController.pending = false; f.advance(60000);
  await assert.rejects(f.service.commands.queue(input, {isAdmin: true}), /stale/);
});

test('an offline heartbeat without inventory cannot erase the provisioned topology', async () => {
  const f = fixture(); await f.service.ingest(f.installation, f.kiosk, {eventId: 'heartbeat-empty-001', type: 'heartbeat',
    stationId: 'US8001', provisionId: 'id-test', vendor: 'lita', occurredAt: new Date(f.clock()).toISOString(), online: false, modules: []});
  assert.equal(f.db.rows.get('kiosks/id-test').modules[0].slots.length, 2);
  const e = await f.event(); await f.service.ingest(f.installation, f.kiosk, e);
});
test('multiple physical boards keep one dashboard module and map slot positions consistently', async () => {
  const f = fixture(); f.kiosk.hardware.boardCount = 2;
  f.kiosk.modules[0].slots = [1,2,3,4].map(position => ({position}));
  const e = await f.event({board: 2, slot: 1}); await f.service.ingest(f.installation, f.kiosk, e);
  assert.equal(f.db.rows.get('rentals/pi_paid').rentalModuleid, '1');
  assert.equal(f.db.rows.get('rentals/pi_paid').rentalSlotid, 3);
});
test('a verified inspection resolves the uncertain event with a separate immutable audit report', async () => {
  const f = fixture(), e = await f.event({type: 'uncertain'}); await f.service.ingest(f.installation, f.kiosk, e);
  await f.service.ingest(f.installation, f.kiosk, {...e, eventId: 'inspection-event-001', type: 'rental', proof: 'physical_inspection', physicallyVerified: true, resolvesEventId: e.eventId});
  assert.equal(f.db.rows.get('rentals/pi_paid').vendState, 'dispensed');
  const original = [...f.db.rows.values()].find(v => v.event?.eventId === e.eventId);
  assert.equal(original.state, 'resolved');
});

test('local dashboard commands preserve tenant scope and operator permissions', async () => {
  const f = fixture(); const kiosk = f.db.rows.get('kiosks/id-test');
  Object.assign(kiosk, {online: true, localHeartbeatAt: new Date(f.clock()).toISOString(), info: {client: 'VENUE'}});
  const input = {requestId: 'client-command-001', stationid: 'US8001', action: 'check'};
  await assert.rejects(f.service.commands.queue(input, {profile: {clientId: 'OTHER', commands: {update: true}}}), /Not allowed/);
  await assert.rejects(f.service.commands.queue(input, {profile: {clientId: 'VENUE', commands: {}}}), /Not allowed/);
  assert.equal((await f.service.commands.queue(input, {profile: {clientId: 'VENUE', commands: {update: true}}})).state, 'queued');
});

test('a failure or contradictory inspection cannot cancel an already proven rental', async () => {
  const f = fixture(), e = await f.event({type: 'uncertain'}); await f.service.ingest(f.installation, f.kiosk, e);
  await f.service.ingest(f.installation, f.kiosk, {...e, eventId: 'inspection-rented-001', type: 'rental', proof: 'physical_inspection', physicallyVerified: true, resolvesEventId: e.eventId});
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, {...e, eventId: 'late-failed-001', type: 'failed'}), /already has a rental/);
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, {...e, eventId: 'inspection-failed-001', type: 'failed', physicallyVerified: true, resolvesEventId: e.eventId}), /exact uncertain rental/);
  await f.service.tick(); assert.deepEqual(f.calls, []);
});
test('one local transaction cannot acquire two conflicting financial outcomes', async () => {
  const f = fixture(), e = await f.event({type: 'failed'}); await f.service.ingest(f.installation, f.kiosk, e);
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, {...e, eventId: 'duplicate-failed-001'}), /already has a rental/);
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, {...e, eventId: 'late-rental-001', type: 'rental'}), /already has a rental/);
  await f.service.tick(); assert.equal(f.calls.length, 1);
});
test('unknown-payment cleanup cannot refund a payment now owned by a rental', async () => {
  const f = fixture(), e = await f.event({type: 'failed'}); const failed = {...e}; delete failed.paymentIntentId;
  await f.service.ingest(f.installation, f.kiosk, failed);
  f.db.rows.set('rentals/pi_paid', {billingOwner: OWNER}); await f.service.tick();
  assert.deepEqual(f.calls, []);
  assert.equal([...f.db.rows.values()].find(v => v.event?.eventId === e.eventId).state, 'verification_pending');
});
test('a later return waits for the later offline rental rather than disappearing as a duplicate', async () => {
  const f = fixture(), e = await f.event(); await f.service.ingest(f.installation, f.kiosk, e);
  const returned = {eventId: 'return-first-001', type: 'return', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
    occurredAt: new Date(f.clock() + 60000).toISOString(), chargerId: e.chargerId, board: 1, slot: 2};
  await f.service.ingest(f.installation, f.kiosk, returned); await f.service.tick(); f.advance(120000);
  const later = {...returned, eventId: 'return-later-001', occurredAt: new Date(f.clock()).toISOString()};
  await f.service.ingest(f.installation, f.kiosk, later); await f.service.tick();
  assert.equal([...f.db.rows.values()].find(v => v.event?.eventId === later.eventId).state, 'pending');
  const next = await f.event({eventId: 'rental-later-001', transactionId: 'transaction-002', paymentIntentId: 'pi_next', occurredAt: new Date(f.clock() - 30000).toISOString()});
  await f.service.ingest(f.installation, f.kiosk, next); await f.service.tick();
  assert.equal(f.db.rows.get('rentals/pi_next').returnTime, later.occurredAt);
});
test('a delayed on-time return refunds the excess purchase charge for both pricing options', async () => {
  for (const option of ['FULLPRICE', 'INITIALPRICE', 'EXPIRED_FULLPRICE']) {
    const f = fixture(option === 'INITIALPRICE' ? option : 'FULLPRICE'), e = await f.event();
    await f.service.ingest(f.installation, f.kiosk, e);
    const returned = {eventId: 'return-delayed-001', type: 'return', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
      occurredAt: new Date(f.clock() + 600000).toISOString(), chargerId: e.chargerId, board: 1, slot: 2};
    if (option === 'EXPIRED_FULLPRICE') f.intents.get(e.paymentIntentId).status = 'canceled';
    f.advance(8 * 86400000); await f.service.tick(); f.advance(2 * 86400000);
    await f.service.ingest(f.installation, f.kiosk, returned); await f.service.tick(); await f.service.tick();
    const refunds = f.calls.filter(c => c[0] === 'refund');
    assert.equal(refunds.length, 1, option); assert.equal(refunds[0][1].amount, 2800, option);
    assert.equal(f.db.rows.get('rentals/pi_paid').localSettlement.targetCents, 200, option);
  }
});
test('a return arriving during final payment is reconciled without losing that payment identity', async () => {
  const f = fixture('INITIALPRICE'), e = await f.event(); await f.service.ingest(f.installation, f.kiosk, e);
  const create = f.stripe.paymentIntents.create;
  f.stripe.paymentIntents.create = async (...args) => {
    const result = await create(...args);
    await f.service.ingest(f.installation, f.kiosk, {eventId: 'return-during-001', type: 'return', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
      occurredAt: new Date(Date.parse(e.occurredAt) + 600000).toISOString(), chargerId: e.chargerId, board: 1, slot: 2});
    const doc = [...f.db.rows.entries()].find(([, v]) => v.event?.eventId === 'return-during-001');
    await f.service.processReturn({id: doc[0].split('/')[1], ...doc[1]}); return result;
  };
  f.advance(8 * 86400000); await f.service.tick(); await f.service.tick();
  assert.equal(f.calls.filter(c => c[0] === 'overage').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'refund')[0][1].amount, 2800);
  assert.equal(f.db.rows.get('rentals/pi_paid').finalPaymentIntentId, 'pi_final');
});

test('missing heartbeats mark the local station offline without erasing slots or locks', async () => {
  const f = fixture(); f.kiosk.modules[0].slots[1].locked = true;
  await f.service.ingest(f.installation, f.kiosk, {eventId: 'heartbeat-presence-001', type: 'heartbeat', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
    occurredAt: new Date(f.clock()).toISOString(), online: true, modules: [{position: 1, slots: [{position: 1, present: true, chargerId: 'LC001AB', batteryLevel: 90}, {position: 2, present: false}]}]});
  assert.equal(f.db.rows.get('kiosks/id-test').count, 1);
  f.advance(61000); await f.service.tick();
  const kiosk = f.db.rows.get('kiosks/id-test'); assert.equal(kiosk.online, false); assert.equal(kiosk.count, 0);
  assert.equal(kiosk.modules[0].slots[0].sn, 'LC001AB'); assert.equal(kiosk.modules[0].slots[1].locked, true);
});

test('a scoped test backend rejects live installations and other stations before writing pricing or events', async () => {
  const f = fixture('FULLPRICE', {allowedStationIds: ['US8001'], allowedStripeModes: ['test']});
  const e = await f.event();
  for (const change of [{stripeMode: 'live'}, {stationId: 'US8002'}]) {
    const installation = {...f.installation, ...change};
    await assert.rejects(f.service.configuration(installation, f.kiosk), /not enabled/);
    await assert.rejects(f.service.ingest(installation, f.kiosk, e), /not enabled/);
  }
  assert.deepEqual(f.calls, []);
  assert.equal([...f.db.rows.keys()].filter(k => k.startsWith('localStationEvents/')).length, 0);
});
test('the test worker leaves live and other-station rentals, failed reports and presence untouched', async () => {
  for (const change of [{stripeMode: 'live'}, {rentalStationid: 'US8002'}]) {
    const f = fixture('FULLPRICE', {allowedStationIds: ['US8001'], allowedStripeModes: ['test']});
    const e = await f.event();
    await f.service.ingest(f.installation, f.kiosk, e);
    Object.assign(f.db.rows.get('rentals/pi_paid'), change);
    const before = structuredClone(f.db.rows.get('rentals/pi_paid'));
    f.advance(8 * 86400000);
    const stationId = change.rentalStationid || 'US8001';
    f.db.rows.set('localStationEvents/failed-outside', {event: {...e, stationId, type: 'failed'},
      state: 'pending', stripeMode: change.stripeMode || 'test', pricing: {}});
    f.db.rows.set('kiosks/id-other', {stationid: 'US8002', online: true});
    f.db.rows.set('localStationPresence/id-other', {observedAt: e.occurredAt, dueAt: new Date(0)});
    await f.service.tick();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.db.rows.get('rentals/pi_paid'), before);
    assert.equal(f.db.rows.get('localStationEvents/failed-outside').cleanupStartedAt, undefined);
    assert.equal(f.db.rows.get('kiosks/id-other').online, true);
    assert.equal(f.db.rows.has('localStationPresence/id-other'), true);
  }
});

// Free mode must be authorized by the historical server snapshot, never network loss.
function freeFixture() {
  const f = fixture('FULLPRICE', {getStripeClient: () => { throw new Error('Free rental attempted Stripe access'); }});
  f.kiosk.pricing.offline = true;
  f.freeEvent = overrides => f.event({paymentIntentId: undefined, paymentMode: 'offline', ...overrides});
  return f;
}
test('explicit offline boolean yields a zero offer even with no paid rate configured', async () => {
  const f = freeFixture(); delete f.kiosk.pricing.buyprice; delete f.kiosk.pricing.rate;
  const c = await f.service.configuration(f.installation, f.kiosk);
  assert.equal(c.pricing.paymentAmountCents, 0); assert.equal(c.pricing.gatewayOption, 'OFFLINE');
  assert.equal(c.pricing.pricingSnapshot.buyprice, 0);
  for (const flag of [false, undefined, 'true', 1]) {
    const paid = fixture(); paid.kiosk.pricing.offline = flag;
    assert.equal((await paid.service.configuration(paid.installation, paid.kiosk)).pricing.offline, false);
  }
});
test('free rental uploads once after offline flag is turned off and never gets a billing job', async () => {
  const f = freeFixture(), event = await f.freeEvent();
  f.kiosk.pricing.offline = false; await f.service.configuration(f.installation, f.kiosk);
  await Promise.all([f.service.ingest(f.installation, f.kiosk, event), f.service.ingest(f.installation, f.kiosk, event)]);
  await f.service.ingest(f.installation, f.kiosk, event);
  const entries = [...f.db.rows].filter(([key]) => key.startsWith('rentals/'));
  assert.equal(entries.length, 1); const [key, rental] = entries[0];
  assert.ok(key.startsWith('rentals/free_')); assert.equal(rental.amountCents, 0);
  assert.equal(rental.totalCharged, 0); assert.equal(rental.paymentIntentId, null); assert.equal(rental.gateway, 'NONE');
  assert.equal(rental.paymentMode, 'offline'); assert.equal(rental.status, 'rented');
  assert.equal(physicalVendProven(rental), true);
  assert.equal([...f.db.rows.keys()].some(k => k.startsWith('localStationBillingJobs/')), false);
  // Even a mistakenly queued financial job cannot call Stripe or mark it purchased.
  const rentalId = key.slice(8); f.db.rows.set('localStationBillingJobs/' + rentalId, {rentalId, dueAt: new Date(0)});
  f.advance(90 * 86400000); await f.service.tick(); await f.service.settle(rentalId);
  assert.equal(f.db.rows.get(key).status, 'rented'); assert.equal(f.db.rows.has('localStationBillingJobs/' + rentalId), false);
});
test('paid snapshot cannot be bypassed by claiming offline and free snapshots cannot contain a payment', async () => {
  const paid = fixture(), e = await paid.event({paymentIntentId: undefined, paymentMode: 'offline'});
  await assert.rejects(paid.service.ingest(paid.installation, paid.kiosk, e), /requires payment/);
  const f = freeFixture(), free = await f.freeEvent({paymentIntentId: 'pi_bad'});
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, free), /must not contain/);
  const missing = await f.freeEvent({paymentMode: undefined});
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, missing), /must not contain/);
  const badProof = await f.freeEvent({proof: 'ack_only'});
  await assert.rejects(f.service.ingest(f.installation, f.kiosk, badProof), /proof/);
});
test('free return received before its exact rental does not close an older loan and later completes for zero', async () => {
  const f = freeFixture(), first = await f.freeEvent();
  await f.service.ingest(f.installation, f.kiosk, first); f.advance(1000);
  const second = await f.freeEvent({eventId: 'rental-event-002', transactionId: 'transaction-002'}); f.advance(2000);
  const returned = {eventId: 'return-event-free', type: 'return', stationId: 'US8001', provisionId: 'id-test', vendor: 'lita',
    chargerId: second.chargerId, rentalTransactionId: second.transactionId, board: 1, slot: 2, occurredAt: new Date(f.clock()).toISOString()};
  await f.service.ingest(f.installation, f.kiosk, returned); await f.service.tick();
  assert.equal([...f.db.rows.values()].filter(r => r.localTransactionId === first.transactionId)[0].returnTime, undefined);
  await f.service.ingest(f.installation, f.kiosk, second); await f.service.tick(); await f.service.tick();
  const rental = [...f.db.rows.values()].find(r => r.localTransactionId === second.transactionId);
  assert.equal(rental.returnTime, returned.occurredAt); assert.equal(rental.rentalTime, second.occurredAt);
  assert.equal(rental.status, 'returned'); assert.equal(rental.localSettlement.targetCents, 0); assert.equal(rental.totalCharged, 0);
  assert.equal([...f.db.rows.keys()].some(k => k.startsWith('localStationBillingJobs/')), false);
});
test('free failed and uncertain motor outcomes never invoke Stripe cleanup', async () => {
  for (const type of ['failed', 'uncertain']) {
    const f = freeFixture(), e = await f.freeEvent({type});
    await f.service.ingest(f.installation, f.kiosk, e); await f.service.tick(); await f.service.tick();
    const doc = [...f.db.rows.entries()].find(([key]) => key.startsWith('localStationEvents/'))[1];
    assert.equal(doc.state, type === 'failed' ? 'completed' : 'verification_pending');
    assert.equal([...f.db.rows.keys()].some(k => k.startsWith('rentals/')), false);
  }
});

function paidOfflineFixture(option = 'FULLPRICE', scope = {}) {
  const f = fixture(option, scope);
  f.kiosk.pricing.stripeOfflinePayments = true;
  f.offlineEvent = async overrides => {
    const event = await f.event({paymentIntentId: undefined, paymentMode: 'paid', stripeOffline: true, ...overrides});
    f.intents.delete(undefined);
    return event;
  };
  f.forward = (event, status = option === 'FULLPRICE' ? 'requires_capture' : 'succeeded') => {
    f.intents.set('pi_forwarded', {id: 'pi_forwarded', amount: option === 'FULLPRICE' ? 3000 : 200, currency: 'usd', livemode: false,
      capture_method: option === 'FULLPRICE' ? 'manual' : 'automatic', status,
      amount_received: status === 'succeeded' ? 200 : 0,
      metadata: {chargerent_local_transaction: event.transactionId, chargerent_station_id: event.stationId,
        chargerent_provision_id: event.provisionId, chargerent_pricing_version: event.pricingVersion},
      latest_charge: {payment_method_details: {card_present: {generated_card: 'pm_saved', last4: '4242', brand: 'visa', offline: {type: 'deferred'}}}}});
  };
  f.rental = () => [...f.db.rows.entries()].find(([key]) => key.startsWith('rentals/'));
  return f;
}
test('paid offline is opt-in, preserves paid amounts and is separate from free pricing', async () => {
  for (const flag of [undefined, false, 'true', 1]) {
    const f = fixture(); f.kiosk.pricing.stripeOfflinePayments = flag;
    const config = await f.service.configuration(f.installation, f.kiosk);
    assert.equal(config.pricing.stripeOfflinePayments, false);
    const e = await f.event({stripeOffline: true, paymentIntentId: undefined});
    await assert.rejects(f.service.ingest(f.installation, f.kiosk, e), /does not allow/);
  }
  const f = paidOfflineFixture(), config = await f.service.configuration(f.installation, f.kiosk);
  assert.equal(config.pricing.paymentAmountCents, 3000);
  assert.equal(config.pricing.stripeOfflineMaxTransactionCents, 10000);
  assert.equal(config.pricing.stripeOfflineMaxPendingCents, 50000);
  f.kiosk.pricing.offline = true;
  assert.equal((await f.service.configuration(f.installation, f.kiosk)).pricing.stripeOfflinePayments, false);
});
test('offline rental and exact return persist before Stripe forwarding, then capture once with the Stripe ID', async () => {
  const f = paidOfflineFixture(), e = await f.offlineEvent();
  await f.service.ingest(f.installation, f.kiosk, e); await f.service.ingest(f.installation, f.kiosk, e);
  const [key, original] = f.rental();
  assert.ok(key.startsWith('rentals/local_')); assert.equal(original.paymentResolution, 'pending');
  assert.equal(original.paymentIntentId, null); assert.equal(original.gateway, 'STRIPE');
  assert.equal(physicalVendProven(original), true); assert.equal(original.totalCharged, undefined);
  await f.service.tick(); assert.deepEqual(f.calls, []);
  f.advance(600000);
  await f.service.ingest(f.installation, f.kiosk, {eventId: 'offline-return-001', type: 'return', stationId: e.stationId,
    provisionId: e.provisionId, vendor: e.vendor, chargerId: e.chargerId, rentalTransactionId: e.transactionId,
    board: 1, slot: 2, occurredAt: new Date(f.clock()).toISOString()});
  await f.service.tick(); assert.equal(f.db.rows.get(key).status, 'returned');
  assert.equal(f.db.rows.get(key).localSettlement.state, 'awaiting_forwarding'); assert.deepEqual(f.calls, []);
  f.forward(e);
  await f.service.forwardedPayment(f.installation, {transactionId: e.transactionId, paymentIntentId: 'pi_forwarded'});
  await f.service.tick(); await f.service.tick();
  assert.equal(f.db.rows.get(key).localSettlement.state, 'completed');
  assert.equal(f.db.rows.get(key).paymentIntentId, 'pi_forwarded');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'capture'); assert.equal(f.calls[0][1], 'pi_forwarded');
  assert.equal(f.calls[0][2].amount_to_capture, 200);
  assert.equal([...f.db.rows.keys()].filter(k => k.startsWith('rentals/')).length, 1);
});
test('late offline decline preserves physical rental and return without retrying a new payment', async () => {
  const f = paidOfflineFixture(), e = await f.offlineEvent(); await f.service.ingest(f.installation, f.kiosk, e);
  f.forward(e, 'requires_payment_method'); await f.service.tick();
  const [key, rental] = f.rental(); assert.equal(rental.paymentResolution, 'declined');
  assert.equal(rental.localSettlement.state, 'payment_failed'); assert.equal(rental.totalCharged, undefined);
  f.advance(600000);
  await f.service.ingest(f.installation, f.kiosk, {eventId: 'declined-return-001', type: 'return', stationId: e.stationId,
    provisionId: e.provisionId, vendor: e.vendor, chargerId: e.chargerId, rentalTransactionId: e.transactionId,
    board: 1, slot: 2, occurredAt: new Date(f.clock()).toISOString()});
  await f.service.tick(); f.advance(8 * 86400000); await f.service.tick();
  assert.equal(f.db.rows.get(key).status, 'returned'); assert.equal(f.db.rows.get(key).paymentResolution, 'declined');
  assert.equal([...f.db.rows.keys()].some(k => k.startsWith('localStationBillingJobs/')), false);
  assert.deepEqual(f.calls, []);
});
test('turning paid offline off does not invalidate an already collected immutable rental', async () => {
  const f = paidOfflineFixture(), e = await f.offlineEvent();
  f.kiosk.pricing.stripeOfflinePayments = false; await f.service.configuration(f.installation, f.kiosk);
  await f.service.ingest(f.installation, f.kiosk, e); f.forward(e); await f.service.tick();
  assert.equal(f.rental()[1].paymentResolution, 'authorized');
  assert.equal(f.rental()[1].localSettlement.state, 'awaiting_return'); assert.deepEqual(f.calls, []);
});
test('offline forwarding retries delayed upload and enforces exact metadata, amount and account mode', async () => {
  const f = paidOfflineFixture(), e = await f.offlineEvent(); f.forward(e);
  const request = {transactionId: e.transactionId, paymentIntentId: 'pi_forwarded'};
  await assert.rejects(f.service.forwardedPayment(f.installation, request), /observation first/);
  await f.service.ingest(f.installation, f.kiosk, e);
  for (const change of [{amount: 1}, {livemode: true}, {metadata: {chargerent_local_transaction: 'other'}}]) {
    const original = structuredClone(f.intents.get('pi_forwarded')); Object.assign(f.intents.get('pi_forwarded'), change);
    await assert.rejects(f.service.forwardedPayment(f.installation, request), /does not match/);
    assert.equal(f.rental()[1].paymentResolution, 'pending'); f.intents.set('pi_forwarded', original);
  }
  await f.service.forwardedPayment(f.installation, request); await f.service.forwardedPayment(f.installation, request);
  assert.equal(f.rental()[1].paymentResolution, 'authorized'); assert.deepEqual(f.calls, []);
});
test('offline processing and missing intents stay pending; ambiguous payments require inspection', async () => {
  const f = paidOfflineFixture(), e = await f.offlineEvent(); await f.service.ingest(f.installation, f.kiosk, e);
  await f.service.tick(); f.forward(e, 'processing'); f.advance(60000); await f.service.tick();
  assert.equal(f.rental()[1].paymentResolution, 'pending'); assert.deepEqual(f.calls, []);
  f.intents.set('pi_duplicate', {...f.intents.get('pi_forwarded'), id: 'pi_duplicate'});
  // Search ambiguity is tested before an ID has been bound.
  const [key] = f.rental(); f.db.rows.get(key).paymentIntentId = null;
  f.advance(60000); await f.service.tick();
  assert.equal(f.db.rows.get(key).localSettlement.state, 'verification_pending'); assert.deepEqual(f.calls, []);
});
test('offline initial payment still settles overage with the stable local rental identity', async () => {
  const f = paidOfflineFixture('INITIALPRICE'), e = await f.offlineEvent();
  await f.service.ingest(f.installation, f.kiosk, e); f.forward(e); await f.service.tick();
  const [key] = f.rental(); f.advance(8 * 86400000); await f.service.tick(); await f.service.tick();
  assert.equal(f.db.rows.get(key).localSettlement.state, 'completed');
  assert.equal(f.calls.filter(c => c[0] === 'overage').length, 1);
  assert.equal(f.calls[0][1].metadata.chargerent_rental, key.slice(8));
});
test('offline transaction exceeding its authorized price cap cannot become a rental', async () => {
  const f = paidOfflineFixture(); f.kiosk.pricing.stripeOfflineMaxPayment = 20;
  const e = await f.offlineEvent(); await assert.rejects(f.service.ingest(f.installation, f.kiosk, e), /does not allow/);
  assert.equal(f.rental(), undefined);
});
test('offline signed receipts expose pending or declined payment independently of physical return', async () => {
  const {projectReceipt} = require('./rentalReceipt');
  const f = paidOfflineFixture(), e = await f.offlineEvent(); await f.service.ingest(f.installation, f.kiosk, e);
  let [key, rental] = f.rental();
  let receipt = projectReceipt({rental, rentalId: key.slice(8)});
  assert.equal(receipt.payment.state, 'pending'); assert.equal(receipt.payment.collectedOffline, true);
  assert.equal(receipt.payment.finalChargeCents, null);
  f.forward(e, 'requires_payment_method'); await f.service.tick();
  [key, rental] = f.rental(); rental.returnTime = new Date(f.clock()).toISOString(); rental.status = 'returned';
  receipt = projectReceipt({rental, rentalId: key.slice(8)});
  assert.equal(receipt.status, 'returned'); assert.equal(receipt.payment.state, 'declined');
  assert.equal(receipt.payment.finalChargeCents, null);
});

test('failed checkout status follows exact cancellation and stays pending until cleanup completes', async () => {
  const f = fixture(), e = await f.event({type: 'failed', attempts: []});
  await f.service.ingest(f.installation, f.kiosk, e);
  assert.equal((await f.service.failedCheckoutStatus(f.installation, e.eventId)).money, 'pending');
  assert.deepEqual(f.calls, []);
  await f.service.tick();
  assert.deepEqual(await f.service.failedCheckoutStatus(f.installation, e.eventId), {
    ack: e.eventId, transactionId: e.transactionId, state: 'completed', paymentIntentId: e.paymentIntentId, money: 'voided',
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.db.rows.has('rentals/pi_paid'), false);
});
test('failed checkout status requires confirmed full refund and never treats an accepted payment as settled', async () => {
  const f = fixture('INITIALPRICE'), e = await f.event({type: 'failed', attempts: [{status: 'failed'}]});
  await f.service.ingest(f.installation, f.kiosk, e); await f.service.tick();
  assert.equal((await f.service.failedCheckoutStatus(f.installation, e.eventId)).money, 'pending');
  const pi = f.intents.get(e.paymentIntentId); pi.amount_received = 200;
  Object.assign(pi.latest_charge, {refunded: true, amount_refunded: 100});
  assert.equal((await f.service.failedCheckoutStatus(f.installation, e.eventId)).money, 'pending');
  pi.latest_charge.amount_refunded = 200;
  assert.equal((await f.service.failedCheckoutStatus(f.installation, e.eventId)).money, 'refunded');
  assert.equal(f.calls.length, 1);
});
test('failed checkout status cannot cross installation, station, mode, event type, or payment metadata', async () => {
  const f = fixture(), e = await f.event({type: 'failed', attempts: []});
  await f.service.ingest(f.installation, f.kiosk, e); await f.service.tick();
  for (const patch of [{id: 'b'.repeat(64)}, {stationId: 'USOTHER'}, {provisionId: 'id-other'}, {stripeMode: 'live'}, {stripeAccountCountry: 'CA'}])
    await assert.rejects(f.service.failedCheckoutStatus({...f.installation, ...patch}, e.eventId));
  await assert.rejects(f.service.failedCheckoutStatus(f.installation, 'missing-event'));
  f.intents.get(e.paymentIntentId).metadata.chargerent_local_transaction = 'another-transaction';
  await assert.rejects(f.service.failedCheckoutStatus(f.installation, e.eventId), /does not match/);
  const rental = fixture(), re = await rental.event(); await rental.service.ingest(rental.installation, rental.kiosk, re);
  await assert.rejects(rental.service.failedCheckoutStatus(rental.installation, re.eventId));
});
test('failed checkout status never unlocks an ambiguous motor attempt, deferred card, or payment owned by a rental', async () => {
  for (const status of ['pending', 'uncertain', 'succeeded']) {
    const f = fixture(), e = await f.event({type: 'failed', attempts: [{status}]});
    await f.service.ingest(f.installation, f.kiosk, e); await f.service.tick();
    assert.equal((await f.service.failedCheckoutStatus(f.installation, e.eventId)).money, 'pending');
  }
  const f = fixture(), e = await f.event({type: 'failed', attempts: []});
  await f.service.ingest(f.installation, f.kiosk, e); await f.service.tick();
  f.db.rows.set('rentals/pi_paid', {paymentIntentId: e.paymentIntentId});
  assert.equal((await f.service.failedCheckoutStatus(f.installation, e.eventId)).money, 'pending');
});
