import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import http from 'node:http';
import {
  PILOT, PUBLIC_URL, READY_SOURCE, UNAVAILABLE_SOURCE,
  buildPatchedBuilder, buildPilotNodes, patchUs8004HttpMediaFlows,
} from './patch-us8004-http-media.mjs';

const original = await readFile(new URL('../output/diagnostics/us8004-media-2026-09-10/live-build-media-response.js', import.meta.url), 'utf8');
const image = await readFile(new URL('../output/diagnostics/us8004-media-2026-09-10/test.jpg', import.meta.url));
const patched = buildPatchedBuilder(original);
const FIXED_DATE = class extends Date { static now() { return 1789068300000; } };
const execute = (source, msg) => new Function('msg', 'Date', source)(msg, FIXED_DATE);
const imageUrl = `https://firebasestorage.googleapis.com/v0/b/node-red-alerts.firebasestorage.app/o/${encodeURIComponent(PILOT.storagePath)}?alt=media&token=fixture-only`;

function station() {
  return {
    id: PILOT.provisionId, provisionid: PILOT.provisionId, stationid: PILOT.stationId,
    hardware: {type: 'CT8'}, modules: [{id: '868998088454331'}],
    media: {active: true, playlist: [{
      assetId: PILOT.assetId, storagePath: PILOT.storagePath, name: 'test.jpg',
      contentType: 'image/jpeg', size: PILOT.size, downloadUrl: imageUrl,
      kind: 'image', order: 0,
    }]},
  };
}

function response(source, doc) {
  return execute(source, {
    payload: [doc], _mediaLookup: {rawUuid: '868998088454331', moduleCandidates: ['868998088454331']},
  }).payload;
}

test('rewrites only the reviewed station and asset, preserving all other API fields', () => {
  const doc = station();
  const before = response(original, doc);
  const after = response(patched, doc);
  assert.equal(after.data[0].url2, PUBLIC_URL);
  after.data[0].url2 = before.data[0].url2;
  assert.deepEqual(after, before);
  const mutations = [
    d => { d.stationid = 'CA8000'; d.hardware.type = 'CK48'; },
    d => { d.provisionid = 'id-reassigned'; },
    d => { d.hardware.type = 'CK48'; },
    d => { d.media.active = false; },
    d => { d.media.playlist[0].assetId = 'next-asset'; },
    d => { d.media.playlist[0].storagePath += '.old'; },
    d => { d.media.playlist[0].name = 'next.jpg'; },
    d => { d.media.playlist[0].contentType = 'image/png'; },
    d => { d.media.playlist[0].size += 1; },
    d => { d.media.playlist[0].downloadUrl = imageUrl.replace('googleapis.com', 'googleapis.com.evil.example'); },
    d => { d.media.playlist[0].downloadUrl = imageUrl.replace('https:', 'http:'); },
    d => { d.media.playlist[0].downloadUrl = imageUrl.replace('test.jpg', 'other.jpg'); },
    d => { d.media.playlist[0].downloadUrl = imageUrl.replace('dashboard-media', '%ZZ'); },
    d => { d.media.playlist = []; },
  ];
  for (const mutate of mutations) {
    const changed = station(); mutate(changed);
    assert.deepEqual(response(patched, changed), response(original, changed), String(mutate));
  }
  const rotated = station();
  rotated.media.playlist[0].downloadUrl = imageUrl.replace('fixture-only', 'rotated-fixture');
  assert.equal(response(patched, rotated).data[0].url2, PUBLIC_URL);
});

test('flow transform is pure, preserves unrelated nodes, idempotent, and rejects drift/collisions', () => {
  const builder = {id: PILOT.builderId, type: 'function', z: 'reviewed-tab', name: 'Build media response', func: original, wires: [['existing-next']]};
  const other = {id: 'unrelated', type: 'function', z: 'another-tab', func: 'return msg;', wires: []};
  const flows = [builder, other];
  const snapshot = structuredClone(flows);
  const changed = patchUs8004HttpMediaFlows(flows, original);
  assert.deepEqual(flows, snapshot);
  assert.deepEqual(changed[1], other);
  assert.deepEqual({...changed[0], func: original}, builder);
  assert.equal(changed.length, flows.length + 6);
  assert.deepEqual(patchUs8004HttpMediaFlows(changed, original), changed);
  assert.throws(() => buildPatchedBuilder(original + '\n// unexpected edit'), /drifted/);
  assert.throws(() => patchUs8004HttpMediaFlows([{...builder, func: original + '\n// new edit'}, other], original), /differs/);
  assert.throws(() => patchUs8004HttpMediaFlows([...flows, {...other, id: 'collision', type: 'http in', url: PILOT.path}], original), /already owned/);
  const drifted = structuredClone(changed);
  drifted.find(node => node.type === 'file in').filename = '/etc/passwd';
  assert.throws(() => patchUs8004HttpMediaFlows(drifted, original), /drifted/);
  const file = changed.find(node => node.type === 'file in');
  const catcher = changed.find(node => node.type === 'catch');
  assert.equal(file.filename, PILOT.file);
  assert.equal(file.filenameType, 'str');
  assert.equal(file.format, '');
  assert.equal(file.sendError, false); // catch only; avoid sending a second HTTP response.
  assert.deepEqual(catcher.scope, [file.id]);
});

test('verified bytes get image headers; damaged/missing bytes receive sanitized noncached 503', () => {
  assert.equal(createHash('sha256').update(image).digest('hex'), PILOT.sha256);
  assert.equal(image.length, PILOT.size);
  const success = execute(READY_SOURCE, {payload: image, filename: PILOT.file});
  assert.equal(success.statusCode, 200);
  assert.strictEqual(success.payload, image);
  assert.equal(success.headers['Content-Type'], 'image/jpeg');
  assert.equal(success.headers['Content-Length'], String(image.length));
  assert.equal(success.headers.ETag, `"${PILOT.sha256}"`);
  assert.match(success.headers['Cache-Control'], /immutable/);
  assert.equal(success.filename, undefined);
  for (const payload of [undefined, '', Buffer.alloc(image.length), image.subarray(0, -1)]) {
    const unavailable = execute(READY_SOURCE, {payload, filename: PILOT.file, error: {message: 'private filesystem details'}});
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.headers['Cache-Control'], 'no-store');
    assert.equal(unavailable.error, undefined);
    assert.equal(unavailable.filename, undefined);
    assert.equal(unavailable.payload.toString(), 'Advertising image temporarily unavailable\n');
  }
  const readFailure = execute(UNAVAILABLE_SOURCE, {error: {code: 'ENOENT', message: PILOT.file}, filename: PILOT.file});
  assert.equal(readFailure.statusCode, 503);
  assert.equal(readFailure.error, undefined);
  assert.equal(readFailure.filename, undefined);
});

test('actual Express GET/HEAD return correct bytes/length; Range is full 200 and unknown paths404', async () => {
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const express = require('express');
  const app = express();
  const route = buildPilotNodes('test').find(node => node.type === 'http in');
  app[route.method](route.url, (req, res) => {
    const msg = execute(READY_SOURCE, {req, payload: image});
    res.set(msg.headers).status(msg.statusCode).send(msg.payload);
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: server.address().port, path, ...options}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
    });
    req.on('error', reject); req.end();
  });
  try {
    const get = await request(PILOT.path);
    assert.equal(get.status, 200);
    assert.deepEqual(get.body, image);
    assert.equal(get.headers['content-length'], String(image.length));
    const head = await request(PILOT.path, {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-length'], String(image.length));
    const range = await request(PILOT.path, {headers: {Range: 'bytes=0-9'}});
    assert.equal(range.status, 200);
    assert.deepEqual(range.body, image);
    assert.equal(range.headers['accept-ranges'], 'none');
    assert.equal((await request(PILOT.path.replace('test.jpg', 'secret.txt'))).status, 404);
    assert.equal((await request(PILOT.path, {method: 'POST'})).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
