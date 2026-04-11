import fs from "node:fs/promises";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: node build-media-ad-flow.mjs <input.json> <output.json>");
  process.exit(1);
}

const flow = JSON.parse(await fs.readFile(inputPath, "utf8"));

const GROUP_ID = "30165ecabc60ea17";
const HTTP_IN_ID = "d8b7464c704d075d";
const PREPARE_ID = "45a788f8fc046cb5";
const RESPONSE_ID = "4b41e02ec492cbe2";
const DEBUG_RESPONSE_ID = "ebddd87526251196";
const DEBUG_REQUEST_ID = "121143ba588ded6b";
const INJECT_ID = "e3e3c75ac881fa15";
const REMOVE_IDS = new Set(["5fd74620e0050a3c"]);
const QUERY_ID = "32e2cf4e0a6f4f6c";
const BUILD_ID = "7d0f3dbf1a8b4a02";

const prepareFunc = String.raw`const requestData = msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)
    ? msg.payload
    : {};
const queryData = msg.req && msg.req.query && typeof msg.req.query === 'object'
    ? msg.req.query
    : {};

const rawUuid = String(requestData.uuid || queryData.uuid || '').trim();
const rawStationId = String(
    requestData.stationid ||
    requestData.stationId ||
    queryData.stationid ||
    queryData.stationId ||
    ''
).trim();

function buildModuleCandidates(value) {
    const normalized = String(value || '').trim();
    const candidates = new Set();

    if (!normalized) {
        return [];
    }

    candidates.add(normalized);

    if (normalized.startsWith('1000')) {
        candidates.add(normalized.replace(/^1000/, ''));
    } else {
        candidates.add('1000' + normalized);
    }

    if (/^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(normalized)) {
        const hex = normalized.replace(/[:-]/g, '');
        const decimalValue = String(Number.parseInt(hex, 16));
        candidates.add(decimalValue);
        candidates.add('1000' + decimalValue);
    }

    return Array.from(candidates).filter(Boolean);
}

if (!rawUuid && !rawStationId) {
    msg.payload = {
        code: 400,
        type: 0,
        data: [],
        msg: 'Missing uuid',
        time: Date.now()
    };
    return [null, msg];
}

msg._mediaLookup = {
    rawUuid,
    stationid: rawStationId,
    moduleCandidates: buildModuleCandidates(rawUuid)
};

msg.payload = rawStationId
    ? {
        path: 'kiosks',
        query: [{ fieldPath: 'stationid', opStr: '==', value: rawStationId }]
    }
    : {
        path: 'kiosks',
        query: []
    };

return [msg, null];`;

const buildResponseFunc = String.raw`const ALLOW_PDF = false;

function moduleMatches(moduleId, candidates) {
    const normalized = String(moduleId || '').trim();
    if (!normalized || !Array.isArray(candidates) || candidates.length === 0) {
        return false;
    }

    if (candidates.includes(normalized)) {
        return true;
    }

    if (normalized.startsWith('1000') && candidates.includes(normalized.replace(/^1000/, ''))) {
        return true;
    }

    return candidates.includes('1000' + normalized);
}

const docs = Array.isArray(msg.payload) ? msg.payload : [];
const lookup = msg._mediaLookup && typeof msg._mediaLookup === 'object' ? msg._mediaLookup : {};
const moduleId = String(lookup.rawUuid || '').trim();
const requestedStationId = String(lookup.stationid || '').trim();
const moduleCandidates = Array.isArray(lookup.moduleCandidates) ? lookup.moduleCandidates : [];

let matchedStation = null;

if (requestedStationId) {
    matchedStation = docs.find((doc) => String(doc && doc.stationid || '').trim() === requestedStationId) || null;
}

if (!matchedStation && moduleCandidates.length > 0) {
    matchedStation = docs.find((doc) => {
        const modules = Array.isArray(doc && doc.modules) ? doc.modules : [];
        return modules.some((module) => moduleMatches(module && module.id, moduleCandidates));
    }) || null;
}

if (!matchedStation) {
    msg.payload = {
        code: 404,
        type: 0,
        data: [],
        msg: 'No matching station for uuid',
        time: Date.now()
    };
    return msg;
}

const media = matchedStation.media && typeof matchedStation.media === 'object' ? matchedStation.media : {};
const rawPlaylist = Array.isArray(media.playlist) ? media.playlist : [];
const screenBrightnessValue = Number(media.screenBrightness ?? 255);
const screenBrightness = Number.isFinite(screenBrightnessValue) ? screenBrightnessValue : 255;
const defaultPlayTimeValue = Number(media.playTime ?? 20);
const defaultPlayTime = Number.isFinite(defaultPlayTimeValue) ? defaultPlayTimeValue : 20;

const playlist = rawPlaylist
    .filter((item) => item && typeof item.downloadUrl === 'string' && item.downloadUrl.trim())
    .filter((item) => {
        const contentType = String(item.contentType || '').trim().toLowerCase();
        if (!ALLOW_PDF && contentType === 'application/pdf') {
            return false;
        }
        return true;
    })
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
    .map((item, index) => ({
        guuid: moduleId || String(moduleCandidates[0] || ''),
        url1: '',
        url2: item.downloadUrl.trim(),
        url3: '',
        forward: '',
        screenBrightness,
        weight: Number(item.weight ?? 0),
        playTime: Number(item.playTime ?? defaultPlayTime),
        id: Number(item.id ?? (100001 + index)),
        title: String(item.name || item.title || ''),
        fileType: Number(item.fileType ?? 0)
    }));

if (media.active !== true || playlist.length === 0) {
    const filteredPdfCount = rawPlaylist.filter((item) => (
        String(item && item.contentType || '').trim().toLowerCase() === 'application/pdf'
    )).length;

    msg.payload = {
        code: 200,
        type: 0,
        data: [],
        msg: !ALLOW_PDF && filteredPdfCount > 0 ? 'No supported media assigned' : 'No media assigned',
        time: Date.now()
    };
    return msg;
}

msg.payload = {
    code: 200,
    type: 0,
    data: playlist,
    msg: 'OK',
    time: Date.now()
};

return msg;`;

const queryNode = {
  id: QUERY_ID,
  type: "google-cloud-firestore",
  z: "ebbebe04a01eca8f",
  g: GROUP_ID,
  account: "",
  keyFilename: "/home/george/firestore/firestore-key.json",
  name: "Query kiosks for media",
  projectId: "node-red-alerts",
  mode: "query",
  x: 1790,
  y: 2400,
  wires: [[BUILD_ID]],
};

const buildNode = {
  id: BUILD_ID,
  type: "function",
  z: "ebbebe04a01eca8f",
  g: GROUP_ID,
  name: "Build media response",
  func: buildResponseFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: "",
  finalize: "",
  libs: [],
  x: 2000,
  y: 2400,
  wires: [[DEBUG_RESPONSE_ID, RESPONSE_ID]],
};

const nextFlow = [];

for (const node of flow) {
  if (REMOVE_IDS.has(node.id)) {
    continue;
  }

  if (node.id === GROUP_ID) {
    nextFlow.push({
      ...node,
      name: "Http screen ads (Firebase media)",
      nodes: [
        HTTP_IN_ID,
        PREPARE_ID,
        QUERY_ID,
        BUILD_ID,
        RESPONSE_ID,
        DEBUG_RESPONSE_ID,
        DEBUG_REQUEST_ID,
        INJECT_ID,
      ],
      w: 1186,
      h: 222,
    });
    continue;
  }

  if (node.id === HTTP_IN_ID) {
    nextFlow.push({
      ...node,
      wires: [[PREPARE_ID, DEBUG_REQUEST_ID]],
    });
    continue;
  }

  if (node.id === PREPARE_ID) {
    nextFlow.push({
      ...node,
      name: "Prepare media lookup",
      func: prepareFunc,
      outputs: 2,
      timeout: 0,
      wires: [
        [QUERY_ID],
        [DEBUG_RESPONSE_ID, RESPONSE_ID],
      ],
    });
    nextFlow.push(queryNode);
    nextFlow.push(buildNode);
    continue;
  }

  if (node.id === DEBUG_RESPONSE_ID) {
    nextFlow.push({
      ...node,
      name: "media response debug",
      complete: "true",
      targetType: "full",
    });
    continue;
  }

  if (node.id === DEBUG_REQUEST_ID) {
    nextFlow.push({
      ...node,
      name: "ad request debug",
      complete: "true",
      targetType: "full",
    });
    continue;
  }

  if (node.id === INJECT_ID) {
    nextFlow.push({
      ...node,
      wires: [[PREPARE_ID]],
    });
    continue;
  }

  nextFlow.push(node);
}

await fs.writeFile(outputPath, JSON.stringify(nextFlow, null, 4));
console.log(`Wrote ${outputPath}`);
