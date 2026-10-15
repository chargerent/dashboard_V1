/* eslint-env node */

const KIOSK_ACCESS_COLLECTION = "kioskAccess";

function normalizeIdentifier(value) {
  return String(value || "").trim().toUpperCase();
}

function buildKioskAccessRecord(kioskDocId, kiosk) {
  if (!kiosk || typeof kiosk !== "object") return null;

  const stationId = normalizeIdentifier(kiosk.stationid || kiosk.stationId || kioskDocId);
  if (!stationId || stationId.includes("/")) return null;

  return {
    stationId,
    kioskDocId: String(kioskDocId || "").trim(),
    clientId: normalizeIdentifier(kiosk.info?.client || kiosk.info?.clientId),
    repId: normalizeIdentifier(kiosk.info?.rep || kiosk.info?.repId),
  };
}

function kioskAccessRecordsEqual(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.stationId === right.stationId &&
    left.kioskDocId === right.kioskDocId &&
    left.clientId === right.clientId &&
    left.repId === right.repId;
}

async function syncKioskAccessFromWrite({
  before,
  after,
  kioskDocId,
  db,
  serverTimestamp,
}) {
  const previous = buildKioskAccessRecord(kioskDocId, before);
  const desired = buildKioskAccessRecord(kioskDocId, after);

  if (kioskAccessRecordsEqual(previous, desired)) {
    return {changed: false, stationId: desired?.stationId || previous?.stationId || ""};
  }

  const collection = db.collection(KIOSK_ACCESS_COLLECTION);
  if (previous && previous.stationId !== desired?.stationId) {
    const previousRef = collection.doc(previous.stationId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(previousRef);
      if (snapshot.exists && snapshot.data()?.kioskDocId === kioskDocId) {
        transaction.delete(previousRef);
      }
    });
  }

  if (desired) {
    await collection.doc(desired.stationId).set({
      ...desired,
      updatedAt: serverTimestamp(),
    });
  }

  return {changed: true, stationId: desired?.stationId || previous?.stationId || ""};
}

module.exports = {
  KIOSK_ACCESS_COLLECTION,
  buildKioskAccessRecord,
  kioskAccessRecordsEqual,
  syncKioskAccessFromWrite,
};
