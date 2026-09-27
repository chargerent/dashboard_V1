import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import workspaceModule from '../functions/workspaceProvisioning.js';
import workspaceNotificationModule from '../functions/workspaceNotification.js';

// Run the real account handlers and exported endpoint callbacks with isolated
// Auth, Firestore, and email effects. Importing index.js would initialize Firebase.
const code = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
function sourceBetween(startMarker, endMarker) {
  const start = code.indexOf(startMarker);
  const end = code.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing handler boundary: ${startMarker}`);
  return code.slice(start, end);
}
const source = [
  sourceBetween('function cleanProfile(', 'function getDashboardLoginUrl('),
  sourceBetween('async function upsertUserProfileImpl(', 'async function setUserPasswordImpl('),
  sourceBetween('exports.admin_createAuthUserAndProfile =', 'exports.admin_setUserPassword ='),
  sourceBetween('exports.admin_httpCreateAuthUserAndProfile =', 'exports.admin_httpSetUserPassword ='),
].join('\n');

const actor = {uid: 'allowed-admin', isAdmin: true, profile: {username: 'admin'}};
const otherAdmin = {uid: 'other-admin', isAdmin: true, profile: {username: 'other'}};
const dashboardPassword = 'Dashboard-test-secret-123';
const googlePassword = 'Google-test-secret-456';
const rawProviderSecret = 'Provider-private-response-test-marker';
const contactEmail = 'jane@example.net';
const clone = (value) => structuredClone(value);
const mailbox = {
  localPart: 'j.smith', givenName: 'Jane', familyName: 'Smith',
  recoveryEmail: 'jane@example.net',
};
const request = (overrides = {}) => ({
  username: 'jane.smith', password: dashboardPassword, clientId: 'CLIENT',
  ...overrides,
  profile: {role: 'partner', name: 'Jane Smith', contact: {email: contactEmail}, ...overrides.profile},
});
const readyMailbox = {
  status: 'ready', email: 'j.smith@charge.rent', googleUserId: 'google-user-1',
  temporaryPassword: googlePassword, passwordAvailable: true,
};

function harness(options = {}) {
  const records = new Map(Object.entries(options.records || {}).map(([key, value]) => [key, clone(value)]));
  const calls = {create: [], remove: [], authUpdates: [], reads: [], writes: [], batches: [], transactions: [], claims: [], invite: [], kitPreflight: [], notifications: [], availability: [], provision: [], authorization: []};
  const applyWrite = ({path, value, settings}) => {
    calls.writes.push({path, value: clone(value)});
    records.set(path, {...(settings?.merge ? records.get(path) : {}), ...clone(value)});
  };
  const db = {collection: (name) => ({doc: (uid) => {
    const path = `${name}/${uid}`;
    return {
      path,
      get: async () => {
        calls.reads.push(path);
        return {exists: records.has(path), data: () => clone(records.get(path))};
      },
      set: async (value, settings) => applyWrite({path, value, settings}),
    };
  }}),
  batch: () => {
    const pending = [];
    return {
      set: (ref, value, settings) => pending.push({path: ref.path, value: clone(value), settings}),
      commit: async () => {
        calls.batches.push(clone(pending));
        if (options.batchError) throw options.batchError;
        pending.forEach(applyWrite);
      },
    };
  },
  runTransaction: async (handler) => {
    calls.transactions.push(calls.transactions.length + 1);
    if (options.failFirstClaim && calls.transactions.length === 1) throw new Error('Temporary Firestore claim failure');
    const pending = [];
    const result = await handler({
      get: (ref) => ref.get(),
      set: (ref, value, settings) => pending.push({path: ref.path, value: clone(value), settings}),
      update: (ref, value) => {
        assert.ok(records.has(ref.path));
        pending.push({path: ref.path, value: clone(value), settings: {merge: true}});
      },
    });
    pending.forEach(applyWrite);
    return result;
  }};
  const admin = {
    auth: () => ({
      createUser: async (value) => {
        calls.create.push(clone(value));
        return {uid: 'new-dashboard-user'};
      },
      deleteUser: async (uid) => { calls.remove.push(uid); },
      updateUser: async (uid, changes) => { calls.authUpdates.push({uid, changes: clone(changes)}); },
    }),
    app: () => ({options: {credential: {getAccessToken: async () => ({access_token: 'fake-runtime-token'})}}}),
    firestore: {FieldValue: {serverTimestamp: () => 'server-time'}},
  };
  // Exercise the real configuration, allowlist and request validation logic;
  // replace only operations which would contact Google or create a mailbox.
  const workspaceProvisioning = workspaceModule.createWorkspaceProvisioning({
    admin, db,
    fetchImpl: async (url, details) => {
      assert.equal(options.useRealProvisioning, true, 'Unexpected network operation in account handler test');
      const response = (status, body) => ({ok: status === 200, status, json: async () => body});
      if (url.includes(':signJwt')) return response(200, {signedJwt: 'fake-signed-jwt'});
      if (url.includes('oauth2.googleapis.com/token')) return response(200, {access_token: 'fake-delegated-token', expires_in: 3600});
      if (details.method === 'GET') return response(404, {});
      const body = JSON.parse(details.body);
      return response(200, {...body, id: 'google-user-1', isMailboxSetup: true});
    },
    env: {
      WORKSPACE_PROVISIONING_ENABLED: options.enabled === false ? 'false' : 'true',
      WORKSPACE_DOMAIN: 'charge.rent',
      WORKSPACE_ADMIN_EMAIL: 'workspace-admin@charge.rent',
      WORKSPACE_SERVICE_ACCOUNT_EMAIL: 'workspace-provisioning@node-red-alerts.iam.gserviceaccount.com',
      WORKSPACE_DASHBOARD_ADMIN_UIDS: actor.uid,
      ...options.env,
    },
  });
  workspaceProvisioning.checkAvailability = async (localPart, details) => {
    calls.availability.push({localPart, ...details});
    if (options.availabilityError) throw options.availabilityError;
    return {available: options.available !== false, email: `${localPart}@charge.rent`};
  };
  const provision = workspaceProvisioning.provision;
  workspaceProvisioning.provision = async (details) => {
    calls.provision.push(clone(details));
    if (options.provisionError) throw options.provisionError;
    if (options.useRealProvisioning) return provision(details);
    return clone(options.mailboxResult || readyMailbox);
  };
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const https = {
    HttpsError,
    onCall: (handler) => handler,
    onRequest: (handler) => handler,
  };
  const authorize = async (authState, endpointType) => {
    calls.authorization.push(endpointType);
    if (!authState?.isAdmin) throw new HttpsError('permission-denied', 'Admin access required');
    return authState;
  };
  const deps = {
    db, admin, workspaceProvisioning, AUTH_MAPPING_DOMAIN: 'dashboard.test',
    isValidWorkspaceContactEmail: workspaceNotificationModule.isValidWorkspaceContactEmail,
    preparePartnerKit: async ({includePartnerKit, role}) => {
      if (!includePartnerKit) return null;
      calls.kitPreflight.push({includePartnerKit, role});
      if (role !== 'partner') throw new HttpsError('permission-denied', 'Partner kits are only available for partners.');
      if (options.kitError) throw options.kitError;
      return {
        attachment: {filename: 'Chargerent_Regional_Partner_Launch_Kit.pdf', content: Buffer.from('isolated-pdf-test-content'), contentType: 'application/pdf'},
        metadata: {filename: 'Chargerent_Regional_Partner_Launch_Kit.pdf', sha256: 'isolated-kit-sha256', sizeBytes: 25},
      };
    },
    exports: {}, functions: {https, runWith: () => ({https})},
    GMAIL_APP_PASSWORD: {}, GOOGLE_MAPS_SECRET: 'GOOGLE_MAPS_API_KEY',
    CHARGEDROPS_AGREEMENT_OTP_SECRET: {}, STRIPE_CONNECT_SECRET_KEY: {},
    STRIPE_CONNECT_WEBHOOK_SECRET: {}, STRIPE_TEST_SECRET_KEY: {},
    ELEVENLABS_API_KEY: {}, EVENT_INTAKE_SECRET: {}, SLASH_GOLF_RAPIDAPI_KEY: {},
    PHONE_CONTROL_SIGNING_PRIVATE_KEY: {}, TURN_SHARED_SECRET: {},
    BESITER_MQTT_CREDENTIALS: {}, PAYTER_CPS_API_KEY: {},
    CONTACT_FORM_WEBHOOK_TOKEN: {}, SUPPORT_COMMUNICATIONS_WEBHOOK_TOKEN: {},
    CHATBOT_SUPPORT_WEBHOOK_TOKEN: {},
    handleHttpFunction: (handler) => handler,
    assertAdmin: (req) => authorize(req.authState, 'http'),
    assertAdminFromContext: (context) => authorize(context.authState, 'callable'),
    syncCustomClaimsForProfile: async (uid, profile) => {
      calls.claims.push({uid, profile: clone(profile)});
      if (options.claimsError) throw options.claimsError;
    },
    sendLoginInviteImpl: async (details, authState, preparedKit) => {
      calls.invite.push({details: clone(details), actorUid: authState.uid, preparedKit: clone(preparedKit)});
      if (options.inviteError) throw options.inviteError;
      return {partnerKitIncluded: details.includePartnerKit === true};
    },
    notifyWorkspaceMailboxSafely: async (uid, workspaceMailbox, authState, resendUnknown = false) => {
      calls.notifications.push({uid, workspaceMailbox: clone(workspaceMailbox), actorUid: authState.uid, resendUnknown});
      return {
        ...workspaceMailbox,
        notificationStatus: 'sent',
        notificationEmail: records.get(`workspaceProvisioning/${uid}`)?.contactEmail || contactEmail,
        notificationMessage: 'Company email address sent to the partner.',
        ...options.notificationResult,
      };
    },
    console: {error: () => {}},
  };
  const handlers = new Function(...Object.keys(deps), `${source}; return {
    create: createAuthUserAndProfileImpl, upsert: upsertUserProfileImpl,
    status: workspaceStatusImpl, check: workspaceCheckEmailImpl,
    retry: retryWorkspaceMailboxImpl, endpoints: exports,
  };`)(...Object.values(deps));
  return {records, calls, ...handlers};
}

test('every new account needs a valid existing contact email before any creation or Google effects', async () => {
  for (const role of ['partner', 'admin', 'user']) {
    for (const contact of [
      undefined, {}, {email: ''}, {email: 'not-an-email'},
      {email: 'jane@example..com'}, {email: 'jane<@example.net'},
      {email: 'jane..doe@example.net'}, {email: `${'a'.repeat(65)}@example.net`},
    ]) {
      const h = harness();
      await assert.rejects(h.create(request({profile: {role, contact}}), actor), {code: 'invalid-argument'});
      assert.equal(h.calls.create.length, 0);
      assert.equal(h.calls.availability.length, 0);
      assert.equal(h.calls.provision.length, 0);
      assert.equal(h.calls.writes.length, 0);
      assert.equal(h.calls.invite.length, 0);
      assert.equal(h.calls.notifications.length, 0);
    }
  }
  const h = harness();
  await assert.rejects(h.create(request({profile: {contact: {}}, workspaceMailbox: mailbox}), actor), {code: 'invalid-argument'});
  assert.equal(h.calls.availability.length, 0);
  assert.equal(h.calls.create.length, 0);
});

test('the contact email cannot be the new company mailbox, even with case or whitespace differences', async () => {
  const h = harness();
  await assert.rejects(h.create(request({
    profile: {contact: {email: ' J.SMITH@charge.rent '}}, workspaceMailbox: mailbox,
  }), actor), {code: 'invalid-argument'});
  assert.equal(h.calls.availability.length, 0);
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.calls.provision.length, 0);
  assert.equal(h.calls.notifications.length, 0);
});

test('a dashboard admin can be created without a Client ID', async () => {
  const h = harness();
  const result = await h.create(request({clientId: '', profile: {role: 'admin', name: 'Jane Smith'}}), actor);
  assert.equal(result.ok, true);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.records.get('users/new-dashboard-user').role, 'admin');
  assert.equal(h.records.get('users/new-dashboard-user').clientId, '');
  assert.equal(h.calls.claims[0].profile.clientId, '');
});

test('partner and ordinary client creation still require a Client ID', async () => {
  for (const role of ['partner', 'user']) {
    const h = harness();
    await assert.rejects(h.create(request({profile: {role}, clientId: ''}), actor), {code: 'invalid-argument'});
    assert.equal(h.calls.create.length, 0);
    const result = await h.create(request({profile: {role}, clientId: ' test '}), actor);
    assert.equal(result.ok, true);
    assert.equal(h.records.get('users/new-dashboard-user').clientId, 'TEST');
  }
});

test('disabled configuration and an unallowlisted admin fail before dashboard or Google effects', async () => {
  for (const [options, authState] of [[{enabled: false}, actor], [{}, otherAdmin], [{env: {WORKSPACE_ADMIN_EMAIL: ''}}, actor]]) {
    const h = harness(options);
    await assert.rejects(h.create(request({workspaceMailbox: mailbox}), authState), {code: 'permission-denied'});
    assert.equal(h.calls.create.length, 0);
    assert.equal(h.calls.availability.length, 0);
    assert.equal(h.calls.provision.length, 0);
    assert.equal(h.calls.writes.length, 0);
  }
});

test('admin and ordinary-user recipients cannot receive a mailbox even from an authorized admin', async () => {
  for (const role of ['admin', 'user']) {
    const h = harness();
    await assert.rejects(h.create(request({clientId: role === 'admin' ? '' : 'CLIENT', profile: {role}, workspaceMailbox: mailbox}), actor), {code: 'permission-denied'});
    assert.equal(h.calls.create.length, 0);
    assert.equal(h.calls.availability.length, 0);
    assert.equal(h.calls.provision.length, 0);
    assert.equal(h.calls.writes.length, 0);
    assert.equal(h.calls.claims.length, 0);
    assert.equal(h.calls.invite.length, 0);
  }
});

test('an existing Google address fails preflight without creating a dashboard user', async () => {
  const h = harness({available: false});
  await assert.rejects(h.create(request({workspaceMailbox: mailbox}), actor), {code: 'already-exists'});
  assert.deepEqual(h.calls.availability, [{localPart: 'j.smith', actorUid: actor.uid}]);
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.provision.length, 0);
});

test('a Google preflight failure is sanitized and leaves no dashboard account', async () => {
  const h = harness({availabilityError: new Error(rawProviderSecret)});
  await assert.rejects(h.create(request({workspaceMailbox: mailbox}), actor), (error) => {
    assert.equal(error.code, 'unavailable');
    assert.equal(error.message.includes(rawProviderSecret), false);
    return true;
  });
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.calls.writes.length, 0);
});

test('a mailbox failure preserves dashboard success and allows the login invite to succeed', async () => {
  const h = harness({provisionError: new Error(rawProviderSecret)});
  const result = await h.create(request({workspaceMailbox: mailbox, sendCredentials: true}), actor);
  assert.equal(result.ok, true);
  assert.equal(result.uid, 'new-dashboard-user');
  assert.equal(result.workspaceMailbox.status, 'error');
  assert.equal(result.workspaceMailbox.passwordAvailable, false);
  assert.equal(result.credentialsEmailSent, true);
  assert.equal(JSON.stringify(result).includes(rawProviderSecret), false);
  assert.ok(h.records.has('users/new-dashboard-user'));
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.remove.length, 0);
  assert.equal(h.calls.invite.length, 1);
  assert.equal(h.calls.notifications.length, 0);
});

test('confirmed Google creation automatically sends the partner the new address when login credentials are not requested', async () => {
  for (const status of ['pending', 'ready']) {
    const h = harness({mailboxResult: {...readyMailbox, status}});
    const result = await h.create(request({workspaceMailbox: mailbox, sendCredentials: false}), actor);
    assert.equal(result.ok, true);
    assert.equal(result.workspaceMailbox.status, status);
    assert.equal(result.workspaceMailbox.notificationStatus, 'sent');
    assert.equal(result.workspaceMailbox.notificationEmail, contactEmail);
    assert.equal(h.calls.notifications.length, 1);
    assert.equal(h.calls.notifications[0].uid, 'new-dashboard-user');
    assert.equal(h.calls.notifications[0].actorUid, actor.uid);
    assert.equal(h.calls.notifications[0].workspaceMailbox.googleUserId, readyMailbox.googleUserId);
    assert.equal(h.calls.invite.length, 0);
    assert.equal(result.credentialsEmailSent, false);
  }
});

test('a provisioning error, unconfirmed Google account, or dashboard-only account sends no company-email notification', async () => {
  for (const mailboxResult of [
    {...readyMailbox, status: 'error'},
    {...readyMailbox, status: 'provisioning'},
    {...readyMailbox, googleUserId: undefined},
    {...readyMailbox, status: 'pending', googleUserId: ''},
  ]) {
    const h = harness({mailboxResult});
    const result = await h.create(request({workspaceMailbox: mailbox}), actor);
    assert.equal(result.ok, true);
    assert.equal(h.calls.notifications.length, 0);
  }
  const h = harness();
  await h.create(request({sendCredentials: true}), actor);
  assert.equal(h.calls.invite.length, 1);
  assert.equal(h.calls.notifications.length, 0);
});

test('company-email notification failure remains independent of dashboard creation and the optional login invite', async () => {
  const h = harness({notificationResult: {
    notificationStatus: 'error', notificationMessage: 'The company email address could not be sent.',
  }});
  const result = await h.create(request({workspaceMailbox: mailbox, sendCredentials: true}), actor);
  assert.equal(result.ok, true);
  assert.equal(result.workspaceMailbox.status, 'ready');
  assert.equal(result.workspaceMailbox.notificationStatus, 'error');
  assert.equal(result.credentialsEmailSent, true);
  assert.equal(h.calls.notifications.length, 1);
  assert.equal(h.calls.invite.length, 1);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.remove.length, 0);
});

test('selecting the partner kit sends one login invite even when the separate credentials option is off', async () => {
  for (const sendCredentials of [false, true]) {
    const h = harness();
    const result = await h.create(request({includePartnerKit: true, sendCredentials}), actor);
    assert.equal(result.ok, true);
    assert.equal(result.credentialsEmailSent, true);
    assert.equal(h.calls.invite.length, 1);
    assert.equal(h.calls.invite[0].details.includePartnerKit, true);
    assert.equal(h.calls.invite[0].details.password, dashboardPassword);
    assert.equal(h.calls.invite[0].details.uid, result.uid);
    assert.equal(h.calls.invite[0].actorUid, actor.uid);
    assert.equal(h.calls.invite[0].preparedKit.metadata.sha256, 'isolated-kit-sha256');
    assert.equal(h.calls.invite[0].preparedKit.attachment.contentType, 'application/pdf');
    assert.equal(result.credentialsPartnerKitIncluded, true);
    assert.equal(h.calls.kitPreflight.length, 1);
    assert.equal(h.calls.notifications.length, 0);
  }
});

test('partner kits are rejected for admin and ordinary-user recipients before account or Google effects', async () => {
  for (const role of ['admin', 'user']) {
    const h = harness();
    await assert.rejects(h.create(request({profile: {role}, includePartnerKit: true}), actor), {code: 'permission-denied'});
    for (const effect of ['create', 'claims', 'writes', 'availability', 'provision', 'invite', 'notifications']) {
      assert.equal(h.calls[effect].length, 0);
    }
  }
});

test('a missing partner kit fails preflight before dashboard creation or Google lookup', async () => {
  const kitError = Object.assign(new Error('Partner kit is unavailable.'), {code: 'failed-precondition'});
  const h = harness({kitError});
  await assert.rejects(h.create(request({includePartnerKit: true, workspaceMailbox: mailbox}), actor), {code: 'failed-precondition'});
  assert.equal(h.calls.kitPreflight.length, 1);
  for (const effect of ['create', 'claims', 'writes', 'availability', 'provision', 'invite', 'notifications']) {
    assert.equal(h.calls[effect].length, 0);
  }
});

test('an unselected kit leaves normal optional login-email behavior unchanged', async () => {
  for (const includePartnerKit of [undefined, false, 'true']) {
    for (const sendCredentials of [false, true]) {
      const h = harness();
      const result = await h.create(request({includePartnerKit, sendCredentials}), actor);
      assert.equal(result.ok, true);
      assert.equal(result.credentialsEmailSent, sendCredentials);
      assert.equal(h.calls.invite.length, sendCredentials ? 1 : 0);
      assert.equal(h.calls.kitPreflight.length, 0);
      if (sendCredentials) assert.notEqual(h.calls.invite[0].details.includePartnerKit, true);
    }
  }
});

test('a failed login invite reports a separate outcome after dashboard and mailbox success', async () => {
  const h = harness({inviteError: new Error(rawProviderSecret)});
  const result = await h.create(request({workspaceMailbox: mailbox, sendCredentials: true}), actor);
  assert.equal(result.ok, true);
  assert.equal(result.workspaceMailbox.status, 'ready');
  assert.equal(result.workspaceMailbox.temporaryPassword, googlePassword);
  assert.equal(result.credentialsEmailSent, false);
  assert.match(result.credentialsEmailError, /could not be sent/);
  assert.equal(JSON.stringify(result).includes(rawProviderSecret), false);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.remove.length, 0);
  assert.equal(result.workspaceMailbox.notificationStatus, 'sent');
  assert.equal(h.calls.notifications.length, 1);
});

test('passwords and caller-supplied mailbox state never enter the saved profile or claims', async () => {
  const h = harness();
  const result = await h.create(request({
    workspaceMailbox: mailbox,
    profile: {
      role: 'partner', password: dashboardPassword, Password: dashboardPassword,
      email: 'remove@example.net', Email: 'remove@example.net', token: rawProviderSecret,
      workspaceMailbox: {status: 'ready', email: 'forged@charge.rent', temporaryPassword: googlePassword},
    },
  }), actor);
  assert.equal(result.workspaceMailbox.temporaryPassword, googlePassword);
  const stored = JSON.stringify({records: [...h.records], claims: h.calls.claims});
  for (const privateValue of [dashboardPassword, googlePassword, rawProviderSecret, 'forged@charge.rent']) {
    assert.equal(stored.includes(privateValue), false);
  }
  assert.deepEqual(h.records.get('users/new-dashboard-user').workspaceMailbox, {
    status: 'provisioning', email: 'j.smith@charge.rent', message: 'Company email is queued for creation.',
  });
  assert.equal(h.calls.claims[0].profile.workspaceMailbox, undefined);
  assert.equal(h.calls.provision[0].actorUid, actor.uid);
  assert.equal(h.calls.provision[0].request.email, 'j.smith@charge.rent');
});

test('profile and normalized mailbox request are persisted in one batch before provisioning', async () => {
  const h = harness();
  await h.create(request({workspaceMailbox: {...mailbox, localPart: ' J.Smith '}}), actor);
  assert.equal(h.calls.batches.length, 1);
  assert.deepEqual(h.calls.batches[0].map(({path}) => path), [
    'users/new-dashboard-user', 'workspaceProvisioning/new-dashboard-user',
  ]);
  const saved = h.records.get('workspaceProvisioning/new-dashboard-user');
  assert.equal(saved.uid, 'new-dashboard-user');
  assert.equal(saved.email, 'j.smith@charge.rent');
  assert.equal(saved.status, 'queued');
  assert.equal(saved.leaseExpiresAt, 0);
  assert.equal(saved.actorUid, actor.uid);
  assert.equal(saved.contactEmail, contactEmail);
  assert.deepEqual(saved.request, {...mailbox, email: 'j.smith@charge.rent', role: 'partner'});
});

test('failed custom claims or atomic profile saving leave no orphan provisioning request', async () => {
  for (const options of [{claimsError: new Error('claims failed')}, {batchError: new Error('batch failed')}]) {
    const h = harness(options);
    await assert.rejects(h.create(request({workspaceMailbox: mailbox}), actor), {code: 'internal'});
    assert.equal(h.records.size, 0);
    assert.equal(h.calls.provision.length, 0);
    assert.deepEqual(h.calls.remove, ['new-dashboard-user']);
    assert.equal(h.calls.writes.length, 0);
  }
});

test('the first module claim can fail and still recover by retrying the saved mailbox request', async () => {
  const h = harness({useRealProvisioning: true, failFirstClaim: true});
  const created = await h.create(request({workspaceMailbox: mailbox}), actor);
  assert.equal(created.ok, true);
  assert.equal(created.workspaceMailbox.status, 'error');
  assert.equal(h.records.get('workspaceProvisioning/new-dashboard-user').status, 'queued');
  assert.equal(h.records.get('users/new-dashboard-user').workspaceMailbox.email, 'j.smith@charge.rent');
  const retried = await h.retry({uid: created.uid}, actor);
  assert.equal(retried.ok, true);
  assert.equal(retried.workspaceMailbox.status, 'ready');
  assert.ok(retried.workspaceMailbox.temporaryPassword);
  assert.equal(h.records.get('workspaceProvisioning/new-dashboard-user').status, 'ready');
  assert.equal(h.records.get('users/new-dashboard-user').workspaceMailbox.status, 'ready');
  assert.equal(h.calls.create.length, 1);
  assert.equal(JSON.stringify([...h.records]).includes(retried.workspaceMailbox.temporaryPassword), false);
});

test('profile updates cannot replace service-maintained mailbox state', async () => {
  const state = {status: 'pending', email: 'j.smith@charge.rent', googleUserId: 'owned-google-user'};
  const h = harness({records: {'users/existing-user': {username: 'jane', role: 'admin', workspaceMailbox: state}}});
  await h.upsert({uid: 'existing-user', profile: {username: 'jane', role: 'admin', workspaceMailbox: {status: 'ready', email: 'forged@charge.rent'}}});
  assert.deepEqual(h.records.get('users/existing-user').workspaceMailbox, state);
  assert.equal(h.calls.claims[0].profile.workspaceMailbox, undefined);
});

test('mailbox status is available only when the actual actor is allowlisted', () => {
  const h = harness();
  assert.equal(h.status(actor).configured, true);
  const denied = h.status(otherAdmin);
  assert.equal(denied.configured, false);
  assert.equal(denied.domain, 'charge.rent');
  assert.match(denied.message, /not enabled for your dashboard account/);
  assert.equal(harness({enabled: false}).status(actor).configured, false);
});

test('retry uses the stored request and current role instead of caller-supplied mailbox details', async () => {
  const h = harness({records: {
    'users/existing-user': {role: 'partner', contact: {email: 'changed-profile@example.net'}},
    'workspaceProvisioning/existing-user': {contactEmail, request: {...mailbox, email: 'j.smith@charge.rent', role: 'admin'}},
  }});
  const result = await h.retry({uid: 'existing-user', workspaceMailbox: {...mailbox, localPart: 'attacker'}}, actor);
  assert.equal(result.ok, true);
  assert.equal(result.workspaceMailbox.status, 'ready');
  assert.equal(result.workspaceMailbox.notificationStatus, 'sent');
  assert.equal(result.workspaceMailbox.notificationEmail, contactEmail);
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.calls.remove.length, 0);
  assert.equal(h.calls.authUpdates.length, 0);
  assert.equal(h.calls.invite.length, 0);
  assert.equal(h.calls.notifications.length, 1);
  assert.equal(h.calls.notifications[0].uid, 'existing-user');
  assert.deepEqual(h.calls.provision[0], {
    uid: 'existing-user', actorUid: actor.uid,
    request: {...mailbox, email: 'j.smith@charge.rent', role: 'partner'},
  });
});

test('retry rejects missing requests, invalid IDs, and users whose role is no longer eligible', async () => {
  const h = harness({records: {
    'users/client-user': {role: 'user'},
    'workspaceProvisioning/client-user': {request: {...mailbox, role: 'partner'}},
    'users/admin-user': {role: 'admin'},
    'workspaceProvisioning/admin-user': {request: {...mailbox, role: 'partner'}},
  }});
  await assert.rejects(h.retry({uid: 'missing'}, actor), {code: 'not-found'});
  await assert.rejects(h.retry({uid: 'invalid/id'}, actor), {code: 'invalid-argument'});
  await assert.rejects(h.retry({uid: 'client-user'}, actor), {code: 'permission-denied'});
  await assert.rejects(h.retry({uid: 'admin-user'}, actor), {code: 'permission-denied'});
  assert.equal(h.calls.provision.length, 0);
  assert.equal(h.calls.create.length, 0);
  assert.equal(h.calls.availability.length, 0);
  assert.equal(h.calls.writes.length, 0);
});

test('notification-only resend uses the saved confirmed mailbox without creating accounts or changing passwords', async () => {
  for (const endpointName of ['admin_resendWorkspaceNotification', 'admin_httpResendWorkspaceNotification']) {
    const h = harness({records: {
      'users/existing-user': {role: 'partner', contact: {email: 'changed-profile@example.net'}},
      'workspaceProvisioning/existing-user': {
        status: 'ready', email: readyMailbox.email, googleUserId: readyMailbox.googleUserId,
        contactEmail, request: {...mailbox, email: readyMailbox.email, role: 'partner'},
      },
    }});
    const result = await h.endpoints[endpointName]({
      uid: 'existing-user', resendUnknown: true,
      mailbox: {...readyMailbox, email: 'forged@charge.rent'}, password: dashboardPassword,
    }, {authState: actor});
    assert.equal(result.ok, true);
    assert.equal(result.workspaceMailbox.email, readyMailbox.email);
    assert.equal(result.workspaceMailbox.notificationEmail, contactEmail);
    assert.equal(result.workspaceMailbox.temporaryPassword, undefined);
    assert.equal(h.calls.notifications.length, 1);
    assert.equal(h.calls.notifications[0].resendUnknown, true);
    for (const effect of ['provision', 'availability', 'create', 'remove', 'authUpdates', 'invite']) {
      assert.equal(h.calls[effect].length, 0);
    }
  }
});

test('both callable and HTTP endpoints enforce the actor allowlist before any provisioning effects', async () => {
  for (const prefix of ['callable', 'http']) {
    const h = harness();
    const names = prefix === 'http'
      ? ['admin_httpCreateAuthUserAndProfile', 'admin_httpWorkspaceCheckEmail', 'admin_httpRetryWorkspaceMailbox', 'admin_httpResendWorkspaceNotification', 'admin_httpWorkspaceStatus']
      : ['admin_createAuthUserAndProfile', 'admin_workspaceCheckEmail', 'admin_retryWorkspaceMailbox', 'admin_resendWorkspaceNotification', 'admin_workspaceStatus'];
    const payloads = [request({workspaceMailbox: mailbox}), {localPart: 'j.smith'}, {uid: 'existing-user'}, {uid: 'existing-user'}];
    for (let index = 0; index < payloads.length; index += 1) {
      await assert.rejects(h.endpoints[names[index]](payloads[index], {authState: otherAdmin}), {code: 'permission-denied'});
    }
    assert.equal((await h.endpoints[names.at(-1)]({}, {authState: otherAdmin})).configured, false);
    assert.deepEqual(h.calls.authorization, Array(names.length).fill(prefix));
    assert.equal(h.calls.create.length, 0);
    assert.equal(h.calls.reads.length, 0);
    assert.equal(h.calls.availability.length, 0);
    assert.equal(h.calls.provision.length, 0);
    assert.equal(h.calls.notifications.length, 0);
  }
});

test('both endpoint forms require administrator authorization even for an allowlisted UID', async () => {
  for (const prefix of ['callable', 'http']) {
    const h = harness();
    const authState = {...actor, isAdmin: false};
    const names = prefix === 'http'
      ? ['admin_httpCreateAuthUserAndProfile', 'admin_httpWorkspaceCheckEmail', 'admin_httpRetryWorkspaceMailbox', 'admin_httpResendWorkspaceNotification', 'admin_httpWorkspaceStatus']
      : ['admin_createAuthUserAndProfile', 'admin_workspaceCheckEmail', 'admin_retryWorkspaceMailbox', 'admin_resendWorkspaceNotification', 'admin_workspaceStatus'];
    for (const name of names) {
      await assert.rejects(h.endpoints[name](request({workspaceMailbox: mailbox}), {authState}), {code: 'permission-denied'});
    }
    assert.equal(h.calls.create.length, 0);
    assert.equal(h.calls.availability.length, 0);
    assert.equal(h.calls.provision.length, 0);
    assert.equal(h.calls.reads.length, 0);
    assert.equal(h.calls.notifications.length, 0);
  }
});
