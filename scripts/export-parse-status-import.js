import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourcePath = path.join(__dirname, 'parse-status-firebase-flow.json');
const outputPath = path.join(__dirname, 'parse-status-firebase-import.json');

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const sourceGroupId = 'b45eac58d0898b94';
const sourceTabId = '940482972d2ca412';

const targetTabId = 'ps-import-tab';
const targetGroupId = 'ps-import-group';

const keepNames = new Set([
  'Status input',
  'chk status [16]',
  'Prepare Kiosk Lookup',
  'Resolve Kiosk Doc',
  'CT3 parse status',
  'parse status',
  'Prepare Firebase Update',
  'Query kiosk doc',
  'Update kiosk in Firebase',
  'Firebase write result',
  'debug 273',
  'debug 284',
  'debug 285',
  'debug 288',
]);

const idMap = new Map([
  ['45e263e33e997169', 'ps-link-in'],
  ['952160aa36341f64', 'ps-debug-in'],
  ['7e6738b73d43dc52', 'ps-switch-status'],
  ['c60c602fd06f43d0', 'ps-switch-length'],
  ['3dd458aadec4d64e', 'ps-debug-ct3-branch'],
  ['4cc0a30364315ceb', 'ps-debug-main-branch'],
  ['53ae4cbde851aeb9', 'ps-ct3-parser'],
  ['194981b38f8cc71a', 'ps-parser'],
  ['b8167a27f5e8dad6', 'ps-debug-parser'],
  ['ps-fn-query-prep', 'ps-lookup-prep'],
  ['ps-fs-query', 'ps-fs-query'],
  ['ps-fn-update-prep', 'ps-resolve-doc'],
  ['87d30f04384a1018', 'ps-update-prep'],
  ['ps-fs-update', 'ps-fs-update'],
  ['ps-debug-write', 'ps-debug-write'],
]);

function mapId(value) {
  if (typeof value !== 'string') return value;
  return idMap.get(value) || value;
}

const group = {
  id: targetGroupId,
  type: 'group',
  z: targetTabId,
  name: 'parse status firebase only',
  style: {
    stroke: '#1d4ed8',
    fill: '#dbeafe',
    label: true,
    color: '#000000',
  },
  nodes: [],
  x: 54,
  y: 99,
  w: 1602,
  h: 262,
};

const comment = {
  id: 'ps-comment',
  type: 'comment',
  z: targetTabId,
  name: 'Connect existing user/update flow to Status input',
  info: '',
  x: 230,
  y: 80,
  wires: [],
};

const nodes = source
  .filter((node) => node.g === sourceGroupId)
  .filter((node) => node.type !== 'link out')
  .filter((node) => node.name !== 'hq update')
  .map((node) => {
    const cloned = JSON.parse(JSON.stringify(node));
    cloned.id = mapId(cloned.id);
    cloned.z = targetTabId;
    cloned.g = targetGroupId;

    if (cloned.name === 'link in 19') {
      cloned.name = 'Status input';
      cloned.links = [];
      cloned.x = 130;
      cloned.y = 240;
    }

    if (cloned.type === 'switch' && cloned.name === 'chk status [16]') {
      cloned.x = 300;
      cloned.y = 240;
    }

    if (cloned.type === 'function' && cloned.name === 'Prepare Kiosk Lookup') {
      cloned.x = 500;
      cloned.y = 240;
    }

    if (cloned.type === 'google-cloud-firestore' && cloned.name === 'Query kiosk doc') {
      cloned.x = 700;
      cloned.y = 240;
    }

    if (cloned.type === 'function' && cloned.name === 'Resolve Kiosk Doc') {
      cloned.x = 900;
      cloned.y = 240;
    }

    if (cloned.type === 'switch' && cloned.property === 'payload.length') {
      cloned.x = 1080;
      cloned.y = 240;
    }

    if (cloned.name === 'CT3 parse status') {
      cloned.x = 1270;
      cloned.y = 200;
    }

    if (cloned.name === 'parse status') {
      cloned.x = 1270;
      cloned.y = 280;
    }

    if (cloned.name === 'Prepare Firebase Update') {
      cloned.x = 1460;
      cloned.y = 240;
    }

    if (cloned.name === 'Update kiosk in Firebase') {
      cloned.x = 1650;
      cloned.y = 240;
    }

    if (Array.isArray(cloned.wires)) {
      cloned.wires = cloned.wires.map((wireGroup) => wireGroup.map(mapId));
    }

    return cloned;
  });

for (const node of nodes) {
  if (keepNames.has(node.name) || node.name === '') {
    group.nodes.push(node.id);
  }
}

const tab = {
  id: targetTabId,
  type: 'tab',
  label: 'Parse Status Firebase Only',
  disabled: false,
  info: 'Importable Firebase-only status parser for Besiter user/update payloads.',
  env: [],
};

fs.writeFileSync(outputPath, JSON.stringify([tab, group, comment, ...nodes], null, 4) + '\n');
console.log(`Wrote ${outputPath}`);
