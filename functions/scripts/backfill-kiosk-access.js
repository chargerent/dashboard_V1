/* eslint-env node */
const admin = require("firebase-admin");
const {
  KIOSK_ACCESS_COLLECTION,
  buildKioskAccessRecord,
} = require("../kioskAccessScope");

admin.initializeApp();
const db = admin.firestore();

async function main() {
  const apply = process.argv.includes("--apply");
  const snapshot = await db.collection("kiosks").get();
  const records = new Map();
  const duplicates = new Set();

  snapshot.docs.forEach((doc) => {
    const record = buildKioskAccessRecord(doc.id, doc.data());
    if (!record) return;
    if (records.has(record.stationId)) duplicates.add(record.stationId);
    records.set(record.stationId, record);
  });

  if (duplicates.size > 0) {
    throw new Error(`Duplicate station identifiers found: ${Array.from(duplicates).join(", ")}`);
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    kioskDocuments: snapshot.size,
    accessRecords: records.size,
  }));
  if (!apply) return;

  let batch = db.batch();
  let pending = 0;
  let written = 0;
  for (const record of records.values()) {
    batch.set(db.collection(KIOSK_ACCESS_COLLECTION).doc(record.stationId), {
      ...record,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    pending += 1;
    if (pending === 400) {
      await batch.commit();
      written += pending;
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) {
    await batch.commit();
    written += pending;
  }

  console.log(JSON.stringify({status: "complete", written}));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
