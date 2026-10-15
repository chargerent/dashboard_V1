import {expect,test} from '@playwright/test';

test('@desktop interrupted checkout keeps the existing payment, release, and outcome cards',async ({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/portal/tests/fixtures/checkout-recovery-presentation.html');
  for(const [name,stage] of [
    ['awaiting-payment','waiting_for_card'],['authorizing','authorizing'],['dispensing','dispensing'],
    ['unknown','dispensing'],['no-interaction','dispensing'],['succeeded','succeeded'],['missing-slot','failed'],
    ['release-failed','failed'],['cancelled','cancelled'],['returned','returned'],
  ]){
    const card=page.getByTestId(`recovery-${name}`).locator('[data-checkout-phase]');
    await expect(card).toHaveAttribute('data-checkout-phase',stage);
    await expect(card.getByRole('heading')).toBeVisible();
    await expect(card).not.toContainText('Checking your checkout');
    await expect(card).not.toContainText('Restoring your existing checkout');
  }
  await expect(page.getByTestId('recovery-awaiting-payment').getByRole('button',{name:'Cancel'})).toBeDisabled();
  await expect(page.getByTestId('recovery-authorizing').locator('.ms-checkout-progress')).toHaveCount(0);
  await expect(page.getByTestId('recovery-dispensing').locator('.ms-checkout-progress')).toHaveCount(1);
  await expect(page.getByTestId('recovery-succeeded').locator('.ms-return-receipt')).toBeVisible();
  await expect(page.getByTestId('recovery-returned').locator('.ms-return-receipt')).toBeVisible();
});

test('@desktop Return stays on return instructions through availability changes and has no terminal icon',async ({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/portal/tests/fixtures/checkout-recovery-presentation.html');
  const harness=page.getByTestId('return-availability');
  const card=harness.locator('[data-checkout-phase]');
  await expect(harness.locator('.ms-terminal-indicator,[data-terminal-status]')).toHaveCount(0);
  await harness.getByRole('button',{name:'Start',exact:true}).click();
  await expect(card).toHaveAttribute('data-checkout-phase','ready');
  await page.evaluate(()=>{
    const card=document.querySelector('[data-testid="return-availability"] [data-checkout-phase]');
    window.returnStages=[];
    new MutationObserver(()=>window.returnStages.push(card.getAttribute('data-checkout-phase'))).observe(card,{attributes:true,attributeFilter:['data-checkout-phase']});
  });
  await harness.getByRole('button',{name:'Return a charger',exact:true}).click();
  await expect(card).toHaveAttribute('data-checkout-phase','returning');
  for(const label of ['Simulate sold out','Simulate return failure','Simulate offline']){
    await harness.getByRole('button',{name:label,exact:true}).click();
    await expect(card).toHaveAttribute('data-checkout-phase','returning');
    await expect(card.getByRole('heading')).toHaveText('Return your charger');
    await expect(card).not.toContainText('Rentals are temporarily unavailable');
    await expect(card).not.toContainText('Connection lost');
    await expect(card).not.toContainText('We could not complete that request');
    if(label!=='Simulate sold out')await expect(card.locator('.ms-checkout-error')).toHaveText('Waiting for the kiosk to confirm your return.');
    await expect(harness.locator('.ms-terminal-indicator,[data-terminal-status]')).toHaveCount(0);
  }
  expect(await page.evaluate(()=>window.returnStages)).not.toContain('out_of_order');
});
