/* eslint-env node */
const crypto = require('node:crypto');
const model = require('./ctf7Model');
const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : value instanceof Date ? +value : Date.parse(value) || 0;
const reservationId = (station, module, sn) => crypto.createHash('sha256').update(`${station}|${module}|${sn}`).digest('hex');
function stationReady(kiosk) {
  return kiosk?.hardware?.type === 'CTF7' && kiosk.active === true && kiosk.enabled !== false &&
    !kiosk.disabled && kiosk.rentalsValidated === true && kiosk.ctf7Commissioning?.persistentEndpointVerified === true &&
    kiosk.ctf7Commissioning?.networkBoundaryVerified === true && kiosk.ctf7Commissioning?.automaticReturnsVerified === true;
}
function eligible(kiosk, module, slot, now = Date.now()) {
  return stationReady(kiosk) && module?.operationalEnabled === true && module.controlEnabled === true &&
    model.freshModule(module, now) && model.hasBank(slot) && !slot.lock && !slot.abnormal && !slot.rented &&
    Number.isFinite(slot.batteryLevel) && slot.batteryLevel >= Number(kiosk.hardware.power ?? 80);
}
function assertCandidate({kiosk, binding, session, moduleId, position, sn, generation, sessionId, now = Date.now()}) {
  const module = kiosk?.modules?.find(entry => entry.id === moduleId);
  const slot = module?.slots?.find(entry => Number(entry.position) === Number(position));
  if (!eligible(kiosk, module, slot, now) || slot.sn !== String(sn) || binding?.state !== 'bound' ||
      binding.provisionid !== kiosk.provisionid || binding.stationid !== kiosk.stationid ||
      binding.generation !== generation || !binding.controlEnabled || !binding.topologyVerified ||
      session?.connected !== true || session.sessionId !== sessionId || session.generation !== generation) {
    throw new Error('CTF7 selection, assignment, session or commissioning gates changed');
  }
  return slot;
}
// Parity with saved V2 fn_cr_return_charge_apo computeCharge, inspected 2026-10-08.
// Live /flows requires authentication, so this source comparison is explicit.
function returnCharge(pricing, rentalMs) {
  const tiers = (pricing?.rate || pricing?.tiers || []).map(tier => ({time: Number(tier.time), price: Number(tier.price)}));
  const buyprice = Number(pricing?.buyprice);
  const taxrate = Number(pricing?.taxrate ?? 0);
  if (!tiers.length || !Number.isFinite(buyprice) || buyprice < 0 || !Number.isFinite(taxrate) || taxrate < 0 ||
      tiers.some((tier, index) => !Number.isFinite(tier.time) || tier.time < 0 || !Number.isFinite(tier.price) || tier.price < 0 ||
        (index > 0 && tier.time <= tiers[index - 1].time))) throw new Error('Invalid immutable V2 pricing snapshot');
  let tierIndex = 0;
  const minutes = Math.floor(Math.max(rentalMs, 0) / 60000);
  tiers.forEach((tier, index) => { if (minutes > tier.time) tierIndex = index + 1; });
  const amount = rentalMs > 0 ? (tierIndex >= tiers.length ? buyprice : tiers[tierIndex].price) : 0;
  const total = +(amount * (1 + taxrate / 100)).toFixed(2);
  const subtotal = +(total / (1 + taxrate / 100)).toFixed(2);
  const initialCharge = +(tiers[0].price * (1 + taxrate / 100)).toFixed(2);
  return {chargePlan: {kioskmode: pricing.kioskmode || null, type: 'kiosk-return', tierIndex, tiers},
    subtotal, tax: +(total - subtotal).toFixed(2), totalCharged: total, initialCharge,
    overageCharge: +(total - initialCharge).toFixed(2), currency: pricing.currency || null, symbol: pricing.symbol || null};
}
function createCtf7Gateway({db, timeoutMs = 15000, now = Date.now}) {
  async function queue(kind, request) {
    const requestId = String(request.requestId || '');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) throw new Error('Invalid CTF7 request ID');
    const id = crypto.createHash('sha256').update(`${kind}:${requestId}`).digest('hex');
    const ref = db.collection('ctf7TransportRequests').doc(id);
    const fingerprint = JSON.stringify(kind === 'vend' ? {kind, stationid: request.stationid, moduleid: request.moduleid,
      sn: String(request.sn), slotid: request.slotid, paymentIntentId: request.paymentIntentId, interactionId: request.interactionId} : {kind, request});
    await db.runTransaction(async tx => {
      const existing = (await tx.get(ref)).data();
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('CTF7 request ID reused');
        return;
      }
      tx.create(ref, {id, kind, request, fingerprint, state: 'queued', requestedAt: new Date(now()).toISOString(),
        expiresAt: new Date(now() + 20000).toISOString()});
    });
    if (kind === 'vend') return;
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const value = (await ref.get()).data();
      if (value.state === 'completed') return value.response;
      if (value.state === 'failed') throw new Error(value.reason || 'CTF7 availability failed');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('CTF7 availability timed out');
  }
  return {requestAvailability: request => queue('availability', request), sendVend: request => queue('vend', request)};
}
module.exports = {millis, reservationId, stationReady, eligible, assertCandidate, returnCharge, createCtf7Gateway};
