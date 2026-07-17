import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LEGACY_UNTARGETED_RESPONSE_WINDOW_MS,
  getCommandResponseRequestIds,
  getMatchingLegacyCommandScope,
  getMatchingOutgoingCommandScope,
  normalizeKioskCommandAction,
  parseKioskSoftwareUpdateResponse,
} from '../src/utils/kioskCommandResponses.js';

test('normalizes the kiosk update action aliases', () => {
  assert.equal(normalizeKioskCommandAction('updateflow'), 'update flow');
  assert.equal(normalizeKioskCommandAction('update_ui'), 'update ui');
});

test('parses the real legacy flow update progress and completion messages', () => {
  assert.deepEqual(
    parseKioskSoftwareUpdateResponse({
      action: 'updateflow',
      status_en: 'Disabling nodes . . .',
      admin: 'legacy-session',
      sender: 'kiosk',
    }),
    {
      action: 'update flow',
      complete: false,
      message: 'Disabling nodes . . .',
      stationid: '',
      state: 'pending',
      version: '',
    }
  );

  assert.deepEqual(
    parseKioskSoftwareUpdateResponse({
      action: 'updateflow',
      status_en: 'Flow on kiosk FR1009 has been updated to 469 07/09/26',
      admin: 'legacy-session',
      statuscode: '1',
      provisionid: 'provision-1',
      version: '469 07/09/26',
      stationid: 'FR1009',
      sender: 'kiosk',
    }),
    {
      action: 'update flow',
      complete: true,
      message: 'Flow on kiosk FR1009 has been updated to 469 07/09/26',
      stationid: 'FR1009',
      state: 'success',
      version: '469 07/09/26',
    }
  );
});

test('parses structured and message-only software update responses', () => {
  assert.deepEqual(
    parseKioskSoftwareUpdateResponse({
      status_en: 'Updated flow for kiosk US0118 from version 468 to 469',
    }),
    {
      action: 'update flow',
      complete: true,
      message: 'Updated flow for kiosk US0118 from version 468 to 469',
      stationid: 'US0118',
      state: 'success',
      version: '469',
    }
  );

  assert.deepEqual(
    parseKioskSoftwareUpdateResponse({
      payload: {
        action: 'updateui',
        status_en: 'UI on kiosk US0118 has been updated to 2.5.0',
        statuscode: 1,
        stationid: 'US0118',
        uiVersion: '2.5.0',
      },
    }, 'ui'),
    {
      action: 'update ui',
      complete: true,
      message: 'UI on kiosk US0118 has been updated to 2.5.0',
      stationid: 'US0118',
      state: 'success',
      version: '2.5.0',
    }
  );
});

test('does not treat accepted or in-progress updates as installed versions', () => {
  assert.deepEqual(
    parseKioskSoftwareUpdateResponse({
      action: 'updateflow',
      stationid: 'US0118',
      version: '2.0',
      status: 'accepted',
    }),
    {
      action: 'update flow',
      complete: false,
      message: '',
      stationid: 'US0118',
      state: 'pending',
      version: '2.0',
    }
  );

  assert.equal(
    parseKioskSoftwareUpdateResponse({
      action: 'updateui',
      status_en: 'UI is being updated to version 2.0.',
      stationid: 'US0118',
      version: '2.0',
    }, 'ui')?.complete,
    false
  );
});

test('gives an explicit action priority over words in the message', () => {
  const response = {
    action: 'updateui',
    status_en: 'Writing flow data for kiosk US0118 . . .',
    stationid: 'US0118',
    version: '2.0',
  };

  assert.equal(parseKioskSoftwareUpdateResponse(response, 'flow'), null);
  assert.equal(parseKioskSoftwareUpdateResponse(response, 'ui')?.action, 'update ui');

  assert.equal(parseKioskSoftwareUpdateResponse({
    action: 'uichange',
    status_en: 'Please wait, changing kiosk UI on station US0118...',
    stationid: 'US0118',
    uiVersion: '2.0',
    statuscode: 1,
  }, 'ui'), null);
});

test('rejects invalid message-only station tokens and trims version punctuation', () => {
  assert.equal(parseKioskSoftwareUpdateResponse({
    status_en: 'Flow for kiosk has been updated to 2.0.',
  })?.stationid, '');

  assert.equal(parseKioskSoftwareUpdateResponse({
    status_en: 'Flow for kiosk US0118 has been updated to 2.0.',
  })?.version, '2.0');
});

test('matches request IDs and legacy update confirmations to an outgoing command', () => {
  const now = 1_000_000;
  const requestId = 'update-flow-FR1009-na-1';
  const scope = {
    action: 'update flow',
    stationid: 'FR1009',
    provisionid: 'provision-1',
    requestId,
    createdAt: now - 1_000,
  };
  const scopes = new Map([[requestId, scope]]);

  const nestedRequestIds = getCommandResponseRequestIds({
    payload: { requestId: `${requestId}-kiosk` },
  });
  assert.equal(getMatchingOutgoingCommandScope(scopes, nestedRequestIds), scope);
  assert.equal(getMatchingLegacyCommandScope(scopes, {
    action: 'updateflow',
    status_en: 'Writing flow to disk . . .',
    admin: 'legacy-session',
    sender: 'kiosk',
  }, now), scope);
  assert.equal(getMatchingLegacyCommandScope(scopes, {
    action: 'updateflow',
    stationid: 'FR1009',
    provisionid: 'provision-1',
    admin: 'legacy-session',
    sender: 'kiosk',
    status_en: 'Flow on kiosk FR1009 has been updated to 469',
  }, now), scope);
  assert.equal(getMatchingLegacyCommandScope(scopes, {
    action: 'updateflow',
    stationid: 'US0118',
    admin: 'legacy-session',
    sender: 'kiosk',
    status_en: 'Flow on kiosk US0118 has been updated to 469',
  }, now), null);
  assert.equal(getMatchingLegacyCommandScope(scopes, {
    action: 'updateflow',
    admin: 'legacy-session',
    sender: 'kiosk',
    status_en: 'Writing flow to disk . . .',
  }, now + LEGACY_UNTARGETED_RESPONSE_WINDOW_MS + 1), null);
});

test('does not fall back from a foreign request ID or ambiguous legacy commands', () => {
  const requestId = 'update-flow-FR1009-na-2';
  const scope = {
    action: 'update flow',
    stationid: 'FR1009',
    requestId,
    createdAt: 999_000,
  };
  const scopes = new Map([[requestId, scope]]);

  assert.equal(getMatchingLegacyCommandScope(scopes, {
    action: 'updateflow',
    requestId: 'another-browser-request',
    stationid: 'FR1009',
    admin: 'another-browser-session',
    sender: 'kiosk',
    status_en: 'Writing flow to disk . . .',
  }, 1_000_000), null);

  scopes.set('update-flow-FR1009-na-3', {
    ...scope,
    requestId: 'update-flow-FR1009-na-3',
    createdAt: 999_500,
  });
  assert.equal(getMatchingLegacyCommandScope(scopes, {
    action: 'updateflow',
    admin: 'legacy-session',
    sender: 'kiosk',
    status_en: 'Writing flow to disk . . .',
  }, 1_000_000), null);
});

test('the tracked Node-RED update commands preserve correlation and target fields', async () => {
  const flow = JSON.parse(await readFile(new URL('../updated flow.json', import.meta.url), 'utf8'));
  const nodesByName = new Map(flow.map((node) => [node.name, node]));
  const flowPayload = nodesByName.get('flow update command')?.rules?.find((rule) => rule.p === 'payload')?.to || '';
  const uiPayload = nodesByName.get('ui update command')?.rules?.find((rule) => rule.p === 'payload')?.to || '';

  for (const payload of [flowPayload, uiPayload]) {
    assert.match(payload, /command\.stationid/);
    assert.match(payload, /command\.provisionid/);
    assert.match(payload, /command\.version/);
    assert.match(payload, /command\.requestId/);
  }
  assert.doesNotMatch(uiPayload, /command\.uiVersion/);
});
