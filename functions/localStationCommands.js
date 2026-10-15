/* eslint-env node */
const {OWNER, localHardware, localTopology} = require('./localStationBackend');
const {tokenHash, KioskTerminalError} = require('./kioskTerminal');
const {millis} = require('./ctf7Rental');
const fail = message => { throw new KioskTerminalError(409, 'local-command', message); };
function operatorAllowed(auth, kiosk, action) {
  if (auth?.isAdmin === true) return true;
  const client = String(auth?.profile?.clientId || '').trim().toUpperCase();
  const scoped = client && [kiosk.info?.client, kiosk.info?.clientId, kiosk.info?.rep]
    .some(value => String(value || '').trim().toUpperCase() === client);
  const permissions = auth?.profile?.commands || auth?.profile?.Commands || {};
  const permission = action === 'check' ? (permissions.update || permissions.check) :
    permissions[action === 'eject count' ? 'eject_multiple' : 'eject'];
  return Boolean(scoped && permission === true);
}
function createLocalStationCommands({db, now = Date.now}) {
  const commands = db.collection('localStationCommands');
  async function queue(input, auth) {
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(input.requestId || '')) fail('Invalid command identity.');
    const snapshot = await db.collection('kiosks').where('stationid', '==', input.stationid).limit(2).get();
    if (snapshot.size !== 1) fail('Station is not uniquely assigned.');
    const kiosk = snapshot.docs[0].data(), provisionId = snapshot.docs[0].id;
    const hardware = localHardware(kiosk), topology = localTopology(kiosk, {moduleId: kiosk.modules?.[0]?.id});
    if (kiosk.hardware.billingOwner !== OWNER || !kiosk.online || now() - millis(kiosk.localHeartbeatAt) > 45000) fail('Local controller heartbeat is stale.');
    if (kiosk.localController?.pending) fail('The local controller is reserved by a checkout.');
    const action = input.action;
    if (!operatorAllowed(auth, kiosk, action)) throw new KioskTerminalError(403, 'command-access', 'Not allowed to control this station.');
    if (!['check', 'eject', 'eject slot', 'eject specific', 'eject all', 'eject module', 'eject full', 'eject empty', 'eject count', 'eject locked manual', 'eject locked auto'].includes(action)) {
      fail('This operation is not supported by local control.');
    }
    let targets = [];
    (kiosk.modules || []).forEach((module, index) => (module.slots || []).forEach(slot => {
      const sn = String(slot.chargerId || slot.sn || '');
      if (!sn || !/^[A-Za-z0-9_-]{1,80}$/.test(sn) || slot.present === false) return;
      if (input.moduleid && String(module.id || module.moduleid) !== String(input.moduleid)) return;
      const position = Number(slot.position);
      if (['eject', 'eject slot', 'eject specific'].includes(action) && position !== Number(input.slotid)) return;
      if (action === 'eject full' && Number(slot.batteryLevel ?? slot.power) < 80) return;
      if (action === 'eject empty' && Number(slot.batteryLevel ?? slot.power) >= 80) return;
      if (action === 'eject locked manual' && !slot.locked && !slot.lock) return;
      if (action === 'eject locked auto' && !slot.abnormal && !slot.quarantined) return;
      targets.push({board: topology.aggregate ? Math.floor((position - 1) / hardware.slotsPerBoard) + 1 : index + 1, slot: topology.aggregate ? (position - 1) % hardware.slotsPerBoard + 1 : position, chargerId: sn, moduleId: String(module.id || module.moduleid)});
    }));
    if (action === 'check') targets = [];
    else if (!targets.length) fail('No matching charger is present.');
    if (action === 'eject count') targets = targets.slice(0, Math.min(100, Math.max(1, Number(input.slotid) || 1)));
    const command = {id: input.requestId, stationId: kiosk.stationid, provisionId, action, targets, state: 'queued',
      expiresAt: new Date(now() + 120000).toISOString(), createdAt: new Date(now()).toISOString()};
    const fingerprint = JSON.stringify({stationId: kiosk.stationid, action, moduleid: input.moduleid || null, slotid: input.slotid || null});
    return db.runTransaction(async tx => {
      const ref = commands.doc(input.requestId), existing = (await tx.get(ref)).data();
      if (existing) { if (existing.fingerprint !== fingerprint) fail('Command identity was reused.'); return existing; }
      tx.create(ref, {...command, fingerprint});
      tx.create(db.collection(`localStationCommandQueues/${provisionId}/commands`).doc(input.requestId), {state: 'queued'}); return command;
    });
  }
  async function claim(installation) {
    const queue = db.collection(`localStationCommandQueues/${installation.provisionId}/commands`);
    const docs = (await queue.where('state', '==', 'queued').get()).docs;
    for (const doc of docs) {
      const result = await db.runTransaction(async tx => {
        const ref = commands.doc(doc.id), current = (await tx.get(ref)).data();
        tx.delete(queue.doc(doc.id));
        if (!current || current.state !== 'queued') return null;
        if (current.stationId !== installation.stationId || current.provisionId !== installation.provisionId || millis(current.expiresAt) < now()) {
          tx.set(ref, {...current, state: 'expired'}); return null;
        }
        tx.set(ref, {...current, state: 'running', installationId: installation.id, claimedAt: new Date(now()).toISOString()});
        return current;
      });
      if (result) return result;
    }
    return null;
  }
  async function complete(installation, requestId, result) {
    if (!['completed', 'failed', 'verification_pending'].includes(result.state)) fail('Invalid command result.');
    const ref = commands.doc(requestId);
    return db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!current || current.installationId !== installation.id) fail('Command belongs to another station.');
      const fingerprint = tokenHash(JSON.stringify(result));
      if (current.resultFingerprint) { if (current.resultFingerprint !== fingerprint) fail('Result identity was reused.'); return {ack: requestId}; }
      tx.set(ref, {...current, state: result.state, results: result.results || [], message: String(result.message || '').slice(0, 200), resultFingerprint: fingerprint, completedAt: new Date(now()).toISOString()});
      return {ack: requestId};
    });
  }
  async function status(requestId, auth) {
    const value = (await commands.doc(requestId).get()).data();
    if (!value) fail('Command not found.');
    const kiosk = (await db.collection('kiosks').doc(value.provisionId).get()).data();
    if (!operatorAllowed(auth, kiosk || {}, value.action)) throw new KioskTerminalError(403, 'command-access', 'Not allowed to view this station command.');
    return value.state === 'running' && now() - millis(value.claimedAt) > 180000 ?
      {...value, state: 'verification_pending', message: 'Station result needs verification; the command will not be repeated.'} : value;
  }
  return {queue, claim, complete, status};
}
module.exports = {createLocalStationCommands};
