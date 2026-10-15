import {test,expect} from '@playwright/test';
const url='/portal/tests/fixtures/ui-editor-variants.html';
const preview=page=>page.getByTestId('stripe-device-preview');
const pricingTabs=page=>page.getByRole('tablist',{name:'Rent / Return pricing modes'});
test.beforeEach(async({page})=>{await page.goto(url);await expect(preview(page)).toBeVisible();});

test('US8012 automatically loads its no-touch Event Simple controls and configured panel height @desktop',async({page})=>{
  await expect(page.getByLabel('Preview interaction mode')).toHaveValue('auto');
  await expect(pricingTabs(page).getByRole('tab',{name:'Event Simple',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(preview(page).locator('[data-checkout-phase]')).toHaveAttribute('data-checkout-phase','touch_ready');
  await expect(preview(page).getByRole('button')).toHaveCount(0);
  await expect(preview(page)).toContainText('Tap your card on the reader below to borrow.');
  await expect(preview(page)).toContainText('$55 if not returned after 30 days.');
  await expect(preview(page).locator('.ms-checkout-tap-hold')).toHaveCount(0);
  await expect(page.getByLabel('Stripe Direct tap card hold',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Stripe Direct tap consent',{exact:true})).toHaveJSProperty('tagName','INPUT');
  await expect(page.getByLabel('Stripe No-touch card payment heading')).toBeVisible();
  await expect(page.getByLabel('Stripe Rent button',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'Stripe text sections'}).getByRole('button',{name:'Start',exact:true})).toHaveCount(0);
  const heights=await preview(page).evaluate(node=>{const panel=node.querySelector('[data-checkout-phase]');return {panel:parseFloat(panel.style.height),height:panel.offsetHeight};});
  expect(heights.height).toBe(538);
  await page.screenshot({path:'output/ui-editor-variants-20261015/editor-us8012-no-touch.png',fullPage:true});
});

test('each rate, interaction type and language keeps independent saved text @desktop',async({page})=>{
  const heading=page.getByLabel('Stripe No-touch card payment heading');
  await heading.fill('Event desk · tap to borrow');
  await expect(preview(page)).toContainText('Event desk · tap to borrow');
  await pricingTabs(page).getByRole('tab',{name:'Purchase · Simple daily',exact:true}).click();
  await expect(heading).toHaveValue('Tap your card on the reader below to borrow.');
  await heading.fill('Purchase desk · tap your card');
  await page.getByLabel('Stripe Pricing summary').fill('Current rates:\n{rateSummary}');
  await expect(preview(page)).toContainText('Current rates:');
  await expect(preview(page)).toContainText('$5.00 per 24-hour period');
  await page.getByLabel('Preview interaction mode').selectOption('touch');
  await expect(page.getByLabel('Stripe Rent button',{exact:true})).toHaveValue('Rent a charger');
  await page.getByLabel('Stripe Title',{exact:true}).fill('Purchase touch welcome');
  await expect(preview(page)).toContainText('Purchase touch welcome');
  await page.getByLabel('Stripe Map button',{exact:true}).fill('Find purchase station');
  await expect(preview(page).getByRole('button',{name:'Find purchase station',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'French',exact:true}).click();
  await expect(page.getByLabel('Stripe Title',{exact:true})).toHaveValue('Louez un chargeur portable');
  await page.getByRole('tab',{name:'English',exact:true}).click();
  await expect(page.getByLabel('Stripe Title',{exact:true})).toHaveValue('Purchase touch welcome');
  await page.getByLabel('Preview interaction mode').selectOption('noTouch');
  await expect(heading).toHaveValue('Purchase desk · tap your card');
  await pricingTabs(page).getByRole('tab',{name:'Event Simple',exact:true}).click();
  await expect(heading).toHaveValue('Event desk · tap to borrow');
  const saved=await page.evaluate(()=>JSON.parse(JSON.stringify(window.editorDraft)));
  expect(saved.rentReturn.EVENT_SIMPLE.noTouch.en.touchBorrowTitle).toBe('Event desk · tap to borrow');
  expect(saved.rentReturn.PURCHASE_SIMPLE_DAILY.touch.en['ready.title']).toBe('Purchase touch welcome');
  expect(saved.locales.en['ready.title']).toBe('Rent a portable charger');
});

test('kiosk changes restore automatic interaction and rate detection without saving station settings @desktop',async({page})=>{
  await page.getByLabel('Preview interaction mode').selectOption('touch');
  await pricingTabs(page).getByRole('tab',{name:'Lease · Mixed daily',exact:true}).click();
  await page.getByLabel('Preview kiosk').selectOption('TOUCH_DEMO');
  await expect(page.getByLabel('Preview interaction mode')).toHaveValue('auto');
  await expect(pricingTabs(page).getByRole('tab',{name:'Purchase · Simple daily',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(preview(page).getByRole('button',{name:'Rent a charger',exact:true})).toBeVisible();
  await page.getByLabel('Preview kiosk').selectOption('US8012');
  await expect(preview(page).getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(()=>window.editorDraft.rentReturn)).toBeUndefined();
});

test('every supported rate tab previews separately and reset preserves other rate drafts @desktop',async({page})=>{
  const tabs=pricingTabs(page).getByRole('tab');await expect(tabs).toHaveCount(7);
  for(let index=0;index<7;index++){
    await tabs.nth(index).click();
    await page.getByLabel('Stripe No-touch card payment heading').fill(`Rate ${index}`);
    await expect(preview(page)).toContainText(`Rate ${index}`);
  }
  await page.getByRole('button',{name:'Use shared text for this tab',exact:true}).click();
  await expect(page.getByLabel('Stripe No-touch card payment heading')).toHaveValue('Tap your card on the reader below to borrow.');
  await tabs.first().click();await expect(page.getByLabel('Stripe No-touch card payment heading')).toHaveValue('Rate 0');
  await page.getByRole('navigation',{name:'Stripe settings'}).getByRole('button',{name:'Pages',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add page',exact:true})).toHaveCount(0);
});

test('Sold out displays its selected screen and edited copy in both preview sizes @desktop',async({page})=>{
  await page.getByRole('navigation',{name:'Stripe text sections'}).getByRole('button',{name:'Sold out',exact:true}).click();
  const panel=preview(page).locator('[data-checkout-phase]');
  await expect(panel).toHaveAttribute('data-checkout-phase','sold_out');
  await expect(panel.getByRole('heading',{name:'Sold out',exact:true})).toBeVisible();
  await expect(panel).toContainText('No charged power banks are available to rent.');
  await page.getByLabel('Stripe Title',{exact:true}).fill('All chargers are in use');
  await page.getByLabel('Stripe Message',{exact:true}).fill('Please return later.');
  for(const mode of ['noTouch','touch'])for(const orientation of ['portrait','landscape']){
    await page.getByLabel('Preview interaction mode').selectOption(mode);
    await page.getByLabel('Preview screen orientation').selectOption(orientation);
    await expect(panel).toHaveAttribute('data-checkout-phase','sold_out');
    await expect(panel).toContainText('All chargers are in use');
    await expect(panel).toContainText('Please return later.');
  }
  await page.getByRole('button',{name:'Enlarge floating card',exact:true}).click();
  const enlarged=page.getByTestId('stripe-payment-detail').locator('[data-checkout-phase]');
  await expect(enlarged).toHaveAttribute('data-checkout-phase','sold_out');
  await expect(enlarged).toContainText('All chargers are in use');
  await page.getByRole('button',{name:'Close enlarged payment preview',exact:true}).click();
  await page.getByRole('tab',{name:'French',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'Rupture de stock',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'English',exact:true}).click();
  await page.getByLabel('Preview screen orientation').selectOption('portrait');
  await panel.screenshot({path:'output/ui-editor-variants-20261015/sold-out-preview.png'});
});
