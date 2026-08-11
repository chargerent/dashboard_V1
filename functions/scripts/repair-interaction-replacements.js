#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const DAYS = 7;
const PAIR_WINDOW_MS = 2000;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'node-red-alerts',
  });
}

const db = admin.firestore();
const collection = db.collection('kioskEvents');
const cutoffMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;

function eventMs(event) {
  return event.occurredAt && typeof event.occurredAt.toMillis === 'function'
    ? event.occurredAt.toMillis()
    : Date.parse(event.occurredAt || 0) || 0;
}

function serialize(value) {
  if (value && typeof value.toDate === 'function') {
    return { __firestoreType: 'timestamp', value: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

function isRentOrReturnStart(event) {
  if (event.type !== 'interaction_started') return false;
  const summary = String(event.summary || '').toLowerCase();
  return summary.includes('return interaction started') || summary.includes('rental interaction started');
}

function isMatchingAction(event, started) {
  if (event.type !== 'action_selected' || event.interactionId !== started.interactionId) return false;
  const startedSummary = String(started.summary || '').toLowerCase();
  const actionSummary = String(event.summary || '').toLowerCase();
  if (startedSummary.includes('return')) return actionSummary.includes('return selected');
  if (startedSummary.includes('rental')) return actionSummary.includes('rent selected');
  return false;
}

function rootInteractionId(interactionId, mergeMap) {
  let current = interactionId;
  const seen = new Set();
  while (mergeMap.has(current) && !seen.has(current)) {
    seen.add(current);
    current = mergeMap.get(current);
  }
  return current;
}

async function commitOperations(operations) {
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = db.batch();
    for (const operation of operations.slice(offset, offset + 400)) {
      const ref = collection.doc(operation.id);
      if (operation.kind === 'delete') batch.delete(ref);
      else batch.update(ref, operation.data);
    }
    await batch.commit();
  }
}

async function main() {
  console.error('Loading replacement warnings...');
  const abandonedSnapshot = await collection
    .where('type', '==', 'interaction_abandoned')
    .select('type', 'summary', 'stationId', 'interactionId', 'interactionKind', 'sourceSurface', 'occurredAt')
    .get();
  const abandoned = abandonedSnapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((event) => eventMs(event) >= cutoffMs)
    .sort((left, right) => eventMs(left) - eventMs(right));

  const stationIds = [...new Set(abandoned.map((event) => event.stationId).filter(Boolean))];
  const allEvents = [];
  for (const stationId of stationIds) {
    console.error(`Loading interaction index for ${stationId}...`);
    const snapshot = await collection
      .where('stationId', '==', stationId)
      .select('type', 'summary', 'stationId', 'interactionId', 'interactionKind', 'sourceSurface', 'occurredAt')
      .get();
    allEvents.push(...snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((event) => eventMs(event) >= cutoffMs));
  }
  allEvents.sort((left, right) => eventMs(left) - eventMs(right));

  const byStation = new Map();
  for (const event of allEvents) {
    if (!byStation.has(event.stationId)) byStation.set(event.stationId, []);
    byStation.get(event.stationId).push(event);
  }

  const pairs = [];
  const ambiguous = [];
  for (const warning of abandoned) {
    const stationEvents = byStation.get(warning.stationId) || [];
    const warningAt = eventMs(warning);
    const immediate = stationEvents.filter((event) => {
      const at = eventMs(event);
      // UI-mode interactions may legitimately move between the customer UI and
      // terminal payment surface while retaining one interaction ID.
      return at > warningAt && at <= warningAt + PAIR_WINDOW_MS;
    });
    const started = immediate.find(isRentOrReturnStart);
    const action = started && immediate.find((event) => isMatchingAction(event, started));
    if (!started || !action || !warning.interactionId || !started.interactionId || warning.interactionId === started.interactionId) {
      ambiguous.push({
        warningId: warning.id,
        stationId: warning.stationId,
        occurredAt: new Date(warningAt).toISOString(),
        oldInteractionId: warning.interactionId || null,
        reason: !started ? 'no_immediate_rent_or_return_start' : !action ? 'no_matching_action_selected' : 'invalid_interaction_ids',
      });
      continue;
    }
    pairs.push({ warning, started, action });
  }

  const mergeMap = new Map();
  for (const pair of pairs) {
    mergeMap.set(pair.started.interactionId, rootInteractionId(pair.warning.interactionId, mergeMap));
  }

  const updates = [];
  for (const event of allEvents) {
    if (!mergeMap.has(event.interactionId)) continue;
    const targetInteractionId = rootInteractionId(event.interactionId, mergeMap);
    if (targetInteractionId === event.interactionId) continue;
    updates.push({
      id: event.id,
      kind: 'update',
      data: {
        interactionId: targetInteractionId,
        historyRepair: {
          repairedAt: admin.firestore.FieldValue.serverTimestamp(),
          repairType: 'merge_replaced_ui_interaction',
          previousInteractionId: event.interactionId,
        },
      },
      beforeInteractionId: event.interactionId,
      afterInteractionId: targetInteractionId,
    });
  }

  const deletes = new Map();
  for (const pair of pairs) {
    deletes.set(pair.warning.id, { id: pair.warning.id, kind: 'delete', reason: 'faulty_replacement_warning' });
    deletes.set(pair.started.id, { id: pair.started.id, kind: 'delete', reason: 'redundant_interaction_started' });
  }

  const affectedIds = new Set([...updates.map((operation) => operation.id), ...deletes.keys()]);
  console.error(`Loading ${affectedIds.size} complete documents for backup...`);
  const backupDocuments = [];
  const affectedIdList = [...affectedIds];
  for (let offset = 0; offset < affectedIdList.length; offset += 300) {
    const snapshots = await db.getAll(...affectedIdList.slice(offset, offset + 300).map((id) => collection.doc(id)));
    for (const snapshot of snapshots) {
      if (!snapshot.exists) throw new Error(`affected document disappeared before backup: ${snapshot.id}`);
      backupDocuments.push({ id: snapshot.id, data: serialize(snapshot.data()) });
    }
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const outputDir = path.resolve(__dirname, '../../firestore-migration-backups');
  fs.mkdirSync(outputDir, { recursive: true });
  const backupPath = path.join(outputDir, `interaction-replacements-${stamp}.json`);
  const reportPath = path.join(outputDir, `interaction-replacements-${stamp}.report.json`);
  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    days: DAYS,
    cutoff: new Date(cutoffMs).toISOString(),
    warningsFound: abandoned.length,
    confirmedPairs: pairs.length,
    ambiguous: ambiguous.length,
    documentsToUpdate: updates.length,
    documentsToDelete: deletes.size,
    affectedStations: stationIds,
    byStation: Object.fromEntries(stationIds.map((stationId) => [
      stationId,
      pairs.filter((pair) => pair.warning.stationId === stationId).length,
    ])),
    backupPath,
    ambiguousRecords: ambiguous,
  };

  fs.writeFileSync(backupPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'node-red-alerts',
    collection: 'kioskEvents',
    documents: backupDocuments,
  }, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  if (APPLY) {
    await commitOperations([...updates, ...deletes.values()]);
  }

  console.log(JSON.stringify({ ...summary, reportPath }, null, 2));
}

main()
  .then(() => admin.app().delete())
  .catch(async (error) => {
    console.error(error);
    try {
      await admin.app().delete();
    } catch (cleanupError) {
      console.warn('Unable to close Firebase after repair failure:', cleanupError.message);
    }
    process.exitCode = 1;
  });
