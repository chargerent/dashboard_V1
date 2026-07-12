import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flowPath = path.resolve(root, '..', 'node-red', 'apriva-refund-flow.json');
const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
const byId = new Map(flow.map((item) => [item.id, item]));
const externalIds = new Set(['c3de31027aa4b97b', '3781d0fd43639060']);

assert.equal(byId.size, flow.length, 'Node IDs must be unique');
assert.equal(byId.get('apriva_prod_tab')?.disabled, true, 'Production tab must be disabled on import');
assert.equal(byId.get('apriva_uat_inject')?.once, false, 'UAT smoke test must never run on deploy');
assert.equal(byId.get('apriva_uat_settled_inject')?.once, false, 'Settled refund test must never run on deploy');

for (const item of flow) {
  for (const target of [...(item.wires || []).flat(), ...(item.links || [])]) {
    assert.ok(byId.has(target) || externalIds.has(target), `${item.id} points to missing node ${target}`);
  }
  if (item.type === 'function') {
    new Function('msg', 'node', 'flow', 'env', 'Buffer', item.func);
  }
}

const state = new Map();
const nodeApi = { warn() {}, error() {}, status() {} };
const flowApi = { get: (key) => state.get(key), set: (key, value) => state.set(key, value) };
const envApi = { get: () => '' };
const run = (id, msg) => new Function('msg', 'node', 'flow', 'env', 'Buffer', byId.get(id).func)(msg, nodeApi, flowApi, envApi, Buffer);

const [lookup] = run('apriva_prod_lookup', {
  payload: { action: 'refund', gateway: 'APOLLO', transactionid: 'ba02c30b-ad50', amount: 'full', admin: 'admin-1' },
});
assert.equal(lookup.payload.query[0].fieldPath, 'orderid');

lookup.payload = [{
  orderid: 'ba02c30b-ad50',
  rawid: 'ba02c30b-ad50-4ef3-b75e-1158b21ad580',
  gateway: 'APOLLO',
  status: 'purchased',
  purchaseCommitStatus: 'APPROVED',
  totalCharged: 35,
  authorizationHostReference: '1045000000',
  terminalserver: 'live',
  rentalStationid: 'CA0008',
}];
const [purchased, pending, validationFailure] = run('apriva_prod_validate', lookup);
assert.ok(purchased);
assert.equal(pending, null);
assert.equal(validationFailure, null);
assert.equal(purchased._aprivaRequest.hostTransactionId, '1045000000');
assert.equal(purchased._aprivaRequest.amountCents, 3500);

const missingId = structuredClone(lookup);
missingId.payload[0].authorizationHostReference = '';
const [, , missingIdFailure] = run('apriva_prod_validate', missingId);
assert.equal(missingIdFailure._aprivaError.code, 'missing_apriva_host_transaction_id');

const pendingRental = structuredClone(lookup);
pendingRental.payload[0].status = 'pending';
pendingRental.payload[0].purchaseCommitStatus = '';
pendingRental.payload[0].paymentState = 'AUTHORIZED';
const pendingRawid = pendingRental.payload[0].rawid;
const [, cpsCancel] = run('apriva_prod_validate', pendingRental);
assert.equal(cpsCancel.payload.transactionid, pendingRawid);

const verified = structuredClone(purchased);
verified.statusCode = 200;
verified.payload = JSON.stringify({
  parent_host_transaction_id: '1045000000',
  host_transaction_id: '1045000001',
  amount: 3500,
  transaction_type: 'refund',
  response_code: '0',
  response_text: 'Success',
  unique_request_id: 'request-1',
});
const [approved, adjustOnSuccess, rejected] = run('apriva_prod_verify', verified);
assert.ok(approved);
assert.equal(adjustOnSuccess, null);
assert.equal(rejected, null);

const [refundRequest] = run('apriva_prod_build_refund', {
  ...structuredClone(purchased),
  _aprivaAccessToken: 'test-token',
  _aprivaConfig: { paymentApi: 'https://example.test/pay/v2', platformKey: 'test-key', agent: 'test-agent' },
});
assert.deepEqual(JSON.parse(refundRequest.payload), {
  amount: 3500,
  host_transaction_id: '1045000000',
});

const openBatch = {
  ...structuredClone(purchased),
  _aprivaAccessToken: 'test-token',
  _aprivaConfig: { paymentApi: 'https://example.test/pay/v2', platformKey: 'test-key', agent: 'test-agent' },
  statusCode: 400,
  payload: JSON.stringify({ Message: 'Transaction is in an open batch. Please use adjust instead.' }),
};
const [refundOnOpenBatch, adjustRequest, openBatchFailure] = run('apriva_prod_verify', openBatch);
assert.equal(refundOnOpenBatch, null);
assert.equal(openBatchFailure, null);
assert.equal(adjustRequest.url, 'https://example.test/pay/v2/payments/adjust');
assert.deepEqual(JSON.parse(adjustRequest.payload), {
  amount: 0,
  host_transaction_id: '1045000000',
});

adjustRequest.statusCode = 200;
adjustRequest.payload = JSON.stringify({
  response_code: '0',
  response_text: 'Test Processor Success',
  unique_request_id: 'adjust-request-1',
});
const [adjustApproved, adjustRejected] = run('apriva_prod_verify_adjust', adjustRequest);
assert.ok(adjustApproved);
assert.equal(adjustRejected, null);
assert.equal(adjustApproved._aprivaProviderResponse.operation, 'adjust');

const update = run('apriva_prod_success_update', approved);
assert.equal(update.payload.path, 'rentals/ba02c30b-ad50');
assert.equal(update.payload.content.status, 'refunded');
assert.equal(update.payload.content.totalCharged, 0);
assert.equal(update.payload.content.aprivaRefundHostTransactionId, '1045000001');
assert.equal(Object.hasOwn(update.payload.content, 'returnTime'), false);

const adjustUpdate = run('apriva_prod_success_update', adjustApproved);
assert.equal(adjustUpdate.payload.content.paymentStatus, 'VOIDED');
assert.equal(adjustUpdate.payload.content.aprivaTransactionOperation, 'adjust');
assert.equal(adjustUpdate.payload.content.aprivaAdjustedAmountCents, 0);

const uatCharge = {
  statusCode: 200,
  payload: JSON.stringify({
    host_transaction_id: '1000000001',
    amount: 300,
    response_code: '0',
    response_text: 'Test Processor Success',
    unique_request_id: 'uat-charge-1',
  }),
  _aprivaUat: {
    paymentApi: 'https://example.test/pay/v2',
    platformKey: 'test-key',
    accessToken: 'test-token',
    amountCents: 300,
    testMode: 'settled-refund',
  },
};
const [openBatchTest, settlementRequest, uatChargeFailure] = run('apriva_uat_parse_charge', uatCharge);
assert.equal(openBatchTest, null);
assert.ok(settlementRequest);
assert.equal(uatChargeFailure, null);
assert.equal(settlementRequest.url, 'https://example.test/pay/v2/payments/settlement');

settlementRequest.statusCode = 200;
settlementRequest.payload = JSON.stringify({
  response_code: '0',
  response_text: 'Test Processor Success',
  batch_number: 42,
  unique_request_id: 'uat-settlement-1',
});
const [statusPoll, settlementFailure] = run('apriva_uat_verify_settlement', settlementRequest);
assert.ok(statusPoll);
assert.equal(settlementFailure, null);
const historyRequest = run('apriva_uat_build_history_query', statusPoll);
assert.match(historyRequest.url, /payments\?/);

historyRequest.statusCode = 200;
historyRequest.payload = JSON.stringify({
  transactions: [{ host_transaction_id: '1000000001', settled: false, batch_number: 42 }],
});
const [prematureRefund, retryHistory, historyFailure] = run('apriva_uat_verify_history', historyRequest);
assert.equal(prematureRefund, null);
assert.ok(retryHistory);
assert.equal(historyFailure, null);

const settledHistoryRequest = run('apriva_uat_build_history_query', retryHistory);
settledHistoryRequest.statusCode = 200;
settledHistoryRequest.payload = JSON.stringify({
  transactions: [{ host_transaction_id: '1000000001', settled: true, batch_number: 42 }],
});
const [trueRefundRequest, unexpectedHistoryRetry, settledHistoryFailure] = run('apriva_uat_verify_history', settledHistoryRequest);
assert.ok(trueRefundRequest);
assert.equal(unexpectedHistoryRetry, null);
assert.equal(settledHistoryFailure, null);
assert.deepEqual(JSON.parse(trueRefundRequest.payload), {
  amount: 300,
  host_transaction_id: '1000000001',
});

const refundPropagationLag = structuredClone(trueRefundRequest);
refundPropagationLag.statusCode = 400;
refundPropagationLag.payload = JSON.stringify({
  Message: 'Transaction is in an open batch. Please use adjust instead.',
});
const [lagSuccess, lagAdjust, lagFailure, lagRetry] = run('apriva_uat_verify_refund', refundPropagationLag);
assert.equal(lagSuccess, null);
assert.equal(lagAdjust, null);
assert.equal(lagFailure, null);
assert.ok(lagRetry);
assert.equal(lagRetry._aprivaUat.settlement.refundRetries, 1);

trueRefundRequest.statusCode = 200;
trueRefundRequest.payload = JSON.stringify({
  parent_host_transaction_id: '1000000001',
  host_transaction_id: '1000000002',
  amount: 300,
  transaction_type: 'refund',
  response_code: '0',
  response_text: 'Test Processor Success',
});
const [trueRefundSuccess, unexpectedAdjust, trueRefundFailure] = run('apriva_uat_verify_refund', trueRefundRequest);
assert.ok(trueRefundSuccess);
assert.equal(unexpectedAdjust, null);
assert.equal(trueRefundFailure, null);
assert.equal(trueRefundSuccess.payload.resolution.operation, 'refund');
assert.equal(trueRefundSuccess.payload.settlement.batchNumber, 42);

console.log(`Validated ${flow.length} Node-RED nodes and guarded refund behavior.`);
