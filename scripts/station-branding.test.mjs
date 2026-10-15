import test from 'node:test';
import assert from 'node:assert/strict';
import {hasStationScreen} from '../functions/uiProfileSections.mjs';
import {normalizeKioskData} from '../src/utils/helpers.js';
import {createProfilePreviewApi} from '../src/utils/profilePreview.js';

test('screen eligibility accepts display sizes and excludes payment-terminal-only kiosks', () => {
  for (const screen of [7, '7in', '10IN', '21inch', '32inches', 'E21', '15.6', '49"'])
    assert.equal(hasStationScreen({hardware: {screen}}), true, String(screen));
  for (const screen of [undefined, null, '', 0, '0in', 'NO', 'no screen', 'unknown', 'APOLLO'])
    assert.equal(hasStationScreen({hardware: {screen, gateway: 'APOLLO'}, profileCapabilities: {chargerentApp: true}}), false);
});

test('dashboard normalization retains every station brand and defaults older records', () => {
  for (const brand of ['chargerent', 'eventcharging', 'chargedrops', undefined]) {
    const kiosk = {stationid: 'US6000', provisionid: 'id-lita', stationBrand: brand, hardware: {type: 'CT12'}, modules: []};
    assert.equal(normalizeKioskData([kiosk])[0].stationBrand, brand || 'chargerent');
  }
});

test('preview brand changes never mutate a shared profile or the source fixtures', async () => {
  const api = createProfilePreviewApi();
  const before = await api('uiProfile_list', {});
  const result = await api('uiProfile_setStationBrand', {stationid: 'SAMPLE-M01', stationBrand: 'eventcharging', expectedStationBrand: 'chargerent'});
  assert.equal(result.kiosk.stationBrand, 'eventcharging');
  assert.deepEqual(await api('uiProfile_list', {}), before);
  await assert.rejects(api('uiProfile_setStationBrand', {stationid: 'SAMPLE-M02', stationBrand: 'chargedrops', expectedStationBrand: 'chargerent'}), /screen/);
});
