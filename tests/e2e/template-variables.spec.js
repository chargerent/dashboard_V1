import {test,expect} from '@playwright/test';

const menu=page=>page.getByRole('listbox',{name:'Available variables'});
test.beforeEach(async({page})=>{await page.goto('/portal/tests/fixtures/ui-editor-variants.html');});

test('typing a brace shows and filters supported text variables; keyboard inserts a complete token @desktop',async({page})=>{
  const heading=page.getByLabel('Stripe No-touch card payment heading');
  await heading.fill('Borrow: ');await heading.pressSequentially('{');
  await expect(menu(page).getByRole('option')).toHaveCount(7);
  await expect(menu(page)).toContainText('Card payment or authorization amount');
  await expect(menu(page).getByRole('option',{name:'{rateSummary}',exact:false})).toHaveCount(0);
  await heading.pressSequentially('ev');
  await expect(menu(page).getByRole('option')).toHaveCount(1);
  await heading.press('Enter');
  await expect(heading).toHaveValue('Borrow: {eventCharge}');
  await expect(menu(page)).toHaveCount(0);
  await expect(heading).toBeFocused();await heading.pressSequentially(' today');
  await expect(heading).toHaveValue('Borrow: {eventCharge} today');
  await expect(page.getByTestId('stripe-device-preview')).toContainText('Borrow: $55 today');
  await expect.poll(()=>page.evaluate(()=>window.editorDraft.rentReturn.EVENT_SIMPLE.noTouch.en.touchBorrowTitle)).toBe('Borrow: {eventCharge} today');
});

test('pricing supports the rate summary and selecting with the mouse preserves the rest of the text @desktop',async({page})=>{
  await page.getByRole('tab',{name:'Purchase · Simple daily',exact:true}).click();
  const field=page.getByLabel('Stripe Pricing summary');
  await field.fill('Rates:  per station');
  for(let i=0;i<' per station'.length;i++)await field.press('ArrowLeft');
  await field.pressSequentially('{rate');
  await menu(page).getByRole('option',{name:/\{rateSummary\}/}).click();
  await expect(field).toHaveValue('Rates: {rateSummary} per station');
  await expect(field).toBeFocused();
  await expect(page.getByTestId('stripe-device-preview')).toContainText('$5.00 per 24-hour period');
  await expect(page.getByTestId('stripe-device-preview')).not.toContainText('{rateSummary}');
});

test('Help URL suggests only stationId and inserts by Tab @desktop',async({page})=>{
  const field=page.getByLabel('Stripe Help QR URL');
  await field.fill('https://example.com/help?station=');await field.pressSequentially('{');
  await expect(menu(page).getByRole('option')).toHaveCount(1);
  await expect(menu(page)).toContainText('{stationId}');
  await field.press('Tab');
  await expect(field).toHaveValue('https://example.com/help?station={stationId}');
  await expect(field).toBeFocused();
  await expect.poll(()=>page.evaluate(()=>window.editorDraft.links.help)).toBe('https://example.com/help?station={stationId}');
});

test('Escape and unmatched braces keep ordinary typing intact; completing an existing token does not duplicate its suffix @desktop',async({page})=>{
  const field=page.getByLabel('Stripe No-touch card payment heading');
  await field.fill('Price ');await field.pressSequentially('{');
  await expect(menu(page)).toBeVisible();await field.press('Escape');
  await expect(menu(page)).toHaveCount(0);await expect(field).toHaveValue('Price {');
  await field.pressSequentially('noSuchVariable');await expect(menu(page)).toHaveCount(0);
  await field.fill('Cost {deposit} today');
  for(let i=0;i<'eposit} today'.length;i++)await field.press('ArrowLeft');
  await expect(menu(page).getByRole('option')).toHaveCount(1);
  await field.press('Tab');await expect(field).toHaveValue('Cost {deposit} today');
  await field.pressSequentially('!');await expect(field).toHaveValue('Cost {deposit}! today');
  await field.fill('Literal {{');await expect(menu(page)).toHaveCount(0);
});

test('arrow keys choose variables and custom page text offers the same supported variables @desktop',async({page})=>{
  const field=page.getByLabel('Stripe No-touch card payment heading');
  await field.fill('');await field.pressSequentially('{');await field.press('ArrowDown');await field.press('Enter');
  await expect(field).toHaveValue('{fee}');
  await page.getByLabel('Preview interaction mode').selectOption('touch');
  await page.getByRole('button',{name:'Pages',exact:true}).click();
  await page.getByRole('button',{name:'Add page',exact:true}).click();
  const title=page.getByLabel('Stripe page title');
  await title.fill('Available: ');await title.pressSequentially('{avail');await title.press('Tab');
  await expect(title).toHaveValue('Available: {available}');
  await title.pressSequentially(' · {eventCh');await title.press('Enter');
  await expect(title).toHaveValue('Available: {available} · {eventCharge}');
  await expect(page.getByTestId('stripe-device-preview')).not.toContainText('{eventCharge}');
  const message=page.getByLabel('Stripe page message');
  await message.fill('Refund: ');await message.pressSequentially('{refu');await message.press('Enter');
  await expect(message).toHaveValue('Refund: {refund}');
  const next=page.getByLabel('Stripe page continue button');
  await next.fill('Pay ');await next.pressSequentially('{dep');await next.press('Enter');
  await expect(next).toHaveValue('Pay {deposit}');
});


test('variable suggestions stay inside a narrow viewport and remain clickable @desktop',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const field=page.getByLabel('Stripe No-touch card payment heading');
  await field.fill('Borrow: ');await field.pressSequentially('{eve');
  const popup=menu(page);await expect(popup).toBeVisible();
  const box=await popup.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(844);
  await popup.getByRole('option').click();
  await expect(field).toHaveValue('Borrow: {eventCharge}');
});

test('inserted variables survive saving and reopening the client draft @desktop',async({page})=>{
  await page.goto('/portal/tests/fixtures/client-campaigns.html?workspace=profiles');
  await page.getByRole('button',{name:'Chargerent app',exact:true}).click();
  const field=page.locator('textarea[aria-label^="Stripe "]').first();
  const label=await field.getAttribute('aria-label');
  await field.fill('Client copy ');await field.pressSequentially('{dep');await field.press('Enter');
  await expect(field).toHaveValue('Client copy {deposit}');
  const save=page.getByRole('button',{name:'Save draft',exact:true});
  await expect(save).toBeEnabled();await save.click();await expect(save).toBeDisabled();
  await page.getByLabel('Client profile').selectOption({label:'APOLLO SAMPLE Kiosk UI'});
  await page.getByLabel('Client profile').selectOption({label:'MIXED SAMPLE Kiosk UI'});
  await page.getByRole('button',{name:'Chargerent app',exact:true}).click();
  await expect(page.getByLabel(label,{exact:true})).toHaveValue('Client copy {deposit}');
});
