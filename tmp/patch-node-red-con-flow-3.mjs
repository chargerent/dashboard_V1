import fs from "node:fs/promises";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: node patch-node-red-con-flow-3.mjs <input.json> <output.json>");
  process.exit(1);
}

const flowText = await fs.readFile(inputPath, "utf8");
const flow = JSON.parse(flowText);

const PARSER_ID = "b12a1e8d679de135";
const QUERY_PREP_ID = "08544443f0accb0c";
const QUERY_NODE_ID = "2caa546b83a300e0";
const RESOLVE_ID = "743c2ccf3d29ce01";
const RESPONSE_ID = "5c8d6029712367fd";
const PENDING_DEBUG_ID = "0ea94bd6ab894ce1";
const PROVISIONED_DEBUG_ID = "8ca9b20bf71e3fbe";
const QUERY_DEBUG_ID = "d2b6f5de82e62690";
const CONFIG_DEBUG_ID = "79e05d10a7492d52";

const parserFunc = String.raw`const rawUuid = String(
    (msg.payload && msg.payload.uuid) ||
    (msg.req && msg.req.query && msg.req.query.uuid) ||
    ''
).trim();

msg._startedAt = Number(msg._startedAt || Date.now());
msg._rawUuid = rawUuid;

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
const normalizedHex = rawUuid.replace(/[:-]/g, '').toUpperCase();
if (/^[0-9A-F]{12}$/.test(normalizedHex)) {
    msg.module = '1000' + BigInt('0x' + normalizedHex).toString(10);
    return msg;
}

msg.module = rawUuid;
return msg;`;

const queryFunc = String.raw`const moduleId = String(msg.module || '').trim();
const isV2Lookup = /^\d{15,}$/.test(moduleId);

msg.lookupStrategy = isV2Lookup ? 'moduleIds' : 'scan';
msg.lookupFallbackUsed = Boolean(msg._didFullScanFallback);

msg.payload = isV2Lookup
    ? {
        path: 'kiosks',
        query: [{ fieldPath: 'moduleIds', opStr: 'array-contains', value: moduleId }]
    }
    : {
        path: 'kiosks',
        query: []
    };

return msg;`;

const resolveFunc = String.raw`const docs = Array.isArray(msg.payload) ? msg.payload : [];
const moduleId = String(msg.module || '').trim();
const requestData = msg.payloadRaw || (msg.req && msg.req.query) || {};
const rawUuid = String(requestData.uuid || msg._rawUuid || '').trim() || null;
const simUUID = String(requestData.simUUID || '').trim();
const simMobile = String(requestData.simMobile || '').trim();
const deviceId = String(requestData.deviceId || '').trim();
const ssl = String(requestData.ssl || '').trim();
const screen = String(requestData.screen || '').trim();
const defaultWifiName = 'chargerent';
const defaultWifiPassword = 'Charger33';
const lookupStrategy = String(msg.lookupStrategy || 'scan').trim() || 'scan';

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

msg.lookupDocCount = docs.length;
msg.lookupDurationMs = Number(msg._startedAt) ? (Date.now() - Number(msg._startedAt)) : null;
msg.lookupStrategy = lookupStrategy;
msg.lookupFallbackUsed = Boolean(msg._didFullScanFallback);
msg.simUUID = simUUID;
msg.simMobile = simMobile;
msg.deviceId = deviceId;
msg.ssl = ssl;
msg.screen = screen;

if (!matched && lookupStrategy === 'moduleIds' && !msg._didFullScanFallback) {
    msg._didFullScanFallback = true;
    msg.lookupStrategy = 'scan';
    msg.lookupFallbackUsed = true;
    msg.payload = {
        path: 'kiosks',
        query: []
    };
    return [null, null, msg];
}

if (matched && matched.stationid) {
    msg.branch = 'provisioned';
    msg.stationid = matched.stationid;
    msg.matchStationid = matched.stationid;
    msg.kioskDoc = matched;
    msg.wifiName = String(matched.wifi && matched.wifi.name || defaultWifiName).trim() || defaultWifiName;
    msg.wifiPassword = String(matched.wifi && matched.wifi.password || defaultWifiPassword).trim() || defaultWifiPassword;
    return [msg, null, null];
}

msg.branch = 'pending';
msg.stationid = 'pending';
msg.matchStationid = null;
msg.wifiName = defaultWifiName;
msg.wifiPassword = defaultWifiPassword;
msg.payload = {
    path: 'pending/' + moduleId,
    content: {
        moduleId,
        rawUuid,
        simUUID,
        simMobile,
        deviceId,
        ssl,
        screen,
        stationid: 'pending',
        active: false,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
    }
};

return [null, msg, null];`;

const responseFunc = String.raw`const timestamp = Date.now();
const moduleId = String(msg.module || '').trim();
const stationid = String(msg.stationid || '').trim();
const defaultWifiName = 'chargerent';
const defaultWifiPassword = 'Charger33';
const wifiName = String(msg.wifiName || defaultWifiName).trim() || defaultWifiName;
const wifiPassword = String(msg.wifiPassword || defaultWifiPassword).trim() || defaultWifiPassword;

msg.responseDurationMs = Number(msg._startedAt) ? (timestamp - Number(msg._startedAt)) : null;
msg.configPreview = {
    moduleId,
    stationid,
    wifiName,
    wifiPassword,
    branch: String(msg.branch || ''),
    lookupStrategy: String(msg.lookupStrategy || ''),
    lookupFallbackUsed: Boolean(msg.lookupFallbackUsed),
    lookupDocCount: Number(msg.lookupDocCount || 0),
    lookupDurationMs: msg.lookupDurationMs,
    responseDurationMs: msg.responseDurationMs
};

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

const nextFlow = flow.map((node) => {
  if (node.id === PARSER_ID) {
    return {
      ...node,
      func: parserFunc,
    };
  }

  if (node.id === QUERY_PREP_ID) {
    return {
      ...node,
      func: queryFunc,
    };
  }

  if (node.id === RESOLVE_ID) {
    return {
      ...node,
      outputs: 3,
      wires: [
        Array.isArray(node.wires?.[0]) ? node.wires[0] : [],
        Array.isArray(node.wires?.[1]) ? node.wires[1] : [],
        [QUERY_NODE_ID],
      ],
      func: resolveFunc,
    };
  }

  if (node.id === RESPONSE_ID) {
    return {
      ...node,
      func: responseFunc,
    };
  }

  if (node.id === PENDING_DEBUG_ID) {
    return {
      ...node,
      active: true,
      complete: "true",
      targetType: "full",
      name: "pending branch",
    };
  }

  if (node.id === PROVISIONED_DEBUG_ID) {
    return {
      ...node,
      active: true,
      complete: "true",
      targetType: "full",
      name: "provisioned branch",
    };
  }

  if (node.id === QUERY_DEBUG_ID) {
    return {
      ...node,
      active: true,
      complete: "true",
      targetType: "full",
      name: "kiosk query result",
    };
  }

  if (node.id === CONFIG_DEBUG_ID) {
    return {
      ...node,
      active: true,
      complete: "true",
      targetType: "full",
      name: "config response",
    };
  }

  return node;
});

await fs.writeFile(outputPath, `${JSON.stringify(nextFlow, null, 4)}\n`, "utf8");
