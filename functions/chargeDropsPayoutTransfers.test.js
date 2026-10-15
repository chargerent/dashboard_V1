/* eslint-env node */

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createChargeDropsPayoutTransfers,
} = require("./chargeDropsPayoutTransfers");

const PLATFORM_ACCOUNT_ID = "acct_1BGtrxCUzeellHd0";

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function setup({agreementStatus = "fully_executed", balance = 5000, mode = "live"} = {}) {
  const report = {
    type: "purchase_approval",
    model: "chargedrops",
    status: "pending_approval",
    currency: "usd",
    revenueBasis: "gross_minus_refunds_and_taxes_v1",
    period: {label: "September 2026"},
    client: {uid: "client-uid", clientId: "HUDSON"},
    totals: {grossRevenue: 100, refunds: 10, taxes: 5, qualifyingRevenue: 85, clientShare: 17},
  };
  const profile = {
    product: "chargedrops",
    chargedrops: {
      onboarding: {agreementStatus},
      payout: {
        mode: "live",
        ready: true,
        accounts: {live: "acct_client123456"},
      },
    },
  };
  const records = new Map([
    ["payoutReports/report-1", clone(report)],
    ["users/client-uid", clone(profile)],
  ]);
  const writes = [];
  const db = {
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return {
            async get() {
              const value = records.get(path);
              return {exists: value !== undefined, data: () => clone(value)};
            },
            async set(value, options) {
              const current = records.get(path) || {};
              records.set(path, clone(options?.merge ? {...current, ...value} : value));
              writes.push({path, value: clone(value)});
            },
          };
        },
      };
    },
  };
  const calls = [];
  const stripe = {
    accounts: {
      async retrieve(id) {
        calls.push({operation: "accounts.retrieve", id});
        return {id: PLATFORM_ACCOUNT_ID};
      },
    },
    balance: {
      async retrieve() {
        calls.push({operation: "balance.retrieve"});
        return {available: [{currency: "usd", amount: balance}]};
      },
    },
    transfers: {
      async create(params, options) {
        calls.push({operation: "transfers.create", params, options});
        return {id: "tr_test123456", livemode: true};
      },
    },
  };
  const service = createChargeDropsPayoutTransfers({
    db,
    admin: {firestore: {FieldValue: {serverTimestamp: () => "server-time"}}},
    getStripeClient: () => ({stripe, mode}),
    expectedPlatformAccountId: PLATFORM_ACCOUNT_ID,
    logger: {error() {}},
  });
  return {calls, records, service, writes};
}

test("admin approval creates one idempotent live Stripe transfer", async () => {
  const {calls, records, service} = setup();
  const result = await service.approve({
    reportId: "report-1",
    authState: {uid: "admin-uid", isAdmin: true, profile: {username: "george"}},
  });

  assert.equal(result.transfer.id, "tr_test123456");
  const transferCall = calls.find((call) => call.operation === "transfers.create");
  assert.equal(transferCall.params.amount, 1700);
  assert.equal(transferCall.params.currency, "usd");
  assert.equal(transferCall.params.destination, "acct_client123456");
  assert.equal(transferCall.options.idempotencyKey, "chargedrops-client-payout-report-1");
  assert.equal(records.get("payoutReports/report-1").status, "transferred");
  assert.equal(records.get("payoutReports/report-1").transfer.platformAccountId, PLATFORM_ACCOUNT_ID);
});

test("payout is blocked until Ocharge countersigns", async () => {
  const {calls, service} = setup({agreementStatus: "client_signed"});
  await assert.rejects(
      service.approve({
        reportId: "report-1",
        authState: {uid: "admin-uid", isAdmin: true},
      }),
      (error) => error.code === "failed-precondition" && /countersign/i.test(error.message),
  );
  assert.equal(calls.length, 0);
});

test("payout fails safely when Stripe available balance is too low", async () => {
  const {calls, records, service} = setup({balance: 1000});
  await assert.rejects(
      service.approve({
        reportId: "report-1",
        authState: {uid: "admin-uid", isAdmin: true},
      }),
      (error) => error.code === "failed-precondition" && /Chase/i.test(error.message),
  );
  assert.equal(calls.some((call) => call.operation === "transfers.create"), false);
  assert.equal(records.get("payoutReports/report-1").status, "pending_approval");
});

test("test-mode credentials cannot move a real client payout", async () => {
  const {service} = setup({mode: "test"});
  await assert.rejects(
      service.approve({
        reportId: "report-1",
        authState: {uid: "admin-uid", isAdmin: true},
      }),
      (error) => error.code === "failed-precondition" && /live Ocharge/i.test(error.message),
  );
});
