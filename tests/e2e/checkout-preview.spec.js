import {expect,test} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const HARNESS_URL='/portal/tests/fixtures/checkout-preview-harness.html';
const SCREENSHOTS=path.resolve('output/local-lab/preview-flow-correction-20261003');

async function captureNativeSize(page,preview,name){
  await page.setViewportSize({width:2400,height:2200});
  await preview.evaluate(element=>{
    element.parentElement.style.width='1082px';
    element.parentElement.style.overflow='visible';
    element.closest('aside').style.width='1120px';
    element.closest('aside').style.maxWidth='none';
  });
  await expect.poll(()=>preview.evaluate(element=>Math.round(element.getBoundingClientRect().width))).toBe(1080);
  const output=path.join(SCREENSHOTS,name);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  await preview.screenshot({path:output});
}

test.beforeEach(async ({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(HARNESS_URL);
  await expect(page.getByTestId('stripe-device-preview')).toBeVisible();
});

test('@desktop Cancel after payment reaches Cancelled and Done returns Start',async ({page})=>{
  const preview=page.getByTestId('stripe-device-preview');
  const panel=preview.locator('[data-checkout-phase]');
  await expect(panel).toHaveAttribute('data-checkout-phase','start');
  await panel.getByRole('button',{name:'Start',exact:true}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','ready');
  await captureNativeSize(page,preview,'ready-preview-1080x1920.png');
  await panel.getByRole('button',{name:'Rent a charger',exact:true}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','review');
  await captureNativeSize(page,preview,'review-preview-1080x1920.png');
  await panel.getByRole('checkbox',{name:'I agree to the rental terms'}).check();
  await captureNativeSize(page,preview,'review-accepted-preview-1080x1920.png');
  await panel.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','waiting_for_card');
  await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','cancelled');
  await expect(panel.getByRole('heading',{name:'Rental cancelled'})).toBeVisible();
  await expect(preview.getByText(/return (is|has not been|pending)/i)).toHaveCount(0);
  await expect(page.getByTestId('stripe-confirmation-popup')).toHaveCount(0);
  await captureNativeSize(page,preview,'cancelled-preview-1080x1920.png');
  await panel.getByRole('button',{name:'Done',exact:true}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','start');
});

test('@desktop confirmation selector uses current checkout cards without legacy station banners',async ({page})=>{
  await page.getByRole('navigation',{name:'Stripe text sections'}).getByRole('button',{name:'Confirmation messages'}).click();
  const preview=page.getByTestId('stripe-device-preview');
  const panel=preview.locator('[data-checkout-phase]');
  await expect(panel).toHaveAttribute('data-checkout-phase','succeeded');
  await expect(page.getByTestId('stripe-confirmation-popup')).toHaveCount(0);
  await expect(panel.getByRole('heading',{name:/Take your charger/})).toBeVisible();
  await expect(page.getByLabel('Stripe Charger released popup')).toHaveCount(0);
  await expect(page.getByLabel('Stripe Charger returned popup')).toHaveCount(0);
  await expect(page.getByLabel('Stripe Release failed popup')).toHaveCount(0);
  await captureNativeSize(page,preview,'rental-complete-card-preview-1080x1920.png');

  await expect(page.getByRole('tablist',{name:'Confirmation preview scenario'}).getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('tab',{name:'Station event banner'})).toHaveCount(0);
  await expect(page.getByLabel('Checkout card beneath released event')).toHaveCount(0);

  await page.getByRole('tablist',{name:'Confirmation preview scenario'}).getByRole('tab',{name:'Release failed'}).click();
  await expect(page.getByTestId('stripe-confirmation-popup')).toHaveCount(0);
  await expect(panel).toHaveAttribute('data-checkout-phase','failed');
  await expect(panel.getByRole('heading',{name:'Charger was not released'})).toBeVisible();
  await captureNativeSize(page,preview,'release-failed-card-preview-1080x1920.png');

  await page.getByRole('tablist',{name:'Confirmation preview scenario'}).getByRole('tab',{name:'Return complete'}).click();
  await expect(page.getByTestId('stripe-confirmation-popup')).toHaveCount(0);
  await expect(panel).toHaveAttribute('data-checkout-phase','returned');
  await captureNativeSize(page,preview,'returned-preview-1080x1920.png');
  await page.getByRole('button',{name:'Edit Return complete card text'}).click();
  await expect(page.getByRole('navigation',{name:'Stripe text sections'}).getByRole('button',{name:'Return complete'})).toHaveAttribute('aria-pressed','true');
});

test('@desktop every native checkout stage has a selectable editor screen',async ({page})=>{
  test.setTimeout(90_000);
  const sections=page.getByRole('navigation',{name:'Stripe text sections'});
  const preview=page.getByTestId('stripe-device-preview');
  const panel=preview.locator('[data-checkout-phase]');
  for(const [label,stage] of [
    ['Start','start'],['Rent / Return','ready'],['How it works','information'],['Terms','terms'],['Map','map'],
    ['Rental review','review'],['Payment','waiting_for_card'],['Authorizing','authorizing'],['Releasing charger','dispensing'],
    ['Rental complete','succeeded'],['Card declined','declined'],['Cancelled','cancelled'],['Release failed','failed'],
    ['Return instructions','returning'],['Return complete','returned'],['Loading','loading'],['Out of order','out_of_order'],
  ]){
    await sections.getByRole('button',{name:label,exact:true}).click();
    await expect(panel).toHaveAttribute('data-checkout-phase',stage);
    await expect(page.getByRole('heading',{name:label,exact:true}).first()).toBeVisible();
    await captureNativeSize(page,preview,`all-stages/${stage}-1080x1920.png`);
  }
  await expect(sections.getByRole('button',{name:'Recovering',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Pages',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Go straight to rental review'})).toBeVisible();
});

test('@desktop Return cancellation goes to Rent / Return; confirmed return Done goes to Start',async ({page})=>{
  const panel=page.getByTestId('stripe-device-preview').locator('[data-checkout-phase]');
  await panel.getByRole('button',{name:'Start',exact:true}).click();
  await panel.getByRole('button',{name:'Return a charger',exact:true}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','returning');
  await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','ready');
  await page.getByRole('navigation',{name:'Stripe text sections'}).getByRole('button',{name:'Return complete'}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','returned');
  await panel.getByRole('button',{name:'Done',exact:true}).click();
  await expect(panel).toHaveAttribute('data-checkout-phase','start');
});

test('@desktop live review uses station offer pricing lines when supplied',async ({page})=>{
  await page.goto(`${HARNESS_URL}?offer-lines=1`);
  const review=page.getByTestId('live-offer-lines-example');
  await expect(review.locator('[data-checkout-phase]')).toHaveAttribute('data-checkout-phase','review');
  await expect(review.locator('.ms-checkout-pricing')).toHaveText('$5.00 deposit · $1.00 for 24 hours · $20.00 if not returned');
});
