import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

// This is an explicitly limited, single-asset pilot. It is not an open proxy.
export const PILOT = Object.freeze({
  builderId: 'bfd51824cc0b6700',
  originalBuilderSha256: '8216559f87fbae86526b276b6040f64d0164ec9d1ce79ababb6d859233754be0',
  stationId: 'US8004',
  provisionId: 'id-9987807846',
  assetId: 'NWZgsd2yZjg7NJxeTu3R',
  storagePath: 'dashboard-media/global/NWZgsd2yZjg7NJxeTu3R/test.jpg',
  sha256: 'a02f20f4081d4baf5e70eb5054a89089644b3f6b0d2a0dfe628314775de3b8c4',
  size: 226704,
  path: '/api/advert/compat/us8004/a02f20f4081d4baf5e70eb5054a89089644b3f6b0d2a0dfe628314775de3b8c4/test.jpg',
  file: '/home/george/.node-red/media-compat/us8004/a02f20f4081d4baf5e70eb5054a89089644b3f6b0d2a0dfe628314775de3b8c4.jpg',
});
export const PUBLIC_URL = `http://34.56.244.66:1880${PILOT.path}`;

const IDS = Object.freeze({
  get: 'ct8_us8004_pilot_get',
  file: 'ct8_us8004_pilot_file',
  ready: 'ct8_us8004_pilot_ready',
  response: 'ct8_us8004_pilot_response',
  catch: 'ct8_us8004_pilot_catch',
  unavailable: 'ct8_us8004_pilot_unavailable',
});

const BUILDER_PREFIX = `// US8004 HTTP media compatibility pilot: fixed, preverified public advertising image.
// Preserve all other stations/assets. This does not mirror future assignments.
function resolveUs8004MediaUrl(station, item) {
    const original = item.downloadUrl.trim();
    if (String(station.stationid || '') !== '${PILOT.stationId}' ||
        String(station.provisionid || '') !== '${PILOT.provisionId}' ||
        String(station.hardware && station.hardware.type || '') !== 'CT8' ||
        String(item.assetId || '') !== '${PILOT.assetId}' ||
        String(item.storagePath || '') !== '${PILOT.storagePath}' ||
        String(item.name || '') !== 'test.jpg' ||
        String(item.contentType || '') !== 'image/jpeg' ||
        Number(item.size) !== ${PILOT.size}) {
        return original;
    }
    // Match the exact HTTPS authority and decoded object path. No token is copied.
    const match = original.match(/^https:\\/\\/firebasestorage\\.googleapis\\.com\\/v0\\/b\\/node-red-alerts\\.firebasestorage\\.app\\/o\\/([^?#]+)(?:\\?[^#]*)?$/);
    if (!match) return original;
    try {
        if (decodeURIComponent(match[1]) !== '${PILOT.storagePath}') return original;
    } catch (_) {
        return original;
    }
    return '${PUBLIC_URL}';
}

`;

export const UNAVAILABLE_SOURCE = `// Do not expose filesystem paths, exception messages, or upstream credentials.
msg.statusCode = 503;
msg.payload = Buffer.from('Advertising image temporarily unavailable\\n', 'utf8');
msg.headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(msg.payload.length),
    'Cache-Control': 'no-store',
    'Retry-After': '30',
    'X-Content-Type-Options': 'nosniff'
};
delete msg.error;
delete msg.filename;
return msg;`;

export const READY_SOURCE = `// The staged file's SHA-256 must be verified before enabling this route.
// Full Buffer is retained for HEAD: Express suppresses its body and keeps its length.
if (!Buffer.isBuffer(msg.payload) || msg.payload.length !== ${PILOT.size} ||
    msg.payload[0] !== 0xff || msg.payload[1] !== 0xd8 ||
    msg.payload[msg.payload.length - 2] !== 0xff || msg.payload[msg.payload.length - 1] !== 0xd9) {
    ${UNAVAILABLE_SOURCE.replaceAll('\n', '\n    ')}
}
msg.statusCode = 200;
msg.headers = {
    'Content-Type': 'image/jpeg',
    'Content-Length': String(msg.payload.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': '"${PILOT.sha256}"',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'none'
};
delete msg.error;
delete msg.filename;
return msg;`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildPatchedBuilder(originalSource) {
  if (typeof originalSource !== 'string' ||
      sha256(originalSource.trimEnd()) !== PILOT.originalBuilderSha256) {
    throw new Error('Live media builder drifted; re-review before patching');
  }
  const needle = 'url2: item.downloadUrl.trim(),';
  if (originalSource.split(needle).length !== 2) {
    throw new Error('Expected exactly one original media URL mapping');
  }
  return BUILDER_PREFIX + originalSource.replace(needle, 'url2: resolveUs8004MediaUrl(matchedStation, item),');
}

export function buildPilotNodes(tabId) {
  if (typeof tabId !== 'string' || !tabId) throw new Error('Builder tab ID required');
  const fn = (id, name, func, x, y, wires) => ({
    id, type: 'function', z: tabId, name, func, outputs: 1, timeout: 0,
    noerr: 0, initialize: '', finalize: '', libs: [], x, y, wires,
  });
  return [
    {
      id: IDS.get, type: 'http in', z: tabId, name: 'US8004 pilot JPEG (GET / HEAD)',
      url: PILOT.path, method: 'get', upload: false, swaggerDoc: '',
      x: 220, y: 1940, wires: [[IDS.file]],
    },
    {
      id: IDS.file, type: 'file in', z: tabId, name: 'Read verified US8004 pilot JPEG',
      filename: PILOT.file, filenameType: 'str', format: '', chunk: false,
      sendError: false, encoding: 'none', allProps: true,
      x: 550, y: 1940, wires: [[IDS.ready]],
    },
    fn(IDS.ready, 'Validate pilot image and set HTTP headers', READY_SOURCE, 910, 1940, [[IDS.response]]),
    {
      id: IDS.response, type: 'http response', z: tabId, name: 'Return US8004 image',
      statusCode: '', headers: {}, x: 1260, y: 1940, wires: [],
    },
    {
      id: IDS.catch, type: 'catch', z: tabId, name: 'Catch only pilot file-read failures',
      scope: [IDS.file], uncaught: false, x: 540, y: 2000, wires: [[IDS.unavailable]],
    },
    fn(IDS.unavailable, 'Return sanitized media unavailable', UNAVAILABLE_SOURCE, 910, 2000, [[IDS.response]]),
  ];
}

// Pure transform: no I/O, no in-place changes, and no dependency on saved flows.
export function patchUs8004HttpMediaFlows(flows, originalBuilderSource) {
  if (!Array.isArray(flows) || flows.some(node => !node || typeof node !== 'object' || Array.isArray(node))) {
    throw new Error('Expected a Node-RED flow array');
  }
  const ids = flows.map(node => node.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate flow node IDs');
  const builder = flows.find(node => node.id === PILOT.builderId);
  if (!builder || builder.type !== 'function' || !builder.z) throw new Error('Expected media builder missing');
  const patchedSource = buildPatchedBuilder(originalBuilderSource);
  const nodes = buildPilotNodes(builder.z);
  const existing = flows.filter(node => Object.values(IDS).includes(node.id));
  const routeCollision = flows.some(node => node.type === 'http in' && node.url === PILOT.path && node.id !== IDS.get);
  if (routeCollision) throw new Error('Pilot HTTP route already owned by another node');
  if (typeof builder.func === 'string' && builder.func.trimEnd() === patchedSource.trimEnd()) {
    if (existing.length !== nodes.length || nodes.some(node =>
      !isDeepStrictEqual(flows.find(current => current.id === node.id), node))) {
      throw new Error('Pilot nodes drifted or are incomplete; do not overwrite');
    }
    return structuredClone(flows);
  }
  if (existing.length) throw new Error('Pilot node IDs already exist');
  if (typeof builder.func !== 'string' || builder.func.trimEnd() !== originalBuilderSource.trimEnd()) {
    throw new Error('Live builder differs from reviewed source');
  }
  return flows.map(node => node.id === PILOT.builderId ?
    {...structuredClone(node), func: patchedSource} : structuredClone(node)).concat(nodes);
}

async function main() {
  const [sourcePath, outputDirectory] = process.argv.slice(2);
  if (!sourcePath || !outputDirectory || process.argv.length !== 4) {
    throw new Error('Usage: node scripts/patch-us8004-http-media.mjs <reviewed-builder.js> <candidate-directory>');
  }
  const source = await readFile(sourcePath, 'utf8');
  const destination = resolve(outputDirectory);
  const patched = buildPatchedBuilder(source);
  await mkdir(destination, {recursive: true});
  await writeFile(resolve(destination, 'build-media-response.candidate.js'), patched);
  // Only new nodes, not a production flow export with unrelated credentials.
  await writeFile(resolve(destination, 'new-media-route-nodes.json'), JSON.stringify(buildPilotNodes('ebbebe04a01eca8f'), null, 2) + '\n');
  await writeFile(resolve(destination, 'pilot-manifest.json'), JSON.stringify({
    ...PILOT, publicUrl: PUBLIC_URL,
    limitation: 'Only the currently reviewed test.jpg on US8004 is compatible; future assets are not mirrored.',
    deployment: 'Stage exact bytes and verify SHA-256; re-read live flows; apply pure transform; deploy modified nodes; issue US8004 load_ad and verify playback.',
    rollback: 'Restore only the reviewed builder function and remove the six pilot nodes; refresh US8004. Remove the staged file separately after route removal.',
  }, null, 2) + '\n');
  console.log(`Wrote three review artifacts to ${destination}; no deployment performed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
