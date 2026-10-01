import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {defaultStripeUi, stripeText, validateStripeUi} from '../src/integrated-media/stripeUi.js';

const editor = fs.readFileSync(new URL('../src/integrated-media/StripeProfileEditor.jsx', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../src/integrated-media/CheckoutPreview.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/integrated-media/media-studio.css', import.meta.url), 'utf8');

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

test('the editor merges instructions and completion into one Return section', () => {
  assert.match(editor, /\{key:'returning',label:'Return'\}/);
  assert.doesNotMatch(editor, /\{key:'returned',label:'Return complete'\}/);
  assert.match(editor, /aria-label="Return preview state"/);
  assert.match(editor, /\['returning','Instructions'\],\['returned','Return complete'\]/);
});

test('the kiosk preview waits for confirmation and shares one completed-return card', () => {
  assert.match(preview, /if\(stage==='returning'\)return busyMessage\('returnPending'\)/);
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
  assert.match(preview, /const showHelpQr=!currentPage && stage==='ready' && !!helpLink/);
  assert.match(preview, /data-help-url=\{helpLink\}/);
  assert.match(preview, /text\('helpTitle'\)/);
  assert.match(preview, /text\('helpScan'\)/);
  assert.match(preview, /alt=\{`Help QR code for \$\{helpStationId\}`\}/);
  assert.doesNotMatch(preview, /<p[^>]*>\{text\('support'\)\}<\/p>/);
  assert.doesNotMatch(preview, /\['information','returning','returned','out_of_order'\]\.includes\(stage\)/);
  assert.match(editor, /!\['brand','support','receipt','receipt\.title','receipt\.body','tap','insert'/);
});

test('the Rent Return help QR stays beside the copy without a white frame', () => {
  assert.match(styles, /\.ms-checkout-panel\.ready \.ms-checkout-main\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(styles, /\.ms-checkout-panel \.ms-checkout-help\{grid-column:2;grid-row:1\/span 10;align-self:center/);
  assert.match(styles, /background:transparent;border:0;border-radius:0;box-shadow:none/);
  assert.match(styles, /width:calc\(var\(--checkout-pixel\) \* 112\);height:calc\(var\(--checkout-pixel\) \* 112\)/);
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

test('the standalone Receipt page is removed but Return Complete keeps receipt configuration', () => {
  assert.doesNotMatch(preview, /button\('receipt'|showInformation\('receipt'\)/);
  assert.match(preview, /if\(stage==='succeeded'\)return button\('done'/);
  assert.doesNotMatch(preview, /'terms','map','receipt'/);
  assert.doesNotMatch(editor, /\{key:'receipt',label:'Receipt'/);
  assert.match(editor, /label="Return receipt URL"/);
  assert.match(editor, /draft\.links\?\.receipt/);
  assert.match(preview, /ms-return-receipt/);
});
