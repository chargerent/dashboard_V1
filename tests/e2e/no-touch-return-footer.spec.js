import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const output='/Users/georgegazelian/Projects/LitaPower integration/output/no-touch-return-footer-20261015';
for(const progress of ['PREPARING','WAITING_FOR_INPUT'])test(`confirmed return stays visible through ${progress} and cancellation @desktop`,async({page})=>{
 await page.goto('/portal/tests/fixtures/touch-checkout.html?orientation=portrait&terms=true');
 await page.evaluate(progress=>window.touchPreview.returnWhileCollecting(progress),progress);
 const panel=page.locator('.ms-checkout-panel');
 await expect(panel).toHaveAttribute('data-checkout-phase','returned');
 await expect(panel).toHaveAttribute('data-receipt-transaction','returned-rental');
 await expect(panel.locator('.ms-return-slot')).toContainText('9');
 for(const next of ['PREPARING','WAITING_FOR_INPUT','CANCELLING']){
  await page.evaluate(next=>window.touchPreview.collectionProgress(next),next);
  await expect(panel).toHaveAttribute('data-checkout-phase','returned');
  await expect(panel).not.toContainText('Temporarily unavailable');
 }
 await page.evaluate(()=>window.touchPreview.collectionStopped());
 await expect(panel).toHaveAttribute('data-checkout-phase','returned');
});
test('a confirmed return does not cover an active payment @desktop',async({page})=>{
 await page.goto('/portal/tests/fixtures/touch-checkout.html?orientation=portrait&terms=true');
 await page.evaluate(()=>window.touchPreview.returnWhileCollecting('PROCESSING'));
 await expect(page.locator('.ms-checkout-panel')).toHaveAttribute('data-checkout-phase','authorizing');
 await page.evaluate(()=>window.touchPreview.collectionProgress('CANCELLING'));
 await expect(page.locator('.ms-checkout-panel')).toHaveAttribute('data-checkout-phase','authorizing');
});
for(const orientation of ['portrait','landscape'])for(const lang of ['en','fr','es'])test(`${orientation} ${lang} replaces the hold with one right-aligned consent line at the card bottom @desktop`,async({page})=>{
 await page.setViewportSize({width:orientation==='portrait'?1080:1280,height:orientation==='portrait'?1920:800});
 for(const height of [.15,.32]){
  await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=${orientation}&terms=true&lang=${lang}&height=${height}`);
  const panel=page.locator('.ms-checkout-panel'),footer=panel.locator('.ms-checkout-tap-footer');
  await expect(footer).toBeVisible();await expect(footer.locator('.ms-checkout-tap-hold')).toHaveCount(0);
  await expect(footer.locator('p')).toHaveCount(1);
  const fit=await footer.evaluate(node=>{
   const consent=node.querySelector('.ms-checkout-tap-consent'),card=node.parentElement.getBoundingClientRect(),box=consent.getBoundingClientRect();
   const range=document.createRange();range.selectNodeContents(consent);
   return {inset:card.right-box.right,bottom:card.bottom-box.bottom,alignment:getComputedStyle(consent).textAlign,
    lines:range.getClientRects().length,textRight:Math.max(...[...range.getClientRects()].map(r=>r.right)),right:box.right,overflow:consent.scrollWidth-consent.clientWidth};
  });
  expect(fit.inset).toBeGreaterThan(0);expect(fit.bottom).toBeGreaterThan(0);expect(fit.lines).toBe(1);
  expect(fit.bottom).toBeLessThan(45);expect(fit.alignment).toBe('right');expect(Math.abs(fit.textRight-fit.right)).toBeLessThan(1);expect(fit.overflow).toBeLessThanOrEqual(1);
  if(orientation==='portrait' && lang==='en' && height===.15){
   await fs.mkdir(output,{recursive:true});await panel.screenshot({path:`${output}/portrait-consent-only.png`});
  }
 }
});
for(const orientation of ['portrait','landscape'])for(const lang of ['en','fr','es'])test(`${orientation} ${lang} upfront payment keeps its caption before the right-aligned consent @desktop`,async({page})=>{
 await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=${orientation}&terms=true&gateway=INITIALPRICE&lang=${lang}&height=.15`);
 const footer=page.locator('.ms-checkout-tap-footer');
 await expect(footer.locator('.ms-checkout-tap-hold')).toHaveCount(0);
 await expect(footer.locator('.ms-checkout-tap-upfront')).toBeVisible();
 await expect(footer.locator('p').last()).toHaveClass('ms-checkout-tap-consent');
 const overflow=await footer.locator('p').evaluateAll(nodes=>nodes.map(node=>node.scrollWidth-node.clientWidth));
 for(const value of overflow)expect(value).toBeLessThanOrEqual(1);
});
