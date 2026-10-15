/* eslint-env node */
const crypto = require('node:crypto');
const {KioskTerminalError} = require('./kioskTerminal');
const {OWNER, localHardware, localTopology} = require('./localStationBackend');
const {normalizeStationBrand} = require('./stationBrand');
const fail = (status, message) => { throw new KioskTerminalError(status, 'local-provision', message); };
function createLocalStationProvisioner({db, now = Date.now}) {
  return async function provision(input, auth) {
    if (!auth?.isAdmin) fail(403, 'Only an administrator can provision a local station.');
    const kiosk = JSON.parse(JSON.stringify(input?.kiosk || {}));
    try { kiosk.stationBrand = normalizeStationBrand(kiosk.stationBrand); }
    catch (error) { fail(400, error.message); }
    const provisionid = input.provisionid || kiosk.provisionid;
    const stationid = String(input.stationid || kiosk.stationid || '').trim().toUpperCase();
    if (!/^[A-Za-z0-9_-]{4,100}$/.test(provisionid || '') || !/^(US|CA|FR)\d{4}$/.test(stationid)) fail(400, 'Valid station and provision identities are required.');
    const country = String(kiosk.info?.country || '').toUpperCase();
    if (!['US', 'CA', 'FR'].includes(country) || !stationid.startsWith(country)) fail(400, 'Station ID must match the address country.');
    const hw = localHardware(kiosk);
    const moduleId = `local-${provisionid}`;
    kiosk.modules = [{id: moduleId, moduleid: moduleId, online: false, output: false, heartbeatOutput: false,
      slots: Array.from({length: hw.boardCount * hw.slotsPerBoard}, (_, i) => ({position: i + 1, sn: '', present: false, status: 0, lock: false, locked: false}))}];
    localTopology(kiosk, {moduleId});
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(kiosk)).digest('hex');
    const ref = db.collection('kiosks').doc(provisionid);
    return db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      const conflicts = (await tx.get(db.collection('kiosks').where('stationid', '==', stationid))).docs;
      const reservation = (await tx.get(db.collection('stationIdReservations').doc(stationid))).data();
      if (!current) fail(404, 'Register the station in the pending provisioning list first.');
      if (current.localProvisionFingerprint === fingerprint) return {stationid, provisionid, message: 'Local station is already provisioned.'};
      if (current.status !== 'pending-provision') fail(409, 'This station is no longer pending provisioning.');
      if (conflicts.some(doc => doc.id !== provisionid) || (reservation && reservation.active !== false)) fail(409, 'This station ID is assigned or reserved.');
      tx.set(ref, {...current, ...kiosk, stationid, provisionid, hardware: {...kiosk.hardware, modules: 1, billingOwner: OWNER},
        moduleIds: [moduleId], slotscount: hw.boardCount * hw.slotsPerBoard, count: 0, chargers: 'soldout',
        total: 0, full: 0, empty: 0, slot: hw.boardCount * hw.slotsPerBoard, lockcount: 0,
        status: 'provisioned', active: true, enabled: true, online: false, mqtt: false,
        localProvisionFingerprint: fingerprint, localProvisionedBy: auth.uid || '', localProvisionedAt: new Date(now()).toISOString()});
      return {stationid, provisionid, message: 'Local station provisioned. Assign its Android terminal next.'};
    });
  };
}
module.exports = {createLocalStationProvisioner};
