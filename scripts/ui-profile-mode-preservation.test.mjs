import test from 'node:test';
import assert from 'node:assert/strict';

import uiProfileSnapshot from '../functions/uiProfileSnapshot.js';

const { preserveProvisionedUiMode } = uiProfileSnapshot;

test('profile publishing preserves kiosk-owned UI metadata', () => {
  assert.deepEqual(
    preserveProvisionedUiMode(
      {
        mode: 'UI',
        version: '',
        created: '',
        colors: { primary: '#123456' },
      },
      {
        mode: 'PAYTER',
        version: '43.0',
        created: '2025-04-08',
        idletime: 20,
      },
    ),
    {
      mode: 'PAYTER',
      version: '43.0',
      created: '2025-04-08',
      colors: { primary: '#123456' },
    },
  );
});

test('profile publishing does not introduce kiosk-owned metadata when the kiosk has none', () => {
  const snapshot = preserveProvisionedUiMode(
    {
      mode: 'UI',
      version: '',
      created: '',
      colors: { primary: '#123456' },
    },
    { idletime: 20 },
  );

  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'mode'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'version'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'created'), false);
  assert.deepEqual(snapshot.colors, { primary: '#123456' });
});
