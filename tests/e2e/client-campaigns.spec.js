import {test,expect} from '@playwright/test';
const fixture='/portal/tests/fixtures/client-campaigns.html';

test('an older service returning four campaigns displays only the selected client’s verified campaign @desktop',async({page})=>{
  await page.goto(fixture+'?legacy=1');
  await expect(page.locator('[data-campaign-id]')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Original client campaign',exact:true})).toBeVisible();
  await expect(page.getByText('Other client campaign',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Unknown kiosk campaign',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Unassigned campaign',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'New campaign',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('media service update is required');
  await page.getByLabel('Fixture client').selectOption('APOLLO SAMPLE');
  await expect(page.locator('[data-campaign-id]')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Other client campaign',exact:true})).toBeVisible();
});

test('client workspace has its own campaign list and no profile publish action in Campaigns @desktop',async({page})=>{
  await page.goto(fixture+'?workspace=profiles');
  await expect(page.getByRole('button',{name:'Campaigns',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('heading',{name:'MIXED SAMPLE campaigns',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Publish Campaigns'})).toHaveCount(0);
  await page.getByLabel('Client profile').selectOption({label:'APOLLO SAMPLE Kiosk UI'});
  await expect(page.getByRole('heading',{name:'APOLLO SAMPLE campaigns',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Original client campaign',exact:true})).toHaveCount(0);
});

test('edit saves a draft and publishes the same campaign only after review @desktop',async({page})=>{
  await page.goto(fixture);
  await expect(page.getByText('SAMPLE-M01: Playing',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('Campaign name',{exact:true})).toHaveValue('Original client campaign');
  await expect(page.getByText('16:9',{exact:true})).toBeVisible();
  await page.getByLabel('Campaign name',{exact:true}).fill('Edited campaign');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('draft saved');
  let writes=await page.evaluate(()=>window.campaignWrites);
  expect(writes).toHaveLength(1);expect(writes[0].route).toBe('/campaigns/draft');
  expect(writes[0].body.id).toBe('11111111-1111-1111-1111-111111111111');
  expect(writes[0].body.clientId).toBe('MIXED SAMPLE');expect(writes[0].body.orientation).toBe('landscape');
  for(let step=0;step<4;step++)await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('.cmw-kiosk-list')).toContainText('SAMPLE-M01');
  await expect(page.locator('.cmw-kiosk-list')).not.toContainText('SAMPLE-A01');
  await page.getByRole('button',{name:'Review & publish',exact:true}).click();
  expect(await page.evaluate(()=>window.campaignWrites.length)).toBe(1);
  await page.getByRole('button',{name:'Publish changes',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('published');
  writes=await page.evaluate(()=>window.campaignWrites);expect(writes).toHaveLength(2);
  expect(writes[1].body.id).toBe(writes[0].body.id);expect(writes[1].body.expectedVersion).toBe(2);
  await expect.poll(()=>page.locator('.cmw-slide[aria-hidden="false"]').evaluate(node=>Math.abs(node.getBoundingClientRect().left-node.closest('.cmw-slider-window').getBoundingClientRect().left))).toBeLessThan(1);
  await page.screenshot({path:'output/client-campaigns-20261015/edit-published.png',fullPage:true});
});

test('unsaved edits require an explicit discard and client lists remain separate @desktop',async({page})=>{
  await page.goto(fixture);await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Campaign name',{exact:true}).fill('Unsaved edit');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'Back to campaigns',exact:true}).click();
  await expect(page.getByLabel('Campaign name',{exact:true})).toHaveValue('Unsaved edit');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Back to campaigns',exact:true}).click();
  await page.getByLabel('Fixture client').selectOption('APOLLO SAMPLE');
  await expect(page.getByText('No campaigns for APOLLO SAMPLE yet.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.campaignWrites.length)).toBe(0);
});

test('campaign-only partners select actual clients without gaining UI profile access @desktop',async({page})=>{
  await page.goto(fixture+'?workspace=partner');
  await expect(page.getByLabel('Campaign client')).toHaveValue('MIXED SAMPLE');
  await expect(page.getByRole('heading',{name:'MIXED SAMPLE campaigns',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open UI settings',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Client profile',{exact:true})).toHaveCount(0);
  await page.getByLabel('Campaign client').selectOption('APOLLO SAMPLE');
  await expect(page.getByText('No campaigns for APOLLO SAMPLE yet.',{exact:true})).toBeVisible();
});

test('client and section changes protect unsaved edits in the integrated UI workspace @desktop',async({page})=>{
  await page.goto(fixture+'?workspace=profiles');
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Campaign name',{exact:true}).fill('Keep my draft');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByLabel('Client profile').selectOption({label:'APOLLO SAMPLE Kiosk UI'});
  await expect(page.getByLabel('Campaign name',{exact:true})).toHaveValue('Keep my draft');
  await expect(page.getByLabel('Client profile')).toHaveValue('mixed-sample');
});
