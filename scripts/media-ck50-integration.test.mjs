import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  patchUs0915DashboardMediaFlow,
  PYTHON_SYNC_SOURCE,
} from './patch-us0915-dashboard-media.mjs';

const mediaPageSource = fs.readFileSync(new URL('../src/pages/MediaPage.jsx', import.meta.url), 'utf8');
const functionsSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const detailPanelSource = fs.readFileSync(new URL('../src/components/kiosk/KioskDetailPanel.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

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
});

test('CK50 details mirror assigned media and keep all five modules visible with compact labels', () => {
  assert.match(detailPanelSource, /callFunctionWithAuth\('media_listAssets'/);
  assert.match(detailPanelSource, /payload\?\.v1Assignments/);
  assert.match(detailPanelSource, /data-kiosk-ck50-screen-preview="true"/);
  assert.match(detailPanelSource, /data-kiosk-ck50-modules="all"/);
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

test('US0915 flow patch adds an identity-bound atomic media sync', () => {
  const fixture = [
    { id: 'b98e8eccc9a06c06', type: 'tab', label: 'media' },
    { id: '20ac637ab4744824', type: 'exec', z: 'b98e8eccc9a06c06', name: 'run mpv' },
    { id: 'unrelated', type: 'inject', z: 'b98e8eccc9a06c06' },
  ];
  const patched = patchUs0915DashboardMediaFlow(fixture);
  const ids = new Set(patched.map((node) => node.id));

  assert.ok(ids.has('us0915_dashboard_media_poll_v1'));
  assert.ok(ids.has('us0915_dashboard_media_sync_v1'));
  assert.ok(ids.has('unrelated'));
  assert.match(
    patched.find((node) => node.id === 'us0915_dashboard_media_prepare_v1').func,
    /stationid !== TARGET_STATION_ID/,
  );
  assert.match(
    patched.find((node) => node.id === 'us0915_dashboard_media_fetch_v1').command,
    /media-v1assignment-hqnnmh3unq-uc\.a\.run\.app/,
  );
  assert.equal(patched.find((node) => node.id === 'us0915_dashboard_media_fetch_v1').type, 'exec');
  assert.match(
    patched.find((node) => node.id === 'us0915_dashboard_media_fetch_v1').command,
    /\/usr\/bin\/curl -fsS --max-time 20/,
  );
  assert.match(
    patched.find((node) => node.id === 'us0915_dashboard_media_build_v1').func,
    /JSON\.parse\(String\(msg\.payload/,
  );
  assert.match(
    patched.find((node) => node.id === 'us0915_dashboard_media_build_v1').func,
    /US0915/,
  );
  assert.deepEqual(
    patched.find((node) => node.id === 'us0915_dashboard_media_result_v1').wires[0],
    ['20ac637ab4744824'],
  );
  assert.match(
    patched.find((node) => node.id === 'us0915_dashboard_media_result_v1').func,
    /global\.set\("dashboardMediaSync", state\)/,
  );
  assert.doesNotMatch(
    patched.find((node) => node.id === 'us0915_dashboard_media_result_v1').func,
    /global\.set\("kiosk\.media\.dashboard", state\)/,
  );
  assert.deepEqual(
    patched.find((node) => node.id === 'us0915_dashboard_media_sync_v1').wires,
    [
      ['us0915_dashboard_media_result_v1'],
      ['us0915_dashboard_media_error_v1'],
      [],
    ],
  );
});

test('US0915 atomic media downloader has valid Python syntax', () => {
  const result = spawnSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "dashboard_media_sync", "exec")'], {
    input: PYTHON_SYNC_SOURCE,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
});

test('US0915 atomic media downloader leaves legacy playback untouched on initial empty assignment', () => {
  const mediaBase = fs.mkdtempSync(path.join(os.tmpdir(), 'us0915-media-clear-'));
  const manifest = Buffer.from(JSON.stringify({ stationid: 'US0915', items: [] }), 'utf8').toString('base64');
  const command = ['-c', PYTHON_SYNC_SOURCE, manifest];
  const environment = { ...process.env, CHARGERENT_MEDIA_BASE: mediaBase };

  const first = spawnSync('python3', command, { encoding: 'utf8', env: environment });
  const second = spawnSync('python3', command, { encoding: 'utf8', env: environment });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).status, 'unchanged');
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).status, 'unchanged');
  assert.equal(JSON.parse(fs.readFileSync(path.join(mediaBase, 'state.json'), 'utf8')).mode, 'cleared');
});

test('US0915 atomic media downloader restores legacy playback after a dashboard assignment is cleared', () => {
  const mediaBase = fs.mkdtempSync(path.join(os.tmpdir(), 'us0915-media-clear-assigned-'));
  const manifest = Buffer.from(JSON.stringify({ stationid: 'US0915', items: [] }), 'utf8').toString('base64');
  fs.writeFileSync(
    path.join(mediaBase, 'state.json'),
    JSON.stringify({ signature: 'previous-assignment', mode: 'assigned', itemCount: 1 }),
  );

  const result = spawnSync('python3', ['-c', PYTHON_SYNC_SOURCE, manifest], {
    encoding: 'utf8',
    env: { ...process.env, CHARGERENT_MEDIA_BASE: mediaBase },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'cleared');
  assert.equal(JSON.parse(fs.readFileSync(path.join(mediaBase, 'state.json'), 'utf8')).mode, 'cleared');
});
