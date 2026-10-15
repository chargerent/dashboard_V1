import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';

test('Out of order edits the shared return message and previews help in both interaction modes @desktop',async({page})=>{
  await page.goto('/portal/tests/fixtures/ui-editor-variants.html');
  await page.getByRole('navigation',{name:'Stripe text sections'}).getByRole('button',{name:'Out of order',exact:true}).click();
  const panel=page.getByTestId('stripe-device-preview').locator('.ms-checkout-panel');
  await expect(panel).toHaveAttribute('data-checkout-phase','out_of_order');
  await page.getByLabel('Stripe Return message',{exact:true}).fill('Returns remain available. Insert your charger into an empty slot.');
  await expect(panel).toContainText('Returns remain available.');
  expect(await page.evaluate(()=>window.editorDraft.locales.en.returnAnySlot)).toContain('Returns remain available.');
  for(const mode of ['noTouch','touch'])for(const orientation of ['portrait','landscape']){
    await page.getByLabel('Preview interaction mode').selectOption(mode);
    await page.getByLabel('Preview screen orientation').selectOption(orientation);
    await expect(panel).toContainText('Returns remain available.');
    await expect(panel.locator('.ms-checkout-help-qr')).toBeVisible();
    await expect(panel.getByRole('button',{name:/Rent|Continue|Start/})).toHaveCount(0);
  }
});

for(const touch of [false,true])for(const orientation of ['portrait','landscape'])test(`${orientation} ${touch?'touch':'no-touch'} outage keeps return and help clear at low panel heights @desktop`,async({page})=>{
  await page.setViewportSize({width:orientation==='portrait'?1080:1280,height:orientation==='portrait'?1920:800});
  for(const lang of ['en','fr','es'])for(const height of [.15,.32]){
    await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=${orientation}&touch=${touch}&terms=true&lang=${lang}&height=${height}`);
    await page.evaluate(()=>window.touchPreview.unknown());
    const panel=page.locator('.ms-checkout-panel');
    await expect(panel).toHaveAttribute('data-checkout-phase','out_of_order');
    await expect(panel.locator('.ms-checkout-return-instruction')).toBeVisible();
    await expect(panel.locator('.ms-checkout-return-guidance>.ms-checkout-return-icon')).toBeVisible();
    await expect(panel.locator('.ms-checkout-help-qr')).toBeVisible();
    await expect(panel.locator('.ms-checkout-tap-footer')).toHaveCount(0);
    const measure=()=>panel.evaluate(card=>{
      const bounds=card.getBoundingClientRect(),qr=card.querySelector('.ms-checkout-help').getBoundingClientRect();
      const message=card.querySelector('.ms-checkout-return-instruction').getBoundingClientRect();
      return {bounds:{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom},qr:{left:qr.left,right:qr.right,top:qr.top,bottom:qr.bottom},inside:qr.left>=bounds.left-1 && qr.right<=bounds.right+1 && qr.top>=bounds.top-1 && qr.bottom<=bounds.bottom+1,
        overlap:qr.left<message.right && qr.right>message.left && qr.top<message.bottom && qr.bottom>message.top};
    });
    await expect.poll(async()=>{const fit=await measure();return fit.inside && !fit.overlap;}).toBe(true);
    const fit=await measure();
    expect(fit.overlap,JSON.stringify({fit,lang,height})).toBe(false);
    if(!touch && lang==='en' && height===.15){
      await fs.mkdir('output/out-of-order-return-help',{recursive:true});
      await panel.screenshot({path:`output/out-of-order-return-help/${orientation}.png`});
    }
    await page.evaluate(()=>window.touchPreview.returned());
    await expect(panel).toHaveAttribute('data-checkout-phase','returned');
    await expect(panel.locator('.ms-return-slot')).toContainText('9');
  }
});

for(const orientation of ['portrait','landscape'])test(`${orientation} return icons sit beside their messages and QR backgrounds have rounded corners @desktop`,async({page})=>{
  await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=${orientation}&terms=true&height=.15`);
  const panel=page.locator('.ms-checkout-panel');
  for(const stage of ['touch_ready','sold_out','out_of_order','succeeded']){
    if(stage==='sold_out')await page.evaluate(()=>window.touchPreview.soldOut());
    if(stage==='out_of_order')await page.evaluate(()=>window.touchPreview.unknown());
    if(stage==='succeeded')await page.evaluate(()=>window.touchPreview.phase('succeeded'));
    await expect(panel).toHaveAttribute('data-checkout-phase',stage);
    const row=panel.locator('.ms-checkout-return-guidance');
    await expect(row.locator('.ms-checkout-return-icon')).toBeVisible();
    const inline=await row.evaluate(node=>{
      const icon=node.querySelector('svg').getBoundingClientRect(),copy=node.querySelector('.ms-checkout-return-instruction').getBoundingClientRect();
      return icon.right<=copy.left+1 && Math.abs(icon.top-copy.top)<2;
    });
    expect(inline).toBe(true);
    const qr=panel.locator(stage==='succeeded'?'.ms-return-qr-preview':'.ms-checkout-help-qr');
    if(await qr.count()){
      const style=await qr.evaluate(node=>{const s=getComputedStyle(node);return {radius:parseFloat(s.borderTopLeftRadius),padding:parseFloat(s.paddingTop),background:s.backgroundColor};});
      expect(style.radius).toBeGreaterThan(0);expect(style.padding).toBeGreaterThan(0);expect(style.background).toBe('rgb(255, 255, 255)');
    }
  }
});

test('Rent Return help aligns with the content row and clears the consent footer @desktop',async({page})=>{
  await page.setViewportSize({width:1080,height:1920});
  for(const lang of ['en','fr','es']){
    await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=portrait&terms=true&lang=${lang}&height=.15`);
    const panel=page.locator('.ms-checkout-panel');
    await expect(panel.locator('.ms-checkout-help-qr')).toBeVisible();
    const fit=await panel.evaluate(card=>{
      const help=card.querySelector('.ms-checkout-help').getBoundingClientRect();
      const main=card.querySelector('.ms-checkout-main').getBoundingClientRect();
      const footer=card.querySelector('.ms-checkout-tap-footer').getBoundingClientRect();
      return {offset:help.top-main.top,gap:footer.top-help.bottom};
    });
    expect(Math.abs(fit.offset)).toBeLessThan(1);expect(fit.gap).toBeGreaterThan(5);
  }
});
