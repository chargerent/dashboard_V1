import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeKioskData } from '../src/utils/helpers.js';
import {
  formatKioskUiProfileName,
  resolveKioskUiProfileStatus,
} from '../src/utils/kioskUiProfileStatus.js';

const desiredUi = {
  profileId: 'test-test',
  profileName: 'TEST Kiosk UI',
  profileVersion: 53,
  profileAppliedAt: '2026-08-03T07:45:11.567Z',
};

test('confirmed kiosk report identifies the loaded profile and version', () => {
  const status = resolveKioskUiProfileStatus({
    ui: desiredUi,
    reportedUiProfile: {
      profileId: 'test-test',
      profileVersion: 53,
      status: 'applied',
      appliedAt: '2026-08-03T07:45:11.567Z',
    },
    uiProfileReportedAt: '2026-08-06T08:00:00.000Z',
  });

  assert.equal(status.state, 'confirmed');
  assert.equal(status.statusLabel, 'Loaded');
  assert.equal(status.profileName, 'TEST');
  assert.equal(status.versionLabel, 'Version 53');
  assert.equal(status.isConfirmed, true);
});

test('profile display names omit the redundant Kiosk UI suffix', () => {
  assert.equal(formatKioskUiProfileName('Children’s Hospital Kiosk UI'), 'Children’s Hospital');
  assert.equal(formatKioskUiProfileName('BAY101 kiosk ui  '), 'BAY101');
  assert.equal(formatKioskUiProfileName('Custom Profile'), 'Custom Profile');
});

test('published profile without a kiosk acknowledgement remains pending', () => {
  const status = resolveKioskUiProfileStatus({ ui: desiredUi });

  assert.equal(status.state, 'pending');
  assert.equal(status.statusLabel, 'Awaiting confirmation');
  assert.equal(status.profileId, 'test-test');
});

test('a different reported version is visibly out of sync', () => {
  const status = resolveKioskUiProfileStatus({
    ui: desiredUi,
    reportedUiProfile: {
      profileId: 'test-test',
      profileVersion: 52,
      status: 'applied',
    },
  });

  assert.equal(status.state, 'out-of-sync');
  assert.equal(status.profileVersion, 52);
  assert.equal(status.desiredVersion, 53);
});

test('legacy kiosks do not invent profile metadata', () => {
  const status = resolveKioskUiProfileStatus({ ui: { mode: 'UI' } });

  assert.equal(status.state, 'legacy');
  assert.equal(status.profileName, 'No managed profile');
  assert.equal(status.updatedLabel, 'Unknown');
});

test('kiosk normalization preserves desired and reported profile fields', () => {
  const [kiosk] = normalizeKioskData([{
    stationid: 'US0118',
    provisionid: 'id-5446395998',
    hardware: { type: 'CT10' },
    info: { client: 'TEST' },
    ui: desiredUi,
    uiProfileId: 'test-test',
    reportedUiProfile: {
      profileId: 'test-test',
      profileVersion: 53,
      status: 'applied',
    },
    uiProfileReportedAt: '2026-08-06T08:00:00.000Z',
  }]);

  assert.equal(kiosk.uiProfileId, 'test-test');
  assert.equal(kiosk.reportedUiProfile.profileVersion, 53);
  assert.equal(kiosk.uiProfileReportedAt, '2026-08-06T08:00:00.000Z');
});
