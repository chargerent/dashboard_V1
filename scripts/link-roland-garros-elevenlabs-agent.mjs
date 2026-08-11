import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiBoothRoot = path.resolve(repoRoot, "../AiBooth");
const eventId = "roland-garros-2026-demo";
const agentName = "Roland-Garros 2026 AI Concierge Demo";
const sourceAgentId = "agent_4501ks508rbsfcgvdezg1qszfq07";
const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  "/Users/georgegazelian/.config/codex/secrets/node-red-alerts-codex.json";

function parseEnv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => {
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
      })
      .filter(Boolean)
  );
}

const [serviceAccount, aiBoothEnv] = await Promise.all([
  readFile(serviceAccountPath, "utf8").then(JSON.parse),
  readFile(path.join(aiBoothRoot, ".env"), "utf8").then(parseEnv)
]);

if (!aiBoothEnv.ELEVENLABS_API_KEY) {
  throw new Error("ELEVENLABS_API_KEY is not configured in the AiBooth .env file.");
}

const elevenHeaders = { "xi-api-key": aiBoothEnv.ELEVENLABS_API_KEY };
const agentsResponse = await fetch(
  "https://api.elevenlabs.io/v1/convai/agents?page_size=100",
  { headers: elevenHeaders }
);
if (!agentsResponse.ok) {
  throw new Error(`ElevenLabs agent list failed with ${agentsResponse.status}.`);
}
const agentsPayload = await agentsResponse.json();
const agentSummary = (agentsPayload.agents || []).find(
  (agent) => agent.name === agentName
);
if (!agentSummary?.agent_id) {
  throw new Error(`ElevenLabs agent ${agentName} was not found.`);
}

const agentResponse = await fetch(
  `https://api.elevenlabs.io/v1/convai/agents/${agentSummary.agent_id}`,
  { headers: elevenHeaders }
);
if (!agentResponse.ok) {
  throw new Error(`ElevenLabs agent verification failed with ${agentResponse.status}.`);
}
const elevenAgent = await agentResponse.json();
const prompt = elevenAgent?.conversation_config?.agent?.prompt || {};
const knowledgeEntry = Array.isArray(prompt.knowledge_base)
  ? prompt.knowledge_base.find((entry) => entry?.id)
  : null;
if (!knowledgeEntry?.id) {
  throw new Error("The Roland-Garros ElevenLabs agent has no linked knowledge document.");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "node-red-alerts"
});

try {
  const db = admin.firestore();
  const ref = db.collection("aiBoothEvents").doc(eventId);
  const actor = { uid: "codex-roland-garros-setup", username: "codex" };
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new Error(`Dashboard event ${eventId} does not exist.`);
    }
    const event = snapshot.data() || {};
    const existingAgent = event.agent || {};
    transaction.set(
      ref,
      {
        agent: {
          ...existingAgent,
          templateAgentId: sourceAgentId,
          agentId: agentSummary.agent_id,
          name: elevenAgent.name,
          firstMessage: elevenAgent?.conversation_config?.agent?.first_message || existingAgent.firstMessage || "",
          systemPrompt: prompt.prompt || existingAgent.systemPrompt || "",
          syncStatus: "synced",
          syncError: "",
          lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSyncedBy: actor,
          knowledgeBase: {
            ...(existingAgent.knowledgeBase || {}),
            documentId: knowledgeEntry.id,
            documentName: knowledgeEntry.name,
            documentType: knowledgeEntry.type || "text",
            usageMode: knowledgeEntry.usage_mode || "auto",
            syncStatus: "synced",
            syncError: "",
            lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSyncedBy: actor,
            previousDocumentIds: existingAgent.knowledgeBase?.previousDocumentIds || []
          },
          toolIds: Array.isArray(prompt.tool_ids) ? prompt.tool_ids : [],
          builtInToolNames: Object.entries(prompt.built_in_tools || {})
            .filter(([, value]) => value)
            .map(([name]) => name)
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: actor
      },
      { merge: true }
    );
  });

  const saved = await ref.get();
  const data = saved.data() || {};
  console.log(
    JSON.stringify(
      {
        linked: true,
        eventId: saved.id,
        eventName: data.general?.eventName,
        agentId: data.agent?.agentId,
        agentSyncStatus: data.agent?.syncStatus,
        knowledgeDocumentId: data.agent?.knowledgeBase?.documentId,
        knowledgeSyncStatus: data.agent?.knowledgeBase?.syncStatus,
        toolCount: Array.isArray(data.agent?.toolIds) ? data.agent.toolIds.length : 0,
        builtInTools: data.agent?.builtInToolNames || [],
        stationIds: data.boothStationIds || []
      },
      null,
      2
    )
  );
} finally {
  await admin.app().delete();
}
