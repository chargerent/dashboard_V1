import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultReceiptPage,normalizeReceiptPage,RECEIPT_PAGE_FIELDS} from './receiptPageProfile.mjs';
import {renderReceiptPage} from './receiptPage.mjs';
import {normalizeChargerentAppProfile,defaultChargerentAppProfile,chargerentAppProfileForService} from '../src/utils/chargerentAppProfile.js';

test('receipt text and logo save separately from native checkout and use the client languages',()=>{
  const app=defaultChargerentAppProfile(),before=structuredClone(app.stripeUi);
  app.receiptPage.locales.en.returnedTitle='Thanks for charging with us';
  app.receiptPage.locales.fr.returnedTitle='Merci de votre visite';
  app.receiptPage.logo={url:'https://example.com/client.png',contentType:'image/png'};
  app.stripeUi.defaultLanguage='fr';
  const normalized=normalizeChargerentAppProfile(app);
  assert.equal(normalized.receiptPage.defaultLanguage,'fr');
  assert.equal(normalized.receiptPage.locales.fr.returnedTitle,'Merci de votre visite');
  assert.equal(normalized.receiptPage.logo.url,app.receiptPage.logo.url);
  assert.deepEqual(normalized.stripeUi,{...before,defaultLanguage:'fr'});
  assert.equal(Object.hasOwn(normalized.stripeUi,'receiptPage'),false);
  assert.equal(RECEIPT_PAGE_FIELDS.length,Object.keys(normalized.receiptPage.locales.en).length);
});

test('receipt presentation cannot configure amounts, scripts, unsafe logos or unknown fields',()=>{
  for(const patch of [{amountCents:0},{locales:{en:{finalChargeCents:'0'}}},{logo:{url:'javascript:alert(1)',contentType:'image/png'}},
    {logo:{url:'https://example.com/a.svg',contentType:'image/svg+xml'}},{logo:{url:'https://user:password@example.com/a.png',contentType:'image/png'}},
    {locales:{en:{returnedTitle:'x'.repeat(2001)}}},{enabledLanguages:['en','en']}]) {
    assert.throws(()=>normalizeReceiptPage({...defaultReceiptPage(),...patch}));
  }
  const page=defaultReceiptPage();page.logo=null;
  assert.equal(normalizeReceiptPage(page).logo,null);
  assert.equal(Object.hasOwn(normalizeReceiptPage(defaultReceiptPage()),'logo'),false,'no configured logo inherits the existing client logo');
});

test('the receipt renderer escapes client copy in both HTML and script contexts',()=>{
  const page=defaultReceiptPage();page.locales.en.pageTitle='</title><script>window.compromised=true</script>';
  page.locales.en.returnedTitle='</script><img src=x onerror=alert(1)>';
  const html=renderReceiptPage({transactionId:'tx-one',apiUrl:'/api/receipts/tx-one?key=id.signature',page});
  assert.equal((html.match(/<script>/g)||[]).length,1);
  assert.match(html,/&lt;\/title&gt;/);assert.match(html,/\\u003c\/script>/);
  assert.doesNotMatch(html,/<img src=x/);
});

test('the dashboard and media host share the same receipt renderer and field contract',async()=>{
  const host='/Users/georgegazelian/Documents/ChatGPT/Chargerent Media app/lab/';
  for(const name of ['receiptPageProfile.mjs','receiptPage.mjs']) assert.equal(await readFile(new URL(name,import.meta.url),'utf8'),await readFile(host+name,'utf8'));
});

test('ordinary checkout saves omit untouched receipt defaults for older profile services',()=>{
  const app=defaultChargerentAppProfile(),before=structuredClone(app);
  app.checkout.height=.16;app.stripeUi.locales.en['succeeded.title']='Take your charger from slot {slot}';
  const saved={checkout:before.checkout,stripeUi:before.stripeUi};
  const compatible=chargerentAppProfileForService(app,saved,{});
  assert.deepEqual(Object.keys(compatible),['checkout','stripeUi']);
  assert.equal(compatible.checkout.height,.16);
  assert.equal(compatible.stripeUi.locales.en['succeeded.title'],app.stripeUi.locales.en['succeeded.title']);
  assert.ok(app.receiptPage,'the local receipt draft must remain intact');
  const supported=chargerentAppProfileForService(app,saved,{receiptPages:1});
  assert.deepEqual(supported.receiptPage,app.receiptPage);
});

test('older services never silently discard edited, uploaded or previously saved receipt settings',()=>{
  const app=defaultChargerentAppProfile(),saved=structuredClone(app);
  delete saved.receiptPage;
  app.receiptPage.locales.en.returnedTitle='Edited receipt';
  assert.throws(()=>chargerentAppProfileForService(app,saved,{}),/draft is kept/);
  app.receiptPage=defaultReceiptPage();
  assert.throws(()=>chargerentAppProfileForService(app,saved,{}, {hasReceiptLogoFile:true}),/updated profile service/);
  assert.throws(()=>chargerentAppProfileForService(app,defaultChargerentAppProfile(),{}),/updated profile service/);
});
