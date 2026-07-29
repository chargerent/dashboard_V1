import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultKioskUiProfile,
  createKioskUiProfileFromTemplate,
} from '../src/utils/kioskUiProfiles.js';

test('new client profile copies TEST content while preserving target identity', () => {
  const testProfile = createDefaultKioskUiProfile('TEST');
  testProfile.status = 'published';
  testProfile.admin.userpassword = '12345';
  testProfile.ui.colors.bcolor1 = '#123456';
  testProfile.languages.locales.en.screens.start.title = 'TEST welcome';

  const profile = createKioskUiProfileFromTemplate('Bay 101', testProfile);

  assert.equal(profile.id, 'bay-101');
  assert.equal(profile.name, 'BAY 101 Kiosk UI');
  assert.equal(profile.clientId, 'BAY 101');
  assert.equal(profile.version, 1);
  assert.equal(profile.status, 'published');
  assert.deepEqual(profile.admin, testProfile.admin);
  assert.deepEqual(profile.ui, testProfile.ui);
  assert.deepEqual(profile.languages, testProfile.languages);

  profile.ui.colors.bcolor1 = '#FFFFFF';
  assert.equal(testProfile.ui.colors.bcolor1, '#123456');
});

test('new client profile falls back to hard-coded defaults when TEST is unavailable', () => {
  assert.deepEqual(
    createKioskUiProfileFromTemplate('NEWCLIENT'),
    createDefaultKioskUiProfile('NEWCLIENT'),
  );
});
