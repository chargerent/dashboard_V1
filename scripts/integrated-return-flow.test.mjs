import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {defaultStripeUi, stripeText, validateStripeUi} from '../src/integrated-media/stripeUi.js';
import {checkoutUsesColumns, floatingCheckoutGeometry, directTapCheckoutGeometry, checkoutScreenTimeoutMs, checkoutInactivityTimeoutMs, refreshCheckoutNotice, normalizeCheckoutReturnNotice} from '../src/integrated-media/checkoutFlow.js';

const editor = fs.readFileSync(new URL('../src/integrated-media/StripeProfileEditor.jsx', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../src/integrated-media/CheckoutPreview.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/integrated-media/media-studio.css', import.meta.url), 'utf8');

test('the dashboard uses the selected height from 15% to 50% in both orientations', () => {
  for(const [width,height] of [[1080,1920],[540,960],[1920,1080]])for(let percent=15;percent<=50;percent++){
    const geometry=floatingCheckoutGeometry(width,height,percent/100);
    assert.equal(geometry.expandedHeight,Math.round(height*percent/100));
    assert.ok(geometry.contentScale>0 && geometry.contentScale<=1);
  }
  assert.equal(floatingCheckoutGeometry(1080,1920,.10).expandedHeight,288);
});

test('no-touch panel sizing responds below 20% and scales its contents to fit',()=>{
  for(const [width,height] of [[1080,1920],[540,960],[1920,1080]])for(const stage of ['touch_ready','returned'])for(let percent=15;percent<=50;percent++){
    const geometry=directTapCheckoutGeometry(floatingCheckoutGeometry(width,height,percent/100),width,height,stage,true);
    assert.equal(geometry.expandedHeight,Math.round(height*percent/100));
    assert.ok(geometry.contentScale>0 && geometry.contentScale<=1);
  }
  const compact=directTapCheckoutGeometry(floatingCheckoutGeometry(1080,1920,.15),1080,1920,'touch_ready',true);
  assert.equal(compact.contentScale,288/392);
});

test('column choice uses the native effective panel height at the selected height', () => {
  assert.equal(checkoutUsesColumns(1080, 1920, .16), true);
  assert.equal(checkoutUsesColumns(1080, 1920, .20), true);
  assert.equal(checkoutUsesColumns(1080, 1920, .30), false);
  assert.equal(checkoutUsesColumns(1920, 1080, .30), true);
});

test('gateway instructions and decorative blank-link QR use the native localized copy', () => {
  const profile = validateStripeUi(defaultStripeUi());
  assert.equal(stripeText(profile, 'en', 'information.cardTitle'), 'Use a credit card');
  assert.equal(stripeText(profile, 'fr', 'information.scannerBody'), 'Scannez votre code-barres.');
  assert.equal(stripeText(profile, 'es', 'information.phoneTitle'), 'Valida tu número');
  assert.equal(stripeText(profile, 'en', 'mockQr'), 'Scan QR code');
});

test('return copy includes an explicit localized returned-slot line', () => {
  const profile = validateStripeUi(defaultStripeUi());
  assert.equal(stripeText(profile, 'en', 'returnSlot', {slot: 7}), 'Returned to slot 7');
  assert.equal(stripeText(profile, 'fr', 'returnSlot', {slot: 7}), 'Rendu dans le compartiment 7');
  assert.match(stripeText(profile, 'en', 'returned.body'), /return is complete/i);
});

test('older saved profiles inherit the new slot and completion copy', () => {
  const profile = defaultStripeUi();
  delete profile.locales.en.returnSlot;
  profile.locales.en['returned.body'] = 'Return confirmed. Any refund will appear after settlement is confirmed.';
  profile.locales.fr['returned.body'] = 'Texte personnalisé';
  const normalized = validateStripeUi(profile);
  assert.equal(normalized.locales.en.returnSlot, 'Returned to slot {slot}');
  assert.match(normalized.locales.en['returned.body'], /return is complete/i);
  assert.equal(normalized.locales.fr['returned.body'], 'Texte personnalisé');
});

test('published App Test v2 resolves to the same effective checkout text as the hosted app', () => {
  const published = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/app-test-v2-published-20261003.json', import.meta.url), 'utf8'));
  const effective = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/app-test-v2-effective-20261003.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateStripeUi(published.stripeUi), validateStripeUi(effective.stripeUi));
  const custom = structuredClone(published.stripeUi);
  custom.locales.en['failed.body'] = 'Ask at the front desk for help.';
  assert.equal(validateStripeUi(custom).locales.en['failed.body'], 'Ask at the front desk for help.');
});

test('the kiosk preview waits for confirmation and shares one completed-return card', () => {
  assert.match(preview, /if\(stage==='returning'\)return .*busyMessage\('returnPending'\).*button\('cancel'/);
  assert.match(preview, /button\('cancel',\(\)=>selectFlow\(\{\.\.\.IDLE_CHECKOUT_FLOW,step:'ready'\}\)/);
  assert.match(preview, /stage==='returned'.*text\('returnSlot'\)/s);
  assert.match(preview, /ms-return-receipt/);
  assert.doesNotMatch(preview, /if\(stage==='returning'\)return button\('back'/);
});

test('checkout cards omit branding and keep language in the top-right corner', () => {
  assert.doesNotMatch(preview, /ms-checkout-brand|text\('brand'\)/);
  assert.match(preview, /ms-checkout-language-corner/);
  assert.match(editor, /!\['brand','support','receipt','receipt\.title','receipt\.body','tap','insert'/);
});

test('help is QR-only on Rent Return and omitted from every other checkout page', () => {
  assert.match(preview, /const showHelpQr=!currentPage && \(directTap\?tapToRent:stage==='ready' \|\| stage==='sold_out'\) && !!helpLink/);
  assert.match(preview, /data-help-url=\{helpLink\}/);
  assert.match(preview, /text\(directTap\?'helpTermsTitle':'helpTitle'\)/);
  assert.match(preview, /text\('helpScan'\)/);
  assert.match(preview, /alt=\{`\$\{directTap\?'Help and rental terms':'Help'\} QR code for \$\{helpStationId\}`\}/);
  assert.doesNotMatch(preview, /<p[^>]*>\{text\('support'\)\}<\/p>/);
  assert.doesNotMatch(preview, /\['information','returning','returned','out_of_order'\]\.includes\(stage\)/);
  assert.match(editor, /!\['brand','support','receipt','receipt\.title','receipt\.body','tap','insert'/);
});

test('the Rent Return help QR uses the soft support card without changing actions', () => {
  assert.match(styles, /\.ms-checkout-panel\.ready \.ms-checkout-main\{display:block;padding-bottom:0/);
  assert.match(styles, /\.ms-checkout-panel\.compact[^\n]+grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,1fr\)[^\n]+gap:calc\(var\(--checkout-pixel\) \* 32\)/);
  assert.match(styles, /\.ms-checkout-panel\.compact \.ms-checkout-actions button[^\n]+height:calc\(var\(--checkout-pixel\) \* 80\)/);
  assert.match(styles, /\.ms-checkout-panel\.compact:not\(\.start\) \.ms-checkout-actions\{padding-top:0;justify-content:center\}/);
  assert.match(styles, /\.ms-checkout-panel\.ready\.compact\.help-column\{grid-template-columns:minmax\(0,\.78fr\) calc\(var\(--checkout-pixel\) \* 220\) minmax\(0,1fr\)/);
  assert.match(styles, /\.ms-checkout-panel\.ready\.compact\.help-column \.ms-checkout-help-zone \.ms-checkout-help\{position:static/);
  assert.match(preview, /\(helpInOwnColumn \|\| portraitTap\) && <div className="ms-checkout-help-zone">\{helpCard\}<\/div>/);
  assert.match(styles, /\.ms-checkout-panel\.ready \.ms-checkout-actions>button[^\n]+width:60%/);
  assert.match(styles, /background:var\(--checkout-background\);border:[^\n]+border-radius:[^\n]+box-shadow:/);
  assert.match(styles, /\.ms-checkout-panel \.ms-checkout-help-qr[^\n]+width:calc\(var\(--checkout-pixel\) \* 160\);height:calc\(var\(--checkout-pixel\) \* 160\)/);
  assert.match(preview, /ms-checkout-help-heading[^\n]+ms-checkout-help-title[^\n]+ms-checkout-help-mark/);
  assert.match(preview, /text\(directTap\?'helpTermsTitle':'helpTitle'\)\.trim\(\)\.replace\(/);
  assert.match(styles, /\.ms-checkout-panel \.ms-checkout-help-mark\{[^\n]+28\)/);
});

test('the Rent Return help QR accepts an HTTPS URL with the station variable', () => {
  const profile = defaultStripeUi();
  profile.links.help = 'https://example.com/help?station={stationId}';
  assert.equal(validateStripeUi(profile).links.help, profile.links.help);
  assert.match(editor, /label="Help QR URL"/);
  assert.match(editor, /\{stationId\}/);
  profile.links.help = 'https://example.com/help?station={unknown}';
  assert.throws(() => validateStripeUi(profile), /stationId/);
});

test('the standalone Receipt page is removed while vend and return share transaction receipt configuration', () => {
  assert.doesNotMatch(preview, /button\('receipt'|showInformation\('receipt'\)/);
  assert.match(preview, /if\(stage==='returned' \|\| stage==='succeeded'\)return .*ms-return-receipt/);
  assert.doesNotMatch(preview, /'terms','map','receipt'/);
  assert.doesNotMatch(editor, /\{key:'receipt',label:'Receipt'/);
  assert.doesNotMatch(editor, /label="Return receipt URL"|draft\.links\?\.receipt/);
  assert.match(preview, /checkoutTransactionReceipt\(vendNotice\)/);
  assert.match(preview, /checkoutVendReceipt\(interaction\)/);
  assert.match(preview, /ms-return-receipt/);
});


test('profile timeout controls ordinary screens and preserves the payment safety floor', () => {
  assert.equal(checkoutScreenTimeoutMs({}), 45000);
  for (const seconds of [10, 30, 45, 90, 120]) {
    const profile = {screenTimeoutSeconds: seconds};
    for (const phase of ['idle', 'dispensing', 'succeeded', 'failed'])
      assert.equal(checkoutInactivityTimeoutMs(profile, phase), seconds * 1000);
    for (const phase of ['awaiting_payment', 'authorizing'])
      assert.equal(checkoutInactivityTimeoutMs(profile, phase), Math.max(seconds * 1000, 45000));
  }
  for (const seconds of [0, 9, 121, '60', 30.5, NaN])
    assert.equal(checkoutScreenTimeoutMs({screenTimeoutSeconds: seconds}), 45000);
});

test('return notice display duration is profile driven while source freshness stays independent', () => {
  const now = 100000;
  const event = {eventId: 'spare-return', type: 'charger_returned', stationId: 'LOCAL-KIOSK', slot: 4,
    occurredAt: new Date(now).toISOString(), expiresAt: new Date(now + 30000).toISOString()};
  const notice = normalizeCheckoutReturnNotice(event, {now, timeoutMs: 120000});
  assert.equal(notice.noticeExpiresAt, now + 120000);
  const updated = refreshCheckoutNotice(notice, now + 15000, 45000);
  assert.equal(updated.noticeExpiresAt, now + 60000);
  assert.equal(updated.eventId, event.eventId);
  assert.equal(updated.slot, event.slot);
  assert.equal(refreshCheckoutNotice(notice, now + 120000, 45000), notice);
  assert.equal(normalizeCheckoutReturnNotice(event, {now: now + 30001, timeoutMs: 120000}), null);
});
