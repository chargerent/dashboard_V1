import {test,expect} from '@playwright/test';
import {renderReceiptPage} from '../../functions/receiptPage.mjs';
import {defaultReceiptPage} from '../../functions/receiptPageProfile.mjs';

const fixture='/portal/tests/fixtures/ui-editor-variants.html';
const receiptPreview=page=>page.frameLocator('iframe[title="Receipt page preview"]');

test('receipt text, languages and selected client logo update the exact page preview @desktop',async({page})=>{
  await page.goto(fixture);
  await page.getByRole('navigation',{name:'Stripe settings'}).getByRole('button',{name:'Receipt page',exact:true}).click();
  await page.getByLabel('Receipt Receipt heading',{exact:true}).fill('Gartner charging receipt');
  await expect(receiptPreview(page).locator('#eyebrow')).toHaveText('Gartner charging receipt');
  await page.getByLabel('Receipt text group').selectOption('Rental status');
  await page.getByLabel('Receipt Returned title',{exact:true}).fill('Thank you for charging with Gartner');
  await expect(receiptPreview(page).locator('#heading')).toHaveText('Thank you for charging with Gartner');
  await page.getByRole('tab',{name:'French',exact:true}).click();
  await expect(page.getByLabel('Receipt Returned title',{exact:true})).toHaveValue('Batterie rendue');
  await page.getByLabel('Receipt Returned title',{exact:true}).fill('Merci de votre visite');
  await expect(receiptPreview(page).locator('#heading')).toHaveText('Merci de votre visite');
  await page.getByRole('tab',{name:'English',exact:true}).click();
  await expect(receiptPreview(page).locator('#heading')).toHaveText('Thank you for charging with Gartner');
  await page.getByLabel('Receipt logo',{exact:true}).setInputFiles('public/chargerent-wordmark.png');
  await expect(receiptPreview(page).locator('#logo')).toBeVisible();
  await expect.poll(()=>receiptPreview(page).locator('#logo').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText('chargerent-wordmark.png — ready to upload when you save.',{exact:true})).toBeVisible();
  await page.getByLabel('Receipt preview status').selectOption('offlinePending');
  await expect(receiptPreview(page).locator('#payment-note')).toContainText('Card payment approval is pending');
  await page.getByRole('button',{name:'Remove logo',exact:true}).click();
  await expect(receiptPreview(page).locator('#logo')).toBeHidden();
  expect(await page.evaluate(()=>window.receiptPageDraft.logo)).toBeNull();
  expect(await page.evaluate(()=>window.editorDraft.receiptPage)).toBeUndefined();
  await page.getByLabel('Receipt preview status').selectOption('returned');
  await page.screenshot({path:'output/receipt-page-editor-20261015/desktop-editor.png',fullPage:true});
});

test('receipt editor and preview fit a mobile viewport',async({page})=>{
  await page.goto(fixture);
  await page.getByRole('navigation',{name:'Stripe settings'}).getByRole('button',{name:'Receipt page',exact:true}).click();
  await page.getByLabel('Receipt Receipt heading',{exact:true}).fill('Client receipt');
  await expect(receiptPreview(page).locator('#eyebrow')).toHaveText('Client receipt');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'output/receipt-page-editor-20261015/mobile-editor.png',fullPage:true});
});

test('public scanned receipt applies published copy and logo while refresh preserves server payment amounts @desktop',async({page})=>{
  const profile=defaultReceiptPage();profile.locales.en.returnedTitle='Thanks from Client A';profile.locales.en.finalChargeLabel='Your rental total';
  profile.logo={url:'https://receipt.example/client-logo.png',contentType:'image/png'};
  const receipt={transactionId:'tx-public',status:'returned',station:{id:'US8012'},returnStation:{id:'US8012'},rentedAt:'2026-10-15T10:00:00Z',returnedAt:'2026-10-15T11:00:00Z',updatedAt:'2026-10-15T11:00:00Z',currency:'USD',brand:{name:'Client A'},page:profile,
    payment:{state:'settled',upfrontKind:'payment',upfrontCents:1000,finalChargeCents:200,refundedCents:800,releasedCents:0}};
  let reads=0;
  await page.route('https://receipt.example/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/client-logo.png')return route.fulfill({path:'public/chargerent-wordmark.png',contentType:'image/png'});
    if(url.pathname.startsWith('/api/receipts/')){
      reads++;
      return route.fulfill({status:reads>1?503:200,contentType:'application/json',body:JSON.stringify(reads>1?{error:{message:'PRIVATE INTERNAL DIAGNOSTIC'}}:receipt)});
    }
    return route.fulfill({contentType:'text/html',body:renderReceiptPage({transactionId:'tx-public',apiUrl:'/api/receipts/tx-public?key=id.signature',initialReceipt:receipt})});
  });
  await page.goto('https://receipt.example/receipt/tx-public?key=id.signature');
  await expect(page.getByRole('heading',{level:1})).toHaveText('Thanks from Client A');
  await expect(page.locator('.row.total')).toHaveText('Your rental total$2.00');
  await expect(page.locator('#logo')).toBeVisible();
  await expect.poll(()=>reads).toBe(1);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.locator('#notice')).toHaveText('Could not refresh. The last confirmed details are shown.');
  await expect(page.locator('.row.total')).toHaveText('Your rental total$2.00');
  await expect(page.locator('body')).not.toContainText('PRIVATE');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'output/receipt-page-editor-20261015/public-mobile-receipt.png',fullPage:true});
});
