import {test,expect} from '@playwright/test';
const preview='/portal/tests/fixtures/stripe-offline-pricing.html';
test('pricing saves offline card opt-in separately from free mode and persists after saving @desktop',async({page})=>{
 await page.goto(preview);await page.getByText('Pricing',{exact:true}).click();
 const toggle=page.getByRole('checkbox',{name:'Stripe offline card payments',exact:true});
 await expect(toggle).not.toBeChecked();await page.locator('label[for="stripeOfflinePayments"]').click();
 await page.locator('input[name="stripeOfflineMaxPayment"]').fill('35.25');
 await page.locator('input[name="stripeOfflineMaxPending"]').fill('250');
 await page.getByRole('button',{name:'Save Pricing',exact:true}).click();
 const saved=await page.evaluate(()=>window.savedPricing.pricing);
 expect(saved.stripeOfflinePayments).toBe(true);expect(saved.offline).toBe(false);
 expect(saved.stripeOfflineMaxPayment).toBe(35.25);expect(saved.stripeOfflineMaxPending).toBe(250);
 expect(saved.buyprice).toBe(30);
 await expect(toggle).toBeChecked();
 await toggle.locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]').screenshot({path:'/Users/georgegazelian/Projects/LitaPower integration/output/stripe-offline-payments-20261013/pricing-toggle.png'});
 await page.locator('label[for="stripeOfflinePayments"]').click();await page.getByRole('button',{name:'Save Pricing',exact:true}).click();
 expect((await page.evaluate(()=>window.savedPricing.pricing)).stripeOfflinePayments).toBe(false);
 await page.locator('label[for="offline"]').click();await page.locator('label[for="stripeOfflinePayments"]').click();
 await expect(page.getByText('No-card rental mode takes priority.',{exact:false})).toBeVisible();

});
test('legacy server-controlled kiosks do not offer unsupported offline collection @desktop',async({page})=>{
 await page.goto(preview+'?legacy=true');await page.getByText('Pricing',{exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Stripe offline card payments',exact:true})).toHaveCount(0);
});
