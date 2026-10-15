import {expect,test} from '@playwright/test';
import process from 'node:process';

test('@desktop delayed rental and return receipts replace text without reopening completed notices',async ({page})=>{
  await page.setViewportSize({width:1440,height:1800});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/portal/tests/fixtures/receipt-display.html');
  for(const kind of ['returned','succeeded']){
    const example=page.getByTestId(kind),card=example.locator('[data-checkout-phase]');
    await expect(card).toHaveAttribute('data-checkout-phase',kind);
    await expect(card.getByRole('status')).toHaveText('Generating receipt…');
    await expect(card.locator('.ms-return-receipt img,.ms-return-receipt svg,.ms-return-qr-pending')).toHaveCount(0);
    await expect(card.getByRole('button',{name:'Done',exact:true})).toBeVisible();
    if(process.env.RECEIPT_REVIEW_DIR)await card.screenshot({path:`${process.env.RECEIPT_REVIEW_DIR}/${kind}-generating.png`,animations:'disabled'});
    await example.getByRole('button',{name:'Wrong slot receipt',exact:true}).click();
    await expect(card.getByRole('status')).toHaveText('Generating receipt…');
    await expect(card.locator('.ms-return-receipt img')).toHaveCount(0);
    await example.getByRole('button',{name:'Deliver receipt',exact:true}).click();
    await expect(card.getByRole('img',{name:'Scan for your receipt',exact:true})).toBeVisible();
    await expect(card.getByRole('status')).toHaveCount(0);
    await expect(card).toHaveAttribute('data-receipt-transaction','tx_fixture_123');
    if(process.env.RECEIPT_REVIEW_DIR)await card.screenshot({path:`${process.env.RECEIPT_REVIEW_DIR}/${kind}-receipt-ready.png`,animations:'disabled'});
    await card.getByRole('button',{name:'Done',exact:true}).click();
    await expect(card).toHaveAttribute('data-checkout-phase','start');
    await example.getByRole('button',{name:'Repeat receipt',exact:true}).click();
    await expect(card).toHaveAttribute('data-checkout-phase','start');
  }
});
