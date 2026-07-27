import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDashboardAssignedStationId,
  isAiBoothProvision,
} from '../src/utils/provisioning.js';

test('regular kiosk provisioning leaves station ID assignment to the server', () => {
  const pendingKiosk = {
    provisionid: 'id-1234567890',
    hardware: { type: 'CT10' },
  };

  assert.equal(isAiBoothProvision(pendingKiosk), false);
  assert.deepEqual(
    applyDashboardAssignedStationId(
      { provisionid: pendingKiosk.provisionid, stationid: 'US8000' },
      pendingKiosk,
      'US8000',
    ),
    { provisionid: pendingKiosk.provisionid },
  );
});

test('AI booth provisioning retains its dashboard-assigned station ID', () => {
  const pendingBooth = {
    provisionid: 'aid-1234567890',
    hardware: { type: 'CA36' },
  };

  assert.equal(isAiBoothProvision(pendingBooth), true);
  assert.deepEqual(
    applyDashboardAssignedStationId(
      { provisionid: pendingBooth.provisionid },
      pendingBooth,
      'US9000',
    ),
    { provisionid: pendingBooth.provisionid, stationid: 'US9000' },
  );
});
