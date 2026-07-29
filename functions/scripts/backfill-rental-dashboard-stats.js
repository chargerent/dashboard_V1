/* eslint-env node */
const admin = require("firebase-admin");
const crypto = require("node:crypto");
const {
  DASHBOARD_STATS_SCHEMA_VERSION,
  applyRentalProjection,
  buildRentalProjection,
  getRentalRetentionCutoff,
  projectionsEqual,
} = require("../rentalDashboardStats");

const APPLY_FLAG = "--apply";
const META_COLLECTION = "rentalDashboardMeta";
const META_DOCUMENT = "current";
const PROJECTIONS_COLLECTION = "rentalDashboardProjections";
const STATS_COLLECTION = "rentalDashboardStats";

async function deleteCollection(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const writer = db.bulkWriter();
  snapshot.docs.forEach((documentSnapshot) => writer.delete(documentSnapshot.ref));
  await writer.close();
  return snapshot.size;
}

async function loadRelevantRentals(db, cutoffIso) {
  const recentSnapshot = await db.collection("rentals")
      .where("rentalTime", ">=", cutoffIso)
      .select(
          "rentalStationid",
          "rentalTime",
          "totalCharged",
          "initialCharge",
          "status",
      )
      .get();
  const rentalsById = new Map();
  recentSnapshot.docs.forEach((documentSnapshot) => {
    rentalsById.set(documentSnapshot.id, documentSnapshot.data());
  });
  return {
    rentalsById,
    readTime: recentSnapshot.readTime,
  };
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

async function reconcilePendingEvent(db, eventRef, generation, sourceReadTime) {
  return db.runTransaction(async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    if (!eventSnapshot.exists) return false;

    const event = eventSnapshot.data();
    if (event.generation !== generation || event.applyState !== "pending") return false;

    const previousProjection = event.previousProjection || null;
    const desiredProjection = event.desiredProjection || null;
    const shouldApply = timestampMillis(event.sourceChangeTime) >
      timestampMillis(sourceReadTime);
    const stationIds = Array.from(new Set([
      previousProjection?.stationid,
      desiredProjection?.stationid,
    ].filter(Boolean)));
    const summaryRefs = stationIds.map((stationId) => (
      db.collection(STATS_COLLECTION).doc(stationId)
    ));
    const summarySnapshots = shouldApply ?
      await Promise.all(summaryRefs.map((summaryRef) => transaction.get(summaryRef))) :
      [];
    const summariesByStationId = new Map(
        summarySnapshots.map((snapshot, index) => [
          stationIds[index],
          snapshot.exists ? snapshot.data() : null,
        ]),
    );

    if (
      shouldApply &&
      previousProjection &&
      !projectionsEqual(previousProjection, desiredProjection)
    ) {
      summariesByStationId.set(
          previousProjection.stationid,
          applyRentalProjection(
              summariesByStationId.get(previousProjection.stationid),
              previousProjection,
              -1,
          ),
      );
    }

    if (
      shouldApply &&
      desiredProjection &&
      !projectionsEqual(previousProjection, desiredProjection)
    ) {
      summariesByStationId.set(
          desiredProjection.stationid,
          applyRentalProjection(
              summariesByStationId.get(desiredProjection.stationid),
              desiredProjection,
              1,
          ),
      );
    }

    summariesByStationId.forEach((summary, stationId) => {
      transaction.set(db.collection(STATS_COLLECTION).doc(stationId), {
        ...summary,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    transaction.update(eventRef, {
      applyState: "applied",
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      includedInSourceSnapshot: !shouldApply,
    });
    return true;
  });
}

async function drainPendingEvents(db, generation, sourceReadTime) {
  let reconciled = 0;

  for (let pass = 0; pass < 10; pass += 1) {
    const eventSnapshot = await db.collection("rentalDashboardEvents")
        .where("generation", "==", generation)
        .get();
    const pendingEvents = eventSnapshot.docs.filter(
        (documentSnapshot) => documentSnapshot.data().applyState === "pending",
    );
    if (pendingEvents.length === 0) return reconciled;

    for (const eventDocument of pendingEvents) {
      if (await reconcilePendingEvent(
          db,
          eventDocument.ref,
          generation,
          sourceReadTime,
      )) {
        reconciled += 1;
      }
    }
  }

  throw new Error("Pending rental dashboard events did not drain after 10 passes.");
}

async function main() {
  const shouldApply = process.argv.includes(APPLY_FLAG);
  admin.initializeApp();
  const db = admin.firestore();
  const metaRef = db.collection(META_COLLECTION).doc(META_DOCUMENT);
  const generation = crypto.randomUUID();

  if (shouldApply) {
    await metaRef.set({
      ready: false,
      generation,
      pendingSchemaVersion: DASHBOARD_STATS_SCHEMA_VERSION,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  const cutoff = getRentalRetentionCutoff();
  const cutoffIso = cutoff.toISOString();
  const {
    rentalsById,
    readTime: sourceReadTime,
  } = await loadRelevantRentals(db, cutoffIso);

  const summariesByStationId = new Map();
  rentalsById.forEach((rental) => {
    const projection = buildRentalProjection(rental);
    if (!projection) return;

    summariesByStationId.set(
        projection.stationid,
        applyRentalProjection(
            summariesByStationId.get(projection.stationid),
            projection,
            1,
        ),
    );
  });

  console.log(JSON.stringify({
    apply: shouldApply,
    cutoff: cutoff.toISOString(),
    rentals: rentalsById.size,
    stations: summariesByStationId.size,
    schemaVersion: DASHBOARD_STATS_SCHEMA_VERSION,
  }, null, 2));

  if (!shouldApply) {
    console.log(`Dry run only. Re-run with ${APPLY_FLAG} to replace dashboard summaries.`);
    return;
  }

  const deletedStats = await deleteCollection(db, STATS_COLLECTION);
  const deletedProjections = await deleteCollection(db, PROJECTIONS_COLLECTION);
  const writer = db.bulkWriter();

  summariesByStationId.forEach((summary, stationId) => {
    writer.set(db.collection(STATS_COLLECTION).doc(stationId), {
      ...summary,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await writer.close();

  const reconciledBeforeReady = await drainPendingEvents(
      db,
      generation,
      sourceReadTime,
  );

  await metaRef.set({
    ready: true,
    schemaVersion: DASHBOARD_STATS_SCHEMA_VERSION,
    pendingSchemaVersion: admin.firestore.FieldValue.delete(),
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    cutoff: cutoff.toISOString(),
    sourceReadTime,
    snapshotRentalCount: rentalsById.size,
    stationCount: summariesByStationId.size,
  }, {merge: true});

  let reconciledAfterReady = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    reconciledAfterReady += await drainPendingEvents(
        db,
        generation,
        sourceReadTime,
    );
  }

  console.log(JSON.stringify({
    deletedStats,
    deletedProjections,
    generation,
    reconciledBeforeReady,
    reconciledAfterReady,
    ready: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
