import {expect,test} from '@playwright/test';
import process from 'node:process';
test('@desktop owner background and station preview follow all three assigned brands',async ({page})=>{
 await page.setViewportSize({width:1440,height:1800});
 await page.goto('/portal/tests/fixtures/owner-background.html');
 const home=page.getByTestId('owner-home');
 for(const [brand,label,website] of [['chargedrops','ChargeDrops','chargedrops.com'],['eventcharging','Event Charging','eventcharging.com'],['chargerent','Chargerent','charge.rent']]) {
  await page.getByRole('combobox',{name:'Owner',exact:true}).selectOption(brand);
  await expect(home.getByRole('img',{name:`${label} station background`,exact:true})).toBeVisible();
  await expect(home.getByText(website,{exact:true})).toBeVisible();
  await expect(home.locator('img')).toHaveJSProperty('naturalWidth',1200);
  const bounds=await home.boundingBox(),logo=await home.locator('img').boundingBox();
  expect(logo.x).toBeGreaterThan(bounds.x);expect(logo.x+logo.width).toBeLessThan(bounds.x+bounds.width);
  expect(logo.y).toBeGreaterThan(bounds.y);expect(logo.y+logo.height).toBeLessThan(bounds.y+bounds.height);
  if(process.env.OWNER_BACKGROUND_REVIEW_DIR)await home.screenshot({path:`${process.env.OWNER_BACKGROUND_REVIEW_DIR}/${brand}-background.png`});
 }
 const station=page.getByRole('combobox',{name:'Preview kiosk',exact:true});
 for(const [id,label] of [['US8001','ChargeDrops'],['US6000','Event Charging'],['FR8011','Chargerent']]) {
  await station.selectOption(id);
  await expect(page.getByTestId('stripe-preview-media').getByRole('img',{name:`${label} station background`,exact:true})).toBeVisible();
 }
});
