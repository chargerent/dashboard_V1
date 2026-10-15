import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
test('Card opacity slider changes only the card background and retains its value @desktop',async({page})=>{
 await page.goto('/portal/tests/fixtures/checkout-preview-harness.html');
 const slider=page.getByRole('slider',{name:'Card opacity',exact:true});
 await expect(slider).toHaveValue('92');
 const change=async(value)=>{
  await slider.fill(String(value));
  await expect(page.getByLabel('Selected card opacity',{exact:true})).toHaveText(`${value}%`);
  const style=await page.locator('.ms-checkout-panel').first().evaluate(node=>({background:getComputedStyle(node).backgroundColor,opacity:getComputedStyle(node).opacity}));
  expect(style.opacity).toBe('1');
  if(value===0)expect(style.background).toMatch(/(?:, 0\)|\/ 0\))/);
  else if(value===100)expect(style.background).not.toMatch(/(?:, 0\)|\/ 0\))/);
  else expect(style.background).toContain(String(value/100));
 };
 for(const value of [65,0,100,92])await change(value);
 await fs.mkdir('/Users/georgegazelian/Projects/LitaPower integration/output/checkout-card-opacity-20261015',{recursive:true});
 await slider.locator('..').screenshot({path:'/Users/georgegazelian/Projects/LitaPower integration/output/checkout-card-opacity-20261015/card-opacity-slider.png'});
 await page.getByRole('button',{name:'Colors',exact:true}).click();
 await expect(slider).toHaveValue('92');
});

for(const opacity of [0,65,92,100])test(`portrait tap and receipt cards use saved ${opacity}% opacity @desktop`,async({page})=>{
 await page.goto(`/portal/tests/fixtures/touch-checkout.html?orientation=portrait&terms=true&opacity=${opacity}`);
 const panel=page.locator('.ms-checkout-panel');
 const check=async()=>{
  const styles=await panel.evaluate(node=>({background:getComputedStyle(node).backgroundColor,opacity:getComputedStyle(node).opacity,children:[...node.querySelectorAll('h2,p,img')].map(child=>getComputedStyle(child).opacity)}));
  expect(styles.opacity).toBe('1');expect(styles.children.every(value=>value==='1')).toBe(true);
  if(opacity<100)expect(styles.background).toMatch(new RegExp(`/ ${opacity/100}\\)`));
 };
 await check();await page.evaluate(()=>window.touchPreview.phase('succeeded'));await check();
});
