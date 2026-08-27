import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NODE_PREFIX = 'media_playback_ack_';
const BACKEND_TAB_ID = 'f32d67882beea623';
const MQTT_BROKER_NODE_ID = '8597d2b7.ba618';
const FIRESTORE_TEMPLATE_NODE_ID = 'ui_profile_ack_write_vm';

const validateAckSource = `const topic = String(msg.topic || "");
const match = new RegExp("^ack/([A-Z]{2}[0-9]{4})/media$").exec(topic);
if (!match) return null;

const topicStationId = String(match[1] || "").trim().toUpperCase();
const ack = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
const payloadStationId = String(ack.stationid || "").trim().toUpperCase();
const provisionid = String(ack.provisionid || "").trim();
const status = String(ack.status || "").trim().toLowerCase();
const signature = String(ack.signature || "").trim().toLowerCase();
const allowedStatuses = new Set(["downloaded", "playing", "out_of_sync", "error", "cleared"]);

if (!topicStationId || payloadStationId !== topicStationId || !provisionid || !allowedStatuses.has(status)) {
    node.warn("Rejected invalid media acknowledgement on " + topic);
    return null;
}
if ((status === "downloaded" || status === "playing") && !/^[a-f0-9]{20}$/.test(signature)) {
    node.warn("Rejected media acknowledgement without a valid assignment signature for " + topicStationId);
    return null;
}

const rawItemCount = Number(ack.itemCount || 0);
const reportedAtInput = String(ack.reportedAt || "").trim();
const reportedAt = Number.isFinite(Date.parse(reportedAtInput)) ? reportedAtInput : new Date().toISOString();
msg.stationid = topicStationId;
msg.provisionid = provisionid;
msg.mediaAck = {
    stationid: topicStationId,
    provisionid,
    signature: /^[a-f0-9]{20}$/.test(signature) ? signature : "",
    status,
    itemCount: Number.isFinite(rawItemCount) ? Math.max(0, Math.min(500, Math.trunc(rawItemCount))) : 0,
    sourceStatus: String(ack.sourceStatus || "unknown").slice(0, 32),
    reportedAt,
    error: String(ack.error || "").slice(0, 240)
};
msg.payload = {
    path: "kiosks",
    query: [{ fieldPath: "stationid", opStr: "==", value: topicStationId }]
};
return msg;`;

const prepareWriteSource = `const docs = Array.isArray(msg.payload) ? msg.payload : [];
const kiosk = docs.find(item => String(item?.stationid || "").trim().toUpperCase() === msg.stationid) || docs[0];
const provisionid = String(kiosk?.provisionid || "").trim();
const hardwareType = String(kiosk?.hardware?.type || "").trim().toUpperCase();
if (!provisionid || provisionid !== msg.provisionid) {
    node.warn("Rejected media acknowledgement with mismatched kiosk identity for " + msg.stationid);
    return null;
}
if (hardwareType !== "CK50") {
    node.warn("Ignored media acknowledgement from non-CK50 kiosk " + msg.stationid);
    return null;
}

const receivedAt = new Date().toISOString();
msg.mediaAck = {
    ...msg.mediaAck,
    receivedAt
};
msg.payload = {
    path: "kiosks/" + provisionid,
    content: {
        reportedMedia: msg.mediaAck,
        mediaReportedAt: receivedAt
    }
};
return msg;`;

function buildNodes(firestoreTemplate) {
  const firestoreBase = {
    type: 'google-cloud-firestore',
    z: BACKEND_TAB_ID,
    account: firestoreTemplate.account,
    keyFilename: firestoreTemplate.keyFilename,
    projectId: firestoreTemplate.projectId,
  };

  return [
    {
      id: `${NODE_PREFIX}group_vm`,
      type: 'group',
      z: BACKEND_TAB_ID,
      name: 'V1 CK50 media playback acknowledgements',
      style: { label: true, color: '#3FADB5' },
      nodes: [
        `${NODE_PREFIX}mqtt_in_vm`,
        `${NODE_PREFIX}validate_vm`,
        `${NODE_PREFIX}query_vm`,
        `${NODE_PREFIX}prepare_write_vm`,
        `${NODE_PREFIX}write_vm`,
        `${NODE_PREFIX}complete_vm`,
        `${NODE_PREFIX}catch_vm`,
        `${NODE_PREFIX}error_vm`,
      ],
      x: 1314,
      y: 3614,
      w: 2172,
      h: 152,
    },
    {
      id: `${NODE_PREFIX}mqtt_in_vm`,
      type: 'mqtt in',
      z: BACKEND_TAB_ID,
      g: `${NODE_PREFIX}group_vm`,
      name: 'Media playback acknowledgements',
      topic: 'ack/+/media',
      qos: '1',
      datatype: 'json',
      broker: MQTT_BROKER_NODE_ID,
      nl: false,
      rap: true,
      rh: 0,
      inputs: 0,
      x: 1480,
      y: 3660,
      wires: [[`${NODE_PREFIX}validate_vm`]],
    },
    {
      id: `${NODE_PREFIX}validate_vm`,
      type: 'function',
      z: BACKEND_TAB_ID,
      g: `${NODE_PREFIX}group_vm`,
      name: 'Validate media acknowledgement',
      func: validateAckSource,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 1780,
      y: 3660,
      wires: [[`${NODE_PREFIX}query_vm`]],
    },
    {
      id: `${NODE_PREFIX}query_vm`,
      ...firestoreBase,
      g: `${NODE_PREFIX}group_vm`,
      name: 'Query kiosk for media acknowledgement',
      mode: 'query',
      x: 2110,
      y: 3660,
      wires: [[`${NODE_PREFIX}prepare_write_vm`]],
    },
    {
      id: `${NODE_PREFIX}prepare_write_vm`,
      type: 'function',
      z: BACKEND_TAB_ID,
      g: `${NODE_PREFIX}group_vm`,
      name: 'Verify CK50 identity + prepare media status',
      func: prepareWriteSource,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 2490,
      y: 3660,
      wires: [[`${NODE_PREFIX}write_vm`]],
    },
    {
      id: `${NODE_PREFIX}write_vm`,
      ...firestoreBase,
      g: `${NODE_PREFIX}group_vm`,
      name: 'Persist reported media state',
      mode: 'update',
      x: 2830,
      y: 3660,
      wires: [[`${NODE_PREFIX}complete_vm`]],
    },
    {
      id: `${NODE_PREFIX}complete_vm`,
      type: 'function',
      z: BACKEND_TAB_ID,
      g: `${NODE_PREFIX}group_vm`,
      name: 'Media acknowledgement saved',
      func: 'node.status({ fill: "green", shape: "dot", text: msg.stationid + " " + msg.mediaAck.status });\nreturn null;',
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 3150,
      y: 3660,
      wires: [[]],
    },
    {
      id: `${NODE_PREFIX}catch_vm`,
      type: 'catch',
      z: BACKEND_TAB_ID,
      g: `${NODE_PREFIX}group_vm`,
      name: 'Catch media acknowledgement errors',
      scope: [`${NODE_PREFIX}query_vm`, `${NODE_PREFIX}write_vm`],
      uncaught: false,
      x: 1570,
      y: 3720,
      wires: [[`${NODE_PREFIX}error_vm`]],
    },
    {
      id: `${NODE_PREFIX}error_vm`,
      type: 'debug',
      z: BACKEND_TAB_ID,
      g: `${NODE_PREFIX}group_vm`,
      name: 'Media acknowledgement error',
      active: true,
      tosidebar: true,
      console: true,
      tostatus: false,
      complete: 'true',
      targetType: 'full',
      statusVal: '',
      statusType: 'auto',
      x: 1870,
      y: 3720,
      wires: [],
    },
  ];
}

export function patchMediaPlaybackAckBackend(flow) {
  if (!Array.isArray(flow)) throw new Error('Expected a Node-RED flow array');
  if (!flow.some((node) => node?.id === BACKEND_TAB_ID && node?.type === 'tab')) {
    throw new Error('Expected the backend MQTT tab before patching');
  }
  if (!flow.some((node) => node?.id === MQTT_BROKER_NODE_ID && node?.type === 'mqtt-broker')) {
    throw new Error('Expected the backend MQTT broker before patching');
  }
  const firestoreTemplate = flow.find((node) => (
    node?.id === FIRESTORE_TEMPLATE_NODE_ID && node?.type === 'google-cloud-firestore'
  ));
  if (!firestoreTemplate?.account || !firestoreTemplate?.projectId) {
    throw new Error('Expected the existing Firestore acknowledgement writer before patching');
  }

  const preserved = flow.filter((node) => !String(node?.id || '').startsWith(NODE_PREFIX));
  return [...preserved, ...buildNodes(firestoreTemplate)];
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error('Usage: node patch-media-playback-ack-backend.mjs <input-flow.json> <output-flow.json>');
  }
  const flow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const patched = patchMediaPlaybackAckBackend(flow);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(patched, null, 2)}\n`);
  console.log(`Patched backend media acknowledgement receiver (${flow.length} -> ${patched.length} nodes).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
