import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");
const {
  buildPublicAssetId,
  buildPublicAssetStoragePath,
  inferPublicAssetDetails,
} = require("../functions/aiBoothPublicAssets.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "node-red-alerts";
const STORAGE_BUCKET = "node-red-alerts.firebasestorage.app";
const EVENT_ID = "roland-garros-2026-demo";
const SUBMISSION_ID = "roland-garros-2026-demo-menu-library";
const PUBLIC_ASSET_BASE_URL = "https://obailix.com/a";
const DEFAULT_MENU_DIR = path.resolve(
  __dirname,
  "../../AiBooth/output/pdf/roland-garros-demo-menus",
);
const PDFTOTEXT_BIN = process.env.PDFTOTEXT_BIN || "pdftotext";
const PDF_TEXT_PYTHON = process.env.PDF_TEXT_PYTHON || "python3";
const APPLY = process.argv.includes("--apply");
const MENU_LABELS = new Map([
  ["ace-pizza", "Ace Pizza"],
  ["baseline-coffee", "Baseline Coffee"],
  ["court-side-coffee", "Court Side Coffee"],
  ["green-set", "Green Set"],
  ["la-terrasse-francaise", "La Terrasse Française"],
  ["match-point-sushi", "Match Point Sushi"],
]);
const MENU_QR_CODES = new Map([
  ["ace-pizza", "rga"],
  ["baseline-coffee", "rgb"],
  ["court-side-coffee", "rgc"],
  ["green-set", "rgg"],
  ["la-terrasse-francaise", "rgt"],
  ["match-point-sushi", "rgs"],
]);

function buildMenuQrAssetId(slug, language) {
  const code = MENU_QR_CODES.get(slug);
  if (!code) throw new Error(`No compact QR code is configured for menu slug: ${slug}`);
  return `${code}${language === "fr" ? "f" : "e"}`;
}

function buildDownloadUrl(storagePath, downloadToken) {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`
  );
}

function getDownloadToken(metadata = {}) {
  return String(
    metadata?.metadata?.firebaseStorageDownloadTokens ||
    metadata?.metadata?.firebaseStorageDownloadToken ||
    "",
  ).split(",")[0].trim();
}

function extractPdfText(filePath) {
  let text = "";
  try {
    text = execFileSync(PDFTOTEXT_BIN, ["-layout", filePath, "-"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    const pythonSource = [
      "import pdfplumber, sys",
      "with pdfplumber.open(sys.argv[1]) as pdf:",
      "    print('\\n\\n'.join((page.extract_text() or '') for page in pdf.pages))",
    ].join("\n");
    text = execFileSync(PDF_TEXT_PYTHON, ["-c", pythonSource, filePath], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  }
  return text.replace(/\r\n/g, "\n").trim();
}

async function listMenuFiles(menuDir) {
  const fileNames = (await readdir(menuDir))
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .sort();
  if (fileNames.length !== 12) {
    throw new Error(`Expected 12 Roland-Garros menu PDFs, found ${fileNames.length}.`);
  }
  return fileNames;
}

async function buildMenuRecord(menuDir, fileName) {
  const filePath = path.join(menuDir, fileName);
  const [buffer, fileStats] = await Promise.all([readFile(filePath), stat(filePath)]);
  const inferred = inferPublicAssetDetails(fileName);
  const fileId = createHash("sha256").update(buffer).digest("hex").slice(0, 24);
  const assetInput = {
    targetType: "event",
    targetId: EVENT_ID,
    assetType: "menu",
    language: inferred.language,
    slug: inferred.slug,
  };
  const assetId = buildPublicAssetId(assetInput);
  const storagePath = [
    "intake",
    "event",
    EVENT_ID,
    SUBMISSION_ID,
    fileId,
    fileName,
  ].join("/");
  const extractedTextPath = `${storagePath}.extracted.txt`;
  const publicStoragePath = buildPublicAssetStoragePath(assetInput);
  const extractedText = extractPdfText(filePath);

  return {
    filePath,
    buffer,
    fileName,
    fileId,
    fileSize: fileStats.size,
    extractedText,
    extractedTextPath,
    storagePath,
    publicStoragePath,
    assetId,
    assetInput,
    label: MENU_LABELS.get(inferred.slug) || inferred.label,
  };
}

async function uploadMenu(bucket, menu, nowIso, actor) {
  const privateMetadata = {
    contentType: "application/pdf",
    contentDisposition: `inline; filename="${menu.fileName}"`,
    cacheControl: "private,no-store,max-age=0",
    metadata: {
      eventId: EVENT_ID,
      submissionId: SUBMISSION_ID,
      fileId: menu.fileId,
    },
  };
  await bucket.upload(menu.filePath, {
    destination: menu.storagePath,
    resumable: false,
    metadata: privateMetadata,
  });
  await bucket.file(menu.extractedTextPath).save(menu.extractedText, {
    resumable: false,
    contentType: "text/plain; charset=utf-8",
    metadata: {
      cacheControl: "private,no-store,max-age=0",
      metadata: {
        eventId: EVENT_ID,
        submissionId: SUBMISSION_ID,
        fileId: menu.fileId,
      },
    },
  });

  const publicFile = bucket.file(menu.publicStoragePath);
  const [publicExists] = await publicFile.exists();
  let downloadToken = "";
  if (publicExists) {
    const [metadata] = await publicFile.getMetadata();
    downloadToken = getDownloadToken(metadata);
  }
  downloadToken ||= randomUUID();
  await bucket.upload(menu.filePath, {
    destination: menu.publicStoragePath,
    resumable: false,
    metadata: {
      contentType: "application/pdf",
      contentDisposition: `inline; filename="${menu.fileName}"`,
      cacheControl: "public,max-age=300",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        sourceSubmissionId: SUBMISSION_ID,
        sourceFileId: menu.fileId,
        targetType: "event",
        targetId: EVENT_ID,
        assetType: "menu",
        language: menu.assetInput.language,
        slug: menu.assetInput.slug,
      },
    },
  });

  const publicAsset = {
    id: menu.assetId,
    assetType: "menu",
    label: menu.label,
    language: menu.assetInput.language,
    slug: menu.assetInput.slug,
    fileName: menu.fileName,
    contentType: "application/pdf",
    size: menu.fileSize,
    storagePath: menu.publicStoragePath,
    bucketName: STORAGE_BUCKET,
    publicUrl: `${PUBLIC_ASSET_BASE_URL}/${menu.assetId}`,
    qrAssetId: buildMenuQrAssetId(menu.assetInput.slug, menu.assetInput.language),
    qrUrl: `${PUBLIC_ASSET_BASE_URL}/${buildMenuQrAssetId(menu.assetInput.slug, menu.assetInput.language)}`,
    downloadUrl: buildDownloadUrl(menu.publicStoragePath, downloadToken),
    sourceSubmissionId: SUBMISSION_ID,
    sourceFileId: menu.fileId,
    active: true,
    publishedAt: nowIso,
    publishedBy: actor,
  };
  const fileRecord = {
    id: menu.fileId,
    fileName: menu.fileName,
    contentType: "application/pdf",
    size: menu.fileSize,
    storagePath: menu.storagePath,
    extractedTextPath: menu.extractedTextPath,
    extractedTextPreview: menu.extractedText.slice(0, 1200),
    extractedTextBytes: Buffer.byteLength(menu.extractedText),
    extractionStatus: "ready",
    extractionError: "",
    uploadedAt: nowIso,
    publicAsset,
  };

  return { publicAsset, fileRecord };
}

async function main() {
  const menuDirArg = process.argv.find((value) => value.startsWith("--menu-dir="));
  const menuDir = menuDirArg ? path.resolve(menuDirArg.slice("--menu-dir=".length)) : DEFAULT_MENU_DIR;
  const fileNames = await listMenuFiles(menuDir);
  const menus = await Promise.all(fileNames.map((fileName) => buildMenuRecord(menuDir, fileName)));

  console.log(`${APPLY ? "Applying" : "Dry run for"} ${menus.length} Roland-Garros menu PDFs:`);
  for (const menu of menus) {
    const qrAssetId = buildMenuQrAssetId(menu.assetInput.slug, menu.assetInput.language);
    console.log(`- ${menu.fileName} -> ${PUBLIC_ASSET_BASE_URL}/${menu.assetId} (QR: ${PUBLIC_ASSET_BASE_URL}/${qrAssetId})`);
  }
  if (!APPLY) {
    console.log("No data was changed. Re-run with --apply after reviewing this list.");
    return;
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required for --apply.");
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
    storageBucket: STORAGE_BUCKET,
  });
  const db = admin.firestore();
  const eventRef = db.collection("aiBoothEvents").doc(EVENT_ID);
  const eventSnapshot = await eventRef.get();
  if (!eventSnapshot.exists) {
    throw new Error(`AI Booth event ${EVENT_ID} was not found.`);
  }

  const nowIso = new Date().toISOString();
  const actor = { uid: "codex-menu-import", username: "codex" };
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const published = [];
  for (const menu of menus) {
    published.push(await uploadMenu(bucket, menu, nowIso, actor));
  }

  const publicAssets = published.map((item) => item.publicAsset)
    .sort((left, right) => (
      `${left.label}:${left.language}`.localeCompare(`${right.label}:${right.language}`)
    ));
  const files = published.map((item) => item.fileRecord);
  const eventData = eventSnapshot.data() || {};
  const existingPublicAssets = (Array.isArray(eventData.publicAssets) ? eventData.publicAssets : [])
    .filter((asset) => asset?.sourceSubmissionId !== SUBMISSION_ID);
  const batch = db.batch();
  for (const asset of publicAssets) {
    batch.set(db.collection("aiBoothPublicAssets").doc(asset.id), {
      ...asset,
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      publishedAtIso: nowIso,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection("aiBoothPublicAssets").doc(asset.qrAssetId), {
      ...asset,
      id: asset.qrAssetId,
      aliasOf: asset.id,
      publicUrl: asset.qrUrl,
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      publishedAtIso: nowIso,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  batch.set(db.collection("eventIntakeSubmissions").doc(SUBMISSION_ID), {
    eventId: EVENT_ID,
    targetType: "event",
    targetId: EVENT_ID,
    targetTitle: eventData.general?.eventName || "Roland-Garros 2026 AI Concierge Demo",
    eventTitle: eventData.general?.eventName || "Roland-Garros 2026 AI Concierge Demo",
    participantName: "Obailix Demo Content Team",
    organization: "Roland-Garros Demo Restaurants",
    email: "",
    phone: "",
    role: "Demo menu library",
    category: "Food & Beverage",
    notes: "English and French guest menus for QR display in the AI concierge demo.",
    links: [],
    status: "approved",
    allowEditsAfterSubmit: false,
    files,
    fileCount: files.length,
    adminNotes: "Approved demo material imported through the standard client intake review structure.",
    screeningSummary: "12 mock menu PDFs reviewed and published for QR viewing: 6 English and 6 French.",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: "codex-menu-import",
  }, { merge: true });
  batch.set(eventRef, {
    publicAssets: [...existingPublicAssets, ...publicAssets],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor,
  }, { merge: true });
  await batch.commit();

  console.log(`Published ${publicAssets.length} menu PDFs and linked them to ${EVENT_ID}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
