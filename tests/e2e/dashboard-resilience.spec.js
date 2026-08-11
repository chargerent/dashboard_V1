import { expect, test } from '@playwright/test';

const HARNESS_URL = '/portal/tests/fixtures/dashboard-harness.html';
const TARGET_STATION_ID = 'US9001';

const openTargetKiosk = async (page) => {
  const search = page.getByRole('textbox', { name: /search by location/i });
  await search.fill(TARGET_STATION_ID);
  await expect(page.getByRole('heading', { name: TARGET_STATION_ID, exact: true })).toBeVisible();
  await page.getByRole('heading', { name: TARGET_STATION_ID, exact: true }).tap();
  await expect(page.locator(`[data-kiosk-detail-panel="true"][data-kiosk-stationid="${TARGET_STATION_ID}"]`)).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_URL);
  await expect(page.getByRole('heading', { name: TARGET_STATION_ID, exact: true })).toBeVisible();
});

test('fixture loads the real dashboard without authentication or backend commands', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'RESILIENCE TEST LOCATION 1' })).toBeVisible();
  await expect(page.locator('[data-kiosk-control-panel="true"]')).toHaveCount(0);
});

test('main kiosk cards show whether their flow matches the current server flow', async ({ page }) => {
  const matchingFlow = page.locator('[data-kiosk-flow-version="496"]').first();
  await expect(matchingFlow).toHaveText('F:496');
  await expect(matchingFlow).toHaveAttribute('data-flow-version-match', 'true');
  await expect(matchingFlow).toHaveAttribute('data-flow-version-status', 'current');
  await expect(matchingFlow).toHaveClass(/text-gray-400/);
  await expect(page.locator('[data-module-firmware="2"]').first()).toHaveAttribute('data-heart-style', 'solid');

  const search = page.getByRole('textbox', { name: /search by location/i });
  await search.fill('US9002');
  const outdatedFlow = page.locator('[data-kiosk-flow-version="478"]').first();
  await expect(outdatedFlow).toHaveText('F:478');
  await expect(outdatedFlow).toHaveAttribute('data-flow-version-match', 'false');
  await expect(outdatedFlow).toHaveAttribute('data-flow-version-status', 'behind');
  await expect(outdatedFlow).toHaveClass(/text-orange-400/);
  await expect(page.locator('[data-module-firmware="1"]').first()).toHaveAttribute('data-heart-style', 'broken');

  await search.fill('US9003');
  const aheadFlow = page.locator('[data-kiosk-flow-version="500"]').first();
  await expect(aheadFlow).toHaveAttribute('data-flow-version-status', 'ahead');
  await expect(aheadFlow).toHaveClass(/text-gray-400/);

  await search.fill('US9004');
  await expect(page.locator('[data-module-firmware="unknown"]').first()).toHaveAttribute('data-heart-style', 'broken');
});

test('desktop-only reporting and analytics controls are absent on mobile', async ({ page }) => {
  await expect(page.getByTitle('Reporting')).toHaveCount(0);
  await expect(page.getByTitle('Station Analytics')).toHaveCount(0);
});

test('compact rental summaries preserve dashboard activity cards', async ({ page }) => {
  await page.goto(`${HARNESS_URL}?rentalSummaries=1`);
  await expect(page.getByRole('heading', { name: 'RESILIENCE TEST LOCATION 1' })).toBeVisible();
  await expect(page.getByText('Rental Activity').first()).toBeVisible();
  await expect(page.getByText('30 Days').first()).toBeVisible();
});

test('summary-only clients cannot open rental details', async ({ page }) => {
  await page.goto(`${HARNESS_URL}?rentalSummaries=1&noRentalDetails=1`);
  await expect(page.getByRole('heading', { name: 'RESILIENCE TEST LOCATION 1' })).toBeVisible();
  await expect(page.getByText('Rental Activity').first()).toBeVisible();
  await expect(page.getByTitle('Rentals')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Today/ }).first()).toBeDisabled();
});

test('rendering performance stays within the mobile DOM and commit budgets', async ({ page }, testInfo) => {
  const baseline = await page.evaluate(() => ({
    buttons: document.querySelectorAll('button').length,
    domNodes: document.querySelectorAll('*').length,
    metrics: window.__dashboardRenderMetrics,
    scrollHeight: document.documentElement.scrollHeight,
  }));

  await testInfo.attach('render-baseline.json', {
    body: JSON.stringify(baseline, null, 2),
    contentType: 'application/json',
  });
  console.log(`[ui-resilience] render baseline ${JSON.stringify(baseline)}`);

  expect.soft(baseline.domNodes).toBeLessThan(1_200);
  expect.soft(baseline.buttons).toBeLessThan(100);
  expect.soft(baseline.scrollHeight).toBeLessThan(10_000);
  expect.soft(baseline.metrics.maxActualDuration).toBeLessThan(250);
});

test('touch confirmation opens and cancels promptly during heartbeat churn', async ({ page }, testInfo) => {
  await openTargetKiosk(page);
  await page.evaluate(() => window.__dashboardHarness.startChurn(40));

  const reloadButton = page.getByRole('button', { name: 'Reload UI', exact: true });
  const openDurations = [];
  const cancelDurations = [];

  for (let sample = 0; sample < 5; sample += 1) {
    const openStartedAt = Date.now();
    await reloadButton.tap({ timeout: 5_000 });
    openDurations.push(Date.now() - openStartedAt);

    await expect(page.getByRole('heading', { name: 'Confirm Action' })).toBeVisible();

    const cancelStartedAt = Date.now();
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap({ timeout: 5_000 });
    cancelDurations.push(Date.now() - cancelStartedAt);
    await expect(page.getByRole('heading', { name: 'Confirm Action' })).toHaveCount(0);
  }

  await page.evaluate(() => window.__dashboardHarness.stopChurn());
  const touchTiming = {
    cancelDurations,
    maxCancelDuration: Math.max(...cancelDurations),
    maxOpenDuration: Math.max(...openDurations),
    openDurations,
  };
  await testInfo.attach('touch-timing.json', {
    body: JSON.stringify(touchTiming, null, 2),
    contentType: 'application/json',
  });
  console.log(`[ui-resilience] touch timing ${JSON.stringify(touchTiming)}`);
  expect.soft(touchTiming.maxOpenDuration).toBeLessThan(200);
  expect.soft(touchTiming.maxCancelDuration).toBeLessThan(200);
});

test('a confirmation remains the only active blocking modal', async ({ page }) => {
  await openTargetKiosk(page);
  await page.getByRole('button', { name: 'Reload UI', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Confirm Action' })).toBeVisible();

  await page.evaluate(() => window.__dashboardHarness.openCompetingModal());
  await expect(page.getByRole('heading', { name: 'Ngrok Connection Established' })).toHaveCount(0);

  const blockingOverlays = page.locator('.fixed.inset-0');
  const cancelIsTopmost = await page.getByRole('button', { name: 'Cancel', exact: true }).evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const topElement = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return topElement === button || button.contains(topElement);
  });

  expect.soft(await blockingOverlays.count()).toBe(1);
  expect.soft(cancelIsTopmost).toBe(true);

  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Ngrok Connection Established' })).toBeVisible();
  await expect(blockingOverlays).toHaveCount(1);
});

test('the last good dashboard remains visible through disconnect and recovery', async ({ page }) => {
  await page.evaluate(() => window.__dashboardHarness.disconnect());
  await page.waitForTimeout(150);
  const remainedVisible = await page.getByRole('heading', { name: TARGET_STATION_ID, exact: true }).isVisible();

  await page.evaluate(() => window.__dashboardHarness.recover());
  await expect(page.getByRole('heading', { name: TARGET_STATION_ID, exact: true })).toBeVisible();

  expect(remainedVisible).toBe(true);
  await expect(page.getByText('Loading...')).toHaveCount(0);
});

test('persistent SSH remains available while Node-RED-dependent controls are offline', async ({ page }) => {
  await page.evaluate(() => window.__dashboardHarness.setTargetOffline());
  await openTargetKiosk(page);

  const sshButton = page.getByRole('button', { name: 'SSH', exact: true });
  await expect(sshButton).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Ngrok', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reload UI', exact: true })).toBeDisabled();

  await sshButton.tap();
  await expect(page.getByRole('heading', { name: 'Confirm Action' })).toBeVisible();
});

test('@desktop kiosk detail controls preserve the desktop scroll position', async ({ page }) => {
  const search = page.getByRole('textbox', { name: /search by location/i });
  await search.fill(TARGET_STATION_ID);
  const kioskHeading = page.getByRole('heading', { name: TARGET_STATION_ID, exact: true });
  await expect(kioskHeading).toBeVisible();
  await kioskHeading.click();

  const detailPanel = page.locator(`[data-kiosk-detail-panel="true"][data-kiosk-stationid="${TARGET_STATION_ID}"]`);
  await expect(detailPanel).toBeVisible();
  const reloadButton = page.getByRole('button', { name: 'Reload UI', exact: true });
  await reloadButton.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await reloadButton.click();
  await expect(page.getByRole('heading', { name: 'Confirm Action' })).toBeVisible();
  const scrollWithModal = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollWithModal - scrollBefore)).toBeLessThanOrEqual(2);

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm Action' })).toHaveCount(0);
  const scrollAfterCancel = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollAfterCancel - scrollBefore)).toBeLessThanOrEqual(2);
});

test('@desktop reporting remains available', async ({ page }) => {
  await expect(page.getByTitle('Reporting')).toBeVisible();
});
