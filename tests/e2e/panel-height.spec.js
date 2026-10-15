import {test,expect} from '@playwright/test';

test('panel height resizes the no-touch card and remains below screen timeout @desktop',async({page})=>{
  await page.goto('/portal/tests/fixtures/ui-editor-variants.html');
  const slider=page.getByRole('slider',{name:'Expanded panel height',exact:true});
  await expect(slider).toHaveValue('28');
  const placement=await slider.evaluate(node=>{
    const card=node.closest('label').getBoundingClientRect();
    const timeout=document.querySelector('input[aria-label="Screen timeout"]').closest('label').getBoundingClientRect();
    return {below:card.top>=timeout.bottom,left:Math.abs(card.left-timeout.left)};
  });
  expect(placement.below).toBe(true);expect(placement.left).toBeLessThan(1);
  await slider.focus();await slider.press('End');
  await expect(slider).toHaveValue('50');
  await expect.poll(()=>page.evaluate(()=>window.editorCheckoutDraft.height)).toBe(.5);
  await expect(page.getByTestId('stripe-device-preview')).toHaveAttribute('data-payment-fraction','0.5');
  await expect.poll(()=>page.getByTestId('stripe-device-preview').locator('[data-checkout-phase]').evaluate(node=>node.offsetHeight)).toBe(960);
  await slider.press('Home');
  await expect(slider).toHaveAttribute('min','15');
  await expect(slider).toHaveValue('15');
  const panel=page.getByTestId('stripe-device-preview').locator('[data-checkout-phase]');
  for(let percent=15;percent<=20;percent++){
    await expect(slider).toHaveValue(String(percent));
    await expect.poll(()=>page.evaluate(()=>window.editorCheckoutDraft.height)).toBe(percent/100);
    await expect.poll(()=>panel.evaluate(node=>node.offsetHeight)).toBe(Math.round(1920*percent/100));
    if(percent<20)await slider.press('ArrowRight');
  }
});

test('moved panel height control updates and saves the client app draft @desktop',async({page})=>{
  await page.goto('/portal/tests/fixtures/client-campaigns.html?workspace=profiles');
  await page.getByRole('button',{name:'Chargerent app',exact:true}).click();
  const slider=page.getByRole('slider',{name:'Expanded panel height',exact:true});
  await expect(slider).toBeEnabled();
  await slider.focus();await slider.press('Home');
  await expect(slider).toHaveValue('15');
  const save=page.getByRole('button',{name:'Save draft',exact:true});
  await expect(save).toBeEnabled();await save.click();
  await expect(save).toBeDisabled();
  await page.getByLabel('Client profile').selectOption({label:'APOLLO SAMPLE Kiosk UI'});
  await page.getByLabel('Client profile').selectOption({label:'MIXED SAMPLE Kiosk UI'});
  await page.getByRole('button',{name:'Chargerent app',exact:true}).click();
  await expect(page.getByRole('slider',{name:'Expanded panel height',exact:true})).toHaveValue('15');
});
