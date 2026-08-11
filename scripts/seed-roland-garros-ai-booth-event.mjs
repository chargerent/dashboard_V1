import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiBoothRoot = path.resolve(repoRoot, "../AiBooth");
const eventId = "roland-garros-2026-demo";
const shouldApply = process.argv.includes("--apply");
const shouldUpdateVisualization = process.argv.includes("--update-visualization");

const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  "/Users/georgegazelian/.config/codex/secrets/node-red-alerts-codex.json";
const [serviceAccount, packageData, promptMarkdown] = await Promise.all([
  readFile(serviceAccountPath, "utf8").then(JSON.parse),
  readFile(
    path.join(aiBoothRoot, "event-data.roland-garros-2026-demo.json"),
    "utf8"
  ).then(JSON.parse),
  readFile(
    path.join(aiBoothRoot, "ELEVENLABS_ROLAND_GARROS_AGENT_PROMPT.md"),
    "utf8"
  )
]);

function extractPrompt(markdown) {
  const match = markdown.match(/```text\s*([\s\S]*?)\s*```/i);
  if (!match) {
    throw new Error("Roland-Garros ElevenLabs prompt block was not found.");
  }
  return match[1].trim();
}

function getLocation(id) {
  return packageData.locations.find((location) => location.id === id);
}

function getZoneName(location) {
  return packageData.zones.find((zone) => zone.id === location?.zoneId)?.name || "";
}

function locationSummary(ids) {
  return ids
    .map((id) => getLocation(id))
    .filter(Boolean)
    .map((location) => `${location.name} (${getZoneName(location)}; ${location.dataStatus})`)
    .join("; ");
}

function topic(id, title, kind, summary, notes, extra = {}) {
  return {
    id,
    title,
    kind,
    summary,
    notes,
    checklistText: "",
    ...extra
  };
}

const foodSummary = packageData.foodAndBeverage
  .map((venue) => `${venue.name}: ${venue.description} Dietary: ${venue.dietary.join(", ")}. Hours: ${venue.hours}. Status: ${venue.status}.`)
  .join("\n");
const policySummary = packageData.visitorPolicies
  .map((policy) => `${policy.topic}: ${policy.answer} Status: ${policy.status}.`)
  .join("\n");

const topics = [
  topic(
    "topic-rg-overview",
    "Event Overview",
    "",
    "Roland-Garros 2026 ran from May 18 through June 7, 2026 at Stade Roland-Garros in Paris. The supplied package marks this edition completed.",
    "OFFICIAL core event facts from the supplied package. This is a working concierge demo and not an official Roland-Garros product."
  ),
  topic(
    "topic-rg-tickets-entry",
    "Tickets & Entry",
    "",
    "Tickets are presented through the official Roland-Garros mobile application. Visitors pass mandatory checkpoints before stadium entrances.",
    "OFFICIAL and SAFE_SUMMARY. Never validate a ticket or invent current bag dimensions, prohibited items, queues, or entry conditions. Direct guests to current official rules."
  ),
  topic(
    "topic-rg-courts-wayfinding",
    "Courts & Wayfinding",
    "",
    "Demo-map wayfinding covers Court Philippe-Chatrier, Court Suzanne-Lenglen, Court Simonne-Mathieu, outside courts, visitor services, food, shops, restrooms, water, and charging.",
    `Court names are official; all x/y positions and route times are fictional demo data and are not geographic coordinates. Core courts: ${locationSummary(["LOC_PC", "LOC_SL", "LOC_SM"])}.`
  ),
  topic(
    "topic-rg-phone-charging",
    "Phone Chargers",
    "phoneCharging",
    "The demo includes Chargerent power-bank stations in Central Village and near the three main show-court zones.",
    `DEMO only. Pricing, payment, deposits, stock, and operating status are fictional and not live. Demo locations: ${locationSummary(["LOC_CHARGE1", "LOC_CHARGE2", "LOC_CHARGE3", "LOC_CHARGE4"])}.`
  ),
  topic(
    "topic-rg-food",
    "Food & Beverage",
    "concessions",
    "The demo includes coffee, French food, plant-forward meals, pizza, sushi, vegetarian, vegan, and gluten-aware choices.",
    `All venues, menus, dietary labels, hours, and availability are DEMO data. Confirm allergens and current availability with staff.\n${foodSummary}`
  ),
  topic(
    "topic-rg-bathrooms",
    "Bathrooms",
    "bathrooms",
    "Demo restrooms are located in Central Village and near the Suzanne-Lenglen and Simonne-Mathieu zones.",
    "Use the nearest-service function with the guest's current court or zone. All positions are fictional demo-map data.",
    {
      bathroomLocations: ["LOC_REST1", "LOC_REST2", "LOC_REST3"].map((id) => {
        const location = getLocation(id);
        return {
          id: location.id,
          place: `${location.name} - ${getZoneName(location)}`,
          latitude: "",
          longitude: ""
        };
      })
    }
  ),
  topic(
    "topic-rg-fan-services",
    "Fan Services",
    "fanServices",
    "The demo covers Visitor Information, First Aid, Lost & Found, accessibility help, baby care, a quiet area, storage, water refill, and merchandise.",
    "For urgent medical or security situations, tell the guest to contact the nearest event staff member immediately. Service hours and locations are DEMO unless explicitly marked official reference.",
    {
      fanServices: [
        ["LOC_INFO", "Visitor Information"],
        ["LOC_FIRSTAID", "First Aid"],
        ["LOC_LOST", "Lost and Found"],
        ["LOC_GATE30", "Accessibility / Gate 30 reference"],
        ["LOC_BABY", "Baby Care"],
        ["LOC_QUIET", "Quiet and Sensory Break Area"],
        ["LOC_WATER1", "Water Refill"]
      ].map(([id, name]) => {
        const location = getLocation(id);
        return {
          id,
          name,
          location: `${location.name} - ${getZoneName(location)}`,
          latitude: "",
          longitude: ""
        };
      })
    }
  ),
  topic(
    "topic-rg-transportation",
    "Transportation",
    "transportation",
    "Use current official journey-planning and event-day transport information for Metro, bus, taxi, rideshare, bike, shuttle, and accessibility planning.",
    "The package does not contain a live transport feed. Do not guarantee a route, line, exit, diversion, pickup point, parking space, or wait time. Gate 30 is an OFFICIAL_REFERENCE for convenient accessible drop-off."
  ),
  topic(
    "topic-rg-accessibility",
    "Accessibility",
    "",
    "Official guidance in the package states that all stadium gates and facilities are accessible, with Gate 30 identified as a convenient drop-off reference.",
    "Prefer step-free guidance. Treat all detailed routes, service hours, and demo-map positions as DEMO unless a record is marked OFFICIAL or OFFICIAL_REFERENCE."
  ),
  topic(
    "topic-rg-shopping",
    "Shopping",
    "",
    "The demo includes an Official Merchandise Superstore in Retail Village and a smaller merchandise kiosk near Suzanne-Lenglen.",
    `DEMO locations and hours; do not claim current stock or opening status. ${locationSummary(["LOC_STORE", "LOC_STORE2"])}.`
  ),
  topic(
    "topic-rg-live-information",
    "Live Matches",
    "schedule",
    "Match times, court assignments, scores, delays, closures, weather, and queue conditions require a live official source.",
    "LIVE_REQUIRED. No live feed is connected in this demo. Direct guests to the official Roland-Garros app, event displays, or event staff. Never turn historical data into current information.",
    { scheduleDays: [] }
  ),
  topic(
    "topic-rg-policies",
    "Policies & Safety",
    "",
    "Visitor questions include bag guidance, security screening, prohibited items, accessibility, arrival checkpoints, weather preparation, and live schedule limitations.",
    policySummary
  )
];

const now = admin.firestore.FieldValue.serverTimestamp();
const actor = { uid: "codex-roland-garros-setup", username: "codex" };
const eventDocument = {
  deploymentType: "event",
  general: {
    eventName: "Roland-Garros 2026 AI Concierge Demo",
    eventCategory: "Tennis",
    open24Hours: false,
    phoneChargingEnabled: true,
    paymentType: "apollo",
    eventInfo:
      "Working AI concierge demo for Roland-Garros 2026 using the supplied structured visitor package. Official facts, fictional demo operations, and live-data requirements are explicitly separated. The source marks the May 18-June 7, 2026 edition completed. This is not an official Roland-Garros product.",
    address: "",
    city: "Paris",
    zipCode: "",
    country: "FR",
    startDate: packageData.event.startDate,
    endDate: packageData.event.endDate,
    sameHoursEveryDay: false,
    openingHours: "",
    closingHours: "",
    dailyHours: {},
    rentalPolicy:
      "Demo only: Chargerent rental and return are represented in the prototype. Pricing, payment, deposits, stock, and station operating status are not live and must be confirmed before production.",
    supportFallback: "Roland-Garros event staff or Visitor Information"
  },
  boothStationIds: [],
  boothContexts: {},
  screenUi: {
    preset: "championship",
    visualMode: "dot-grid-concierge",
    golfQrMode: "rotate-ball",
    theme: {
      background: "#101a2e",
      backgroundAlt: "#253552",
      glow: "#e36f3d",
      secondaryGlow: "#f6ead7",
      primary: "#f4a261",
      accent: "#d1492e",
      agentButton: "#8f3d2c",
      agentListening: "#60a5fa",
      agentSpeaking: "#f59e0b",
      topicColors: { eventInfo: "#f4a261" }
    },
    features: {
      demoTalk: true,
      keyboardShortcuts: true,
      debugOverlay: false,
      showStopButton: true,
      qrDisplay: true,
      showVisualSwitcher: false,
      showConversationControls: true
    }
  },
  screenUiByStationId: {},
  topics,
  activations: [],
  agent: {
    templateAgentId: "",
    agentId: "",
    name: "Roland-Garros 2026 AI Concierge Demo",
    firstMessage:
      "Bonjour and welcome to the Roland-Garros 2026 concierge demo. I can help with tickets, courts, directions, food, accessibility, services, and charging. Comment puis-je vous aider?",
    systemPrompt: extractPrompt(promptMarkdown),
    syncStatus: "pending",
    syncError: "",
    lastSyncedAt: null,
    lastSyncedBy: null,
    knowledgeBase: {
      documentId: "",
      documentName: "Roland-Garros 2026 AI Concierge Demo Knowledge",
      documentType: "text",
      syncStatus: "pending",
      syncError: "",
      lastSyncedAt: null,
      lastSyncedBy: null,
      previousDocumentIds: []
    },
    kioskAgents: {}
  },
  intake: {
    enabled: false,
    accessCodeConfigured: false,
    accessCodeHint: "",
    instructions: "",
    closesAt: "",
    allowEditsAfterSubmit: true,
    maxFiles: 8,
    maxFileSizeMb: 20
  },
  boothCount: 0,
  topicCount: topics.length,
  activationCount: 0,
  sourcePackage: {
    name: packageData.source.package,
    version: packageData.source.packageVersion,
    generated: packageData.source.generated,
    disclaimer: packageData.source.disclaimer
  },
  createdBy: actor,
  updatedBy: actor,
  createdAt: now,
  updatedAt: now
};

if (!shouldApply && !shouldUpdateVisualization) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        eventId,
        eventName: eventDocument.general.eventName,
        dates: [eventDocument.general.startDate, eventDocument.general.endDate],
        category: eventDocument.general.eventCategory,
        topicCount: eventDocument.topicCount,
        stationIds: eventDocument.boothStationIds,
        agentSyncStatus: eventDocument.agent.syncStatus,
        knowledgeSyncStatus: eventDocument.agent.knowledgeBase.syncStatus
      },
      null,
      2
    )
  );
  process.exit(0);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "node-red-alerts"
});

try {
  const ref = admin.firestore().collection("aiBoothEvents").doc(eventId);
  const existing = await ref.get();
  if (shouldUpdateVisualization) {
    if (!existing.exists) {
      throw new Error(`AI Booth event ${eventId} does not exist; cannot update its visualization.`);
    }
    await ref.update({
      "screenUi.visualMode": eventDocument.screenUi.visualMode,
      updatedAt: now,
      updatedBy: actor
    });
    console.log(
      JSON.stringify(
        {
          updated: true,
          eventId,
          visualMode: eventDocument.screenUi.visualMode
        },
        null,
        2
      )
    );
    process.exitCode = 0;
  } else {
    if (existing.exists) {
      throw new Error(`AI Booth event ${eventId} already exists; refusing to overwrite it.`);
    }
    await ref.create(eventDocument);
    const saved = await ref.get();
    const data = saved.data() || {};
    console.log(
      JSON.stringify(
        {
          created: true,
          eventId: saved.id,
          eventName: data.general?.eventName,
          topicCount: data.topicCount,
          stationIds: data.boothStationIds || [],
          agentSyncStatus: data.agent?.syncStatus,
          knowledgeSyncStatus: data.agent?.knowledgeBase?.syncStatus
        },
        null,
        2
      )
    );
  }
} finally {
  await admin.app().delete();
}
