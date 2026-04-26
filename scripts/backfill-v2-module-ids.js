#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const DEFAULT_KEY_PATH = "/home/george/firestore/firestore-key.json";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    keyPath: process.env.FIRESTORE_KEY_PATH ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      DEFAULT_KEY_PATH,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--key" && argv[index + 1]) {
      options.keyPath = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return options;
}

function normalizeModuleId(moduleId) {
  return String(moduleId || "").trim();
}

function isV2ModuleId(moduleId) {
  return /^\d{15,}$/.test(normalizeModuleId(moduleId));
}

function collectV2ModuleIds(modules) {
  const ids = new Set();
  const normalizedModules = Array.isArray(modules) ? modules : [];

  normalizedModules.forEach((module) => {
    const moduleId = normalizeModuleId(module?.id);
    if (!isV2ModuleId(moduleId)) {
      return;
    }

    ids.add(moduleId);
  });

  return Array.from(ids).sort();
}

function normalizeExistingModuleIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
      .map((entry) => normalizeModuleId(entry))
      .filter(Boolean)
      .sort();
}

function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

async function main() {
  const options = parseArgs(process.argv);
  const keyPath = path.resolve(options.keyPath);

  if (!fs.existsSync(keyPath)) {
    throw new Error(`Firestore key not found at ${keyPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  const db = admin.firestore();
  const snapshot = await db.collection("kiosks").get();
  const writer = options.dryRun ? null : db.bulkWriter();

  let scanned = 0;
  let eligible = 0;
  let updated = 0;
  const touchedStations = [];

  for (const docSnap of snapshot.docs) {
    scanned += 1;
    const kiosk = docSnap.data() || {};
    const nextModuleIds = collectV2ModuleIds(kiosk.modules);
    if (nextModuleIds.length === 0) {
      continue;
    }

    eligible += 1;
    const currentModuleIds = normalizeExistingModuleIds(kiosk.moduleIds);
    if (arraysEqual(currentModuleIds, nextModuleIds)) {
      continue;
    }

    updated += 1;
    touchedStations.push(String(kiosk.stationid || docSnap.id));

    if (!options.dryRun) {
      writer.set(docSnap.ref, {moduleIds: nextModuleIds}, {merge: true});
    }
  }

  if (writer) {
    await writer.close();
  }

  console.log(JSON.stringify({
    dryRun: options.dryRun,
    keyPath,
    scanned,
    eligible,
    updated,
    touchedStations,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
