/* eslint-env node */
// The station owns checkout and the motor. This service only accepts durable
// observations, projects them into the existing dashboard DB, and owns billing.
const crypto = require('node:crypto');
const {createFirestoreKioskTerminalStore, resolveKioskOffer, validateInstallation,
  tokenHash, KioskTerminalError, normalizeKioskCurrency, terminalPaymentCurrency} = require('./kioskTerminal');
const {returnCharge, millis} = require('./ctf7Rental');
const {normalizeStationBrand} = require('./stationBrand');
const {offlinePolicy, enableLocationOffline} = require('./localStationOfflinePayments');
const OWNER = 'local_station_v1';
const fail = (status, code, message) => { throw new KioskTerminalError(status, code, message); };
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = value => { if (!/^[A-Za-z0-9_-]{8,120}$/.test(value || '')) fail(400, 'id', 'Invalid event identity.'); return value; };
const serial = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail(400, 'serial', 'A string charger serial is required.'); return value; };
const put = (db, ref, data) => db.runTransaction(async tx => { tx.set(ref, data); });
function localHardware(kiosk) {
  const hardware = kiosk?.hardware || {};
  const vendor = hardware.vendor || 'besiter';
  if (!['lita', 'besiter'].includes(vendor) || hardware.checkoutExecution !== 'local' || hardware.billingOwner !== OWNER) {
    fail(409, 'execution-owner', 'This station is not provisioned for local checkout and billing.');
  }
  const moduleSlots = kiosk.modules?.[0]?.slots?.length || 0;
  const boardCount = Number(hardware.boardCount || (vendor === 'besiter' ? Math.max(1, Math.ceil(moduleSlots / 4)) : 1));
  const slotsPerBoard = Number(hardware.slotsPerBoard || (vendor === 'besiter' ? 4 : moduleSlots || 12));
  const serialPort = hardware.serialPort || (vendor === 'lita' ? '/dev/ttyS1' : '/dev/ttySMT7');
  if (!Number.isInteger(boardCount) || boardCount < 1 || boardCount > 12 || !Number.isInteger(slotsPerBoard) || slotsPerBoard < 1 || slotsPerBoard > 48 ||
    (vendor === 'besiter' && slotsPerBoard !== 4) || !(vendor === 'lita' ? ['/dev/ttyS1', '/dev/ttyS0'] : ['/dev/ttySMT7', '/dev/ttyS7']).includes(serialPort)) fail(409, 'topology', 'Invalid local hardware topology.');
  return {vendor, serialPort: serialPort, boardCount, slotsPerBoard,
    minimumBattery: Number(hardware.power ?? 80)};
}
function localTopology(kiosk, installation) {
  const hardware = localHardware(kiosk), modules = kiosk.modules || [];
  const firstSlots = modules[0]?.slots?.length;
  const aggregate = modules.length === 1 && firstSlots === hardware.boardCount * hardware.slotsPerBoard;
  if (!aggregate && (modules.length !== hardware.boardCount || modules.some(m => m.slots?.length !== hardware.slotsPerBoard))) {
    fail(409, 'topology', 'Verify the cabinet boards and slot counts before local checkout.');
  }
  if (modules.some(m => m.slots.some((s, i) => Number(s.position) !== i + 1))) fail(409, 'topology', 'Dashboard slots must have consecutive positions.');
  return {aggregate, moduleIds: Array.from({length: hardware.boardCount}, (_, i) => { const m = aggregate ? modules[0] : modules[i]; return String(m?.id || m?.moduleid || m?.moduleId || installation.moduleId); }),
    slotOffsets: Array.from({length: hardware.boardCount}, (_, i) => aggregate ? i * hardware.slotsPerBoard : 0)};
}
function verifyPayment(intent, event, pricing, installation) {
  const m = intent?.metadata || {};
  if (intent?.id !== event.paymentIntentId || m.chargerent_local_transaction !== event.transactionId ||
    m.chargerent_station_id !== installation.stationId || m.chargerent_provision_id !== installation.provisionId ||
    m.chargerent_pricing_version !== event.pricingVersion || intent.amount !== pricing.paymentAmountCents ||
    intent.currency !== pricing.currency || intent.livemode !== (installation.stripeMode === 'live') ||
    intent.capture_method !== (pricing.gatewayOption === 'FULLPRICE' ? 'manual' : 'automatic')) {
    fail(409, 'payment-mismatch', 'Stripe payment does not match the station transaction.');
  }
  if (event.type === 'rental' && intent.status !== (pricing.gatewayOption === 'FULLPRICE' ? 'requires_capture' : 'succeeded')) {
    fail(409, 'payment-state', 'Stripe has not accepted this payment.');
  }
}
// Only a server-issued immutable pricing snapshot may authorize a free rental.
function resolveLocalOffer(installation, kiosk) {
  const touch = kiosk.pricing?.touch !== false;
  if (kiosk.pricing?.offline !== true) return {...resolveKioskOffer(installation, kiosk), ...offlinePolicy(kiosk.pricing), touch, offline: false, paymentMode: 'paid'};
  if (!touch) fail(409, 'touch-required', 'No-card rental mode requires Touch to be on.');
  const configuredCurrency = normalizeKioskCurrency(kiosk.pricing.currency);
  const currency = terminalPaymentCurrency(installation, configuredCurrency);
  const pricingSnapshot = {...kiosk.pricing, offline: true, paymentMode: 'offline',
    currency: currency.toUpperCase(), authamount: 0, dailyprice: 0, buyprice: 0, leaseamount: 0,
    taxrate: 0, rate: [{time: 1440, price: 0}]};
  delete pricingSnapshot.valid;
  return {stationId: installation.stationId, source: 'kiosk', touch, offline: true, paymentMode: 'offline', stripeOfflinePayments: false,
    planCode: 'EVENT_SIMPLE', planLabel: 'Payment-free rental', gatewayOption: 'OFFLINE',
    currency, configuredCurrency, kioskCurrency: currency.toUpperCase(), symbol: kiosk.pricing.symbol || '',
    paymentAmountCents: 0, paymentAmount: '0.00', depositAmountCents: null,
    initialAmountCents: 0, dailyPriceCents: 0, buyPriceCents: 0, initialPeriodHours: 0, overdueDays: 0,
    pricingSnapshot, pricingLines: ['Free charger rental', 'Return the charger to an available slot.'], paymentTerms: []};
}
const paymentFree = pricing => pricing?.offline === true && pricing?.paymentMode === 'offline';
const freeRental = rental => rental?.paymentMode === 'offline';
const zeroSettlement = at => ({state: 'completed', targetCents: 0, paymentRequired: false, completedAt: at});
function createLocalStationBackend({db, getStripeClient, receiptService = null, now = Date.now,
  allowedStationIds = null, allowedStripeModes = null}) {
  const stationAllowed = stationId => allowedStationIds === null || allowedStationIds.includes(stationId);
  const scopeAllowed = (stationId, mode) => stationAllowed(stationId) &&
    (allowedStripeModes === null || allowedStripeModes.includes(mode));
  const assertScope = installation => {
    if (!scopeAllowed(installation.stationId, installation.stripeMode)) {
      fail(403, 'deployment-scope', 'This station or payment mode is not enabled on this backend.');
    }
  };
  const installations = createFirestoreKioskTerminalStore(db);
  const commands = require('./localStationCommands').createLocalStationCommands({db, now});
  const events = db.collection('localStationEvents');
  const rentals = db.collection('rentals');
  const jobs = db.collection('localStationBillingJobs');
  const presence = db.collection('localStationPresence');
  const accounts = new Map();
  const offlineLocations = new Map();
  async function account(installation) {
    const key = `${installation.stripeAccountCountry}:${installation.stripeMode}`;
    if (!accounts.has(key)) { const value = await stripe(installation).accounts.retrieve();
      if (!/^acct_[A-Za-z0-9]+$/.test(value.id || '')) throw new Error('Stripe account identity unavailable');
      accounts.set(key, value.id); }
    return accounts.get(key);
  }
  const stripe = value => getStripeClient({mode: value.stripeMode, accountCountry: value.stripeAccountCountry});
  async function authorize(req) {
    const token = /^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(req.headers?.authorization || '')?.[1];
    if (!token) fail(401, 'unauthorized', 'A station installation token is required.');
    const installation = await installations.getInstallation(tokenHash(token));
    validateInstallation(installation);
    assertScope(installation);
    if (req.headers?.['x-chargerent-station'] !== installation.stationId) fail(403, 'station', 'Wrong station.');
    await installations.assertInstallationAuthority(installation);
    // Do not rely on the terminal's cached selection for routing or billing.
    const kiosk = await installations.verifyKiosk(installation);
    localHardware(kiosk);
    if (installation.billingOwner !== OWNER || installation.checkoutExecution !== 'local' || installation.hardwareVendor !== kiosk.hardware.vendor) {
      fail(409, 'reprovision', 'Reprovision the terminal for the new station execution mode.');
    }
    return {installation, kiosk};
  }
  async function configuration(installation, kiosk) {
    assertScope(installation);
    if (kiosk.enabled === false || kiosk.disabled === true) fail(409, 'disabled', 'This station is disabled for new rentals.');
    const pricing = resolveLocalOffer(installation, kiosk);
    // Validate the immutable rate table before accepting paid rentals.
    if (!paymentFree(pricing)) returnCharge(pricing.pricingSnapshot, 1);
    if (pricing.stripeOfflinePayments) {
      const key = `${installation.stripeAccountCountry}:${installation.stripeMode}:${installation.stripeLocationId}`;
      if ((offlineLocations.get(key) || 0) <= now()) {
        await enableLocationOffline(stripe(installation), installation);
        offlineLocations.set(key, now() + 300000);
      }
    }
    const topology = localTopology(kiosk, installation);
    const pricingVersion = hash({pricing, topology, installationId: installation.id});
    await put(db, db.collection('localStationPricing').doc(pricingVersion), {pricing,
      installationId: installation.id, stationId: installation.stationId, provisionId: installation.provisionId, topology});
    return {stationId: installation.stationId, provisionId: installation.provisionId,
      stationBrand: normalizeStationBrand(kiosk.stationBrand),
      pricing, pricingVersion, hardware: localHardware(kiosk), billingOwner: OWNER, topology,
      slotPolicy: (kiosk.modules || []).flatMap((module, index) => (module.slots || []).map(slot => ({board: topology.aggregate ? Math.floor((Number(slot.position) - 1) / localHardware(kiosk).slotsPerBoard) + 1 : index + 1,
        slot: topology.aggregate ? (Number(slot.position) - 1) % localHardware(kiosk).slotsPerBoard + 1 : Number(slot.position), locked: Boolean(slot.locked || slot.lock || slot.abnormal || slot.quarantined)})))};
  }
  async function ingest(installation, kiosk, input) {
    assertScope(installation);
    const event = {...input};
    id(event.eventId); id(event.transactionId || event.eventId);
    if (['rental', 'failed', 'uncertain'].includes(event.type)) id(event.transactionId);
    if (event.rentalTransactionId) id(event.rentalTransactionId);
    if (!['rental', 'return', 'failed', 'uncertain', 'heartbeat'].includes(event.type)) fail(400, 'type', 'Invalid station event.');
    const at = millis(event.occurredAt);
    if (!at || at > now() + 120000) fail(400, 'clock', 'Invalid event time; check the station clock.');
    if (event.stationId !== installation.stationId || event.provisionId !== installation.provisionId || event.vendor !== kiosk.hardware.vendor) {
      fail(403, 'identity', 'Station event identity has changed.');
    }
    if (Buffer.byteLength(JSON.stringify(event)) > 65536) fail(413, 'size', 'Station event is too large.');
    const eventRef = events.doc(hash({installationId: installation.id, eventId: event.eventId}));
    const fingerprint = hash(event);
    const previous = (await eventRef.get()).data();
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail(409, 'event-reused', 'The event ID has different contents.');
      if (event.type === 'heartbeat') await heartbeat(installation, kiosk, event);
      return {ack: event.eventId, state: previous.state, receipt: previous.receipt || null};
    }
    if (event.type === 'heartbeat' && (!Array.isArray(event.modules) || event.modules.length > localHardware(kiosk).boardCount || event.modules.some(m => !Array.isArray(m.slots) || m.slots.length > localHardware(kiosk).slotsPerBoard))) fail(400, 'inventory', 'Invalid inventory.');
    let pricing, intent;
    let topology = localTopology(kiosk, installation);
    if (event.type === 'return' && (!Number.isInteger(event.board) || event.board < 1 || event.board > localHardware(kiosk).boardCount || !Number.isInteger(event.slot) || event.slot < 1 || event.slot > localHardware(kiosk).slotsPerBoard)) fail(400, 'slot', 'Invalid returned slot.');
    if (event.type !== 'heartbeat') serial(event.chargerId || (['failed', 'uncertain'].includes(event.type) ? 'unknown' : null));
    if (['rental', 'failed', 'uncertain'].includes(event.type)) {
      const snapshot = (await db.collection('localStationPricing').doc(id(event.pricingVersion)).get()).data();
      if (!snapshot || snapshot.installationId !== installation.id) fail(409, 'pricing', 'Unknown pricing snapshot.');
      pricing = snapshot.pricing; topology = snapshot.topology;
      const free = paymentFree(pricing);
      if (event.stripeOffline === true && (free || pricing.stripeOfflinePayments !== true || pricing.paymentAmountCents > pricing.stripeOfflineMaxTransactionCents)) fail(409, 'offline-payment-disabled', 'This snapshot does not allow offline card payments.');
      if (free && (event.paymentMode !== 'offline' || event.paymentIntentId)) fail(409, 'payment-mode', 'Payment-free rentals must not contain a Stripe payment.');
      if (!free && event.paymentMode && event.paymentMode !== 'paid') fail(409, 'payment-mode', 'This pricing snapshot requires payment.');
      if (event.paymentIntentId) {
        if (!/^pi_[A-Za-z0-9]+$/.test(event.paymentIntentId)) fail(400, 'payment', 'Invalid payment identity.');
        intent = await stripe(installation).paymentIntents.retrieve(event.paymentIntentId, {expand: ['latest_charge']});
        verifyPayment(intent, event.stripeOffline === true ? {...event, type: 'deferred'} : event, pricing, installation);
      } else if (event.type === 'rental' && !free && event.stripeOffline !== true) fail(400, 'payment', 'A successful rental requires a Stripe payment.');
      if (event.type === 'rental' && ((!['correlated_ack_and_absence', 'physical_inspection'].includes(event.proof) || (event.proof === 'physical_inspection' && (!event.resolvesEventId || event.physicallyVerified !== true))) || !Number.isInteger(event.slot) || event.slot < 1 ||
        !Number.isInteger(event.board) || event.board < 1 || event.board > localHardware(kiosk).boardCount ||
        event.slot > localHardware(kiosk).slotsPerBoard || !Array.isArray(event.attempts) || !event.attempts.length)) {
        fail(400, 'vend-proof', 'A correlated release and fresh inventory proof are required.');
      }
    }
    const free = paymentFree(pricing);
    const rentalId = event.type === 'rental' ? (free ? `free_${hash({installationId: installation.id, transactionId: event.transactionId})}` : event.stripeOffline === true ? `local_${hash({installationId: installation.id, transactionId: event.transactionId})}` : intent.id) : null;
    const stripeAccountId = !free && pricing ? await account(installation) : null;
    const charge = typeof intent?.latest_charge === 'object' ? intent.latest_charge : null;
    const receipt = event.type === 'rental' && receiptService ? receiptService.link({rentalId, rental: {status: 'rented', transactionid: rentalId,
      rentalModuleid: topology.moduleIds[event.board - 1], rentalSlotid: topology.slotOffsets[event.board - 1] + event.slot, chargerid: event.chargerId,
      rentalEvents: [{eventtype: 'vend_succeeded', occurredat: event.occurredAt}]}}) : null;
    await db.runTransaction(async tx => {
      const old = (await tx.get(eventRef)).data();
      const rentalRef = rentalId ? rentals.doc(rentalId) : null;
      const existing = rentalRef ? (await tx.get(rentalRef)).data() : null;
      const txnRef = db.collection('localStationTransactions').doc(hash({installationId: installation.id, transactionId: event.transactionId || event.eventId}));
      const checkoutEvent = ['rental', 'failed', 'uncertain'].includes(event.type);
      const txn = checkoutEvent ? (await tx.get(txnRef)).data() : null;
      const resolutionRef = event.resolvesEventId ? events.doc(hash({installationId: installation.id, eventId: event.resolvesEventId})) : null;
      const unresolved = resolutionRef ? (await tx.get(resolutionRef)).data() : null;
      if (old) { if (old.fingerprint !== fingerprint) fail(409, 'event-reused', 'The event ID has different contents.'); return; }
      if (resolutionRef && (!unresolved || unresolved.state !== 'verification_pending' || txn?.state !== 'uncertain' || txn.eventId !== event.resolvesEventId || unresolved.event.type !== 'uncertain' || unresolved.event.transactionId !== event.transactionId ||
        !['rental', 'failed'].includes(event.type) || event.physicallyVerified !== true)) fail(409, 'resolution', 'Inspection must resolve this exact uncertain rental.');
      if (checkoutEvent && (existing || (txn && !resolutionRef))) fail(409, 'rental-reused', 'This payment or transaction already has a rental outcome.');
      if (checkoutEvent) tx.set(txnRef, {state: event.type, eventId: event.eventId, rentalId: rentalId || null});
      if (event.type === 'rental') {
        if (!free) tx.create(jobs.doc(rentalId), {rentalId, dueAt: new Date(event.stripeOffline === true ? now() : at + pricing.overdueDays * 86400000)});
        tx.create(rentalRef, {paymentIntentId: intent?.id || null, transactionid: rentalId, orderid: rentalId,
          paymentMode: free ? 'offline' : 'paid', offline: free, paymentRequired: !free,
          stripeOffline: event.stripeOffline === true, paymentResolution: event.stripeOffline === true ? 'pending' : free ? 'not_required' : pricing.gatewayOption === 'FULLPRICE' ? 'authorized' : 'captured',
          localTransactionId: event.transactionId, installationId: installation.id, billingOwner: OWNER,
          transport: event.vendor, gateway: free ? 'NONE' : 'STRIPE', gatewayoptions: pricing.gatewayOption,
          stripeMode: installation.stripeMode, stripeAccountCountry: installation.stripeAccountCountry, stripeAccountId,
          pricingVersion: event.pricingVersion,
          chargerid: event.chargerId, sn: event.chargerId, rentalStationid: installation.stationId,
          rentalProvisionid: installation.provisionId, rentalModuleid: topology.moduleIds[event.board - 1],
          rentalSlotid: topology.slotOffsets[event.board - 1] + event.slot, rentalTime: event.occurredAt, pricing: pricing.pricingSnapshot,
          pricingSnapshot: pricing.pricingSnapshot, currency: pricing.currency, symbol: pricing.symbol,
          amountCents: pricing.paymentAmountCents, status: 'rented', vendState: 'dispensed',
          vendConfirmationSource: 'local_correlated_ack_and_absence', vendAttempts: event.attempts,
          rentalEvents: [{eventtype: 'vend_succeeded', occurredat: event.occurredAt, moduleid: topology.moduleIds[event.board - 1],
            slotnumber: topology.slotOffsets[event.board - 1] + event.slot, chargerid: event.chargerId}], paymentAmountCents: pricing.paymentAmountCents,
          card_last4: charge?.payment_method_details?.card_present?.last4 || '',
          card_type: charge?.payment_method_details?.card_present?.brand || '',
          reusablePaymentMethod: charge?.payment_method_details?.card_present?.generated_card || null,
          customerId: typeof intent?.customer === 'string' ? intent.customer : intent?.customer?.id || null,
          ...(free ? {totalCharged: 0, totalRefunded: 0, paymentResolution: 'not_required',
            paymentSettlement: {status: 'completed', finalChargeCents: 0, refundCents: 0, releasedCents: 0, settledAt: new Date(now()).toISOString()}} : {}),
          localSettlement: free ? zeroSettlement(new Date(now()).toISOString()) : {state: event.stripeOffline === true ? 'awaiting_forwarding' : 'awaiting_return'}, createdAt: new Date(now()).toISOString()});
      }
      if (resolutionRef) tx.set(resolutionRef, {...unresolved, state: 'resolved', resolutionEventId: event.eventId});
      tx.create(eventRef, {event, fingerprint, installationId: installation.id, stripeMode: installation.stripeMode,
        stripeAccountCountry: installation.stripeAccountCountry, pricing: pricing || null,
        state: event.type === 'uncertain' ? 'verification_pending' : event.type === 'rental' || event.type === 'heartbeat' || free && event.type === 'failed' ? 'completed' : 'pending', receipt,
        returnModuleId: event.type === 'return' ? topology.moduleIds[event.board - 1] || '' : null,
        returnSlotId: event.type === 'return' ? (topology.slotOffsets[event.board - 1] || 0) + event.slot : null,
        receivedAt: new Date(now()).toISOString()});
    });
    if (event.type === 'heartbeat') await heartbeat(installation, kiosk, event);
    return {ack: event.eventId, state: 'accepted', receipt};
  }
  async function heartbeat(installation, kiosk, event) {
    const hardware = localHardware(kiosk);
    if (!Array.isArray(event.modules) || event.modules.length > hardware.boardCount) fail(400, 'inventory', 'Invalid inventory.');
    await db.runTransaction(async tx => {
      const ref = db.collection('kiosks').doc(installation.provisionId);
      const current = (await tx.get(ref)).data();
      if (current?.stationid !== installation.stationId || millis(current.localHeartbeatAt) >= millis(event.occurredAt)) return;
      // Project into existing dashboard fields while preserving module configuration.
      const topology = localTopology(current, installation);
      const complete = event.modules.length === hardware.boardCount && event.modules.every(m => m.slots.length === hardware.slotsPerBoard);
      if (complete && event.modules.some((module, index) => module.position !== index + 1 || module.slots.some((slot, s) => slot.position !== s + 1 ||
        (slot.present === true && (typeof slot.chargerId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(slot.chargerId)))))) fail(400, 'inventory', 'Inventory positions or serials are invalid.');
      if (!complete && event.online === true) fail(400, 'inventory', 'An online heartbeat requires complete inventory.');
      const reports = !complete ? [] : topology.aggregate ? [{...event.modules[0], slots: event.modules.flatMap((module, index) => module.slots.map(slot => ({...slot, position: index * hardware.slotsPerBoard + slot.position})))}] : event.modules;
      const modules = !complete ? current.modules.map(m => ({...m, online: false, output: false, heartbeatOutput: false})) : reports.map((module, index) => {
        const old = (current.modules || [])[index] || {};
        if (!Array.isArray(module.slots) || module.slots.length > hardware.slotsPerBoard * (topology.aggregate ? hardware.boardCount : 1)) fail(400, 'inventory', 'Invalid module slots.');
        return {...old, ...module, id: old.id || module.id, moduleid: old.moduleid || old.id || module.id,
          slots: module.slots.map(slot => { const previous = (old.slots || []).find(s => Number(s.position) === Number(slot.position)) || {};
            return {...previous, ...slot, locked: previous.locked ?? previous.lock ?? false, sn: slot.chargerId || '',
              s: slot.present === true ? 1 : 0, status: slot.present === true ? 1 : 0, power: slot.batteryLevel, rented: false, lock: previous.lock ?? previous.locked ?? false}; }),
          online: event.online === true && module.online !== false, output: event.online === true && module.online !== false, heartbeatOutput: event.online === true && module.online !== false, lastupdate: event.occurredAt};
      });
      const slots = modules.flatMap(m => m.slots || []), banks = slots.filter(s => s.present === true);
      const available = modules.filter(m => m.online !== false && m.operationalEnabled !== false).flatMap(m => m.slots || []).filter(s =>
        s.present === true && !s.lock && !s.locked && !s.fault && !s.abnormal && !s.quarantined && Number(s.batteryLevel) >= hardware.minimumBattery);
      const full = banks.filter(s => Number(s.batteryLevel) >= hardware.minimumBattery).length;
      tx.set(presence.doc(installation.provisionId), {observedAt: event.occurredAt, dueAt: new Date(now() + 60000)});
      tx.set(ref, {...current, modules, count: available.length, chargers: available.length || 'soldout', slotscount: slots.length,
        total: banks.length, full, empty: banks.length - full, slot: slots.length - banks.length,
        lockcount: slots.filter(s => s.lock || s.locked).length, online: event.online === true, mqtt: event.online === true, timestamp: new Date(now()), lastseen: event.occurredAt,
        lastSeen: event.occurredAt, lastupdate: event.occurredAt, localHeartbeatAt: event.occurredAt, localController: {
          vendor: event.vendor, pending: event.pending === true, outboxCount: event.outboxCount || 0,
          appVersion: event.appVersion || '', billingOwner: OWNER}});
    });
  }
  async function processReturn(doc) {
    if (!scopeAllowed(doc.event.stationId, doc.stripeMode)) return;
    const event = doc.event;
    const candidates = (await rentals.where('chargerid', '==', event.chargerId).get()).docs
      .map(s => ({id: s.id, ...s.data()})).filter(r => r.billingOwner === OWNER &&
        scopeAllowed(r.rentalStationid, r.stripeMode) && r.stripeMode === doc.stripeMode &&
        r.stripeAccountCountry === doc.stripeAccountCountry &&
        (!event.rentalTransactionId || r.installationId === doc.installationId && r.localTransactionId === event.rentalTransactionId) && millis(r.rentalTime) <= millis(event.occurredAt))
      .sort((a, b) => millis(b.rentalTime) - millis(a.rentalTime));
    const candidate = candidates[0];
    if (!candidate) return; // An offline station may upload its rental after this return.
    await db.runTransaction(async tx => {
      const ref = rentals.doc(candidate.id), eventRef = events.doc(doc.id);
      const rental = (await tx.get(ref)).data(), currentEvent = (await tx.get(eventRef)).data();
      if (currentEvent.state !== 'pending' || rental.billingOwner !== OWNER) return;
      if (rental.returnTime) {
        // A later physical return can belong to an offline rental that has not
        // uploaded yet. Keep it pending rather than discarding that observation.
        if (millis(event.occurredAt) <= millis(rental.returnTime)) tx.set(eventRef, {...currentEvent, state: 'duplicate_return'});
        return;
      }
      tx.set(ref, {...rental, returnTime: event.occurredAt, returnStationid: event.stationId,
        returnProvisionid: event.provisionId, returnModuleid: doc.returnModuleId || event.moduleId || '', returnSlotid: doc.returnSlotId || event.slot,
        status: 'returned', billingOperationStartedAt: rental.localSettlement?.state === 'completed' ? null : rental.billingOperationStartedAt || null,
        localSettlement: freeRental(rental) ? zeroSettlement(new Date(now()).toISOString()) : ['processing', 'awaiting_forwarding', 'payment_failed', 'verification_pending'].includes(rental.localSettlement?.state) ? rental.localSettlement : {state: 'pending'}});
      tx.set(eventRef, {...currentEvent, state: 'completed', rentalId: candidate.id});
      if (freeRental(rental)) tx.delete(jobs.doc(candidate.id));
      else if (!['payment_failed', 'verification_pending'].includes(rental.localSettlement?.state)) tx.set(jobs.doc(candidate.id), {rentalId: candidate.id, dueAt: new Date(now())});
    });
  }
  // Receipt lookup is scoped to the reporting installation and exact return event.
  // Correlation may precede final billing; the same signed receipt shows settlement
  // as pending until reconciliation completes. An unmatched return stays durable.
  async function returnReceipt(installation, eventId) {
    assertScope(installation);
    const eventRef = events.doc(hash({installationId: installation.id, eventId: id(eventId)}));
    let doc = (await eventRef.get()).data();
    if (!doc || doc.installationId !== installation.id || doc.event.type !== 'return' ||
        doc.event.stationId !== installation.stationId || doc.stripeMode !== installation.stripeMode) {
      fail(404, 'not-found', 'Return event not found.');
    }
    if (doc.state === 'pending') {
      await processReturn({id: eventRef.id, ...doc});
      doc = (await eventRef.get()).data();
    }
    const rental = doc.state === 'completed' && doc.rentalId ? (await rentals.doc(doc.rentalId).get()).data() : null;
    const receipt = rental && receiptService && rental.billingOwner === OWNER &&
      rental.stripeMode === installation.stripeMode && rental.stripeAccountCountry === installation.stripeAccountCountry &&
      scopeAllowed(rental.rentalStationid, rental.stripeMode) && rental.chargerid === doc.event.chargerId &&
      rental.returnTime === doc.event.occurredAt && rental.returnProvisionid === installation.provisionId ?
      receiptService.link({rentalId: doc.rentalId, rental}) : null;
    return {ack: eventId, state: doc.state, receipt};
  }
  // Read the exact failed checkout's completed cleanup, including outcomes
  // ingested before the station learned its PaymentIntent ID. No payment or
  // motor operation is performed by this status lookup.
  async function failedCheckoutStatus(installation, eventId) {
    assertScope(installation);
    const doc = (await events.doc(hash({installationId: installation.id, eventId: id(eventId)})).get()).data();
    if (!doc || doc.installationId !== installation.id || doc.event.type !== 'failed' ||
        doc.event.stationId !== installation.stationId || doc.event.provisionId !== installation.provisionId ||
        doc.stripeMode !== installation.stripeMode || doc.stripeAccountCountry !== installation.stripeAccountCountry) {
      fail(404, 'not-found', 'Failed checkout event not found.');
    }
    const event = doc.event;
    const txn = (await db.collection('localStationTransactions').doc(hash({installationId: installation.id, transactionId: event.transactionId})).get()).data();
    const response = {ack: eventId, transactionId: event.transactionId, state: doc.state, money: 'pending'};
    const attempts = event.attempts;
    if (txn?.state !== 'failed' || txn.eventId !== eventId || !Array.isArray(attempts) ||
        attempts.some(a => !['failed', 'not_dispensed'].includes(a.status)) || doc.state !== 'completed' || event.stripeOffline === true) return response;
    if (paymentFree(doc.pricing)) return {...response, money: 'not_required'};
    const paymentIntentId = doc.paymentIntentId || event.paymentIntentId;
    if (!paymentIntentId || (await rentals.doc(paymentIntentId).get()).exists ||
        (await rentals.where('paymentIntentId', '==', paymentIntentId).get()).docs.length) return response;
    const pi = await stripe(installation).paymentIntents.retrieve(paymentIntentId, {expand: ['latest_charge']});
    verifyPayment(pi, {...event, paymentIntentId}, doc.pricing, installation);
    const charge = pi.latest_charge;
    const money = pi.status === 'canceled' ? 'voided' : pi.status === 'succeeded' &&
      pi.amount_received > 0 && charge && typeof charge === 'object' && charge.refunded === true &&
      charge.amount_refunded >= pi.amount_received ? 'refunded' : 'pending';
    return {...response, paymentIntentId, money};
  }
  async function cleanup(doc) {
    if (!scopeAllowed(doc.event.stationId, doc.stripeMode)) return;
    if (doc.event.type !== 'failed') return;
    if (paymentFree(doc.pricing)) { await put(db, events.doc(doc.id), {...doc, state: 'completed'}); return; }
    let paymentIntentId = doc.forwardedPaymentIntentId || doc.event.paymentIntentId;
    const client = stripe(doc);
    if (doc.cleanupStartedAt && now() - millis(doc.cleanupStartedAt) > 23 * 3600000) {
      await put(db, events.doc(doc.id), {...doc, state: 'verification_pending', reason: 'Payment retry window expired; inspect Stripe before another attempt.'}); return;
    }
    if (!doc.cleanupStartedAt) { doc.cleanupStartedAt = new Date(now()).toISOString(); await put(db, events.doc(doc.id), doc); }
    if (!paymentIntentId) {
      // Creation can time out before the station learns the PI ID. Search by the
      // durable local UUID; never create a replacement intent from this service.
      const found = await client.paymentIntents.search({query: `metadata['chargerent_local_transaction']:'${id(doc.event.transactionId)}'`});
      const matches = found.data.filter(pi => pi.metadata.chargerent_station_id === doc.event.stationId &&
        pi.metadata.chargerent_provision_id === doc.event.provisionId);
      if (matches.length !== 1) return;
      paymentIntentId = matches[0].id;
    }
    const pi = await client.paymentIntents.retrieve(paymentIntentId);
    verifyPayment(pi, {...doc.event, paymentIntentId}, doc.pricing, {stationId: doc.event.stationId,
      provisionId: doc.event.provisionId, stripeMode: doc.stripeMode});
    // Also protect records imported after ingestion and failed reports whose PI
    // identity was not known until this reconciliation pass.
    if ((await rentals.doc(paymentIntentId).get()).exists || (await rentals.where('paymentIntentId', '==', paymentIntentId).get()).docs.length) {
      await put(db, events.doc(doc.id), {...doc, state: 'verification_pending', reason: 'A rental already owns this payment.'}); return;
    }
    if (pi.status === 'succeeded') { const refund = await client.refunds.create({payment_intent: pi.id}, {idempotencyKey: `local-failed-${pi.id}`});
      if (refund.status !== 'succeeded') throw new Error('Failed checkout refund is still pending'); }
    else if (pi.status !== 'canceled') await client.paymentIntents.cancel(pi.id, {}, {idempotencyKey: `local-cancel-${pi.id}`});
    await put(db, events.doc(doc.id), {...doc, state: 'completed', paymentIntentId});
  }
  async function reconcileOffline(rentalId, forwardedId = null) {
    const ref = rentals.doc(rentalId), r = (await ref.get()).data();
    if (!r || r.billingOwner !== OWNER || !scopeAllowed(r.rentalStationid, r.stripeMode) ||
      r.localSettlement?.state !== 'awaiting_forwarding') return;
    const client = stripe(r);
    let paymentIntentId = forwardedId || r.paymentIntentId;
    if (!paymentIntentId) {
      const found = await client.paymentIntents.search({query: `metadata['chargerent_local_transaction']:'${id(r.localTransactionId)}'`});
      const matches = found.data.filter(pi => pi.metadata?.chargerent_station_id === r.rentalStationid &&
        pi.metadata?.chargerent_provision_id === r.rentalProvisionid && pi.livemode === (r.stripeMode === 'live'));
      if (found.has_more || matches.length > 1) {
        await db.runTransaction(async tx => { const current = (await tx.get(ref)).data();
          if (current.localSettlement?.state === 'awaiting_forwarding') {
            tx.set(ref, {...current, localSettlement: {state: 'verification_pending', reason: 'More than one matching Stripe payment.'}});
            tx.delete(jobs.doc(rentalId));
          }
        }); return;
      }
      paymentIntentId = matches[0]?.id;
    }
    if (!paymentIntentId) { await put(db, jobs.doc(rentalId), {rentalId, dueAt: new Date(now() + 60000)}); return; }
    const pi = await client.paymentIntents.retrieve(paymentIntentId, {expand: ['latest_charge']});
    verifyPayment(pi, {type: 'deferred', paymentIntentId, transactionId: r.localTransactionId, pricingVersion: r.pricingVersion},
      {paymentAmountCents: r.amountCents, currency: r.currency, gatewayOption: r.gatewayoptions},
      {stationId: r.rentalStationid, provisionId: r.rentalProvisionid, stripeMode: r.stripeMode});
    if (await account(r) !== r.stripeAccountId) throw new Error('Stripe offline account changed');
    const accepted = pi.status === (r.gatewayoptions === 'FULLPRICE' ? 'requires_capture' : 'succeeded');
    const declined = ['requires_payment_method', 'canceled'].includes(pi.status);
    const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      const claimRef = db.collection('localStationPaymentOwners').doc(hash({account: r.stripeAccountId, mode: r.stripeMode, paymentIntentId}));
      const claim = (await tx.get(claimRef)).data();
      const direct = (await tx.get(rentals.doc(paymentIntentId))).data();
      if (current.localSettlement?.state !== 'awaiting_forwarding') return;
      if (claim && claim.rentalId !== rentalId || direct) fail(409, 'payment-owned', 'Another rental owns this payment.');
      tx.set(claimRef, {rentalId});
      tx.set(ref, {...current, paymentIntentId,
        paymentResolution: accepted ? r.gatewayoptions === 'FULLPRICE' ? 'authorized' : 'captured' : declined ? 'declined' : 'pending',
        card_last4: charge?.payment_method_details?.card_present?.last4 || '',
        card_type: charge?.payment_method_details?.card_present?.brand || '',
        reusablePaymentMethod: charge?.payment_method_details?.card_present?.generated_card || null,
        customerId: typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null,
        localSettlement: declined ? {state: 'payment_failed', reason: 'Offline card payment was declined after dispensing.'} :
          accepted ? {state: current.returnTime ? 'pending' : 'awaiting_return'} : {state: 'awaiting_forwarding'}});
      if (declined) tx.delete(jobs.doc(rentalId));
      else tx.set(jobs.doc(rentalId), {rentalId, dueAt: new Date(accepted ? current.returnTime ? now() : millis(current.rentalTime) + Number(current.pricingSnapshot.overdue) * 86400000 : now() + 60000)});
    });
  }
  async function forwardedPayment(installation, input) {
    assertScope(installation);
    id(input.transactionId);
    if (!/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId || '')) fail(400, 'payment', 'Invalid forwarded payment.');
    const txnRef = db.collection('localStationTransactions').doc(hash({installationId: installation.id, transactionId: input.transactionId}));
    const txn = (await txnRef.get()).data();
    if (!txn) fail(409, 'awaiting-report', 'Upload the checkout observation first.');
    const eventRef = events.doc(hash({installationId: installation.id, eventId: txn.eventId}));
    const doc = (await eventRef.get()).data();
    const pi = await stripe(installation).paymentIntents.retrieve(input.paymentIntentId);
    verifyPayment(pi, {...doc.event, type: 'deferred', paymentIntentId: input.paymentIntentId}, doc.pricing, installation);
    if (txn.rentalId) await reconcileOffline(txn.rentalId, input.paymentIntentId);
    else await db.runTransaction(async tx => { const current = (await tx.get(eventRef)).data();
      tx.set(eventRef, {...current, forwardedPaymentIntentId: input.paymentIntentId}); });
    return {confirmed: true, transactionId: input.transactionId};
  }
  async function settle(rentalId) {
    await reconcileOffline(rentalId);
    const ref = rentals.doc(rentalId), lease = crypto.randomUUID();
    const rental = await db.runTransaction(async tx => {
      const r = (await tx.get(ref)).data();
      if (r && r.billingOwner === OWNER && scopeAllowed(r.rentalStationid, r.stripeMode) && freeRental(r)) {
        tx.delete(jobs.doc(rentalId));
        tx.set(ref, {...r, totalCharged: 0, totalRefunded: 0, localSettlement: zeroSettlement(new Date(now()).toISOString())}); return null;
      }
      if (!r || r.billingOwner !== OWNER || !scopeAllowed(r.rentalStationid, r.stripeMode) || ['completed', 'awaiting_forwarding', 'payment_failed', 'verification_pending'].includes(r.localSettlement?.state) ||
        millis(r.localSettlement?.leaseUntil) > now()) return null;
      const deadline = millis(r.rentalTime) + Number(r.pricingSnapshot.overdue) * 86400000;
      if (!r.returnTime && now() < deadline) return null;
      if (r.billingOperationStartedAt && now() - millis(r.billingOperationStartedAt) > 23 * 3600000) {
        tx.set(ref, {...r, localSettlement: {...r.localSettlement, state: 'verification_pending', reason: 'Payment retry window expired; reconcile Stripe before another attempt.'}});
        tx.delete(jobs.doc(rentalId)); return null;
      }
      const pricing = r.pricingSnapshot;
      const charge = r.returnTime ? returnCharge(pricing, millis(r.returnTime) - millis(r.rentalTime)) :
        returnCharge({...pricing, rate: [{time: 0, price: Number(pricing.buyprice)}]}, 1);
      const targetCents = Math.round(charge.totalCharged * 100);
      tx.set(ref, {...r, billingOperationStartedAt: r.billingOperationStartedAt || new Date(now()).toISOString(), localSettlement: {state: 'processing', lease, leaseUntil: new Date(now() + 120000).toISOString(), targetCents}});
      return {...r, targetCents, charge};
    });
    if (!rental) return;
    const client = stripe(rental);
    const paymentIntentId = rental.paymentIntentId || rentalId;
    try {
      const pi = await client.paymentIntents.retrieve(paymentIntentId);
      if (await account(rental) !== rental.stripeAccountId) throw new Error('Stripe settlement account changed');
      verifyPayment(pi, {type: 'failed', paymentIntentId, transactionId: rental.localTransactionId, pricingVersion: rental.pricingVersion},
        {paymentAmountCents: rental.amountCents, currency: rental.currency, gatewayOption: rental.gatewayoptions},
        {stationId: rental.rentalStationid, provisionId: rental.rentalProvisionid, stripeMode: rental.stripeMode});
      const target = rental.targetCents;
      if (!Number.isSafeInteger(target) || target < 0 || pi.amount !== rental.amountCents || pi.currency !== rental.currency) throw new Error('Settlement payment mismatch');
      let finalPaymentIntentId = rental.finalPaymentIntentId || null;
      async function savedCardCharge(amount) {
        if (!rental.reusablePaymentMethod) throw new Error('Card cannot be charged again; customer action is required');
        let customerId = rental.customerId;
        if (!customerId) {
          customerId = (await client.customers.create({metadata: {chargerent_rental: rentalId}}, {idempotencyKey: `local-customer-${rentalId}`})).id;
          await db.runTransaction(async tx => { const current = (await tx.get(ref)).data();
            if (current.localSettlement?.lease !== lease) throw new Error('Billing lease changed');
            tx.set(ref, {...current, customerId}); });
        }
        const method = await client.paymentMethods.retrieve(rental.reusablePaymentMethod);
        const attached = typeof method.customer === 'string' ? method.customer : method.customer?.id;
        if (attached && attached !== customerId) throw new Error('Saved card customer changed');
        if (!attached) await client.paymentMethods.attach(rental.reusablePaymentMethod, {customer: customerId});
        let final = finalPaymentIntentId ? await client.paymentIntents.retrieve(finalPaymentIntentId) : null;
        if (!final) {
          final = await client.paymentIntents.create({amount, currency: pi.currency,
            customer: customerId, payment_method: rental.reusablePaymentMethod, off_session: true, confirm: true,
            metadata: {chargerent_rental: rentalId, billing_owner: OWNER}}, {idempotencyKey: `local-overage-${rentalId}`});
          finalPaymentIntentId = final.id;
          await db.runTransaction(async tx => { const current = (await tx.get(ref)).data();
            if (current.localSettlement?.lease !== lease) throw new Error('Billing lease changed');
            tx.set(ref, {...current, finalPaymentIntentId}); });
        }
        if (final.status !== 'succeeded' || final.amount !== amount || final.currency !== pi.currency ||
          final.livemode !== (rental.stripeMode === 'live') || final.metadata?.chargerent_rental !== rentalId) {
          throw new Error('Final charge needs reconciliation or customer action');
        }
      }
      if (rental.gatewayoptions === 'FULLPRICE') {
        if (target > pi.amount) throw new Error('Final charge exceeds the card authorization');
        if (pi.status === 'requires_capture') {
          if (target) { const captured = await client.paymentIntents.capture(paymentIntentId, {amount_to_capture: target}, {idempotencyKey: `local-final-${rentalId}`});
            if (captured.status !== 'succeeded' || captured.amount_received !== target) throw new Error('Capture needs reconciliation'); }
          else { const canceled = await client.paymentIntents.cancel(paymentIntentId, {}, {idempotencyKey: `local-zero-${rentalId}`});
            if (canceled.status !== 'canceled') throw new Error('Cancellation needs reconciliation'); }
        } else if (pi.status === 'canceled' && (target > 0 || finalPaymentIntentId)) {
          // A card-present authorization can expire before the rental's due date.
          // The confirmed terminal payment saved a generated card for this use.
          if (!finalPaymentIntentId) await savedCardCharge(target);
          else { const extra = await client.paymentIntents.retrieve(finalPaymentIntentId);
            if (extra.status !== 'succeeded' || extra.livemode !== pi.livemode || extra.currency !== pi.currency || extra.metadata?.chargerent_rental !== rentalId || extra.amount < target) throw new Error('Prior final charge needs reconciliation');
            if (extra.amount > target) { const refund = await client.refunds.create({payment_intent: extra.id, amount: extra.amount - target}, {idempotencyKey: `local-adjust-extra-${rentalId}-${target}`});
              if (refund.status !== 'succeeded') throw new Error('Late return refund is still pending'); }
          }
        } else if (pi.status === 'succeeded' && pi.amount_received >= target) {
          if (pi.amount_received > target) { const refund = await client.refunds.create({payment_intent: paymentIntentId, amount: pi.amount_received - target}, {idempotencyKey: `local-adjust-${rentalId}-${target}`});
            if (refund.status !== 'succeeded') throw new Error('Late return refund is still pending'); }
        } else if (!(target === 0 && pi.status === 'canceled')) {
          throw new Error('Card authorization expired or final charge differs');
        }
      } else {
        if (pi.status !== 'succeeded') throw new Error('Initial payment is unavailable');
        const extra = finalPaymentIntentId ? await client.paymentIntents.retrieve(finalPaymentIntentId) : null;
        if (extra && (extra.status !== 'succeeded' || extra.livemode !== pi.livemode || extra.currency !== pi.currency || extra.metadata?.chargerent_rental !== rentalId)) throw new Error('Prior final charge does not match this rental');
        const paid = pi.amount + (extra?.amount || 0);
        let refundDue = Math.max(0, paid - target);
        if (extra && refundDue) { const amount = Math.min(refundDue, extra.amount);
          const refund = await client.refunds.create({payment_intent: extra.id, amount}, {idempotencyKey: `local-adjust-extra-${rentalId}-${target}`});
          if (refund.status !== 'succeeded') throw new Error('Final charge refund is still pending'); refundDue -= amount; }
        if (refundDue) { const refund = await client.refunds.create({payment_intent: paymentIntentId, amount: refundDue}, {idempotencyKey: `local-adjust-${rentalId}-${target}`});
          if (refund.status !== 'succeeded') throw new Error('Refund is still pending'); }
        if (target > paid) await savedCardCharge(target - pi.amount);
      }
      await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (current.localSettlement?.lease !== lease) return;
        if (current.returnTime !== rental.returnTime) {
          // A return arrived during the Stripe operation. Save the financial
          // result and reconcile its physical time in a separate operation.
          tx.set(jobs.doc(rentalId), {rentalId, dueAt: new Date(now())});
          tx.set(ref, {...current, finalPaymentIntentId, billingOperationStartedAt: null, localSettlement: {state: 'pending'}}); return;
        }
        tx.delete(jobs.doc(rentalId));
        tx.set(ref, {...current, finalPaymentIntentId, status: current.returnTime ? 'returned' : 'purchased', ...rental.charge, currency: rental.currency,
          localSettlement: {state: 'completed', targetCents: target, completedAt: new Date(now()).toISOString()},
          stripeReturnSettlement: {status: 'completed', owner: OWNER, totalCharged: target / 100}});
      });
    } catch (error) {
      await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (current.localSettlement?.lease === lease) { tx.set(jobs.doc(rentalId), {rentalId, dueAt: new Date(now() + 60000)}); tx.set(ref, {...current,
          localSettlement: {...current.localSettlement, state: 'retry', leaseUntil: null,
            reason: 'Final payment requires reconciliation', lastErrorCode: String(error.code || error.type || 'payment').slice(0, 80)}}); }
      });
      throw error;
    }
  }
  async function tick() {
    const stale = (await presence.where('dueAt', '<=', new Date(now())).limit(100).get()).docs;
    for (const doc of stale) await db.runTransaction(async tx => {
      const ref = db.collection('kiosks').doc(doc.id), markerRef = presence.doc(doc.id);
      const current = (await tx.get(ref)).data(), marker = (await tx.get(markerRef)).data();
      if (!stationAllowed(current?.stationid)) return;
      if (!marker || millis(marker.dueAt) > now()) return;
      tx.delete(markerRef);
      if (current?.hardware?.billingOwner === OWNER && current.localHeartbeatAt === marker.observedAt) tx.set(ref, {...current,
        online: false, mqtt: false, count: 0, chargers: 'soldout', modules: (current.modules || []).map(m => ({...m, online: false, output: false, heartbeatOutput: false}))});
    });
    const pending = (await events.where('state', '==', 'pending').get()).docs;
    let failed = 0;
    for (const snapshot of pending) {
      try { const doc = {id: snapshot.id, ...snapshot.data()};
        if (doc.event.type === 'return') await processReturn(doc); else await cleanup(doc);
      } catch { failed++; }
    }
    const all = (await jobs.where('dueAt', '<=', new Date(now())).limit(100).get()).docs;
    for (const snapshot of all) { try { await settle(snapshot.id); } catch { failed++; } }
    return {failed};
  }
  async function handle(req) {
    const {installation, kiosk} = await authorize(req);
    const path = (req.path || req.url || '').split('?')[0];
    if (['/v1/config', '/v1/terminal/connection-token'].includes(path) && (kiosk.active === false || kiosk.enabled === false || kiosk.disabled === true)) fail(409, 'disabled', 'Rentals are disabled for this station.');
    if (req.method === 'GET' && path === '/v1/config') return configuration(installation, kiosk);
    if (req.method === 'POST' && path === '/v1/terminal/connection-token') {
      const token = await stripe(installation).terminal.connectionTokens.create({location: installation.stripeLocationId});
      return {secret: token.secret};
    }
    if (req.method === 'POST' && path === '/v1/installation/confirm') {
      const report = req.body || {};
      if (report.stationId !== installation.stationId || report.provisionId !== installation.provisionId ||
        report.moduleId !== installation.moduleId || report.slotCount !== installation.slotNumbers.length || report.currency !== installation.currency ||
        report.hardwareVendor !== installation.hardwareVendor || report.checkoutExecution !== 'local') fail(409, 'confirmation', 'Station configuration confirmation does not match its assignment.');
      return {confirmed: true, stationId: installation.stationId};
    }
    if (req.method === 'GET' && path === '/v1/commands') return {command: await commands.claim(installation)};
    if (req.method === 'POST' && /^\/v1\/commands\/[A-Za-z0-9_-]+\/result$/.test(path)) return commands.complete(installation, path.split('/')[3], req.body);
    if (req.method === 'POST' && path === '/v1/payments/forwarded') return forwardedPayment(installation, req.body || {});
    if (req.method === 'POST' && path === '/v1/events') return ingest(installation, kiosk, req.body);
    if (req.method === 'GET' && /^\/v1\/events\/[A-Za-z0-9_-]{8,120}\/status$/.test(path)) return failedCheckoutStatus(installation, path.split('/')[3]);
    if (req.method === 'GET' && /^\/v1\/events\/[A-Za-z0-9_-]{8,120}\/receipt$/.test(path)) return returnReceipt(installation, path.split('/')[3]);
    fail(404, 'not-found', 'Local station route not found.');
  }
  return {handle, ingest, configuration, tick, settle, reconcileOffline, forwardedPayment, processReturn, returnReceipt, failedCheckoutStatus, commands};
}
function createLocalStationHandler(service) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.status(200).json(await service.handle(req)); }
    catch (error) { res.status(error instanceof KioskTerminalError ? error.status : 503)
      .json({code: error.code || 'unavailable', error: error instanceof KioskTerminalError ? error.message : 'Station event needs retry.'}); }
  };
}
module.exports = {OWNER, resolveLocalOffer, localHardware, localTopology, verifyPayment, createLocalStationBackend, createLocalStationHandler};
