import fs from 'node:fs';

const flowPath = process.argv[2];
if (!flowPath) throw new Error('Usage: node install-ui-profile-firestore-flow.mjs /path/to/hq.json');

const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
const byName = (name) => flow.find((node) => node.name === name);
const mustFind = (name) => {
  const node = byName(name);
  if (!node) throw new Error(`Missing Node-RED node: ${name}`);
  return node;
};

const requestIn = mustFind('UI profile requests');
const prepareRequest = mustFind('Validate request + prepare lookup');
const queryKiosk = mustFind('Resolve station active profile');
const resolveKiosk = mustFind('Return update or current');
const responseOut = mustFind('UI profile response');
mustFind('UI profile acknowledgements');
const prepareAck = mustFind('Validate + prepare acknowledgement');
const queryAckKiosk = mustFind('Record applied profile');
const prepareAckWrite = mustFind('Acknowledgement status');
const catchNode = mustFind('UI profile backend errors');
const tabId = requestIn.z;

const firestoreBase = {
  type: 'google-cloud-firestore',
  z: tabId,
  account: '662bee08b103bc8a',
  keyFilename: '/home/george/firestore/firestore-key.json',
  projectId: 'node-red-alerts',
};

prepareRequest.func = `const topic = String(msg.topic || "");
const match = /^req\\/([^/]+)\\/ui-profile$/.exec(topic);
if (!match) return null;

const stationid = String(match[1] || "").trim();
if (!stationid || !/^[A-Za-z0-9._-]{1,120}$/.test(stationid)) {
    node.warn("Invalid UI profile station id");
    return null;
}

const request = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
msg.stationid = stationid;
msg.responseTopic = "res/" + stationid + "/ui-profile";
msg.profileRequest = {
    currentProfileId: String(request.currentProfileId || ""),
    currentProfileVersion: Number(request.currentProfileVersion || 0),
    currentProfileHash: String(request.currentProfileHash || "")
};
msg.payload = {
    path: "kiosks",
    query: [{ fieldPath: "stationid", opStr: "==", value: stationid }]
};
node.status({ fill: "blue", shape: "dot", text: "station " + stationid });
return msg;`;

Object.assign(queryKiosk, firestoreBase, {
  name: 'Query kiosk for UI profile',
  mode: 'query',
  x: 690,
  y: 140,
  wires: [[resolveKiosk.id]],
});
delete queryKiosk.method;
delete queryKiosk.ret;
delete queryKiosk.paytoqs;
delete queryKiosk.url;
delete queryKiosk.tls;
delete queryKiosk.persist;
delete queryKiosk.proxy;
delete queryKiosk.insecureHTTPParser;
delete queryKiosk.authType;
delete queryKiosk.senderr;
delete queryKiosk.headers;

resolveKiosk.name = 'Resolve kiosk client';
resolveKiosk.outputs = 2;
resolveKiosk.func = `const docs = Array.isArray(msg.payload) ? msg.payload : [];
const stationid = String(msg.stationid || "");
const kiosk = docs.find(item => String(item?.stationid || "") === stationid) || docs[0];

function errorResponse(code, message) {
    msg.topic = msg.responseTopic;
    msg.qos = 1;
    msg.retain = false;
    msg.payload = { status: "error", code, message };
    return [null, msg];
}

if (!kiosk) return errorResponse("kiosk_not_found", "Kiosk was not found");

const clientId = String(kiosk?.info?.client || kiosk?.info?.clientId || kiosk?.clientId || "")
    .trim().toUpperCase();
if (!clientId) return errorResponse("client_not_assigned", "Kiosk has no client assignment");

msg.profileClientId = clientId;
msg.kioskProvisionId = String(kiosk.provisionid || "");
msg.payload = {
    path: "uiProfiles",
    query: [{ fieldPath: "clientId", opStr: "==", value: clientId }]
};
node.status({ fill: "blue", shape: "dot", text: clientId + " profiles" });
return [msg, null];`;

const queryProfiles = {
  id: 'ui_profile_query_profiles_vm',
  ...firestoreBase,
  name: 'Query client UI profiles',
  mode: 'query',
  x: 960,
  y: 120,
  wires: [['ui_profile_build_response_vm']],
};

const buildResponse = {
  id: 'ui_profile_build_response_vm',
  type: 'function',
  z: tabId,
  name: 'Build authoritative UI profile response',
  func: `const profiles = Array.isArray(msg.payload) ? msg.payload : [];
const request = msg.profileRequest || {};
const clientId = String(msg.profileClientId || "");

const published = profiles
    .filter(profile => String(profile?.status || "").toLowerCase() === "published")
    .sort((left, right) => Number(right?.version || 0) - Number(left?.version || 0));
const profile = published[0];

msg.topic = msg.responseTopic;
msg.qos = 1;
msg.retain = false;

if (!profile) {
    msg.payload = {
        status: "error",
        code: "no_active_profile",
        message: "No published UI profile exists for client " + clientId
    };
    node.status({ fill: "yellow", shape: "ring", text: clientId + " no profile" });
    return msg;
}

const version = Number(profile.version || 1);
const profileId = String(
    profile.id || profile.profileId || profile.ui?.profileId ||
    (clientId.toLowerCase() + "-published")
);
const profileHash = profileId + ":" + version;
const colors = profile.ui?.colors || profile.ui?.theme || {};
const languages = {
    ...(profile.languages || {}),
    active: profile.ui?.languages?.active !== false
};
const uiControls = {
    map: { active: profile.ui?.map?.active !== false },
    terms: { active: profile.ui?.terms?.active !== false },
    languages: { active: profile.ui?.languages?.active !== false },
    information: { active: profile.ui?.information?.active !== false },
    receipt: { active: profile.ui?.receipt?.active !== false }
};
const profileAdmin = profile.admin && typeof profile.admin === "object" ? profile.admin : {};
const userpassword = String(profileAdmin.userpassword || "");
const adminpassword = String(profileAdmin.adminpassword || "");

if (!languages || languages.schemaVersion !== 2 || !languages.locales) {
    msg.payload = {
        status: "error",
        code: "invalid_profile_languages",
        message: "Published profile does not contain schema-v2 languages"
    };
    node.status({ fill: "red", shape: "ring", text: clientId + " invalid profile" });
    return msg;
}

if ((userpassword && !/^[1-5]{5}$/.test(userpassword)) ||
    (adminpassword && !/^[1-5]{5}$/.test(adminpassword))) {
    msg.payload = {
        status: "error",
        code: "invalid_profile_pins",
        message: "Published profile contains an invalid kiosk PIN"
    };
    node.status({ fill: "red", shape: "ring", text: clientId + " invalid PIN" });
    return msg;
}

const isCurrent =
    request.currentProfileId === profileId &&
    Number(request.currentProfileVersion || 0) === version &&
    request.currentProfileHash === profileHash;

if (isCurrent) {
    msg.payload = { status: "current", profileId, profileVersion: version, profileHash };
    node.status({ fill: "green", shape: "dot", text: clientId + " current v" + version });
    return msg;
}

msg.payload = {
    status: "update",
    profileId,
    profileVersion: version,
    profileHash,
    colors: {
        bcolor1: String(colors.bcolor1 || colors.primary || "#078B8C").toUpperCase(),
        bcolor2: String(colors.bcolor2 || colors.secondary || "#131E3A").toUpperCase()
    },
    ui: uiControls,
    admin: { userpassword, adminpassword },
    languages
};
node.status({ fill: "green", shape: "dot", text: clientId + " update v" + version });
return msg;`,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 1240,
  y: 120,
  wires: [[responseOut.id]],
};

resolveKiosk.wires = [[queryProfiles.id], [responseOut.id]];

prepareAck.func = `const topic = String(msg.topic || "");
const match = /^ack\\/([^/]+)\\/ui-profile$/.exec(topic);
if (!match) return null;

const stationid = String(match[1] || "").trim();
const ack = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
if (!stationid) return null;

msg.stationid = stationid;
msg.profileAck = {
    profileId: String(ack.profileId || ""),
    profileVersion: Number(ack.profileVersion || 0),
    profileHash: String(ack.profileHash || ""),
    status: String(ack.status || "applied"),
    appliedAt: String(ack.appliedAt || new Date().toISOString()),
    error: String(ack.error || "")
};
msg.payload = {
    path: "kiosks",
    query: [{ fieldPath: "stationid", opStr: "==", value: stationid }]
};
return msg;`;

Object.assign(queryAckKiosk, firestoreBase, {
  name: 'Query kiosk for profile acknowledgement',
  mode: 'query',
  x: 750,
  y: 280,
  wires: [[prepareAckWrite.id]],
});
delete queryAckKiosk.method;
delete queryAckKiosk.ret;
delete queryAckKiosk.paytoqs;
delete queryAckKiosk.url;
delete queryAckKiosk.tls;
delete queryAckKiosk.persist;
delete queryAckKiosk.proxy;
delete queryAckKiosk.insecureHTTPParser;
delete queryAckKiosk.authType;
delete queryAckKiosk.senderr;
delete queryAckKiosk.headers;

prepareAckWrite.name = 'Prepare profile acknowledgement write';
prepareAckWrite.func = `const docs = Array.isArray(msg.payload) ? msg.payload : [];
const kiosk = docs.find(item => String(item?.stationid || "") === String(msg.stationid || "")) || docs[0];
const provisionid = String(kiosk?.provisionid || "");
if (!provisionid) {
    node.warn("Could not persist UI profile acknowledgement for " + msg.stationid);
    return null;
}
msg.payload = {
    path: "kiosks/" + provisionid,
    content: {
        reportedUiProfile: msg.profileAck,
        uiProfileReportedAt: new Date().toISOString()
    }
};
return msg;`;
prepareAckWrite.wires = [['ui_profile_ack_write_vm']];

const ackWrite = {
  id: 'ui_profile_ack_write_vm',
  ...firestoreBase,
  name: 'Persist UI profile acknowledgement',
  mode: 'update',
  x: 1050,
  y: 280,
  wires: [['ui_profile_ack_complete_vm']],
};

const ackComplete = {
  id: 'ui_profile_ack_complete_vm',
  type: 'function',
  z: tabId,
  name: 'UI profile acknowledgement saved',
  func: 'node.status({ fill: "green", shape: "dot", text: msg.stationid + " ack saved" });\nreturn null;',
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 1330,
  y: 280,
  wires: [[]],
};

catchNode.scope = [queryKiosk.id, queryProfiles.id, queryAckKiosk.id, ackWrite.id];

const removeIds = new Set(['ui_profile_backend_tab', 'ui_profile_mqtt_broker', queryProfiles.id, buildResponse.id, ackWrite.id, ackComplete.id]);
const nextFlow = flow.filter((node) => !removeIds.has(node.id));
nextFlow.push(queryProfiles, buildResponse, ackWrite, ackComplete);

fs.writeFileSync(flowPath, `${JSON.stringify(nextFlow, null, 4)}\n`);
console.log(`Installed direct Firestore UI profile flow in ${flowPath}`);
