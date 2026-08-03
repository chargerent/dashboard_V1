import fs from 'node:fs';

const [inputPath, outputPath = inputPath] = process.argv.slice(2);
if (!inputPath) {
    throw new Error('Usage: node scripts/patch-apo-pending-lifecycle.mjs <input-flow.json> [output-flow.json]');
}

const flow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const byId = new Map(flow.map(node => [node.id, node]));
const requireNode = id => {
    const node = byId.get(id);
    if (!node) throw new Error(`Required Node-RED node not found: ${id}`);
    return node;
};

const prepare = requireNode('apo_auto_prepare_cancel');
prepare.func = `const asStr = v => (v == null ? "" : String(v)).trim();
const nowISO = () => new Date().toISOString();

const r = Array.isArray(msg.payload) ? msg.payload[0] : (msg.payload || {});
const ctx = msg._apoFailedVendContext || msg._apoPendingTimeoutContext || {};
const orderid = asStr(r.orderid || ctx.orderid);
const rawid = asStr(r.rawid || r.paymentSessionId || ctx.rawid);
const terminalsn = asStr(r.terminalsn || r.paymentTerminalSn || r.terminalSn);
const terminalserver = asStr(r.terminalserver || r.terminalServer || 'live').toLowerCase() || 'live';
const gateway = asStr(r.gateway).toUpperCase();
const status = asStr(r.status).toLowerCase();
const refundStatus = asStr(r.refundStatus).toLowerCase();
const now = nowISO();

if (!orderid) {
  node.warn({ event: 'APO_AUTO_CANCEL_MISSING_ORDERID', ctx });
  return null;
}
if (gateway !== 'APOLLO') {
  node.warn({ event: 'APO_AUTO_CANCEL_SKIPPED_NON_APOLLO', orderid, gateway });
  return null;
}
if (status !== 'pending') {
  node.warn({ event: 'APO_AUTO_CANCEL_SKIPPED_NOT_PENDING', orderid, status });
  return null;
}
if (refundStatus || r.refundProcessed || r.autoRefundStartedAt) {
  node.warn({ event: 'APO_AUTO_CANCEL_SKIPPED_ALREADY_STARTED', orderid, refundStatus, autoRefundStartedAt: r.autoRefundStartedAt || null });
  return null;
}
if (!rawid || !terminalsn) {
  node.warn({ event: 'APO_AUTO_CANCEL_MISSING_CPS_FIELDS', orderid, rawid, terminalsn });
  return null;
}

const source = asStr(ctx.source || 'unknown');
const reason = source === 'stale-pending-sweep'
  ? 'apollo_pending_timeout_no_dispense'
  : 'apollo_vend_not_dispensed';
const processLog = Array.isArray(r.processLog) ? r.processLog.slice(-98) : [];
processLog.push({
  event: 'apollo-pending-timeout-detected',
  status: 'warning',
  timestamp: ctx.timedOutAt || now,
  previousStatus: status,
  reason,
  ageMs: ctx.ageMs || null,
  source
});
processLog.push({
  event: 'apollo-payment-action-queued',
  action: 'cancel',
  status: 'queued',
  timestamp: now,
  reason,
  source
});

const content = {
  status: 'vend_failed',
  vendState: 'failed',
  failureReason: reason,
  failedAt: now,
  currentVendAttempt: null,
  subtotal: 0,
  tax: 0,
  totalCharged: 0,
  overdue: 0,
  refundProcessed: false,
  refundTransactionid: rawid,
  refundStatus: 'cancel-pending',
  refundAmount: 0,
  paymentAction: 'cancel',
  paymentActionStatus: 'queued',
  paymentActionReason: reason,
  paymentActionQueuedAt: now,
  cleanupPreviousStatus: status,
  cleanupReason: reason,
  cleanupStartedAt: now,
  autoRefundReason: reason,
  autoRefundSource: source,
  autoRefundStartedAt: now,
  autoRefundVendFailure: ctx,
  processLog,
  lastUpdate: now
};
if (ctx.sn) content.failedVendChargerSn = String(ctx.sn);

msg._apoAutoCancel = {
  orderid,
  rawid,
  terminalsn,
  terminalserver,
  source,
  reason,
  startedAt: now,
  processLog
};
msg.commitTerminalserver = terminalserver;
msg.commitTerminalsn = terminalsn;
msg.commitRawid = rawid;
msg.payload = { path: 'rentals/' + orderid, content, merge: true };
node.warn({ event: 'APO_AUTO_CANCEL_MARK_PENDING', orderid, rawid, terminalsn, terminalserver, source, reason });
return msg;`;

const finalize = requireNode('apo_auto_finalize_cancel');
finalize.func = `const asStr = v => (v == null ? "" : String(v)).trim();
const nowISO = () => new Date().toISOString();

const ctx = msg._apoAutoCancel || {};
const p = msg.payload || {};
const orderid = asStr(ctx.orderid);
const now = nowISO();
if (!orderid) {
  node.warn({ event: 'APO_AUTO_CANCEL_FINALIZE_MISSING_ORDERID', ctx });
  return null;
}

const state = asStr(p.state).toUpperCase();
const result = asStr(p.result).toUpperCase();
const sessionId = asStr(p.sessionId || ctx.rawid);
const cancelSucceeded = state === 'CANCELLED' || state === 'CANCELED' || (result === 'APPROVED' && /CANCEL/.test(state));
const processLog = Array.isArray(ctx.processLog) ? ctx.processLog.slice(-99) : [];
const error = asStr(p.message || p.error || p.error_description || msg.error?.message || 'CPS cancel did not confirm CANCELLED');
processLog.push({
  event: cancelSucceeded ? 'apollo-cancel-verified' : 'apollo-cancel-failed',
  action: 'cancel',
  status: cancelSucceeded ? 'cancelled' : 'failed',
  timestamp: now,
  state: state || null,
  result: result || null,
  sessionId: sessionId || ctx.rawid || null,
  ...(cancelSucceeded ? {} : { error })
});

const content = {
  paymentStatus: cancelSucceeded ? 'CANCELLED' : (result || state || 'UNKNOWN'),
  paymentResult: result || null,
  paymentState: state || null,
  paymentSessionId: sessionId || ctx.rawid || null,
  paymentTerminalSn: asStr(p.serialNumber || ctx.terminalsn) || null,
  paymentUpdatedAt: now,
  paymentAction: 'cancel',
  paymentActionStatus: cancelSucceeded ? 'cancelled' : 'cancel-failed',
  paymentActionCompletedAt: now,
  refundStatus: cancelSucceeded ? 'cancelled' : 'cancel-failed',
  refundProcessed: cancelSucceeded,
  refundCompleted: false,
  refundCompletedDate: null,
  refundTransactionid: sessionId || ctx.rawid || null,
  cancellationCompleted: cancelSucceeded,
  cancellationCompletedAt: cancelSucceeded ? now : null,
  autoRefundCancelSucceeded: cancelSucceeded,
  autoRefundCancelResponseAt: now,
  autoRefundCancelState: state || null,
  autoRefundCancelResult: result || null,
  cpsCancelConfirmed: cancelSucceeded,
  cpsCancelState: state || null,
  cpsCancelResult: result || null,
  cpsCancelStatusCode: msg.statusCode || null,
  cpsCancelLastAttemptAt: now,
  cpsCancelAttemptCount: Number(ctx.attemptCount || 0) + 1,
  cleanupCompletedAt: cancelSucceeded ? now : null,
  processLog,
  lastUpdate: now
};
if (!cancelSucceeded) {
  content.refundError = error;
  content.refundErrorStatusCode = msg.statusCode || null;
  content.paymentActionError = error;
  node.warn({ event: 'APO_AUTO_CANCEL_FAILED', orderid, state, result, statusCode: msg.statusCode || null, error });
} else {
  node.warn({ event: 'APO_AUTO_CANCEL_CANCELLED', orderid, state, result, sessionId });
}
msg.payload = { path: 'rentals/' + orderid, content, merge: true };
return msg;`;

const retryFilter = requireNode('apo_cancel_retry_filter');
const oldGuard = 'if (gateway !== "APOLLO" || status !== "returned" || Number(r.totalCharged || 0) !== 0) {';
const newGuard = 'if (gateway !== "APOLLO" || !["returned", "vend_failed"].includes(status) || Number(r.totalCharged || 0) !== 0) {';
if (!retryFilter.func.includes(oldGuard) && !retryFilter.func.includes(newGuard)) {
    throw new Error('Apollo retry eligibility guard no longer matches the expected deployed flow');
}
retryFilter.func = retryFilter.func.replace(oldGuard, newGuard);

fs.writeFileSync(outputPath, `${JSON.stringify(flow, null, 4)}\n`);
console.log(JSON.stringify({
    outputPath,
    patchedNodes: [prepare.id, finalize.id, retryFilter.id],
}));
