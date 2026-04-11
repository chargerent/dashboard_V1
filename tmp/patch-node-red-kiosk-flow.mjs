import fs from "node:fs/promises";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: node patch-node-red-kiosk-flow.mjs <input.json> <output.json>");
  process.exit(1);
}

const flowText = await fs.readFile(inputPath, "utf8");
const flow = JSON.parse(flowText);

const GROUP_ID = "78694e29453b878e";
const PARSER_ID = "d57302041b767328";
const DEBUG_ID = "38aff7df11eb85c5";
const LOOKUP_ID = "e9bd6b72b73b3235";
const RESOLVE_ID = "e93a83e6c6917286";
const RESPONSE_ID = "2f2b8145a2ae9b3b";
const REMOVE_IDS = new Set([
  "08c766847797ce19",
  "a175defdd684f061",
  "d33872597b73459f",
  "f7cd6b2af139377e",
  "ddd97d5a5a6a72a3",
]);

const parserFunc = String.raw`const rawUuid = String(
    (msg.payload && msg.payload.uuid) ||
    (msg.req && msg.req.query && msg.req.query.uuid) ||
    ''
).trim();

if (!rawUuid) {
    node.error('Missing uuid', msg);
    return null;
}

// Kiosk IMEI-style module ids should pass through unchanged.
if (/^\d{15}$/.test(rawUuid)) {
    msg.module = rawUuid;
    return msg;
}

// MAC-like UUIDs are converted into the stored 1000-prefixed module id.
if (/^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(rawUuid)) {
    const hex = rawUuid.replace(/[:-]/g, '');
    msg.module = '1000' + Number.parseInt(hex, 16).toString(10);
    return msg;
}

msg.module = rawUuid;
return msg;`;

const resolveFunc = String.raw`const docs = Array.isArray(msg.payload) ? msg.payload : [];
const moduleId = String(msg.module || '').trim();
const requestData = msg.payloadRaw || (msg.req && msg.req.query) || {};
const rawUuid = requestData.uuid || null;
const simUUID = requestData.simUUID || '';
const simMobile = requestData.simMobile || '';
const deviceId = requestData.deviceId || '';
const ssl = requestData.ssl || '';
const screen = requestData.screen || '';
const defaultWifiName = 'chargerent';
const defaultWifiPassword = 'Charger33';

if (!moduleId) {
    node.error('Missing msg.module');
    return null;
}

let matched = null;
for (const doc of docs) {
    const modules = Array.isArray(doc.modules) ? doc.modules : [];
    for (const mod of modules) {
        const modId = mod && mod.id != null ? String(mod.id).trim() : '';
        if (!modId) continue;

        if (modId === moduleId || ('1000' + modId) === moduleId || modId === moduleId.replace(/^1000/, '')) {
            matched = doc;
            break;
        }
    }
    if (matched) break;
}

if (matched && matched.stationid) {
    msg.stationid = matched.stationid;
    msg.kioskDoc = matched;
    msg.simUUID = String(simUUID).trim();
    msg.simMobile = String(simMobile).trim();
    msg.deviceId = String(deviceId).trim();
    msg.ssl = String(ssl).trim();
    msg.screen = String(screen).trim();
    msg.wifiName = String(matched.wifi && matched.wifi.name || defaultWifiName).trim() || defaultWifiName;
    msg.wifiPassword = String(matched.wifi && matched.wifi.password || defaultWifiPassword).trim() || defaultWifiPassword;
    return [msg, null];
}

msg.stationid = 'pending';
msg.simUUID = String(simUUID).trim();
msg.simMobile = String(simMobile).trim();
msg.deviceId = String(deviceId).trim();
msg.ssl = String(ssl).trim();
msg.screen = String(screen).trim();
msg.wifiName = defaultWifiName;
msg.wifiPassword = defaultWifiPassword;
msg.payload = {
    path: 'pending/' + moduleId,
    content: {
        moduleId,
        rawUuid,
        simUUID: msg.simUUID,
        simMobile: msg.simMobile,
        deviceId: msg.deviceId,
        ssl: msg.ssl,
        screen: msg.screen,
        stationid: 'pending',
        active: false,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
    }
};

return [null, msg];`;

const responseFunc = String.raw`const timestamp = Date.now();
const moduleId = String(msg.module || '').trim();
const stationid = String(msg.stationid || '').trim();
const defaultWifiName = 'chargerent';
const defaultWifiPassword = 'Charger33';
const wifiName = String(msg.wifiName || defaultWifiName).trim() || defaultWifiName;
const wifiPassword = String(msg.wifiPassword || defaultWifiPassword).trim() || defaultWifiPassword;

msg.payload = {
    code: 200,
    type: 0,
    data: [
        moduleId + '|securemode=2,signmethod=hmacmd5,timestamp=' + timestamp + '|',
        stationid,
        '34.56.244.66',
        '1883',
        wifiName,
        wifiPassword,
        String(timestamp)
    ].join(','),
    msg: 'OK',
    time: timestamp
};

return msg;`;

const nextFlow = flow
  .filter((node) => !REMOVE_IDS.has(node.id))
  .map((node) => {
    if (node.id === GROUP_ID) {
      return {
        ...node,
        nodes: Array.isArray(node.nodes)
          ? node.nodes.filter((id) => !REMOVE_IDS.has(id))
          : node.nodes,
      };
    }

    if (node.id === PARSER_ID) {
      return {
        id: PARSER_ID,
        type: "function",
        z: node.z,
        g: node.g,
        name: "parse kiosk module id",
        func: parserFunc,
        outputs: 1,
        timeout: 0,
        noerr: 0,
        initialize: "",
        finalize: "",
        libs: [],
        x: node.x,
        y: node.y,
        wires: [[DEBUG_ID, LOOKUP_ID]],
      };
    }

    if (node.id === DEBUG_ID) {
      return {
        ...node,
        name: "parsed module",
        complete: "module",
        targetType: "msg",
      };
    }

    if (node.id === RESOLVE_ID) {
      return {
        ...node,
        func: resolveFunc,
      };
    }

    if (node.id === RESPONSE_ID) {
      return {
        id: RESPONSE_ID,
        type: "function",
        z: node.z,
        g: node.g,
        name: "set response",
        func: responseFunc,
        outputs: 1,
        timeout: 0,
        noerr: 0,
        initialize: "",
        finalize: "",
        libs: [],
        x: node.x,
        y: node.y,
        wires: node.wires,
      };
    }

    return node;
  });

await fs.writeFile(outputPath, `${JSON.stringify(nextFlow, null, 4)}\n`, "utf8");
