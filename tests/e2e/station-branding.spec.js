import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('@desktop station branding is independent of disabled profile publishing and retained across sections', async ({page}) => {
  await page.goto('/portal/tests/fixtures/station-branding.html');
  const brand = page.getByRole('combobox', {name: 'Station brand for SAMPLE-M01'});
  await expect(brand).toBeEnabled();
  await expect(brand).toHaveValue('chargerent');
  await expect(page.getByRole('button', {name: 'Publish Chargerent app (1)'})).toBeDisabled();
  await brand.selectOption('eventcharging');
  await expect(brand).toHaveValue('eventcharging');
  await expect(page.getByText('SAMPLE-M01 brand saved as Event Charging in this preview.')).toBeVisible();
  await expect(page.getByRole('img', {name: 'Event Charging logo'})).toBeVisible();
  await expect.poll(() => page.getByRole('img', {name: 'Event Charging logo'}).evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('button', {name: 'Save draft'})).toBeDisabled();
  await page.getByRole('button', {name: 'Kiosk screen', exact: true}).click();
  await expect(brand).toHaveValue('eventcharging');
  await brand.selectOption('chargedrops');
  await expect(page.getByText('SAMPLE-M01 brand saved as ChargeDrops in this preview.')).toBeVisible();
  await expect(brand).toHaveValue('chargedrops');
  await expect.poll(() => page.getByRole('img', {name: 'ChargeDrops logo'}).evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  const output = path.resolve('output/station-branding-20261012/profile-publishing.png');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  await page.screenshot({path: output, fullPage: true});
  await brand.selectOption('chargerent');
  await expect(brand).toHaveValue('chargerent');
  await expect(page.getByText('SAMPLE-M01 brand saved as Chargerent in this preview.')).toBeVisible();
  await expect.poll(() => page.getByRole('img', {name: 'Chargerent logo'}).evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
});

test('@desktop screenless stations hide branding even when the payment terminal has a display', async ({page}) => {
  await page.goto('/portal/tests/fixtures/station-branding.html');
  await expect(page.getByRole('combobox', {name: 'Station brand for SAMPLE-M01'})).toBeVisible();
  await page.getByRole('button', {name: 'Apollo', exact: true}).click();
  await expect(page.getByRole('button', {name: 'SAMPLE-M02', exact: true})).toBeVisible();
  await expect(page.getByRole('combobox', {name: /Station brand for/})).toHaveCount(0);
});
