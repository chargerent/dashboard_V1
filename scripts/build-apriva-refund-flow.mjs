import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.resolve(root, '..', 'node-red', 'apriva-refund-flow.json');

const node = (id, type, z, x, y, extra = {}) => ({ id, type, z, x, y, ...extra });
const functionNode = (id, z, name, x, y, outputs, func, wires) => node(id, 'function', z, x, y, {
  name,
  func: func.trim(),
  outputs,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  wires,
});
const httpNode = (id, z, name, x, y, wires) => node(id, 'http request', z, x, y, {
  name,
  method: 'POST',
  ret: 'txt',
  paytoqs: 'ignore',
  url: '',
  tls: '',
  persist: false,
  proxy: '',
  insecureHTTPParser: false,
  authType: '',
  senderr: true,
  headers: [],
  wires,
});
const debugNode = (id, z, name, x, y) => node(id, 'debug', z, x, y, {
  name,
  active: true,
  tosidebar: true,
  console: false,
  tostatus: false,
  complete: 'payload',
  targetType: 'msg',
  statusVal: '',
  statusType: 'auto',
  wires: [],
});

const UAT_TAB = 'apriva_uat_tab';
const PROD_TAB = 'apriva_prod_tab';

const flow = [
  {
    id: UAT_TAB,
    type: 'tab',
    label: 'Apriva PWS - UAT Smoke Test',
    disabled: false,
    info: 'Manual-only Apriva UAT charge/reversal smoke test. It uses refund for closed batches and adjustment for open batches. It never runs on deploy.',
    env: [],
  },
  {
    id: PROD_TAB,
    type: 'tab',
    label: 'Apriva PWS - Purchased Refund',
    disabled: true,
    info: 'Production-ready purchased-refund handler. Disabled on import. Requires an Apriva host transaction ID and explicit production environment gate.',
    env: [],
  },

  node('apriva_uat_comment', 'comment', UAT_TAB, 250, 80, {
    name: 'MANUAL UAT ONLY: creates a $3.00 test charge and reverses it through refund or adjust',
    info: 'Set APRIVA_CLIENT_ID, APRIVA_CLIENT_SECRET and APRIVA_PLATFORM_KEY in the Node-RED environment. Defaults are UAT endpoints from the supplied Postman collection.',
    wires: [],
  }),
  node('apriva_uat_inject', 'inject', UAT_TAB, 180, 140, {
    name: 'Test 1: open-batch charge + reversal',
    props: [{ p: 'payload' }],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '{"testMode":"open-batch-reversal"}',
    payloadType: 'json',
    wires: [['apriva_uat_build_token']],
  }),
  node('apriva_uat_settled_inject', 'inject', UAT_TAB, 180, 200, {
    name: 'Test 2: charge + settle + true refund',
    props: [{ p: 'payload' }],
    repeat: '',
    crontab: '',
    once: false,
    onceDelay: 0.1,
    topic: '',
    payload: '{"testMode":"settled-refund"}',
    payloadType: 'json',
    wires: [['apriva_uat_build_token']],
  }),
  functionNode('apriva_uat_build_token', UAT_TAB, 'Build guarded UAT token request', 430, 150, 2, `
const getEnv = (key, fallback = '') => String(env.get(key) || fallback).trim();
const testMode = String(msg.payload?.testMode || 'open-batch-reversal').trim();
const tokenApi = getEnv('APRIVA_TOKEN_API', 'https://aibapp53.aprivaeng.com:9464').replace(/\\/$/, '');
const paymentApi = getEnv('APRIVA_PAYMENT_API', 'https://paymentwebservice-uat.aprivaeng.com/pay/v2').replace(/\\/$/, '');
const productId = getEnv('APRIVA_PRODUCT_ID', '1096');
const clientId = getEnv('APRIVA_CLIENT_ID');
const clientSecret = getEnv('APRIVA_CLIENT_SECRET');
const platformKey = getEnv('APRIVA_PLATFORM_KEY');
const scope = getEnv('APRIVA_SCOPE', 'https://ws.api.apriva.com/auth/user');
const accessUri = getEnv('APRIVA_ACCESS_URI', 'https://aibapp53.aprivaeng.com:9467');
const mode = getEnv('APRIVA_MODE', 'uat').toLowerCase();

if (mode !== 'uat' || !/uat|aprivaeng/i.test(paymentApi)) {
    msg.payload = { ok: false, stage: 'guard', error: 'UAT smoke test refused a non-UAT configuration' };
    return [null, msg];
}
if (!clientId || !clientSecret || !platformKey) {
    msg.payload = { ok: false, stage: 'config', error: 'Missing APRIVA_CLIENT_ID, APRIVA_CLIENT_SECRET, or APRIVA_PLATFORM_KEY' };
    return [null, msg];
}

if (!['open-batch-reversal', 'settled-refund'].includes(testMode)) {
    msg.payload = { ok: false, stage: 'guard', error: 'Unknown UAT test mode' };
    return [null, msg];
}
msg._aprivaUat = { paymentApi, platformKey, amountCents: 300, testMode };
msg.url = tokenApi + '/o/' + encodeURIComponent(productId) + '/oauth2/token';
msg.headers = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
};
msg.payload = [
    ['grant_type', 'client_credentials'],
    ['scope', scope],
    ['access_uri', accessUri],
    ['timestamp', String(Math.floor(Date.now() / 1000))]
].map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
return [msg, null];
  `, [['apriva_uat_token_http'], ['apriva_uat_error']]),
  httpNode('apriva_uat_token_http', UAT_TAB, 'Apriva UAT OAuth token', 700, 150, [['apriva_uat_parse_token']]),
  functionNode('apriva_uat_parse_token', UAT_TAB, 'Parse token + build $3 charge', 950, 150, 2, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message, raw: body.slice(0, 500) }; }
}
if (Number(msg.statusCode) !== 200 || !body?.access_token) {
    msg.payload = { ok: false, stage: 'oauth', httpStatus: Number(msg.statusCode) || 0, error: body?.error_description || body?.error || 'Apriva OAuth failed' };
    return [null, msg];
}

const ctx = msg._aprivaUat;
ctx.accessToken = body.access_token;
msg.url = ctx.paymentApi + '/payments/charge';
msg.headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Apriva-Platform-Key': ctx.platformKey,
    Authorization: 'Bearer ' + ctx.accessToken,
    'Apriva-Agent': 'ChargeRent-NodeRED-Refund-UAT/1.0'
};
msg.payload = JSON.stringify({
    amount: ctx.amountCents,
    manual_card_data: {
        card_number: '4012000033330026',
        card_present: true,
        expiration_month: 6,
        expiration_year: 35
    }
});
return [msg, null];
  `, [['apriva_uat_charge_http'], ['apriva_uat_error']]),
  httpNode('apriva_uat_charge_http', UAT_TAB, 'Apriva UAT $3 charge', 1200, 150, [['apriva_uat_parse_charge']]),
  functionNode('apriva_uat_parse_charge', UAT_TAB, 'Verify charge + route test mode', 1450, 150, 3, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message, raw: body.slice(0, 500) }; }
}
const hostId = String(body?.host_transaction_id || '').trim();
const success = Number(msg.statusCode) >= 200 && Number(msg.statusCode) < 300 && String(body?.response_code) === '0' && hostId;
if (!success) {
    msg.payload = { ok: false, stage: 'charge', httpStatus: Number(msg.statusCode) || 0, responseCode: body?.response_code, error: body?.response_text || body?.error || 'Apriva test charge failed' };
    return [null, msg];
}

const ctx = msg._aprivaUat;
ctx.sale = {
    hostTransactionId: hostId,
    uniqueRequestId: body.unique_request_id || null,
    amountCents: Number(body.amount ?? ctx.amountCents)
};
if (ctx.testMode === 'settled-refund') {
    msg.url = ctx.paymentApi + '/payments/settlement';
    msg.headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Apriva-Platform-Key': ctx.platformKey,
        Authorization: 'Bearer ' + ctx.accessToken,
        'Apriva-Agent': 'ChargeRent-NodeRED-Refund-UAT/1.0'
    };
    msg.payload = JSON.stringify({
        unique_request_id: 'settlement-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    });
    return [null, msg, null];
}
msg.url = ctx.paymentApi + '/payments/refund';
msg.headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Apriva-Platform-Key': ctx.platformKey,
    Authorization: 'Bearer ' + ctx.accessToken,
    'Apriva-Agent': 'ChargeRent-NodeRED-Refund-UAT/1.0'
};
msg.payload = JSON.stringify({
    amount: ctx.sale.amountCents,
    host_transaction_id: hostId
});
return [msg, null, null];
  `, [['apriva_uat_refund_delay'], ['apriva_uat_settlement_http'], ['apriva_uat_error']]),
  node('apriva_uat_refund_delay', 'delay', UAT_TAB, 1690, 150, {
    name: 'Wait 8s for charge to become refundable',
    pauseType: 'delay',
    timeout: '8',
    timeoutUnits: 'seconds',
    rate: '1',
    nbRateUnits: '1',
    rateUnits: 'second',
    randomFirst: '1',
    randomLast: '5',
    randomUnits: 'seconds',
    drop: false,
    outputs: 1,
    wires: [['apriva_uat_refund_http']],
  }),
  httpNode('apriva_uat_refund_http', UAT_TAB, 'Apriva UAT full refund', 1920, 150, [['apriva_uat_verify_refund']]),
  httpNode('apriva_uat_settlement_http', UAT_TAB, 'Settle UAT test-device batch', 1700, 320, [['apriva_uat_verify_settlement']]),
  functionNode('apriva_uat_verify_settlement', UAT_TAB, 'Verify settlement response', 1950, 320, 2, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message, raw: body.slice(0, 500) }; }
}
const ctx = msg._aprivaUat || {};
const success = Number(msg.statusCode) >= 200 && Number(msg.statusCode) < 300 && String(body?.response_code) === '0';
if (!success) {
    msg.payload = {
        ok: false,
        stage: 'settlement',
        httpStatus: Number(msg.statusCode) || 0,
        responseCode: body?.response_code ?? null,
        error: body?.response_text || body?.Message || body?.message || body?.error || 'Apriva UAT settlement failed'
    };
    return [null, msg];
}
ctx.settlement = {
    batchNumber: body.batch_number ?? null,
    uniqueRequestId: body.unique_request_id || null,
    responseCode: String(body.response_code),
    responseText: body.response_text || 'Success',
    polls: 0
};
return [msg, null];
  `, [['apriva_uat_build_history_query'], ['apriva_uat_error']]),
  functionNode('apriva_uat_build_history_query', UAT_TAB, 'Build settled transaction status query', 2200, 320, 1, `
const ctx = msg._aprivaUat || {};
if (!ctx.sale?.hostTransactionId || !ctx.accessToken) {
    msg.payload = { ok: false, stage: 'settlement-status', error: 'Missing UAT sale or access token context' };
    return msg;
}
const query = [
    ['payload.host_transaction_id', ctx.sale.hostTransactionId],
    ['payload.max_results', '10']
].map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
msg.url = ctx.paymentApi + '/payments?' + query;
msg.headers = {
    Accept: 'application/json',
    'Apriva-Platform-Key': ctx.platformKey,
    Authorization: 'Bearer ' + ctx.accessToken,
    'Apriva-Agent': 'ChargeRent-NodeRED-Refund-UAT/1.0'
};
msg.payload = '';
return msg;
  `, [['apriva_uat_settlement_poll_delay']]),
  node('apriva_uat_settlement_poll_delay', 'delay', UAT_TAB, 2450, 320, {
    name: 'Poll settlement every 5s',
    pauseType: 'delay',
    timeout: '5',
    timeoutUnits: 'seconds',
    rate: '1',
    nbRateUnits: '1',
    rateUnits: 'second',
    randomFirst: '1',
    randomLast: '5',
    randomUnits: 'seconds',
    drop: false,
    outputs: 1,
    wires: [['apriva_uat_history_http']],
  }),
  node('apriva_uat_history_http', 'http request', UAT_TAB, 2680, 320, {
    name: 'Read Apriva transaction status',
    method: 'GET',
    ret: 'txt',
    paytoqs: 'ignore',
    url: '',
    tls: '',
    persist: false,
    proxy: '',
    insecureHTTPParser: false,
    authType: '',
    senderr: true,
    headers: [],
    wires: [['apriva_uat_verify_history']],
  }),
  functionNode('apriva_uat_verify_history', UAT_TAB, 'Wait until charge is visible as settled', 2930, 320, 3, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message, raw: body.slice(0, 500) }; }
}
const ctx = msg._aprivaUat || {};
const rows = Array.isArray(body?.transactions) ? body.transactions : [];
const transaction = rows.find(row => String(row?.host_transaction_id || '') === String(ctx.sale?.hostTransactionId || ''));

if (Number(msg.statusCode) < 200 || Number(msg.statusCode) >= 300) {
    msg.payload = {
        ok: false,
        stage: 'settlement-status',
        httpStatus: Number(msg.statusCode) || 0,
        error: body?.Message || body?.message || body?.error || 'Apriva transaction history query failed'
    };
    return [null, null, msg];
}

if (!transaction || transaction.settled !== true) {
    ctx.settlement.polls = Number(ctx.settlement.polls || 0) + 1;
    if (ctx.settlement.polls >= 12) {
        msg.payload = {
            ok: false,
            stage: 'settlement-status',
            error: 'Timed out waiting for Apriva to report the charge as settled',
            hostTransactionId: ctx.sale?.hostTransactionId || null,
            polls: ctx.settlement.polls
        };
        return [null, null, msg];
    }
    return [null, msg, null];
}

ctx.settlement.confirmedAt = new Date().toISOString();
ctx.settlement.historyBatchNumber = transaction.batch_number ?? ctx.settlement.batchNumber ?? null;
ctx.settlement.historySettled = true;
msg.url = ctx.paymentApi + '/payments/refund';
msg.headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Apriva-Platform-Key': ctx.platformKey,
    Authorization: 'Bearer ' + ctx.accessToken,
    'Apriva-Agent': 'ChargeRent-NodeRED-Refund-UAT/1.0'
};
msg.payload = JSON.stringify({
    amount: ctx.sale.amountCents,
    host_transaction_id: ctx.sale.hostTransactionId
});
return [msg, null, null];
  `, [['apriva_uat_refund_http'], ['apriva_uat_build_history_query'], ['apriva_uat_error']]),
  functionNode('apriva_uat_verify_refund', UAT_TAB, 'Verify refund, retry settled batch, or adjust open batch', 2160, 150, 4, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message, raw: body.slice(0, 500) }; }
}
const ctx = msg._aprivaUat || {};
const parentId = String(body?.parent_host_transaction_id || '').trim();
const providerMessage = String(body?.Message || body?.message || body?.response_text || body?.error || '').trim();
const openBatch = Number(msg.statusCode) === 400 && /open batch|use adjust/i.test(providerMessage);
const success = Number(msg.statusCode) >= 200 && Number(msg.statusCode) < 300 &&
    String(body?.response_code) === '0' && String(body?.transaction_type || '').toLowerCase() === 'refund' &&
    parentId === String(ctx.sale?.hostTransactionId || '');
if (openBatch && ctx.testMode === 'settled-refund') {
    ctx.settlement.refundRetries = Number(ctx.settlement.refundRetries || 0) + 1;
    if (ctx.settlement.refundRetries >= 24) {
        msg.payload = {
            ok: false,
            stage: 'settled-refund',
            httpStatus: Number(msg.statusCode) || 0,
            error: 'Timed out waiting for Apriva refund processing after settlement',
            providerMessage,
            retries: ctx.settlement.refundRetries
        };
        return [null, null, msg, null];
    }
    msg.url = ctx.paymentApi + '/payments/refund';
    msg.headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Apriva-Platform-Key': ctx.platformKey,
        Authorization: 'Bearer ' + ctx.accessToken,
        'Apriva-Agent': 'ChargeRent-NodeRED-Refund-UAT/1.0'
    };
    msg.payload = JSON.stringify({
        amount: ctx.sale.amountCents,
        host_transaction_id: ctx.sale.hostTransactionId
    });
    return [null, null, null, msg];
}
if (openBatch) {
    msg.url = ctx.paymentApi + '/payments/adjust';
    msg.headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Apriva-Platform-Key': ctx.platformKey,
        Authorization: 'Bearer ' + ctx.accessToken,
        'Apriva-Agent': 'ChargeRent-NodeRED-Refund-UAT/1.0'
    };
    msg.payload = JSON.stringify({
        amount: 0,
        host_transaction_id: ctx.sale.hostTransactionId
    });
    return [null, msg, null, null];
}
if (!success) {
    msg.payload = {
        ok: false,
        stage: 'refund',
        httpStatus: Number(msg.statusCode) || 0,
        responseCode: body?.response_code ?? null,
        error: providerMessage || 'Apriva UAT refund failed',
        providerResponse: {
            responseCode: body?.response_code ?? null,
            responseText: body?.response_text ?? null,
            message: body?.Message ?? body?.message ?? null,
            error: body?.error ?? null,
            processorResponseData: body?.processor_response_data ?? null,
            modelState: body?.ModelState ?? null
        }
    };
    return [null, null, msg, null];
}
msg.payload = {
    ok: true,
    mode: 'uat',
    testMode: ctx.testMode,
    sale: ctx.sale,
    settlement: ctx.settlement || null,
    resolution: {
        operation: 'refund',
        parentHostTransactionId: parentId,
        hostTransactionId: String(body.host_transaction_id || ''),
        uniqueRequestId: body.unique_request_id || null,
        amountCents: Number(body.amount || 0),
        responseCode: String(body.response_code),
        responseText: body.response_text || 'Success'
    }
};
return [msg, null, null, null];
  `, [['apriva_uat_success'], ['apriva_uat_adjust_http'], ['apriva_uat_error'], ['apriva_uat_refund_retry_delay']]),
  node('apriva_uat_refund_retry_delay', 'delay', UAT_TAB, 2400, 80, {
    name: 'Retry settled refund every 5s',
    pauseType: 'delay',
    timeout: '5',
    timeoutUnits: 'seconds',
    rate: '1',
    nbRateUnits: '1',
    rateUnits: 'second',
    randomFirst: '1',
    randomLast: '5',
    randomUnits: 'seconds',
    drop: false,
    outputs: 1,
    wires: [['apriva_uat_refund_http']],
  }),
  httpNode('apriva_uat_adjust_http', UAT_TAB, 'Apriva UAT open-batch adjust to $0', 2400, 210, [['apriva_uat_verify_adjust']]),
  functionNode('apriva_uat_verify_adjust', UAT_TAB, 'Verify UAT adjustment', 2660, 210, 2, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message, raw: body.slice(0, 500) }; }
}
const ctx = msg._aprivaUat || {};
const success = Number(msg.statusCode) >= 200 && Number(msg.statusCode) < 300 && String(body?.response_code) === '0';
if (!success) {
    msg.payload = {
        ok: false,
        stage: 'adjust',
        httpStatus: Number(msg.statusCode) || 0,
        responseCode: body?.response_code ?? null,
        error: body?.response_text || body?.Message || body?.message || body?.error || 'Apriva UAT adjustment failed'
    };
    return [null, msg];
}
msg.payload = {
    ok: true,
    mode: 'uat',
    testMode: ctx.testMode,
    sale: ctx.sale,
    settlement: ctx.settlement || null,
    resolution: {
        operation: 'adjust',
        adjustedAmountCents: 0,
        uniqueRequestId: body.unique_request_id || null,
        responseCode: String(body.response_code),
        responseText: body.response_text || 'Success',
        timestamp: body.timestamp || new Date().toISOString()
    }
};
return [msg, null];
  `, [['apriva_uat_success'], ['apriva_uat_error']]),
  debugNode('apriva_uat_success', UAT_TAB, 'UAT charge/reversal passed', 2920, 130),
  debugNode('apriva_uat_error', UAT_TAB, 'UAT charge/reversal failed', 2920, 260),

  node('apriva_prod_comment', 'comment', PROD_TAB, 330, 80, {
    name: 'DISABLED ON IMPORT: purchased refunds through Apriva PWS; pending authorizations route to CPS cancel',
    info: 'Never connect the Dashboard API Apollo link-out to this tab until the old direct link to the pending-cancel group is removed. Configure secrets with environment variables; do not paste credentials into function nodes.',
    wires: [],
  }),
  node('apriva_prod_in', 'link in', PROD_TAB, 130, 180, {
    name: 'Purchased refund request from Dashboard API',
    links: [],
    wires: [['apriva_prod_lookup']],
  }),
  functionNode('apriva_prod_lookup', PROD_TAB, 'Normalize request + query rental', 390, 180, 2, `
const p = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
const transactionId = String(p.orderId || p.transactionid || msg.orderId || msg.transactionid || '').trim();
const gateway = String(p.gateway || msg.gateway || '').trim().toUpperCase();
const admin = String(p.admin || msg.admin || msg._session?.id || msg._session || '').trim();
const stationid = String(p.stationid || msg.stationid || '').trim();

msg._aprivaRequest = {
    action: 'refund',
    transactionId,
    gateway,
    admin,
    stationid,
    requestedAmount: p.amount ?? msg.amount ?? 'full',
    requestedAt: new Date().toISOString(),
    attemptId: 'apriva-' + Date.now() + '-' + Math.random().toString(16).slice(2)
};

if (!transactionId) {
    msg._aprivaError = { code: 'missing_transaction_id', message: 'Refund request is missing a transaction ID' };
    return [null, msg];
}
if (gateway && gateway !== 'APOLLO') {
    msg._aprivaError = { code: 'wrong_gateway', message: 'Apriva refund handler only accepts APOLLO rentals' };
    return [null, msg];
}

const isOrderId = /^[A-Za-z0-9]{8}-[A-Za-z0-9]{4}$/.test(transactionId);
msg.payload = {
    path: 'rentals',
    operation: 'query',
    query: [{ fieldPath: isOrderId ? 'orderid' : 'rawid', opStr: '==', value: transactionId }]
};
return [msg, null];
  `, [['apriva_prod_firestore_query'], ['apriva_prod_failure']]),
  node('apriva_prod_firestore_query', 'google-cloud-firestore', PROD_TAB, 680, 180, {
    account: '662bee08b103bc8a',
    keyFilename: '/home/george/firestore/firestore-key.json',
    name: 'Query rental by orderid/rawid',
    projectId: 'node-red-alerts',
    mode: 'query',
    wires: [['apriva_prod_validate']],
  }),
  functionNode('apriva_prod_validate', PROD_TAB, 'Validate lifecycle, amount, and Apriva ID', 970, 180, 3, `
const rows = Array.isArray(msg.payload) ? msg.payload : [];
const request = msg._aprivaRequest || {};
if (rows.length !== 1) {
    msg._aprivaError = {
        code: rows.length ? 'ambiguous_rental' : 'rental_not_found',
        message: rows.length ? 'More than one rental matched the refund request' : 'Rental was not found'
    };
    return [null, null, msg];
}

const rental = rows[0];
const status = String(rental.status || '').trim().toLowerCase();
const paymentState = String(rental.paymentState || '').trim().toUpperCase();
const commitStatus = String(rental.purchaseCommitStatus || '').trim().toUpperCase();
const refundStatus = String(rental.refundStatus || '').trim().toLowerCase();
const rawid = String(rental.rawid || rental.paymentSessionId || '').trim();
const hostTransactionId = String(
    rental.aprivaHostTransactionId || rental.host_transaction_id || rental.authorizationHostReference || ''
).trim();
const originalTotal = Number(rental.totalCharged ?? rental.paymentAmount ?? rental.buyprice ?? 0);
const purchased = status === 'purchased' || paymentState === 'COMMITED' || paymentState === 'COMMITTED' ||
    ['APPROVED', 'COMMITED', 'COMMITTED'].includes(commitStatus);
const authorized = !purchased && (paymentState === 'AUTHORIZED' || ['pending', 'rented', 'purchase-pending'].includes(status));

request.orderid = String(rental.orderid || '').trim();
request.rawid = rawid;
request.stationid = request.stationid || String(rental.rentalStationid || '').trim();
request.admin = request.admin || 'system';
request.originalTotal = originalTotal;
request.rentalStatus = status;
request.terminalserver = String(rental.terminalserver || 'live').trim().toLowerCase();
request.hostTransactionId = hostTransactionId;
request.authorizationHostReference = String(rental.authorizationHostReference || '').trim();
msg._aprivaRequest = request;
msg._aprivaRental = rental;

if (['approved', 'refunded', 'succeeded'].includes(refundStatus) || status === 'refunded') {
    msg._aprivaError = { code: 'already_refunded', message: 'Rental is already refunded' };
    return [null, null, msg];
}
if (refundStatus === 'pending') {
    msg._aprivaError = { code: 'refund_pending', message: 'A refund is already pending' };
    return [null, null, msg];
}

if (authorized) {
    if (!rawid) {
        msg._aprivaError = { code: 'missing_cps_session', message: 'Pending Apollo rental has no CPS session ID' };
        return [null, null, msg];
    }
    msg.payload = {
        action: 'refund',
        gateway: 'APOLLO',
        transactionid: rawid,
        orderId: request.orderid,
        amount: request.requestedAmount,
        admin: request.admin,
        stationid: request.stationid
    };
    return [null, msg, null];
}

if (!purchased) {
    msg._aprivaError = { code: 'unsupported_payment_state', message: 'Rental is not an authorized or purchased Apollo transaction' };
    return [null, null, msg];
}
if (!hostTransactionId) {
    msg._aprivaError = { code: 'missing_apriva_host_transaction_id', message: 'Purchased rental has no Apriva host transaction ID; refund was not attempted' };
    return [null, null, msg];
}
if (!(originalTotal > 0)) {
    msg._aprivaError = { code: 'invalid_refundable_amount', message: 'Purchased rental has no positive refundable amount' };
    return [null, null, msg];
}

const rawAmount = request.requestedAmount;
const full = String(rawAmount).trim().toLowerCase() === 'full' || rawAmount === '' || rawAmount == null;
const amountDollars = full ? originalTotal : Number(rawAmount);
if (!(amountDollars > 0) || amountDollars > originalTotal) {
    msg._aprivaError = { code: 'invalid_refund_amount', message: 'Refund amount must be greater than zero and no more than the charged total' };
    return [null, null, msg];
}
request.full = full || Math.abs(amountDollars - originalTotal) < 0.005;
request.amountDollars = +amountDollars.toFixed(2);
request.amountCents = Math.round(request.amountDollars * 100);
msg._aprivaRequest = request;
return [msg, null, null];
  `, [['apriva_prod_config'], ['apriva_prod_cps_cancel'], ['apriva_prod_failure']]),
  node('apriva_prod_cps_cancel', 'link out', PROD_TAB, 1260, 260, {
    name: 'Authorized Apollo -> existing CPS cancel',
    mode: 'link',
    links: ['c3de31027aa4b97b'],
    wires: [],
  }),
  functionNode('apriva_prod_config', PROD_TAB, 'Load config + use cached token', 1260, 160, 3, `
const getEnv = (key, fallback = '') => String(env.get(key) || fallback).trim();
const mode = getEnv('APRIVA_MODE', 'uat').toLowerCase();
const request = msg._aprivaRequest || {};
const productionEnabled = getEnv('APRIVA_ENABLE_PRODUCTION_REFUNDS', 'false').toLowerCase() === 'true';

if (!['uat', 'production'].includes(mode)) {
    msg._aprivaError = { code: 'invalid_apriva_mode', message: 'APRIVA_MODE must be uat or production' };
    return [null, null, msg];
}
if (mode === 'production' && !productionEnabled) {
    msg._aprivaError = { code: 'production_refunds_disabled', message: 'Set APRIVA_ENABLE_PRODUCTION_REFUNDS=true to enable live refunds' };
    return [null, null, msg];
}
if (mode === 'uat' && request.terminalserver !== 'test') {
    msg._aprivaError = { code: 'environment_mismatch', message: 'UAT Apriva configuration cannot refund a live rental' };
    return [null, null, msg];
}
if (mode === 'production' && request.terminalserver === 'test') {
    msg._aprivaError = { code: 'environment_mismatch', message: 'Production Apriva configuration cannot refund a test rental' };
    return [null, null, msg];
}

const config = {
    mode,
    tokenApi: getEnv('APRIVA_TOKEN_API', mode === 'uat' ? 'https://aibapp53.aprivaeng.com:9464' : ''),
    paymentApi: getEnv('APRIVA_PAYMENT_API', mode === 'uat' ? 'https://paymentwebservice-uat.aprivaeng.com/pay/v2' : ''),
    productId: getEnv('APRIVA_PRODUCT_ID', mode === 'uat' ? '1096' : ''),
    clientId: getEnv('APRIVA_CLIENT_ID'),
    clientSecret: getEnv('APRIVA_CLIENT_SECRET'),
    platformKey: getEnv('APRIVA_PLATFORM_KEY'),
    scope: getEnv('APRIVA_SCOPE', 'https://ws.api.apriva.com/auth/user'),
    accessUri: getEnv('APRIVA_ACCESS_URI', mode === 'uat' ? 'https://aibapp53.aprivaeng.com:9467' : ''),
    agent: getEnv('APRIVA_AGENT', 'ChargeRent-NodeRED-Refund/1.0')
};
const missing = Object.entries(config).filter(([key, value]) => key !== 'mode' && key !== 'agent' && !value).map(([key]) => key);
if (missing.length) {
    msg._aprivaError = { code: 'missing_apriva_config', message: 'Missing Apriva configuration: ' + missing.join(', ') };
    return [null, null, msg];
}

config.tokenApi = config.tokenApi.replace(/\\/$/, '');
config.paymentApi = config.paymentApi.replace(/\\/$/, '');
msg._aprivaConfig = config;
const cached = flow.get('aprivaPwsAccessToken');
if (cached?.token && Number(cached.expiresAt || 0) > Date.now() + 60000 && cached.mode === mode) {
    msg._aprivaAccessToken = cached.token;
    return [msg, null, null];
}

msg.url = config.tokenApi + '/o/' + encodeURIComponent(config.productId) + '/oauth2/token';
msg.headers = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Basic ' + Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64')
};
msg.payload = [
    ['grant_type', 'client_credentials'],
    ['scope', config.scope],
    ['access_uri', config.accessUri],
    ['timestamp', String(Math.floor(Date.now() / 1000))]
].map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
return [null, msg, null];
  `, [['apriva_prod_build_refund'], ['apriva_prod_token_http'], ['apriva_prod_failure']]),
  httpNode('apriva_prod_token_http', PROD_TAB, 'Apriva OAuth token', 1510, 220, [['apriva_prod_parse_token']]),
  functionNode('apriva_prod_parse_token', PROD_TAB, 'Parse and cache token', 1750, 220, 2, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message }; }
}
if (Number(msg.statusCode) !== 200 || !body?.access_token) {
    msg._aprivaError = {
        code: 'apriva_oauth_failed',
        message: body?.error_description || body?.error || 'Apriva OAuth request failed',
        httpStatus: Number(msg.statusCode) || 0
    };
    return [null, msg];
}
const expiresIn = Math.max(Number(body.access_expires_in || body.expires_in || 300), 60);
msg._aprivaAccessToken = body.access_token;
flow.set('aprivaPwsAccessToken', {
    token: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    mode: msg._aprivaConfig.mode
});
return [msg, null];
  `, [['apriva_prod_build_refund'], ['apriva_prod_failure']]),
  functionNode('apriva_prod_build_refund', PROD_TAB, 'Build Apriva refund request', 1990, 160, 2, `
const request = msg._aprivaRequest || {};
const config = msg._aprivaConfig || {};
if (!msg._aprivaAccessToken || !request.hostTransactionId) {
    msg._aprivaError = { code: 'refund_request_not_ready', message: 'Apriva token or host transaction ID is missing' };
    return [null, msg];
}
const body = {
    amount: request.amountCents,
    host_transaction_id: request.hostTransactionId
};
msg.url = config.paymentApi + '/payments/refund';
msg.headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Apriva-Platform-Key': config.platformKey,
    Authorization: 'Bearer ' + msg._aprivaAccessToken,
    'Apriva-Agent': config.agent
};
msg.payload = JSON.stringify(body);
return [msg, null];
  `, [['apriva_prod_refund_http'], ['apriva_prod_failure']]),
  httpNode('apriva_prod_refund_http', PROD_TAB, 'Apriva purchased refund', 2230, 160, [['apriva_prod_verify']]),
  functionNode('apriva_prod_verify', PROD_TAB, 'Verify refund or route open batch to adjust', 2480, 160, 3, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message, raw: body.slice(0, 500) }; }
}
const request = msg._aprivaRequest || {};
const parentId = String(body?.parent_host_transaction_id || '').trim();
const refundId = String(body?.host_transaction_id || '').trim();
const providerAmountCents = Number(body?.amount);
const amountMatches = !Number.isFinite(providerAmountCents) || providerAmountCents === Number(request.amountCents);
const providerMessage = String(body?.Message || body?.message || body?.response_text || body?.error || '').trim();
const openBatch = Number(msg.statusCode) === 400 && /open batch|use adjust/i.test(providerMessage);
const success = Number(msg.statusCode) >= 200 && Number(msg.statusCode) < 300 &&
    String(body?.response_code) === '0' && String(body?.transaction_type || '').toLowerCase() === 'refund' &&
    parentId === String(request.hostTransactionId || '') && refundId && amountMatches;

if (openBatch) {
    const config = msg._aprivaConfig || {};
    request.adjustedAmountCents = Math.max(
        Math.round((Number(request.originalTotal || 0) - Number(request.amountDollars || 0)) * 100),
        0
    );
    msg._aprivaRequest = request;
    msg.url = config.paymentApi + '/payments/adjust';
    msg.headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Apriva-Platform-Key': config.platformKey,
        Authorization: 'Bearer ' + msg._aprivaAccessToken,
        'Apriva-Agent': config.agent
    };
    msg.payload = JSON.stringify({
        amount: request.adjustedAmountCents,
        host_transaction_id: request.hostTransactionId
    });
    return [null, msg, null];
}

if (!success) {
    msg._aprivaError = {
        code: amountMatches ? 'apriva_refund_failed' : 'apriva_refund_amount_mismatch',
        message: providerMessage || (amountMatches ? 'Apriva refund was not approved' : 'Apriva returned a different refund amount'),
        httpStatus: Number(msg.statusCode) || 0,
        providerResponseCode: body?.response_code ?? null
    };
    msg._aprivaProviderResponse = {
        responseCode: body?.response_code ?? null,
        responseText: body?.response_text ?? null,
        transactionType: body?.transaction_type ?? null,
        parentHostTransactionId: parentId || null,
        refundHostTransactionId: refundId || null,
        amountCents: Number.isFinite(providerAmountCents) ? providerAmountCents : null,
        uniqueRequestId: body?.unique_request_id ?? null
    };
    return [null, null, msg];
}

msg._aprivaProviderResponse = {
    operation: 'refund',
    responseCode: String(body.response_code),
    responseText: body.response_text || 'Success',
    parentHostTransactionId: parentId,
    refundHostTransactionId: refundId,
    amountCents: Number.isFinite(providerAmountCents) ? providerAmountCents : request.amountCents,
    uniqueRequestId: body.unique_request_id || null,
    timestamp: body.timestamp || new Date().toISOString(),
    captured: body.captured ?? null,
    settled: body.settled ?? null
};
return [msg, null, null];
  `, [['apriva_prod_success_update'], ['apriva_prod_adjust_http'], ['apriva_prod_failure']]),
  httpNode('apriva_prod_adjust_http', PROD_TAB, 'Apriva open-batch adjustment', 2730, 240, [['apriva_prod_verify_adjust']]),
  functionNode('apriva_prod_verify_adjust', PROD_TAB, 'Verify Apriva adjustment response', 2980, 240, 2, `
let body = msg.payload;
if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = { parseError: error.message, raw: body.slice(0, 500) }; }
}
const request = msg._aprivaRequest || {};
const success = Number(msg.statusCode) >= 200 && Number(msg.statusCode) < 300 && String(body?.response_code) === '0';
if (!success) {
    msg._aprivaError = {
        code: 'apriva_adjust_failed',
        message: body?.response_text || body?.Message || body?.message || body?.error || 'Apriva open-batch adjustment failed',
        httpStatus: Number(msg.statusCode) || 0,
        providerResponseCode: body?.response_code ?? null
    };
    return [null, msg];
}
msg._aprivaProviderResponse = {
    operation: 'adjust',
    responseCode: String(body.response_code),
    responseText: body.response_text || 'Success',
    parentHostTransactionId: request.hostTransactionId,
    refundHostTransactionId: null,
    amountCents: Number(request.amountCents),
    adjustedAmountCents: Number(request.adjustedAmountCents),
    uniqueRequestId: body.unique_request_id || null,
    timestamp: body.timestamp || new Date().toISOString(),
    captured: null,
    settled: false
};
return [msg, null];
  `, [['apriva_prod_success_update'], ['apriva_prod_failure']]),
  functionNode('apriva_prod_success_update', PROD_TAB, 'Build success-only rental update', 2730, 160, 1, `
const request = msg._aprivaRequest || {};
const provider = msg._aprivaProviderResponse || {};
const now = new Date().toISOString();
const remaining = Math.max(Number(request.originalTotal || 0) - Number(request.amountDollars || 0), 0);
const full = remaining < 0.005;

msg.payload = {
    path: 'rentals/' + request.orderid,
    content: {
        status: full ? 'refunded' : 'purchased',
        totalCharged: +remaining.toFixed(2),
        refundStatus: full ? 'refunded' : 'partially-refunded',
        refundAmount: Number(request.amountDollars),
        refundDate: provider.timestamp || now,
        refundCompleted: true,
        refundCompletedDate: now,
        refundProcessed: true,
        refundProvider: 'APRIVA_PWS',
        refundAdmin: request.admin || null,
        refundTransactionid: request.rawid || null,
        paymentStatus: provider.operation === 'adjust'
            ? (full ? 'VOIDED' : 'ADJUSTED')
            : (full ? 'REFUNDED' : 'PARTIALLY_REFUNDED'),
        paymentUpdatedAt: now,
        aprivaOriginalHostTransactionId: request.hostTransactionId,
        aprivaTransactionOperation: provider.operation || 'refund',
        aprivaAdjustedAmountCents: provider.adjustedAmountCents ?? null,
        aprivaRefundHostTransactionId: provider.refundHostTransactionId || null,
        aprivaRefundUniqueRequestId: provider.uniqueRequestId || null,
        aprivaRefundResponseCode: provider.responseCode,
        aprivaRefundResponseText: provider.responseText,
        aprivaRefundCaptured: provider.captured,
        aprivaRefundSettled: provider.settled,
        lastUpdate: now
    },
    merge: true
};
return msg;
  `, [['apriva_prod_firestore_update']]),
  node('apriva_prod_firestore_update', 'google-cloud-firestore', PROD_TAB, 2990, 160, {
    account: '662bee08b103bc8a',
    keyFilename: '/home/george/firestore/firestore-key.json',
    name: 'Write confirmed refund to rental',
    projectId: 'node-red-alerts',
    mode: 'update',
    wires: [['apriva_prod_confirmation']],
  }),
  functionNode('apriva_prod_confirmation', PROD_TAB, 'Build dashboard success confirmation', 3260, 160, 1, `
const request = msg._aprivaRequest || {};
const provider = msg._aprivaProviderResponse || {};
msg._session = request.admin || undefined;
msg.payload = {
    action: 'refund',
    gateway: 'APOLLO',
    provider: 'APRIVA_PWS',
    status: request.full ? 'refunded' : 'partially-refunded',
    refund_status: request.full ? 'refunded' : 'partially-refunded',
    transactionid: request.rawid,
    orderId: request.orderid,
    amount: request.amountDollars,
    admin: request.admin || undefined,
    stationid: request.stationid || '',
    time: provider.timestamp || new Date().toISOString(),
    status_en: request.full ? 'Apollo refund confirmed by Apriva' : 'Apollo partial refund confirmed by Apriva',
    paymentStatus: request.full ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    aprivaRefundHostTransactionId: provider.refundHostTransactionId
};
return msg;
  `, [['apriva_prod_to_dashboard', 'apriva_prod_success_debug']]),
  node('apriva_prod_to_dashboard', 'link out', PROD_TAB, 3520, 140, {
    name: 'Apriva refund confirmation to Dashboard',
    mode: 'link',
    links: ['3781d0fd43639060'],
    wires: [],
  }),
  debugNode('apriva_prod_success_debug', PROD_TAB, 'Apriva refund success', 3520, 190),
  functionNode('apriva_prod_failure', PROD_TAB, 'Audit failure without changing rental', 1980, 340, 2, `
const request = msg._aprivaRequest || {};
const error = msg._aprivaError || { code: 'unknown_refund_error', message: 'Unknown refund error' };
const provider = msg._aprivaProviderResponse || {};
const now = new Date().toISOString();
const attemptId = String(request.attemptId || ('apriva-' + Date.now())).replace(/[^A-Za-z0-9_-]/g, '_');

const audit = {
    attemptId,
    action: 'refund',
    gateway: 'APOLLO',
    provider: 'APRIVA_PWS',
    status: 'failed',
    errorCode: error.code,
    errorMessage: error.message,
    httpStatus: error.httpStatus || null,
    providerResponseCode: error.providerResponseCode ?? provider.responseCode ?? null,
    transactionid: request.transactionId || request.rawid || null,
    orderid: request.orderid || null,
    stationid: request.stationid || null,
    admin: request.admin || null,
    requestedAmount: request.requestedAmount ?? null,
    createdAt: now
};

const auditMsg = {
    ...msg,
    payload: { path: 'refundAttempts/' + attemptId, content: audit }
};
const confirmationMsg = {
    ...msg,
    _session: request.admin || undefined,
    payload: {
        action: 'refund',
        gateway: 'APOLLO',
        provider: 'APRIVA_PWS',
        status: 'refund-failed',
        refund_status: 'refund-failed',
        transactionid: request.rawid || request.transactionId || '',
        orderId: request.orderid || '',
        amount: request.amountDollars ?? request.requestedAmount ?? 0,
        admin: request.admin || undefined,
        stationid: request.stationid || '',
        time: now,
        status_en: error.message,
        error_code: error.code,
        paymentStatus: 'UNCHANGED'
    }
};
return [auditMsg, confirmationMsg];
  `, [['apriva_prod_audit_write'], ['apriva_prod_to_dashboard', 'apriva_prod_failure_debug']]),
  node('apriva_prod_audit_write', 'google-cloud-firestore', PROD_TAB, 2260, 330, {
    account: '662bee08b103bc8a',
    keyFilename: '/home/george/firestore/firestore-key.json',
    name: 'Write refund failure audit only',
    projectId: 'node-red-alerts',
    mode: 'set',
    wires: [['apriva_prod_audit_debug']],
  }),
  debugNode('apriva_prod_audit_debug', PROD_TAB, 'Refund failure audit written', 2520, 310),
  debugNode('apriva_prod_failure_debug', PROD_TAB, 'Apriva refund failed; rental unchanged', 2260, 390),
];

fs.writeFileSync(outputPath, `${JSON.stringify(flow, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
