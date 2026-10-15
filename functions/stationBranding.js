/* eslint-env node */
const {normalizeStationBrand} = require('./stationBrand');

// Ownership belongs to the station, never to a shared client appearance profile.
async function setStationBrand(data, authState, {db, admin, HttpsError, canManageStation}) {
  const {hasStationScreen} = await import('./uiProfileSections.mjs');
  const stationId = String(data?.stationid || '').trim().toUpperCase();
  let brand;
  let expected;
  try {
    if (!stationId || typeof data?.stationBrand !== 'string' || !data.stationBrand.trim() ||
        typeof data?.expectedStationBrand !== 'string' || !data.expectedStationBrand.trim()) throw new Error('Choose a station and its brand.');
    brand = normalizeStationBrand(data.stationBrand);
    expected = normalizeStationBrand(data.expectedStationBrand);
  } catch (error) {throw new HttpsError('invalid-argument', error.message);}
  return db.runTransaction(async (transaction) => {
    const snapshots = await transaction.get(db.collection('kiosks').where('stationid', '==', stationId));
    if (snapshots.docs.length !== 1) throw new HttpsError('failed-precondition', 'The station assignment changed or is duplicated. Reload before changing its brand.');
    const snapshot = snapshots.docs[0];
    const kiosk = snapshot.data();
    if (!canManageStation(authState, kiosk)) throw new HttpsError('permission-denied', 'Not allowed to change this station brand.');
    if (!hasStationScreen(kiosk)) throw new HttpsError('failed-precondition', 'Station branding is available only for stations with a screen.');
    if (normalizeStationBrand(kiosk.stationBrand) !== expected) throw new HttpsError('aborted', 'The station brand changed. Reload before saving.');
    transaction.update(snapshot.ref, {
      stationBrand: brand,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: String(authState.profile?.username || authState.uid || '').trim().toLowerCase(),
    });
    return {ok: true, kiosk: {...kiosk, stationBrand: brand}};
  });
}

module.exports = {setStationBrand};
