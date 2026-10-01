import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/ChargerentMediaPage.jsx', import.meta.url), 'utf8');
const wizard = await readFile(new URL('../src/components/media/MediaCampaignWizard.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/media/media-campaign-wizard.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/pages/AdminPage.jsx', import.meta.url), 'utf8');

test('new app media page uses the campaign wizard rather than the shared media editor', () => {
  assert.match(page, /import MediaCampaignWizard/);
  assert.match(page, /<MediaCampaignWizard kiosks=\{visibleStations\}/);
  assert.doesNotMatch(page, /IntegratedKioskApps|Apps & enrollment/);
  assert.doesNotMatch(page, /<MediaStudio/);
  assert.doesNotMatch(page, /<StripeProfileEditor/);
  assert.match(page, /Open Client Profiles → Chargerent app/);
});

test('wizard preserves the requested five-step order and sliding left column', () => {
  for (const label of ['Name campaign', 'Choose layout', 'Images or video', 'Add media', 'Pick kiosks']) {
    assert.match(wizard, new RegExp(label));
  }
  assert.match(wizard, /translateX\(-\$\{step \* 100\}%\)/);
  assert.match(css, /\.cmw-workspace\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:/);
  assert.match(css, /\.cmw-preview-panel\s*\{[\s\S]*position:\s*relative;[\s\S]*display:\s*flex/);
  assert.match(css, /\.cmw-progress button\s*\{[\s\S]*flex-direction:\s*column;/);
  assert.match(css, /left:\s*calc\(50% \+ 17px\);[\s\S]*right:\s*calc\(-50% \+ 17px\);/);
});

test('layout step offers full page or an 80/20 instruction split and gates it behind checkout', () => {
  assert.match(wizard, /label: 'Full page'/);
  assert.match(wizard, /label: 'Top \+ instructions'/);
  assert.match(wizard, /height: 0\.8/);
  assert.match(wizard, /y: 0\.8, width: 1, height: 0\.2/);
  assert.doesNotMatch(wizard, /label: 'Side by side'|label: 'Four sections'/);
  assert.match(wizard, /role="switch"/);
  assert.match(wizard, /disabled=\{checkoutEnabled && id === 'stack'\}/);
  assert.match(wizard, /if \(enabled\) setLayoutId\('full'\)/);
  assert.match(wizard, /checkout: \{ enabled: checkoutEnabled, height: 0\.16 \}/);
  assert.match(wizard, /checkoutEnabled && <div className="cmw-checkout-preview">/);
  assert.match(css, /\.cmw-layout-mini\.stack\s*\{[\s\S]*grid-template-rows:\s*4fr 1fr/);
  assert.match(css, /\.cmw-layout-grid > button:disabled[\s\S]*filter:\s*grayscale\(1\)/);
});

test('media step supports library drag/drop and an upload action in every preview section', () => {
  assert.match(wizard, /application\/x-chargerent-media/);
  assert.match(wizard, /data-preview-zone=\{zone\.id\}/);
  assert.match(wizard, /onDropAsset\(zone\.id, assetId\)/);
  assert.match(wizard, /onUpload\(zone\.id/);
  assert.match(wizard, /Drop media here/);
});

test('publish targets selected integrated kiosk apps through campaign assignments', () => {
  assert.match(wizard, /filter\(\(device\) => isIntegratedKiosk\(device\) && device\.stationId\)/);
  assert.match(wizard, /api\('\/campaigns\/publish'/);
  assert.match(wizard, /stationIds: selectedKiosks/);
  assert.match(wizard, /Phones and Besiter players are excluded/);
});

test('published campaign polls exact-revision delivery status and renders station pills', () => {
  assert.match(wizard, /api\('\/campaigns'\)/);
  assert.match(wizard, /const latest = Array\.isArray\(campaigns\?\.campaigns\) \? campaigns\.campaigns\[0\] : null/);
  assert.match(wizard, /campaigns\/\$\{published\.id\}\/status/);
  assert.match(wizard, /setInterval\(refresh, 5000\)/);
  assert.match(wizard, /data-campaign-status=\{delivery\?\.state \|\| 'not-published'\}/);
  for (const state of ['waiting', 'downloading', 'downloaded', 'playing', 'offline', 'error']) {
    assert.match(css, new RegExp(`is-${state}`));
  }
});

test('campaign inventory requests only integrated kiosk devices', () => {
  assert.match(wizard, /phoneControl_listDevices', \{ deviceKind: 'integrated_kiosk' \}/);
});

test('campaign manager is separately gated to admins or explicitly permitted partners', () => {
  assert.match(app, /isPartnerAccount && clientInfo\.features\?\.campaign_manager === true/);
  assert.match(app, /allowLegacyMedia=\{hasMediaAccess\}/);
  assert.match(app, /allowCampaignManager=\{hasCampaignManagerAccess\}/);
  assert.match(page, /allowLegacyMedia && \(/);
  assert.match(admin, /'campaign_manager'/);
});
