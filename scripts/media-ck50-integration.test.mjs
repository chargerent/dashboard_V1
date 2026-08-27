import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  patchV1Ck50DashboardMediaFlow,
  PYTHON_SYNC_SOURCE,
} from './patch-v1-ck50-dashboard-media.mjs';
import { patchMediaPlaybackAckBackend } from './patch-media-playback-ack-backend.mjs';
import { resolveKioskMediaPlaybackStatus } from '../src/utils/kioskMediaPlaybackStatus.js';
import { normalizeKioskData } from '../src/utils/helpers.js';

const mediaPageSource = fs.readFileSync(new URL('../src/pages/MediaPage.jsx', import.meta.url), 'utf8');
const functionsSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const detailPanelSource = fs.readFileSync(new URL('../src/components/kiosk/KioskDetailPanel.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function createKioskMediaFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const mediaBase = path.join(root, 'dashboard');
  const legacyMediaRoot = path.join(root, 'media');
  const legacyPictureDirectory = path.join(legacyMediaRoot, 'PICTURE');
  const defaultImage = path.join(root, 'default.jpg');
  fs.mkdirSync(legacyPictureDirectory, { recursive: true });
  fs.writeFileSync(defaultImage, 'default-image');
  return {
    root,
    mediaBase,
    legacyPictureDirectory,
    environment: {
      ...process.env,
      CHARGERENT_MEDIA_BASE: mediaBase,
      CHARGERENT_LEGACY_MEDIA_ROOT: legacyMediaRoot,
      CHARGERENT_DEFAULT_MEDIA: defaultImage,
    },
  };
}

function runFlowFunction(node, { kiosk = {}, msg = {} } = {}) {
  const stored = new Map([['kiosk', kiosk]]);
  const statuses = [];
  const runtimeGlobal = {
    get: (key) => stored.get(key),
    set: (key, value) => stored.set(key, value),
  };
  const runtimeNode = { status: (value) => statuses.push(value) };
  const result = new Function('msg', 'global', 'node', 'Buffer', node.func)(
    msg,
    runtimeGlobal,
    runtimeNode,
    Buffer,
  );
  return { result, msg, stored, statuses };
}

test('Media Library enables only CK50 from the V1 hardware family', () => {
  assert.match(mediaPageSource, /V1_MEDIA_CONFIGURABLE_KIOSK_TYPES = new Set\(\['CK50'\]\)/);
  assert.match(mediaPageSource, /isV1MediaKiosk\(kiosk\) \|\| \(/);
  assert.doesNotMatch(mediaPageSource, /V1_MEDIA_CONFIGURABLE_KIOSK_TYPES = new Set\([^\n]*(?:CT10|CK30|CK40)/);
});

test('backend accepts CK50 assignments without broadening V1 media eligibility', () => {
  assert.match(functionsSource, /V1_MEDIA_CONFIGURABLE_KIOSK_TYPES = new Set\(\["CK50"\]\)/);
  assert.match(functionsSource, /isV1MediaKiosk\(kiosk\) \|\| \(/);
  assert.doesNotMatch(functionsSource, /V1_MEDIA_CONFIGURABLE_KIOSK_TYPES = new Set\([^\n]*(?:CT10|CK30|CK40)/);
  assert.match(functionsSource, /V1_MEDIA_ASSIGNMENTS_COLLECTION = "kioskMediaAssignments"/);
  assert.match(functionsSource, /mediaV1AssignmentImpl/);
});

test('CK50 assignments use the V1 media contract', () => {
  assert.match(mediaPageSource, /V1 CK50 screens support image and video assets only/);
  assert.match(functionsSource, /V1 CK50 kiosks support image and video media only/);
  assert.match(functionsSource, /db\.collection\(V1_MEDIA_ASSIGNMENTS_COLLECTION\)\.doc\(entry\.stationid\)/);
  assert.match(functionsSource, /exports\.media_v1Assignment = functions\.https\.onRequest/);
  assert.match(functionsSource, /mode: resolveMediaModeValue\(entry\.kiosk\?\.ui\?\.mode\)/);
  assert.match(functionsSource, /V1_MEDIA_DEFAULT_CONFIG_DOCUMENT = "v1Ck50Default"/);
  assert.match(functionsSource, /defaultMedia = await getV1MediaDefaultConfig\(\)/);
  assert.match(functionsSource, /defaultMedia,/);
});

test('CK50 details mirror assigned media and keep all five modules visible with compact labels', () => {
  assert.match(detailPanelSource, /callFunctionWithAuth\('media_listAssets'/);
  assert.match(detailPanelSource, /payload\?\.v1Assignments/);
  assert.match(detailPanelSource, /data-kiosk-ck50-screen-preview="true"/);
  assert.match(detailPanelSource, /data-kiosk-ck50-modules="all"/);
  assert.match(detailPanelSource, /data-kiosk-ck50-profile-summary="true"/);
  assert.match(detailPanelSource, /data-kiosk-ck50-screen-preview="true"[\s\S]*data-kiosk-ck50-profile-summary="true"[\s\S]*data-kiosk-ck50-modules="all"/);
  assert.match(detailPanelSource, />UI Mode<\/p>/);
  assert.match(detailPanelSource, />Terminal State<\/p>/);
  assert.match(detailPanelSource, /renderAssignedMediaScreen\(\)/);
  assert.match(detailPanelSource, /visibleModules\.slice\(0, 2\)\.reverse\(\)/);
  assert.match(detailPanelSource, /visibleModules\.slice\(2, 5\)/);
  assert.match(detailPanelSource, /grid-cols-\[24px_minmax\(0,1fr\)\] grid-rows-2/);
  assert.match(detailPanelSource, /col-start-2 row-start-1 flex min-w-0 items-center gap-0\.5/);
  assert.match(detailPanelSource, /absolute bottom-\[5px\] left-\[26px\] text-\[8px\]/);
});

test('Media target stations show an Online pill using the dashboard status clock', () => {
  assert.match(mediaPageSource, /isKioskOnline\(kiosk, referenceTime\)/);
  assert.match(mediaPageSource, /data-media-kiosk-online="true"/);
  assert.match(mediaPageSource, />\s*Online\s*<\/span>/);
  assert.match(appSource, /<MediaPage[\s\S]*?referenceTime=\{latestTimestamp\}/);
});

test('CK50 media status requires a current kiosk report before showing Playing', () => {
  const assignment = {
    active: true,
    updatedAt: '2026-08-26T12:00:00.000Z',
    playlist: [{ assetId: 'asset-1' }],
  };
  const staleReport = {
    reportedMedia: {
      status: 'playing',
      receivedAt: '2026-08-26T11:59:00.000Z',
    },
    mediaReportedAt: '2026-08-26T11:59:00.000Z',
  };
  const currentReport = {
    reportedMedia: {
      status: 'playing',
      receivedAt: '2026-08-26T12:00:30.000Z',
    },
    mediaReportedAt: '2026-08-26T12:00:30.000Z',
  };

  assert.equal(resolveKioskMediaPlaybackStatus({
    kiosk: staleReport,
    assignment,
    referenceTime: '2026-08-26T12:01:00.000Z',
  }).state, 'pending');
  assert.equal(resolveKioskMediaPlaybackStatus({
    kiosk: currentReport,
    assignment,
    referenceTime: '2026-08-26T12:01:00.000Z',
  }).state, 'playing');
  assert.equal(resolveKioskMediaPlaybackStatus({
    kiosk: currentReport,
    assignment,
    referenceTime: '2026-08-26T12:01:00.000Z',
    isOnline: false,
  }).state, 'offline');
  assert.match(mediaPageSource, /data-media-playback-status=\{mediaPlaybackStatus\.state\}/);
});

test('kiosk normalization preserves a current CK50 playback report for the dashboard', () => {
  const reportedMedia = {
    stationid: 'US0914',
    provisionid: 'id-1234567890',
    signature: '0123456789abcdefabcd',
    status: 'playing',
    itemCount: 1,
    sourceStatus: 'unchanged',
    reportedAt: '2026-08-26T12:00:30.000Z',
    receivedAt: '2026-08-26T12:00:31.000Z',
    error: '',
  };
  const [kiosk] = normalizeKioskData([{
    stationid: 'US0914',
    provisionid: 'id-1234567890',
    hardware: { type: 'CK50', screen: 'E32in' },
    modules: {},
    reportedMedia,
    mediaReportedAt: '2026-08-26T12:00:31.000Z',
  }]);

  assert.deepEqual(kiosk.reportedMedia, reportedMedia);
  assert.notEqual(kiosk.reportedMedia, reportedMedia);
  assert.equal(kiosk.mediaReportedAt, '2026-08-26T12:00:31.000Z');
  assert.equal(resolveKioskMediaPlaybackStatus({
    kiosk,
    assignment: {
      active: true,
      updatedAt: '2026-08-26T12:00:00.000Z',
      playlist: [{ assetId: 'asset-1' }],
    },
    referenceTime: '2026-08-26T12:01:00.000Z',
    isOnline: true,
  }).state, 'playing');
});

test('CK50 details render artwork only after current playback confirmation', () => {
  assert.match(detailPanelSource, /mediaPlaybackStatus\?\.state === 'playing'/);
  assert.match(detailPanelSource, /isCK50Kiosk && !shouldDisplayMediaArtwork/);
  assert.match(detailPanelSource, /data-kiosk-media-state=\{state\}/);
  assert.match(detailPanelSource, /data-kiosk-media-playing="true"/);
  assert.match(detailPanelSource, /The files are loaded\. Waiting for playback verification\./);
  assert.match(detailPanelSource, /The assigned dashboard playlist is not active on this screen\./);
});

test('V1 CK50 flow patch adds a reusable identity-bound atomic media sync', () => {
  const fixture = [
    { id: 'b98e8eccc9a06c06', type: 'tab', label: 'media' },
    { id: '20ac637ab4744824', type: 'exec', z: 'b98e8eccc9a06c06', name: 'run mpv' },
    { id: '8597d2b7.ba618', type: 'mqtt-broker', name: 'Mosquito Broker' },
    { id: 'legacy-group', type: 'group', z: 'b98e8eccc9a06c06', name: 'load media' },
    { id: 'legacy-player', type: 'function', z: 'b98e8eccc9a06c06', g: 'legacy-group', name: 'load picture', func: 'msg.payload = "/home/odroid/Desktop/media/PICTURE/";' },
    { id: 'mount-group', type: 'group', z: 'b98e8eccc9a06c06', name: 'mount drive' },
    { id: 'legacy-mount', type: 'function', z: 'b98e8eccc9a06c06', g: 'mount-group', name: 'prepare mount', func: 'msg.payload = "rclone mount gdrive:";' },
    { id: 'legacy-run-mount', type: 'exec', z: 'b98e8eccc9a06c06', g: 'mount-group', name: 'run mount' },
    { id: 'safe-mount-child', type: 'function', z: 'b98e8eccc9a06c06', g: 'mount-group', name: 'select UI', func: 'return msg;' },
    { id: 'unrelated', type: 'inject', z: 'b98e8eccc9a06c06' },
  ];
  const patched = patchV1Ck50DashboardMediaFlow(fixture);
  const ids = new Set(patched.map((node) => node.id));

  for (const node of patched.filter((entry) => entry.type === 'function' && entry.id.startsWith('v1_ck50_dashboard_media_'))) {
    assert.doesNotThrow(() => new Function('msg', 'global', 'node', 'Buffer', node.func), `${node.id} must compile`);
  }

  assert.ok(ids.has('v1_ck50_dashboard_media_poll_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_sync_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_ack_mqtt_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_verify_exec_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_local_start_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_rotation_prepare_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_rotation_exec_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_rotation_result_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_rotation_retry_v1'));
  assert.ok(ids.has('v1_ck50_dashboard_media_local_start_build_v1'));
  assert.ok(ids.has('unrelated'));
  assert.equal(patched.find((node) => node.id === 'legacy-group').d, true);
  assert.equal(patched.find((node) => node.id === 'legacy-player').d, true);
  assert.equal(patched.find((node) => node.id === 'legacy-mount').d, true);
  assert.equal(patched.find((node) => node.id === 'legacy-run-mount').d, true);
  assert.equal(patched.find((node) => node.id === 'safe-mount-child').d, undefined);
  assert.equal(patched.find((node) => node.id === '20ac637ab4744824').d, undefined);
  assert.deepEqual(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_local_start_build_v1').wires,
    [['20ac637ab4744824']],
  );
  assert.deepEqual(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_local_start_v1').wires,
    [['v1_ck50_dashboard_media_rotation_prepare_v1']],
  );
  assert.deepEqual(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_rotation_result_v1').wires,
    [
      ['v1_ck50_dashboard_media_local_start_build_v1'],
      ['v1_ck50_dashboard_media_rotation_retry_v1'],
    ],
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_local_start_build_v1').func,
    /dashboard\/default\/playlist\.m3u/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_local_start_build_v1').func,
    /dashboard\/current\/playlist\.m3u/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_prepare_v1').func,
    /global\.get\("kiosk"\)/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_prepare_v1').func,
    /media-v1assignment-hqnnmh3unq-uc\.a\.run\.app/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_prepare_v1').func,
    /\/usr\/bin\/curl -fsS --max-time 20/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_prepare_v1').func,
    /hardwareType !== "CK50"/,
  );
  assert.equal(patched.find((node) => node.id === 'v1_ck50_dashboard_media_fetch_v1').type, 'exec');
  assert.equal(patched.find((node) => node.id === 'v1_ck50_dashboard_media_fetch_v1').command, '');
  assert.equal(patched.find((node) => node.id === 'v1_ck50_dashboard_media_fetch_v1').addpay, 'payload');
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_build_v1').func,
    /JSON\.parse\(String\(msg\.payload/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_build_v1').func,
    /msg\.mediaStationId/,
  );
  assert.deepEqual(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_result_v1').wires[0],
    ['20ac637ab4744824'],
  );
  assert.deepEqual(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_ack_mqtt_v1').broker,
    '8597d2b7.ba618',
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_ack_prepare_v1').func,
    /ack\/" \+ stationid \+ "\/media/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_ack_prepare_v1').func,
    /acknowledgement\("downloaded"/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_verify_result_v1').func,
    /expected_playlist_not_active/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_verify_result_v1').func,
    /status === "playing"/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_result_v1').func,
    /global\.set\("dashboardMediaSync", state\)/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_result_v1').func,
    /ps -C mpv -o args=/,
  );
  assert.match(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_result_v1').func,
    /result\.mode === "assigned"/,
  );
  assert.doesNotMatch(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_result_v1').func,
    /--playlist=\/home\/odroid\/Desktop\/media\/PICTURE/,
  );
  assert.doesNotMatch(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_result_v1').func,
    /global\.set\("kiosk\.media\.dashboard", state\)/,
  );
  assert.deepEqual(
    patched.find((node) => node.id === 'v1_ck50_dashboard_media_sync_v1').wires,
    [
      ['v1_ck50_dashboard_media_result_v1'],
      ['v1_ck50_dashboard_media_error_v1'],
      [],
    ],
  );
  const rotationPrepare = patched.find((node) => node.id === 'v1_ck50_dashboard_media_rotation_prepare_v1');
  const rotationResult = patched.find((node) => node.id === 'v1_ck50_dashboard_media_rotation_result_v1');
  const screen32 = runFlowFunction(rotationPrepare, {
    kiosk: { hardware: { type: 'CK50', screen: '32in' } },
  });
  assert.equal(screen32.result[0], screen32.msg);
  assert.equal(screen32.result[1], null);
  assert.equal(screen32.msg.rotationExpected, 'right');
  assert.match(screen32.msg.payload, /xrandr --output \$OUTPUT --mode 1920x1080 --rotate right/);
  assert.match(screen32.msg.payload, /connected 1080x1920/);
  assert.doesNotMatch(screen32.msg.payload, /--rotate left/);
  assert.equal(
    spawnSync('bash', ['-n'], { input: screen32.msg.payload, encoding: 'utf8' }).status,
    0,
  );

  const elo32 = runFlowFunction(rotationPrepare, {
    kiosk: { hardware: { type: 'CK50', screen: 'E32in' } },
  });
  assert.equal(elo32.msg.rotationExpected, 'left');
  assert.match(elo32.msg.payload, /xrandr --output \$OUTPUT --mode 1920x1080 --rotate left/);
  assert.match(elo32.msg.payload, /connected 1080x1920/);
  assert.match(elo32.msg.payload, /ET3243L/);
  assert.match(elo32.msg.payload, /Coordinate Transformation Matrix/);
  assert.equal(
    spawnSync('bash', ['-n'], { input: elo32.msg.payload, encoding: 'utf8' }).status,
    0,
  );

  const nonCk50 = runFlowFunction(rotationPrepare, {
    kiosk: { hardware: { type: 'CT10', screen: '7in' } },
  });
  assert.deepEqual(nonCk50.result, [null, null]);
  assert.equal(nonCk50.stored.get('dashboardMediaRotation'), undefined);

  const unknownCk50 = runFlowFunction(rotationPrepare, {
    kiosk: { hardware: { type: 'CK50', screen: 'mystery' } },
  });
  assert.deepEqual(unknownCk50.result, [null, null]);
  assert.equal(unknownCk50.stored.get('dashboardMediaRotation').error, 'unsupported_ck50_screen_type');
  assert.doesNotMatch(unknownCk50.msg.payload || '', /xrandr -o/);

  screen32.msg.payload = 'rotation_match|32in|right';
  const verifiedRotation = runFlowFunction(rotationResult, { msg: screen32.msg });
  assert.equal(verifiedRotation.result[0], screen32.msg);
  assert.equal(verifiedRotation.result[1], null);
  assert.equal(verifiedRotation.stored.get('dashboardMediaRotation').status, 'active');
  assert.equal(verifiedRotation.stored.get('dashboardMediaRotation').orientation, 'right');

  assert.doesNotMatch(JSON.stringify(patched.filter((node) => node.id.startsWith('v1_ck50_dashboard_media_'))), /US[0-9]{4}|id-[0-9]{10}/);
});

test('backend media acknowledgement receiver verifies station, provision, and CK50 hardware', () => {
  const fixture = [
    { id: 'f32d67882beea623', type: 'tab', label: 'MQTT' },
    { id: '8597d2b7.ba618', type: 'mqtt-broker', name: 'Mosquito Broker' },
    {
      id: 'ui_profile_ack_write_vm',
      type: 'google-cloud-firestore',
      z: 'f32d67882beea623',
      account: 'account-id',
      keyFilename: '/secure/firestore-key.json',
      projectId: 'node-red-alerts',
    },
  ];
  const patched = patchMediaPlaybackAckBackend(fixture);
  const mqttInput = patched.find((node) => node.id === 'media_playback_ack_mqtt_in_vm');
  const validateNode = patched.find((node) => node.id === 'media_playback_ack_validate_vm');
  const writeNode = patched.find((node) => node.id === 'media_playback_ack_prepare_write_vm');

  assert.equal(mqttInput.topic, 'ack/+/media');
  assert.match(validateNode.func, /payloadStationId !== topicStationId/);
  assert.match(validateNode.func, /without a valid assignment signature/);
  assert.match(writeNode.func, /provisionid !== msg\.provisionid/);
  assert.match(writeNode.func, /hardwareType !== "CK50"/);
});

test('V1 CK50 atomic media downloader has valid Python syntax', () => {
  const result = spawnSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "dashboard_media_sync", "exec")'], {
    input: PYTHON_SYNC_SOURCE,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('V1 CK50 reuses a checksum-verified server default from the local cache', () => {
  const fixture = createKioskMediaFixture('v1-ck50-media-server-default-');
  const defaultBytes = fs.readFileSync(fixture.environment.CHARGERENT_DEFAULT_MEDIA);
  const manifest = Buffer.from(JSON.stringify({
    stationid: 'US0118',
    items: [],
    defaultMedia: {
      url: 'https://firebasestorage.googleapis.com/v0/b/example/o/default.jpg?alt=media',
      sha256: createHash('sha256').update(defaultBytes).digest('hex'),
      contentType: 'image/jpeg',
      version: 'test-default-v1',
      size: defaultBytes.length,
    },
  }), 'utf8').toString('base64');

  const result = spawnSync('python3', ['-c', PYTHON_SYNC_SOURCE, manifest, 'US0118'], {
    encoding: 'utf8',
    env: fixture.environment,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).defaultUpdated, false);
  assert.equal(JSON.parse(result.stdout).defaultVersion, 'test-default-v1');
});

test('V1 CK50 empty assignment clears only local obsolete media and builds the default playlist', () => {
  const fixture = createKioskMediaFixture('v1-ck50-media-clear-');
  const gdrivePictureDirectory = path.join(fixture.root, 'gdrive', 'PICTURE');
  fs.mkdirSync(path.join(fixture.legacyPictureDirectory, 'nested'), { recursive: true });
  fs.mkdirSync(gdrivePictureDirectory, { recursive: true });
  fs.writeFileSync(path.join(fixture.legacyPictureDirectory, 'obsolete.jpg'), 'obsolete');
  fs.writeFileSync(path.join(fixture.legacyPictureDirectory, 'nested', 'obsolete.mp4'), 'obsolete');
  fs.writeFileSync(path.join(gdrivePictureDirectory, 'source.jpg'), 'must-remain');
  const manifest = Buffer.from(JSON.stringify({ stationid: 'US0118', items: [] }), 'utf8').toString('base64');
  const command = ['-c', PYTHON_SYNC_SOURCE, manifest, 'US0118'];

  const first = spawnSync('python3', command, { encoding: 'utf8', env: fixture.environment });
  const second = spawnSync('python3', command, { encoding: 'utf8', env: fixture.environment });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).status, 'cleared');
  assert.equal(JSON.parse(first.stdout).legacyFilesRemoved, 2);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).status, 'unchanged');
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.mediaBase, 'state.json'), 'utf8')).mode, 'cleared');
  assert.deepEqual(fs.readdirSync(fixture.legacyPictureDirectory), []);
  assert.equal(fs.readFileSync(path.join(gdrivePictureDirectory, 'source.jpg'), 'utf8'), 'must-remain');
  assert.equal(
    fs.readFileSync(path.join(fixture.mediaBase, 'default', 'playlist.m3u'), 'utf8'),
    `#EXTM3U\n${fixture.environment.CHARGERENT_DEFAULT_MEDIA}\n`,
  );
});

test('V1 CK50 cleared assignment removes managed cache and never restores legacy playback', () => {
  const fixture = createKioskMediaFixture('v1-ck50-media-clear-assigned-');
  const manifest = Buffer.from(JSON.stringify({ stationid: 'US0118', items: [] }), 'utf8').toString('base64');
  fs.mkdirSync(path.join(fixture.mediaBase, 'current'), { recursive: true });
  fs.mkdirSync(path.join(fixture.mediaBase, 'previous'), { recursive: true });
  fs.writeFileSync(path.join(fixture.mediaBase, 'current', 'assigned.jpg'), 'assigned');
  fs.writeFileSync(path.join(fixture.mediaBase, 'previous', 'previous.jpg'), 'previous');
  fs.writeFileSync(path.join(fixture.legacyPictureDirectory, 'obsolete.jpg'), 'obsolete');
  fs.writeFileSync(
    path.join(fixture.mediaBase, 'state.json'),
    JSON.stringify({ signature: 'previous-assignment', mode: 'assigned', itemCount: 1 }),
  );

  const result = spawnSync('python3', ['-c', PYTHON_SYNC_SOURCE, manifest, 'US0118'], {
    encoding: 'utf8',
    env: fixture.environment,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'cleared');
  assert.equal(JSON.parse(result.stdout).assignmentCacheRemoved, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.mediaBase, 'state.json'), 'utf8')).mode, 'cleared');
  assert.equal(fs.existsSync(path.join(fixture.mediaBase, 'current')), false);
  assert.equal(fs.existsSync(path.join(fixture.mediaBase, 'previous')), false);
  assert.deepEqual(fs.readdirSync(fixture.legacyPictureDirectory), []);
  assert.match(JSON.parse(result.stdout).playlist, /dashboard\/default\/playlist\.m3u$/);
});

test('V1 CK50 downloader verifies the default asset before deleting obsolete local media', () => {
  const fixture = createKioskMediaFixture('v1-ck50-media-default-guard-');
  const obsoleteMedia = path.join(fixture.legacyPictureDirectory, 'obsolete.jpg');
  fs.writeFileSync(obsoleteMedia, 'obsolete');
  fs.unlinkSync(fixture.environment.CHARGERENT_DEFAULT_MEDIA);
  const manifest = Buffer.from(JSON.stringify({ stationid: 'US0118', items: [] }), 'utf8').toString('base64');

  const result = spawnSync('python3', ['-c', PYTHON_SYNC_SOURCE, manifest, 'US0118'], {
    encoding: 'utf8',
    env: fixture.environment,
  });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error, 'default_media_descriptor_missing');
  assert.equal(fs.readFileSync(obsoleteMedia, 'utf8'), 'obsolete');
});

test('V1 CK50 atomic media downloader rejects a copied manifest for the wrong kiosk', () => {
  const mediaBase = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-ck50-media-identity-'));
  const manifest = Buffer.from(JSON.stringify({ stationid: 'US0118', items: [] }), 'utf8').toString('base64');
  const result = spawnSync('python3', ['-c', PYTHON_SYNC_SOURCE, manifest, 'US0100'], {
    encoding: 'utf8',
    env: { ...process.env, CHARGERENT_MEDIA_BASE: mediaBase },
  });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error, 'station_identity_mismatch');
});

test('V1 CK50 unchanged assignment returns the cached playlist needed for restart recovery', () => {
  const fixture = createKioskMediaFixture('v1-ck50-media-restart-');
  const { mediaBase } = fixture;
  const items = [{ title: 'screen.jpg', url: 'https://firebasestorage.googleapis.com/example', playTime: 37 }];
  const stableAssignment = { stationid: 'US0915', mode: 'assigned', items };
  const signatureResult = spawnSync(
    'python3',
    ['-c', 'import hashlib,json,sys; print(hashlib.sha256(json.dumps(json.loads(sys.argv[1]),sort_keys=True,separators=(",",":")).encode()).hexdigest()[:20])', JSON.stringify(stableAssignment)],
    { encoding: 'utf8' },
  );
  assert.equal(signatureResult.status, 0, signatureResult.stderr);

  fs.mkdirSync(path.join(mediaBase, 'current'), { recursive: true });
  fs.writeFileSync(path.join(mediaBase, 'current', 'playlist.m3u'), '#EXTM3U\n');
  fs.writeFileSync(
    path.join(mediaBase, 'state.json'),
    JSON.stringify({ signature: signatureResult.stdout.trim(), mode: 'assigned', itemCount: 1 }),
  );
  fs.writeFileSync(path.join(fixture.legacyPictureDirectory, 'obsolete.jpg'), 'obsolete');
  const manifest = Buffer.from(JSON.stringify({ stationid: 'US0915', items }), 'utf8').toString('base64');
  const result = spawnSync('python3', ['-c', PYTHON_SYNC_SOURCE, manifest, 'US0915'], {
    encoding: 'utf8',
    env: fixture.environment,
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'unchanged');
  assert.equal(output.mode, 'assigned');
  assert.equal(output.itemCount, 1);
  assert.equal(output.playTime, 37);
  assert.equal(output.playlist, path.join(mediaBase, 'current', 'playlist.m3u'));
  assert.equal(output.legacyFilesRemoved, 1);
  assert.deepEqual(fs.readdirSync(fixture.legacyPictureDirectory), []);
});
