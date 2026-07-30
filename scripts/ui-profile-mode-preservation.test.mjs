import test from 'node:test';
import assert from 'node:assert/strict';

import uiProfileSnapshot from '../functions/uiProfileSnapshot.js';

const { preserveProvisionedUiMode } = uiProfileSnapshot;

test('profile publishing preserves the mode set during kiosk provisioning', () => {
  assert.deepEqual(
    preserveProvisionedUiMode(
      { mode: 'UI', colors: { primary: '#123456' } },
      { mode: 'PAYTER', idletime: 20 },
    ),
    { mode: 'PAYTER', colors: { primary: '#123456' } },
  );
});

test('profile publishing does not introduce mode when the kiosk has none', () => {
  const snapshot = preserveProvisionedUiMode(
    { mode: 'UI', colors: { primary: '#123456' } },
    { idletime: 20 },
  );

  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'mode'), false);
  assert.deepEqual(snapshot.colors, { primary: '#123456' });
});
