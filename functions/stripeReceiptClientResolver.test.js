/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {createStripeReceiptClientResolver} = require("./stripeReceiptClientResolver");
const ACCOUNT = "acct_receipt8012";
function source(mode, accountId = ACCOUNT) {
  const reads = [];
  const client = {accounts: {async retrieve() {reads.push("account"); return {id: accountId, country: "FR"};}}};
  return {mode, client, reads, async getClient() {reads.push("provider"); return client;}};
}

test("same account selects distinct test/live clients and caches only that exact mode", async () => {
  const live = source("live"); const testMode = source("test");
  const resolve = createStripeReceiptClientResolver({sources: [live, testMode]});
  assert.equal(await resolve(ACCOUNT, "live"), live.client);
  assert.equal(await resolve(ACCOUNT, "live"), live.client);
  assert.deepEqual(live.reads, ["provider", "account"]); assert.deepEqual(testMode.reads, []);
  assert.equal(await resolve(ACCOUNT, "test"), testMode.client);
  assert.equal(await resolve(ACCOUNT, "test"), testMode.client);
  assert.deepEqual(testMode.reads, ["provider", "account"]);
  assert.equal(await resolve("acct_other", "live"), null);
  assert.equal(await resolve(ACCOUNT, "production"), null);
  assert.equal(await resolve("FR", "live"), null);
});

test("matching country or provider position never substitutes for verified exact account identity", async () => {
  const wrong = source("live", "acct_other"); const correct = source("live");
  const resolve = createStripeReceiptClientResolver({sources: [wrong, correct]});
  assert.equal(await resolve(ACCOUNT, "live"), correct.client);
  assert.equal(await createStripeReceiptClientResolver({sources: [wrong]})(ACCOUNT, "live"), null);
  assert.equal(await resolve("pi_receipt8012", "live"), null);
});

test("absent credentials, failed identity reads and ambiguous sources remain unresolved", async () => {
  assert.equal(await createStripeReceiptClientResolver()(ACCOUNT, "live"), null);
  const absent = {mode: "live", getClient: () => null};
  assert.equal(await createStripeReceiptClientResolver({sources: [absent]})(ACCOUNT, "live"), null);
  assert.equal(await createStripeReceiptClientResolver({sources: [source("live"), absent]})(ACCOUNT, "live"), null);
  const unavailable = {mode: "live", getClient() {throw new Error("Unavailable");}};
  assert.equal(await createStripeReceiptClientResolver({sources: [unavailable]})(ACCOUNT, "live"), null);
  assert.equal(await createStripeReceiptClientResolver({sources: [source("live"), unavailable]})(ACCOUNT, "live"), null);
  const unreadable = {mode: "live", getClient: () => ({accounts: {retrieve() {throw new Error("Unavailable");}}})};
  assert.equal(await createStripeReceiptClientResolver({sources: [unreadable]})(ACCOUNT, "live"), null);
  assert.equal(await createStripeReceiptClientResolver({sources: [source("live"), source("live")]})(ACCOUNT, "live"), null);
});

test("unresolved source errors are never cached and a later verified read can recover", async () => {
  let unavailable = true; const live = source("live");
  const resolve = createStripeReceiptClientResolver({sources: [{mode: "live", getClient() {
    if (unavailable) throw new Error("Unavailable"); return live.client;
  }}]});
  assert.equal(await resolve(ACCOUNT, "live"), null); assert.deepEqual(live.reads, []);
  unavailable = false;
  assert.equal(await resolve(ACCOUNT, "live"), live.client);
  assert.equal(await resolve(ACCOUNT, "live"), live.client);
  assert.deepEqual(live.reads, ["account"]);
});
