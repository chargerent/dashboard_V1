/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {createReceiptService, projectReceipt, physicalVendProven, createFirestoreReceiptStore,
  createStripeReceiptObserver} = require("./rentalReceipt");
const START = "2026-10-08T10:00:00.000Z";
const END = "2026-10-08T11:00:00.000Z";
test("CTF7 receipts require correlated physical proof for the same ASCII bank, module and slot", () => {
  const rental = {status: "rented", transport: "ctf7", rentalModuleid: "LM-TEST000007", rentalSlotid: 3,
    chargerid: "FAN000000001", vendState: "dispensed", vendConfirmationSource: "ctf7_correlated_fresh_absence",
    vendAttempts: [{state: "dispensed", moduleid: "LM-TEST000007", requestedSlotid: 3, sn: "FAN000000001",
      respondedAt: START, confirmationSource: "ctf7_correlated_fresh_absence"}]};
  assert.equal(physicalVendProven(rental), true);
  for (const change of [{vendState: "verification_pending"}, {rentalSlotid: 2}, {chargerid: "FAN000000099"},
    {vendConfirmationSource: "raw_aa"}, {vendAttempts: []}]) assert.equal(physicalVendProven({...rental, ...change}), false);
});
const rentalFixture = (extra = {}) => ({transactionid: "tx-apollo-8012", rawid: "raw-order-44", gateway: "APOLLO", status: "rented", rentalStationid: "FR8012", rentalModuleid: "mod-12", rentalSlotid: 4, chargerid: 123, rentalTime: START, currency: "EUR", paymentResolution: "captured", paymentAmountCents: 3000, rentalEvents: [{eventtype: "vend_succeeded", occurredat: START, moduleid: "mod-12", slotnumber: 4, chargerid: 123}], email: "PRIVATE", phone: "PRIVATE", clientSecret: "PRIVATE", ...extra});
function fixture() {
  let rental = rentalFixture();
  const reads = [];
  const store = {async getRental(id) {reads.push(id); return id === "rental-doc-44" ? rental : null;}, async getContext() {return {client: {name: "Test venue", receiptLogo: {contentType: "image/png", url: "https://example.com/logo.png"}, secret: "PRIVATE"}, station: {info: {location: "Test location"}}};}};
  const service = createReceiptService({store, signingKey: "private-local-fixture-key-32-bytes-long", publicBaseUrl: "https://chargerentstations.com/media-kiosk"});
  return {service, reads, rental: () => rental, update(patch) {rental = {...rental, ...patch};}, link: () => service.link({rental, rentalId: "rental-doc-44"})};
}
test("successful physical vend creates a signed transaction URL that updates after return and settlement", async () => {
  const f = fixture(); const link = f.link(); const url = new URL(link.receiptUrl);
  assert.equal(link.transactionId, "tx-apollo-8012");
  assert.equal(url.pathname, "/media-kiosk/receipt/tx-apollo-8012");
  const key = url.searchParams.get("key");
  const initial = await f.service.read(link.transactionId, key);
  assert.equal(initial.status, "renting"); assert.equal(initial.payment.upfrontCents, 3000); assert.equal(initial.payment.refundedCents, null);
  assert.equal(initial.brand.logoUrl, "https://example.com/logo.png"); assert.equal(initial.station.name, "Test location"); assert.doesNotMatch(JSON.stringify(initial), /PRIVATE|email|phone|clientSecret/);
  f.update({status: "returned", returnTime: END, returnStationid: "FR8012", totalCharged: 2});
  assert.deepEqual(f.link(), link);
  const returned = await f.service.read(link.transactionId, key);
  assert.equal(returned.status, "returned"); assert.equal(returned.payment.state, "pending"); assert.equal(returned.payment.finalChargeCents, 200); assert.equal(returned.payment.refundedCents, null);
  f.update({refundStatus: "approved", refundAmount: 28, refundDate: END});
  const settled = await f.service.read(link.transactionId, key);
  assert.equal(settled.payment.state, "settled"); assert.equal(settled.payment.refundedCents, 2800); assert.deepEqual(f.link(), link);
  assert.deepEqual(f.reads, ["rental-doc-44", "rental-doc-44", "rental-doc-44"]);
});
test("payment approval, pending, failed and cancelled vends never issue a receipt", () => {
  const f = fixture();
  for (const status of ["pending", "vend_failed", "canceled"]) {f.update({status}); assert.equal(f.link(), null);}
  f.update({status: "rented", rentalEvents: [], vendState: "requested", paymentResolution: "captured"});
  assert.equal(f.link(), null); assert.equal(physicalVendProven(f.rental()), false);
  f.update({vendState: "dispensed", vendConfirmationSource: "popup_sn"}); assert.ok(f.link());
});
test("transaction or rental key tampering cannot read any rental", async () => {
  const f = fixture();const key = new URL(f.link().receiptUrl).searchParams.get("key");
  await assert.rejects(f.service.read("tx-other", key), {status: 404});
  await assert.rejects(f.service.read("tx-apollo-8012", key.replace(/.$/, key.endsWith("A") ? "B" : "A")), {status: 404});
  await assert.rejects(f.service.read("tx-apollo-8012", "rental-doc-44"), {status: 404});
  assert.deepEqual(f.reads, []);
});
test("Stripe card hold receipt ignores Google settlement markers without a processor observation", async () => {
  const f = fixture();f.update({gateway: "STRIPE", transactionid: "pi_123", paymentResolution: "authorized", gatewayOption: "FULLPRICE"});
  const link = f.link(), key = new URL(link.receiptUrl).searchParams.get("key");
  assert.equal((await f.service.read("pi_123", key)).payment.upfrontKind, "hold");
  f.update({status: "returned", returnTime: END, stripeReturnSettlement: {status: "pending", releasedCents: 3000, refundCents: 3000}});
  assert.equal((await f.service.read("pi_123", key)).payment.releasedCents, null);
  f.update({stripeReturnSettlement: {status: "completed", finalChargeCents: 0, refundCents: 0, releasedCents: 3000, settledAt: END}});
  const payment = (await f.service.read("pi_123", key)).payment;
  assert.equal(payment.state, "pending"); assert.equal(payment.releasedCents, null);
  assert.equal(payment.refundedCents, null); assert.equal(payment.finalChargeCents, null);
});

const STRIPE_PI = "pi_receipt8012";
const CURRENT_ACCOUNT = "acct_1QzXNuFbME8ycpjP";
const PREVIOUS_ACCOUNT = "acct_1QxiPrevious";
function stripeContext(patch = {}, interactionPatch = {}) {
  return {rentalId: STRIPE_PI, rental: rentalFixture({gateway: "STRIPE", transactionid: STRIPE_PI,
    paymentIntentId: STRIPE_PI, status: "returned", returnTime: END, totalCharged: 30,
    stripeAccountId: CURRENT_ACCOUNT, gatewayOption: "FULLPRICE", paymentResolution: "authorized", ...patch}),
  interaction: {paymentIntentId: STRIPE_PI, stripeAccountId: CURRENT_ACCOUNT,
    stripeMode: "live", currency: "EUR", amountCents: 3000, gatewayOption: "FULLPRICE",
    paymentResolution: "authorized", ...interactionPatch}};
}
function stripeReader({accountId = CURRENT_ACCOUNT, status = "canceled", received = 0,
  captureMethod = "manual", refunds = [], aggregateRefunded = 0, chargeAsId = false,
  readError = false, livemode = true} = {}) {
  const calls = [];
  const charge = {id: "ch_receipt8012", payment_intent: STRIPE_PI, currency: "eur",
    amount: 3000, amount_captured: received, amount_refunded: aggregateRefunded,
    captured: received > 0, paid: true};
  const forbidden = () => {calls.push(["FINANCIAL_WRITE"]); throw new Error("Financial writes are forbidden.");};
  const client = {
    accounts: {async retrieve() {calls.push(["account"]); return {id: accountId};}},
    paymentIntents: {async retrieve(id, options) {calls.push(["intent", id, options]);
      if (readError) throw new Error("Read unavailable");
      return {id, amount: 3000, amount_received: received,
        amount_capturable: status === "requires_capture" ? 3000 : 0,
        currency: "eur", livemode, capture_method: captureMethod, status,
        latest_charge: chargeAsId ? charge.id : charge};}, create: forbidden, cancel: forbidden, capture: forbidden},
    charges: {async retrieve(id) {calls.push(["charge", id]); return charge;}},
    refunds: {async list(parameters) {calls.push(["refunds", parameters]);
      return {data: refunds.map((r) => ({id: "re_receipt8012", charge: charge.id,
        payment_intent: STRIPE_PI, currency: "eur", ...r})), has_more: false};}, create: forbidden},
  };
  return {client, calls, charge};
}
function observerFor(reader) {
  return createStripeReceiptObserver({getStripeClientForAccount(accountId, mode) {
    reader.calls.push(["resolve", accountId, mode]); return reader.client;
  }});
}
test("actual canceled manual authorization confirms zero charge and a released hold with no writes", async () => {
  const reader = stripeReader(); const context = stripeContext();
  const observed = await observerFor(reader)(context);
  assert.deepEqual(observed, {source: "stripe", state: "settled", finalChargeCents: 0,
    refundedCents: 0, releasedCents: 3000});
  const payment = projectReceipt({...context, paymentObservation: observed}).payment;
  assert.equal(payment.state, "settled"); assert.equal(payment.finalChargeCents, 0);
  assert.equal(payment.releasedCents, 3000); assert.equal(payment.upfrontKind, "hold");
  assert.deepEqual(reader.calls.map((call) => call[0]), ["resolve", "account", "intent"]);
});
test("actual partial capture reports only the captured fee and releases the unused authorization", async () => {
  const reader = stripeReader({status: "succeeded", received: 800, chargeAsId: true});
  const observed = await observerFor(reader)(stripeContext());
  assert.equal(observed.state, "settled"); assert.equal(observed.finalChargeCents, 800);
  assert.equal(observed.releasedCents, 2200); assert.equal(observed.refundedCents, 0);
  assert.deepEqual(reader.calls.map((call) => call[0]), ["resolve", "account", "intent", "charge", "refunds"]);
  assert.deepEqual(reader.calls.at(-1)[1], {payment_intent: STRIPE_PI, limit: 100});
});
test("only succeeded refunds reduce the actual captured fee; pending refunds keep the final fee unknown", async () => {
  const refunded = stripeReader({status: "succeeded", received: 3000, captureMethod: "automatic",
    aggregateRefunded: 2800, refunds: [{status: "succeeded", amount: 2800}]});
  const observation = await observerFor(refunded)(stripeContext());
  assert.deepEqual(observation, {source: "stripe", state: "settled", finalChargeCents: 200,
    refundedCents: 2800, releasedCents: 0});
  const pending = stripeReader({status: "succeeded", received: 3000, aggregateRefunded: 2800,
    refunds: [{status: "pending", amount: 2800}]});
  const waiting = await observerFor(pending)(stripeContext());
  assert.equal(waiting.state, "pending"); assert.equal(waiting.finalChargeCents, null);
  assert.equal(waiting.refundedCents, 0); assert.equal(waiting.releasedCents, null);
});
test("returned and purchased managed Stripe receipts remain pending on read failure or an open hold", async () => {
  for (const options of [{readError: true}, {status: "requires_capture"}, {status: "processing"}]) {
    const reader = stripeReader(options); const context = stripeContext();
    const observation = await observerFor(reader)(context);
    for (const status of ["returned", "purchased"]) {
      const receipt = projectReceipt({...context, rental: {...context.rental, status,
        stripeReturnSettlement: {status: "completed", finalChargeCents: 3000, refundCents: 0, releasedCents: 0}},
      paymentObservation: observation});
      assert.equal(receipt.payment.state, "pending"); assert.equal(receipt.payment.finalChargeCents, null);
      assert.equal(receipt.payment.refundedCents, null); assert.equal(receipt.payment.releasedCents, null);
    }
    assert.equal(reader.calls.some((call) => call[0] === "FINANCIAL_WRITE"), false);
  }
});
test("missing or conflicting creating accounts and intents never guess the current French account", async () => {
  for (const context of [stripeContext({stripeAccountId: undefined}, {stripeAccountId: undefined}),
    stripeContext({stripeAccountId: PREVIOUS_ACCOUNT}),
    stripeContext({paymentIntentId: "pi_another"})]) {
    const reader = stripeReader(); const result = await observerFor(reader)(context);
    assert.equal(result.state, "pending"); assert.equal(result.finalChargeCents, null);
    assert.deepEqual(reader.calls, []);
    assert.equal(projectReceipt({...context, paymentObservation: result}).payment.finalChargeCents, null);
  }
  const reader = stripeReader({accountId: PREVIOUS_ACCOUNT});
  assert.equal((await observerFor(reader)(stripeContext())).state, "pending");
  assert.deepEqual(reader.calls.map((call) => call[0]), ["resolve", "account"]);
});
test("historical Stripe receipts read their exact old creating account rather than the replacement key", async () => {
  const historical = stripeReader({accountId: PREVIOUS_ACCOUNT, status: "succeeded", received: 3000,
    aggregateRefunded: 3000, refunds: [{status: "succeeded", amount: 3000}]});
  const current = stripeReader();
  const observe = createStripeReceiptObserver({getStripeClientForAccount(accountId) {
    return ({[PREVIOUS_ACCOUNT]: historical.client, [CURRENT_ACCOUNT]: current.client})[accountId];
  }});
  const context = stripeContext({stripeAccountId: PREVIOUS_ACCOUNT}, {stripeAccountId: PREVIOUS_ACCOUNT});
  const actual = await observe(context);
  assert.equal(actual.state, "settled"); assert.equal(actual.refundedCents, 3000); assert.equal(actual.finalChargeCents, 0);
  assert.equal(current.calls.length, 0); assert.ok(historical.calls.length > 0);
});
test("missing, invalid or conflicting Stripe modes never select a key", async () => {
  for (const context of [stripeContext({}, {stripeMode: undefined}),
    stripeContext({stripeMode: "test"}), stripeContext({}, {stripeMode: "unknown"})]) {
    const reader = stripeReader(); const result = await observerFor(reader)(context);
    assert.equal(result.state, "pending"); assert.deepEqual(reader.calls, []);
  }
});
test("the same creating account selects separate test and live clients and rejects processor mode mismatch", async () => {
  const live = stripeReader(); const testMode = stripeReader({livemode: false});
  const resolutions = [];
  const observe = createStripeReceiptObserver({getStripeClientForAccount(accountId, mode) {
    resolutions.push([accountId, mode]); return mode === "test" ? testMode.client : live.client;
  }});
  assert.equal((await observe(stripeContext())).state, "settled");
  assert.equal((await observe(stripeContext({stripeMode: "test"}, {stripeMode: "test"}))).state, "settled");
  assert.deepEqual(resolutions, [[CURRENT_ACCOUNT, "live"], [CURRENT_ACCOUNT, "test"]]);
  const mismatch = stripeReader({livemode: false});
  assert.equal((await observerFor(mismatch)(stripeContext())).state, "pending");
});
test("signed receipt reads observe payment only after verifying the exact rental and physical vend", async () => {
  const context = stripeContext(); const reader = stripeReader();
  const service = createReceiptService({store: {async getRental() {return context.rental;},
    async getContext() {return {interaction: context.interaction};}},
  signingKey: "private-local-fixture-key-32-bytes-long", publicBaseUrl: "https://chargerentstations.com/media-kiosk",
  observePayment: observerFor(reader)});
  const link = service.link({rental: context.rental, rentalId: context.rentalId});
  const key = new URL(link.receiptUrl).searchParams.get("key");
  await assert.rejects(service.read(STRIPE_PI, key.replace(/.$/, key.endsWith("A") ? "B" : "A")), {status: 404});
  assert.equal(reader.calls.length, 0);
  const receipt = await service.read(STRIPE_PI, key);
  assert.equal(receipt.status, "returned"); assert.equal(receipt.payment.state, "settled");
  assert.equal(receipt.payment.releasedCents, 3000);
  assert.doesNotMatch(JSON.stringify(receipt), /acct_|client_secret|billing_details/);
  const failed = createReceiptService({store: {async getRental() {return context.rental;}},
    signingKey: "private-local-fixture-key-32-bytes-long", publicBaseUrl: "https://chargerentstations.com/media-kiosk",
    async observePayment() {throw new Error("Unavailable");}});
  assert.equal((await failed.read(STRIPE_PI, key)).payment.state, "pending");
});
test("projection rejects invented amounts, currency and unsafe logo URLs", () => {
  const value = projectReceipt({rental: rentalFixture({currency: "ZZZ", paymentAmountCents: true}), rentalId: "doc-1", client: {receiptLogo: {url: "https://user:pass@example.com/logo.png", contentType: "image/png"}}});
  assert.equal(value.currency, null); assert.equal(value.payment.upfrontCents, null); assert.equal(value.brand.logoUrl, null);
});
test("explicit transaction identity stays stable as backend order metadata changes", async () => {
  const f = fixture(); const link = f.link(); f.update({rawid: "new-order", orderid: "new-order-id", status: "returned", returnTime: END});
  assert.deepEqual(f.link(), link); assert.equal((await f.service.read(link.transactionId, new URL(link.receiptUrl).searchParams.get("key"))).transactionId, link.transactionId);
});
test("exact rental document and validated client are the only customer lookups", async () => {
  const calls = [];
  const db = {collection(name) {return {doc(id) {return {async get() {calls.push([name, id]); return {exists: name === "rentals", data: () => name === "rentals" ? rentalFixture() : {name: "Venue"}};}};}, where(field, operator, value) {return {limit(max) {return {async get() {calls.push([name, field, operator, value, max]); return {docs: name === "kiosks" ? [{data: () => ({info: {client: "CLIENT12", location: "Venue"}})}] : name === "users" ? [{data: () => ({clientId: "CLIENT12", role: "user", name: "Venue"})}] : []};}};}};}};}};
  const store = createFirestoreReceiptStore(db); const rental = await store.getRental("rental-doc-44");const context = await store.getContext(rental);
  assert.equal(context.client.name, "Venue"); assert.deepEqual(calls[0], ["rentals", "rental-doc-44"]); assert.ok(calls.some(call => call[0] === "users" && call[1] === "clientId" && call[3] === "CLIENT12" && call[4] === 11));
  assert.equal(calls.some(call => call[0] === "rentals" && call.length > 2), false);
});

test("duplicate client user profiles omit branding unless an explicit verified owner is present", async () => {
  const logo = {url: "https://example.com/logo.png", contentType: "image/png"};
  const profiles = [{clientId: "BESITER", role: "user", name: "First", receiptLogo: logo}, {clientId: "BESITER", role: "user", name: "Second", receiptLogo: logo}, {clientId: "BESITER", role: "partner", name: "Partner"}];
  const db = {collection(name) {return {doc(id) {return {async get() {return {exists: id === "verified-owner", data: () => profiles[1]};}};}, where() {return {limit() {return {async get() {return {docs: name === "kiosks" ? [{data: () => ({info: {client: "BESITER"}})}] : name === "users" ? profiles.map(profile => ({data: () => profile})) : []};}};}};}};}};
  const store = createFirestoreReceiptStore(db);
  assert.equal((await store.getContext(rentalFixture())).client, null);
  const owned = await store.getContext(rentalFixture({clientUid: "verified-owner"}));assert.equal(owned.client.name, "Second");
  const projection = projectReceipt({rental: rentalFixture(), rentalId: "doc-1", ...await store.getContext(rentalFixture())});
  assert.equal(projection.brand.name, "Chargerent");assert.equal(projection.brand.logoUrl, null);
});

test("signed receipts use only their rental client's published receipt page after station reassignment",async()=>{
  const {defaultReceiptPage}=await import('./receiptPageProfile.mjs');
  const page=defaultReceiptPage();page.locales.en.returnedTitle='Published client A';page.logo={url:'https://example.com/client-a.png',contentType:'image/png'};
  const rental=rentalFixture({clientId:'CLIENT A'});
  const records=new Map([
    ['rentals/rental-doc-44',rental],
    ['kiosks/station',{stationid:'FR8012',info:{client:'CLIENT_B'},ui:{profileSections:{chargerentApp:{profileId:'client-b'}}}}],
    ['uiProfiles/client-a',{clientId:'CLIENT A',applicationProfiles:{chargerentMedia:{receiptPage:{...page,privateDraft:'PRIVATE'}}},publishedSections:{chargerentApp:{value:{receiptPage:page,stripeUi:{defaultLanguage:'en',enabledLanguages:['en','fr','es']}}}}}],
    ['uiProfiles/client-b',{clientId:'CLIENT_B',publishedSections:{chargerentApp:{value:{receiptPage:{...page,locales:{en:{returnedTitle:'OTHER CLIENT PRIVATE'}}}}}}}],
  ]);
  const snapshot=path=>({id:path.split('/').at(-1),exists:records.has(path),data:()=>records.get(path)});
  const db={collection(name){return {doc:id=>({get:async()=>snapshot(`${name}/${id}`)}),where(field,op,value){assert.equal(op,'==');return {limit(max){return {get:async()=>({docs:[...records.keys()].filter(path=>path.startsWith(name+'/')&&records.get(path)[field]===value).slice(0,max).map(snapshot)})};}};}};}};
  const service=createReceiptService({store:createFirestoreReceiptStore(db),signingKey:'private-local-fixture-key-32-bytes-long',publicBaseUrl:'https://example.com'});
  const link=service.link({rental,rentalId:'rental-doc-44'}),key=new URL(link.receiptUrl).searchParams.get('key');
  const receipt=await service.read(link.transactionId,key);
  assert.equal(receipt.page.locales.en.returnedTitle,'Published client A');
  assert.equal(receipt.page.logo.url,'https://example.com/client-a.png');
  assert.equal(receipt.payment.upfrontCents,3000);
  assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|client-b|CLIENT_B/);
  records.get('uiProfiles/client-a').publishedSections.chargerentApp.value.receiptPage.logo.url='javascript:alert(1)';
  const fallback=await service.read(link.transactionId,key);
  assert.equal(fallback.page,undefined);assert.equal(fallback.payment.upfrontCents,3000,'invalid presentation must not break the receipt');
});
