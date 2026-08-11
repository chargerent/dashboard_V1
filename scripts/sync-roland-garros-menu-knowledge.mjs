import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENT_ID = "roland-garros-2026-demo";
const DOCUMENT_NAME = "Roland-Garros Demo Public Menus";
const APPLY = process.argv.includes("--apply");

function parseEnv(raw) {
  return Object.fromEntries(raw.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return null;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return [match[1], value];
  }).filter(Boolean));
}

async function elevenLabsRequest(apiKey, pathname, options = {}) {
  const response = await fetch(`https://api.elevenlabs.io${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object"
      ? (payload.detail || payload.message || payload.error || "")
      : payload;
    throw new Error(
      `ElevenLabs request failed with ${response.status}: ${JSON.stringify(detail).slice(0, 800)}`,
    );
  }
  return payload;
}

function buildMenuKnowledge(eventName, publicAssets) {
  const menuLines = publicAssets.map((asset) => {
    const language = asset.language === "fr" ? "French" : "English";
    return `- ${asset.label} (${language} menu): ${asset.publicUrl}`;
  });

  return [
    `# ${eventName} Approved Public Menus`,
    "",
    "These are fictional demo menus for the Roland-Garros AI concierge demonstration.",
    "When a guest asks to view one of these menus, use the show_qr tool with the exact HTTPS URL listed below.",
    "Use the French URL when the guest is speaking French or explicitly asks for French; otherwise use English.",
    "Never invent live availability, prices, ingredients, or allergen guarantees beyond the approved menu PDF.",
    "",
    ...menuLines,
    "",
  ].join("\n");
}

async function main() {
  const envPath = path.resolve(__dirname, "../../AiBooth/.env");
  const env = parseEnv(await readFile(envPath, "utf8"));
  const apiKey = env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured.");
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required.");
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "node-red-alerts",
  });
  try {
    const db = admin.firestore();
    const eventRef = db.collection("aiBoothEvents").doc(EVENT_ID);
    const eventSnapshot = await eventRef.get();
    if (!eventSnapshot.exists) {
      throw new Error(`AI Booth event ${EVENT_ID} was not found.`);
    }
    const event = eventSnapshot.data() || {};
    const publicAssets = (Array.isArray(event.publicAssets) ? event.publicAssets : [])
      .filter((asset) => asset?.active !== false && asset?.assetType === "menu" && asset?.publicUrl)
      .sort((left, right) => (
        `${left.label}:${left.language}`.localeCompare(`${right.label}:${right.language}`)
      ));
    if (publicAssets.length !== 12) {
      throw new Error(`Expected 12 published menu assets, found ${publicAssets.length}.`);
    }
    const agentId = String(event.agent?.agentId || "").trim();
    if (!agentId) {
      throw new Error("The event has no linked ElevenLabs agent.");
    }

    const agent = await elevenLabsRequest(
      apiKey,
      `/v1/convai/agents/${encodeURIComponent(agentId)}`,
      { method: "GET" },
    );
    const conversationConfig = agent?.conversation_config || {};
    const agentConfig = conversationConfig.agent || {};
    const promptConfig = agentConfig.prompt || {};
    const currentKnowledge = Array.isArray(promptConfig.knowledge_base)
      ? promptConfig.knowledge_base
      : [];
    const oldMenuEntries = currentKnowledge.filter((entry) => entry?.name === DOCUMENT_NAME);
    const knowledgeList = await elevenLabsRequest(
      apiKey,
      `/v1/convai/knowledge-base?page_size=100&search=${encodeURIComponent(DOCUMENT_NAME)}`,
      { method: "GET" },
    );
    const existingMenuDocuments = (Array.isArray(knowledgeList?.documents)
      ? knowledgeList.documents
      : []).filter((document) => document?.name === DOCUMENT_NAME);
    const knowledgeText = buildMenuKnowledge(
      event.general?.eventName || "Roland-Garros 2026 AI Concierge Demo",
      publicAssets,
    );

    console.log(`Prepared ${publicAssets.length} public menu links for agent ${agentId}.`);
    if (!APPLY) {
      console.log("No ElevenLabs or Firestore data was changed. Re-run with --apply.");
      return;
    }

    const document = await elevenLabsRequest(apiKey, "/v1/convai/knowledge-base/text", {
      method: "POST",
      body: JSON.stringify({ name: DOCUMENT_NAME, text: knowledgeText }),
    });
    if (!document?.id) {
      throw new Error("ElevenLabs did not return a knowledge document id.");
    }
    const nextKnowledge = currentKnowledge
      .filter((entry) => entry?.name !== DOCUMENT_NAME)
      .concat([{
        id: document.id,
        name: DOCUMENT_NAME,
        type: document.type || "text",
        usage_mode: "auto",
      }]);
    const nextPromptConfig = { ...promptConfig, knowledge_base: nextKnowledge };
    if (Array.isArray(nextPromptConfig.tool_ids) && nextPromptConfig.tool_ids.length > 0) {
      delete nextPromptConfig.tools;
    } else if (Array.isArray(nextPromptConfig.tools)) {
      delete nextPromptConfig.tool_ids;
      delete nextPromptConfig.toolIds;
    }
    await elevenLabsRequest(apiKey, `/v1/convai/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        conversation_config: {
          ...conversationConfig,
          agent: {
            ...agentConfig,
            prompt: nextPromptConfig,
          },
        },
      }),
    });

    const verifiedAgent = await elevenLabsRequest(
      apiKey,
      `/v1/convai/agents/${encodeURIComponent(agentId)}`,
      { method: "GET" },
    );
    const verifiedKnowledge = verifiedAgent?.conversation_config?.agent?.prompt?.knowledge_base || [];
    if (!verifiedKnowledge.some((entry) => entry?.id === document.id)) {
      throw new Error("The new menu knowledge document was not attached to the agent.");
    }

    for (const oldDocument of [...oldMenuEntries, ...existingMenuDocuments]) {
      if (oldDocument?.id && oldDocument.id !== document.id) {
        await elevenLabsRequest(
          apiKey,
          `/v1/convai/knowledge-base/${encodeURIComponent(oldDocument.id)}?force=true`,
          { method: "DELETE" },
        );
      }
    }

    const existingAgent = event.agent || {};
    const existingKnowledgeBase = existingAgent.knowledgeBase || {};
    const oldMenuIds = new Set(oldMenuEntries.map((entry) => entry?.id).filter(Boolean));
    const previousDocumentIds = Array.from(new Set([
      ...(Array.isArray(existingKnowledgeBase.previousDocumentIds)
        ? existingKnowledgeBase.previousDocumentIds.filter((id) => !oldMenuIds.has(id))
        : []),
      document.id,
    ])).slice(0, 10);
    const actor = { uid: "codex-menu-knowledge-sync", username: "codex" };
    await eventRef.set({
      agent: {
        ...existingAgent,
        knowledgeBase: {
          ...existingKnowledgeBase,
          previousDocumentIds,
          syncStatus: "synced",
          syncError: "",
          lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSyncedBy: actor,
        },
        syncStatus: "synced",
        syncError: "",
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncedBy: actor,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actor,
    }, { merge: true });

    console.log(`Attached ${DOCUMENT_NAME} to the linked ElevenLabs agent and verified it.`);
  } finally {
    await admin.app().delete();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
