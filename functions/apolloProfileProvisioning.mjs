import {
  apolloClientProfileId,
  createYyzApolloClientProfile,
  createYyzApolloProfileSection,
  normalizeApolloClientId,
} from './apolloProfileTemplate.mjs';

const clean = (value) => String(value || '').trim();
const upper = (value) => clean(value).toUpperCase();

export function isProvisionedApolloKiosk(kiosk) {
  return Boolean(
    kiosk
    && upper(kiosk.hardware?.gateway) === 'APOLLO'
    && clean(kiosk.hardware?.sn)
    && clean(kiosk.stationid)
    && normalizeApolloClientId(kiosk.info?.client || kiosk.info?.clientId)
    && clean(kiosk.status).toLowerCase() !== 'pending-provision'
  );
}

function provisioningIdentity(kiosk) {
  if (!isProvisionedApolloKiosk(kiosk)) return '';
  return [
    upper(kiosk.hardware?.gateway),
    clean(kiosk.hardware?.sn),
    upper(kiosk.stationid),
    normalizeApolloClientId(kiosk.info?.client || kiosk.info?.clientId),
  ].join('|');
}

function profileRecency(doc) {
  const data = doc.data() || {};
  const updatedAt = data.updatedAt;
  if (updatedAt && typeof updatedAt.toMillis === 'function') return updatedAt.toMillis();
  const parsed = Date.parse(String(updatedAt || ''));
  return Number.isFinite(parsed) ? parsed : Number(data.version || 0);
}

function selectCanonicalProfile(docs) {
  return [...docs].sort((left, right) => profileRecency(right) - profileRecency(left))[0] || null;
}

export async function seedApolloClientProfileOnProvision({before, after, db, serverTimestamp}) {
  if (!isProvisionedApolloKiosk(after)) return {created: false, updated: false, reason: 'not-apollo'};
  if (provisioningIdentity(before) === provisioningIdentity(after)) {
    return {created: false, updated: false, reason: 'unchanged'};
  }

  const clientId = normalizeApolloClientId(after.info?.client || after.info?.clientId);
  const collection = db.collection('uiProfiles');
  const candidates = await collection.where('clientId', '==', clientId).get();
  const canonical = selectCanonicalProfile(candidates.docs);
  const generatedProfileId = apolloClientProfileId(clientId);
  if (!canonical && !generatedProfileId) throw new Error('Apollo client cannot be converted to a profile identifier.');
  const profileRef = canonical?.ref || collection.doc(generatedProfileId);
  const timestamp = serverTimestamp();

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(profileRef);
    const existing = snap.exists ? snap.data() || {} : {};
    const existingClientId = normalizeApolloClientId(existing.clientId);
    if (snap.exists && existingClientId !== clientId) throw new Error('Apollo profile identifier belongs to another client.');
    if (existing.terminalProfiles?.apollo?.translations) {
      return {created: false, updated: false, reason: 'already-seeded', profileId: profileRef.id, clientId};
    }

    if (!snap.exists) {
      transaction.set(profileRef, createYyzApolloClientProfile(clientId, timestamp));
      return {created: true, updated: false, profileId: profileRef.id, clientId};
    }

    transaction.set(profileRef, {
      terminalProfiles: {
        ...(existing.terminalProfiles || {}),
        apollo: createYyzApolloProfileSection(),
      },
      sectionVersions: {
        ...(existing.sectionVersions || {}),
        apollo: Number(existing.sectionVersions?.apollo || 0) + 1,
      },
      version: Number(existing.version || 0) + 1,
      updatedAt: timestamp,
      updatedByUid: '',
      updatedByUsername: 'system:apollo-provisioning',
    }, {merge: true});
    return {created: false, updated: true, profileId: profileRef.id, clientId};
  });
}
