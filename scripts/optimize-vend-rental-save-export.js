import fs from 'fs';
import path from 'path';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(process.cwd(), 'scripts', 'flows-12-rental-save-optimized.json');

if (!inputPath) {
  console.error('Usage: node scripts/optimize-vend-rental-save-export.js <input-json> [output-json]');
  process.exit(1);
}

const preparePendingRentalContextFunc = `
function normalizeStationId(value) {
    return String(value || '').trim();
}

function toIso(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
        const millis = String(Math.trunc(num)).length <= 10 ? num * 1000 : num;
        return new Date(millis).toISOString();
    }
    return new Date().toISOString();
}

function toMillis(value, fallback) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
        return String(Math.trunc(num)).length <= 10 ? num * 1000 : num;
    }
    return fallback;
}

function firstString() {
    for (let index = 0; index < arguments.length; index++) {
        const value = String(arguments[index] ?? '').trim();
        if (value) {
            return value;
        }
    }
    return '';
}

function firstNumber() {
    for (let index = 0; index < arguments.length; index++) {
        const num = Number(arguments[index]);
        if (Number.isFinite(num)) {
            return num;
        }
    }
    return null;
}

const payload = msg.payload || {};
if (String(payload.action || '').toLowerCase() !== 'vend') {
    return null;
}

const rentalTime = toIso(payload.rentalTime || payload.timerequested || payload.time || payload.timereceived);
const requestedAtMs = toMillis(
    payload.timerequested || payload.rentalTime || payload.time || payload.timereceived,
    Date.parse(rentalTime)
);
const stationid = normalizeStationId(payload.stationid || msg.stationid || '');
const sn = firstNumber(payload.chargerid, payload.sn);
const rawid = firstString(
    payload.rawid,
    payload.transactionid,
    payload.transactionId,
    payload.rentalId,
    payload.orderid,
    payload.orderId,
    payload.paymentIntentId,
    payload.paymentintentid,
    'rent-' + (stationid || 'station') + '-' + Date.parse(rentalTime)
);
const orderid = firstString(payload.orderid, payload.orderId, rawid);

msg._pendingRentalCtx = {
    rawid,
    rentalId: firstString(payload.rentalId, orderid, rawid),
    orderid,
    transactionid: firstString(payload.transactionid, payload.transactionId),
    requestId: firstString(payload.requestId, payload.requestid, msg.requestId),
    sn,
    chargerid: sn,
    stationid,
    moduleid: firstString(payload.moduleid, payload.moduleId, payload.module, msg.moduleid),
    slotid: firstNumber(payload.slotid, payload.slot, payload.requestedSlotid),
    rentalTime,
    requestedAt: rentalTime,
    requestedAtMs,
    rentalLocation: firstString(payload.rentalLocation, msg.rentalLocation),
    rentalPlace: firstString(payload.rentalPlace, msg.rentalPlace),
    currency: firstString(payload.currency),
    symbol: firstString(payload.symbol),
    buyprice: firstNumber(payload.buyprice),
    initialCharge: firstNumber(payload.initialCharge, payload.initialcharge),
    totalCharged: firstNumber(payload.totalCharged, payload.totalcharged, payload.amountCharged),
    card_last4: firstString(payload.card_last4, payload.cardLast4, payload.last4),
    clientId: firstString(payload.clientId, payload.clientid),
    repId: firstString(payload.repId, payload.repid),
    gateway: firstString(payload.gateway),
    paymentIntentId: firstString(payload.paymentIntentId, payload.paymentintentid),
    customerId: firstString(payload.customerId, payload.customerid),
    rentPower: firstNumber(payload.rentPower, payload.rentpower, payload.powerlevel, payload.power),
    country: firstString(payload.country, payload.rentalCountry),
    memberid: firstNumber(payload.memberid, payload.memberId),
    paymentStatus: firstString(payload.paymentStatus, payload.paymentstatus),
    terminalserver: firstString(payload.terminalserver, payload.server),
    terminalsn: firstString(payload.terminalsn, payload.terminalSn),
    authorizationCode: firstString(payload.authorizationCode, payload.authorizationcode),
    overdue: firstNumber(payload.overdue),
    time: firstNumber(payload.time),
    timereceived: firstNumber(payload.timereceived)
};

if (!stationid) {
    msg.kioskDoc = null;
    return [null, msg];
}

msg.payload = {
    path: 'kiosks',
    query: [{ fieldPath: 'stationid', opStr: '==', value: stationid }]
};

return [msg, null];
`.trim();

const resolveKioskFunc = `
function normalizeStationId(value) {
    return String(value || '').trim();
}

const docs = Array.isArray(msg.payload) ? msg.payload : [];
const stationid = normalizeStationId(msg._pendingRentalCtx?.stationid || '');
const matched = docs.find((doc) => normalizeStationId(doc?.stationid || '') === stationid) || null;

msg.kioskDoc = matched ? JSON.parse(JSON.stringify(matched)) : null;

return msg;
`.trim();

const buildPendingRentalWriteFunc = `
function firstString() {
    for (let index = 0; index < arguments.length; index++) {
        const value = String(arguments[index] ?? '').trim();
        if (value) {
            return value;
        }
    }
    return '';
}

function isFiniteNumber(value) {
    return Number.isFinite(value);
}

function firstNumber() {
    for (let index = 0; index < arguments.length; index++) {
        const value = arguments[index];
        if (Number.isFinite(value)) {
            return value;
        }
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function assignString(target, key) {
    const values = Array.prototype.slice.call(arguments, 2);
    const value = firstString.apply(null, values);
    if (value) {
        target[key] = value;
    }
}

function assignNumber(target, key) {
    const values = Array.prototype.slice.call(arguments, 2);
    const value = firstNumber.apply(null, values);
    if (value !== null) {
        target[key] = value;
    }
}

function normalizeRate(pricing) {
    const tiers = Array.isArray(pricing?.tiers)
        ? pricing.tiers
        : Array.isArray(pricing?.rate)
            ? pricing.rate
            : [];

    return tiers.map((tier) => ({
        time: Number(tier?.time ?? 0),
        price: Number(tier?.price ?? 0)
    }));
}

const ctx = msg._pendingRentalCtx;
if (!ctx) {
    node.error('Missing msg._pendingRentalCtx', msg);
    return null;
}

const kiosk = msg.kioskDoc || {};
const info = kiosk.info && typeof kiosk.info === 'object' ? kiosk.info : {};
const pricing = kiosk.pricing && typeof kiosk.pricing === 'object' ? kiosk.pricing : {};
const hardware = kiosk.hardware && typeof kiosk.hardware === 'object' ? kiosk.hardware : {};

const pricingAtStart = {
    kioskmode: pricing.kioskmode || null,
    buyprice: firstNumber(ctx.buyprice, pricing.buyprice) ?? 0,
    overdue: firstNumber(ctx.overdue, pricing.overdue) ?? 0,
    currency: firstString(ctx.currency, pricing.currency) || null,
    symbol: firstString(ctx.symbol, pricing.symbol) || null,
    taxrate: firstNumber(pricing.taxrate, pricing.taxpercent) ?? 0,
    rate: normalizeRate(pricing),
    snapshotAt: new Date().toISOString()
};

const rentalTimeMs = Date.parse(ctx.rentalTime);
const overdueDays = Number(pricingAtStart.overdue || 0);
const overdueTime = Number.isFinite(rentalTimeMs)
    ? new Date(rentalTimeMs + overdueDays * 24 * 60 * 60 * 1000).toISOString()
    : ctx.rentalTime;

const rentalDoc = {
    rawid: ctx.rawid,
    rentalId: firstString(ctx.rentalId, ctx.orderid, ctx.rawid),
    orderid: ctx.orderid,
    status: 'pending',
    rentalStationid: firstString(ctx.stationid, kiosk.stationid),
    rentalTime: ctx.rentalTime,
    requestedAt: ctx.requestedAt,
    overdueTime,
    overdue: pricingAtStart.overdue,
    buyprice: pricingAtStart.buyprice,
    currency: pricingAtStart.currency,
    symbol: pricingAtStart.symbol,
    pricingAtStart,
    kioskDocId: firstString(kiosk.provisionid, kiosk.stationid)
};

assignNumber(rentalDoc, 'sn', ctx.sn);
assignNumber(rentalDoc, 'chargerid', ctx.chargerid);
assignString(rentalDoc, 'rentalModuleid', ctx.moduleid);
assignString(rentalDoc, 'requestId', ctx.requestId);
assignString(rentalDoc, 'rentalLocation', ctx.rentalLocation, info.location);
assignString(rentalDoc, 'rentalPlace', ctx.rentalPlace, info.place);
assignString(rentalDoc, 'card_last4', ctx.card_last4);
assignString(rentalDoc, 'clientId', ctx.clientId, info.clientId, info.client);
assignString(rentalDoc, 'repId', ctx.repId, info.rep);
assignString(rentalDoc, 'gateway', ctx.gateway, hardware.gateway);
assignString(rentalDoc, 'paymentIntentId', ctx.paymentIntentId);
assignString(rentalDoc, 'customerId', ctx.customerId);
assignString(rentalDoc, 'country', ctx.country, info.country);
assignNumber(rentalDoc, 'memberid', ctx.memberid);

if (ctx.transactionid) {
    rentalDoc.transactionid = ctx.transactionid;
}

if (ctx.paymentStatus) {
    rentalDoc.paymentStatus = ctx.paymentStatus;
}

if (ctx.terminalserver) {
    rentalDoc.terminalserver = ctx.terminalserver;
}

if (ctx.terminalsn) {
    rentalDoc.terminalsn = ctx.terminalsn;
}

if (ctx.authorizationCode) {
    rentalDoc.authorizationCode = ctx.authorizationCode;
}

if (ctx.slotid !== null) {
    rentalDoc.rentalSlotid = ctx.slotid;
    rentalDoc.requestedSlotid = ctx.slotid;
}

if (ctx.requestedAtMs) {
    rentalDoc.timerequested = ctx.requestedAtMs;
}

assignNumber(rentalDoc, 'initialCharge', ctx.initialCharge);
assignNumber(rentalDoc, 'rentPower', ctx.rentPower);
assignNumber(rentalDoc, 'time', ctx.time);
assignNumber(rentalDoc, 'timereceived', ctx.timereceived);

if (ctx.totalCharged !== null) {
    rentalDoc.totalCharged = ctx.totalCharged;
}

msg.payload = {
    path: 'rentals/' + ctx.orderid,
    content: rentalDoc
};

return msg;
`.trim();

const flow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const groupNode = flow.find((node) => node.id === '34eaacc20fdb7b09');
const pendingWriteIndex = flow.findIndex((node) => node.id === '64174602114d9e2c');

if (!groupNode || pendingWriteIndex === -1) {
  console.error('Expected vend charger flow nodes were not found in the input export.');
  process.exit(1);
}

const queryNodeId = 'vr-kiosk-query';
const resolveNodeId = 'vr-kiosk-resolve';
const buildNodeId = 'vr-rental-build';

const queryNode = {
  id: queryNodeId,
  type: 'google-cloud-firestore',
  z: groupNode.z,
  g: groupNode.id,
  account: '',
  keyFilename: '/home/george/firestore/firestore-key.json',
  name: 'Query kiosk for rental defaults',
  projectId: 'node-red-alerts',
  mode: 'query',
  x: 1690,
  y: 2220,
  wires: [[resolveNodeId]],
};

const resolveNode = {
  id: resolveNodeId,
  type: 'function',
  z: groupNode.z,
  g: groupNode.id,
  name: 'Resolve kiosk for rental',
  func: resolveKioskFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 1910,
  y: 2220,
  wires: [[buildNodeId]],
};

const buildNode = {
  id: buildNodeId,
  type: 'function',
  z: groupNode.z,
  g: groupNode.id,
  name: 'Build Pending Rental Write',
  func: buildPendingRentalWriteFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 2140,
  y: 2220,
  wires: [['58d668e2dc2cdd96']],
};

if (!flow.some((node) => node.id === queryNodeId)) {
  flow.splice(pendingWriteIndex + 1, 0, queryNode, resolveNode, buildNode);
}

flow.forEach((node) => {
  if (node.id === '34eaacc20fdb7b09') {
    node.name = 'vend charger (rental save optimized)';
    node.nodes = [
      '87aa3a26f91fb5be',
      '117663ecd22e028b',
      '61e90896601d5e59',
      '8b9fe8b7500de432',
      '64174602114d9e2c',
      queryNodeId,
      resolveNodeId,
      buildNodeId,
      '4d8bfe2028933124',
      '58d668e2dc2cdd96',
      'cb486a0812c5d8fd',
      '758109425e2655b3',
    ];
    node.w = 1112;
  }

  if (node.id === '64174602114d9e2c') {
    node.name = 'Prepare Pending Rental Context';
    node.func = preparePendingRentalContextFunc;
    node.outputs = 2;
    node.wires = [[queryNodeId], [buildNodeId]];
  }

  if (node.id === '58d668e2dc2cdd96') {
    node.x = 2380;
  }
});

fs.writeFileSync(outputPath, JSON.stringify(flow, null, 4) + '\n');
console.log(`Wrote ${outputPath}`);
