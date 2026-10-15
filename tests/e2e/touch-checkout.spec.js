import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const output='/Users/georgegazelian/Projects/LitaPower integration/output/ck4048-ui-20261014/browser';
test.beforeEach(async({page})=>{await page.emulateMedia({reducedMotion:'reduce'});});
for(const overdue of [1,30])test(`Event Simple overdue ${overdue} controls the not-returned wording @desktop`,async({page})=>{
 await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=portrait&terms=true&overdue=${overdue}`);
 const prices=page.locator('.ms-checkout-pricing>span');
 await expect(prices).toHaveCount(2);
 await expect(prices.first()).toHaveText('Free if returned by end of day.');
 await expect(prices.last()).toHaveText(overdue===1?'$1 if not returned by end of day.':'$1 if not returned after 30 days.');
});
for(const lang of ['en','fr','es'])test(`CK40/CK48 portrait keeps 15-percent non-touch cards readable and limits help QR to tap-to-rent in ${lang} @desktop`,async({page})=>{
 await page.setViewportSize({width:1080,height:1920});
 await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=portrait&terms=true&height=.15&lang=${lang}`);
 const panel=page.getByRole('region',{name:'Floating payment card'});
 await expect(panel).toHaveAttribute('data-checkout-phase','touch_ready');
 await expect(panel.locator('.ms-checkout-help-qr')).toBeVisible();
 expect((await panel.locator('.ms-checkout-help-qr').boundingBox()).width).toBeCloseTo(112*288/392,1);
 const heading=await panel.locator('.ms-checkout-tap-heading').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);return {lines:range.getClientRects().length,width:node.clientWidth,content:node.scrollWidth};});
 expect(heading.lines).toBe(1);expect(heading.content).toBeLessThanOrEqual(heading.width);
 await expect(panel.locator('.ms-checkout-pricing>span')).toHaveCount(2);
 await expect(panel.locator('.ms-checkout-pricing')).not.toContainText('24-hour');
 await expect(panel.locator('.ms-checkout-pricing')).not.toContainText('{eventCharge}');
 await expect(panel.locator('.ms-checkout-pricing>span').last()).toContainText('1');
 expect((await panel.boundingBox()).height).toBe(288);
 const verifyFits=async()=>{
  const dimensions=await panel.evaluate(node=>[...node.querySelectorAll('.ms-checkout-main,.ms-checkout-actions')].map(el=>({height:el.clientHeight,content:el.scrollHeight})));
  for(const size of dimensions)expect(size.content).toBeLessThanOrEqual(size.height+1);
 };
 const verifyReceiptAlignment=async()=>{
  const alignment=await panel.locator('.ms-return-receipt').evaluate(row=>{
   const qr=row.querySelector('img').getBoundingClientRect(),caption=row.querySelector('p'),range=document.createRange();
   range.selectNodeContents(caption);
   return {qrCenter:qr.x+qr.width/2,qrBottom:qr.bottom,captionTop:caption.getBoundingClientRect().top,textCenters:[...range.getClientRects()].map(rect=>rect.x+rect.width/2)};
  });
  for(const center of alignment.textCenters)expect(Math.abs(center-alignment.qrCenter)).toBeLessThanOrEqual(1);
  expect(alignment.captionTop).toBeGreaterThan(alignment.qrBottom);
 };
 await verifyFits();
 await page.screenshot({path:`${output}/ck4048-${lang}-tap-to-rent.png`});
 for(const phase of ['authorizing','dispensing','succeeded','failed']){
  await page.evaluate(phase=>window.touchPreview.phase(phase),phase);
  await expect(panel).toHaveAttribute('data-checkout-phase',phase);
  await expect(panel.locator('.ms-checkout-help')).toHaveCount(0);
  expect((await panel.boundingBox()).height).toBe(288);
  await verifyFits();
  if(phase==='succeeded'){await expect(panel.locator('.ms-return-receipt img')).toBeVisible();await verifyReceiptAlignment();}
  await page.screenshot({path:`${output}/ck4048-${lang}-${phase}.png`});
 }
 await page.evaluate(()=>{window.touchPreview.phase('idle');window.touchPreview.soldOut();});
 await expect(panel).toHaveAttribute('data-checkout-phase','sold_out');
 await expect(panel.locator('.ms-checkout-help')).toHaveCount(0);
 expect((await panel.boundingBox()).height).toBe(288);
 await verifyFits();
 await page.evaluate(()=>window.touchPreview.returned());
 await expect(panel).toHaveAttribute('data-checkout-phase','returned');
 await expect(panel.locator('.ms-checkout-help,.ms-checkout-return-instruction,.ms-checkout-vend-return')).toHaveCount(0);
 await expect(panel.locator('.ms-return-receipt img')).toBeVisible();
 await verifyReceiptAlignment();
 expect((await panel.boundingBox()).height).toBe(288);
 await verifyFits();
 await page.screenshot({path:`${output}/ck4048-${lang}-returned.png`});
});
test('Touch off displays a direct tap screen with help QR, return instructions and automatic sold-out recovery @desktop',async({page})=>{
 await page.goto('/portal/tests/fixtures/touch-checkout.html');
 const panel=page.getByRole('region',{name:'Floating payment card'});
 await expect(page.getByText('Tap your card on the reader below to borrow.',{exact:true})).toBeVisible();
 await expect(page.getByAltText('Help and rental terms QR code for US6000')).toBeVisible();
 await expect(page.getByText('Help & terms',{exact:true})).toBeVisible();
 await expect(panel.locator('img')).toHaveCount(1);
 await expect(page.getByText('Return your charger to any available slot.',{exact:false})).toBeVisible();
 await expect(panel.getByRole('button')).toHaveCount(0);
 const link=await page.locator('[data-help-url]').getAttribute('data-help-url');
 expect(link).toContain('US6000');
 await panel.screenshot({path:`${output}/tap-ready.png`});
 await page.evaluate(()=>window.touchPreview.soldOut());
 await expect(page.getByText('Sold out',{exact:true})).toBeVisible();
 await expect(page.getByText('Tap your card on the reader below to borrow.',{exact:true})).toHaveCount(0);
 await expect(panel.getByRole('button')).toHaveCount(0);
 await expect(page.getByAltText('Help and rental terms QR code for US6000')).toHaveCount(0);
 await panel.screenshot({path:`${output}/sold-out.png`});
 await page.evaluate(()=>window.touchPreview.unknown());
 await expect(page.getByText('Temporarily unavailable',{exact:true})).toBeVisible();
 await expect(page.getByText('Sold out',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.touchPreview.refill());
 await expect(page.getByText('Tap your card on the reader below to borrow.',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.touchPreview.returned());
 await expect(page.getByText('Charger returned · Thank you',{exact:true})).toBeVisible();
 await expect(page.getByText('Slot 9',{exact:false})).toBeVisible();
 await expect(page.getByAltText('Help and rental terms QR code for US6000')).toHaveCount(0);
 await expect(panel.locator('.ms-checkout-return-instruction')).toHaveCount(0);
 await expect(panel.getByRole('button')).toHaveCount(0);
 await expect(page.getByAltText('Scan for your receipt')).toBeVisible();
 await panel.screenshot({path:`${output}/returned.png`});
});
for(const orientation of ['landscape','portrait'])test(`Touch off keeps prices, a combined QR and bold return instructions visible in ${orientation} @desktop`,async({page})=>{
 await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=${orientation}&terms=true`);
 const panel=page.getByRole('region',{name:'Floating payment card'});
 await expect(page.getByAltText('Help and rental terms QR code for US6000')).toBeVisible();
 await expect(panel.locator('img')).toHaveCount(1);
 await expect(page.getByAltText('Rental terms',{exact:true})).toHaveCount(0);
 await expect(page.getByText('By tapping your card, you agree to the rental terms.',{exact:true})).toBeVisible();
 await expect(page.getByText('I accept the $1.00 temporary card authorization',{exact:false})).toHaveCount(0);
 const returnInstruction=panel.locator('.ms-checkout-return-instruction');
 const sizes=await returnInstruction.evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),weight:Number(getComputedStyle(el).fontWeight),consentSize:parseFloat(getComputedStyle(el.closest('section').querySelector('.ms-checkout-tap-consent')).fontSize)}));
 expect(sizes.weight).toBeGreaterThanOrEqual(500);expect(sizes.size).toBeGreaterThan(sizes.consentSize);
 const qrUrl=new URL(await page.locator('[data-help-url]').getAttribute('data-help-url'));
 expect(qrUrl.pathname).toBe('/terms/help-and-terms.html');expect(qrUrl.searchParams.get('station')).toBe('US6000');expect(qrUrl.searchParams.get('plan')).toBe('EVENT_SIMPLE');
 await expect(panel.locator('.ms-checkout-pricing')).toContainText('Free if returned by end of day');
 await expect(panel).not.toContainText('first 24 hours');
 await expect(panel.locator('.ms-checkout-pricing')).not.toContainText('temporary card hold');
 await expect(panel.locator('.ms-checkout-tap-hold')).toHaveCount(0);
 await expect(panel.locator('.ms-checkout-help-mark')).toHaveCount(0);
 const free=panel.locator('.ms-checkout-free-day');
 await expect(free).toHaveText('Free if returned by end of day.');
 const freeStyle=await free.evaluate(el=>({size:parseFloat(getComputedStyle(el.querySelector("strong") || el).fontSize),weight:Number(getComputedStyle(el.querySelector("strong") || el).fontWeight),otherSize:parseFloat(getComputedStyle(el.nextElementSibling).fontSize)}));
 expect(freeStyle.weight).toBeGreaterThanOrEqual(500);expect(freeStyle.size).toBeGreaterThan(freeStyle.otherSize);
 const footer=await panel.locator('.ms-checkout-tap-footer').boundingBox(),card=await panel.boundingBox();
 expect(card.y+card.height-footer.y-footer.height).toBeLessThan(50);
 expect(orientation==='portrait'?footer.x-card.x:card.x+card.width-footer.x-footer.width).toBeLessThan(50);
 const pricing=await panel.locator('.ms-checkout-pricing').boundingBox();
 const help=await panel.locator('.ms-checkout-help').boundingBox();
 const paymentTerms=await panel.locator(orientation==='portrait'?'.ms-checkout-main':'.ms-checkout-actions').boundingBox();
 if(orientation==='portrait'){expect(help.x).toBeGreaterThanOrEqual(paymentTerms.x+paymentTerms.width);expect(help.y).toBeGreaterThan(pricing.y);}
 else{expect(help.x).toBeLessThan(paymentTerms.x);expect(help.y).toBeGreaterThanOrEqual(pricing.y+pricing.height);}
 await expect(panel.getByRole('button')).toHaveCount(0);
 const dimensions=await panel.evaluate(node=>[...node.querySelectorAll('.ms-checkout-main,.ms-checkout-actions')].map(el=>({height:el.clientHeight,content:el.scrollHeight})));
 for(const size of dimensions)expect(size.content).toBeLessThanOrEqual(size.height+1);
 await panel.screenshot({path:`${output}/tap-ready-${orientation}.png`});
});

test('Event Simple uses borrow wording with Touch on @desktop',async({page})=>{
 await page.goto('/portal/tests/fixtures/touch-checkout.html?terms=true');
 await page.evaluate(()=>window.touchPreview.touchOn());
 await expect(page.getByText('Tap your card to borrow.',{exact:true})).toBeVisible();
 const panel=page.getByRole('region',{name:'Floating payment card'});
 await expect(panel.locator('.ms-checkout-main>.ms-checkout-body')).toHaveCount(0);
});

test('The combined QR landing page offers station-tagged support and matching terms @desktop',async({page})=>{
 const html=await fs.readFile('/Users/georgegazelian/Documents/ChatGPT/Chargerent Media app/deploy/terms/help-and-terms.html','utf8');
 await page.route('https://chargerentstations.com/terms/help-and-terms.html**',route=>route.fulfill({contentType:'text/html',body:html}));
 for(const [lang,label,pdf] of [['en','Rental terms','english'],['fr','Conditions de location','french'],['es','Condiciones de alquiler','spanish']]){
  await page.goto(`https://chargerentstations.com/terms/help-and-terms.html?station=US6000&plan=EVENT_SIMPLE&lang=${lang}`);
  await expect(page.locator('#station')).toContainText('US6000');
  await expect(page.locator('#support')).toHaveAttribute('href','sms:+18189969991?body=I%20need%20help!%20US6000');
  await expect(page.getByRole('link',{name:label,exact:true})).toHaveAttribute('href',`/terms/event-simple/terms-${pdf}-EVENT-SIMPLE.pdf`);
 }
 await page.goto('https://chargerentstations.com/terms/help-and-terms.html?station=US6000&plan=UNKNOWN&help=javascript:alert(1)');
 await expect(page.locator('#terms')).toBeHidden();
 await expect(page.locator('#unavailable')).toBeVisible();
 await expect(page.locator('#support')).toHaveAttribute('href','sms:+18189969991?body=I%20need%20help!%20US6000');
});
test('Touch saves per station, defaults on and remains on for no-card mode @desktop',async({page})=>{
 await page.goto('/portal/tests/fixtures/stripe-offline-pricing.html');
 await page.getByText('Pricing',{exact:true}).click();
 const toggle=page.getByRole('checkbox',{name:'Touch',exact:true});
 await expect(toggle).toBeChecked();
 await page.locator('label[for="touch"]').click();
 await page.getByRole('button',{name:'Save Pricing',exact:true}).click();
 expect((await page.evaluate(()=>window.savedPricing.pricing)).touch).toBe(false);
 await expect(toggle).not.toBeChecked();
 await page.locator('label[for="offline"]').click();
 await expect(toggle).toBeChecked();await expect(toggle).toBeDisabled();
 await page.getByRole('button',{name:'Save Pricing',exact:true}).click();
 expect((await page.evaluate(()=>window.savedPricing.pricing)).touch).toBe(true);
});
